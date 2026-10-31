import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { DEFAULT_COLOR, cellProps, colorRuns, columnColor, hasMovingCards, laneFrames, packCells, planTransition, sessionCell } from './frames'
import type { Cell, LaneFrame, Transition, Verdict } from './frames'
import type { Board, BoardView, Locale } from '../types'

// uhd-kanban 보드 모니터. 세션 디렉터리에서 `uhd-kanban board --json` 을 monitor.interval_seconds 마다 실행하고, milestone 마다 한 행(swimlane)을 그린다.
// 행은 머리 줄(상태 기호 · 제목 · 끝낸 수/전체 수)과, 소속 카드 하나를 한 칸으로 그린 누적 막대다. 행이 본문에 들어가지 않으면 pane 을 스크롤한다.
// 머리 줄의 접기 기호와 id 는 Button 이고 누르면 그 행의 막대를 접거나 편다. 접은 행의 목록은 세션 디렉터리마다 $.store 에 둔다.
// 2.1.312 의 Button 은 자식 Text 의 wrap="truncate-end" 를 따르지 않고 줄을 바꾸므로, 길이가 정해지지 않은 milestone 제목은 Button 밖의 Text 로 둔다.
// 격자의 계산은 frames.ts 가 갖고, 이 모듈은 그 격자를 그리고 프레임의 차례를 정한다.
// 보드를 읽는 규칙은 board 명령(같은 플러그인의 skills/uhd-kanban/lib/)이 갖는다. 이 모듈은 그 stdout 을 그리기만 한다.
// pane 의 글은 locale 명령이 낸 언어(ko · en)로 고른다. 언어를 정하는 규칙도 그 명령(lib/i18n.mjs)이 갖는다.

const PANE = 'uhd-kanban-board'
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
const VERDICTS: Verdict[] = ['live', 'pending', 'restart', 'resume', 'done', 'none']
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
    none: '세션 없음',
    description: 'uhd-kanban 보드의 milestone 마다 소속 카드를 pane 에 누적 막대로 그린다',
    noBoard: '이 세션의 디렉터리 위에 .uhd-kanban/config.json 이 없어 pane 을 열지 않았다',
    opened: (root: string, seconds: number) => `${root} 의 보드를 열었다. ${seconds}초마다 다시 읽는다`,
    failed: (message: string) => `board 명령이 실패했다: ${message}`,
    notRun: (command: string, message: string) => `${command} 를 실행하지 못했다: ${message}`,
    exitCode: (code: number) => `종료 코드 ${code}`,
    reading: '보드를 읽는 중이다',
    failedAt: (clock: string) => `board 명령이 실패했다 (${clock})`,
    reload: (command: string) => `/${command} 로 다시 읽는다`,
    header: (clock: string, cards: number, milestones: number, seconds: number) => `${clock} · 카드 ${cards}개 · milestone ${milestones}개 · ${seconds}초마다`,
    noMilestone: '소속 없음',
  },
  en: {
    // uk board 가 출력하는 판정 id 와 같은 낱말이다.
    live: 'live',
    pending: 'pending',
    restart: 'restart',
    resume: 'resume',
    done: 'done',
    none: 'none',
    description: 'Draws the cards of each uhd-kanban board milestone as a stacked bar in a pane',
    noBoard: 'No .uhd-kanban/config.json above this session directory, so the pane was not opened',
    opened: (root: string, seconds: number) => `Opened the board of ${root}. Rereads every ${seconds}s`,
    failed: (message: string) => `The board command failed: ${message}`,
    notRun: (command: string, message: string) => `Could not run ${command}: ${message}`,
    exitCode: (code: number) => `exit code ${code}`,
    reading: 'Reading the board',
    failedAt: (clock: string) => `The board command failed (${clock})`,
    reload: (command: string) => `Reread with /${command}`,
    header: (clock: string, cards: number, milestones: number, seconds: number) => `${clock} · ${cards} cards · ${milestones} milestones · every ${seconds}s`,
    noMilestone: 'no milestone',
  },
} satisfies Record<Locale, unknown>

const view = atom({ plugin: 'uhd-kanban', key: 'view' } as const, { kind: 'none' } as BoardView, { shape: 'view-2' })
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
type Motion = { timer: Timer | null; periodMs: number; frame: number; elapsedMs: number; transition: Transition | null; step: number; last: Board | null; layout: string | null; painted: Map<string, string>; columns: number; isHidden: boolean; collapsed: string[] }

const newMotion = (): Motion => ({ timer: null, periodMs: 0, frame: 0, elapsedMs: 0, transition: null, step: 0, last: null, layout: null, painted: new Map(), columns: 1, isHidden: false, collapsed: [] })

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
const syncTimer = ($: EngineInterface, motion: Motion, board: Board) => {
  const ms = motion.layout == null ? 0 : motion.isHidden ? HIDDEN_CHECK_MS : motion.transition ? TRANSITION_FRAME_MS : hasMovingCards(board) ? STATUS_FRAME_MS : 0
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
    const result = await $.ui.blit({ requestId: PANE, key, cells })
    if (result.deny) return $.ui.invalidate('ui.render')
    motion.painted.set(key, cells)
  }
}

