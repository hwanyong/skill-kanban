// config.json 과 모든 카드를 읽어 규칙 위반을 알린다. 파일은 바꾸지 않는다.

import { readBoard } from '../board.mjs'
import { t } from '../i18n.mjs'
import { loadProject } from '../project.mjs'

export const run = async () => {
  const project = loadProject()
  const { cards, archived, problems } = readBoard(project)
  console.log(t('check.summary', { cards: cards.length, archived: archived.length, root: project.root }))
  if (problems.length == 0) return 0
  console.error(t('check.problems', { problems }))
  return 1
}
