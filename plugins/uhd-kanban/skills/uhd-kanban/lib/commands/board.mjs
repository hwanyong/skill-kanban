// 열마다 카드 수와 순서, run.status 열 카드의 세션 상태를 낸다. 보드 모니터 mod 가 monitor.interval_seconds 마다 --json 으로 부른다.
// 1분마다 도는 명령이라 카드 1,189개(poieve, 2026-10-29)를 다 읽는 readBoard 를 쓰지 않는다. 열 디렉터리의 파일 이름만 읽고, 카드 파일은 run.status 열의 것만 연다.
// 규칙 검사는 하지 않는다. 위반은 uhd-kanban check 가 알린다.
// uhd-kanban board [--json]

import { join } from 'node:path'
import { readCard, readColumnNames } from '../board.mjs'
import { loadProject } from '../project.mjs'
import { cardSession, listSessions } from '../sessions.mjs'

const sessionOf = (project, column, card, sessions) => {
  const path = join(project.boardPath, column.dir, card.name)
  const read = readCard(path, `kanban/${column.dir}/${card.name.normalize('NFC')}`, card.name, column, project.profiles, [])
  return read ? cardSession(read, sessions).verdict : 'none'
}

export const run = async ({ flags }) => {
  const project = loadProject()
  const runStatus = project.config.run.status
  const columns = readColumnNames(project)
  const sessions = columns.some(({ column, cards }) => column.status == runStatus && cards.length > 0) ? listSessions({ all: true }) : []
  const result = {
    root: project.root,
    interval_seconds: project.config.monitor.interval_seconds,
    cell_height: project.config.monitor.cell_height,
    run_status: runStatus,
    columns: columns.map(({ column, cards }) => ({
      status: column.status,
      dir: column.dir,
      count: cards.length,
      cards: cards.map((card) => (column.status == runStatus ? { id: card.id, session: sessionOf(project, column, card, sessions) } : { id: card.id })),
    })),
  }
  if (flags.json == true) {
    console.log(JSON.stringify(result))
    return 0
  }
  result.columns.forEach((column) => {
    const verdicts = column.status == runStatus ? Object.entries(Object.groupBy(column.cards, (card) => card.session)).map(([verdict, cards]) => `${verdict} ${cards.length}`) : []
    console.log(`${column.dir} ${column.count}개${verdicts.length > 0 ? ` (세션: ${verdicts.join(' · ')})` : ''}`)
  })
  return 0
}
