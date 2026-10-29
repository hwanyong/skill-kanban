// 보드가 있는 프로젝트 루트를 찾는다. 루트는 `.uhd-kanban/config.json` 이 있는 디렉터리다. git worktree 안에서 부르면 주 worktree 의 루트를 쓴다.
// 보드(`kanban/`)는 저장소마다 한 벌이어야 한다. worktree 마다 따로 고치면 카드 id 와 순서 번호가 갈라진다.
// 메시지를 내지 않는다. i18n.mjs 가 메시지 표를 고르기 전에 이 모듈로 config.json 을 찾기 때문이다.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const SETTINGS_DIR = '.uhd-kanban'
export const BOARD_DIR = 'kanban'

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
    if (existsSync(join(dir, SETTINGS_DIR, 'config.json'))) return dir
    if (dirname(dir) == dir) return null
  }
}

// 반환: 루트 경로, 보드가 없으면 null.
export const findRootOrNull = (cwd) => {
  const main = gitMainRoot(cwd)
  return (main && walkUp(main)) ?? walkUp(cwd)
}
