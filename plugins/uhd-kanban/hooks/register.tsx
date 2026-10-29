import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Board, BoardCard, BoardColumn, BoardView, Locale } from '../types'

// uhd-kanban 보드 모니터. 세션 디렉터리에서 `uhd-kanban board --json` 을 monitor.interval_seconds 마다 실행하고, 카드 하나를 막대의 한 칸으로 그린다.
// 축(열마다 카드 수)이 맨 위에 있고 막대는 아래로 자란다. 카드 한 장이 차지하는 칸은 board 가 낸 cell(config.json 의 monitor.cell)이 정한다.
// 가장 긴 막대가 본문 행에 들어가지 않으면 pane 을 스크롤한다.
// 보드를 읽는 규칙은 board 명령(같은 플러그인의 skills/uhd-kanban/lib/)이 갖는다. 이 모듈은 그 stdout 을 그리기만 한다.
// pane 의 글은 locale 명령이 낸 언어(ko · en)로 고른다. 언어를 정하는 규칙도 그 명령(lib/i18n.mjs)이 갖는다.

const PANE = 'uhd-kanban-board'
// 같은 플러그인에 든 스킬의 명령. 플러그인 폴더(plugin.json 이 든 폴더)에서 센다.
const SKILL_BIN = 'skills/uhd-kanban/bin/uhd-kanban.mjs'
const TITLE = 'uhd-kanban'
const COMMAND = 'kanban-board'
// 메인 세션에서 guard 명령으로 판정하는 도구. 이 셋의 입력은 고칠 파일을 file_path · notebook_path 로 갖는다.
const GUARDED_TOOLS = ['Edit', 'Write', 'NotebookEdit'] as const
const CELL = '█'
const AXIS = '─'
const GAP = 1
// 갱신 시각 · 범례 · 카드 수 · 축. 막대가 쓸 수 있는 행은 본문 행에서 이것을 뺀 것이다.
const HEADER_ROWS = 4
// 열의 차례(config.json 의 columns 순서)로 고른다. 열이 이보다 많으면 처음부터 다시 쓴다.
const COLUMN_COLORS = ['#58a6ff', '#d29922', '#a371f7', '#39c5cf', '#f778ba', '#7ee787', '#ffa657', '#6e7681', '#ff7b72']
// run.status 열의 칸만 세션 판정(sessions.mjs 의 cardSession)으로 색을 바꾼다. none(세션 없음)은 열의 색을 쓴다.
// label 은 TEXT 의 키다. restart · resume 은 같은 이름(멈춤)으로 범례에 한 번만 낸다.
const SESSIONS = [
  { verdict: 'live', color: 'success', label: 'live' },
  { verdict: 'pending', color: 'warning', label: 'pending' },
  { verdict: 'restart', color: 'error', label: 'stalled' },
  { verdict: 'resume', color: 'error', label: 'stalled' },
  { verdict: 'done', color: 'subtle', label: 'done' },
] as const
const LEGEND = SESSIONS.filter((item, index) => SESSIONS.findIndex((other) => other.label == item.label) == index)

// skills/uhd-kanban/lib/messages/*.mjs 와 같은 언어 목록이다. 이 모듈은 그 표를 읽지 못하므로 pane 의 글만 따로 둔다.
const TEXT = {
  ko: {
    live: '돈다',
    pending: '다시 뜨는 중',
    stalled: '멈춤',
    done: '끝남',
    description: 'uhd-kanban 보드의 열마다 카드 수를 pane 에 막대로 그린다',
    noBoard: '이 세션의 디렉터리 위에 .uhd-kanban/config.json 이 없어 pane 을 열지 않았다',
    opened: (root: string, seconds: number) => `${root} 의 보드를 열었다. ${seconds}초마다 다시 읽는다`,
    failed: (message: string) => `board 명령이 실패했다: ${message}`,
    notRun: (command: string, message: string) => `${command} 를 실행하지 못했다: ${message}`,
    exitCode: (code: number) => `종료 코드 ${code}`,
    reading: '보드를 읽는 중이다',
    failedAt: (clock: string) => `board 명령이 실패했다 (${clock})`,
    reload: (command: string) => `/${command} 로 다시 읽는다`,
    header: (clock: string, columns: number, cards: number, seconds: number) => `${clock} · 열 ${columns}개 · 카드 ${cards}개 · ${seconds}초마다`,
  },
  en: {
    // uk board 가 출력하는 판정 id 와 같은 낱말이다. 범례 한 줄이 기본 pane 폭(45칸)에 들어가야 한다.
    live: 'live',
    pending: 'pending',
    stalled: 'stalled',
    done: 'done',
    description: 'Draws the card count of each uhd-kanban board column as a bar in a pane',
    noBoard: 'No .uhd-kanban/config.json above this session directory, so the pane was not opened',
    opened: (root: string, seconds: number) => `Opened the board of ${root}. Rereads every ${seconds}s`,
    failed: (message: string) => `The board command failed: ${message}`,
    notRun: (command: string, message: string) => `Could not run ${command}: ${message}`,
    exitCode: (code: number) => `exit code ${code}`,
    reading: 'Reading the board',
    failedAt: (clock: string) => `The board command failed (${clock})`,
    reload: (command: string) => `Reread with /${command}`,
    header: (clock: string, columns: number, cards: number, seconds: number) => `${clock} · ${columns} columns · ${cards} cards · every ${seconds}s`,
  },
} satisfies Record<Locale, unknown>

