import type { EngineInterface, Register } from 'claude-code'

import {
  LOOKUP_TIMEOUT_MS,
  MODEL,
  MODEL_TIMEOUT_MS,
  SCAN_MAX,
  SLUG_SYSTEM,
  TODOIST,
  argFromSkillText,
  branchChange,
  cleanSlug,
  findChangeId,
  findKey,
  frontmatter,
  idTopic,
  joinTitle,
  parseCommand,
  slugify,
  stripKey,
  todoistTopic,
} from './logic'
import type { Item, Step } from './logic'

type Dollar = EngineInterface

// The module's own variables start over on a reload; the slugs in the store do not.
const titles = new Map<string, Promise<string | null>>()
let current = ''
let pending: Promise<string | null> | null = null

/** Gives `work` a limit; `undefined` when the limit comes first or `work` fails. */
async function within<T>($: Dollar, ms: number, work: Promise<T>): Promise<T | undefined> {
  const stop = new AbortController()
  const late = $.clock.sleep(ms, { signal: stop.signal }).then(
    () => undefined,
    () => undefined,
  )
  try {
    return await Promise.race([work.catch(() => undefined), late])
  } finally {
    stop.abort()
  }
}

async function text($: Dollar, path: string): Promise<string> {
  return $.fs.read(path).catch(() => '')
}

async function fromIntent($: Dollar, changes: string, id: string): Promise<Item | null> {
  const raw = await text($, `${changes}/${id}/intent.md`)
  if (raw === '') return null
  const fm = frontmatter(raw)
  return { key: findKey(fm.backlog ?? '') || findKey(fm.title ?? ''), topic: fm.title || idTopic(id) }
}

/** The change whose intent links this backlog key, searching the newest folders first. */
async function fromKey($: Dollar, changes: string, key: string): Promise<Item | null> {
  const entries = await $.fs.list(changes).catch(() => [])
  const ids = entries
    .filter(x => x.kind === 'dir' && findChangeId(x.name) === x.name)
    .map(x => x.name)
    .sort()
    .reverse()
    .slice(0, SCAN_MAX)
  const found = await Promise.all(ids.map(id => fromIntent($, changes, id)))
  return found.find(x => x !== null && x.key === key) ?? null
}

async function fromTodoist($: Dollar, key: string): Promise<string> {
  const reply = await within(
    $,
    LOOKUP_TIMEOUT_MS,
    $.mcp.call(TODOIST, 'find-tasks', { searchText: key, limit: 5 }),
  )
  if (reply === undefined || reply.isError === true) return ''
  const body = reply.content.map(b => (b.type === 'text' ? b.text : '')).join('\n')
  return todoistTopic(body, key)
}

/** A backlog item kept as a file: the key from its name or `item:` line, the title from `title:` or its first heading. */
async function fromFile($: Dollar, path: string): Promise<Item | null> {
  const raw = await text($, path)
  if (raw === '') return null
  const fm = frontmatter(raw)
  const heading = /^#\s+(.+)$/m.exec(raw)?.[1] ?? ''
  const key = findKey(path) || findKey(fm.item ?? '') || findKey(heading)
  return { key, topic: stripKey(fm.title || heading || fm.item || '') }
}

async function resolveItem($: Dollar, arg: string): Promise<Item | null> {
  const root = await $.session.root()
  const changes = `${root}/docs/changes`

  // With no argument the build and review steps ask which change; the branch is the only safe guess.
  const id = findChangeId(arg) || (arg === '' ? branchChange(await text($, `${root}/.git/HEAD`)) : '')
  if (id !== '') {
    const item = await fromIntent($, changes, id)
    if (item !== null) return item
  }

  const key = findKey(arg)
  if (key !== '') {
    const local = await fromKey($, changes, key)
    const topic = local?.topic || (await fromTodoist($, key)) || stripKey(arg)
    return { key, topic: topic || key }
  }

  const file = /(\S+\.md)\b/.exec(arg)?.[1]
  if (file !== undefined) {
    const item = await fromFile($, file)
    if (item !== null && item.topic !== '') return item
  }

  return arg === '' ? null : { key: '', topic: arg }
}

async function craft($: Dollar, topic: string): Promise<string> {
  const reply = await within(
    $,
    MODEL_TIMEOUT_MS,
    $.model.complete({ model: MODEL, system: SLUG_SYSTEM, prompt: topic.slice(0, 600), maxTokens: 40, effort: 'low', timeoutMs: MODEL_TIMEOUT_MS }),
  )
  return (reply?.isAnswered ? cleanSlug(reply.text) : '') || slugify(topic)
}

/** The same item keeps the same slug in every session, so intent, plan and build sessions line up. */
async function slugFor($: Dollar, item: Item): Promise<string> {
  const saved = item.key === '' ? {} : ((await $.store.get('slugs').catch(() => undefined)) as Record<string, string> | undefined) ?? {}
  const known = saved[item.key]
  if (known !== undefined) return known
  const slug = await craft($, item.topic)
  if (item.key !== '' && slug !== '') {
    await $.store.set('slugs', { ...saved, [item.key]: slug }).catch(() => undefined)
  }
  return slug
}

async function build($: Dollar, arg: string): Promise<string | null> {
  const item = await resolveItem($, arg)
  if (item === null) return null
  const slug = await slugFor($, item)
  return slug === '' ? null : joinTitle(item.key, slug)
}

/** One build per step and argument in a session; a miss is not remembered, so a later try can succeed. */
function titleFor($: Dollar, step: Step, arg: string): Promise<string | null> {
  const id = `${step}\u0000${arg}`
  const held = titles.get(id)
  if (held !== undefined) return held
  const made = build($, arg).catch((err): null => {
    $.ui.log(`rename-session: ${String(err)}`, { to: 'debug' })
    return null
  })
  titles.set(id, made)
  void made.then(t => {
    if (t === null) titles.delete(id)
  })
  return made
}

export const register: Register = on => {
  // A skill the model starts through the Skill tool cannot rename the session; only a submitted
  // prompt can. So the title is worked out now and applied with the next prompt.
  on('skill.prompt', { skill: /(^|:)(intent|spec|plan|build|review)$/ }, ($, e, next) => {
    if (e.pluginName === 'ai-sdlc' || e.skill.startsWith('ai-sdlc:')) {
      const step = e.skill.split(':').pop() as Step
      const arg = argFromSkillText(e.text)
      $.clock.after(0, () => {
        pending = titleFor($, step, arg)
      })
    }
    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const out = await next(e)
    if (out.block !== undefined) return out

    const command = parseCommand(e.prompt)
    const isUser = e.source === undefined || e.source === 'user'
    let title: string | null = null
    if (command !== null) {
      pending = null
      title = await titleFor($, command.step, command.arg)
    } else if (pending !== null && isUser) {
      const waiting = pending
      pending = null
      title = await waiting
    }
    if (title === null || title === current) return out

    current = title
    $.ui.toast(`Session renamed: ${title}`)
    return { ...out, sessionTitle: title }
  }).catch(($, e, next) => next(e))
}
