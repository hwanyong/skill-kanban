import type { Board, BoardCard, BoardLane } from '../types'

// swimlane 마다 머리 줄의 기호와 막대를 칸(글자 · 글자색 · 배경색)의 격자로 계산한다. 엔진(`$`)을 부르지 않는다. 그리기와 타이머는 register.tsx 가 갖는다.
// 카드 한 장이 막대의 한 칸이고, 막대는 pane 폭에서 줄을 바꾼다.

// color · background 는 0x00RRGGBB 이거나 DEFAULT_COLOR 다. RasterProps 의 cells 와 같은 값이다.
export type Cell = { glyph: string; color: number; background: number }
export type Verdict = NonNullable<BoardCard['session']>
// at: 막대 안의 차례(0부터). faded: 사라지는 · 나타나는 중이면 그 프레임의 칸이다.
export type Slot = { at: number; card: BoardCard; faded?: Cell }
// 한 swimlane 의 한 프레임. head: 머리 줄의 기호. rows: 막대의 격자(카드가 없으면 빈 배열). isFlashing: 머리 줄을 반전한다.
export type LaneFrame = { lane: BoardLane; head: Cell; rows: Cell[][]; isFlashing: boolean }

export const DEFAULT_COLOR = 0x01000000
const CARD = '█'
const BLANK: Cell = { glyph: ' ', color: DEFAULT_COLOR, background: DEFAULT_COLOR }

// config.json 의 columns 차례(board 가 낸 index)로 고른다. 열이 이보다 많으면 처음부터 다시 쓴다.
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
// 머리 줄의 기호가 보이는 판정. 소속 카드의 판정이 여럿이면 앞의 것이다.
const HEAD_VERDICTS: Verdict[] = ['restart', 'pending', 'live', 'resume']
const HEAD_RUNNING = '●'
const HEAD_WAITING = '○'
// 카드가 밀리는 데 쓰는 프레임의 최대값. 움직이는 카드가 이보다 적으면 그 수만큼 쓴다.
const MOVE_STEPS = 8
// milestone 의 열이 바뀌었을 때 머리 줄을 반전하는 프레임 수.
const FLASH_STEPS = 8

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

// 칸의 색은 카드의 열이 정한다. session 은 run.status 열의 카드에만 있다.
const cardCell = (board: Board, card: BoardCard, frame: number, position: number): Cell => {
  const color = columnColor(board.columns.find((column) => column.status == card.status)?.index ?? 0)
  if (card.session == null) return { glyph: CARD, color, background: DEFAULT_COLOR }
  return sessionCell(card.session, frame, position, color)
}

const fadedCell = (base: Cell, stage: number): Cell => ({ glyph: glyphAt(FADE, stage), color: mix(base.color, FADE_TARGET, stage / FADE.length), background: DEFAULT_COLOR })

// 소속 카드의 판정을 합친 머리 줄의 판정. 그 판정의 칸이 재생하는 프레임을 머리 줄 기호도 같이 재생한다.
const headCell = (lane: BoardLane, frame: number): Cell => {
  const verdict = HEAD_VERDICTS.find((item) => lane.cards.some((card) => card.session == item))
  if (verdict) return sessionCell(verdict, frame, 0, DONE)
  return { glyph: lane.id == null ? ' ' : lane.is_running ? HEAD_RUNNING : HEAD_WAITING, color: DEFAULT_COLOR, background: DEFAULT_COLOR }
}

// 타이머는 이 값이 참인 동안만 돈다.
export const hasMovingCards = (board: Board) => board.lanes.some((lane) => lane.cards.some((card) => MOVING_VERDICTS.includes(card.session ?? 'none')))

