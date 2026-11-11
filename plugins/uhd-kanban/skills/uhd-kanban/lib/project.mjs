// 프로젝트 루트를 찾고 `.uhd-kanban/config.json` 을 읽어 검증한다. 루트를 찾는 규칙은 root.mjs 가 갖는다.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOCALES, configLocale, kindText, t } from './i18n.mjs'
import { NoProjectError, ProjectError } from './errors.mjs'
import { ID, ID_PATTERN } from './ids.mjs'
import { LEGACY_KINDS, RUN_KINDS, kindId } from './kinds.mjs'
import { validateProfiles } from './profiles.mjs'
import { BOARD_DIR, SETTINGS_DIR, configFile, findCallerRootOrNull, profilesFile, rememberBoard } from './root.mjs'

// order.width(파일 이름의 순서 번호 자릿수)의 범위.
const MIN_ORDER_WIDTH = 3
const MAX_ORDER_WIDTH = 8

// monitor.interval_seconds 의 하한. 갱신마다 `claude agents --json` 과 node 프로세스가 하나씩 돈다.
const MIN_MONITOR_SECONDS = 10

// run.max_parallel 이 없을 때의 동시 실행 수와 무제한 값. 이 키보다 먼저 만든 보드의 config.json 에는 키가 없으므로 없으면 기본값을 쓴다.
const DEFAULT_MAX_PARALLEL = 3
export const UNLIMITED = -1

// run · recover 가 동시에 돌리는 카드 세션의 최대 수. UNLIMITED 이면 제한이 없다.
export const maxParallel = (config) => config.run.max_parallel ?? DEFAULT_MAX_PARALLEL

// run · recover 가 카드 세션에 넣는 환경 변수(이름 → 값). 키가 없으면 넣지 않는다. 넣는 방법은 lib/sessions.mjs 의 envArgs 가 갖는다.
export const runEnv = (config) => config.run.env ?? {}

// 환경 변수 이름 규칙. POSIX 의 portable 이름(영문자 · 숫자 · 밑줄, 숫자로 시작하지 않음)이다.
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

// initial · run.finish · dependencies.abandoned 가 없을 때의 값. 이 키보다 먼저 만든 보드에는 키가 없다.
// columns 를 바꾼 보드에서 없는 status 를 가리키지 않도록, 쓰기 전에 그 보드의 columns 에 맞는 것만 남긴다.
const DEFAULT_INITIAL = { task: 'to-do', bug: 'to-do', decision: 'to-do', milestone: 'planned' }
const DEFAULT_FINISH = { task: 'in-review', bug: 'in-review', decision: 'decided' }
const DEFAULT_ABANDONED = ['cancelled']

const allows = (config, status, type) => config.columns.some((column) => column.status == status && column.types.includes(type))

const validDefaults = (config, defaults) => Object.fromEntries(Object.entries(defaults).filter(([type, status]) => allows(config, status, type)))

// type 마다 카드 세션이 [result] 를 남긴 뒤 카드를 옮길 status. 없는 type 은 옮기지 않는다.
const finishStatuses = (config) => config.run.finish ?? validDefaults(config, DEFAULT_FINISH)

export const finishStatus = (config, type) => {
  const finish = finishStatuses(config)
  return Object.hasOwn(finish, type) ? finish[type] : null
}

// 다시 끝나지 않는 status. 이 열의 카드를 depends_on 에 둔 카드는 --force 없이 dependencies.gate 열로 옮길 수 없다.
export const abandonedStatuses = (config) => config.dependencies.abandoned ?? DEFAULT_ABANDONED.filter((status) => config.columns.some((column) => column.status == status))

// 끝난 status. 이 열의 카드는 다시 진행되지 않는다.
export const endedStatuses = (config) => [...config.dependencies.resolved, ...abandonedStatuses(config)]

