// config.json 과 모든 카드를 읽어 규칙 위반을 알린다. 파일은 바꾸지 않는다.
// milestone 의 열이 소속 카드의 진행과 어긋나면 stderr 에 알리고 종료 코드는 바꾸지 않는다. 옮길지는 메인 세션이 정한다.
// 다른 보드와 겹치면(root.mjs 의 overlappingBoards) stderr 에 알리고 종료 코드는 바꾸지 않는다. init 이 겹치는 보드를 거절하기 전에 만든 보드를 옮길지 지울지는 사용자가 정한다.
// outbox(lib/outbox.mjs)에 파일이 남았는데 `claude agents --json` 목록에 그 세션이 없으면 stderr 에 알리고 종료 코드는 바꾸지 않는다. 메시지를 지우지 않는다. 꺼내 읽고 지우는 것은 uhd-kanban outbox --session <id> 다.
// claude 를 실행하지 못하면 세션 목록을 모르므로 그 알림만 건너뛴다.
// lock 안에서 읽는다. 남이 쓰는 중에 읽으면 renumber 의 임시 이름(.renumber-k<id>.md)과 반쯤 쓴 파일을 위반으로 보고 ENOENT 로 죽었다(2026-11-11 실측: renumber 반복 중 check 80번 중 66번 거짓 위반, board --json 100번 중 2번 ENOENT).

import { readAgents } from '../agents.mjs'
import { viewBoard } from '../edit.mjs'
import { t } from '../i18n.mjs'
import { milestoneDrift } from '../lanes.mjs'
import { listOutboxSessions } from '../outbox.mjs'
import { loadProject, milestoneStatuses } from '../project.mjs'
import { overlappingBoards } from '../root.mjs'

// 처리할 수 있는 오류는 claude 실행 실패 하나라서 그 호출만 잡는다.
const liveSessionIds = () => {
  try {
    return readAgents().map((session) => session.sessionId)
  } catch {
    return null
  }
}

// 받는 플래그와 위치 인자 수(lib/args.mjs 의 parseArgs).
export const ARGS = { flags: {}, positional: 0 }

export const run = async () => {
  const project = loadProject()
  const board = await viewBoard(project)
  const { cards, archived, problems } = board
  console.log(t('check.summary', { cards: cards.length, archived: archived.length, root: project.root }))
  const { ancestor, children, home } = overlappingBoards(project.root)
  if (home) console.error(t('check.home', { root: project.root }))
  if (ancestor != null) console.error(t('check.ancestor', { root: project.root, ancestor }))
  if (children.length > 0) console.error(t('check.children', { root: project.root, children }))
  const outboxIds = listOutboxSessions(project)
  const live = outboxIds.length > 0 ? liveSessionIds() : null
  if (live != null) outboxIds.filter((id) => !live.includes(id)).forEach((id) => console.error(t('check.outboxOrphan', { id })))
  const { waiting, finished } = milestoneDrift(project, board)
  const { running, finished: done } = milestoneStatuses(project.config)
  const runStatus = project.config.run.status
  waiting.forEach((lane) => console.error(t('check.milestoneWaiting', { id: lane.milestone.id, status: lane.milestone.status, running, runStatus, ids: lane.cards.filter((card) => card.status == runStatus).map((card) => `k${card.id}`) })))
  finished.forEach((lane) => console.error(t('check.milestoneFinished', { id: lane.milestone.id, status: lane.milestone.status, done, total: lane.total })))
  if (problems.length == 0) return 0
  console.error(t('check.problems', { problems }))
  return 1
}
