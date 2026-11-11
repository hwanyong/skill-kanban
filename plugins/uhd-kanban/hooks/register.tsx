import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, StateWrite, Timer } from 'claude-code'

import { ageOf, etaDays, sparkRuns, sparkline, sum } from './charts'
import type { Age } from './charts'
import { DEFAULT_COLOR, cellProps, colorRuns, columnColor, hasMovingCards, laneFrames, packCells, planTransition, sessionCell } from './frames'
import type { Cell, LaneFrame, Transition, Verdict } from './frames'
import type { Board, BoardLane, BoardView, Locale } from '../types'
import { fillSlot, offerChoice, placementIn, readPlacement, readShownTab } from './pane-grid'

// uhd-kanban 보드 모니터. 세션 디렉터리에서 `uhd-kanban board --json` 을 monitor.interval_seconds 마다 실행하고, milestone 마다 한 행(swimlane)을 그린다.
// 범례 아래에 그래프 4줄(일별 처리량 · 일별 유입 · 시간별 활동 · run.status 카드의 마지막 활동)을 둔다. 값은 board 가 낸 metrics 이고 글자로 바꾸는 것은 charts.ts 가 갖는다.
// 행은 머리 줄(상태 기호 · 제목 · 끝낸 수/전체 수 · 예상 일수)과, 소속 카드 하나를 한 칸으로 그린 누적 막대다. 행이 본문에 들어가지 않으면 pane 을 스크롤한다.
// 머리 줄의 접기 기호와 id 는 Button 이고 누르면 그 행의 막대를 접거나 편다. 접은 행의 목록은 세션 디렉터리마다 $.store 에 둔다.
// 2.1.312 의 Button 은 자식 Text 의 wrap="truncate-end" 를 따르지 않고 줄을 바꾸므로, 길이가 정해지지 않은 milestone 제목은 Button 밖의 Text 로 둔다.
// 격자의 계산은 frames.ts 가 갖고, 이 모듈은 그 격자를 그리고 프레임의 차례를 정한다.
// 보드를 읽는 규칙은 board 명령(같은 플러그인의 skills/uhd-kanban/lib/)이 갖는다. 이 모듈은 그 stdout 을 그리기만 한다.
// pane 의 글은 locale 명령이 낸 언어(ko · en)로 고른다. 언어를 정하는 규칙도 그 명령(lib/i18n.mjs)이 갖는다.
// pane-grid 의 배치에 이 mod 의 칸이 있으면 자기 pane 을 닫고 그 grid pane 의 칸에 같은 그림을 그린다(plugin-pane-grid 의 docs/grid-and-tabs.md §3.3 · §3.5).

const PANE = 'uhd-kanban-board'
// pane-grid 의 layout 에서 이 mod 의 칸을 찾는 이름. plugin.json 의 name 이다.
const PLUGIN = 'uhd-kanban'
// 같은 플러그인에 든 스킬의 명령. 플러그인 폴더(plugin.json 이 든 폴더)에서 센다.
const SKILL_BIN = 'skills/uhd-kanban/bin/uhd-kanban.mjs'
const TITLE = 'uhd-kanban'
const COMMAND = 'kanban-board'
// 메인 세션에서 guard 명령으로 판정하는 도구. 이 셋의 입력은 고칠 파일을 file_path · notebook_path 로 갖는다.
const GUARDED_TOOLS = ['Edit', 'Write', 'NotebookEdit'] as const
// 격자의 프레임 간격. 터미널에서만 재생한다. 2.1.312 의 실측은 README 의 보드 모니터 pane 절에 있다.
const STATUS_FRAME_MS = 250
const TRANSITION_FRAME_MS = 100
// 다른 탭 뒤에 있는 pane 이 다시 보이는지 확인하는 간격.
const HIDDEN_CHECK_MS = 1000
// RasterProps 의 columns · rows 상한.
const MAX_RASTER_COLUMNS = 512
const MAX_RASTER_ROWS = 256
// run.status 열의 칸과 그 칸이 속한 swimlane 의 머리 줄 기호만 세션 판정(sessions.mjs 의 cardSession)으로 글자 · 색을 바꾼다. 범례의 차례이고, 판정 이름은 TEXT 의 키다.
const VERDICTS: Verdict[] = ['live', 'pending', 'restart', 'resume', 'done', 'unknown', 'none']
// 머리 줄 제목 앞의 기호. 두 글자 모두 UAX #11 의 Neutral 이라 터미널에서 1칸이다.
const EXPANDED_GLYPH = '▾'
const COLLAPSED_GLYPH = '▸'

