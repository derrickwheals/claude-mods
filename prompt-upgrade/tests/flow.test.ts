import { describe, expect, test } from 'claude-code/testing'

import { COMPOSER, PANE_PROPS, PRESENTATION, REWRITE_JSON, inOrder, tooWide, world } from './world'

const UPGRADE = (JSON.parse(REWRITE_JSON) as { upgrade: string }).upgrade
const ROUGH = 'write a guide to making sourdough bread'
const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const

const better = (args: string) => ({ command: 'better', args, origin: COMPOSER, presentation: PRESENTATION })
const typed = (text: string, more: Record<string, unknown> = {}) => ({ text, origin: COMPOSER, wait: false, ...more })
const mountArgs = (columns: number) =>
  ({
    plugin: 'prompt-upgrade',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompt-upgrade',
    props: PANE_PROPS(columns),
    viewport: { columns: columns + 10, rows: 40 },
  }) as const

describe('the full flow', () => {
  test('/better to Run: questions, rewrite, review, then the mod sends it and it does not loop back', async ($, on) => {
    const w = world(on)
    await $.session.start(START)

    const answer = await $.command.run(better(ROUGH))
    expect(answer.text).toContain('Upgrading your prompt')

    const ui = await $.ui.mount(mountArgs(80))
    await w.pump()
    expect(await ui.find({ type: 'Text', text: 'Who is this for?' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '0 of 2 answered' })).toBeDefined()

    await ui.press({ key: 'q0o0' })
    await w.pump()
    expect(await ui.find({ type: 'Text', text: '1 of 2 answered' })).toBeDefined()
    await ui.press({ key: 'q1skip' })
    await w.pump()

    expect(w.seen.modelCalls).toEqual(['questions', 'rewrite'])
    expect(w.seen.modelPrompts[1]).toContain('Beginners')
    expect(w.seen.modelPrompts[1]).not.toContain('How long should it be?')

    const order = inOrder(await ui.drawn())
    expect(order.indexOf('button:run')).toBeGreaterThan(-1)
    expect(order.indexOf('button:run')).toBeLessThan(order.indexOf('text:MY PROMPT'))
    expect(order.indexOf('button:run')).toBeLessThan(order.indexOf('text:UPGRADED'))

    await ui.press({ key: 'run' })
    await w.pump()
    expect(w.seen.sent).toEqual([UPGRADE])
    expect(w.seen.modelCalls).toEqual(['questions', 'rewrite'])
    expect(w.seen.closes).toBe(1)
    expect(await ui.find({ type: 'Text', text: /Nothing is open/ })).toBeDefined()
  })

  test('the tracker shows finished steps with a green check and the current step in gold', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.command.run(better(ROUGH))
    const ui = await $.ui.mount(mountArgs(80))
    await w.pump()
    const check = await ui.find({ type: 'Text', text: '✓' })
    expect(check?.props.color).toBe('#3DD68C')
    const now = await ui.find({ type: 'Text', text: ' Questions' })
    expect(now?.props.color).toBe('#F2C46D')
    const later = await ui.find({ type: 'Text', text: ' Review' })
    expect(later?.props.color).toBe('#7D8590')
  })

  test('when no question would help it goes straight to the rewrite', async ($, on) => {
    const w = world(on, { questions: '{"questions":[]}' })
    await $.session.start(START)
    await $.command.run(better(ROUGH))
    const ui = await $.ui.mount(mountArgs(80))
    await w.pump()
    expect(w.seen.modelCalls).toEqual(['questions', 'rewrite'])
    expect(await ui.find({ key: 'run' })).toBeDefined()
  })

  test('Skip the rest, upgrade now leaves skipped questions out of the rewrite', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.command.run(better(ROUGH))
    const ui = await $.ui.mount(mountArgs(80))
    await w.pump()
    await ui.press({ key: 'skip-rest' })
    await w.pump()
    expect(w.seen.modelPrompts[1]).toContain('The person answered no questions.')
    expect(await ui.find({ key: 'run' })).toBeDefined()
  })

  test('the review shows the numbers, what was added, and keeps the buttons above the cards', async ($, on) => {
    const w = world(on, { questions: '{"questions":[]}' })
    await $.session.start(START)
    await $.command.run(better(ROUGH))
    const ui = await $.ui.mount(mountArgs(100))
    await w.pump()
    const order = inOrder(await ui.drawn())
    const has = (part: string) => order.some(row => row.includes(part))
    expect(has('WORDS BEFORE')).toBe(true)
    expect(has('WORDS AFTER')).toBe(true)
    expect(has('DETAILS ADDED')).toBe(true)
    expect(has('text:Audience: beginners')).toBe(true)
    expect(order).toContain('text:Fill in before you run: [audience details]')
    expect(order.indexOf('text:WHAT I ADDED ')).toBeLessThan(order.indexOf('text:MY PROMPT'))
  })

  test('Edit lets the text change and Enter runs it; Copy copies the upgrade', async ($, on) => {
    const w = world(on, { questions: '{"questions":[]}' })
    await $.session.start(START)
    await $.command.run(better(ROUGH))
    const ui = await $.ui.mount(mountArgs(100))
    await w.pump()
    await ui.press({ key: 'copy' })
    await w.pump()
    expect(w.seen.copied).toEqual([UPGRADE])
    await ui.press({ key: 'edit' })
    await w.pump()
    await ui.input({ key: 'edit', text: 'My own better wording', kind: 'change' })
    await ui.input({ key: 'edit', text: 'My own better wording' })
    await w.pump()
    expect(w.seen.sent).toEqual(['My own better wording'])
  })
})

