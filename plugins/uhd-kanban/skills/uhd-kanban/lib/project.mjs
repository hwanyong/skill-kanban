// 프로젝트 루트를 찾고 `.uhd-kanban/config.json` 을 읽어 검증한다. 루트를 찾는 규칙은 root.mjs 가 갖는다.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOCALES, configLocale, kindText, t } from './i18n.mjs'
import { KIND_ID, LEGACY_KINDS, RUN_KINDS, kindId } from './kinds.mjs'
import { validateProfiles } from './profiles.mjs'
import { BOARD_DIR, SETTINGS_DIR, findRootOrNull } from './root.mjs'

export { BOARD_DIR, SETTINGS_DIR }

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

// type 마다 카드 세션이 [result] 를 남긴 뒤 카드를 옮길 status. 없는 type 은 옮기지 않는다.
export const finishStatuses = (config) => config.run.finish ?? validDefaults(config, DEFAULT_FINISH)

export const finishStatus = (config, type) => finishStatuses(config)[type] ?? null

// 다시 끝나지 않는 status. 이 열의 카드를 depends_on 에 둔 카드는 --force 없이 dependencies.gate 열로 옮길 수 없다.
export const abandonedStatuses = (config) => config.dependencies.abandoned ?? DEFAULT_ABANDONED.filter((status) => config.columns.some((column) => column.status == status))

// uk new 가 --status 없이 type 의 카드를 둘 status. 없는 type 은 --status 로 준다.
// columns 의 차례로 정하지 않는다. done 이 milestone 을 받으면 planned 보다 앞에 있다.
export const initialStatus = (config, type) => (config.initial ?? validDefaults(config, DEFAULT_INITIAL))[type] ?? null

export const findRoot = (cwd = process.cwd()) => {
  const root = findRootOrNull(cwd)
  if (root == null) throw new NoProjectError(t('project.noRoot', { cwd, settings: SETTINGS_DIR }))
  return root
}

export const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new ProjectError(t('project.badJson', { path, message: error.message }))
  }
}

