import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, UiOpenResult, UiPressArgument } from 'claude-code'

import type { Answer, Flow, Step, Upgrade } from '../types'
import {
  CALL_TIMEOUT_MS,
  HISTORY_MAX,
  MIN_WIDTH,
  MODEL,
  NARROW_LINE,
  PANE,
  QUESTIONS_SYSTEM,
  REWRITE_SYSTEM,
  blankFlow,
  classify,
  cleanHistory,
  describeFailure,
  parseQuestions,
  parseRewrite,
  qaOf,
  questionsPrompt,
  resumePlan,
  reviewFlow,
  rewritePrompt,
} from './logic'
import { drawPane } from './view'
import type { Actions } from './view'

type Dollar = EngineInterface

const flowRef = atom({ plugin: 'prompt-upgrade', key: 'flow' } as const, null)
const historyRef = atom({ plugin: 'prompt-upgrade', key: 'history' } as const, [])
const bypassRef = atom({ plugin: 'prompt-upgrade', key: 'bypass' } as const, null)

const FAIL_LINE = 'Prompt Upgrade hit a problem and did nothing. Your prompt is untouched.'

// The module's own variables start over on a reload, so nothing here is state the pane draws from.
let stop: AbortController | null = null
let counter = 0
const running = new Set<string>()

function claim(key: string): boolean {
  if (running.has(key)) return false
  running.add(key)
  return true
}

/** Runs work outside the current dispatch, so a slow model call never holds a hook open. */
function later($: Dollar, work: () => Promise<void>, ms: number = 0): void {
  $.clock.after(ms, () => {
    work().catch(err => $.ui.log(`prompt-upgrade: ${String(err)}`, { to: 'debug' }))
  })
}

// ---------------------------------------------------------------------------
// State changes (never called while drawing)
// ---------------------------------------------------------------------------

function patch($: Dollar, id: string, change: Partial<Flow>): Promise<unknown> {
  return update($, flowRef, f => (f !== null && f.id === id ? { ...f, ...change } : f))
}

async function begin($: Dollar, source: Flow['source'], step: Step, original: string): Promise<string> {
  stop?.abort()
  stop = null
  counter += 1
  const id = `${await $.clock.now()}-${counter}`
  await update($, flowRef, () => ({ ...blankFlow(id, source), step, original }))
  return id
}

async function remember($: Dollar, entry: Upgrade): Promise<void> {
  const current = await read($, historyRef)
  const list = [entry, ...current.filter(x => x.id !== entry.id)].slice(0, HISTORY_MAX)
  await update($, historyRef, () => list)
  try {
    await $.store.set('history', list)
  } catch (err) {
    $.ui.log(`prompt-upgrade: could not save history: ${String(err)}`, { to: 'debug' })
  }
}

/** Puts a prompt back in the prompt box. If the box cannot take it, the words go to the transcript instead. */
async function putBack($: Dollar, text: string): Promise<void> {
  if (text.trim() === '') return
  let isFilled = false
  try {
    isFilled = (await $.prompt.fill({ text, mode: 'replace' })).isFilled
  } catch {
    isFilled = false
  }
  if (!isFilled) $.ui.log(`Prompt Upgrade could not refill the prompt box. Your prompt: ${text}`)
}

async function closePane($: Dollar): Promise<void> {
  try {
    await $.ui.close({ id: PANE })
  } catch (err) {
    $.ui.log(`prompt-upgrade: close: ${String(err)}`, { to: 'debug' })
  }
}

// ---------------------------------------------------------------------------
// The steps
// ---------------------------------------------------------------------------

type Asked = { ok: true; text: string } | { ok: false; message: string }

async function ask($: Dollar, system: string, prompt: string, maxTokens: number): Promise<Asked> {
  const control = new AbortController()
  stop = control
  try {
    const r = await $.model.complete(
      { model: MODEL, system, prompt, maxTokens, effort: 'low', timeoutMs: CALL_TIMEOUT_MS },
      { signal: control.signal },
    )
    return r.isAnswered ? { ok: true, text: r.text } : { ok: false, message: describeFailure(r) }
  } catch {
    return { ok: false, message: 'The model could not be reached.' }
  } finally {
    if (stop === control) stop = null
  }
}

function fail($: Dollar, id: string, step: 'reading' | 'rewrite', message: string): Promise<unknown> {
  return patch($, id, { step: 'error', failedStep: step, error: message })
}

async function stillAt($: Dollar, id: string, step: Step): Promise<Flow | null> {
  const f = await read($, flowRef)
  return f !== null && f.id === id && f.step === step ? f : null
}

