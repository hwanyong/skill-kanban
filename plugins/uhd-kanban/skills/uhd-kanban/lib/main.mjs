// 카드 세션이 보고하는 메인 세션을 역할 이름 main 으로 가리킨다. 실제 세션 이름은 `.uhd-kanban/main.json` 한 곳에 둔다.
// 카드 프롬프트 · 코멘트 머리 줄에는 main 을 적고, uk comment 가 SendMessage 줄을 낼 때만 실제 이름으로 바꾼다.
// 그래서 메인 세션을 새 세션으로 바꿔도(uk main --set) 이미 돌고 있는 카드 세션의 보고가 새 세션 앞으로 나온다.
// main.json: { "name": <세션 이름>, "session": <session id>, "set_at": <ISO 8601 UTC> }

import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { now } from './cards.mjs'
import { USER, isName } from './comments.mjs'
import { t } from './i18n.mjs'
import { ProjectError, readJson } from './project.mjs'
import { isCardSessionName } from './prompt.mjs'
import { currentSessionName } from './sessions.mjs'

export const MAIN = 'main'

const mainPath = (project) => join(project.settingsPath, 'main.json')

// 메인 세션으로 등록할 수 있는 이름인가. 카드 세션 · 역할 이름 · user 는 등록하지 않는다.
export const isMainName = (name) => isName(name ?? '') && !isCardSessionName(name) && name != MAIN && name != USER

// 반환: main.json 의 값. 등록하지 않았으면 null.
export const readMain = (project) => {
  const path = mainPath(project)
  if (!existsSync(path)) return null
  const entry = readJson(path)
  if (!isMainName(entry?.name)) throw new ProjectError(t('main.badFile', { path }))
  return entry
}

export const writeMain = (project, { name, session }) => {
  writeFileSync(mainPath(project), `${JSON.stringify({ name, session, set_at: now() }, null, 2)}\n`)
}

// 받는 이름을 SendMessage 가 받는 세션 이름으로 바꾼다. main 인데 등록하지 않았으면 null.
export const resolveName = (project, name) => (name == MAIN ? readMain(project)?.name ?? null : name)

// 세션 이름을 코멘트에 적을 이름으로 바꾼다. 등록된 메인 세션이면 main 이다.
export const roleName = (project, name) => (name != null && readMain(project)?.name == name ? MAIN : name)

// inbox 가 같은 받는 쪽으로 보는 이름들. 등록된 메인 세션의 이름과 main 은 같은 받는 쪽이다.
export const addressNames = (project, name) => {
  const registered = readMain(project)?.name
  if (name == MAIN) return registered ? [MAIN, registered] : [MAIN]
  return registered == name ? [name, MAIN] : [name]
}

// run · recover 가 카드 프롬프트와 [assign] 코멘트에 적을 보고받는 이름. 세션 밖에서 불렀으면 null 이다.
// 등록된 메인 세션이 없어도 이 세션이 메인 세션이 될 수 있으면 main 이다. 등록은 세션을 띄운 뒤 claimMain 이 한다.
export const reportName = (project, sessions) => {
  const name = currentSessionName(sessions)
  if (name == null) return null
  const registered = readMain(project)?.name
  if (registered != null) return registered == name ? MAIN : name
  return isMainName(name) ? MAIN : name
}

// 등록된 메인 세션이 없으면 이 세션을 등록한다. run · recover 가 카드 세션을 띄운 뒤 부른다. 띄우지 못했으면 부르지 않아 main.json 이 생기지 않는다.
export const claimMain = (project, sessions) => {
  const name = currentSessionName(sessions)
  if (!isMainName(name) || readMain(project) != null) return
  writeMain(project, { name, session: process.env.CLAUDE_CODE_SESSION_ID })
  console.error(t('main.registered', { name }))
}
