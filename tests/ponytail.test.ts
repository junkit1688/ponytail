import { expect, mock, test } from 'claude-code/testing'

const FILE = '/tmp/example.txt'

const stat = (mtimeMs: number) => ({ value: { kind: 'file' as const, size: 10, mtimeMs, isLink: false } })

test('a repeat whole-file read of an unchanged file is denied', async ($, on) => {
  mock.store(on)
  let mtimeMs = 1000
  on('fs.stat', () => stat(mtimeMs))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'hello world', text: 'hello world' }))

  const first = await $.tool.call({ tool: 'Read', file_path: FILE })
  expect(first.deny).toBeUndefined()

  const second = await $.tool.call({ tool: 'Read', file_path: FILE })
  expect(second.deny ?? second.text).toContain('already read')

  // a line range still passes
  const range = await $.tool.call({ tool: 'Read', file_path: FILE, offset: 1, limit: 5 })
  expect(range.deny).toBeUndefined()
  expect(range.isError).toBeUndefined()

  // a changed file passes again
  mtimeMs = 2000
  const changed = await $.tool.call({ tool: 'Read', file_path: FILE })
  expect(changed.deny).toBeUndefined()
  expect(changed.isError).toBeUndefined()
})

test('/ponytail off lets repeat reads through', async ($, on) => {
  mock.store(on, { enabled: false })
  on('fs.stat', () => stat(1000))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'hello', text: 'hello' }))

  await $.tool.call({ tool: 'Read', file_path: FILE })
  const second = await $.tool.call({ tool: 'Read', file_path: FILE })
  expect(second.isError).toBeUndefined()
})

const INTRO = { id: 'intro', text: 'You are Claude.', scope: 'shared' as const }
const COMPOSE = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as const

test('the lean rules ride the system prompt while on', async ($, on) => {
  mock.store(on)
  on('prompt.compose', () => ({ sections: [INTRO] }))

  const { sections } = await $.prompt.compose(COMPOSE)
  expect(sections.map(s => s.id)).toEqual(['intro', 'ponytail:rules'])
  expect(sections[1]?.scope).toBe('session')
})

test('the lean rules are left out while off', async ($, on) => {
  mock.store(on, { enabled: false })
  on('prompt.compose', () => ({ sections: [INTRO] }))

  const { sections } = await $.prompt.compose(COMPOSE)
  expect(sections.map(s => s.id)).toEqual(['intro'])
})

test('/ponytail off and on are remembered in the store', async ($, on) => {
  mock.store(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 12 }, rateLimits: [] } }))
  on('ui.status', () => ({ value: undefined }))

  const run = (args: string) =>
    $.command.run({
      command: 'ponytail',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })

  const off = await run('off')
  expect(off.text).toContain('ponytail is off')

  const status = await run('')
  expect(status.text).toContain('ponytail: off')

  const back = await run('on')
  expect(back.text).toContain('ponytail is on')

  const again = await run('status')
  expect(again.text).toContain('ponytail: on')
  expect(again.text).toContain('12%')
})