async function readQuestions($: Dollar, id: string): Promise<void> {
  const key = `${id}:reading`
  if (!claim(key)) return
  try {
    const f = await stillAt($, id, 'reading')
    if (f === null) return
    const asked = await ask($, QUESTIONS_SYSTEM, questionsPrompt(f.original), 700)
    if ((await stillAt($, id, 'reading')) === null) return
    if (!asked.ok) {
      await fail($, id, 'reading', asked.message)
      return
    }
    const questions = parseQuestions(asked.text)
    if (questions.length === 0) {
      await patch($, id, { step: 'rewrite', questions: [], answers: [] })
      await writeRewrite($, id)
      return
    }
    await patch($, id, { step: 'questions', questions, answers: questions.map(() => null), otherOpen: null })
  } finally {
    running.delete(key)
  }
}

async function writeRewrite($: Dollar, id: string): Promise<void> {
  const key = `${id}:rewrite`
  if (!claim(key)) return
  try {
    const f = await stillAt($, id, 'rewrite')
    if (f === null) return
    const qa = qaOf(f)
    const asked = await ask($, REWRITE_SYSTEM, rewritePrompt(f.original, qa), 1500)
    if ((await stillAt($, id, 'rewrite')) === null) return
    if (!asked.ok) {
      await fail($, id, 'rewrite', asked.message)
      return
    }
    const parsed = parseRewrite(asked.text)
    if (parsed === null) {
      await fail($, id, 'rewrite', describeFailure({ reason: 'unreadable' }))
      return
    }
    await patch($, id, {
      step: 'review',
      upgrade: parsed.upgrade,
      added: parsed.added,
      draft: parsed.upgrade,
      isEditing: false,
      isCopied: false,
      failedStep: null,
      error: '',
    })
    await remember($, {
      id,
      at: await $.clock.now(),
      original: f.original,
      upgrade: parsed.upgrade,
      added: parsed.added,
      qa,
    })
  } finally {
    running.delete(key)
  }
}

/** Opens the pane's first step once the pane is up; gives the prompt back if no surface could draw it. */
async function settle(
  $: Dollar,
  opened: Promise<UiOpenResult>,
  id: string,
  original: string,
  first: 'reading' | 'none',
): Promise<boolean> {
  let isPlaced = false
  try {
    isPlaced = (await opened).isPlaced
  } catch {
    isPlaced = false
  }
  if (isPlaced) {
    if (first === 'reading') later($, () => readQuestions($, id))
    return true
  }
  await update($, flowRef, f => (f !== null && f.id === id ? null : f))
  await closePane($)
  later($, () => putBack($, original), 150)
  return false
}

const openPane = ($: Dollar): Promise<UiOpenResult> =>
  $.ui.open({ id: PANE, title: 'Prompt Upgrade', focus: true, closeOnEscape: true })

// ---------------------------------------------------------------------------
// What the buttons do
// ---------------------------------------------------------------------------

/** Sends a prompt as the person's own words. The mod's own send can never come back into the pane. */
async function send($: Dollar, text: string): Promise<void> {
  await update($, bypassRef, () => text)
  stop?.abort()
  stop = null
  await update($, flowRef, () => null)
  await closePane($)
  try {
    await $.prompt.submit({ text, asUser: true })
  } catch {
    await putBack($, text)
    $.ui.log('Prompt Upgrade could not send the prompt, so it is back in the prompt box.')
  } finally {
    await update($, bypassRef, () => null)
  }
}

async function answer($: Dollar, index: number, a: Answer): Promise<void> {
  const f = await read($, flowRef)
  if (f === null || f.step !== 'questions' || index < 0 || index >= f.questions.length) return
  const answers = f.answers.map((x, i) => (i === index ? a : x))
  const isDone = answers.every(x => x !== null)
  await patch($, f.id, { answers, otherOpen: null, step: isDone ? 'rewrite' : 'questions' })
  if (isDone) later($, () => writeRewrite($, f.id))
}

async function skipRest($: Dollar): Promise<void> {
  const f = await read($, flowRef)
  if (f === null || f.step !== 'questions') return
  const skipped: Answer = { kind: 'skip', text: '' }
  await patch($, f.id, { answers: f.answers.map(x => x ?? skipped), otherOpen: null, step: 'rewrite' })
  later($, () => writeRewrite($, f.id))
}

async function composeSubmit($: Dollar, raw: string): Promise<void> {
  const f = await read($, flowRef)
  const text = raw.trim()
  if (f === null || f.step !== 'compose' || text === '') return
  await patch($, f.id, { original: text, step: 'reading' })
  later($, () => readQuestions($, f.id))
}

