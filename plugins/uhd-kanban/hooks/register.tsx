import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Board, BoardCard, BoardColumn, BoardView } from '../types'

// uhd-kanban 보드 모니터. 세션 디렉터리에서 `uhd-kanban board --json` 을 monitor.interval_seconds 마다 실행하고, 카드 하나를 막대의 한 칸으로 그린다.
// 축(열마다 카드 수)이 맨 위에 있고 막대는 아래로 자란다. 막대 폭은 가장 긴 막대가 본문 행에 들어가도록 정하고, 그래도 넘치면 pane 을 스크롤한다.
// 보드를 읽는 규칙은 board 명령(같은 플러그인의 skills/uhd-kanban/lib/)이 갖는다. 이 모듈은 그 stdout 을 그리기만 한다.

const PANE = 'uhd-kanban-board'
// 같은 플러그인에 든 스킬의 명령. 플러그인 폴더(plugin.json 이 든 폴더)에서 센다.
const SKILL_BIN = 'skills/uhd-kanban/bin/uhd-kanban.mjs'
const TITLE = 'uhd-kanban'
const COMMAND = 'kanban-board'
const CELL = '█'
const AXIS = '─'
const GAP = 1
// 갱신 시각 · 범례 · 카드 수 · 축. 막대가 쓸 수 있는 행은 본문 행에서 이것을 뺀 것이다.
const HEADER_ROWS = 4
// 열의 차례(config.json 의 columns 순서)로 고른다. 열이 이보다 많으면 처음부터 다시 쓴다.
const COLUMN_COLORS = ['#58a6ff', '#d29922', '#a371f7', '#39c5cf', '#f778ba', '#7ee787', '#ffa657', '#6e7681', '#ff7b72']
// run.status 열의 칸만 세션 판정(sessions.mjs 의 cardSession)으로 색을 바꾼다. none(세션 없음)은 열의 색을 쓴다.
const SESSIONS = [
  { verdict: 'live', color: 'success', label: '돈다' },
  { verdict: 'pending', color: 'warning', label: '다시 뜨는 중' },
  { verdict: 'restart', color: 'error', label: '멈춤' },
  { verdict: 'resume', color: 'error', label: '멈춤' },
  { verdict: 'done', color: 'subtle', label: '끝남' },
]
const LEGEND = SESSIONS.filter((item, index) => SESSIONS.findIndex((other) => other.label == item.label) == index)

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

// 가장 긴 막대가 rows 행에 들어가는 가장 좁은 폭. 카드 수의 자릿수보다 좁게 하지 않고, 열이 모두 columns 칸에 들어가는 폭보다 넓게 하지 않는다.
const barWidth = (board: Board, columns: number, rows: number) => {
  const count = board.columns.length
  const most = Math.max(1, ...board.columns.map((column) => column.count))
  const widest = Math.max(1, Math.floor((columns - GAP * (count - 1)) / count))
  const fitting = Math.ceil(most / Math.max(1, rows))
  return Math.max(String(most).length, Math.min(widest, fitting))
}

// 막대의 한 행. 같은 색이 이어지는 칸은 한 조각으로 묶는다.
const barRow = (board: Board, column: BoardColumn, index: number, row: number, width: number) => {
  const cards = column.cards.slice(row * width, row * width + width)
  const segments = cards.reduce((list: Segment[], card) => {
    const color = cellColor(board, column, index, card)
    const last = list.at(-1)
    if (last && last.color == color) return [...list.slice(0, -1), { text: last.text + CELL, color }]
    return [...list, { text: CELL, color }]
  }, [])
  return width > cards.length ? [...segments, { text: ' '.repeat(width - cards.length) }] : segments
}

const joinColumns = (parts: Segment[][]) => parts.flatMap((segments, index) => (index == 0 ? segments : [{ text: ' '.repeat(GAP) }, ...segments]))

type Polling = { timer: Timer | null; periodMs: number }

const refresh = async ($: EngineInterface): Promise<BoardView> => {
  const cwd = await $.session.root()
  const refreshedAt = await $.clock.now()
  const argv = ['node', `${$.plugin.root}/${SKILL_BIN}`, 'board', '--json']
  const ran = await $.process.run(argv, { cwd, timeoutMs: 60000 }).catch((error) => ({ exitCode: -1, stdout: '', stderr: `${argv.join(' ')} 를 실행하지 못했다: ${error?.message ?? error}` }))
  const result: BoardView = ran.exitCode == 3
    ? { kind: 'none' }
    : ran.exitCode == 0
      ? { kind: 'ok', board: JSON.parse(ran.stdout), refreshedAt }
      : { kind: 'error', message: ran.stderr.trim() || `종료 코드 ${ran.exitCode}`, refreshedAt }
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
  schedule($, polling, await refresh($))
}

const start = async ($: EngineInterface, polling: Polling) => {
  const result = await refresh($)
  schedule($, polling, result)
  if (result.kind != 'none') await $.ui.open({ id: PANE, title: TITLE })
}

// 타이머는 모듈을 다시 읽으면 엔진이 버린다. 그래서 상태도 register 가 돌 때마다 새로 만든다.
export const register: Register = (on) => {
  const polling: Polling = { timer: null, periodMs: 0 }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: 'uhd-kanban 보드의 열마다 카드 수를 pane 에 막대로 그린다' })
    void start($, polling)
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($) => {
    const result = await refresh($)
    schedule($, polling, result)
    if (result.kind == 'none') return { text: '이 세션의 디렉터리 위에 .uhd-kanban/config.json 이 없어 pane 을 열지 않았다' }
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: result.kind == 'ok' ? `${result.board.root} 의 보드를 열었다. ${result.board.interval_seconds}초마다 다시 읽는다` : `board 명령이 실패했다: ${result.message}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const current = await read($, view)
    if (current.kind == 'none') return <Text dimColor>보드를 읽는 중이다</Text>
    if (current.kind == 'error') {
      return (
        <Box flexDirection="column">
          <Text color="error">board 명령이 실패했다 ({clockText(current.refreshedAt)})</Text>
          <Text>{current.message}</Text>
          <Text dimColor>/{COMMAND} 로 다시 읽는다</Text>
        </Box>
      )
    }
    const { board } = current
    const width = barWidth(board, e.props.bodyColumns, e.props.scroll.bodyRows - HEADER_ROWS)
    const height = Math.max(0, ...board.columns.map((column) => Math.ceil(column.count / width)))
    const total = board.columns.reduce((sum, column) => sum + column.count, 0)
    const counts = joinColumns(board.columns.map((column, index) => [{ text: String(column.count).padEnd(width), color: columnColor(index) }]))
    const axis = joinColumns(board.columns.map((column, index) => [{ text: AXIS.repeat(width), color: columnColor(index) }]))
    const rows = Array.from({ length: height }, (_, row) => joinColumns(board.columns.map((column, index) => barRow(board, column, index, row, width))))
    const line = (segments: Segment[]) => (
      <Text wrap="truncate-end">{segments.map((segment) => (segment.color ? <Text color={segment.color}>{segment.text}</Text> : segment.text))}</Text>
    )
    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">{clockText(current.refreshedAt)} · 열 {board.columns.length}개 · 카드 {total}개 · {board.interval_seconds}초마다</Text>
        <Text wrap="truncate-end">
          <Text dimColor>{board.run_status}: </Text>
          {LEGEND.map((item) => <Text color={item.color}>{CELL}{item.label} </Text>)}
        </Text>
        {line(counts)}
        {line(axis)}
        {rows.map(line)}
      </Box>
    )
  })
}
