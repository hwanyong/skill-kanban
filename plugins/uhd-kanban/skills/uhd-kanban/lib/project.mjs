// 프로젝트 루트를 찾고 `.uhd-kanban/config.json` 을 읽어 검증한다.
// 루트는 `.uhd-kanban/` 이 있는 디렉터리다. git worktree 안에서 부르면 주 worktree 의 루트를 쓴다.
// 보드(`kanban/`)는 저장소마다 한 벌이어야 한다. worktree 마다 따로 고치면 카드 id 와 순서 번호가 갈라진다.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { validateProfiles } from './profiles.mjs'

export const SETTINGS_DIR = '.uhd-kanban'
export const BOARD_DIR = 'kanban'

export class ProjectError extends Error {}

// 부른 디렉터리 위에 보드가 없다. 종료 코드 3 으로 끝나 보드가 있지만 틀린 경우(1)와 갈린다. 보드 모니터 mod 가 이 값으로 pane 을 열지 않는다.
export class NoProjectError extends ProjectError {}

// monitor.interval_seconds 의 하한. 갱신마다 `claude agents --json` 과 node 프로세스가 하나씩 돈다.
export const MIN_MONITOR_SECONDS = 10

// monitor.cell_height 의 범위. 단위는 터미널 한 줄의 1/8(블록 문자 ▁ 한 개)이고 8 이 한 줄(█)이다.
export const MAX_CELL_HEIGHT = 64

// run · recover 가 카드에 쓰거나 세션에 쓰라고 하는 코멘트 kind. comments.kinds 에 있어야 한다.
export const RUN_KINDS = ['배정', '진행', '질문', '결과']

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

export const findRoot = (cwd = process.cwd()) => {
  const main = gitMainRoot(cwd)
  const root = (main && walkUp(main)) ?? walkUp(cwd)
  if (root == null) throw new NoProjectError(`${cwd} 위에 ${SETTINGS_DIR}/config.json 이 없다. 프로젝트 루트에서 uhd-kanban init 을 실행한다`)
  return root
}

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new ProjectError(`${path} 를 JSON 으로 읽을 수 없다: ${error.message}`)
  }
}

const isPositiveInteger = (value) => Number.isInteger(value) && value > 0

// 문제를 하나씩 멈추지 않고 모두 모아 한 번에 알린다.
export const validateConfig = (config) => {
  const problems = []
  const columns = Array.isArray(config?.columns) ? config.columns : []
  if (columns.length == 0) problems.push('columns 가 비었거나 배열이 아니다')
  const dirs = new Set()
  const statuses = new Set()
  columns.forEach((column, index) => {
    const at = `columns[${index}]`
    if (!/^\d+-[a-z][a-z0-9-]*$/.test(column?.dir ?? '')) problems.push(`${at}.dir 는 <숫자>-<영소문자> 형식이다: ${column?.dir}`)
    if (!/^[a-z][a-z0-9-]*$/.test(column?.status ?? '')) problems.push(`${at}.status 는 영소문자 · 숫자 · - 로 쓴다: ${column?.status}`)
    if (dirs.has(column?.dir)) problems.push(`${at}.dir 가 겹친다: ${column.dir}`)
    if (statuses.has(column?.status)) problems.push(`${at}.status 가 겹친다: ${column.status}`)
    dirs.add(column?.dir)
    statuses.add(column?.status)
    const types = column?.types
    if (!Array.isArray(types) || types.length == 0 || types.some((type) => !/^[a-z][a-z0-9-]*$/.test(type))) problems.push(`${at}.types 는 비지 않은 type 이름 배열이다`)
  })
  const order = config?.order ?? {}
  if (!Number.isInteger(order.width) || order.width < 3 || order.width > 8) problems.push(`order.width 는 3 ~ 8 의 정수다: ${order.width}`)
  if (!isPositiveInteger(order.step)) problems.push(`order.step 은 1 이상의 정수다: ${order.step}`)
  const dependencies = config?.dependencies ?? {}
  for (const key of ['gate', 'resolved']) {
    const list = dependencies[key]
    if (!Array.isArray(list)) problems.push(`dependencies.${key} 는 status 이름 배열이다`)
    if (Array.isArray(list)) list.filter((status) => !statuses.has(status)).forEach((status) => problems.push(`dependencies.${key} 의 ${status} 는 columns 에 없는 status 다`))
  }
  const kinds = config?.comments?.kinds
  if (!Array.isArray(kinds) || kinds.length == 0 || kinds.some((kind) => typeof kind != 'string' || !/^[^\[\]\n]+$/.test(kind))) problems.push('comments.kinds 는 [ ] 와 줄바꿈이 없는 문자열의 배열이다')
  if (Array.isArray(kinds)) RUN_KINDS.filter((kind) => !kinds.includes(kind)).forEach((kind) => problems.push(`comments.kinds 에 run 이 쓰는 ${kind} 가 없다`))
  const archive = config?.archive ?? {}
  const archiveColumns = Array.isArray(archive.columns) ? archive.columns : []
  if (!Array.isArray(archive.columns)) problems.push('archive.columns 는 status 이름 배열이다')
  archiveColumns.filter((status) => !statuses.has(status)).forEach((status) => problems.push(`archive.columns 의 ${status} 는 columns 에 없는 status 다`))
  if (!Number.isInteger(archive.after_days) || archive.after_days < 0) problems.push(`archive.after_days 는 0 이상의 정수다: ${archive.after_days}`)
  if (!/^[a-z][a-z0-9-]*$/.test(archive.dir ?? '') || dirs.has(archive.dir)) problems.push(`archive.dir 는 열 디렉터리와 겹치지 않는 영소문자 이름이다: ${archive.dir}`)
  if (!statuses.has(config?.run?.status)) problems.push(`run.status 는 columns 에 있는 status 다: ${config?.run?.status}`)
  const interval = config?.monitor?.interval_seconds
  if (!Number.isInteger(interval) || interval < MIN_MONITOR_SECONDS) problems.push(`monitor.interval_seconds 는 ${MIN_MONITOR_SECONDS} 이상의 정수다: ${interval}`)
  const cellHeight = config?.monitor?.cell_height
  if (!Number.isInteger(cellHeight) || cellHeight < 1 || cellHeight > MAX_CELL_HEIGHT) problems.push(`monitor.cell_height 는 1 이상 ${MAX_CELL_HEIGHT} 이하의 정수다(1/8줄 단위): ${cellHeight}`)
  return problems
}

export const loadProject = (cwd = process.cwd()) => {
  const root = findRoot(cwd)
  const config = readJson(join(root, SETTINGS_DIR, 'config.json'))
  const problems = validateConfig(config)
  if (problems.length > 0) throw new ProjectError(`${join(root, SETTINGS_DIR, 'config.json')} 가 규칙에 맞지 않는다:\n- ${problems.join('\n- ')}`)
  const profiles = readJson(join(root, SETTINGS_DIR, 'profiles.json'))
  const profileProblems = validateProfiles(profiles)
  if (profileProblems.length > 0) throw new ProjectError(`${join(root, SETTINGS_DIR, 'profiles.json')} 가 규칙에 맞지 않는다:\n- ${profileProblems.join('\n- ')}`)
  return {
    root,
    config,
    profiles,
    boardPath: join(root, BOARD_DIR),
    settingsPath: join(root, SETTINGS_DIR),
    columnOf: (status) => config.columns.find((column) => column.status == status) ?? null,
    columnOfDir: (dir) => config.columns.find((column) => column.dir == dir) ?? null,
  }
}
