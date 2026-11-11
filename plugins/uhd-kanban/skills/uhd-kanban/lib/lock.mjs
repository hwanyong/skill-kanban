// 보드를 바꾸는 명령은 `.uhd-kanban/lock/` 디렉터리를 쥐어 한 번에 한 세션만 바꾸게 한다. lock 안의 owner.json 에 host · pid · 시각을 적는다.
// 같은 host 에서 pid 가 죽었거나, 잡은 지 STALE_MS 가 지난 lock 은 부수고 다시 잡는다.
//
// 2026-11-11 실측: SMB(~/LOCAL, Mac mini 의 smbd) 위에서 8개 프로세스 × 40회를 두 번 돌렸다. 한 프로세스만 성공을 받은 것은 두 가지였다.
// 같은 경로의 mkdir(40/40)과, 서로 다른 원본을 같은 대상으로 옮기는 rename(40/40. 진 쪽은 ENOTEMPTY 나 EEXIST)이다.
// 한 원본을 서로 다른 대상으로 옮기는 rename 은 디스크에서는 한 번만 일어났는데 성공을 받은 프로세스가 여럿이었다(40회 중 18회 · 34회).
// 그래서 승자는 이 두 가지로만 정한다.
// - 잡기: `lock.new-*` 임시 디렉터리에 owner.json 을 쓰고 lock 으로 rename 한다. owner.json 이 없는 lock 이 생기지 않는다.
//   rename 은 비어 있지 않은 디렉터리 위로는 실패하고 빈 디렉터리는 덮어쓴다. 0.17.0 까지의 mkdir 뒤 owner.json 을 쓰기 전에 죽어 남은 빈 lock 은 바로 회복된다.
// - 놓기와 부수기: lock 을 치우는 쪽은 그 lock 의 identity(owner 의 host · pid · at) 로 이름 지은 `lock.break-<identity>` 를 mkdir 한 쪽 하나다.
//   쥔 뒤에 owner.json 을 다시 읽어 identity 가 같을 때만 lock 을 `lock.old-*` 로 옮기고 지운다.
//   그래서 남이 새로 잡은 lock 을 지우지 않고, 한 lock 을 옮기는 rename 은 한 프로세스만 한다.
// - break 디렉터리를 쥔 채 죽으면 BREAK_STALE_MS 뒤 그 디렉터리의 mtime 을 이름에 붙인 다음 세대를 mkdir 한다. 앞 세대는 지우지 않는다.
//   앞 세대를 지우면 그 이름을 다시 mkdir 한 프로세스와 다음 세대를 쥔 프로세스가 함께 쥐게 된다.
// rename 과 rmSync 사이에 죽으면 `.uhd-kanban/lock.new-*` · `lock.old-*` · `lock.break-*` 가 남는다. 그것을 읽는 코드는 없다.

import { mkdirSync, mkdtempSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { t } from './i18n.mjs'
import { ProjectError } from './errors.mjs'
import { readJsonOrNull } from './root.mjs'

const STALE_MS = 10 * 60 * 1000
const WAIT_MS = 30 * 1000
const POLL_MS = 200
// break 디렉터리는 owner.json 을 한 번 읽고 lock 을 옮기는 동안만 쥔다. 이만큼 남아 있으면 쥔 프로세스가 죽은 것으로 본다.
const BREAK_STALE_MS = 60 * 1000

const isAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code == 'EPERM'
  }
}

const statOrNull = (path) => {
  try {
    return statSync(path)
  } catch (error) {
    if (error.code == 'ENOENT') return null
    throw error
  }
}

// break 디렉터리 이름에 쓰는 lock 의 identity. owner.json 을 읽지 못하는 lock(0.17.0 까지의 판이 남긴 것, lock 이 파일인 것)은 mtime 이 identity 다.
const identityOf = (owner, mtimeMs) => (owner ? `${owner.host}-${owner.pid}-${owner.at}` : `mtime-${Math.trunc(mtimeMs)}`).replace(/[^A-Za-z0-9.-]/g, '_')

// 지금 lock 의 상태. 없으면 null.
const inspect = (dir) => {
  const stat = statOrNull(dir)
  if (!stat) return null
  const owner = readJsonOrNull(join(dir, 'owner.json'))
  return { owner, mtimeMs: stat.mtimeMs, identity: identityOf(owner, stat.mtimeMs) }
}

const isStale = ({ owner, mtimeMs }) => {
  if (owner == null) return Date.now() - mtimeMs > STALE_MS
  if (Date.now() - owner.at > STALE_MS) return true
  return owner.host == hostname() && !isAlive(owner.pid)
}

// 쓴 owner 를 돌려준다. lock 이 이미 있으면 null.
const tryAcquire = (dir) => {
  const tmp = mkdtempSync(`${dir}.new-`)
  const owner = { host: hostname(), pid: process.pid, at: Date.now() }
  try {
    writeFileSync(join(tmp, 'owner.json'), JSON.stringify(owner))
    renameSync(tmp, dir)
    return owner
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true })
    // lock 이 파일이면 macOS 는 ENOTDIR 을 낸다. 그 lock 은 inspect 가 mtime 으로 보고 isStale 이 부순다.
    if (['ENOTEMPTY', 'EEXIST', 'ENOTDIR'].includes(error.code)) return null
    throw error
  }
}

// identity 가 같은 lock 을 치울 권리를 mkdir 로 쥔다. 쥐었으면 그 디렉터리 경로, 남이 쥐고 있으면 null.
const claimBreak = (dir, identity) => {
  let path = `${dir}.break-${identity}`
  for (;;) {
    try {
      mkdirSync(path)
      return path
    } catch (error) {
      if (error.code != 'EEXIST') throw error
    }
    const stat = statOrNull(path)
    if (!stat) continue
    if (Date.now() - stat.mtimeMs <= BREAK_STALE_MS) return null
    path = `${path}-${Math.trunc(stat.mtimeMs)}`
  }
}

// lock 이 아직 identity 의 것이면 옮긴 뒤 지우고 true 를 돌려준다. 옮기는 것은 break 디렉터리를 쥔 쪽 하나다.
const discardIf = (dir, identity) => {
  const breakPath = claimBreak(dir, identity)
  if (!breakPath) return false
  try {
    if (inspect(dir)?.identity != identity) return false
    const grave = `${dir}.old-${process.pid}-${Date.now()}`
    renameSync(dir, grave)
    rmSync(grave, { recursive: true, force: true })
    return true
  } finally {
    rmdirSync(breakPath)
  }
}

// work 를 lock 안에서 실행하고 반환값을 돌려준다. WAIT_MS 동안 잡지 못하면 ProjectError 로 끝난다.
export const withLock = async (settingsPath, work) => {
  const dir = join(settingsPath, 'lock')
  const deadline = Date.now() + WAIT_MS
  let mine = tryAcquire(dir)
  while (!mine) {
    const current = inspect(dir)
    const isBroken = current != null && isStale(current) && discardIf(dir, current.identity)
    if (!isBroken && Date.now() > deadline) throw new ProjectError(t('lock.timeout', { dir, seconds: WAIT_MS / 1000, owner: JSON.stringify(current?.owner ?? null) }))
    if (!isBroken && current) await sleep(POLL_MS)
    mine = tryAcquire(dir)
  }
  try {
    return await work()
  } finally {
    // 10분을 넘겨 부서진 뒤 남이 다시 잡은 lock 은 identity 가 달라 지우지 않는다.
    discardIf(dir, identityOf(mine))
  }
}
