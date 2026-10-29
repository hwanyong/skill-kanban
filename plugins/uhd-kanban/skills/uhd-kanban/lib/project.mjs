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

// run.max_parallel 이 없을 때의 동시 실행 수와 무제한 값. 이 키보다 먼저 만든 보드의 config.json 에는 키가 없으므로 없으면 기본값을 쓴다.
export const DEFAULT_MAX_PARALLEL = 3
export const UNLIMITED = -1

// run · recover 가 동시에 돌리는 카드 세션의 최대 수. UNLIMITED 이면 제한이 없다.
export const maxParallel = (config) => config.run.max_parallel ?? DEFAULT_MAX_PARALLEL

// initial · run.finish · dependencies.abandoned 가 없을 때의 값. 이 키보다 먼저 만든 보드에는 키가 없다.
// columns 를 바꾼 보드에서 없는 status 를 가리키지 않도록, 쓰기 전에 그 보드의 columns 에 맞는 것만 남긴다.
const DEFAULT_INITIAL = { task: 'to-do', bug: 'to-do', decision: 'to-do', milestone: 'planned' }
const DEFAULT_FINISH = { task: 'in-review', bug: 'in-review', decision: 'decided' }
const DEFAULT_ABANDONED = ['cancelled']

const allows = (config, status, type) => config.columns.some((column) => column.status == status && column.types.includes(type))

const validDefaults = (config, defaults) => Object.fromEntries(Object.entries(defaults).filter(([type, status]) => allows(config, status, type)))

// type 마다 카드 세션이 [결과] 를 남긴 뒤 카드를 옮길 status. 없는 type 은 옮기지 않는다.
export const finishStatuses = (config) => config.run.finish ?? validDefaults(config, DEFAULT_FINISH)

export const finishStatus = (config, type) => finishStatuses(config)[type] ?? null

// 다시 끝나지 않는 status. 이 열의 카드를 depends_on 에 둔 카드는 --force 없이 dependencies.gate 열로 옮길 수 없다.
export const abandonedStatuses = (config) => config.dependencies.abandoned ?? DEFAULT_ABANDONED.filter((status) => config.columns.some((column) => column.status == status))

// uk new 가 --status 없이 type 의 카드를 둘 status. 없는 type 은 --status 로 준다.
// columns 의 차례로 정하지 않는다. done 이 milestone 을 받으면 planned 보다 앞에 있다.
export const initialStatus = (config, type) => (config.initial ?? validDefaults(config, DEFAULT_INITIAL))[type] ?? null

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

// initial · run.finish 처럼 type 이름 → status 이름인 객체를 본다. 없으면(null) 기본값을 쓰므로 문제가 아니다.
const typeStatusProblems = (columns, key, map) => {
  if (map == null) return []
  if (typeof map != 'object' || Array.isArray(map)) return [`${key} 는 type 이름 → status 이름 객체다`]
  return Object.entries(map)
    .filter(([type, status]) => !columns.some((column) => column?.status == status && column?.types?.includes?.(type)))
    .map(([type, status]) => `${key} 의 ${type} → ${status}: ${status} 는 type ${type} 를 받는 columns 의 status 가 아니다`)
}

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
  const abandoned = dependencies.abandoned
  const resolved = Array.isArray(dependencies.resolved) ? dependencies.resolved : []
  if (abandoned != null && !Array.isArray(abandoned)) problems.push('dependencies.abandoned 는 status 이름 배열이다')
  if (Array.isArray(abandoned)) abandoned.filter((status) => !statuses.has(status)).forEach((status) => problems.push(`dependencies.abandoned 의 ${status} 는 columns 에 없는 status 다`))
  if (Array.isArray(abandoned)) abandoned.filter((status) => resolved.includes(status)).forEach((status) => problems.push(`dependencies.abandoned 의 ${status} 가 dependencies.resolved 에도 있다`))
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
  const parallel = config?.run?.max_parallel
  if (parallel != null && (!Number.isInteger(parallel) || (parallel < 1 && parallel != UNLIMITED))) problems.push(`run.max_parallel 은 1 이상의 정수이거나 무제한인 ${UNLIMITED} 이다(없으면 ${DEFAULT_MAX_PARALLEL}): ${JSON.stringify(parallel)}`)
  typeStatusProblems(columns, 'initial', config?.initial).forEach((problem) => problems.push(problem))
  typeStatusProblems(columns, 'run.finish', config?.run?.finish).forEach((problem) => problems.push(problem))
  const interval = config?.monitor?.interval_seconds
  if (!Number.isInteger(interval) || interval < MIN_MONITOR_SECONDS) problems.push(`monitor.interval_seconds 는 ${MIN_MONITOR_SECONDS} 이상의 정수다: ${interval}`)
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
