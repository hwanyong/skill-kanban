// 보드가 있는 프로젝트 루트를 찾는다. 루트는 `.uhd-kanban/config.json` 이 있는 디렉터리다. git worktree 안에서 부르면 주 worktree 의 루트를 쓴다.
// 보드(`kanban/`)는 저장소마다 한 벌이어야 한다. worktree 마다 따로 고치면 카드 id 와 순서 번호가 갈라진다.
// 메시지를 내지 않는다. i18n.mjs 가 메시지 표를 고르기 전에 이 모듈로 config.json 을 찾기 때문이다.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { callerSessionId, claudeConfigDir, readAgents, sessionById } from './agents.mjs'

export const SETTINGS_DIR = '.uhd-kanban'
export const BOARD_DIR = 'kanban'

// `.uhd-kanban/` 아래 설정 파일의 경로.
export const configFile = (root) => join(root, SETTINGS_DIR, 'config.json')
export const profilesFile = (root) => join(root, SETTINGS_DIR, 'profiles.json')
export const mainFile = (root) => join(root, SETTINGS_DIR, 'main.json')

const hasBoard = (dir) => existsSync(configFile(dir))

const gitMainRoot = (cwd) => {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return common.endsWith('/.git') ? dirname(common) : null
  } catch {
    return null
  }
}

const walkUp = (start) => {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    if (hasBoard(dir)) return dir
    if (dirname(dir) == dir) return null
  }
}

