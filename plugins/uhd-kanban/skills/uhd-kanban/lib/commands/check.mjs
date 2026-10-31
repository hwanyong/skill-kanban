// config.json 과 모든 카드를 읽어 규칙 위반을 알린다. 파일은 바꾸지 않는다.
// milestone 의 열이 소속 카드의 진행과 어긋나면 stderr 에 알리고 종료 코드는 바꾸지 않는다. 옮길지는 메인 세션이 정한다.

import { readBoard } from '../board.mjs'
import { t } from '../i18n.mjs'
import { milestoneDrift } from '../lanes.mjs'
import { loadProject, milestoneStatuses } from '../project.mjs'

export const run = async () => {
  const project = loadProject()
  const board = readBoard(project)
  const { cards, archived, problems } = board
  console.log(t('check.summary', { cards: cards.length, archived: archived.length, root: project.root }))
  const { waiting, finished } = milestoneDrift(project, board)
  const { running, finished: done } = milestoneStatuses(project.config)
  const runStatus = project.config.run.status
  waiting.forEach((lane) => console.error(t('check.milestoneWaiting', { id: lane.milestone.id, status: lane.milestone.status, running, runStatus, ids: lane.cards.filter((card) => card.status == runStatus).map((card) => `k${card.id}`) })))
  finished.forEach((lane) => console.error(t('check.milestoneFinished', { id: lane.milestone.id, status: lane.milestone.status, done, total: lane.total })))
  if (problems.length == 0) return 0
  console.error(t('check.problems', { problems }))
  return 1
}