describe('Cancel and the pane closing', () => {
  test('Cancel closes the pane and puts the original prompt back in the prompt box', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.command.run(better(ROUGH))
    const ui = await $.ui.mount(mountArgs(80))
    await w.pump()
    await ui.press({ key: 'cancel' })
    await w.pump()
    expect(w.seen.filled).toEqual([ROUGH])
    expect(w.seen.sent).toEqual([])
    expect(w.seen.closes).toBe(1)
    expect(await ui.find({ type: 'Text', text: /Nothing is open/ })).toBeDefined()
  })

  test('Cancel while the questions are showing also gives the prompt back and asks nothing more', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.command.run(better(ROUGH))
    const ui = await $.ui.mount(mountArgs(80))
    await w.pump()
    await ui.press({ key: 'cancel' })
    await w.pump()
    expect(w.seen.filled).toEqual([ROUGH])
    expect(w.seen.modelCalls).toEqual(['questions'])
  })
})

describe('the automatic mode switch', () => {
  test('/better on catches a typed prompt and /better off lets it through', async ($, on) => {
    const w = world(on)
    await $.session.start(START)

    const turnedOn = await $.command.run(better('on'))
    expect(turnedOn.text).toContain('Automatic mode is on')
    const caught = await $.prompt.submit(typed('plan a three day trip to Lisbon for two people'))
    expect(caught.drop).toBeDefined()
    expect(w.seen.sent).toEqual([])
    await w.pump()
    expect(w.seen.modelCalls).toEqual(['questions'])

    const turnedOff = await $.command.run(better('off'))
    expect(turnedOff.text).toContain('Automatic mode is off')
    const passed = await $.prompt.submit(typed('plan a three day trip to Lisbon for two people'))
    expect(passed.drop).toBeUndefined()
    expect(w.seen.sent).toEqual(['plan a three day trip to Lisbon for two people'])
  })

  test('with automatic mode on, the pass-through prompts are untouched and > is stripped', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.command.run(better('on'))
    await $.prompt.submit(typed('/compact the history please'))
    await $.prompt.submit(typed('describe this picture in detail', { attachments: [{ type: 'image' }] }))
    await $.prompt.submit(typed('also check the other folder too', { turnId: 'turn-9' }))
    await $.prompt.submit(typed('keep going'))
    await $.prompt.submit(typed('> send this exactly as typed'))
    await w.pump()
    expect(w.seen.sent).toEqual([
      '/compact the history please',
      'describe this picture in detail',
      'also check the other folder too',
      'keep going',
      'send this exactly as typed',
    ])
    expect(w.seen.modelCalls).toEqual([])
  })

  test('the mod\'s own send is never caught again', async ($, on) => {
    const w = world(on, { questions: '{"questions":[]}' })
    await $.session.start(START)
    await $.command.run(better('on'))
    await $.prompt.submit(typed(ROUGH))
    const ui = await $.ui.mount(mountArgs(80))
    await w.pump()
    await ui.press({ key: 'run' })
    await w.pump()
    expect(w.seen.sent).toEqual([UPGRADE])
    expect(w.seen.modelCalls).toEqual(['questions', 'rewrite'])
  })

  test('a second typed prompt while the pane is open goes back to the box instead of being lost', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.command.run(better('on'))
    await $.prompt.submit(typed(ROUGH))
    await w.pump()
    const second = await $.prompt.submit(typed('summarise the quarterly sales report for me'))
    expect(second.drop).toBeDefined()
    await w.pump(200)
    expect(w.seen.filled).toEqual(['summarise the quarterly sales report for me'])
  })
})