// skills/uhd-kanban/lib/messages/*.mjs 와 같은 언어 목록이다. 이 모듈은 그 표를 읽지 못하므로 pane 의 글만 따로 둔다.
const TEXT = {
  ko: {
    live: '돈다',
    pending: '다시 뜨는 중',
    restart: '재시작 대기',
    resume: '이어 가기 대기',
    done: '끝남',
    unknown: '모르는 state',
    none: '세션 없음',
    description: 'uhd-kanban 보드의 milestone 마다 소속 카드를 pane 에 누적 막대로 그린다',
    noBoard: '이 세션의 project root 위에 .uhd-kanban/config.json 이 없고 이 세션을 메인 세션으로 등록한 보드도 없어 pane 을 열지 않았다',
    noBoardHere: '이 세션의 project root 위에 .uhd-kanban/config.json 이 없고 이 세션을 메인 세션으로 등록한 보드도 없다. 다음 turn 에 다시 찾는다',
    opened: (root: string, seconds: number) => `${root} 의 보드를 열었다. ${seconds}초마다 다시 읽는다`,
    inGrid: (tab: string) => `보드를 pane-grid 의 배치 ${tab} 칸에 그린다. 자기 pane 은 열지 않았다`,
    failed: (message: string) => `board 명령이 실패했다: ${message}`,
    notRun: (command: string, message: string) => `${command} 를 실행하지 못했다: ${message}`,
    exitCode: (code: number) => `종료 코드 ${code}`,
    reading: '보드를 읽는 중이다',
    failedAt: (clock: string) => `board 명령이 실패했다 (${clock})`,
    reload: (command: string) => `/${command} 로 다시 읽는다`,
    header: (clock: string, cards: number, milestones: number, seconds: number) => `${clock} · 카드 ${cards}개 · milestone ${milestones}개 · ${seconds}초마다`,
    noMilestone: '소속 없음',
    finishedLabel: '처리량',
    createdLabel: '유입',
    activityLabel: '활동',
    finishedSummary: (today: number, week: number, days: number) => `오늘 ${today} · ${days}일 ${week}`,
    createdSummary: (today: number, week: number, days: number, net: string) => `오늘 ${today} · ${days}일 ${week} · 순증 ${net}`,
    activitySummary: (hour: number, last: string | null) => `1시간 ${hour} · ${last == null ? '활동 없음' : `마지막 ${last} 전`}`,
    age: ({ value, unit }: Age) => `${value}${{ minute: '분', hour: '시간', day: '일' }[unit]}`,
    runningPrefix: (status: string) => `${status} 마지막 활동: `,
    eta: (days: number) => ` · 약 ${days}일`,
    etaStalled: (days: number) => ` · ${days}일 처리 0`,
  },
  en: {
    // uk board 가 출력하는 판정 id 와 같은 낱말이다.
    live: 'live',
    pending: 'pending',
    restart: 'restart',
    resume: 'resume',
    done: 'done',
    unknown: 'unknown',
    none: 'none',
    description: 'Draws the cards of each uhd-kanban board milestone as a stacked bar in a pane',
    noBoard: 'No .uhd-kanban/config.json above this session\'s project root and no board registers this session as its main session, so the pane was not opened',
    noBoardHere: 'No .uhd-kanban/config.json above this session\'s project root and no board registers this session as its main session. Searches again on the next turn',
    opened: (root: string, seconds: number) => `Opened the board of ${root}. Rereads every ${seconds}s`,
    inGrid: (tab: string) => `The board is drawn in a cell of the pane-grid layout ${tab}, so its own pane was not opened`,
    failed: (message: string) => `The board command failed: ${message}`,
    notRun: (command: string, message: string) => `Could not run ${command}: ${message}`,
    exitCode: (code: number) => `exit code ${code}`,
    reading: 'Reading the board',
    failedAt: (clock: string) => `The board command failed (${clock})`,
    reload: (command: string) => `Reread with /${command}`,
    header: (clock: string, cards: number, milestones: number, seconds: number) => `${clock} · ${cards} cards · ${milestones} milestones · every ${seconds}s`,
    noMilestone: 'no milestone',
    finishedLabel: 'finished',
    createdLabel: 'created',
    activityLabel: 'activity',
    finishedSummary: (today: number, week: number, days: number) => `today ${today} · ${days}d ${week}`,
    createdSummary: (today: number, week: number, days: number, net: string) => `today ${today} · ${days}d ${week} · net ${net}`,
    activitySummary: (hour: number, last: string | null) => `1h ${hour} · ${last == null ? 'no activity' : `last ${last} ago`}`,
    age: ({ value, unit }: Age) => `${value}${{ minute: 'm', hour: 'h', day: 'd' }[unit]}`,
    runningPrefix: (status: string) => `${status} last activity: `,
    eta: (days: number) => ` · ~${days}d`,
    etaStalled: (days: number) => ` · 0 finished in ${days}d`,
  },
} satisfies Record<Locale, unknown>

