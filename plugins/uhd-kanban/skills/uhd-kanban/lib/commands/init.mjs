// 프로젝트 루트에 `.uhd-kanban/`(config.json · profiles.json)과 `kanban/` 을 만든다.
// 이미 `.uhd-kanban/` 이 있으면 아무것도 바꾸지 않고 종료 코드 1 로 끝난다.
// 열 디렉터리는 카드가 처음 들어갈 때 만든다. 쓰지 않는 상태의 빈 디렉터리를 남기지 않으려는 것이다.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BOARD_DIR, SETTINGS_DIR, loadProject } from '../project.mjs'

export const run = async ({ flags }, { skillRoot }) => {
  const root = resolve(typeof flags.dir == 'string' ? flags.dir : process.cwd())
  const settings = join(root, SETTINGS_DIR)
  if (existsSync(settings)) {
    console.error(`${settings} 가 이미 있다. 바꾸지 않았다`)
    return 1
  }
  mkdirSync(settings, { recursive: true })
  for (const file of ['config.json', 'profiles.json']) copyFileSync(join(skillRoot, 'templates', file), join(settings, file))
  mkdirSync(join(root, BOARD_DIR), { recursive: true })
  const project = loadProject(root)
  console.log(`만들었다: ${join(SETTINGS_DIR, 'config.json')} · ${join(SETTINGS_DIR, 'profiles.json')} · ${BOARD_DIR}/`)
  console.log(`열 ${project.config.columns.length}개: ${project.config.columns.map((column) => column.dir).join(' · ')}`)
  return 0
}
