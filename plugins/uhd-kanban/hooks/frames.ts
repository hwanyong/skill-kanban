import type { Board, BoardCard, BoardColumn, MonitorCell } from '../types'

// 보드를 칸(글자 · 글자색 · 배경색)의 격자로 계산한다. 엔진(`$`)을 부르지 않는다. 그리기와 타이머는 register.tsx 가 갖는다.

// color · background 는 0x00RRGGBB 이거나 DEFAULT_COLOR 다. RasterProps 의 cells 와 같은 값이다.
export type Cell = { glyph: string; color: number; background: number }
export type Verdict = NonNullable<BoardCard['session']>
// at: 막대 안의 차례(0부터). faded: 사라지는 · 나타나는 중이면 그 프레임의 칸이다.
export type Slot = { at: number; card: BoardCard; faded?: Cell }
// columns: 격자가 쓸 수 있는 열 수. rows: 카드 수 줄 · 카드 수 밑줄 · 막대가 쓸 수 있는 행 수.
export type Body = { columns: number; rows: number }

export const DEFAULT_COLOR = 0x01000000
const GAP = 1
const CARD = '█'
const AXIS = '─'
const BLANK: Cell = { glyph: ' ', color: DEFAULT_COLOR, background: DEFAULT_COLOR }

// 열의 차례(config.json 의 columns 순서)로 고른다. 열이 이보다 많으면 처음부터 다시 쓴다.
const COLUMN_COLORS = [0x58a6ff, 0xd29922, 0xa371f7, 0x39c5cf, 0xf778ba, 0x7ee787, 0xffa657, 0x6e7681, 0xff7b72]
// Raster 는 테마 키를 받지 않으므로 Claude Code 2.1.312 의 dark 테마 값(success · warning · error)을 적는다.
const SUCCESS = 0x4eba65
const WARNING = 0xffc107
const ERROR = 0xff6b80
const SUCCESS_DIM = 0x1f4a2a
const WARNING_DIM = 0x5c4a08
const ERROR_DIM = 0x5e2a35
const DONE = 0x8b8b8b
const DONE_DIM = 0x2c2f3a
const FADE_TARGET = 0x808080

const WAVE = ['░', '▒', '▓', '█', '▓', '▒']
const RING = ['⠋', '⠙', '⠸', '⠴', '⠦', '⠇']
const FADE = ['▓', '▒', '░', '⠿', '⠶', '⠒', '⠂']
const MOVING_VERDICTS: Verdict[] = ['live', 'pending', 'restart']
// 빈칸이 닫히거나 열리는 데 쓰는 프레임의 최대값. 움직이는 카드가 이보다 적으면 그 수만큼 쓴다.
const MOVE_STEPS = 8

const mix = (from: number, to: number, amount: number) => [16, 8, 0].reduce((sum, shift) => {
  const start = (from >> shift) & 0xff
  return sum + (Math.round(start + (((to >> shift) & 0xff) - start) * amount) << shift)
}, 0)

export const columnColor = (index: number) => COLUMN_COLORS[index % COLUMN_COLORS.length] ?? DEFAULT_COLOR

const glyphAt = (glyphs: string[], index: number) => glyphs[index % glyphs.length] ?? ' '

// live 는 위치마다 어긋난 물결, pending 은 회전, restart 는 글자색과 배경색의 교대다. 나머지 판정은 프레임과 무관하다.
export const sessionCell = (verdict: Verdict, frame: number, position: number, color: number): Cell => {
  if (verdict == 'live') return { glyph: glyphAt(WAVE, frame + position), color: SUCCESS, background: SUCCESS_DIM }
  if (verdict == 'pending') return { glyph: glyphAt(RING, frame), color: WARNING, background: WARNING_DIM }
  if (verdict == 'restart') return frame % 2 == 0 ? { glyph: '↻', color: ERROR, background: ERROR_DIM } : { glyph: '↻', color: ERROR_DIM, background: ERROR }
  if (verdict == 'resume') return { glyph: '▨', color: ERROR, background: ERROR_DIM }
  if (verdict == 'done') return { glyph: '✓', color: DONE, background: DONE_DIM }
  return { glyph: '▒', color, background: mix(color, 0, 0.65) }
}

