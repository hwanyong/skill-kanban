// 보드를 바꾸는 명령은 `.uhd-kanban/lock/` 디렉터리를 만들어 한 번에 한 세션만 바꾸게 한다.
// mkdir 은 이미 있으면 실패하므로 두 세션이 함께 잡지 못한다. lock 안의 owner.json 에 host · pid · 시각을 적는다.
// 같은 host 에서 pid 가 죽었거나, 잡은 지 STALE_MS 가 지난 lock 은 지우고 다시 잡는다.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { t } from './i18n.mjs'
import { ProjectError } from './project.mjs'

const STALE_MS = 10 * 60 * 1000
const WAIT_MS = 30 * 1000
const POLL_MS = 200

const isAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code == 'EPERM'
  }
}

const readOwner = (dir) => {
  try {
    return JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'))
  } catch {
    return null
  }
}

const isStale = (owner) => {
  if (owner == null) return false
  if (Date.now() - owner.at > STALE_MS) return true
  return owner.host == hostname() && !isAlive(owner.pid)
}

const tryAcquire = (dir) => {
  try {
    mkdirSync(dir)
  } catch (error) {
    if (error.code == 'EEXIST') return false
    throw error
  }
  writeFileSync(join(dir, 'owner.json'), JSON.stringify({ host: hostname(), pid: process.pid, at: Date.now() }))
  return true
}

// work 를 lock 안에서 실행하고 반환값을 돌려준다. WAIT_MS 동안 잡지 못하면 ProjectError 로 끝난다.
export const withLock = async (project, work) => {
  const dir = join(project.settingsPath, 'lock')
  const deadline = Date.now() + WAIT_MS
  while (!tryAcquire(dir)) {
    const owner = readOwner(dir)
    if (isStale(owner)) {
      rmSync(dir, { recursive: true, force: true })
      continue
    }
    if (Date.now() > deadline) throw new ProjectError(t('lock.timeout', { dir, seconds: WAIT_MS / 1000, owner: JSON.stringify(owner) }))
    await sleep(POLL_MS)
  }
  try {
    return await work()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