// reserve: 슬롯이 그보다 적어도 막대 행을 그 카드 수만큼 둔다(재배치 중에 격자 크기가 바뀌지 않게 한다). 행의 길이는 모두 columns 다.
const laneRows = (board: Board, slots: Slot[], columns: number, reserve: number, frame: number): Cell[][] => {
  const longest = Math.max(reserve, ...slots.map((slot) => slot.at + 1))
  const rows: Cell[][] = Array.from({ length: Math.ceil(longest / columns) }, () => Array.from({ length: columns }, () => BLANK))
  slots.forEach((slot) => {
    const row = rows[Math.floor(slot.at / columns)]
    if (row) row[slot.at % columns] = slot.faded ?? cardCell(board, slot.card, frame, slot.at)
  })
  return rows
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

// 재배치. 카드의 이동은 옛 swimlane 의 삭제와 새 swimlane 의 생성이다. 같은 swimlane 안에서 차례가 바뀐 카드도 그렇다. 차례: 사라짐 → 남는 카드가 밀림 → 나타남.
// rank: 움직이는 카드 중 몇 번째로 움직이는가. 움직이지 않으면 -1 이다.
type Kept = { card: BoardCard; before: number; after: number; rank: number }
type Gone = { before: number; card: BoardCard; base: Cell }
type Come = { after: number; card: BoardCard; base: Cell }
// lane: 이 프레임들에 그릴 swimlane. 새 판에 없으면 옛 판의 것이다.
type LanePlan = { lane: BoardLane; removed: Gone[]; kept: Kept[]; added: Come[]; moving: number; reserve: number; isStatusChanged: boolean }
export type Transition = { lanes: LanePlan[]; fade: number; shift: number; appear: number; total: number }

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

const planLane = (from: Board, to: Board, before: BoardLane | undefined, after: BoardLane | undefined, lane: BoardLane): LanePlan => {
  const oldCards = before?.cards ?? []
  const newCards = after?.cards ?? []
  const stable = stableIds(oldCards.map((card) => card.id), newCards.map((card) => card.id))
  const places = new Map(oldCards.map((card, at) => [card.id, at]))
  const staying = newCards.flatMap((card, at) => (stable.has(card.id) ? [{ card, before: places.get(card.id) ?? 0, after: at }] : []))
  // 앞으로 밀리는 카드는 앞 카드부터, 뒤로 밀리는 카드는 뒤 카드부터 움직인다. 그 차례면 옮겨 갈 칸이 언제나 비어 있어 겹치지 않고, 빈칸은 옛 자리와 새 자리 사이만 지난다.
  const movers = [...staying.filter((item) => item.after < item.before), ...staying.filter((item) => item.after > item.before).toReversed()]
  return {
    lane,
    removed: oldCards.flatMap((card, at) => (stable.has(card.id) ? [] : [{ before: at, card, base: cardCell(from, card, 0, at) }])),
    kept: staying.map((item) => ({ ...item, rank: movers.indexOf(item) })),
    added: newCards.flatMap((card, at) => (stable.has(card.id) ? [] : [{ after: at, card, base: cardCell(to, card, 0, at) }])),
    moving: movers.length,
    reserve: Math.max(oldCards.length, newCards.length),
    isStatusChanged: before != null && after != null && before.status != after.status,
  }
}

// 카드의 구성 · 차례와 milestone 의 열이 그대로면 null 이다. 세션 판정만 바뀐 카드는 재배치가 아니다.
// 새 판에 없는 swimlane 은 옛 판의 자리에 끼워 두고 칸이 사라진 뒤 없앤다. 열이 바뀐 swimlane 의 자리는 새 판의 자리다.
export const planTransition = (from: Board, to: Board): Transition | null => {
  const oldLanes = new Map(from.lanes.map((lane) => [lane.key, lane]))
  const newLanes = new Map(to.lanes.map((lane) => [lane.key, lane]))
  const order = from.lanes.reduce((list, lane, at) => (newLanes.has(lane.key) ? list : list.toSpliced(at, 0, lane)), to.lanes)
  const lanes = order.map((lane) => planLane(from, to, oldLanes.get(lane.key), newLanes.get(lane.key), lane))
  if (lanes.every((plan) => plan.removed.length == 0 && plan.added.length == 0 && !plan.isStatusChanged)) return null
  const fade = lanes.some((plan) => plan.removed.length > 0) ? FADE.length + 1 : 0
  const shift = Math.min(MOVE_STEPS, Math.max(...lanes.map((plan) => plan.moving)))
  const appear = lanes.some((plan) => plan.added.length > 0) ? FADE.length : 0
  const total = Math.max(fade + shift + appear, lanes.some((plan) => plan.isStatusChanged) ? FLASH_STEPS : 0)
  return { lanes, fade, shift, appear, total }
}

// step 번째 프레임의 슬롯. 나타나는 단계가 끝나면 머리 줄 반전이 끝날 때까지 새 자리에 그대로 둔다.
const transitionSlots = (plan: LanePlan, { fade, shift }: Transition, step: number): Slot[] => {
  if (step < fade) {
    return [
      ...plan.kept.map((item) => ({ at: item.before, card: item.card })),
      ...(step < FADE.length ? plan.removed.map((item) => ({ at: item.before, card: item.card, faded: fadedCell(item.base, step) })) : []),
    ]
  }
  if (step < fade + shift) {
    const moved = Math.ceil(plan.moving * ((step - fade + 1) / shift))
    return plan.kept.map((item) => ({ at: item.rank >= 0 && item.rank < moved ? item.after : item.before, card: item.card }))
  }
  const stage = FADE.length - 1 - (step - fade - shift)
  return [
    ...plan.kept.map((item) => ({ at: item.after, card: item.card })),
    ...plan.added.map((item) => (stage >= 0 ? { at: item.after, card: item.card, faded: fadedCell(item.base, stage) } : { at: item.after, card: item.card })),
  ]
}

// 지금 프레임의 swimlane 들. columns: 막대 폭. transition 이 있으면 그 step 번째 프레임이다.
export const laneFrames = (board: Board, transition: Transition | null, step: number, frame: number, columns: number): LaneFrame[] => {
  if (!transition) return board.lanes.map((lane) => ({ lane, head: headCell(lane, frame), rows: laneRows(board, lane.cards.map((card, at) => ({ at, card })), columns, 0, frame), isFlashing: false }))
  return transition.lanes.map((plan) => ({
    lane: plan.lane,
    head: headCell(plan.lane, frame),
    rows: laneRows(board, transitionSlots(plan, transition, step), columns, plan.reserve, frame),
    isFlashing: plan.isStatusChanged && step < FLASH_STEPS,
  }))
}
