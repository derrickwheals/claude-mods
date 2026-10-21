import { expect, test } from 'claude-code/testing'

import { START, intent, todoistReply, world } from './world'

const CHANGE = '2026-10-21-rename-session'
const FILE = `/repo/docs/changes/${CHANGE}/intent.md`
const typed = (prompt: string, more: Record<string, unknown> = {}) => ({ prompt, source: 'user' as const, ...more })

test('a typed step with a change id takes the key from the intent and the slug from the model', async ($, on) => {
  const w = world(on, { files: { [FILE]: intent(CHANGE, 'Rename session from backlog item', 'SKL-001 (https://app.todoist.com/app/task/abc)') } })
  await $.session.start(START)

  const out = await $.classic.UserPromptSubmit(typed(`/ai-sdlc:plan ${CHANGE}`))

  expect(out.sessionTitle).toBe('SKL-001_mod_rename_session')
  expect(w.seen.modelPrompts).toEqual(['Rename session from backlog item'])
  expect(w.seen.toasts).toEqual(['Session renamed: SKL-001_mod_rename_session'])
})

test('a backlog key alone is looked up in Todoist when no intent links it', async ($, on) => {
  const w = world(on, { todoist: todoistReply('SKL-001 — Rename session from backlog item'), slug: 'rename_session' })
  await $.session.start(START)

  const out = await $.classic.UserPromptSubmit(typed('/ai-sdlc:intent SKL-001'))

  expect(out.sessionTitle).toBe('SKL-001_rename_session')
  expect(w.seen.todoistCalls).toEqual(['SKL-001'])
  expect(w.seen.modelPrompts).toEqual(['Rename session from backlog item'])
})

test('a backlog key is matched to the change that links it before Todoist is asked', async ($, on) => {
  const w = world(on, { files: { [FILE]: intent(CHANGE, 'Rename session from backlog item', 'SKL-001') } })
  await $.session.start(START)

  const out = await $.classic.UserPromptSubmit(typed('/ai-sdlc:spec SKL-001'))

  expect(out.sessionTitle).toBe('SKL-001_mod_rename_session')
  expect(w.seen.todoistCalls).toEqual([])
})

test('with no argument the build step reads the change from the branch', async ($, on) => {
  world(on, {
    files: { '/repo/.git/HEAD': `ref: refs/heads/change/${CHANGE}\n`, [FILE]: intent(CHANGE, 'Rename session', 'SKL-001') },
  })
  await $.session.start(START)

  expect((await $.classic.UserPromptSubmit(typed('/ai-sdlc:build'))).sessionTitle).toBe('SKL-001_mod_rename_session')
})

test('with no argument and no change branch nothing is renamed', async ($, on) => {
  world(on, { files: { '/repo/.git/HEAD': 'ref: refs/heads/main\n' } })
  await $.session.start(START)

  expect((await $.classic.UserPromptSubmit(typed('/ai-sdlc:review'))).sessionTitle).toBeUndefined()
})

test('a free-text intent with no key gets a slug alone, from the fallback when the model fails', async ($, on) => {
  world(on, { slug: null })
  await $.session.start(START)

  const out = await $.classic.UserPromptSubmit(typed('/ai-sdlc:intent Rename the session when a step starts'))

  expect(out.sessionTitle).toBe('rename_session_step_starts')
})

test('Todoist being down still gives a title from the key and the words typed', async ($, on) => {
  world(on, { todoist: null, slug: null })
  await $.session.start(START)

  const out = await $.classic.UserPromptSubmit(typed('/ai-sdlc:intent SKL-009 tidy the exporter'))

  expect(out.sessionTitle).toBe('SKL-009_tidy_exporter')
})

test('the same item keeps the slug it was first given, in any later session', async ($, on) => {
  const w = world(on, { slug: 'new_slug' }, { slugs: { 'SKL-001': 'mod_rename_session' } })
  await $.session.start(START)

  const out = await $.classic.UserPromptSubmit(typed('/ai-sdlc:intent SKL-001 anything'))

  expect(out.sessionTitle).toBe('SKL-001_mod_rename_session')
  expect(w.seen.modelPrompts).toEqual([])
})

test('a step the model starts renames the session at the next prompt, once', async ($, on) => {
  const w = world(on, { files: { [FILE]: intent(CHANGE, 'Rename session', 'SKL-001') } })
  await $.session.start(START)

  await $.skill.prompt({ skill: 'ai-sdlc:plan', pluginName: 'ai-sdlc', text: `# Plan\n\nChange: ${CHANGE}\n` })
  await w.clock.settle()

  expect((await $.classic.UserPromptSubmit(typed('yes, go ahead'))).sessionTitle).toBe('SKL-001_mod_rename_session')
  expect((await $.classic.UserPromptSubmit(typed('and another thing'))).sessionTitle).toBeUndefined()
})

test('other prompts, other skills and machine prompts leave the title alone', async ($, on) => {
  const w = world(on, { files: { [FILE]: intent(CHANGE, 'Rename session', 'SKL-001') } })
  await $.session.start(START)

  expect((await $.classic.UserPromptSubmit(typed('hello'))).sessionTitle).toBeUndefined()
  expect((await $.classic.UserPromptSubmit(typed('/ai-sdlc:status'))).sessionTitle).toBeUndefined()

  await $.skill.prompt({ skill: 'commit', text: `Change: ${CHANGE}` })
  await $.skill.prompt({ skill: 'ai-sdlc:plan', pluginName: 'ai-sdlc', text: `Change: ${CHANGE}` })
  await w.clock.settle()
  expect((await $.classic.UserPromptSubmit({ prompt: 'task finished', source: 'system' })).sessionTitle).toBeUndefined()
})

test('a bare key with no title anywhere renames to the key alone and asks the model for nothing', async ($, on) => {
  const w = world(on, { todoist: todoistReply('SKL-002 — Something else') })
  await $.session.start(START)

  const out = await $.classic.UserPromptSubmit(typed('/ai-sdlc:plan SKL-001'))

  expect(out.sessionTitle).toBe('SKL-001')
  expect(w.seen.modelPrompts).toEqual([])
})