const cardCell = (board: Board, column: BoardColumn, index: number, card: BoardCard, frame: number, position: number): Cell => {
  const color = columnColor(index)
  if (column.status != board.run_status) return { glyph: CARD, color, background: DEFAULT_COLOR }
  return sessionCell(card.session ?? 'none', frame, position, color)
}

const fadedCell = (base: Cell, stage: number): Cell => ({ glyph: glyphAt(FADE, stage), color: mix(base.color, FADE_TARGET, stage / FADE.length), background: DEFAULT_COLOR })

// 타이머는 이 값이 참인 동안만 돈다.
export const hasMovingCards = (board: Board) => board.columns.some((column) => column.status == board.run_status && column.cards.some((card) => MOVING_VERDICTS.includes(card.session ?? 'none')))

// 막대 폭. 어느 방식이든 열이 모두 columns 칸에 들어가는 가장 넓은 폭이다. pane 폭이 바뀌면 엔진이 ui.render 를 다시 실행하므로 그때 다시 정해진다.
const barWidth = (count: number, columns: number) => Math.max(1, Math.floor((columns - GAP * (count - 1)) / count))

// width: 막대 폭. perRow: 한 행의 카드 수.
//   char: 카드 한 장이 문자 하나다. 한 행의 카드 수는 막대 폭이다.
//   row:  카드 한 장이 막대의 한 행이다.
//   fit:  한 행의 카드 수는 가장 긴 막대가 rows 행에 들어가는 수이고 막대 폭을 넘지 않는다. 카드가 찬 행은 막대 폭을 채운다.
type Layout = { width: number; perRow: number }

const layout = (cell: MonitorCell, most: number, width: number, rows: number): Layout => {
  if (cell == 'row') return { width, perRow: 1 }
  if (cell == 'fit') return { width, perRow: Math.min(width, Math.ceil(Math.max(1, most) / Math.max(1, rows))) }
  return { width, perRow: width }
}

// 한 행의 position 번째 카드의 칸 폭(문자 수). 막대 폭을 perRow 장에 나눈 경계의 차이라, 찬 행의 칸 폭 합은 막대 폭과 같다.
const cellStart = ({ width, perRow }: Layout, position: number) => Math.floor((position * width) / perRow)

// 카드 수 줄. 숫자는 제 막대의 왼쪽 끝에서 시작하고, 줄 끝을 넘으면 줄 끝에 맞춰 왼쪽으로 민다.
// 막대보다 넓은 숫자가 다음 숫자와 GAP 칸 이상 떨어지지 않으면 그 숫자를 다음 줄에 적는다. 막대 폭이 숫자보다 넓으면 한 줄이다.
type Label = { start: number; end: number; text: string; color: number }

const countRows = (counts: number[], width: number): Cell[][] => {
  const total = counts.length * (width + GAP) - GAP
  const lines: Label[][] = []
  counts.forEach((count, index) => {
    const text = String(count)
    const start = Math.max(0, Math.min(index * (width + GAP), total - text.length))
    const label = { start, end: start + text.length, text, color: columnColor(index) }
    const line = lines.find((placed) => placed.every((other) => other.end + GAP <= label.start || label.end + GAP <= other.start))
    if (line) return void line.push(label)
    lines.push([label])
  })
  return lines.map((placed) => {
    const row: Cell[] = Array.from({ length: total }, () => BLANK)
    placed.forEach((label) => [...label.text].forEach((glyph, offset) => {
      row[label.start + offset] = { glyph, color: label.color, background: DEFAULT_COLOR }
    }))
    return row
  })
}

const axisRow = (count: number, width: number): Cell[] => Array.from({ length: count }, (_, index) => {
  const axis = Array.from({ length: width }, () => ({ glyph: AXIS, color: columnColor(index), background: DEFAULT_COLOR }))
  return index == 0 ? axis : [...Array.from({ length: GAP }, () => BLANK), ...axis]
}).flat()

const barRows = (board: Board, column: BoardColumn, index: number, slots: Slot[], size: Layout, height: number, frame: number): Cell[][] => {
  const rows: Cell[][] = Array.from({ length: height }, () => Array.from({ length: size.width }, () => BLANK))
  slots.forEach((slot) => {
    const row = Math.floor(slot.at / size.perRow)
    const position = slot.at % size.perRow
    const start = cellStart(size, position)
    const end = cellStart(size, position + 1)
    const cells = rows[row]
    if (!cells) return
    for (let x = start; x < end; x += 1) cells[x] = slot.faded ?? cardCell(board, column, index, slot.card, frame, slot.at + x - start)
  })
  return rows
}