async function toggleEdit($: Dollar): Promise<void> {
  const f = await read($, flowRef)
  if (f === null || f.step !== 'review') return
  if (!f.isEditing) {
    await patch($, f.id, { isEditing: true, draft: f.upgrade, isCopied: false })
    return
  }
  const text = f.draft.replace(/\s+/g, ' ').trim()
  await patch($, f.id, { isEditing: false, upgrade: text === '' ? f.upgrade : text, isCopied: false })
}

async function copyUpgrade($: Dollar, press: UiPressArgument): Promise<void> {
  const f = await read($, flowRef)
  if (f === null || f.step !== 'review') return
  const result = await $.ui.copy({ text: f.isEditing ? f.draft : f.upgrade, surface: press.surface })
  if (result.isCopied) await patch($, f.id, { isCopied: true })
  else $.ui.toast('Prompt Upgrade could not copy to the clipboard.')
}

async function runUpgrade($: Dollar, given?: string): Promise<void> {
  const f = await read($, flowRef)
  if (f === null || f.step !== 'review') return
  const text = (given ?? (f.isEditing ? f.draft : f.upgrade)).replace(/\s+/g, ' ').trim() || f.upgrade
  if (text !== f.upgrade) {
    const list = (await read($, historyRef)).map(x => (x.id === f.id ? { ...x, upgrade: text } : x))
    await update($, historyRef, () => list)
    try {
      await $.store.set('history', list)
    } catch {
      // The upgrade still runs; only the saved copy keeps the older wording.
    }
  }
  await send($, text)
}

async function cancelUpgrade($: Dollar): Promise<void> {
  const f = await read($, flowRef)
  stop?.abort()
  stop = null
  await update($, flowRef, () => null)
  await closePane($)
  if (f !== null && f.step !== 'history' && f.step !== 'compose') await putBack($, f.original)
}

async function retryStep($: Dollar): Promise<void> {
  const f = await read($, flowRef)
  if (f === null || f.step !== 'error' || f.failedStep === null) return
  const step = f.failedStep
  await patch($, f.id, { step, failedStep: null, error: '' })
  later($, () => (step === 'reading' ? readQuestions($, f.id) : writeRewrite($, f.id)))
}

async function sendOriginal($: Dollar): Promise<void> {
  const f = await read($, flowRef)
  if (f === null || f.original.trim() === '') return
  await send($, f.original)
}

async function openUpgrade($: Dollar, id: string): Promise<void> {
  const u = (await read($, historyRef)).find(x => x.id === id)
  if (u === undefined) return
  await update($, flowRef, () => reviewFlow(u.id, u))
}

function makeActions($: Dollar): Actions {
  const guarded = (work: () => Promise<unknown>): void => {
    work().catch(err => {
      $.ui.log(`prompt-upgrade: ${String(err)}`, { to: 'debug' })
      $.ui.toast('Prompt Upgrade hit a problem. Your prompt is safe.')
    })
  }
  return {
    pickOption: (question, text) => guarded(() => answer($, question, { kind: 'option', text })),
    pickOther: question =>
      guarded(() => update($, flowRef, f => (f !== null && f.step === 'questions' ? { ...f, otherOpen: question } : f))),
    submitOther: (question, text) =>
      guarded(() =>
        text.trim() === ''
          ? update($, flowRef, f => (f !== null ? { ...f, otherOpen: null } : f))
          : answer($, question, { kind: 'other', text: text.trim() }),
      ),
    skipQuestion: question => guarded(() => answer($, question, { kind: 'skip', text: '' })),
    skipRest: () => guarded(() => skipRest($)),
    compose: text => guarded(() => composeSubmit($, text)),
    run: text => guarded(() => runUpgrade($, text)),
    edit: () => guarded(() => toggleEdit($)),
    editInput: text =>
      guarded(() =>
        update($, flowRef, f => (f !== null && f.step === 'review' ? { ...f, draft: text, isCopied: false } : f)),
      ),
    copy: press => guarded(() => copyUpgrade($, press)),
    cancel: () => guarded(() => cancelUpgrade($)),
    retry: () => guarded(() => retryStep($)),
    sendOriginal: () => guarded(() => sendOriginal($)),
    openUpgrade: id => guarded(() => openUpgrade($, id)),
  }
}

