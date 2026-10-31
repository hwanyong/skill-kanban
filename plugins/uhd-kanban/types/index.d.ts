// `uhd-kanban board --json` 의 stdout 과 같은 모양이다. 그 명령이 이 값의 원본이다.
export type BoardCard = { id: number; status: string; session?: 'live' | 'pending' | 'restart' | 'resume' | 'done' | 'none' }
// 작업 카드를 받는 열. index: config.json 의 columns 안의 차례. count 는 milestone 을 세지 않는다.
export type BoardColumn = { status: string; dir: string; index: number; count: number }
// 끝나지 않은 milestone 하나, 또는 collection 이 빈 카드(key 'none', id · title · status 는 null). finished · total 은 아카이브한 소속 카드를 포함해 센다.
export type BoardLane = { key: string; id: number | null; title: string | null; status: string | null; is_running: boolean; finished: number; total: number; cards: BoardCard[] }
export type Board = { root: string; interval_seconds: number; run_status: string; columns: BoardColumn[]; lanes: BoardLane[] }

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