// uk new 가 --status 없이 type 의 카드를 둘 status. 없는 type 은 --status 로 준다.
// columns 의 차례로 정하지 않는다. done 이 milestone 을 받으면 planned 보다 앞에 있다.
export const initialStatus = (config, type) => {
  const initial = config.initial ?? validDefaults(config, DEFAULT_INITIAL)
  return Object.hasOwn(initial, type) ? initial[type] : null
}

// collection 은 카드가 속한 milestone 카드의 id 목록이다(Nimbalyst 의 items 를 옮긴 키).
export const COLLECTION_TYPE = 'milestone'

// milestone 을 받는 열. open: 끝나지 않은 열(columns 차례). waiting: 새 milestone 이 놓이는 열(initial).
// running: open 중 waiting 이 아닌 마지막 열. finished: milestone 을 받는 dependencies.resolved 의 열. 템플릿에서는 차례대로 planned · active · done 이다.
export const milestoneStatuses = (config) => {
  const statuses = config.columns.filter((column) => column.types.includes(COLLECTION_TYPE)).map((column) => column.status)
  const ended = endedStatuses(config)
  const open = statuses.filter((status) => !ended.includes(status))
  const waiting = initialStatus(config, COLLECTION_TYPE)
  return { open, waiting, running: open.findLast((status) => status != waiting) ?? null, finished: statuses.find((status) => config.dependencies.resolved.includes(status)) ?? null }
}

