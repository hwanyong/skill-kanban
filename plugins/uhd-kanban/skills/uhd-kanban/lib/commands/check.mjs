// config.json 과 모든 카드를 읽어 규칙 위반을 알린다. 파일은 바꾸지 않는다.

import { readBoard } from '../board.mjs'
import { loadProject } from '../project.mjs'

export const run = async () => {
  const project = loadProject()
  const { cards, archived, problems } = readBoard(project)
  console.log(`카드 ${cards.length}개 · 아카이브 ${archived.length}개 (${project.root})`)
  if (problems.length == 0) return 0
  console.error(`규칙 위반 ${problems.length}건:\n- ${problems.join('\n- ')}`)
  return 1
}
