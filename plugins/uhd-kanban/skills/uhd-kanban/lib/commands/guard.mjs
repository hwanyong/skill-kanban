// 메인 세션이 프로젝트 파일을 직접 고치려는지 판정한다. 보드 모니터 mod 의 도구 호출 훅이 Edit · Write · NotebookEdit 앞에서 부른다.
// 규칙은 delegate 스킬(skills/delegate/SKILL.md)의 「메인 세션이 하지 않는 것」 1 이다. 메인 세션은 작업을 카드로 맡기고 직접 고치지 않는다.
// uhd-kanban guard <경로> [--session <session id>]
// 판정할 세션은 --session 이고, 없으면 CLAUDE_CODE_SESSION_ID 다. 보드 모니터 mod 는 --session 을 넘긴다.
// --session 은 지우지 않는다. 세션은 hooks 모듈을 띄울 때 한 번 읽고 이 명령은 부를 때마다 플러그인 폴더에서 읽으므로, 옛 hooks 모듈이 이 명령의 새 판을 부른다.
// 2026-11-11 0.15.0 작업 중 --session 을 지웠더니, 그 전에 뜬 카드 세션 k126(rea_cathode)의 옛 훅이 넘긴 id 가 무시되었다.
// mod 의 프로세스에는 CLAUDE_CODE_SESSION_ID 가 없어 세션을 찾지 못했고, 프로젝트 파일 Edit 마다 승인 창이 떴다.
// 종료 코드 0: 고쳐도 된다(카드 세션 · 프로젝트 밖 · kanban/ · .uhd-kanban/). 1: 메인 세션이 프로젝트 파일을 고치려 한다(이유는 stderr). 3: 보드가 없다.

import { existsSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { UsageError } from '../args.mjs'
import { t } from '../i18n.mjs'
import { BOARD_DIR, ProjectError, SETTINGS_DIR, findRoot } from '../project.mjs'
import { isCardSessionName } from '../prompt.mjs'
import { findRootOrNull } from '../root.mjs'
import { listSessions } from '../sessions.mjs'

// 새로 만들 파일은 아직 없으므로 있는 상위 디렉터리에서 루트를 찾는다.
const existingDir = (path) => {
  let dir = dirname(path)
  while (!existsSync(dir) && dirname(dir) != dir) dir = dirname(dir)
  return dir
}

// 그 경로가 든 프로젝트의 루트. 보드가 없는 곳이면 null. git worktree 안이면 주 worktree 의 루트다(root.mjs).
const rootOf = (path) => findRootOrNull(existingDir(path))

export const run = async ({ positional, flags }) => {
  if (positional[0] == null) throw new UsageError(t('guard.usage'))
  const root = findRoot()
  const sessionId = typeof flags.session == 'string' ? flags.session : process.env.CLAUDE_CODE_SESSION_ID
  const name = sessionId ? listSessions().find((session) => session.sessionId == sessionId)?.name : null
  if (isCardSessionName(name)) return 0
  const path = resolve(positional[0])
  if (rootOf(path) != root) return 0
  const [top] = relative(root, path).split(sep)
  if (top == BOARD_DIR || top == SETTINGS_DIR) return 0
  // 세션을 찾지 못하면 메인 세션으로 보고 묻는다(막는 쪽). 그때는 찾지 못한 id 를 이유에 적는다.
  throw new ProjectError(name ? t('guard.denied', { name, path: relative(root, path) }) : t('guard.unknownSession', { session: sessionId ?? '-', path: relative(root, path) }))
}