export const restingSlots = (board: Board): Slot[][] => board.columns.map((column) => column.cards.map((card, at) => ({ at, card })))

// 카드 수 줄 · 밑줄 · 막대의 격자. 행의 길이는 모두 같다. reserve: 슬롯이 그보다 적어도 막대 행을 그 카드 수만큼 둔다(재배치 중에 격자 크기가 바뀌지 않게 한다).
export const boardGrid = (board: Board, slots: Slot[][], frame: number, body: Body, reserve = 0): Cell[][] => {
  const count = board.columns.length
  const width = barWidth(count, body.columns)
  const restingCounts = board.columns.map((column) => column.count)
  const most = Math.max(0, ...restingCounts)
  const size = layout(board.cell, most, width, body.rows - 1 - countRows(restingCounts, width).length)
  const longest = Math.max(reserve, ...slots.flatMap((list) => list.map((slot) => slot.at + 1)))
  const height = Math.ceil(longest / size.perRow)
  const bars = board.columns.map((column, index) => barRows(board, column, index, slots[index] ?? [], size, height, frame))
  const rows = Array.from({ length: height }, (_, row) => bars.flatMap((bar, index) => [...Array.from({ length: index == 0 ? 0 : GAP }, () => BLANK), ...(bar[row] ?? [])]))
  return [...countRows(slots.map((list) => list.length), width), axisRow(count, width), ...rows].map((row) => row.slice(0, Math.max(1, body.columns)))
}

// Raster 의 cells: 행 우선 순서로 [코드 포인트, 글자색, 배경색] 리틀엔디언 u32 세 개씩.
export const packCells = (grid: Cell[][]) => {
  const words = new Uint32Array(grid.flat().length * 3)
  grid.flat().forEach((cell, index) => {
    words[index * 3] = cell.glyph.codePointAt(0) ?? 32
    words[index * 3 + 1] = cell.color
    words[index * 3 + 2] = cell.background
  })
  return new Uint8Array(words.buffer).toBase64()
}

const css = (color: number) => (color == DEFAULT_COLOR ? undefined : `#${color.toString(16).padStart(6, '0')}`)

// Text 로 그릴 때의 한 행. 색이 같은 칸이 이어지면 한 조각으로 묶는다.
export type Run = { text: string; color?: string; backgroundColor?: string }

export const colorRuns = (row: Cell[]): Run[] => row.reduce((runs: (Cell & { text: string })[], cell) => {
  const last = runs.at(-1)
  if (last && last.color == cell.color && last.background == cell.background) last.text += cell.glyph
  else runs.push({ ...cell, text: cell.glyph })
  return runs
}, []).map((run) => ({ text: run.text, color: css(run.color), backgroundColor: css(run.background) }))

export const cellProps = (cell: Cell) => ({ color: css(cell.color), backgroundColor: css(cell.background) })

// 재배치. 이동은 옛 열의 삭제와 새 열의 생성이다. 차례: 사라짐 → 빈칸 닫힘 → 빈칸 열림 → 나타남.
// kept: 남는 카드. before · middle · after 는 삭제 전 · 삭제 후 · 생성 후의 차례다.
// closeRank · openRank: 그 단계에서 움직이는 카드 중 몇 번째로 움직이는가. 닫힐 때는 앞 카드부터, 열릴 때는 뒤 카드부터라 빈칸이 막대를 따라 이동한다.
type Kept = { card: BoardCard; before: number; middle: number; after: number; closeRank: number; openRank: number }
type Gone = { before: number; card: BoardCard; base: Cell }
type Come = { after: number; card: BoardCard; base: Cell }
type ColumnPlan = { removed: Gone[]; kept: Kept[]; added: Come[]; closing: number; opening: number }
export type Transition = { columns: ColumnPlan[]; fade: number; close: number; open: number; appear: number; total: number; reserve: number }

// 앞 판의 차례를 유지하는 가장 긴 카드 모음(longest increasing subsequence). 여기 든 카드만 밀리고 나머지는 같은 열 안에서도 사라졌다 나타난다.
type Link = { id: number; place: number; length: number; previous: Link | null }

