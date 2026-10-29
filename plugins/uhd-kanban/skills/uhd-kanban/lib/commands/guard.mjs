// 메인 세션이 프로젝트 파일을 직접 고치려는지 판정한다. 보드 모니터 mod 의 도구 호출 훅이 Edit · Write · NotebookEdit 앞에서 부른다.
// 규칙은 delegate 스킬(skills/delegate/SKILL.md)의 「메인 세션이 하지 않는 것」 1 이다. 메인 세션은 작업을 카드로 맡기고 직접 고치지 않는다.
// uhd-kanban guard <경로> [--session <session id>]
// 종료 코드 0: 고쳐도 된다(카드 세션 · 프로젝트 밖 · kanban/ · .uhd-kanban/). 1: 메인 세션이 프로젝트 파일을 고치려 한다(이유는 stderr). 3: 보드가 없다.

import { existsSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { UsageError } from '../args.mjs'
import { BOARD_DIR, NoProjectError, ProjectError, SETTINGS_DIR, findRoot } from '../project.mjs'
import { isCardSessionName } from '../prompt.mjs'
import { listSessions } from '../sessions.mjs'

// 새로 만들 파일은 아직 없으므로 있는 상위 디렉터리에서 루트를 찾는다.
const existingDir = (path) => {
  let dir = dirname(path)
  while (!existsSync(dir) && dirname(dir) != dir) dir = dirname(dir)
  return dir
}

// 그 경로가 든 프로젝트의 루트. 보드가 없는 곳이면 null. git worktree 안이면 주 worktree 의 루트다(findRoot).
const rootOf = (path) => {
  try {
    return findRoot(existingDir(path))
  } catch (error) {
    if (error instanceof NoProjectError) return null
    throw error
  }
}

export const run = async ({ positional, flags }) => {
  if (positional[0] == null) throw new UsageError('guard <경로> [--session <session id>] 형식이다')
  const root = findRoot()
  const sessionId = typeof flags.session == 'string' ? flags.session : process.env.CLAUDE_CODE_SESSION_ID
  const name = sessionId ? listSessions().find((session) => session.sessionId == sessionId)?.name : null
  if (isCardSessionName(name)) return 0
  const path = resolve(positional[0])
  if (rootOf(path) != root) return 0
  const [top] = relative(root, path).split(sep)
  if (top == BOARD_DIR || top == SETTINGS_DIR) return 0
  throw new ProjectError(`메인 세션${name ? ` ${name}` : ''} 이 프로젝트 파일 ${relative(root, path)} 를 고치려 한다. 작업은 카드로 나눠 uhd-kanban run 으로 맡긴다(delegate 스킬). 사용자가 이 작업을 직접 하라고 했을 때만 허용한다`)
}