// ---------------------------------------------------------------------------
// The hooks
// ---------------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'better',
        description: 'Upgrade a rough prompt before it is sent',
        argumentHint: '[rough prompt | on | off | history]',
      })
      const saved = cleanHistory(await $.store.get('history'))
      if (saved.length > 0 && (await read($, historyRef)).length === 0) await update($, historyRef, () => saved)

      // A reload leaves the pane and the state in place but loses any model call that was running.
      const f = await read($, flowRef)
      const isPaneOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
      const plan = resumePlan(f, isPaneOpen)
      if (f !== null && plan === 'give-back') {
        await update($, flowRef, () => null)
        later($, () => putBack($, f.original), 150)
      } else if (f !== null && plan === 'reading') {
        later($, () => readQuestions($, f.id))
      } else if (f !== null && plan === 'rewrite') {
        later($, () => writeRewrite($, f.id))
      }
    } catch (err) {
      $.ui.log(`prompt-upgrade: session.start: ${String(err)}`, { to: 'debug' })
    }
    return next(e)
  })

  on('command.run', { command: 'better' }, async ($, e) => {
    try {
      const args = e.args.trim()
      const word = args.toLowerCase()

      if (word === 'on' || word === 'off') {
        const wasOn = (await $.store.get('auto')) === true
        const wantsOn = word === 'on'
        await $.store.set('auto', wantsOn)
        if (wantsOn === wasOn) return { text: `Automatic mode was already ${word}.` }
        return {
          text: wantsOn
            ? 'Automatic mode is on. A prompt you type opens in Prompt Upgrade first. Start it with > to send it as it is.'
            : 'Automatic mode is off. Prompts are sent as you type them.',
        }
      }

      if (word === 'history') {
        const id = await begin($, 'command', 'history', '')
        void settle($, openPane($), id, '', 'none')
          .then(isPlaced => {
            if (!isPlaced) $.ui.log(NARROW_LINE)
          })
          .catch(() => {})
        return { text: 'Opening your last upgrades.' }
      }

      if (args === '') {
        const id = await begin($, 'command', 'compose', '')
        void settle($, openPane($), id, '', 'none')
          .then(isPlaced => {
            if (!isPlaced) $.ui.log(NARROW_LINE)
          })
          .catch(() => {})
        return { text: 'Type your rough prompt in the Prompt Upgrade pane, then press Enter.' }
      }

      const id = await begin($, 'command', 'reading', args)
      void settle($, openPane($), id, args, 'reading')
        .then(isPlaced => {
          if (!isPlaced) $.ui.log(NARROW_LINE)
        })
        .catch(() => {})
      return { text: 'Upgrading your prompt. The review opens in the Prompt Upgrade pane.' }
    } catch (err) {
      $.ui.log(`prompt-upgrade: /better: ${String(err)}`, { to: 'debug' })
      return { text: FAIL_LINE }
    }
  }).catch(() => ({ text: FAIL_LINE }))

  on('prompt.submit', async ($, e, next) => {
    const bypass = await read($, bypassRef)
    if (bypass !== null && e.text === bypass) return next(e)

    const isAuto = (await $.store.get('auto')) === true
    const verdict = classify(e, isAuto)
    if (verdict.kind === 'pass') return next(e)
    if (verdict.kind === 'strip') return next({ ...e, text: verdict.text })

    const open = await read($, flowRef)
    if (open !== null && open.step !== 'history') {
      later($, () => putBack($, verdict.text), 150)
      $.ui.toast('Prompt Upgrade is still open. Finish or cancel it, then send this again.')
      return { drop: 'Your prompt is back in the box; Prompt Upgrade is still open.' }
    }

    const id = await begin($, 'auto', 'reading', verdict.text)
    const isPlaced = await settle($, openPane($), id, verdict.text, 'reading')
    return { drop: isPlaced ? 'Sent to Prompt Upgrade.' : NARROW_LINE }
  }).catch(($, e, next) => next(e))

  on('ui.close', { id: 'prompt-upgrade' }, async ($, e, next) => {
    // Esc or the close mark: nothing the person typed is lost.
    if (e.origin.kind === 'person') {
      try {
        const f = await read($, flowRef)
        if (f !== null) {
          stop?.abort()
          stop = null
          await update($, flowRef, () => null)
          if (f.step !== 'history' && f.step !== 'compose') await putBack($, f.original)
        }
      } catch (err) {
        $.ui.log(`prompt-upgrade: ui.close: ${String(err)}`, { to: 'debug' })
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: 'prompt-upgrade' }, async ($, e, next) => {
    if (e.surface === 'mobile') return next(e)
    const ui = $.ui.resolve(e)
    const flow = await read($, flowRef)
    const history = await read($, historyRef)
    return drawPane(ui, {
      flow,
      history,
      width: Math.max(MIN_WIDTH, e.props.bodyColumns),
      actions: makeActions($),
    })
  }).catch(($, e, next) => next(e))
}
