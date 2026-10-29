// `uhd-kanban board --json` 의 stdout 과 같은 모양이다. 그 명령이 이 값의 원본이다.
export type BoardCard = { id: number; session?: 'live' | 'pending' | 'restart' | 'resume' | 'done' | 'none' }
export type BoardColumn = { status: string; dir: string; count: number; cards: BoardCard[] }
// cell_height: 막대 한 줄의 세로 길이. 단위는 터미널 한 줄의 1/8 이다(8 이 한 줄).
export type Board = { root: string; interval_seconds: number; cell_height: number; run_status: string; columns: BoardColumn[] }

// none: 세션 디렉터리 위에 보드가 없다(board 의 종료 코드 3). error: board 가 다른 종료 코드로 끝났거나 실행되지 않았다.
export type BoardView =
  | { kind: 'none' }
  | { kind: 'ok'; board: Board; refreshedAt: number }
  | { kind: 'error'; message: string; refreshedAt: number }

declare module 'claude-code' {
  interface PluginState {
    'uhd-kanban': { view: Shaped<BoardView> }
  }
}
