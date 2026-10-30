import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { boardGrid, cellProps, colorRuns, columnColor, hasMovingCards, packCells, planTransition, restingSlots, sessionCell, transitionSlots } from './frames'
import type { Body, Transition, Verdict } from './frames'
import type { Board, BoardView, Locale } from '../types'

// uhd-kanban 보드 모니터. 세션 디렉터리에서 `uhd-kanban board --json` 을 monitor.interval_seconds 마다 실행하고, 카드 하나를 막대의 한 칸으로 그린다.
// 열마다 카드 수가 맨 위에 있고 막대는 아래로 자란다. 카드 한 장이 차지하는 칸은 board 가 낸 cell(config.json 의 monitor.cell)이 정한다.
// 가장 긴 막대가 본문 행에 들어가지 않으면 pane 을 스크롤한다. 격자의 계산은 frames.ts 가 갖고, 이 모듈은 그 격자를 그리고 프레임의 차례를 정한다.
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
const RASTER_KEY = 'board'
const MAX_RASTER_COLUMNS = 512
const MAX_RASTER_ROWS = 256
// run.status 열의 칸만 세션 판정(sessions.mjs 의 cardSession)으로 글자 · 색을 바꾼다. 범례의 차례이고, 판정 이름은 TEXT 의 키다.
const VERDICTS: Verdict[] = ['live', 'pending', 'restart', 'resume', 'done', 'none']

// skills/uhd-kanban/lib/messages/*.mjs 와 같은 언어 목록이다. 이 모듈은 그 표를 읽지 못하므로 pane 의 글만 따로 둔다.
const TEXT = {
  ko: {
    live: '돈다',
    pending: '다시 뜨는 중',
    restart: '재시작 대기',
    resume: '이어 가기 대기',
    done: '끝남',
    none: '세션 없음',
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
    // uk board 가 출력하는 판정 id 와 같은 낱말이다.
    live: 'live',
    pending: 'pending',
    restart: 'restart',
    resume: 'resume',
    done: 'done',
    none: 'none',
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

const clockText = (ms: number) => {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// 범례 한 항목은 글자 하나 · 판정 이름 · 공백 하나다. 한글은 터미널에서 2칸을 쓴다(UAX #11 의 Wide).
const displayWidth = (text: string) => [...text].reduce((sum, char) => sum + (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/.test(char) ? 2 : 1), 0)

const legendLines = (prefix: string, label: (verdict: Verdict) => string, columns: number) => VERDICTS.reduce((lines: Verdict[][], verdict) => {
  const last = lines.at(-1) ?? []
  const used = displayWidth(lines.length == 1 ? prefix : '') + last.reduce((sum, item) => sum + 2 + displayWidth(label(item)), 0)
  if (last.length > 0 && used + 2 + displayWidth(label(verdict)) > columns) return [...lines, [verdict]]
  last.push(verdict)
  return lines
}, [[]])

// 재생 상태. 모듈을 다시 읽으면 처음부터 시작하고 첫 읽기는 재배치를 재생하지 않는다.
// frame: 판정 칸의 프레임. elapsedMs: frame 을 정하는 누적 시간. last: 재배치를 비교할 직전 board 결과.
// canvas: 지금 그려진 Raster 의 크기. Text 로 그렸으면 null 이고 이때는 타이머를 돌리지 않는다. isHidden: 다른 탭 뒤에 있다.
type Motion = { timer: Timer | null; periodMs: number; frame: number; elapsedMs: number; transition: Transition | null; step: number; last: Board | null; canvas: { columns: number; rows: number } | null; body: Body; isHidden: boolean }

const newMotion = (): Motion => ({ timer: null, periodMs: 0, frame: 0, elapsedMs: 0, transition: null, step: 0, last: null, canvas: null, body: { columns: 1, rows: 1 }, isHidden: false })

const currentGrid = (board: Board, motion: Motion) => {
  const { transition, step, frame, body } = motion
  if (!transition) return boardGrid(board, restingSlots(board), frame, body)
  return boardGrid(board, transitionSlots(transition, step), frame, body, transition.reserve)
}

// 재배치 중이면 짧은 간격, 움직이는 판정의 카드가 있으면 긴 간격이고, 둘 다 아니면 타이머를 끈다.
const syncTimer = ($: EngineInterface, motion: Motion, board: Board) => {
  const ms = !motion.canvas ? 0 : motion.isHidden ? HIDDEN_CHECK_MS : motion.transition ? TRANSITION_FRAME_MS : hasMovingCards(board) ? STATUS_FRAME_MS : 0
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

// 격자 크기가 그려진 Raster 와 다르면(카드 수 줄이 늘었을 때 · 재배치의 시작과 끝) blit 이 거절되므로 다시 그린다.
const paint = async ($: EngineInterface, motion: Motion, board: Board) => {
  const grid = currentGrid(board, motion)
  const { canvas } = motion
  if (!canvas) return
  if (grid.length != canvas.rows || grid[0]?.length != canvas.columns) return $.ui.invalidate('ui.render')
  const result = await $.ui.blit({ requestId: PANE, key: RASTER_KEY, cells: packCells(grid) })
  if (result.deny) $.ui.invalidate('ui.render')
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
  const plan = motion.last && motion.canvas && isShown ? planTransition(motion.last, board) : null
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
    const Raster = e.surface == 'terminal' ? $.ui.resolve(e).Raster : null
    const { motion } = polling
    const text = TEXT[polling.locale]
    const current = await read($, view)
    if (current.kind != 'ok') {
      motion.canvas = null
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
    const prefix = `${board.run_status}: `
    const legend = legendLines(prefix, (verdict) => text[verdict], e.props.bodyColumns)
    motion.body = { columns: e.props.bodyColumns, rows: e.props.scroll.bodyRows - 1 - legend.length }
    const grid = currentGrid(board, motion)
    const columns = grid[0]?.length ?? 0
    motion.canvas = Raster && grid.length <= MAX_RASTER_ROWS && columns <= MAX_RASTER_COLUMNS ? { columns, rows: grid.length } : null
    if (!motion.canvas) motion.transition = null
    syncTimer($, motion, board)
    const total = board.columns.reduce((sum, column) => sum + column.count, 0)
    const runIndex = board.columns.findIndex((column) => column.status == board.run_status)
    const legendItem = (verdict: Verdict) => {
      const cell = sessionCell(verdict, 0, 0, columnColor(Math.max(0, runIndex)))
      return <Text><Text {...cellProps(cell)}>{cell.glyph}</Text><Text dimColor>{text[verdict]} </Text></Text>
    }
    const textRows = () => grid.map((row) => <Text wrap="truncate-end">{colorRuns(row).map((run) => <Text color={run.color} backgroundColor={run.backgroundColor}>{run.text}</Text>)}</Text>)
    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">{text.header(clockText(current.refreshedAt), board.columns.length, total, board.interval_seconds)}</Text>
        {legend.map((verdicts, index) => (
          <Text wrap="truncate-end">
            {index == 0 ? <Text dimColor>{prefix}</Text> : null}
            {verdicts.map(legendItem)}
          </Text>
        ))}
        {Raster && motion.canvas ? <Raster key={RASTER_KEY} columns={motion.canvas.columns} rows={motion.canvas.rows} cells={packCells(grid)} /> : textRows()}
      </Box>
    )
  })
}
