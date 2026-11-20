// `uhd-kanban board --json` 의 stdout 과 같은 모양이다. 그 명령이 이 값의 원본이다.
export type BoardCard = { id: number; status: string; session?: 'live' | 'pending' | 'restart' | 'resume' | 'done' | 'unknown' | 'none' }
// 작업 카드를 받는 열. index: config.json 의 columns 안의 차례. count 는 milestone 을 세지 않는다.
export type BoardColumn = { status: string; dir: string; index: number; count: number }
// 끝나지 않은 milestone 하나, 또는 collection 이 빈 카드(key 'none', id · title · status 는 null). finished · total 은 아카이브한 소속 카드를 포함해 센다.
// recent_finished: metrics.window_days 일 안에 completed_at 이 적힌 소속 작업 카드 수(아카이브 포함).
export type BoardLane = { key: string; id: number | null; title: string | null; status: string | null; is_running: boolean; finished: number; total: number; recent_finished: number; cards: BoardCard[] }
// 그래프의 값. 세는 규칙은 skills/uhd-kanban/lib/metrics.mjs 가 갖는다. days · hours 는 오래된 것부터이고 날짜는 보드를 읽은 Mac 의 시간대다.
// finished: completed_at 이 그 날짜인 작업 카드 수. created: created_at 이 그 날짜인 작업 카드 수. hours: 1시간마다의 활동 코멘트(progress · result · done-evidence) 수.
// running: run.status 열의 작업 카드. last_activity_at 은 활동 코멘트와 session_started_at 중 늦은 시각이고, 둘 다 없으면 null 이다.
export type BoardMetrics = {
  window_days: number
  days: { date: string; finished: number; created: number }[]
  hours: number[]
  last_activity_at: string | null
  running: { id: number; last_activity_at: string | null }[]
}
export type Board = { root: string; interval_seconds: number; run_status: string; columns: BoardColumn[]; metrics: BoardMetrics; lanes: BoardLane[] }

// skills/uhd-kanban/lib/i18n.mjs 의 LOCALES 와 같다. `uhd-kanban locale` 의 stdout 이 이 값 중 하나다.
export type Locale = 'ko' | 'en'

// reading: board 를 아직 한 번도 실행하지 않았다. none: 보드를 찾지 못했다(board 의 종료 코드 3). error: board 가 다른 종료 코드로 끝났거나 실행되지 않았다.
export type BoardView =
  | { kind: 'reading' }
  | { kind: 'none' }
  | { kind: 'ok'; board: Board; refreshedAt: number }
  | { kind: 'error'; message: string; refreshedAt: number }

// `uhd-kanban flow --json` 의 stdout 과 같은 모양이다. 그 명령(skills/uhd-kanban/lib/commands/flow.mjs)이 이 값의 원본이다.
// FlowGroup: board 의 swimlane 과 같은 묶음. started_at: 소속 카드의 session_started_at 중 가장 이른 값. cards: 소속 카드 id(보드 차례, 아카이브 포함).
export type FlowGroup = { key: string; id: number | null; title: string | null; status: string | null; is_running: boolean; finished: number; total: number; started_at: string | null; cards: number[] }
// verdict 는 run.status 열 카드에만 있다. column_index: config.json 의 columns 안의 차례. dependents: 이 카드를 depends_on 에 적은 작업 카드.
// progress · result: 마지막 그 종류 코멘트의 본문(1000자에서 자른다). transcript: 대화 기록 파일 경로.
export type FlowCard = {
  id: number
  title: string | null
  status: string
  column_index: number | null
  depends_on: number[]
  dependents: number[]
  verdict: NonNullable<BoardCard['session']> | null
  session: string | null
  started_at: string | null
  completed_at: string | null
  last_activity_at: string | null
  commits: number
  progress: string | null
  result: string | null
  transcript: string | null
}
// 카드 코멘트(kind · card 가 있다)와 message-log(둘 다 null)를 시각 차례로 합친 최근 200개. text 는 200자에서 자른다.
export type FlowMessage = { at: string; from: string | null; to: string; kind: string | null; card: number | null; text: string | null }
export type Flow = {
  root: string
  interval_seconds: number
  run_status: string
  max_parallel: number
  main: string | null
  working: number
  columns: { status: string; index: number }[]
  groups: FlowGroup[]
  cards: FlowCard[]
  messages: FlowMessage[]
}
// kind 의 뜻은 BoardView 와 같고, 실행한 명령이 flow 다.
export type FlowView =
  | { kind: 'reading' }
  | { kind: 'none' }
  | { kind: 'ok'; flow: Flow; refreshedAt: number }
  | { kind: 'error'; message: string; refreshedAt: number }
// 세션 흐름 view 에서 고른 것. group: 묶음 key(null 이면 기본 묶음). selected: 상세를 보는 카드 id.
export type FlowSettings = { group: string | null; direction: 'down' | 'right'; size: 'full' | 'compact'; selected: number | null }

declare module 'claude-code' {
  interface PluginState {
    'uhd-kanban': { view: Shaped<BoardView>; collapsedLanes: string[]; flowView: Shaped<FlowView>; flowSettings: FlowSettings; flowNotice: string | null }
  }
}
