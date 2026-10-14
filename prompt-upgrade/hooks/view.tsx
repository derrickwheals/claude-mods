import type { ElementTable, UiPressArgument } from 'claude-code'

import type { Flow, Step, Upgrade } from '../types'
import {
  AMBER,
  EDGE,
  GOLD,
  GREEN,
  HAIR,
  INK,
  MAIN,
  MUTED,
  SLATE,
  answeredCount,
  bigNumber,
  center,
  fit,
  layoutRows,
  limitRows,
  placeholders,
  stamp,
  wordCount,
  wrapText,
} from './logic'

export type Ui = ElementTable<'terminal' | 'desktop' | 'vscode'>
type Node = JSX.Element
type Chip = { w: number; node: Node }
type Look = 'gold' | 'slate' | 'green' | 'quiet'

export type Actions = {
  pickOption: (question: number, text: string) => void
  pickOther: (question: number) => void
  submitOther: (question: number, text: string) => void
  skipQuestion: (question: number) => void
  skipRest: () => void
  compose: (text: string) => void
  run: (text?: string) => void
  edit: () => void
  editInput: (text: string) => void
  copy: (press: UiPressArgument) => void
  cancel: () => void
  retry: () => void
  sendOriginal: () => void
  openUpgrade: (id: string) => void
}

export type Drawing = {
  flow: Flow | null
  history: Upgrade[]
  width: number
  actions: Actions
}

const MAX_CARD_ROWS = 40

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function blank(ui: Ui): Node {
  const { Text } = ui
  return <Text> </Text>
}

function titleBlock(ui: Ui, width: number): Node {
  const { Box, Text } = ui
  const title = 'PROMPT UPGRADE'
  const rule = Math.min(title.length, width)
  return (
    <Box flexDirection="column">
      <Text bold color={MAIN}>
        {title}
      </Text>
      <Box flexDirection="row">
        <Text color={GOLD}>{'━'.repeat(rule)}</Text>
        <Text color={HAIR}>{'─'.repeat(Math.max(0, width - rule))}</Text>
      </Box>
    </Box>
  )
}

function heading(ui: Ui, label: string, width: number, color: string = MUTED): Node {
  const { Box, Text } = ui
  const lead = `${label.toUpperCase()} `
  return (
    <Box flexDirection="row">
      <Text color={color}>{lead}</Text>
      <Text color={HAIR}>{'─'.repeat(Math.max(0, width - lead.length))}</Text>
    </Box>
  )
}

const STEP_INDEX: Record<Step, number> = {
  compose: 0,
  reading: 0,
  questions: 1,
  rewrite: 2,
  review: 3,
  error: 0,
  history: 3,
}

function tracker(ui: Ui, current: number, width: number): Node {
  const { Box, Text } = ui
  const full = ['Your prompt', 'Questions', 'Rewrite', 'Review']
  const short = ['Prompt', 'Ask', 'Rewrite', 'Review']
  const glyph = (i: number) => (i < current ? '✓' : String(i + 1))
  const size = (names: string[]) => names.reduce((n, name, i) => n + glyph(i).length + 1 + name.length, 0) + 9
  const names = size(full) <= width ? full : size(short) <= width ? short : null
  const parts: Node[] = []
  for (let i = 0; i < 4; i++) {
    if (i > 0) parts.push(<Text color={HAIR}>{' › '}</Text>)
    const isDone = i < current
    const isNow = i === current
    const name = names !== null ? names[i] : isNow ? short[i] : ''
    const glyphColor = isDone ? GREEN : isNow ? GOLD : MUTED
    const nameColor = isDone ? MAIN : isNow ? GOLD : MUTED
    parts.push(
      <Box flexDirection="row">
        <Text color={glyphColor} bold={isNow}>
          {glyph(i)}
        </Text>
        <Text color={nameColor} bold={isNow}>
          {name === '' ? '' : ` ${name}`}
        </Text>
      </Box>,
    )
  }
  return <Box flexDirection="row">{parts}</Box>
}

function chip(ui: Ui, key: string, label: string, look: Look, onPress: (press: UiPressArgument) => void): Chip {
  const { Button, Text } = ui
  const fill = look === 'gold' ? GOLD : look === 'green' ? GREEN : look === 'slate' ? SLATE : undefined
  const ink = look === 'gold' || look === 'green' ? INK : look === 'quiet' ? MUTED : MAIN
  return {
    w: label.length + 2,
    node: (
      <Button key={key} plain onPress={onPress}>
        <Text backgroundColor={fill} color={ink} bold={look === 'gold'}>
          {` ${label} `}
        </Text>
      </Button>
    ),
  }
}