const view = atom({ plugin: 'uhd-kanban', key: 'view' } as const, { kind: 'none' } as BoardView, { shape: 'view-1' })

type Segment = { text: string; color?: string }

const columnColor = (index: number) => COLUMN_COLORS[index % COLUMN_COLORS.length]

const cellColor = (board: Board, column: BoardColumn, index: number, card: BoardCard) => {
  if (column.status != board.run_status) return columnColor(index)
  return SESSIONS.find((item) => item.verdict == card.session)?.color ?? columnColor(index)
}

const clockText = (ms: number) => {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// width: 막대 폭. perRow: 한 행의 카드 수. cell: 카드 한 장의 칸 폭(문자 수).
// widest 는 열이 모두 columns 칸에 들어가는 가장 넓은 폭, fitting 은 가장 긴 막대가 rows 행에 들어가는 한 행의 카드 수다.
// 막대 폭은 어느 방식이든 카드 수의 자릿수보다 좁게 하지 않는다.
//   char: 카드 한 장이 문자 하나다. 막대 폭은 fitting 이고 widest 를 넘지 않는다.
//   row:  카드 한 장이 막대의 한 행이다. 막대 폭은 widest 다.
//   fit:  막대 폭은 widest 이고, 한 행의 카드 수는 fitting(widest 를 넘지 않는다), 칸 폭은 막대 폭을 그 수로 나눈 몫이다.
type Layout = { width: number; perRow: number; cell: number }

const layout = (board: Board, columns: number, rows: number): Layout => {
  const count = board.columns.length
  const most = Math.max(1, ...board.columns.map((column) => column.count))
  const digits = String(most).length
  const widest = Math.max(1, Math.floor((columns - GAP * (count - 1)) / count))
  const fitting = Math.ceil(most / Math.max(1, rows))
  if (board.cell == 'row') {
    const width = Math.max(digits, widest)
    return { width, perRow: 1, cell: width }
  }
  if (board.cell == 'fit') {
    const width = Math.max(digits, widest)
    const perRow = Math.min(width, fitting)
    return { width, perRow, cell: Math.floor(width / perRow) }
  }
  const width = Math.max(digits, Math.min(widest, fitting))
  return { width, perRow: width, cell: 1 }
}

// 막대의 한 행. 같은 색이 이어지는 칸은 한 조각으로 묶는다.
const barRow = (board: Board, column: BoardColumn, index: number, row: number, { width, perRow, cell }: Layout) => {
  const cards = column.cards.slice(row * perRow, row * perRow + perRow)
  const block = CELL.repeat(cell)
  const segments = cards.reduce((list: Segment[], card) => {
    const color = cellColor(board, column, index, card)
    const last = list.at(-1)
    if (last && last.color == color) return [...list.slice(0, -1), { text: last.text + block, color }]
    return [...list, { text: block, color }]
  }, [])
  const used = cards.length * cell
  return width > used ? [...segments, { text: ' '.repeat(width - used) }] : segments
}

const joinColumns = (parts: Segment[][]) => parts.flatMap((segments, index) => (index == 0 ? segments : [{ text: ' '.repeat(GAP) }, ...segments]))

// locale 은 session.start 에서 locale 명령으로 정한다. 정하기 전에 쓰는 값은 en 이다.
type Polling = { timer: Timer | null; periodMs: number; locale: Locale }

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
  const polling: Polling = { timer: null, periodMs: 0, locale: 'en' }

  on('session.start', async ($, e, next) => {
    polling.locale = await resolveLocale($)
    await $.command.register({ name: COMMAND, description: TEXT[polling.locale].description })
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
    const { Box, Text } = $.ui.resolve(e)
    const text = TEXT[polling.locale]
    const current = await read($, view)
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
    const size = layout(board, e.props.bodyColumns, e.props.scroll.bodyRows - HEADER_ROWS)
    const { width } = size
    const height = Math.max(0, ...board.columns.map((column) => Math.ceil(column.count / size.perRow)))
    const total = board.columns.reduce((sum, column) => sum + column.count, 0)
    const counts = joinColumns(board.columns.map((column, index) => [{ text: String(column.count).padEnd(width), color: columnColor(index) }]))
    const axis = joinColumns(board.columns.map((column, index) => [{ text: AXIS.repeat(width), color: columnColor(index) }]))
    const rows = Array.from({ length: height }, (_, row) => joinColumns(board.columns.map((column, index) => barRow(board, column, index, row, size))))
    const line = (segments: Segment[]) => (
      <Text wrap="truncate-end">{segments.map((segment) => (segment.color ? <Text color={segment.color}>{segment.text}</Text> : segment.text))}</Text>
    )
    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">{text.header(clockText(current.refreshedAt), board.columns.length, total, board.interval_seconds)}</Text>
        <Text wrap="truncate-end">
          <Text dimColor>{board.run_status}: </Text>
          {LEGEND.map((item) => <Text color={item.color}>{CELL}{text[item.label]} </Text>)}
        </Text>
        {line(counts)}
        {line(axis)}
        {rows.map(line)}
      </Box>
    )
  })
}
