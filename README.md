# ponytail

A Claude Code plugin that saves tokens and time.

- Adds short **lean working rules** to the system prompt: answer first, no narration, read files in parts, batch tool calls, run the narrowest check, stop when done.
- **Blocks repeat reads**: a whole-file Read of a file already read this session and unchanged since is refused, with a hint to use what it has or read a line range.
- **Status line**: context fill, re-reads skipped, session cost. A toast once the context passes 75%, so you can `/compact` before turns get expensive.
- `/ponytail status`, `/ponytail on`, `/ponytail off`. The switch is remembered across sessions.

## Install

Needs Claude Code 2.1.299 or newer (the `prompt.compose` hook).

On a machine that has this folder (copy it anywhere), from a shell:

```
claude plugin marketplace add /path/to/ponytail
claude plugin install ponytail@ponytail --scope user
```

Then in any Claude Code session, terminal or desktop app, `/ponytail` works and the lean rules are on. Once the marketplace is added, the terminal form is `/plugin install ponytail@ponytail`.

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with the folder path, then Add plugin.

### From GitHub

At the prompt of a terminal session:

```
/plugin install ponytail --marketplace junkit1688/ponytail
```

From a shell:

```
claude plugin install ponytail --marketplace junkit1688/ponytail
```

Answer `y` to add the marketplace, then pick the user scope so it loads in every session.

## Develop

```
claude plugin validate /path/to/ponytail
claude plugin test /path/to/ponytail
```
