// 카드 세션이 보고하는 메인 세션(`.uhd-kanban/main.json`)을 내거나 등록한다. 규칙은 lib/main.mjs 가 갖는다.
// 메인 세션을 새 세션으로 바꿀 때 새 세션에서 --set 을 실행한다. 돌고 있는 카드 세션의 프롬프트는 main 을 가리키므로 고치지 않는다.
// uhd-kanban main [--set [<이름>]]   --set 에 이름이 없으면 이 세션의 이름.

import { UsageError, stringFlag } from '../args.mjs'
import { t } from '../i18n.mjs'
import { withLock } from '../lock.mjs'
import { isMainName, readMain, writeMain } from '../main.mjs'
import { ProjectError } from '../errors.mjs'
import { loadProject } from '../project.mjs'
import { currentSessionName, listSessions } from '../sessions.mjs'

// --set 은 깨진 main.json(JSON 오류 · name 오류)을 덮어써 고친다. 인자 없는 main 과 다른 명령은 readMain 의 오류로 끝나 깨진 파일이 드러난다.
const previousName = (project) => {
  try {
    return readMain(project)?.name ?? null
  } catch (error) {
    if (!(error instanceof ProjectError)) throw error
    return null
  }
}

export const run = async ({ flags }) => {
  const project = loadProject()
  if (flags.set == null) {
    const entry = readMain(project)
    console.log(entry ? t('main.show', { name: entry.name, session: entry.session ?? '-', at: entry.set_at ?? '-' }) : t('main.none'))
    return 0
  }
  const sessions = listSessions()
  const name = stringFlag(flags, 'set') ?? currentSessionName(sessions)
  if (name == null) throw new UsageError(t('main.noName'))
  if (!isMainName(name)) throw new UsageError(t('main.badName', { name }))
  // SendMessage 는 이름으로 보내므로 같은 이름의 세션이 둘이면 받는 쪽을 고르지 못한다.
  const matches = sessions.filter((session) => session.name == name)
  if (matches.length == 0) throw new ProjectError(t('main.unknown', { name }))
  if (matches.length > 1) throw new ProjectError(t('main.duplicate', { name, count: matches.length }))
  return withLock(project.settingsPath, async () => {
    const previous = previousName(project)
    writeMain(project, { name, session: matches[0].sessionId })
    console.log(t('main.set', { name, previous }))
    return 0
  })
}