describe('when the pane cannot open', () => {
  test('a typed prompt in automatic mode is put back in the box with a one-line reason', async ($, on) => {
    const w = world(on, { isPlaced: false })
    await $.session.start(START)
    await $.command.run(better('on'))
    const result = await $.prompt.submit(typed(ROUGH))
    expect(result.drop).toContain('window is too narrow')
    await w.pump(200)
    expect(w.seen.filled).toEqual([ROUGH])
    expect(w.seen.modelCalls).toEqual([])
  })

  test('/better with text puts the words back and says so in one line', async ($, on) => {
    const w = world(on, { isPlaced: false })
    await $.session.start(START)
    await $.command.run(better(ROUGH))
    await w.pump(200)
    expect(w.seen.filled).toEqual([ROUGH])
    expect(w.seen.logs.filter(line => line.includes('too narrow'))).toHaveLength(1)
  })
})

describe('when a model call fails', () => {
  test('shows a calm error card with Try again, Send my original and Cancel', async ($, on) => {
    const w = world(on, { failNext: 'questions' })
    await $.session.start(START)
    await $.command.run(better(ROUGH))
    const ui = await $.ui.mount(mountArgs(80))
    await w.pump()
    expect(await ui.find({ type: 'Text', text: 'Your prompt is safe. Nothing was sent.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /overloaded/ })).toBeDefined()
    expect(await ui.find({ key: 'retry' })).toBeDefined()
    expect(await ui.find({ key: 'send-original' })).toBeDefined()
    expect(await ui.find({ key: 'cancel' })).toBeDefined()

    await ui.press({ key: 'retry' })
    await w.pump()
    expect(await ui.find({ type: 'Text', text: 'Who is this for?' })).toBeDefined()
  })

  test('Send my original sends the prompt as typed', async ($, on) => {
    const w = world(on, { failNext: 'questions' })
    await $.session.start(START)
    await $.command.run(better(ROUGH))
    const ui = await $.ui.mount(mountArgs(80))
    await w.pump()
    await ui.press({ key: 'send-original' })
    await w.pump()
    expect(w.seen.sent).toEqual([ROUGH])
  })

  test('a failed rewrite can be tried again', async ($, on) => {
    const w = world(on, { questions: '{"questions":[]}', failNext: 'rewrite' })
    await $.session.start(START)
    await $.command.run(better(ROUGH))
    const ui = await $.ui.mount(mountArgs(80))
    await w.pump()
    expect(await ui.find({ key: 'retry' })).toBeDefined()
    await ui.press({ key: 'retry' })
    await w.pump()
    expect(await ui.find({ key: 'run' })).toBeDefined()
  })
})

describe('the history', () => {
  test('keeps the last 20, and clicking one reopens its review', async ($, on) => {
    const saved = Array.from({ length: 25 }, (_, i) => ({
      id: `u${i}`,
      at: 1760000000000 + i * 60000,
      original: `rough prompt number ${i}`,
      upgrade: `The upgraded version of prompt number ${i}.`,
      added: ['Audience: everyone'],
      qa: [],
    }))
    const w = world(on, {}, { history: saved })
    await $.session.start(START)
    await $.command.run(better('history'))
    const ui = await $.ui.mount(mountArgs(80))
    await w.pump()
    const rows = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('up:'))
    expect(rows).toHaveLength(20)
    await ui.press({ key: 'up:u3' })
    await w.pump()
    expect(await ui.find({ type: 'Text', text: /The upgraded version/ })).toBeDefined()
    expect(await ui.find({ key: 'run' })).toBeDefined()
  })

  test('a finished upgrade is added to the history', async ($, on) => {
    const w = world(on, { questions: '{"questions":[]}' })
    await $.session.start(START)
    await $.command.run(better(ROUGH))
    await w.pump()
    await $.command.run(better('history'))
    const ui = await $.ui.mount(mountArgs(80))
    await w.pump()
    const rows = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('up:'))
    expect(rows).toHaveLength(1)
  })

  test('/better alone opens a box to type a prompt in', async ($, on) => {
    const w = world(on, { questions: '{"questions":[]}' })
    await $.session.start(START)
    const answer = await $.command.run(better(''))
    expect(answer.text).toContain('Type your rough prompt')
    const ui = await $.ui.mount(mountArgs(80))
    await w.pump()
    await ui.input({ key: 'compose', text: ROUGH })
    await w.pump()
    expect(w.seen.modelCalls).toEqual(['questions', 'rewrite'])
    expect(await ui.find({ key: 'run' })).toBeDefined()
  })
})

describe('every row fits the pane', () => {
  const WIDTHS = [28, 36, 52, 64, 100, 160]

  test('at a narrow width and a wide one, on the terminal and the desktop', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.command.run(better('write a guide to making sourdough bread for people who have never baked before and are a bit nervous'))
    await w.pump()
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const width of WIDTHS) {
        const ui = await $.ui.mount({ ...mountArgs(width), surface })
        expect(tooWide(await ui.drawn(), width)).toEqual([])
        await ui.unmount()
      }
    }
  })

  test('the review, the error card, the history and the compose box fit too', async ($, on) => {
    const w = world(on, { questions: '{"questions":[]}' })
    await $.session.start(START)
    await $.command.run(better('write a guide to making sourdough bread for people who have never baked before and are a bit nervous'))
    await w.pump()
    for (const width of WIDTHS) {
      const ui = await $.ui.mount(mountArgs(width))
      expect(tooWide(await ui.drawn(), width)).toEqual([])
      await ui.press({ key: 'edit' })
      await w.pump()
      expect(tooWide(await ui.drawn(), width)).toEqual([])
      await ui.unmount()
    }
    w.how.failNext = 'questions'
    await $.command.run(better('another rough prompt that fails'))
    await w.pump()
    for (const width of WIDTHS) {
      const ui = await $.ui.mount(mountArgs(width))
      expect(tooWide(await ui.drawn(), width)).toEqual([])
      await ui.unmount()
    }
    await $.command.run(better('history'))
    await w.pump()
    for (const width of WIDTHS) {
      const ui = await $.ui.mount(mountArgs(width))
      expect(tooWide(await ui.drawn(), width)).toEqual([])
      await ui.unmount()
    }
    await $.command.run(better(''))
    await w.pump()
    for (const width of WIDTHS) {
      const ui = await $.ui.mount(mountArgs(width))
      expect(tooWide(await ui.drawn(), width)).toEqual([])
      await ui.unmount()
    }
  })
})