// config.json 을 templates/config.json 과 같은 모양으로 쓴다. 최상위 키마다 한 줄이고, 객체 목록(columns)은 항목마다 한 줄이다.
// JSON.stringify(config, null, 2) 는 열 하나를 여러 줄로 풀어 사람이 열 차례를 한눈에 보지 못한다. init 과 migrate 가 쓴다.
const inline = (value) => {
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`
  if (value == null || typeof value != 'object') return JSON.stringify(value)
  const entries = Object.entries(value)
  return entries.length == 0 ? '{}' : `{ ${entries.map(([key, item]) => `${JSON.stringify(key)}: ${inline(item)}`).join(', ')} }`
}

export const formatConfig = (config) => {
  const lines = Object.entries(config).map(([key, value]) => {
    const head = `  ${JSON.stringify(key)}: `
    const rows = Array.isArray(value) && value.some((item) => item != null && typeof item == 'object')
    return rows ? `${head}[\n${value.map((item) => `    ${inline(item)}`).join(',\n')}\n  ]` : `${head}${inline(value)}`
  })
  return `{\n${lines.join(',\n')}\n}\n`
}

// 명령이 받은 kind 를 id 로 바꾸고 comments.kinds 에 있는지 본다. 반환: kind id.
export const assertKind = (project, kind) => {
  const id = kindId(kind)
  const kinds = project.config.comments.kinds
  if (!kinds.includes(id)) throw new ProjectError(t('kind.notAllowed', { kind, kinds: kinds.map((item) => kindText(item)) }))
  return id
}

const isPositiveInteger = (value) => Number.isInteger(value) && value > 0

// initial · run.finish 처럼 type 이름 → status 이름인 객체를 본다. 없으면(null) 기본값을 쓰므로 문제가 아니다.
const typeStatusProblems = (columns, key, map) => {
  if (map == null) return []
  if (typeof map != 'object' || Array.isArray(map)) return [t('config.typeStatusObject', { key })]
  return Object.entries(map)
    .filter(([type, status]) => !columns.some((column) => column?.status == status && column?.types?.includes?.(type)))
    .map(([type, status]) => t('config.typeStatusBad', { key, type, status }))
}

// 0.4.0 까지의 한국어 kind 가 남았으면 migrate 를 알린다. 그 밖의 형식 위반은 형식만 알린다.
const kindProblems = (kinds) => {
  if (!Array.isArray(kinds) || kinds.length == 0 || kinds.some((kind) => typeof kind != 'string')) return [t('config.kinds')]
  const legacy = kinds.filter((kind) => Object.hasOwn(LEGACY_KINDS, kind))
  const malformed = kinds.filter((kind) => !Object.hasOwn(LEGACY_KINDS, kind) && !KIND_ID.test(kind))
  return [
    ...(legacy.length > 0 ? [t('config.kindsLegacy', { kinds: legacy })] : []),
    ...malformed.map((kind) => t('config.kindMalformed', { kind })),
    ...(legacy.length > 0 ? [] : RUN_KINDS.filter((kind) => !kinds.includes(kind)).map((kind) => t('config.runKindMissing', { kind }))),
  ]
}

// 문제를 하나씩 멈추지 않고 모두 모아 한 번에 알린다.
export const validateConfig = (config) => {
  const problems = []
  const columns = Array.isArray(config?.columns) ? config.columns : []
  if (columns.length == 0) problems.push(t('config.columnsEmpty'))
  const dirs = new Set()
  const statuses = new Set()
  columns.forEach((column, index) => {
    const at = `columns[${index}]`
    if (!/^\d+-[a-z][a-z0-9-]*$/.test(column?.dir ?? '')) problems.push(t('config.columnDir', { at, dir: column?.dir }))
    if (!/^[a-z][a-z0-9-]*$/.test(column?.status ?? '')) problems.push(t('config.columnStatus', { at, status: column?.status }))
    if (dirs.has(column?.dir)) problems.push(t('config.columnDirDup', { at, dir: column.dir }))
    if (statuses.has(column?.status)) problems.push(t('config.columnStatusDup', { at, status: column.status }))
    dirs.add(column?.dir)
    statuses.add(column?.status)
    const types = column?.types
    if (!Array.isArray(types) || types.length == 0 || types.some((type) => !/^[a-z][a-z0-9-]*$/.test(type))) problems.push(t('config.columnTypes', { at }))
  })
  if (config?.locale != null && !LOCALES.includes(config.locale)) problems.push(t('config.locale', { value: JSON.stringify(config.locale), locales: LOCALES }))
  const order = config?.order ?? {}
  if (!Number.isInteger(order.width) || order.width < 3 || order.width > 8) problems.push(t('config.orderWidth', { value: order.width }))
  if (!isPositiveInteger(order.step)) problems.push(t('config.orderStep', { value: order.step }))
  const dependencies = config?.dependencies ?? {}
  for (const key of ['gate', 'resolved']) {
    const list = dependencies[key]
    if (!Array.isArray(list)) problems.push(t('config.statusList', { key: `dependencies.${key}` }))
    if (Array.isArray(list)) list.filter((status) => !statuses.has(status)).forEach((status) => problems.push(t('config.unknownStatus', { key: `dependencies.${key}`, status })))
  }
  const abandoned = dependencies.abandoned
  const resolved = Array.isArray(dependencies.resolved) ? dependencies.resolved : []
  if (abandoned != null && !Array.isArray(abandoned)) problems.push(t('config.statusList', { key: 'dependencies.abandoned' }))
  if (Array.isArray(abandoned)) abandoned.filter((status) => !statuses.has(status)).forEach((status) => problems.push(t('config.unknownStatus', { key: 'dependencies.abandoned', status })))
  if (Array.isArray(abandoned)) abandoned.filter((status) => resolved.includes(status)).forEach((status) => problems.push(t('config.abandonedResolved', { status })))
  kindProblems(config?.comments?.kinds).forEach((problem) => problems.push(problem))
  const archive = config?.archive ?? {}
  const archiveColumns = Array.isArray(archive.columns) ? archive.columns : []
  if (!Array.isArray(archive.columns)) problems.push(t('config.statusList', { key: 'archive.columns' }))
  archiveColumns.filter((status) => !statuses.has(status)).forEach((status) => problems.push(t('config.unknownStatus', { key: 'archive.columns', status })))
  if (!Number.isInteger(archive.after_days) || archive.after_days < 0) problems.push(t('config.afterDays', { value: archive.after_days }))
  if (!/^[a-z][a-z0-9-]*$/.test(archive.dir ?? '') || dirs.has(archive.dir)) problems.push(t('config.archiveDir', { value: archive.dir }))
  if (!statuses.has(config?.run?.status)) problems.push(t('config.runStatus', { value: config?.run?.status }))
  const parallel = config?.run?.max_parallel
  if (parallel != null && (!Number.isInteger(parallel) || (parallel < 1 && parallel != UNLIMITED))) problems.push(t('config.maxParallel', { unlimited: UNLIMITED, fallback: DEFAULT_MAX_PARALLEL, value: JSON.stringify(parallel) }))
  typeStatusProblems(columns, 'initial', config?.initial).forEach((problem) => problems.push(problem))
  typeStatusProblems(columns, 'run.finish', config?.run?.finish).forEach((problem) => problems.push(problem))
  const interval = config?.monitor?.interval_seconds
  if (!Number.isInteger(interval) || interval < MIN_MONITOR_SECONDS) problems.push(t('config.interval', { min: MIN_MONITOR_SECONDS, value: interval }))
  return problems
}

export const loadProject = (cwd = process.cwd()) => {
  const root = findRoot(cwd)
  const configPath = join(root, SETTINGS_DIR, 'config.json')
  const config = readJson(configPath)
  const problems = validateConfig(config)
  if (problems.length > 0) throw new ProjectError(t('project.invalid', { path: configPath, problems }))
  const profilesPath = join(root, SETTINGS_DIR, 'profiles.json')
  const profiles = readJson(profilesPath)
  const profileProblems = validateProfiles(profiles)
  if (profileProblems.length > 0) throw new ProjectError(t('project.invalid', { path: profilesPath, problems: profileProblems }))
  return {
    root,
    config,
    profiles,
    locale: configLocale(config),
    boardPath: join(root, BOARD_DIR),
    settingsPath: join(root, SETTINGS_DIR),
    columnOf: (status) => config.columns.find((column) => column.status == status) ?? null,
    columnOfDir: (dir) => config.columns.find((column) => column.dir == dir) ?? null,
  }
}
