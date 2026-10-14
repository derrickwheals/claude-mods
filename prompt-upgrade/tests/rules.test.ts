import { describe, expect, test } from 'claude-code/testing'

import type { Flow } from '../types'
import {
  bigNumber,
  blankFlow,
  classify,
  cleanHistory,
  layoutRows,
  parseQuestions,
  parseRewrite,
  resumePlan,
  wrapText,
} from '../hooks/logic'

const typed = (text: string, more: Record<string, unknown> = {}) => ({
  text,
  origin: { kind: 'composer' },
  wait: false,
  ...more,
})

describe('which prompts are caught', () => {
  test('a normal typed prompt is caught when automatic mode is on', () => {
    expect(classify(typed('write a post about our new bakery opening'), true)).toEqual({
      kind: 'intercept',
      text: 'write a post about our new bakery opening',
    })
  })

  test('nothing is caught when automatic mode is off', () => {
    expect(classify(typed('write a post about our new bakery opening'), false)).toEqual({ kind: 'pass' })
  })

  test('slash commands, attachments and mid-turn messages go straight through', () => {
    expect(classify(typed('/compact the history please'), true)).toEqual({ kind: 'pass' })
    expect(classify(typed('describe this picture in detail', { attachments: [{ type: 'image' }] }), true)).toEqual({
      kind: 'pass',
    })
    expect(classify(typed('also check the other folder too', { turnId: 'turn-4' }), true)).toEqual({ kind: 'pass' })
    expect(classify(typed('also check the other folder too', { wait: true }), true)).toEqual({ kind: 'pass' })
  })

  test('short replies go straight through', () => {
    for (const reply of ['yes', 'No', 'keep going', 'go ahead', 'sounds good to me', 'ok thanks', '2', 'Yes!']) {
      expect(classify(typed(reply), true)).toEqual({ kind: 'pass' })
    }
  })

  test('a leading > is stripped and the prompt is sent as it is', () => {
    expect(classify(typed('> just send this exactly as written'), true)).toEqual({
      kind: 'strip',
      text: 'just send this exactly as written',
    })
    expect(classify(typed('>'), true)).toEqual({ kind: 'pass' })
  })

  test('anything that did not come from the prompt box is never caught, including the mod itself', () => {
    const own = { text: 'write a post about our new bakery opening', origin: { kind: 'plugin' }, wait: false }
    expect(classify(own, true)).toEqual({ kind: 'pass' })
    expect(classify({ ...own, origin: { kind: 'task-notification' } }, true)).toEqual({ kind: 'pass' })
    expect(classify({ ...own, origin: { kind: 'sdk' } }, true)).toEqual({ kind: 'pass' })
  })
})

describe('reading the questions', () => {
  test('keeps up to three questions with two to four options', () => {
    const raw = JSON.stringify({
      questions: [
        { q: 'One?', options: ['a', 'b', 'c', 'd', 'e'] },
        { q: 'Two?', options: ['a', 'b'] },
        { q: 'Three?', options: ['x', 'y', 'z'] },
        { q: 'Four?', options: ['x', 'y'] },
      ],
    })
    const questions = parseQuestions(raw)
    expect(questions).toHaveLength(3)
    expect(questions[0]?.options).toEqual(['a', 'b', 'c', 'd'])
  })

  test('drops a question with fewer than two usable options, repeats, or its own Other and Skip', () => {
    const raw = JSON.stringify({
      questions: [
        { q: 'Only one?', options: ['a'] },
        { q: 'Repeats?', options: ['A', 'a', 'b', 'Other', 'Skip'] },
        { q: '', options: ['x', 'y'] },
      ],
    })
    expect(parseQuestions(raw)).toEqual([{ text: 'Repeats?', options: ['A', 'b'] }])
  })

  test('reads a reply wrapped in a code fence and shrugs off prose', () => {
    const fenced = '```json\n{"questions":[{"q":"Who?","options":["me","you"]}]}\n```'
    expect(parseQuestions(fenced)).toHaveLength(1)
    expect(parseQuestions('I would ask about the audience.')).toEqual([])
    expect(parseQuestions('{"questions":[]}')).toEqual([])
  })
})

describe('reading the rewrite', () => {
  test('returns one paragraph and a short list of what was added', () => {
    const raw = JSON.stringify({ upgrade: 'Line one.\n\nLine   two.', added: ['Audience: kids', '', 'Format: list'] })
    expect(parseRewrite(raw)).toEqual({ upgrade: 'Line one. Line two.', added: ['Audience: kids', 'Format: list'] })
  })

  test('caps the list at eight and returns null when there is nothing usable', () => {
    const many = JSON.stringify({ upgrade: 'ok', added: Array.from({ length: 12 }, (_, i) => `item ${i}`) })
    expect(parseRewrite(many)?.added).toHaveLength(8)
    expect(parseRewrite('not json at all')).toBeNull()
    expect(parseRewrite('{"upgrade":"   "}')).toBeNull()
    expect(parseRewrite('{"added":["x"]}')).toBeNull()
  })
})

describe('layout helpers', () => {
  test('big numbers are three rows tall and every row is the same width', () => {
    for (const n of [0, 7, 42, 305, 1280]) {
      const rows = bigNumber(n)
      expect(rows).toHaveLength(3)
      const digits = String(n).length
      for (const row of rows) expect(row.length).toBe(digits * 3 + (digits - 1))
    }
  })

  test('wrapped text never runs past the width', () => {
    const rows = wrapText('one two three four five six seven eight nine ten eleven twelve thirteen', 16)
    for (const row of rows) expect(row.length <= 16).toBe(true)
    expect(wrapText('supercalifragilisticexpialidocious', 10).every(row => row.length <= 10)).toBe(true)
  })

  test('chips flow onto new rows instead of overflowing', () => {
    expect(layoutRows([10, 10, 10], 25, 1)).toEqual([[0, 1], [2]])
    expect(layoutRows([30], 20, 1)).toEqual([[0]])
  })
})

describe('saved data and reloads', () => {
  test('keeps only the last twenty well-formed upgrades', () => {
    const raw = [
      ...Array.from({ length: 25 }, (_, i) => ({ id: `u${i}`, at: i, original: 'a', upgrade: 'b', added: [], qa: [] })),
      { nonsense: true },
    ]
    expect(cleanHistory(raw)).toHaveLength(20)
    expect(cleanHistory('nope')).toEqual([])
  })

  test('after a reload a half-finished step is picked back up, and a flow with no pane gives the prompt back', () => {
    const flow = (step: Flow['step']): Flow => ({ ...blankFlow('x', 'command'), step, original: 'my prompt' })
    expect(resumePlan(null, true)).toBe('none')
    expect(resumePlan(flow('reading'), true)).toBe('reading')
    expect(resumePlan(flow('rewrite'), true)).toBe('rewrite')
    expect(resumePlan(flow('questions'), true)).toBe('none')
    expect(resumePlan(flow('review'), true)).toBe('none')
    expect(resumePlan(flow('rewrite'), false)).toBe('give-back')
  })
})
