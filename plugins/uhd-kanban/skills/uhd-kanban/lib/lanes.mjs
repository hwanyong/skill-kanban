// 보드를 milestone 마다 묶는다. 보드 모니터의 swimlane(board 명령)과 milestone 어긋남 알림(check 명령)이 함께 쓴다.

import { COLLECTION_TYPE, endedStatuses, milestoneStatuses } from './project.mjs'

export const isWork = (card) => card.data.type != COLLECTION_TYPE

// 막대 칸의 차례: 끝난 열(columns 차례) → 나머지 열의 역순. 끝난 카드가 막대의 왼쪽에 모인다.
// run.status 열 안에서는 세션 판정이 done 인 카드 → live 인 카드 → 나머지 차례다. done 이 in-review 쪽, 나머지가 to-do 쪽이라 막대가 to-do 에서 done 까지 진행 차례로 쌓인다.
const SESSION_ORDER = ['done', 'live']
const finishOrder = (config) => {
  const statuses = config.columns.map((column) => column.status)
  const ended = endedStatuses(config)
  return [...statuses.filter((status) => ended.includes(status)), ...statuses.filter((status) => !ended.includes(status)).reverse()]
}

// verdicts: 카드 id → 세션 판정. board 명령이 넘기고, 넘기지 않으면 열 안의 차례는 보드 차례 그대로다.
// 반환: [{ milestone, cards, members, finished, total }]. 차례는 진행이 앞선 열의 milestone → 소속이 없는 카드이고, 소속이 없는 묶음의 milestone 은 null 이다.
// cards 는 열 안의 작업 카드이고 members 는 거기에 아카이브한 소속 카드를 더한 것이다. finished · total 은 members 를 센다. 여러 milestone 에 속한 카드는 묶음마다 든다.
// 소속이 없는 묶음은 collection 이 빈 카드다. 끝난 milestone 은 묶지 않으므로 그 소속 카드는 어느 묶음에도 들지 않는다.
export const boardLanes = (project, { cards, archived }, verdicts = new Map()) => {
  const { config } = project
  const ended = endedStatuses(config)
  const rank = (card) => {
    const at = SESSION_ORDER.indexOf(verdicts.get(card.id))
    return at == -1 ? SESSION_ORDER.length : at
  }
  const work = finishOrder(config).flatMap((status) => {
    const inColumn = cards.filter((card) => card.status == status && isWork(card))
    return status == config.run.status ? inColumn.toSorted((a, b) => rank(a) - rank(b)) : inColumn
  })
  const past = archived.filter(isWork)
  const milestones = milestoneStatuses(config).open.toReversed().flatMap((status) => cards.filter((card) => card.status == status && !isWork(card)))
  const collection = (card) => (Array.isArray(card.data.collection) ? card.data.collection : [])
  const lane = (milestone, isMember) => {
    const inLane = work.filter(isMember)
    const pastMembers = past.filter(isMember)
    return { milestone, cards: inLane, members: [...pastMembers, ...inLane], finished: pastMembers.length + inLane.filter((card) => ended.includes(card.status)).length, total: pastMembers.length + inLane.length }
  }
  const lanes = milestones.map((milestone) => lane(milestone, (card) => collection(card).includes(milestone.id)))
  const rest = lane(null, (card) => collection(card).length == 0)
  return rest.total > 0 ? [...lanes, rest] : lanes
}

// 열이 소속 카드의 진행과 어긋난 milestone. waiting: waiting 열인데 run.status 열의 소속 카드가 있다. finished: running 열인데 소속 카드가 모두 끝났다.
export const milestoneDrift = (project, board) => {
  const { waiting, running, finished: done } = milestoneStatuses(project.config)
  const lanes = boardLanes(project, board).filter((lane) => lane.milestone != null)
  // 옮길 열(running · finished)이 없으면 안내할 move 가 없으므로 알리지 않는다. cards.mjs 의 startMilestones 와 같은 판단이다.
  return {
    waiting: running == null ? [] : lanes.filter((lane) => lane.milestone.status == waiting && lane.cards.some((card) => card.status == project.config.run.status)),
    finished: done == null ? [] : lanes.filter((lane) => lane.milestone.status == running && lane.total > 0 && lane.finished == lane.total),
  }
}
