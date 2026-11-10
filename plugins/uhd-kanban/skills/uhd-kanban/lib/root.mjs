// 보드가 있는 프로젝트 루트를 찾는다. 루트는 `.uhd-kanban/config.json` 이 있는 디렉터리다. git worktree 안에서 부르면 주 worktree 의 루트를 쓴다.
// 보드(`kanban/`)는 저장소마다 한 벌이어야 한다. worktree 마다 따로 고치면 카드 id 와 순서 번호가 갈라진다.
// 메시지를 내지 않는다. i18n.mjs 가 메시지 표를 고르기 전에 이 모듈로 config.json 을 찾기 때문이다.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { readAgents } from './agents.mjs'

export const SETTINGS_DIR = '.uhd-kanban'
export const BOARD_DIR = 'kanban'

const hasBoard = (dir) => existsSync(join(dir, SETTINGS_DIR, 'config.json'))

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

// 그 경로가 든 보드의 루트. 보드가 없으면 null.
export const findRootOrNull = (cwd) => {
  const main = gitMainRoot(cwd)
  return (main && walkUp(main)) ?? walkUp(cwd)
}

// 이 프로세스를 부른 Claude Code 세션을 띄운 디렉터리. Claude Code 밖에서 불렀거나 세션 목록을 읽지 못하면 null.
// 2026-11-10 실측(2.1.322): background 세션의 Bash 에서 `cd /tmp` 를 한 뒤에도 CLAUDE_CODE_SESSION_ID 가 있었고,
// `claude agents --json` 의 그 세션 항목 cwd 는 세션을 띄운 프로젝트 루트였다.
// 같은 날 `claude --bg` 에 준 환경 변수는 세션의 Bash 에 전달되지 않았다(printenv 가 빈 값). 그래서 uk run 이 루트를 환경 변수로 넘기지 않는다.
const sessionDir = () => {
  const id = process.env.CLAUDE_CODE_SESSION_ID
  if (!id) return null
  const sessions = readAgentsOrNull()
  if (!Array.isArray(sessions)) return null
  return sessions.find((session) => session.sessionId == id)?.cwd ?? null
}

// 찾지 못하면 원래 오류(project.noRoot)로 끝나야 하므로 claude 실행 실패와 JSON 오류는 여기서 null 로 바꾼다.
const readAgentsOrNull = () => {
  try {
    return readAgents()
  } catch {
    return null
  }
}

// CLI 를 부른 자리의 보드. cwd 위에 보드가 없으면 부른 세션을 띄운 디렉터리에서 다시 찾는다.
// 세션이 Bash 에서 프로젝트 밖(예: $CLAUDE_JOB_DIR/tmp)으로 cd 한 뒤 uk 를 불러도 그 세션의 보드를 쓴다.
// 2026-11-10 poieve 세션 3건이 `cd ~/.claude/jobs/<id>/tmp` 뒤에 uk 를 불러 보드를 찾지 못했다.
// 경로가 든 보드를 묻는 자리(guard 의 rootOf)는 findRootOrNull 을 쓴다. 그 경로와 무관한 세션의 보드를 돌려주면 판정이 틀린다.
export const findCallerRootOrNull = (cwd) => {
  const root = findRootOrNull(cwd)
  if (root != null) return root
  const dir = sessionDir()
  return dir == null ? null : findRootOrNull(dir)
}

// root 와 겹치는 보드. 보드는 가장 가까운 것이 쓰이므로 겹치면 한쪽이 다른 쪽을 가린다.
// ancestor: root 를 감싸는 보드의 루트(없으면 null). children: root 바로 아래 디렉터리 중 보드가 있는 것.
// home: root 가 홈 디렉터리이거나 파일 시스템의 루트다. 그 아래 보드 없는 프로젝트가 모두 이 보드를 쓴다.
// 아래쪽은 한 단계만 본다. ~/LOCAL 은 SMB 공유라 깊이 없이 훑으면 Mac mini 의 smbd 가 파일을 너무 많이 연다.
export const overlappingBoards = (root) => {
  const dir = resolve(root)
  const parent = dirname(dir)
  const ancestor = parent == dir ? null : findRootOrNull(parent)
  // init --dir 은 아직 없는 디렉터리를 받을 수 있다. 없으면 그 아래 보드도 없다.
  const children = !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && hasBoard(join(dir, entry.name)))
    .map((entry) => join(dir, entry.name))
  return { ancestor, children, home: dir == homedir() || parent == dir }
}
