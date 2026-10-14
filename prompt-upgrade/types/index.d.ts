export type Question = { text: string; options: string[] }

/** One answer. `skip` means the person passed on that question; `text` is empty then. */
export type Answer = { kind: 'option' | 'other' | 'skip'; text: string }

export type Step = 'compose' | 'reading' | 'questions' | 'rewrite' | 'review' | 'error' | 'history'

/** The one upgrade the pane is working on. `null` in state means the pane has nothing open. */
export type Flow = {
  id: string
  step: Step
  source: 'command' | 'auto' | 'history'
  original: string
  questions: Question[]
  /** Index-aligned with `questions`; `null` is a question not yet dealt with. */
  answers: (Answer | null)[]
  /** Index of the question whose "Other" field is showing, if any. */
  otherOpen: number | null
  upgrade: string
  added: string[]
  /** The text in the Edit field. */
  draft: string
  isEditing: boolean
  isCopied: boolean
  /** The step to run again when the person presses Try again. */
  failedStep: 'reading' | 'rewrite' | null
  error: string
}

export type Upgrade = {
  id: string
  at: number
  original: string
  upgrade: string
  added: string[]
  qa: { question: string; answer: string }[]
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-upgrade': {
      flow: Flow | null
      history: Upgrade[]
      /** The exact text the mod is sending itself, so its own prompt can never come back into the pane. */
      bypass: string | null
    }
  }
}