// cwd 위에 보드가 없으면 부른 세션을 띄운 디렉터리에서 다시 찾는다(root.mjs 의 findCallerRootOrNull).
export const findRoot = (cwd = process.cwd()) => {
  const root = findCallerRootOrNull(cwd)
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

// 열 dir: <순서 번호>-<id>.
const COLUMN_DIR = new RegExp(`^\\d+-${ID_PATTERN}$`)

// status · type · archive.dir 의 이름. ID.test 는 문자열이 아닌 값을 문자열로 바꿔 보므로(true → 'true') 형을 먼저 본다.
const isName = (value) => typeof value == 'string' && ID.test(value)

const isPositiveInteger = (value) => Number.isInteger(value) && value > 0

// initial · run.finish 처럼 type 이름 → status 이름인 객체를 본다. 없으면(null) 기본값을 쓰므로 문제가 아니다.
const typeStatusProblems = (columns, key, map) => {
  if (map == null) return []
  if (typeof map != 'object' || Array.isArray(map)) return [t('config.typeStatusObject', { key })]
  return Object.entries(map)
    .filter(([type, status]) => !columns.some((column) => column?.status == status && column?.types?.includes?.(type)))
    .map(([type, status]) => t('config.typeStatusBad', { key, type, status }))
}

// run.env 를 본다. 없으면(null) 넣지 않으므로 문제가 아니다.
const envProblems = (env) => {
  if (env == null) return []
  if (typeof env != 'object' || Array.isArray(env)) return [t('config.runEnvObject', { value: JSON.stringify(env) })]
  return Object.entries(env).flatMap(([name, value]) => [
    ...(ENV_NAME.test(name) ? [] : [t('config.runEnvName', { name: JSON.stringify(name) })]),
    ...(typeof value == 'string' ? [] : [t('config.runEnvValue', { name, value: JSON.stringify(value) })]),
  ])
}

// dependencies · archive 의 status 이름 배열을 본다. columns 에 없는 status 를 하나씩 알린다.
const statusListProblems = (statuses, key, list) => !Array.isArray(list)
  ? [t('config.statusList', { key })]
  : list.filter((status) => !statuses.has(status)).map((status) => t('config.unknownStatus', { key, status }))

// 0.4.0 까지의 한국어 kind 가 남았으면 migrate 를 알린다. 그 밖의 형식 위반은 형식만 알린다.
const kindProblems = (kinds) => {
  if (!Array.isArray(kinds) || kinds.length == 0 || kinds.some((kind) => typeof kind != 'string')) return [t('config.kinds')]
  const legacy = kinds.filter((kind) => Object.hasOwn(LEGACY_KINDS, kind))
  const malformed = kinds.filter((kind) => !Object.hasOwn(LEGACY_KINDS, kind) && !ID.test(kind))
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
    if (typeof column?.dir != 'string' || !COLUMN_DIR.test(column.dir)) problems.push(t('config.columnDir', { at, dir: column?.dir }))
    if (!isName(column?.status)) problems.push(t('config.columnStatus', { at, status: column?.status }))
    if (dirs.has(column?.dir)) problems.push(t('config.columnDirDup', { at, dir: column?.dir }))
    if (statuses.has(column?.status)) problems.push(t('config.columnStatusDup', { at, status: column?.status }))
    dirs.add(column?.dir)
    statuses.add(column?.status)
    const types = column?.types
    if (!Array.isArray(types) || types.length == 0 || types.some((type) => !isName(type))) problems.push(t('config.columnTypes', { at }))
  })
  if (config?.locale != null && !LOCALES.includes(config.locale)) problems.push(t('config.locale', { value: JSON.stringify(config.locale), locales: LOCALES }))
  const order = config?.order ?? {}
  if (!Number.isInteger(order.width) || order.width < MIN_ORDER_WIDTH || order.width > MAX_ORDER_WIDTH) problems.push(t('config.orderWidth', { min: MIN_ORDER_WIDTH, max: MAX_ORDER_WIDTH, value: order.width }))
  if (!isPositiveInteger(order.step)) problems.push(t('config.orderStep', { value: order.step }))
  const dependencies = config?.dependencies ?? {}
  for (const key of ['gate', 'resolved']) statusListProblems(statuses, `dependencies.${key}`, dependencies[key]).forEach((problem) => problems.push(problem))
  const abandoned = dependencies.abandoned
  const resolved = Array.isArray(dependencies.resolved) ? dependencies.resolved : []
  if (abandoned != null) statusListProblems(statuses, 'dependencies.abandoned', abandoned).forEach((problem) => problems.push(problem))
  if (Array.isArray(abandoned)) abandoned.filter((status) => resolved.includes(status)).forEach((status) => problems.push(t('config.abandonedResolved', { status })))
  kindProblems(config?.comments?.kinds).forEach((problem) => problems.push(problem))
  const archive = config?.archive ?? {}
  statusListProblems(statuses, 'archive.columns', archive.columns).forEach((problem) => problems.push(problem))
  if (!Number.isInteger(archive.after_days) || archive.after_days < 0) problems.push(t('config.afterDays', { value: archive.after_days }))
  if (!isName(archive.dir) || dirs.has(archive.dir)) problems.push(t('config.archiveDir', { value: archive.dir }))
  if (!statuses.has(config?.run?.status)) problems.push(t('config.runStatus', { value: config?.run?.status }))
  const parallel = config?.run?.max_parallel
  if (parallel != null && (!Number.isInteger(parallel) || (parallel < 1 && parallel != UNLIMITED))) problems.push(t('config.maxParallel', { unlimited: UNLIMITED, fallback: DEFAULT_MAX_PARALLEL, value: JSON.stringify(parallel) }))
  typeStatusProblems(columns, 'initial', config?.initial).forEach((problem) => problems.push(problem))
  typeStatusProblems(columns, 'run.finish', config?.run?.finish).forEach((problem) => problems.push(problem))
  envProblems(config?.run?.env).forEach((problem) => problems.push(problem))
  const interval = config?.monitor?.interval_seconds
  if (!Number.isInteger(interval) || interval < MIN_MONITOR_SECONDS) problems.push(t('config.interval', { min: MIN_MONITOR_SECONDS, value: interval }))
  return problems
}

export const loadProject = (cwd = process.cwd()) => {
  const root = findRoot(cwd)
  rememberBoard(root)
  const configPath = configFile(root)
  const config = readJson(configPath)
  const problems = validateConfig(config)
  if (problems.length > 0) throw new ProjectError(t('project.invalid', { path: configPath, problems }))
  const profilesPath = profilesFile(root)
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
  }
}
