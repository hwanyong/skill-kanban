// 작업 열마다 카드 수와, milestone 마다 소속 카드(swimlane)를 낸다. run.status 열 카드에는 세션 판정을 붙인다. 보드 모니터 mod 가 monitor.interval_seconds 마다 --json 으로 부른다.
// swimlane 은 카드마다 collection 이 있어야 하고 끝낸 수는 아카이브까지 세므로 readBoard 로 모든 카드를 읽는다.
// 규칙 검사는 하지 않는다. 위반은 uhd-kanban check 가 알린다.
// uhd-kanban board [--json]

import { readBoard } from '../board.mjs'
import { stripControl } from '../control.mjs'
import { t } from '../i18n.mjs'
import { boardLanes, isWork } from '../lanes.mjs'
import { COLLECTION_TYPE, loadProject, milestoneStatuses } from '../project.mjs'
import { cardSession, listSessions } from '../sessions.mjs'

// --json 은 제어 문자를 \u001b 로 escape 해서 bin 의 write 를 지나고, pane 이 JSON.parse 로 되돌려 Text 에 넘긴다. 그래서 여기서 뺀다.
const laneTitle = (title) => (typeof title == 'string' ? stripControl(title) : title ?? null)

export const run = async ({ flags }) => {
  const project = loadProject()
  const { config } = project
  const runStatus = config.run.status
  const board = readBoard(project)
  const running = board.cards.filter((card) => card.status == runStatus)
  const sessions = running.length > 0 ? listSessions({ all: true }) : []
  const verdicts = new Map(running.map((card) => [card.id, cardSession(card, sessions).verdict]))
  const cardView = ({ id, status }) => (verdicts.has(id) ? { id, status, session: verdicts.get(id) } : { id, status })
  const result = {
    root: project.root,
    interval_seconds: config.monitor.interval_seconds,
    run_status: runStatus,
    // index: config.json 의 columns 안의 차례. pane 이 이 값으로 색을 고르므로 milestone 만 받는 열을 빼도 색이 바뀌지 않는다.
    columns: config.columns.flatMap((column, index) => (column.types.some((type) => type != COLLECTION_TYPE)
      ? [{ status: column.status, dir: column.dir, index, count: board.cards.filter((card) => card.status == column.status && isWork(card)).length }]
      : [])),
    lanes: boardLanes(project, board).map(({ milestone, cards, finished, total }) => ({
      key: milestone ? `k${milestone.id}` : 'none',
      id: milestone?.id ?? null,
      title: laneTitle(milestone?.data.title),
      status: milestone?.status ?? null,
      is_running: milestone?.status == milestoneStatuses(config).running,
      finished,
      total,
      cards: cards.map(cardView),
    })),
  }
  if (flags.json == true) {
    console.log(JSON.stringify(result))
    return 0
  }
  result.columns.forEach((column) => {
    const counts = column.status == runStatus ? Object.entries(Object.groupBy(running, (card) => verdicts.get(card.id))).map(([verdict, cards]) => `${verdict} ${cards.length}`) : []
    console.log(t('board.column', { dir: column.dir, count: column.count, verdicts: counts }))
  })
  result.lanes.forEach((lane) => console.log(t('board.lane', lane)))
  return 0
}
