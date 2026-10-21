/** The model that crafts the slug. */
export const MODEL = 'haiku'
export const MODEL_TIMEOUT_MS = 6000
export const LOOKUP_TIMEOUT_MS = 5000
/** The Todoist connector's name as /mcp lists it. */
export const TODOIST = 'claude.ai Todoist'
/** How many change folders are searched when a step is given a backlog key rather than a change id. */
export const SCAN_MAX = 40
const SLUG_WORDS = 4
const SLUG_MAX = 40

export type Step = 'intent' | 'spec' | 'plan' | 'build' | 'review'

/** The item a step is about: its backlog key (empty when it has none) and what it is called. */
export type Item = { key: string; topic: string }

const COMMAND = /^\/ai-sdlc:(intent|spec|plan|build|review)(?:\s+([\s\S]*))?$/
const KEY = /\b([A-Z]{2,5}-\d{3,})\b/
const CHANGE_ID = /\b(\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*)/
const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'for', 'and', 'or', 'in', 'on', 'with', 'so', 'that', 'this', 'is', 'be', 'it', 'as', 'at', 'by', 'from', 'when', 'its'])

export const SLUG_SYSTEM =
  'You name coding sessions. Reply with a slug of two to four lowercase words joined by underscores that says what the work is, for example mod_rename_session. No backlog key, no step name, no explanation, nothing else.'

/** A typed `/ai-sdlc:<step> <args>`; `null` for any other prompt, and for the steps that are not about one item (adopt, status). */
export function parseCommand(prompt: string): { step: Step; arg: string } | null {
  const m = COMMAND.exec(prompt.trim())
  return m === null ? null : { step: m[1] as Step, arg: (m[2] ?? '').trim() }
}

/** The arguments an ai-sdlc skill's expanded text echoes on its `Input:` or `Change:` line. */
export function argFromSkillText(text: string): string {
  const m = /^(?:Input|Change): (.*)$/m.exec(text)
  const arg = m?.[1]?.trim() ?? ''
  return arg === '$ARGUMENTS' ? '' : arg
}

export function findKey(text: string): string {
  return KEY.exec(text)?.[1] ?? ''
}

export function findChangeId(text: string): string {
  return CHANGE_ID.exec(text)?.[1] ?? ''
}

export function stripKey(text: string): string {
  return text.replace(KEY, ' ').trim()
}

/** The `key: value` lines between the opening and closing `---`; no nesting, no lists. */
export function frontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const out: Record<string, string> = {}
  for (const line of (m?.[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (kv) out[kv[1]!] = kv[2]!.trim().replace(/^["']|["']$/g, '')
  }
  return out
}

/** The change id a `change/<id>` branch names, from the contents of `.git/HEAD`. */
export function branchChange(head: string): string {
  const m = /^ref: refs\/heads\/change\/(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)\s*$/.exec(head.trim())
  return m?.[1] ?? ''
}

/** `2026-10-21-rename-session-mod` -> `rename session mod`. */
export function idTopic(id: string): string {
  return id.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' ')
}

function squash(words: string[]): string {
  let out = ''
  for (const w of words) {
    const next = out === '' ? w : `${out}_${w}`
    if (next.length > SLUG_MAX) break
    out = next
  }
  return out
}

/** The fallback slug when the model gives none: the first few meaningful words, underscore-joined. */
export function slugify(topic: string): string {
  const words = stripKey(topic)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w !== '')
  const meaningful = words.filter(w => !STOP.has(w))
  return squash((meaningful.length > 0 ? meaningful : words).slice(0, SLUG_WORDS).map(w => w.slice(0, 20)))
}

/** A model reply cut down to a slug; empty when nothing usable is left. */
export function cleanSlug(reply: string): string {
  const line = reply.trim().split(/\r?\n/)[0] ?? ''
  const words = line
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .split('_')
    .filter(w => w !== '')
  return squash(words.slice(0, SLUG_WORDS + 1).map(w => w.slice(0, 20)))
}

/** The key, an underscore, the slug: `SKL-001_mod_rename_session`. With no key, the slug alone; with no slug, the key alone. */
export function joinTitle(key: string, slug: string): string {
  return key === '' || slug === '' ? key + slug : `${key}_${slug}`
}

/** The task title after the key in a Todoist `find-tasks` reply, or empty when the key is not there. */
export function todoistTopic(replyText: string, key: string): string {
  try {
    const data = JSON.parse(replyText) as { tasks?: { content?: unknown }[] }
    const own = new RegExp(`^${key}(?!\\d)\\s*[—–-]?\\s*`)
    for (const task of data.tasks ?? []) {
      const content = typeof task.content === 'string' ? task.content.trim() : ''
      if (own.test(content)) return content.replace(own, '').trim()
    }
  } catch {
    // not JSON: the connector answered something else, so there is no title to use
  }
  return ''
}