function chipRows(ui: Ui, chips: Chip[], width: number, indent: number = 0): Node[] {
  const { Box } = ui
  return layoutRows(
    chips.map(c => c.w),
    Math.max(1, width - indent),
    1,
  ).map(row => (
    <Box flexDirection="row" gap={1} paddingLeft={indent}>
      {row.map(i => chips[i]!.node)}
    </Box>
  ))
}

function textRows(ui: Ui, lines: string[], color: string, bold: boolean = false): Node[] {
  const { Text } = ui
  return lines.map(line => (
    <Text color={color} bold={bold} wrap="truncate">
      {line === '' ? ' ' : line}
    </Text>
  ))
}

function card(
  ui: Ui,
  o: { width: number; lines: string[]; border: string; title?: string; titleColor?: string },
): Node {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={o.border} width={o.width} paddingX={1}>
      {o.title !== undefined && (
        <Text bold color={o.titleColor ?? MUTED} wrap="truncate">
          {o.title}
        </Text>
      )}
      {textRows(ui, o.lines, MAIN)}
    </Box>
  )
}

function promptCard(ui: Ui, text: string, width: number, maxRows: number): Node {
  const inner = width - 4
  return card(ui, { width, lines: limitRows(wrapText(text, inner), maxRows, inner), border: EDGE })
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

function stats(ui: Ui, before: number, after: number, added: number, width: number): Node {
  const { Box, Text } = ui
  const tiles = [
    { n: before, long: 'WORDS BEFORE', short: 'BEFORE', color: MAIN },
    { n: after, long: 'WORDS AFTER', short: 'AFTER', color: GOLD },
    { n: added, long: 'DETAILS ADDED', short: 'ADDED', color: GREEN },
  ]
  const art = tiles.map(t => bigNumber(t.n))
  const artWidth = Math.max(...art.map(a => a[0].length))
  const need = (key: 'long' | 'short') => Math.max(artWidth, ...tiles.map(t => t[key].length)) + 2
  const tileWidth = Math.floor((width - 2) / 3)
  const key = tileWidth - 2 >= need('long') ? 'long' : tileWidth - 2 >= need('short') ? 'short' : null
  if (key === null) {
    return (
      <Text color={MAIN} wrap="truncate">
        {fit(`${before} words → ${after} words · ${added} details added`, width)}
      </Text>
    )
  }
  const inner = tileWidth - 2
  return (
    <Box flexDirection="row" gap={1}>
      {tiles.map((t, i) => (
        <Box flexDirection="column" borderStyle="round" borderColor={EDGE} width={tileWidth}>
          {art[i]!.map(line => (
            <Text color={t.color} bold wrap="truncate">
              {center(line, inner)}
            </Text>
          ))}
          <Text color={MUTED} wrap="truncate">
            {center(t[key], inner)}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function idleScreen(ui: Ui, width: number): Node[] {
  return textRows(
    ui,
    wrapText('Nothing is open. Type /better and a rough prompt, or /better history for your last upgrades.', width),
    MUTED,
  )
}

function composeScreen(ui: Ui, f: Flow, d: Drawing): Node[] {
  const { Input } = ui
  const { width, actions } = d
  return [
    tracker(ui, 0, width),
    blank(ui),
    heading(ui, 'Your prompt', width),
    <Input
      key="compose"
      label="Prompt "
      placeholder="Type a rough prompt, then press Enter"
      submitLabel="upgrade"
      autoFocus
      onSubmit={text => actions.compose(text)}
    />,
    ...textRows(ui, wrapText('Up to three quick questions follow. Nothing runs until you press Run it.', width), MUTED),
    blank(ui),
    ...chipRows(ui, [chip(ui, 'cancel', 'Cancel', 'quiet', actions.cancel)], width),
  ]
}

function workingScreen(ui: Ui, f: Flow, d: Drawing, line: string): Node[] {
  const { width, actions } = d
  return [
    tracker(ui, STEP_INDEX[f.step], width),
    blank(ui),
    heading(ui, 'Your prompt', width),
    promptCard(ui, f.original, width, 8),
    ...textRows(ui, wrapText(line, width), GOLD),
    blank(ui),
    ...chipRows(ui, [chip(ui, 'cancel', 'Cancel', 'quiet', actions.cancel)], width),
  ]
}

function badge(ui: Ui, index: number, f: Flow): Node {
  const { Text } = ui
  const a = f.answers[index] ?? null
  if (a === null) {
    return (
      <Text backgroundColor={GOLD} color={INK} bold>
        {` ${index + 1} `}
      </Text>
    )
  }
  if (a.kind === 'skip') {
    return (
      <Text backgroundColor={SLATE} color={MUTED}>
        {' – '}
      </Text>
    )
  }
  return (
    <Text backgroundColor={GREEN} color={INK} bold>
      {' ✓ '}
    </Text>
  )
}

function questionBlock(ui: Ui, f: Flow, index: number, d: Drawing): Node[] {
  const { Box, Text, Input } = ui
  const { width, actions } = d
  const q = f.questions[index]!
  const a = f.answers[index] ?? null
  const lines = wrapText(q.text, width - 4)
  const chips: Chip[] = q.options.map((option, i) =>
    chip(
      ui,
      `q${index}o${i}`,
      fit(option, width - 6),
      a !== null && a.kind === 'option' && a.text === option ? 'green' : 'slate',
      () => actions.pickOption(index, option),
    ),
  )
  const other =
    a !== null && a.kind === 'other'
      ? chip(ui, `q${index}other`, fit(`Other: ${a.text}`, Math.max(8, width - 6)), 'green', () => actions.pickOther(index))
      : chip(ui, `q${index}other`, 'Other (type it)', 'slate', () => actions.pickOther(index))
  const skip = chip(ui, `q${index}skip`, a !== null && a.kind === 'skip' ? 'Skipped' : 'Skip', 'quiet', () =>
    actions.skipQuestion(index),
  )
  return [
    <Box flexDirection="row">
      {badge(ui, index, f)}
      <Text bold color={MAIN} wrap="truncate">
        {` ${lines[0]}`}
      </Text>
    </Box>,
    ...textRows(
      ui,
      lines.slice(1).map(line => `    ${line}`),
      MAIN,
      true,
    ),
    ...chipRows(ui, [...chips, other, skip], width, 4),
    ...(f.otherOpen === index
      ? [
          <Box paddingLeft={4}>
            <Input
              key={`other${index}`}
              label="Your answer "
              placeholder="Type it, then Enter"
              submitLabel="save"
              autoFocus
              onSubmit={text => actions.submitOther(index, text)}
            />
          </Box>,
        ]
      : []),
    blank(ui),
  ]
}

function questionsScreen(ui: Ui, f: Flow, d: Drawing): Node[] {
  const { Text } = ui
  const { width, actions } = d
  const total = f.questions.length
  const out: Node[] = [
    tracker(ui, 1, width),
    blank(ui),
    heading(ui, 'Your prompt', width),
    promptCard(ui, f.original, width, 3),
    blank(ui),
    heading(ui, 'Questions', width),
  ]
  for (let i = 0; i < total; i++) out.push(...questionBlock(ui, f, i, d))
  out.push(
    <Text color={MUTED} wrap="truncate">
      {`${answeredCount(f)} of ${total} answered`}
    </Text>,
    ...chipRows(
      ui,
      [
        chip(ui, 'skip-rest', 'Skip the rest, upgrade now', 'gold', actions.skipRest),
        chip(ui, 'cancel', 'Cancel', 'quiet', actions.cancel),
      ],
      width,
    ),
  )
  return out
}

function reviewScreen(ui: Ui, f: Flow, d: Drawing): Node[] {
  const { Box, Input } = ui
  const { width, actions } = d
  const text = f.isEditing ? f.draft : f.upgrade
  const open = placeholders(text)
  const out: Node[] = [
    tracker(ui, 3, width),
    blank(ui),
    stats(ui, wordCount(f.original), wordCount(text), f.added.length, width),
    blank(ui),
    ...chipRows(
      ui,
      [
        chip(ui, 'run', 'Run it', 'gold', () => actions.run()),
        chip(ui, 'edit', f.isEditing ? 'Done' : 'Edit', 'slate', actions.edit),
        chip(ui, 'copy', f.isCopied ? 'Copied' : 'Copy', 'slate', press => actions.copy(press)),
        chip(ui, 'cancel', 'Cancel', 'quiet', actions.cancel),
      ],
      width,
    ),
  ]
  if (f.isEditing) {
    out.push(
      <Input
        key="edit"
        label="Upgrade "
        value={f.draft}
        submitLabel="run"
        autoFocus
        onInput={value => actions.editInput(value)}
        onSubmit={value => actions.run(value)}
      />,
    )
  }
  if (open.length > 0) {
    out.push(...textRows(ui, wrapText(`Fill in before you run: ${open.join(' ')}`, width), AMBER))
  }
  out.push(blank(ui), heading(ui, 'What I added', width))
  if (f.added.length === 0) {
    out.push(...textRows(ui, ['Nothing extra was needed.'], MUTED))
  } else {
    const { Text } = ui
    for (const item of f.added) {
      const rows = wrapText(item, width - 2)
      out.push(
        <Box flexDirection="row">
          <Text color={GREEN}>{'+ '}</Text>
          <Text color={MAIN} wrap="truncate">
            {rows[0]}
          </Text>
        </Box>,
        ...textRows(
          ui,
          rows.slice(1).map(line => `  ${line}`),
          MAIN,
        ),
      )
    }
  }
  out.push(blank(ui))
  const side = width >= 64
  const leftWidth = side ? Math.floor((width - 1) / 2) : width
  const rightWidth = side ? width - 1 - leftWidth : width
  const inner = (w: number) => w - 4
  const left = card(ui, {
    width: leftWidth,
    title: 'MY PROMPT',
    border: EDGE,
    lines: limitRows(wrapText(f.original, inner(leftWidth)), MAX_CARD_ROWS, inner(leftWidth)),
  })
  const right = card(ui, {
    width: rightWidth,
    title: f.isEditing ? 'UPGRADED (EDITING)' : 'UPGRADED',
    titleColor: GOLD,
    border: GOLD,
    lines: limitRows(wrapText(text, inner(rightWidth)), MAX_CARD_ROWS, inner(rightWidth)),
  })
  out.push(
    side ? (
      <Box flexDirection="row" gap={1}>
        {left}
        {right}
      </Box>
    ) : (
      <Box flexDirection="column">
        {left}
        {right}
      </Box>
    ),
  )
  return out
}

function errorScreen(ui: Ui, f: Flow, d: Drawing): Node[] {
  const { width, actions } = d
  const inner = width - 4
  return [
    tracker(ui, STEP_INDEX[f.failedStep ?? 'reading'], width),
    blank(ui),
    heading(ui, 'That did not work', width, AMBER),
    card(ui, {
      width,
      border: AMBER,
      lines: [...wrapText('Your prompt is safe. Nothing was sent.', inner), '', ...wrapText(f.error, inner)],
    }),
    blank(ui),
    ...chipRows(
      ui,
      [
        chip(ui, 'retry', 'Try again', 'gold', actions.retry),
        chip(ui, 'send-original', 'Send my original', 'slate', actions.sendOriginal),
        chip(ui, 'cancel', 'Cancel', 'quiet', actions.cancel),
      ],
      width,
    ),
    blank(ui),
    heading(ui, 'Your prompt', width),
    promptCard(ui, f.original, width, 6),
  ]
}

function historyScreen(ui: Ui, d: Drawing): Node[] {
  const { Button, Text } = ui
  const { width, history, actions } = d
  const out: Node[] = [heading(ui, 'Your last upgrades', width)]
  if (history.length === 0) {
    out.push(...textRows(ui, ['No upgrades yet.'], MUTED))
  }
  history.forEach((u, i) => {
    const label = fit(`${i + 1}. ${u.original.replace(/\s+/g, ' ')}`, Math.max(8, width - 15))
    out.push(
      <Button key={`up:${u.id}`} plain onPress={() => actions.openUpgrade(u.id)}>
        <Text color={MAIN}>{label}</Text>
        <Text color={MUTED}>{`  ${stamp(u.at)}`}</Text>
      </Button>,
    )
  })
  out.push(blank(ui), ...chipRows(ui, [chip(ui, 'cancel', 'Close', 'quiet', actions.cancel)], width))
  return out
}

// ---------------------------------------------------------------------------
// The whole pane
// ---------------------------------------------------------------------------

export function drawPane(ui: Ui, d: Drawing): Node {
  const { Box } = ui
  const f = d.flow
  let body: Node[]
  if (f === null) body = idleScreen(ui, d.width)
  else if (f.step === 'compose') body = composeScreen(ui, f, d)
  else if (f.step === 'reading') body = workingScreen(ui, f, d, 'Reading your prompt and choosing questions…')
  else if (f.step === 'questions') body = questionsScreen(ui, f, d)
  else if (f.step === 'rewrite') {
    const n = answeredCount(f)
    body = workingScreen(ui, f, d, n === 0 ? 'Writing the upgrade…' : `Writing the upgrade from your ${n} answer${n === 1 ? '' : 's'}…`)
  } else if (f.step === 'review') body = reviewScreen(ui, f, d)
  else if (f.step === 'error') body = errorScreen(ui, f, d)
  else body = historyScreen(ui, d)
  return (
    <Box flexDirection="column" width={d.width}>
      {titleBlock(ui, d.width)}
      {blank(ui)}
      {body}
    </Box>
  )
}