// cwd 가 든 git worktree 의 루트. git 저장소가 아니면 null.
const gitToplevel = (cwd) => {
  try {
    return execFileSync('git', ['rev-parse', '--path-format=absolute', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

// dir 이 든 linked worktree 의 루트(top)와 그 주 worktree 의 루트(main). dir 이 주 worktree 안이거나 git 저장소가 아니거나 아직 없으면 null.
// 두 값 모두 git 이 낸 값끼리 비교한다. git 은 경로의 심볼릭 링크를 풀고 대소문자를 디스크 표기로 바꾼 값을 낸다.
// 2026-11-11 scratch 재현: 주 worktree 를 가리키는 심볼릭 링크로 init --dir 을 부르자, git 의 주 worktree 루트를 resolve 한 경로와 비교한 판정이 주 worktree 자신을 linked worktree 로 보고 init.worktree 로 거절했다.
const linkedWorktree = (dir) => {
  const main = gitMainRoot(dir)
  const top = gitToplevel(dir)
  return main != null && top != null && top != main ? { top, main } : null
}

// sub 가 dir 를 주 worktree 로 둔 linked worktree 의 루트인가. 그런 worktree 는 주 worktree 의 추적 파일 사본이라 `.uhd-kanban/` 이 있어도
// findRootOrNull 이 gitMainRoot 로 주 worktree 의 보드를 먼저 찾으므로 dir 의 보드를 가리지 않는다.
// 2026-11-11 scratch 재현에서 루트 바로 아래 linked worktree 를 check 가 겹친 보드로 알렸고, 그 worktree 안의 uk 는 루트 보드를 썼다.
// 독립된 하위 git 저장소는 여기 들지 않는다. 그 보드는 실제로 dir 의 보드를 가리고 ancestor 판정도 그것을 겹침으로 본다.
// git 은 경로의 심볼릭 링크를 풀고 대소문자를 디스크 표기로 바꾼 값을 내므로 realpathSync.native 와 비교한다.
// realpathSync(JS 구현)는 대소문자를 적은 그대로 둔다(2026-11-11 실측: `…/proj` 를 그대로 냈고 native 와 git 은 `…/Proj` 를 냈다).
const isLinkedWorktreeOf = (sub, dir) => {
  const linked = linkedWorktree(sub)
  return linked != null && linked.top == realpathSync.native(sub) && linked.main == realpathSync.native(dir)
}

// 그 경로가 든 보드의 루트. 보드가 없으면 null.
export const findRootOrNull = (cwd) => {
  const main = gitMainRoot(cwd)
  return (main && walkUp(main)) ?? walkUp(cwd)
}

// 이 프로세스를 부른 Claude Code 세션을 띄운 디렉터리. Claude Code 밖에서 불렀거나 세션 목록을 읽지 못하면 null.
// 2026-11-10 실측(2.1.322): background 세션의 Bash 에서 `cd /tmp` 를 한 뒤에도 CLAUDE_CODE_SESSION_ID 가 있었고,
// `claude agents --json` 의 그 세션 항목 cwd 는 세션을 띄운 프로젝트 루트였다.
// 같은 날 `claude --bg` 에 준 환경 변수는 세션의 Bash 에 전달되지 않았다(printenv 가 빈 값). 그래서 uk run 이 루트를 환경 변수로 넘기지 않는다.
const sessionDir = (id) => {
  const sessions = readAgentsOrNull()
  if (!Array.isArray(sessions)) return null
  return sessionById(sessions, id)?.cwd ?? null
}

// 찾지 못하면 원래 오류(project.noRoot)로 끝나야 하므로 claude 실행 실패와 JSON 오류는 여기서 null 로 바꾼다.
const readAgentsOrNull = () => {
  try {
    return readAgents()
  } catch {
    return null
  }
}

// 이 Mac 에서 쓴 보드의 루트 목록. 세션이 `/cd` 로 보드 밖에 있어도 그 세션을 메인 세션으로 등록한 보드를 찾으려고 둔다.
// 목록에는 루트만 적는다. 어느 세션이 메인인지는 각 보드의 `.uhd-kanban/main.json` 한 곳이 갖는다.
// 파일: <Claude Code 설정 디렉터리>/uhd-kanban/boards.json = { "roots": [<절대 경로>, ...] }
const boardsPath = () => join(claudeConfigDir(), 'uhd-kanban', 'boards.json')

// 파일을 읽지 못하거나 JSON 이 아니면 null.
export const readJsonOrNull = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

// 파일이 없거나 읽지 못하면 빈 목록이다. 다음 rememberBoard 가 새로 쓴다.
const knownRoots = () => {
  const roots = readJsonOrNull(boardsPath())?.roots
  return Array.isArray(roots) ? roots.filter((root) => typeof root == 'string') : []
}

// loadProject 가 보드를 읽을 때마다 부른다. 이미 있으면 쓰지 않는다. 보드가 없어진 루트는 이때 뺀다.
// 여러 프로세스가 함께 쓰면 한쪽의 추가가 빠질 수 있다. 그 보드에서 다음에 실행하는 명령이 다시 적는다.
export const rememberBoard = (root) => {
  const roots = knownRoots()
  if (roots.includes(root)) return
  const path = boardsPath()
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify({ roots: [...roots.filter(hasBoard), root].sort() }, null, 2)}\n`)
  renameSync(temp, path)
}

// main.json 의 session 이 id 인 보드의 루트. 없으면 null. 둘 이상이면 main.json 의 set_at 이 가장 늦은 보드다.
const mainBoardOf = (id) => knownRoots()
  .map((root) => ({ root, main: readJsonOrNull(mainFile(root)) }))
  .filter(({ root, main }) => main?.session == id && hasBoard(root))
  .sort((a, b) => String(b.main.set_at ?? '').localeCompare(String(a.main.set_at ?? '')))[0]?.root ?? null

// CLI 를 부른 자리의 보드. 차례대로 찾는다.
// 1. cwd 위의 보드.
// 2. 부른 세션을 메인 세션으로 등록한 보드. 메인 세션이 `/cd` 로 보드 밖의 디렉터리로 옮겨도 자기 보드를 쓴다.
//    2026-11-10 poieve-main 이 `/cd` 로 skill-kanban 에 옮긴 뒤 pane 이 보드를 찾지 못했다(pane 은 세션의 project root 에서 uk 를 실행한다).
// 3. 부른 세션을 띄운 디렉터리 위의 보드. 세션이 Bash 에서 프로젝트 밖(예: $CLAUDE_JOB_DIR/tmp)으로 cd 한 뒤 uk 를 불러도 그 세션의 보드를 쓴다.
//    2026-11-10 poieve 세션 3건이 `cd ~/.claude/jobs/<id>/tmp` 뒤에 uk 를 불러 보드를 찾지 못했다.
// 부른 세션은 CLAUDE_CODE_SESSION_ID 로 안다. Claude Code 가 Bash 에 넣고, pane 은 $.process.run 의 env 로 넣는다.
// 경로가 든 보드를 묻는 자리(guard 의 rootOf)는 findRootOrNull 을 쓴다. 그 경로와 무관한 세션의 보드를 돌려주면 판정이 틀린다.
export const findCallerRootOrNull = (cwd) => {
  const root = findRootOrNull(cwd)
  if (root != null) return root
  const id = callerSessionId()
  if (!id) return null
  const main = mainBoardOf(id)
  if (main != null) return main
  const dir = sessionDir(id)
  return dir == null ? null : findRootOrNull(dir)
}

// root 와 겹치는 보드. 보드는 가장 가까운 것이 쓰이므로 겹치면 한쪽이 다른 쪽을 가린다.
// ancestor: root 를 감싸는 보드의 루트(없으면 null). children: root 바로 아래 디렉터리 중 보드가 있는 것.
// home: root 가 홈 디렉터리이거나 파일 시스템의 루트다. 그 아래 보드 없는 프로젝트가 모두 이 보드를 쓴다.
// 아래쪽은 한 단계만 본다. ~/LOCAL 은 SMB 공유라 깊이 없이 훑으면 Mac mini 의 smbd 가 파일을 너무 많이 연다.
// children 에서 dir 의 linked worktree 는 뺀다(isLinkedWorktreeOf). git 은 보드가 있는 하위 디렉터리에만 부른다.
export const overlappingBoards = (root) => {
  const dir = resolve(root)
  const parent = dirname(dir)
  const ancestor = parent == dir ? null : findRootOrNull(parent)
  // init --dir 은 아직 없는 디렉터리를 받을 수 있다. 없으면 그 아래 보드도 없다.
  const children = !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && hasBoard(join(dir, entry.name)))
    .map((entry) => join(dir, entry.name))
    .filter((child) => !isLinkedWorktreeOf(child, dir))
  return { ancestor, children, home: dir == homedir() || parent == dir }
}

// dir 에 보드를 만들어도 쓰이지 않게 하는 보드의 루트. 없으면 null.
// findRootOrNull 이 gitMainRoot 를 먼저 보므로, 이것이 null 이 아니면 dir 에 만든 보드는 쓰이지 않는다. dir 이 linked worktree 이고 주 worktree 쪽에 보드가 있는 경우다.
// dir 이 아직 없으면(init --dir) linkedWorktree 가 null 이다.
export const shadowingBoard = (root) => {
  const linked = linkedWorktree(resolve(root))
  return linked == null ? null : walkUp(linked.main)
}
