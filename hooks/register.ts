import type { EngineInterface, Register } from 'claude-code'

// ponytail: a token and time saver.
//
// 1. Adds a short "lean rules" section to the system prompt, so Claude answers
//    briefly, reads files in parts and batches tool calls.
// 2. Blocks a whole-file Read of a file already read this session and unchanged
//    since, telling Claude to use what it has or read a line range instead.
// 3. Keeps a status line with context fill, re-reads skipped and session cost,
//    and toasts once when the context passes 75%.
// 4. /ponytail [on|off|status] switches it, remembered across sessions.

const NAME = 'ponytail'
const STORE_ENABLED = 'enabled'
const WARN_AT_PERCENT = 75

const RULES = `# ponytail: token and time saver

These working rules are on because the user installed the ponytail plugin. They override the default verbosity.

- Lead with the answer or outcome, in as few words as the reader needs. No preamble, no restating the request, no closing recap of things that did not change.
- Do not narrate tool calls or announce what you are about to do, except before a risky or irreversible step.
- Before reading a file, ask whether grep or a line range would do. Read a whole file only when the task needs all of it; read large files with offset and limit.
- Never re-read a file you already read this session unless it changed. ponytail blocks such repeats and says what to do instead.
- Batch independent tool calls in one message. One shell command with a pipe beats three separate commands.
- Prefer small targeted edits over rewriting files. Do not reformat or clean code you were not asked to touch.
- Run the narrowest check that proves the change. Do not run full test suites, builds or linters unless asked or the change clearly needs it.
- Do not quote long tool output back. State the one fact from it that matters.
- When the task is done, stop. Offer follow-ups, alternatives or caveats only when they change what the user should do next.`

type Seen = { mtimeMs: number; chars: number }

// Module variables start over on a hot reload; that only resets the counters.
const seen = new Map<string, Seen>()
let skipped = 0
let savedChars = 0
let hasWarned = false

const formatTokens = (chars: number): string => {
  const tokens = Math.round(chars / 4)
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
}

const isEnabled = async ($: EngineInterface): Promise<boolean> =>
  (await $.store.get(STORE_ENABLED)) !== false

// The status line is a nicety: a failure here must never stop a tool call or a command.
const refreshStatus = async ($: EngineInterface): Promise<void> => {
  try {
    if (!(await isEnabled($))) {
      $.ui.status(undefined)
      return
    }
    const { context, cost } = await $.session.usage()
    const parts = [NAME]
    if (context.percent !== undefined) parts.push(`ctx ${context.percent}%`)
    if (skipped > 0) parts.push(`${skipped} re-read${skipped === 1 ? '' : 's'} skipped (~${formatTokens(savedChars)} tok)`)
    if (cost !== undefined) parts.push(`$${cost.usd.toFixed(2)}`)
    $.ui.status(parts.join(' · '))

    if (context.percent !== undefined && context.percent >= WARN_AT_PERCENT && !hasWarned) {
      hasWarned = true
      $.ui.toast(`${NAME}: context is ${context.percent}% full. /compact now keeps the next turns cheap.`, { timeoutMs: 8000 })
    }
  } catch {
    // no status this time
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: NAME,
      description: 'Token saver: show status, or switch it on or off.',
      argumentHint: '[on|off|status]',
    })
    await refreshStatus($)
    return next(e)
  })

  // The lean rules, appended as the last session section of the system prompt.
  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    if (!(await isEnabled($))) return { sections }
    return {
      sections: [...sections, { id: `${NAME}:rules`, text: RULES, scope: 'session' as const }],
    }
  })

  // Block a repeat whole-file Read of an unchanged file.
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    if (!(await isEnabled($))) return next(e)

    const isWhole = e.offset === undefined && e.limit === undefined && e.pages === undefined
    const key = `${e.agentId ?? 'main'}|${e.file_path}`
    const stat = isWhole ? await $.fs.stat(e.file_path).catch(() => undefined) : undefined

    if (stat !== undefined) {
      const prior = seen.get(key)
      if (prior !== undefined && prior.mtimeMs === stat.mtimeMs) {
        skipped += 1
        savedChars += prior.chars
        void refreshStatus($)
        return {
          deny:
            `${NAME}: you already read ${e.file_path} this session and it has not changed since. ` +
            `Use what you have, or Grep, or Read with offset and limit for the part you need. ` +
            `(/ponytail off disables this.)`,
        }
      }
    }

    const ran = await next(e)
    if (stat !== undefined && ran.deny === undefined && ran.isError !== true) {
      seen.set(key, { mtimeMs: stat.mtimeMs, chars: ran.text?.length ?? 0 })
    }
    return ran
  }).catch(($, e, next) => next(e))

  // After a compaction the model no longer holds the file, so let it read again.
  on('session.compact', ($, e, next) => {
    const prefix = `${e.agentId ?? 'main'}|`
    for (const key of [...seen.keys()]) {
      if (key.startsWith(prefix)) seen.delete(key)
    }
    return next(e)
  })

  // A Write or Edit changes the file's mtime, so the next Read passes anyway;
  // forget the entry too, so a same-second write is never mistaken for unchanged.
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    seen.delete(`${e.agentId ?? 'main'}|${e.file_path}`)
    return ran
  })
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    seen.delete(`${e.agentId ?? 'main'}|${e.file_path}`)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await refreshStatus($)
    return next(e)
  })

  on('command.run', { command: NAME }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'on' || arg === 'off') {
      await $.store.set(STORE_ENABLED, arg === 'on')
      await refreshStatus($)
      return {
        text:
          arg === 'on'
            ? `${NAME} is on: lean rules from the next turn, repeat reads blocked, status line shown.`
            : `${NAME} is off: lean rules dropped from the next turn, reads unblocked, status line hidden. /ponytail on brings it back.`,
      }
    }

    if (arg !== '' && arg !== 'status') {
      return { text: `Usage: /${NAME} [on|off|status]` }
    }

    const enabled = await isEnabled($)
    const { context, cost } = await $.session.usage()
    const lines = [
      `${NAME}: ${enabled ? 'on' : 'off'}`,
      `context: ${context.percent !== undefined ? `${context.percent}% of ${formatTokens(context.window * 4)} tokens` : 'no turn yet'}`,
      `re-reads skipped this session: ${skipped} (about ${formatTokens(savedChars)} tokens kept out of context)`,
    ]
    if (cost !== undefined) lines.push(`session cost: $${cost.usd.toFixed(2)}`)
    lines.push(`switch: /${NAME} on, /${NAME} off`)
    return { text: lines.join('\n') }
  })
}