const stableIds = (before: number[], after: number[]) => {
  const places = new Map(before.map((id, at) => [id, at]))
  const links: Link[] = []
  after.forEach((id) => {
    const place = places.get(id)
    if (place == null) return
    const previous = links.reduce((best: Link | null, link) => (link.place < place && link.length > (best?.length ?? 0) ? link : best), null)
    links.push({ id, place, length: (previous?.length ?? 0) + 1, previous })
  })
  const stable = new Set<number>()
  for (let link = links.reduce((best: Link | null, item) => (item.length > (best?.length ?? 0) ? item : best), null); link; link = link.previous) stable.add(link.id)
  return stable
}

const planColumn = (from: Board, to: Board, before: BoardColumn, after: BoardColumn, index: number): ColumnPlan => {
  const stable = stableIds(before.cards.map((card) => card.id), after.cards.map((card) => card.id))
  const places = new Map(before.cards.map((card, at) => [card.id, at]))
  const staying = after.cards.flatMap((card, at) => (stable.has(card.id) ? [{ card, before: places.get(card.id) ?? 0, after: at }] : [])).map((item, middle) => ({ ...item, middle }))
  const closers = staying.filter((item) => item.before != item.middle)
  const openers = staying.filter((item) => item.after != item.middle)
  return {
    removed: before.cards.flatMap((card, at) => (stable.has(card.id) ? [] : [{ before: at, card, base: cardCell(from, before, index, card, 0, at) }])),
    kept: staying.map((item) => ({ ...item, closeRank: closers.indexOf(item), openRank: openers.length - 1 - openers.indexOf(item) })),
    added: after.cards.flatMap((card, at) => (stable.has(card.id) ? [] : [{ after: at, card, base: cardCell(to, after, index, card, 0, at) }])),
    closing: closers.length,
    opening: openers.length,
  }
}

// 열 구성이 바뀌었거나 카드의 구성 · 차례가 그대로면 null 이다. 세션 판정만 바뀐 카드는 재배치가 아니다.
export const planTransition = (from: Board, to: Board): Transition | null => {
  const isSameBoard = from.columns.length == to.columns.length && from.columns.every((column, index) => column.status == to.columns[index]?.status)
  if (!isSameBoard) return null
  const columns = to.columns.flatMap((after, index) => {
    const before = from.columns[index]
    return before ? [planColumn(from, to, before, after, index)] : []
  })
  if (columns.every((plan) => plan.removed.length == 0 && plan.added.length == 0)) return null
  const fade = columns.some((plan) => plan.removed.length > 0) ? FADE.length + 1 : 0
  const close = Math.min(MOVE_STEPS, Math.max(...columns.map((plan) => plan.closing)))
  const open = Math.min(MOVE_STEPS, Math.max(...columns.map((plan) => plan.opening)))
  const appear = columns.some((plan) => plan.added.length > 0) ? FADE.length : 0
  const reserve = Math.max(0, ...from.columns.map((column) => column.count), ...to.columns.map((column) => column.count))
  return { columns, fade, close, open, appear, total: fade + close + open + appear, reserve }
}

// step 번째 프레임의 슬롯. 움직인 카드는 앞쪽 차례, 움직이지 않은 카드는 뒤쪽 차례에 있어 겹치지 않는다.
export const transitionSlots = (transition: Transition, step: number): Slot[][] => {
  const { columns, fade, close, open } = transition
  if (step < fade) {
    return columns.map((plan) => [
      ...plan.kept.map((item) => ({ at: item.before, card: item.card })),
      ...(step < FADE.length ? plan.removed.map((item) => ({ at: item.before, card: item.card, faded: fadedCell(item.base, step) })) : []),
    ])
  }
  if (step < fade + close) {
    const amount = (step - fade + 1) / close
    return columns.map((plan) => plan.kept.map((item) => ({ at: item.closeRank < Math.ceil(plan.closing * amount) ? item.middle : item.before, card: item.card })))
  }
  if (step < fade + close + open) {
    const amount = (step - fade - close + 1) / open
    return columns.map((plan) => plan.kept.map((item) => ({ at: item.openRank < Math.ceil(plan.opening * amount) ? item.after : item.middle, card: item.card })))
  }
  const stage = FADE.length - 1 - (step - fade - close - open)
  return columns.map((plan) => [
    ...plan.kept.map((item) => ({ at: item.after, card: item.card })),
    ...plan.added.map((item) => ({ at: item.after, card: item.card, faded: fadedCell(item.base, stage) })),
  ])
}