const view = atom({ plugin: 'uhd-kanban', key: 'view' } as const, { kind: 'reading' } as BoardView, { shape: 'view-2' })
// 접은 swimlane 의 key. 값을 쓰면 엔진이 pane 을 다시 그린다.
const collapsedLanes = atom({ plugin: 'uhd-kanban', key: 'collapsedLanes' } as const, [] as string[])

const collapsedStoreKey = async ($: EngineInterface) => `collapsedLanes:${await $.session.root()}`

const loadCollapsedLanes = async ($: EngineInterface) => {
  const stored = await $.store.get(await collapsedStoreKey($))
  if (stored) await update($, collapsedLanes, () => stored as string[])
}

const toggleLane = async ($: EngineInterface, key: string) => {
  const next = await update($, collapsedLanes, (keys) => (keys.includes(key) ? keys.filter((item) => item != key) : [...keys, key]))
  await $.store.set(await collapsedStoreKey($), next)
}

const clockText = (ms: number) => {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// 범례 항목은 글자 하나 · 이름 · 공백 하나다. 한글은 터미널에서 2칸을 쓴다(UAX #11 의 Wide).
const displayWidth = (text: string) => [...text].reduce((sum, char) => sum + (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/.test(char) ? 2 : 1), 0)

// 범례 항목을 pane 폭에 맞춰 줄로 나눈다. prefix 는 첫 줄 앞에 붙는 글이다.
type LegendItem = { cell: Cell; label: string }

const legendLines = (prefix: string, items: LegendItem[], columns: number) => items.reduce((lines: LegendItem[][], item) => {
  const last = lines.at(-1) ?? []
  const used = displayWidth(lines.length == 1 ? prefix : '') + last.reduce((sum, placed) => sum + 2 + displayWidth(placed.label), 0)
  if (last.length > 0 && used + 2 + displayWidth(item.label) > columns) return [...lines, [item]]
  last.push(item)
  return lines
}, [[]])

// 재생 상태. 모듈을 다시 읽으면 처음부터 시작하고 첫 읽기는 재배치를 재생하지 않는다.
// frame: 판정 칸의 프레임. elapsedMs: frame 을 정하는 누적 시간. last: 재배치를 비교할 직전 board 결과. columns: 막대 폭.
// layout: 지금 그려진 Raster 들의 구성(layoutOf). Text 로 그렸으면 null 이고 이때는 타이머를 돌리지 않는다. painted: Raster 의 key → 그려진 cells. isHidden: 다른 탭 뒤에 있다.
// collapsed: 지금 그려진 접은 swimlane 의 key. ui.render 가 collapsedLanes 를 읽어 정하므로 타이머의 프레임이 그려진 구성과 어긋나지 않는다.
// requestId: 마지막으로 그린 pane 의 id. 자기 pane 이면 PANE, grid 칸이면 그 grid pane 의 id 이고, blit 과 보이는지 판정이 이 값을 쓴다.
type Motion = { timer: Timer | null; periodMs: number; frame: number; elapsedMs: number; transition: Transition | null; step: number; last: Board | null; layout: string | null; painted: Map<string, string>; columns: number; isHidden: boolean; collapsed: string[]; requestId: string }

const newMotion = (): Motion => ({ timer: null, periodMs: 0, frame: 0, elapsedMs: 0, transition: null, step: 0, last: null, layout: null, painted: new Map(), columns: 1, isHidden: false, collapsed: [], requestId: PANE })

// 접은 swimlane 은 막대 행이 0개다. 머리 줄 기호는 그대로 재생한다.
const currentLanes = (board: Board, motion: Motion) => laneFrames(board, motion.transition, motion.step, motion.frame, motion.columns).map((item) => (motion.collapsed.includes(item.lane.key) ? { ...item, rows: [] } : item))

// 이 값이 그려진 것과 다르면 blit 으로 고칠 수 없어 다시 그린다: swimlane 의 구성 · 차례, 막대 행 수, 머리 줄 반전.
const layoutOf = (lanes: LaneFrame[]) => lanes.map((item) => `${item.lane.key}:${item.rows.length}:${item.isFlashing}`).join(' ')

const headKey = (item: LaneFrame) => `head:${item.lane.key}`
const barKey = (item: LaneFrame) => `bar:${item.lane.key}`

// 그려진 Raster 전부의 key 와 cells. 막대는 카드가 있는 행에만 있다.
const rastersOf = (lanes: LaneFrame[]) => lanes.flatMap((item) => [
  { key: headKey(item), cells: packCells([[item.head]]) },
  ...(item.rows.length > 0 ? [{ key: barKey(item), cells: packCells(item.rows) }] : []),
])

// 재배치 중이면 짧은 간격, 움직이는 판정의 카드가 있으면 긴 간격이고, 둘 다 아니면 타이머를 끈다.
// 가려진 grid 칸은 타이머를 끈다. 다시 보이는 것은 pane-grid 의 shown 을 받는 state.set hook 이 알린다(결정 8).
const syncTimer = ($: EngineInterface, motion: Motion, board: Board) => {
  const hiddenMs = motion.requestId == PANE ? HIDDEN_CHECK_MS : 0
  const ms = motion.layout == null ? 0 : motion.isHidden ? hiddenMs : motion.transition ? TRANSITION_FRAME_MS : hasMovingCards(board) ? STATUS_FRAME_MS : 0
  if (ms == motion.periodMs) return
  motion.timer?.cancel()
  motion.timer = ms == 0 ? null : $.clock.every(ms, () => void advance($, motion))
  motion.periodMs = ms
}

const stopTimer = (motion: Motion) => {
  motion.timer?.cancel()
  motion.timer = null
  motion.periodMs = 0
}

// 프레임에서 cells 가 바뀐 Raster 만 blit 한다. 구성이 그려진 것과 다르거나(재배치의 시작과 끝) blit 이 거절되면 다시 그린다.
const paint = async ($: EngineInterface, motion: Motion, board: Board) => {
  if (motion.layout == null) return
  const lanes = currentLanes(board, motion)
  if (layoutOf(lanes) != motion.layout) return $.ui.invalidate('ui.render')
  for (const { key, cells } of rastersOf(lanes)) {
    if (motion.painted.get(key) == cells) continue
    const result = await $.ui.blit({ requestId: motion.requestId, key, cells })
    if (result.deny) return $.ui.invalidate('ui.render')
    motion.painted.set(key, cells)
  }
}

// 그린 곳이 열려 있는지와 보이는지. 자기 pane 은 $.ui.panes() 로, grid 칸은 pane-grid 의 layout · shown 으로 정한다.
// $.ui.panes() 에는 이 mod 가 연 pane 만 나오므로 grid pane 은 그 목록으로 판정할 수 없다.
const drawnAt = async ($: EngineInterface, motion: Motion) => {
  if (motion.requestId == PANE) {
    const pane = (await $.ui.panes()).find((item) => item.id == PANE)
    return { isOpen: pane != undefined, isShown: pane?.isShown == true }
  }
  const placement = await readPlacement($, PLUGIN)
  if (!placement || placement.requestId != motion.requestId) return { isOpen: false, isShown: false }
  return { isOpen: true, isShown: (await readShownTab($)) == placement.tab }
}

// 탭이 다시 보일 때 엔진은 ui.render 를 실행하지 않고 지난 결과를 쓰며 그 전환을 알리는 이벤트도 없다. 그래서 숨어 있는 동안 HIDDEN_CHECK_MS 마다 확인하고, 다시 보이면 다시 그린다.
// pane 이 닫혔으면 타이머를 끈다. 다시 열면 엔진이 ui.render 를 실행하고 그 훅이 타이머를 켠다.
const advance = async ($: EngineInterface, motion: Motion) => {
  const drawn = await drawnAt($, motion)
  const current = await read($, view)
  if (!drawn.isOpen || current.kind != 'ok') {
    motion.transition = null
    motion.isHidden = false
    return stopTimer(motion)
  }
  if (!drawn.isShown) {
    motion.transition = null
    motion.isHidden = true
    return syncTimer($, motion, current.board)
  }
  if (motion.isHidden) {
    motion.isHidden = false
    syncTimer($, motion, current.board)
    return $.ui.invalidate('ui.render')
  }
  motion.elapsedMs += motion.periodMs
  motion.frame = Math.floor(motion.elapsedMs / STATUS_FRAME_MS)
  if (motion.transition) motion.step += 1
  if (motion.transition && motion.step >= motion.transition.total) motion.transition = null
  syncTimer($, motion, current.board)
  await paint($, motion, current.board)
}

// 재생 중에 새 변경이 오면 재생하던 것의 마지막 상태에서 새 재배치를 시작한다. 보이지 않는 pane 과 Text 로 그린 pane 은 재생하지 않는다.
const beginTransition = async ($: EngineInterface, motion: Motion, board: Board) => {
  const { isShown } = await drawnAt($, motion)
  const plan = motion.last && motion.layout != null && isShown ? planTransition(motion.last, board) : null
  motion.last = board
  if (!plan) return
  motion.transition = plan
  motion.step = 0
}

// locale 은 session.start 에서 locale 명령으로 정한다. 정하기 전에 쓰는 값은 en 이다.
type Polling = { timer: Timer | null; periodMs: number; locale: Locale; motion: Motion }

const skillArgv = ($: EngineInterface, args: string[]) => ['node', `${$.plugin.root}/${SKILL_BIN}`, ...args]

// 스킬 명령은 세션의 project root 에서 실행하고 CLAUDE_CODE_SESSION_ID 에 이 세션의 id 를 넣는다.
// 그 디렉터리 위에 보드가 없으면 명령이 그 id 로 이 세션을 메인 세션으로 등록한 보드를 찾는다(lib/root.mjs 의 findCallerRootOrNull).
const runSkill = async ($: EngineInterface, argv: string[], timeoutMs: number) =>
  $.process.run(argv, { cwd: await $.session.root(), env: { CLAUDE_CODE_SESSION_ID: await $.session.id() }, timeoutMs })

// board 를 한 번 실행한 결과. reading 은 실행하기 전의 값이라 여기서 나오지 않는다.
type BoardRun = Exclude<BoardView, { kind: 'reading' }>

const refresh = async ($: EngineInterface, polling: Polling): Promise<BoardRun> => {
  const text = TEXT[polling.locale]
  const refreshedAt = await $.clock.now()
  const argv = skillArgv($, ['board', '--json'])
  const ran = await runSkill($, argv, 60000).catch((error) => ({ exitCode: -1, stdout: '', stderr: text.notRun(argv.join(' '), String(error?.message ?? error)) }))
  const result: BoardRun = ran.exitCode == 3
    ? { kind: 'none' }
    : ran.exitCode == 0
      ? { kind: 'ok', board: JSON.parse(ran.stdout), refreshedAt }
      : { kind: 'error', message: ran.stderr.trim() || text.exitCode(ran.exitCode), refreshedAt }
  if (result.kind == 'ok') await beginTransition($, polling.motion, result.board)
  await update($, view, () => result)
  return result
}

// 주기는 board 가 낸 interval_seconds 다. 보드가 없으면 멈추고(다시 찾는 것은 turn.start 가 한다), board 가 실패하면 마지막 주기를 그대로 둔다.
const schedule = ($: EngineInterface, polling: Polling, result: BoardView) => {
  if (result.kind == 'error') return
  const ms = result.kind == 'ok' ? result.board.interval_seconds * 1000 : 0
  if (ms == polling.periodMs) return
  polling.timer?.cancel()
  polling.timer = ms == 0 ? null : $.clock.every(ms, () => void tick($, polling))
  polling.periodMs = ms
}

// 자기 pane 이 닫혀 있고 grid 에 칸도 없으면 board 를 실행하지 않는다. 가려져 있어도 실행하고, 다시 보일 때 view 를 읽은 그림이 다시 그려진다.
const tick = async ($: EngineInterface, polling: Polling) => {
  const isOpen = (await $.ui.panes()).some((pane) => pane.id == PANE) || (await readPlacement($, PLUGIN)) != undefined
  if (!isOpen) return
  schedule($, polling, await refresh($, polling))
}

// locale 명령이 실패하면(node 가 없는 등) en 으로 둔다. 실패한 이유는 다음 board 실행이 pane 에 낸다.
const resolveLocale = async ($: EngineInterface): Promise<Locale> => {
  const ran = await runSkill($, skillArgv($, ['locale']), 30000).catch(() => null)
  const value = ran?.exitCode == 0 ? ran.stdout.trim() : ''
  return value in TEXT ? (value as Locale) : 'en'
}

const start = async ($: EngineInterface, polling: Polling) => {
  const result = await refresh($, polling)
  schedule($, polling, result)
  if (result.kind == 'none' || (await readPlacement($, PLUGIN))) return
  await $.ui.open({ id: PANE, title: TITLE })
}

// pane-grid 가 layout 을 쓸 때마다 실행한다. 칸이 생겼으면 자기 pane 을 닫고, 칸이 없어진 그때만 다시 연다.
// 칸이 없는 채로 배치만 바뀔 때는 열지 않는다. 사람이 닫아 둔 pane 을 다시 열지 않기 위해서다.
const placeOwnPane = async ($: EngineInterface, layout: unknown, previous: unknown) => {
  const isPlaced = placementIn(layout, PLUGIN) != undefined
  const isOpen = (await $.ui.panes()).some((pane) => pane.id == PANE)
  if (isPlaced && isOpen) return $.ui.close({ id: PANE })
  if (isPlaced || isOpen || placementIn(previous, PLUGIN) == undefined) return
  const { kind } = await read($, view)
  if (kind == 'none' || kind == 'reading') return
  await $.ui.open({ id: PANE, title: TITLE })
}

// pane-grid 가 shown 을 쓸 때마다 실행한다. 이 mod 가 grid 칸에 그리고 있을 때만 재생을 멈추거나 다시 시작한다.
const followShown = async ($: EngineInterface, motion: Motion, shown: unknown) => {
  if (motion.requestId == PANE || motion.layout == null) return
  const current = await read($, view)
  if (current.kind != 'ok') return
  const placement = await readPlacement($, PLUGIN)
  const isShown = placement != undefined && placement.requestId == motion.requestId && shown == placement.tab
  if (!isShown) {
    motion.transition = null
    motion.isHidden = true
    return stopTimer(motion)
  }
  if (!motion.isHidden) return
  motion.isHidden = false
  syncTimer($, motion, current.board)
  await $.ui.invalidate('ui.render')
}

// 자기 pane 과 grid 칸이 함께 쓰는 그리기 함수. requestId 는 그리는 pane 의 id, columns 는 그릴 너비다.
const drawBoard = async ($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], polling: Polling, requestId: string, columns: number) => {
  const { Box, Button, Text } = $.ui.resolve(e)
  const Raster = e.surface == 'terminal' ? $.ui.resolve(e).Raster : null
  const { motion } = polling
  motion.requestId = requestId
  const text = TEXT[polling.locale]
  const current = await read($, view)
  if (current.kind != 'ok') {
    motion.layout = null
    stopTimer(motion)
  }
  if (current.kind == 'reading') return <Text dimColor>{text.reading}</Text>
  if (current.kind == 'none') return <Text dimColor>{text.noBoardHere}</Text>
  if (current.kind == 'error') {
    return (
      <Box flexDirection="column">
        <Text color="error">{text.failedAt(clockText(current.refreshedAt))}</Text>
        <Text>{current.message}</Text>
        <Text dimColor>{text.reload(COMMAND)}</Text>
      </Box>
    )
  }
  const { board } = current
  motion.columns = Math.max(1, columns)
  motion.collapsed = await read($, collapsedLanes)
  const lanes = currentLanes(board, motion)
  const fits = motion.columns <= MAX_RASTER_COLUMNS && lanes.every((item) => item.rows.length <= MAX_RASTER_ROWS)
  motion.layout = Raster && fits ? layoutOf(lanes) : null
  motion.painted = new Map(rastersOf(lanes).map(({ key, cells }) => [key, cells]))
  if (motion.layout == null) motion.transition = null
  syncTimer($, motion, board)
  const cards = board.columns.reduce((sum, column) => sum + column.count, 0)
  const milestones = board.lanes.filter((lane) => lane.id != null).length
  const runIndex = board.columns.find((column) => column.status == board.run_status)?.index ?? 0
  const prefix = `${board.run_status}: `
  const columnItems: LegendItem[] = board.columns.map((column) => ({ cell: { glyph: '█', color: columnColor(column.index), background: DEFAULT_COLOR }, label: `${column.status} ${column.count}` }))
  const verdictItems: LegendItem[] = VERDICTS.map((verdict) => ({ cell: sessionCell(verdict, 0, 0, columnColor(runIndex)), label: text[verdict] }))
  const legendItem = (item: LegendItem) => <Text><Text {...cellProps(item.cell)}>{item.cell.glyph}</Text><Text dimColor>{item.label} </Text></Text>
  // 그래프 줄: 이름(같은 폭으로 맞춤) · sparkline · 요약. sparkline 은 pane 폭에서 이름과 요약을 뺀 만큼 최근 값부터 그린다.
  const { metrics } = board
  const labelWidth = Math.max(...[text.finishedLabel, text.createdLabel, text.activityLabel].map(displayWidth))
  const label = (name: string) => `${name}${' '.repeat(labelWidth - displayWidth(name))} `
  const week = metrics.days.slice(-metrics.window_days)
  const finishedWeek = sum(week.map((day) => day.finished))
  const createdWeek = sum(week.map((day) => day.created))
  const net = createdWeek - finishedWeek
  const finishedSummary = text.finishedSummary(metrics.days.at(-1)?.finished ?? 0, finishedWeek, metrics.window_days)
  const createdSummary = text.createdSummary(metrics.days.at(-1)?.created ?? 0, createdWeek, metrics.window_days, `${net > 0 ? '+' : ''}${net}`)
  const lastActivity = metrics.last_activity_at == null ? null : text.age(ageOf(current.refreshedAt - Date.parse(metrics.last_activity_at)))
  const activitySummary = text.activitySummary(metrics.hours.at(-1) ?? 0, lastActivity)
  const sparkWidth = (summary: string) => Math.max(0, motion.columns - labelWidth - 1 - displayWidth(summary) - 1)
  const dayCount = Math.min(metrics.days.length, sparkWidth(finishedSummary), sparkWidth(createdSummary))
  const shownDays = metrics.days.slice(metrics.days.length - dayCount)
  const dayMax = Math.max(...shownDays.map((day) => Math.max(day.finished, day.created)), 0)
  const shownHours = metrics.hours.slice(Math.max(0, metrics.hours.length - sparkWidth(activitySummary)))
  const chartRow = (name: string, values: number[], max: number, color: string | undefined, summary: string) => (
    <Text wrap="truncate-end">
      <Text dimColor>{label(name)}</Text>
      {sparkRuns(sparkline(values, max)).map((run) => <Text color={run.isZero ? undefined : color} dimColor={run.isZero}>{run.text}</Text>)}
      <Text dimColor> {summary}</Text>
    </Text>
  )
  const runColor = cellProps({ glyph: ' ', color: columnColor(runIndex), background: DEFAULT_COLOR }).color
  // 마지막 활동이 오래된 카드부터 적는다. 활동 코멘트도 session_started_at 도 없는 카드가 맨 앞이다.
  const running = metrics.running.toSorted((a, b) => (a.last_activity_at == null ? -1 : b.last_activity_at == null ? 1 : Date.parse(a.last_activity_at) - Date.parse(b.last_activity_at)))
  const runningText = running.map((card) => `k${card.id} ${card.last_activity_at == null ? '-' : text.age(ageOf(current.refreshedAt - Date.parse(card.last_activity_at)))}`).join(' · ')
  const laneEta = (lane: BoardLane) => {
    if (lane.total - lane.finished <= 0) return ''
    const days = etaDays(lane, metrics.window_days)
    return days == null ? text.etaStalled(metrics.window_days) : text.eta(days)
  }
  const textRows = (rows: Cell[][]) => rows.map((row) => <Text wrap="truncate-end">{colorRuns(row).map((run) => <Text color={run.color} backgroundColor={run.backgroundColor}>{run.text}</Text>)}</Text>)
  const laneBlock = (item: LaneFrame) => {
    const { lane, head, rows, isFlashing } = item
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          {Raster && motion.layout != null ? <Raster key={headKey(item)} columns={1} rows={1} cells={packCells([[head]])} /> : <Text {...cellProps(head)}>{head.glyph}</Text>}
          <Text> </Text>
          {/* width 0: 제목 길이가 flexbox 의 축소 비율에 들어가면 끝낸 수/전체 수의 폭이 소수점 아래로 줄어 그 글이 다음 줄로 넘어간다. */}
          <Button key={`toggle:${lane.key}`} plain dimColor={!lane.is_running} onPress={() => void toggleLane($, lane.key)}>
            <Text inverse={isFlashing}>{motion.collapsed.includes(lane.key) ? COLLAPSED_GLYPH : EXPANDED_GLYPH} {lane.id == null ? text.noMilestone : `k${lane.id}`}</Text>
          </Button>
          <Box width={0} flexGrow={1}>
            <Text wrap="truncate-end" inverse={isFlashing} dimColor={!lane.is_running}>{lane.id == null ? '' : ` ${lane.title}`}</Text>
          </Box>
          <Text dimColor> {lane.finished}/{lane.total}{laneEta(lane)}</Text>
        </Box>
        {rows.length == 0 ? null : Raster && motion.layout != null ? <Raster key={barKey(item)} columns={motion.columns} rows={rows.length} cells={packCells(rows)} /> : textRows(rows)}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      <Text dimColor wrap="truncate-end">{text.header(clockText(current.refreshedAt), cards, milestones, board.interval_seconds)}</Text>
      {legendLines('', columnItems, motion.columns).map((items) => <Text wrap="truncate-end">{items.map(legendItem)}</Text>)}
      {legendLines(prefix, verdictItems, motion.columns).map((items, index) => (
        <Text wrap="truncate-end">
          {index == 0 ? <Text dimColor>{prefix}</Text> : null}
          {items.map(legendItem)}
        </Text>
      ))}
      <Text> </Text>
      {chartRow(text.finishedLabel, shownDays.map((day) => day.finished), dayMax, 'success', finishedSummary)}
      {chartRow(text.createdLabel, shownDays.map((day) => day.created), dayMax, undefined, createdSummary)}
      {chartRow(text.activityLabel, shownHours, Math.max(...shownHours, 0), runColor, activitySummary)}
      {running.length == 0 ? null : <Text wrap="truncate-end"><Text dimColor>{text.runningPrefix(board.run_status)}</Text>{runningText}</Text>}
      <Text> </Text>
      {lanes.map(laneBlock)}
    </Box>
  )
}

