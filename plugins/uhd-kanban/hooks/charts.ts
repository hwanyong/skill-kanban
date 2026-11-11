import type { BoardLane, BoardMetrics } from '../types'

// pane 의 그래프 줄(처리량 · 유입 · 활동)과 milestone 예상 일수를 계산한다. 엔진(`$`)을 부르지 않는다. 그리기는 register.tsx 가 갖는다.
// run.status 카드의 마지막 활동 줄에 적는 카드의 차례(stalestFirst)도 이 모듈이 정한다.
// 값을 세는 규칙은 board 명령(lib/metrics.mjs)이 갖고, 이 모듈은 그 값을 글자로 바꾼다.

// sparkline 의 높이 8단계. 0 은 맨 아래 칸을 흐린 색으로 그려 「값이 0」과 「값이 작다」를 가른다. 0 이 아닌 값은 둘째 칸부터다.
const LEVELS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

// isZero: 값이 0 이다. 그리는 쪽이 흐린 색으로 그린다.
type SparkCell = { glyph: string; isZero: boolean }

// max 는 여러 줄이 같은 높이 기준을 쓰도록 밖에서 준다(처리량과 유입은 같은 max 다).
export const sparkline = (values: number[], max: number): SparkCell[] => values.map((value) => {
  if (value <= 0 || max <= 0) return { glyph: LEVELS[0] ?? ' ', isZero: true }
  const level = 1 + Math.round(((LEVELS.length - 2) * value) / max)
  return { glyph: LEVELS[Math.min(level, LEVELS.length - 1)] ?? ' ', isZero: false }
})

// 이어진 같은 isZero 칸을 한 조각으로 묶는다. Text 하나에 색 하나라서다.
export const sparkRuns = (cells: SparkCell[]) => cells.reduce((runs: { text: string; isZero: boolean }[], cell) => {
  const last = runs.at(-1)
  if (last && last.isZero == cell.isZero) last.text += cell.glyph
  else runs.push({ text: cell.glyph, isZero: cell.isZero })
  return runs
}, [])

export const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

// 마지막 window_days 일 동안 끝낸 카드 수와 만든 카드 수.
export const windowTotals = (metrics: BoardMetrics) => {
  const week = metrics.days.slice(-metrics.window_days)
  return { finished: sum(week.map((day) => day.finished)), created: sum(week.map((day) => day.created)) }
}

// 처리량과 유입 줄이 함께 그리는 날짜와 높이 기준. 날짜 수는 두 줄의 sparkline 폭(widths) 중 좁은 쪽에 맞춰 최근 날짜부터 고른다.
export const sharedDays = (days: BoardMetrics['days'], widths: number[]) => {
  const dayCount = Math.min(days.length, ...widths)
  const shownDays = days.slice(days.length - dayCount)
  const dayMax = Math.max(...shownDays.map((day) => Math.max(day.finished, day.created)), 0)
  return { shownDays, dayMax }
}

// 마지막 활동이 오래된 카드부터 적는다. 활동 코멘트도 session_started_at 도 없는 카드가 맨 앞이다.
// 그런 카드끼리는 0 을 돌려준다. toSorted 는 안정 정렬이라 그 카드들은 metrics.running 의 보드 차례를 따른다.
export const stalestFirst = (running: BoardMetrics['running']) => running.toSorted((a, b) => (a.last_activity_at == null && b.last_activity_at == null ? 0 : a.last_activity_at == null ? -1 : b.last_activity_at == null ? 1 : Date.parse(a.last_activity_at) - Date.parse(b.last_activity_at)))

// 남은 소속 카드를 window_days 일의 처리 속도로 끝내는 데 걸리는 일수(올림). 남은 카드가 없거나 그 기간에 끝난 카드가 없으면 null 이다.
// 남은 수는 finished · total 로 센다(끝난 열 전부). 속도는 completed_at 만 센다(metrics.mjs). 그래서 cancelled 로 끝나는 카드가 많으면 실제보다 길게 나온다.
export const etaDays = (lane: BoardLane, windowDays: number) => {
  const remaining = lane.total - lane.finished
  if (remaining <= 0 || lane.recent_finished <= 0) return null
  return Math.ceil((remaining * windowDays) / lane.recent_finished)
}

// 경과 시간을 가장 큰 단위 하나로 나타낸다. 1시간 미만은 분, 48시간 미만은 시간, 그 위는 일이다.
export type Age = { value: number; unit: 'minute' | 'hour' | 'day' }

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

export const ageOf = (ms: number): Age => {
  const age = Math.max(0, ms)
  if (age < HOUR_MS) return { value: Math.floor(age / MINUTE_MS), unit: 'minute' }
  if (age < 48 * HOUR_MS) return { value: Math.floor(age / HOUR_MS), unit: 'hour' }
  return { value: Math.floor(age / (24 * HOUR_MS)), unit: 'day' }
}
