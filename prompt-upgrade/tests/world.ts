import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

export const QUESTIONS_JSON = JSON.stringify({
  questions: [
    { q: 'Who is this for?', options: ['Beginners', 'Experts', 'Kids'] },
    { q: 'How long should it be?', options: ['One page', 'Five pages'] },
  ],
})

export const REWRITE_JSON = JSON.stringify({
  upgrade:
    'Write a short, friendly guide to making sourdough bread for complete beginners, as one page of plain steps, and finish when a first-time baker could follow it without help. Aim it at [audience details].',
  added: ['Audience: beginners', 'Format: one page of steps', 'Done: a first-time baker can follow it'],
})

const NO_USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

export type Behaviour = {
  questions: string
  rewrite: string
  /** When set, the next model call of that kind fails once. */
  failNext: 'questions' | 'rewrite' | null
  isPlaced: boolean
}

/** Stands in for the engine beneath the mod: the model, the pane, the prompt box and the clipboard. */
export function world(on: On, change: Partial<Behaviour> = {}, saved: Record<string, unknown> = {}) {
  const clock = mock.clock(on)
  mock.store(on, saved)
  const how: Behaviour = {
    questions: QUESTIONS_JSON,
    rewrite: REWRITE_JSON,
    failNext: null,
    isPlaced: true,
    ...change,
  }
  const seen = {
    filled: [] as string[],
    sent: [] as string[],
    modelCalls: [] as string[],
    modelPrompts: [] as string[],
    copied: [] as string[],
    logs: [] as string[],
    closes: 0,
  }

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('model.complete', (_$, e) => {
    const kind = (e.system ?? '').startsWith('You help turn') ? 'questions' : 'rewrite'
    seen.modelCalls.push(kind)
    seen.modelPrompts.push(e.prompt)
    if (how.failNext === kind) {
      how.failNext = null
      return {
        value: { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded' as const, usage: NO_USAGE },
      }
    }
    return { value: { isAnswered: true as const, text: kind === 'questions' ? how.questions : how.rewrite, usage: NO_USAGE } }
  })
  on('ui.open', () => ({
    value: how.isPlaced ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'The window is too narrow.' },
  }))
  on('ui.close', () => {
    seen.closes += 1
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [{ id: 'prompt-upgrade', title: 'Prompt Upgrade', isShown: true, isFocused: true, isPlaced: true }],
  }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('prompt.fill', (_$, e) => {
    seen.filled.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', (_$, e) => {
    seen.sent.push(e.text)
    return { text: e.text }
  })
  on('ui.copy', (_$, e) => {
    seen.copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('ui.log', (_$, e) => {
    seen.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))

  /** Lets timers due now run and everything they started settle. */
  const pump = async (ms = 0) => {
    for (let i = 0; i < 4; i++) await clock.advance(ms)
  }

  return { clock, how, seen, pump }
}

export const PANE_PROPS = (columns: number) =>
  ({
    title: 'Prompt Upgrade',
    isFocused: true,
    bodyColumns: columns,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  }) as const

export const COMPOSER = { kind: 'composer' } as const
export const PRESENTATION = { isFullscreen: true, columns: 120 } as const

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

function texts(n: unknown): string {
  if (typeof n === 'string') return n
  if (typeof n !== 'object' || n === null) return ''
  return ((n as Node).children ?? []).map(texts).join('')
}

function pad(n: Node): number {
  const p = n.props ?? {}
  const px = typeof p.paddingX === 'number' ? p.paddingX * 2 : 0
  const pl = typeof p.paddingLeft === 'number' ? p.paddingLeft : 0
  const border = typeof p.borderStyle === 'string' ? 2 : 0
  return px + pl + border
}

function natural(n: unknown): number {
  if (typeof n === 'string') return n.length
  if (typeof n !== 'object' || n === null) return 0
  const node = n as Node
  if (node.type === 'Box') {
    const p = node.props ?? {}
    if (typeof p.width === 'number') return p.width
    const kids = (node.children ?? []).map(natural)
    const gap = typeof p.gap === 'number' ? p.gap : 0
    const inner = p.flexDirection === 'column' ? Math.max(0, ...kids) : kids.reduce((a, b) => a + b, 0) + gap * Math.max(0, kids.length - 1)
    return inner + pad(node)
  }
  if (node.type === 'Input') return 0
  return texts(node).length
}

/** Walks a drawn tree and lists every row that is wider than the room it sits in. */
export function tooWide(root: unknown, width: number): string[] {
  const found: string[] = []
  const visit = (n: unknown, room: number) => {
    if (typeof n !== 'object' || n === null) return
    const node = n as Node
    if (node.type !== 'Box') return
    const p = node.props ?? {}
    const own = typeof p.width === 'number' ? p.width : room
    const inner = own - pad({ props: { ...p, paddingLeft: 0 } })
    const kids = node.children ?? []
    const gap = typeof p.gap === 'number' ? p.gap : 0
    const sum = kids.map(natural).reduce((a, b) => a + b, 0) + gap * Math.max(0, kids.length - 1)
    if (p.flexDirection === 'column') {
      for (const k of kids) if (natural(k) > inner) found.push(`${natural(k)} > ${inner}: ${texts(k).slice(0, 50)}`)
    } else if (sum > inner) {
      found.push(`${sum} > ${inner}: ${texts(node).slice(0, 50)}`)
    }
    for (const k of kids) visit(k, inner)
  }
  visit(root, width)
  return found
}

/** Every Button key and text in the order the tree draws them. */
export function inOrder(root: unknown): string[] {
  const out: string[] = []
  const visit = (n: unknown) => {
    if (typeof n === 'string') return
    if (typeof n !== 'object' || n === null) return
    const node = n as Node
    if (node.type === 'Button') out.push(`button:${String(node.props?.key)}`)
    else if (node.type === 'Text') out.push(`text:${texts(node)}`)
    for (const k of node.children ?? []) visit(k)
  }
  visit(root)
  return out
}