// 타이머는 모듈을 다시 읽으면 엔진이 버린다. 그래서 상태도 register 가 돌 때마다 새로 만든다.
export const register: Register = (on) => {
  const polling: Polling = { timer: null, periodMs: 0, locale: 'en', motion: newMotion() }

  on('session.start', async ($, e, next) => {
    polling.locale = await resolveLocale($)
    await $.command.register({ name: COMMAND, description: TEXT[polling.locale].description })
    await loadCollapsedLanes($)
    void start($, polling)
    return next(e)
  })

  // 보드가 없던 세션은 turn 마다 다시 찾는다. `/cd` 로 보드가 있는 디렉터리에 옮겼거나, 그 사이 보드가 이 세션을 메인 세션으로 등록했을 수 있다.
  // mod 에는 디렉터리를 옮긴 것을 알리는 이벤트가 없다(CwdChanged 는 settings 의 hook 이벤트다).
  on('turn.start', async ($, e, next) => {
    if ((await read($, view)).kind == 'none') void start($, polling)
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($) => {
    const text = TEXT[polling.locale]
    const result = await refresh($, polling)
    schedule($, polling, result)
    if (result.kind == 'none') return { text: text.noBoard }
    const placement = await readPlacement($, PLUGIN)
    if (placement) return { text: text.inGrid(placement.tab) }
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: result.kind == 'ok' ? text.opened(result.board.root, result.board.interval_seconds) : text.failed(result.message) }
  })

  // delegate 스킬의 금지 1 을 도구가 지킨다. 판정은 guard 명령이 갖고, 이 훅은 종료 코드만 본다.
  // 1 이면 거절하지 않고 사용자에게 묻는다. 사용자가 직접 하라고 한 작업은 그 질문에서 허용한다. 0 · 3(보드 없음)이면 그대로 넘긴다.
  on('classic.PreToolUse', { tool: GUARDED_TOOLS }, async ($, e, next) => {
    const path = e.tool == 'NotebookEdit' ? e.notebook_path : e.tool == 'Edit' || e.tool == 'Write' ? e.file_path : null
    if (path == null) return next(e)
    const ran = await runSkill($, skillArgv($, ['guard', path, '--session', await $.session.id()]), 30000)
    if (ran.exitCode != 1) return next(e)
    return { ask: ran.stderr.trim() }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => drawBoard($, e, polling, PANE, e.props.bodyColumns))

  // pane-grid 의 grid pane: 빈 칸의 선택지에 이 mod 의 Button 을 더하고, 자기 칸이 이 pane 에 있으면 그 칸을 그린다(규약 §3.3 · §3.5).
  // pane-grid 보다 먼저 로드되면 fillSlot 이 pane-grid 가 그린 slot 을 채우고, 뒤에 로드되면 `cell:<이름>` Box 를 next(e) 뒤에 덧붙인다.
  on('ui.render', { component: 'Pane', requestId: /^grid-/ }, async ($, e, next) => {
    const placement = await readPlacement($, PLUGIN)
    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const offered = offerChoice(below, PLUGIN, placement, choice => <Button key={choice.key} plain label={choice.label} hotkey={choice.hotkey} onPress={() => {}} />)
    if (!placement || placement.requestId != e.requestId) return offered
    const cell = (
      <Box key={`cell:${PLUGIN}`} flexDirection="column">
        {await drawBoard($, e, polling, e.requestId, placement.columns)}
      </Box>
    )
    return fillSlot(offered, PLUGIN, cell) ?? <Box flexDirection="column">{offered}{cell}</Box>
  })

  // matcher 의 참조는 hooks/pane-grid.ts 의 GRID_LAYOUT · GRID_SHOWN 과 같다. 엔진은 $.state.get 의 참조 상수를 export 하지 못하게 해서 여기 다시 적는다.
  // pane-grid 의 값은 이 mod 의 계약(types/index.d.ts)에 없으므로(결정 9) matcher 를 never 로 넘기고, 엔진이 계약 없는 값의 쓰기에 붙이는 StateWrite 로 읽는다.
  on('state.set', { plugin: 'pane-grid' as never, key: 'layout' as never }, async ($, e, next) => {
    const write = e as StateWrite
    const result = await next(e)
    await placeOwnPane($, write.value, write.previous)
    return result
  })

  on('state.set', { plugin: 'pane-grid' as never, key: 'shown' as never }, async ($, e, next) => {
    const write = e as StateWrite
    const result = await next(e)
    await followShown($, polling.motion, write.value)
    return result
  })
}
