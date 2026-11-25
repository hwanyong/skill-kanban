// run · recover 가 카드 세션에 넘기는 `--settings` 값을 만든다.
// 값은 두 곳에서 온다. ① settings 파일: 카드의 model: 프로필에 settings 가 있으면 그것(profiles.json), 없으면 config.json 의 run.settings.
// ② config.json 의 run.env. 파일의 env 위에 run.env 를 덮어 JSON 하나로 합친다.
// `--settings` 는 값을 하나만 받는 옵션이라 두 번 주면 마지막 값만 남는다(2.1.331 실행 파일의 `.option("--settings <file-or-json>", …)`). 그래서 합친다.
// 합친 JSON 은 인자로 넘기지 않고 SNAPSHOT_DIR 아래 파일(권한 0600)로 써서 그 경로를 넘긴다. 토큰이 든 JSON 을 인자로 넘기면
// `claude --bg` 프로세스가 도는 동안 `ps` 로 다른 사용자에게도 보인다(2026-11-25 macOS 27.2 에서 uhd 사용자의 `ps -axo command` 가 root 프로세스의 인자를 냈다).
// 파일 이름은 내용의 SHA-256 이라 같은 내용은 같은 파일 하나다. 원본 파일이 나중에 바뀌어도 이미 띄운 세션에는 적용되지 않고, 다음 run · recover 부터 적용된다.
// 2026-11-11 실측(2.1.322): `claude --bg` 를 실행한 프로세스의 환경 변수는 세션에 전달되지 않았다(세션은 데몬이 띄운다).
// `--settings '{"env":{…}}'` 로 준 값은 세션의 Bash 도구 환경과 PreToolUse 훅 프로세스 환경에 모두 있었다. 사용자 · 프로젝트 settings 는 그대로 함께 적용됐다.
// 2026-11-25 실측(2.1.331): ANTHROPIC_BASE_URL 이 있는 셸에서 `claude --bg` 를 실행하자, 세션 설정에 gateway 가 없을 때 세션이 모델 요청 전에 crashed 로 끝났다
// (~/.claude/daemon.log 「No LLM gateway: session stopped. … the background service lacks the gateway」). 같은 셸에서 `--settings` 의 env 에
// ANTHROPIC_BASE_URL 을 넣자 세션이 떴고 그 주소로 요청했다(ECONNREFUSED 재시도). 그래서 assertGateway 가 띄우기 전에 같은 조건을 본다.

import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { claudeConfigDir } from './agents.mjs'
import { t } from './i18n.mjs'
import { ProjectError } from './errors.mjs'
import { runEnv } from './project.mjs'

const SETTINGS_FLAG = '--settings'

// 카드 세션이 --settings 말고도 읽는 settings 파일. gateway 가 여기 있으면 세션에 그 gateway 가 있으므로 assertGateway 가 함께 본다.
// macOS 의 managed settings 경로는 Claude Code 공식 문서(settings)의 값이다.
const MANAGED_SETTINGS = '/Library/Application Support/ClaudeCode/managed-settings.json'
const loadedSettingsFiles = (root) => [
  join(claudeConfigDir(), 'settings.json'),
  join(root, '.claude', 'settings.json'),
  join(root, '.claude', 'settings.local.json'),
  MANAGED_SETTINGS,
]

// Claude Code 가 gateway 로 보는 환경 변수. 2.1.331 의 오류 문구는 「ANTHROPIC_BASE_URL, *_BASE_URL or CLAUDE_CODE_USE_*」 다.
// `*_BASE_URL` 은 ANTHROPIC_ 으로 시작하는 것만 본다. 다른 도구의 *_BASE_URL 로 카드를 거절하지 않으려는 것이다.
// 그 이름을 Claude Code 가 gateway 로 보면 세션은 위 실측처럼 끝나고, 그 오류는 daemon.log 에 남는다.
const GATEWAY_NAME = /^(ANTHROPIC_\w*BASE_URL|CLAUDE_CODE_USE_\w+)$/

