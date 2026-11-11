// 메인 세션이 프로젝트 파일을 직접 고치려는지 판정한다. 보드 모니터 mod 의 도구 호출 훅이 Edit · Write · NotebookEdit 앞에서 부른다.
// 규칙은 delegate 스킬(skills/delegate/SKILL.md)의 「메인 세션이 하지 않는 것」 1 이다. 메인 세션은 작업을 카드로 맡기고 직접 고치지 않는다.
// uhd-kanban guard <경로> [--session <session id>]
// 판정할 세션은 --session 이고, 없으면 CLAUDE_CODE_SESSION_ID 다. 보드 모니터 mod 는 --session 을 넘긴다.
// --session 은 지우지 않는다. 세션은 hooks 모듈을 띄울 때 한 번 읽고 이 명령은 부를 때마다 플러그인 폴더에서 읽으므로, 옛 hooks 모듈이 이 명령의 새 판을 부른다.
// 2026-11-11 0.15.0 작업 중 --session 을 지웠더니, 그 전에 뜬 카드 세션 k126(rea_cathode)의 옛 훅이 넘긴 id 가 무시되었다.
// mod 의 프로세스에는 CLAUDE_CODE_SESSION_ID 가 없어 세션을 찾지 못했고, 프로젝트 파일 Edit 마다 승인 창이 떴다.
// 종료 코드 0: 고쳐도 된다(카드 세션 · 프로젝트 밖 · kanban/ · .uhd-kanban/). 1: 메인 세션이 프로젝트 파일을 고치려 한다(이유는 stderr). 3: 보드가 없다.

import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { callerSessionId, sessionById } from '../agents.mjs'
import { UsageError, stringFlag } from '../args.mjs'
import { t } from '../i18n.mjs'
import { ProjectError } from '../errors.mjs'
import { findRoot } from '../project.mjs'
import { BOARD_DIR, SETTINGS_DIR, findRootOrNull } from '../root.mjs'
import { isCardSessionName, listSessions } from '../sessions.mjs'

// 새로 만들 파일은 아직 없으므로 있는 상위 디렉터리에서 루트를 찾는다.
const existingDir = (path) => {
  let dir = dirname(path)
  while (!existsSync(dir) && dirname(dir) != dir) dir = dirname(dir)
  return dir
}

// 그 경로가 든 프로젝트의 루트. 보드가 없는 곳이면 null. git worktree 안이면 주 worktree 의 루트다(root.mjs).
const rootOf = (path) => findRootOrNull(existingDir(path))

// 디렉터리 부분만 실제 경로로 바꾼다. 파일 자신은 realpath 하지 않으므로 프로젝트 안의 파일이 밖을 가리키는 symlink 이면 지금처럼 묻는다.
const physicalPath = (path) => {
  const dir = existingDir(path)
  return join(realpathSync(dir), relative(dir, path))
}

export const run = async ({ positional, flags }) => {
  if (positional[0] == null) throw new UsageError(t('guard.usage'))
  const found = findRoot()
  const given = resolve(positional[0])
  // findRoot 는 process.cwd()·git 이 준 실제 경로이고 Edit 의 file_path 는 symlink 를 지난 경로일 수 있다.
  // 2026-11-11 재현: git 아닌 보드에서 link/proj/src/a.ts 가 0(허용), git 보드에서 link/proj/kanban/x.md 가 1(물음).
  // 적힌 경로가 root 안이면 적힌 대로 판정하고, 밖일 때만 둘 다 실제 경로로 바꿔 다시 판정한다.
  // 늘 바꾸면 프로젝트 안의 디렉터리가 밖을 가리키는 symlink 일 때(project/vendor → /elsewhere) 그 아래 편집이 물음(1)에서 허용(0)으로 바뀐다.
  const insideAsWritten = relative(found, given).split(sep)[0] != '..'
  const root = insideAsWritten ? found : realpathSync(found)
  const path = insideAsWritten ? given : physicalPath(given)
  // 경로 판정이 세션 목록보다 먼저다. 프로젝트 밖 · kanban/ · .uhd-kanban/ 경로는 claude agents --json 을 부르지 않는다.
  if (rootOf(path) != root) return 0
  const [top] = relative(root, path).split(sep)
  if (top == BOARD_DIR || top == SETTINGS_DIR) return 0
  const sessionId = stringFlag(flags, 'session') ?? callerSessionId()
  const name = sessionId ? sessionById(listSessions(), sessionId)?.name : null
  if (isCardSessionName(name)) return 0
  // 세션을 찾지 못하면 메인 세션으로 보고 묻는다(막는 쪽). 그때는 찾지 못한 id 를 이유에 적는다.
  throw new ProjectError(name ? t('guard.denied', { name, path: relative(root, path) }) : t('guard.unknownSession', { session: sessionId ?? '-', path: relative(root, path) }))
}
