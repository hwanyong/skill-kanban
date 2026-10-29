// 프로젝트 루트에 `.uhd-kanban/`(config.json · profiles.json)과 `kanban/` 을 만든다.
// 이미 `.uhd-kanban/` 이 있으면 아무것도 바꾸지 않고 종료 코드 1 로 끝난다.
// config.json 의 locale 은 --locale 로 정하고, 없으면 지금 환경 변수(LC_ALL → LC_MESSAGES → LANG)로 정한다. 그 뒤로는 환경 변수와 무관하게 이 값을 쓴다.
// 열 디렉터리는 카드가 처음 들어갈 때 만든다. 쓰지 않는 상태의 빈 디렉터리를 남기지 않으려는 것이다.
// uhd-kanban init [--dir <경로>] [--locale ko|en]

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { UsageError } from '../args.mjs'
import { LOCALES, envLocale, t, translator } from '../i18n.mjs'
import { BOARD_DIR, SETTINGS_DIR, formatConfig, loadProject, readJson } from '../project.mjs'

export const run = async ({ flags }, { skillRoot }) => {
  const root = resolve(typeof flags.dir == 'string' ? flags.dir : process.cwd())
  const locale = typeof flags.locale == 'string' ? flags.locale : envLocale()
  if (!LOCALES.includes(locale)) throw new UsageError(t('init.locale', { value: flags.locale, locales: LOCALES }))
  const tr = translator(locale)
  const settings = join(root, SETTINGS_DIR)
  if (existsSync(settings)) {
    console.error(tr('init.exists', { path: settings }))
    return 1
  }
  mkdirSync(settings, { recursive: true })
  writeFileSync(join(settings, 'config.json'), formatConfig({ locale, ...readJson(join(skillRoot, 'templates', 'config.json')) }))
  copyFileSync(join(skillRoot, 'templates', 'profiles.json'), join(settings, 'profiles.json'))
  mkdirSync(join(root, BOARD_DIR), { recursive: true })
  const project = loadProject(root)
  console.log(tr('init.created', { files: [join(SETTINGS_DIR, 'config.json'), join(SETTINGS_DIR, 'profiles.json'), `${BOARD_DIR}/`], locale }))
  console.log(tr('init.columns', { count: project.config.columns.length, dirs: project.config.columns.map((column) => column.dir) }))
  return 0
}
