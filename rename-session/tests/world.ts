import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

const NO_USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ROOT = '/repo'

export const START = { cwd: ROOT, surface: 'terminal', isInteractive: true } as const

export const intent = (id: string, title: string, backlog: string) =>
  `---\ntype: intent\nid: ${id}\ntitle: ${title}\ntrack: feature\nstatus: accepted\nbacklog: ${backlog}\n---\n\n# ${title}\n`

export type Behaviour = {
  files: Record<string, string>
  /** The slug the model replies with; `null` makes the call fail. */
  slug: string | null
  /** The text Todoist's find-tasks replies; `null` makes the connector fail. */
  todoist: string | null
}

/** Stands in for the engine beneath the mod: the file system, Todoist, the model and the clock. */
export function world(on: On, change: Partial<Behaviour> = {}, saved: Record<string, unknown> = {}) {
  const clock = mock.clock(on)
  mock.store(on, saved)
  const how: Behaviour = { files: {}, slug: 'mod_rename_session', todoist: null, ...change }
  const seen = { modelPrompts: [] as string[], todoistCalls: [] as string[], toasts: [] as string[] }

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('fs.read', (_$, e) => {
    const text = how.files[e.path]
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.list', (_$, e) => {
    const prefix = `${e.path}/`
    const names = new Set<string>()
    for (const file of Object.keys(how.files)) {
      if (file.startsWith(prefix)) names.add(file.slice(prefix.length).split('/')[0]!)
    }
    return { value: [...names].map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('mcp.call', (_$, e) => {
    seen.todoistCalls.push(String((e.args as { searchText?: unknown } | undefined)?.searchText))
    return how.todoist === null
      ? { deny: 'server not connected' }
      : { value: { content: [{ type: 'text' as const, text: how.todoist }], isError: false } }
  })
  on('model.complete', (_$, e) => {
    seen.modelPrompts.push(e.prompt)
    return how.slug === null
      ? { value: { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded' as const, usage: NO_USAGE } }
      : { value: { isAnswered: true as const, text: how.slug, usage: NO_USAGE } }
  })
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('classic.UserPromptSubmit', () => ({}))
  on('skill.prompt', (_$, e) => ({ text: e.text }))

  return { how, seen, clock }
}

export const todoistReply = (...contents: string[]) => JSON.stringify({ tasks: contents.map((content, i) => ({ id: `t${i}`, content })) })
