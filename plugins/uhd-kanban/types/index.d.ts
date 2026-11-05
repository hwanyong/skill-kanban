// `uhd-kanban board --json` 의 stdout 과 같은 모양이다. 그 명령이 이 값의 원본이다.
export type BoardCard = { id: number; status: string; session?: 'live' | 'pending' | 'restart' | 'resume' | 'done' | 'none' }
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

// none: 세션 디렉터리 위에 보드가 없다(board 의 종료 코드 3). error: board 가 다른 종료 코드로 끝났거나 실행되지 않았다.
export type BoardView =
  | { kind: 'none' }
  | { kind: 'ok'; board: Board; refreshedAt: number }
  | { kind: 'error'; message: string; refreshedAt: number }

declare module 'claude-code' {
  interface PluginState {
    'uhd-kanban': { view: Shaped<BoardView>; collapsedLanes: string[] }
  }
}
