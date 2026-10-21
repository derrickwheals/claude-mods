import { describe, expect, test } from 'claude-code/testing'

import {
  argFromSkillText,
  branchChange,
  cleanSlug,
  findChangeId,
  findKey,
  frontmatter,
  joinTitle,
  parseCommand,
  slugify,
  todoistTopic,
} from '../hooks/logic'

describe('which prompts start a step', () => {
  test('a typed ai-sdlc step gives its name and argument', () => {
    expect(parseCommand('/ai-sdlc:intent SKL-001')).toEqual({ step: 'intent', arg: 'SKL-001' })
    expect(parseCommand('  /ai-sdlc:plan 2026-10-21-foo  ')).toEqual({ step: 'plan', arg: '2026-10-21-foo' })
    expect(parseCommand('/ai-sdlc:build')).toEqual({ step: 'build', arg: '' })
  })

  test('steps that are not about one item, and other prompts, are left alone', () => {
    expect(parseCommand('/ai-sdlc:status')).toBeNull()
    expect(parseCommand('/ai-sdlc:adopt')).toBeNull()
    expect(parseCommand('/ai-sdlc:planning x')).toBeNull()
    expect(parseCommand('please /ai-sdlc:plan x')).toBeNull()
    expect(parseCommand('/intent x')).toBeNull()
  })

  test('the skill text echoes its argument on the Input or Change line', () => {
    expect(argFromSkillText('# Stage 1\n\nInput: DW-006 images\n\n## Steps')).toBe('DW-006 images')
    expect(argFromSkillText('Change: 2026-10-21-foo')).toBe('2026-10-21-foo')
    expect(argFromSkillText('Change: $ARGUMENTS')).toBe('')
    expect(argFromSkillText('nothing here')).toBe('')
  })
})

describe('finding the item', () => {
  test('keys and change ids', () => {
    expect(findKey('start on SKL-001 now')).toBe('SKL-001')
    expect(findKey('DW-006 (https://app.todoist.com/app/task/x)')).toBe('DW-006')
    expect(findKey('utf-8 and v1-2')).toBe('')
    expect(findChangeId('docs/changes/2026-10-21-rename-session/intent.md')).toBe('2026-10-21-rename-session')
    expect(findChangeId('YYYY-MM-DD-slug')).toBe('')
  })

  test('frontmatter reads plain key: value lines', () => {
    expect(frontmatter('---\nid: a\ntitle: "Quoted: yes"\nbacklog:\n---\n# x')).toEqual({ id: 'a', title: 'Quoted: yes', backlog: '' })
    expect(frontmatter('# no frontmatter')).toEqual({})
  })

  test('the branch names the change', () => {
    expect(branchChange('ref: refs/heads/change/2026-10-21-rename-session\n')).toBe('2026-10-21-rename-session')
    expect(branchChange('ref: refs/heads/main\n')).toBe('')
    expect(branchChange('3f2a9c0')).toBe('')
  })

  test('the Todoist title is the text after the key, and not a longer key that starts the same', () => {
    const reply = JSON.stringify({ tasks: [{ content: 'SKL-0010 — Other' }, { content: 'SKL-001 — Rename the session' }] })
    expect(todoistTopic(reply, 'SKL-001')).toBe('Rename the session')
    expect(todoistTopic(reply, 'SKL-002')).toBe('')
    expect(todoistTopic('not json', 'SKL-001')).toBe('')
  })
})

describe('the slug', () => {
  test('a model reply is cut to lowercase words joined by underscores', () => {
    expect(cleanSlug('mod_rename_session')).toBe('mod_rename_session')
    expect(cleanSlug('`Mod Rename-Session`\nBecause it...')).toBe('mod_rename_session')
    expect(cleanSlug('one two three four five six seven')).toBe('one_two_three_four_five')
    expect(cleanSlug('   ')).toBe('')
  })

  test('the fallback keeps the first meaningful words and drops the key', () => {
    expect(slugify('SKL-001 — Rename the session when a step starts')).toBe('rename_session_step_starts')
    expect(slugify('the of and')).toBe('the_of_and')
    expect(slugify('')).toBe('')
    expect(slugify('a'.repeat(100)).length).toBeLessThanOrEqual(20)
  })

  test('the title is the key, an underscore and the slug', () => {
    expect(joinTitle('SKL-001', 'mod_rename_session')).toBe('SKL-001_mod_rename_session')
    expect(joinTitle('', 'mod_rename_session')).toBe('mod_rename_session')
    expect(joinTitle('SKL-001', '')).toBe('SKL-001')
  })
})