// 합친 settings 를 쓰는 디렉터리(권한 0700). 지우지 않는다: 띄운 세션이 그 파일을 다시 읽을 수 있다.
const snapshotDir = () => join(claudeConfigDir(), 'uhd-kanban', 'settings')

const isObject = (value) => value != null && typeof value == 'object' && !Array.isArray(value)

// `~/` 로 시작하면 홈 디렉터리 아래, 상대 경로면 프로젝트 루트 아래의 절대 경로.
export const settingsPath = (root, path) => resolve(root, path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)

const readSettingsFile = (path) => {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new ProjectError(t('settings.unreadable', { path, code: error.code ?? error.message }))
  }
  let settings
  try {
    settings = JSON.parse(text)
  } catch (error) {
    throw new ProjectError(t('settings.invalidJson', { path, message: error.message }))
  }
  if (!isObject(settings) || (settings.env != null && !isObject(settings.env))) throw new ProjectError(t('settings.shape', { path }))
  return settings
}

// 세션이 함께 읽는 settings 파일의 env. 없거나 읽지 못하는 파일은 빈 env 로 본다. 그 파일의 오류는 Claude Code 가 알린다.
const loadedEnv = (path) => {
  if (!existsSync(path)) return {}
  try {
    const settings = JSON.parse(readFileSync(path, 'utf8'))
    return isObject(settings?.env) ? settings.env : {}
  } catch {
    return {}
  }
}

const gatewayNames = (env) => Object.keys(env).filter((name) => GATEWAY_NAME.test(name) && env[name] != null && env[name] != '')

// uk 를 실행한 셸(메인 세션의 Bash 도구)에 gateway 가 있는데 카드 세션이 읽을 settings 어디에도 없으면 띄우지 않는다.
const assertGateway = (shellEnv, envs, root) => {
  const shell = gatewayNames(shellEnv)
  if (shell.length == 0 || envs.some((env) => gatewayNames(env).length > 0)) return
  throw new ProjectError(t('settings.gatewayMissing', { names: shell, files: loadedSettingsFiles(root) }))
}

// 카드 하나의 settings. spec 은 profiles.mjs 의 runSpec 값이고 shellEnv 는 gateway 를 비교할 셸 환경이다.
// 반환값: source(config · profiles 에 적힌 경로 그대로), args(--settings <합친 파일 경로>), json(그 파일에 쓸 내용).
// 파일도 run.env 도 없으면 args 는 빈 배열이고 json 은 null 이다. 파일은 saveSessionSettings 가 쓴다. dry-run 은 쓰지 않는다.
export const sessionSettings = (project, spec, shellEnv = process.env) => {
  const source = spec.settings ?? project.config.run.settings ?? null
  const base = source == null ? {} : readSettingsFile(settingsPath(project.root, source))
  const env = { ...(base.env ?? {}), ...runEnv(project.config) }
  assertGateway(shellEnv, [env, ...loadedSettingsFiles(project.root).map(loadedEnv)], project.root)
  const settings = Object.keys(env).length == 0 ? base : { ...base, env }
  if (Object.keys(settings).length == 0) return { source, args: [], json: null }
  const json = JSON.stringify(settings)
  const path = join(snapshotDir(), `${createHash('sha256').update(json).digest('hex').slice(0, 16)}.json`)
  return { source, args: [SETTINGS_FLAG, path], json }
}

// sessionSettings 가 고른 경로에 json 을 쓴다. 임시 파일에 0600 으로 쓰고 rename 하므로 띄우는 세션이 쓰다 만 파일을 읽지 않는다.
export const saveSessionSettings = ({ args, json }) => {
  if (json == null) return
  const path = args[1]
  mkdirSync(snapshotDir(), { recursive: true, mode: 0o700 })
  chmodSync(snapshotDir(), 0o700)
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, json, { mode: 0o600 })
  renameSync(temporary, path)
}