// 탭이 다시 보일 때 엔진은 ui.render 를 실행하지 않고 지난 결과를 쓰며 그 전환을 알리는 이벤트도 없다. 그래서 숨어 있는 동안 HIDDEN_CHECK_MS 마다 확인하고, 다시 보이면 다시 그린다.
// pane 이 닫혔으면 타이머를 끈다. 다시 열면 엔진이 ui.render 를 실행하고 그 훅이 타이머를 켠다.
const advance = async ($: EngineInterface, motion: Motion) => {
  const pane = (await $.ui.panes()).find((item) => item.id == PANE)
  const current = await read($, view)
  if (!pane || current.kind != 'ok') {
    motion.transition = null
    motion.isHidden = false
    return stopTimer(motion)
  }
  if (!pane.isShown) {
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
  const isShown = (await $.ui.panes()).some((item) => item.id == PANE && item.isShown)
  const plan = motion.last && motion.layout != null && isShown ? planTransition(motion.last, board) : null
  motion.last = board
  if (!plan) return
  motion.transition = plan
  motion.step = 0
}

// locale 은 session.start 에서 locale 명령으로 정한다. 정하기 전에 쓰는 값은 en 이다.
type Polling = { timer: Timer | null; periodMs: number; locale: Locale; motion: Motion }

const refresh = async ($: EngineInterface, polling: Polling): Promise<BoardView> => {
  const text = TEXT[polling.locale]
  const cwd = await $.session.root()
  const refreshedAt = await $.clock.now()
  const argv = ['node', `${$.plugin.root}/${SKILL_BIN}`, 'board', '--json']
  const ran = await $.process.run(argv, { cwd, timeoutMs: 60000 }).catch((error) => ({ exitCode: -1, stdout: '', stderr: text.notRun(argv.join(' '), String(error?.message ?? error)) }))
  const result: BoardView = ran.exitCode == 3
    ? { kind: 'none' }
    : ran.exitCode == 0
      ? { kind: 'ok', board: JSON.parse(ran.stdout), refreshedAt }
      : { kind: 'error', message: ran.stderr.trim() || text.exitCode(ran.exitCode), refreshedAt }
  if (result.kind == 'ok') await beginTransition($, polling.motion, result.board)
  await update($, view, () => result)
  return result
}

// 주기는 board 가 낸 interval_seconds 다. 보드가 없으면 멈추고, board 가 실패하면 마지막 주기를 그대로 둔다.
const schedule = ($: EngineInterface, polling: Polling, result: BoardView) => {
  if (result.kind == 'error') return
  const ms = result.kind == 'ok' ? result.board.interval_seconds * 1000 : 0
  if (ms == polling.periodMs) return
  polling.timer?.cancel()
  polling.timer = ms == 0 ? null : $.clock.every(ms, () => void tick($, polling))
  polling.periodMs = ms
}

// pane 이 닫혀 있으면 board 를 실행하지 않는다.
const tick = async ($: EngineInterface, polling: Polling) => {
  const isOpen = (await $.ui.panes()).some((pane) => pane.id == PANE)
  if (!isOpen) return
  schedule($, polling, await refresh($, polling))
}

// locale 명령이 실패하면(node 가 없는 등) en 으로 둔다. 실패한 이유는 다음 board 실행이 pane 에 낸다.
const resolveLocale = async ($: EngineInterface): Promise<Locale> => {
  const argv = ['node', `${$.plugin.root}/${SKILL_BIN}`, 'locale']
  const ran = await $.process.run(argv, { cwd: await $.session.root(), timeoutMs: 30000 }).catch(() => null)
  const value = ran?.exitCode == 0 ? ran.stdout.trim() : ''
  return value in TEXT ? (value as Locale) : 'en'
}

const start = async ($: EngineInterface, polling: Polling) => {
  const result = await refresh($, polling)
  schedule($, polling, result)
  if (result.kind != 'none') await $.ui.open({ id: PANE, title: TITLE })
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

  on('command.run', { command: COMMAND }, async ($) => {
    const text = TEXT[polling.locale]
    const result = await refresh($, polling)
    schedule($, polling, result)
    if (result.kind == 'none') return { text: text.noBoard }
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: result.kind == 'ok' ? text.opened(result.board.root, result.board.interval_seconds) : text.failed(result.message) }
  })

  // delegate 스킬의 금지 1 을 도구가 지킨다. 판정은 guard 명령이 갖고, 이 훅은 종료 코드만 본다.
  // 1 이면 거절하지 않고 사용자에게 묻는다. 사용자가 직접 하라고 한 작업은 그 질문에서 허용한다. 0 · 3(보드 없음)이면 그대로 넘긴다.
  on('classic.PreToolUse', { tool: GUARDED_TOOLS }, async ($, e, next) => {
    const path = e.tool == 'NotebookEdit' ? e.notebook_path : e.tool == 'Edit' || e.tool == 'Write' ? e.file_path : null
    if (path == null) return next(e)
    const argv = ['node', `${$.plugin.root}/${SKILL_BIN}`, 'guard', path, '--session', await $.session.id()]
    const ran = await $.process.run(argv, { cwd: await $.session.root(), timeoutMs: 30000 })
    if (ran.exitCode != 1) return next(e)
    return { ask: ran.stderr.trim() }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const Raster = e.surface == 'terminal' ? $.ui.resolve(e).Raster : null
    const { motion } = polling
    const text = TEXT[polling.locale]
    const current = await read($, view)
    if (current.kind != 'ok') {
      motion.layout = null
      stopTimer(motion)
    }
    if (current.kind == 'none') return <Text dimColor>{text.reading}</Text>
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
    motion.columns = Math.max(1, e.props.bodyColumns)
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
            <Text dimColor> {lane.finished}/{lane.total}</Text>
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
        {lanes.map(laneBlock)}
      </Box>
    )
  })
}
