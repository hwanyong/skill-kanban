// archive.columns 열의 카드 중 completed_at 에서 archive.after_days 일이 지난 카드를 `kanban/<archive.dir>/<YYYY-MM>/` 로 옮긴다.
// 파일 이름의 순서 번호는 completed_at 의 날짜(이 Mac 의 시간대)로 바뀐다.
// uhd-kanban archive [--dry-run]

import { join } from 'node:path'
import { moveFile } from '../cards.mjs'
import { editBoard } from '../edit.mjs'
import { archivedName, localDate } from '../filename.mjs'
import { t } from '../i18n.mjs'

const DAY_MS = 24 * 60 * 60 * 1000

export const run = async ({ flags }) => {
  const dryRun = flags['dry-run'] == true
  return editBoard(async ({ project, board }) => {
    const { columns, after_days: afterDays, dir } = project.config.archive
    const targets = board.cards.filter((card) => columns.includes(card.status))
    const missing = targets.filter((card) => Number.isNaN(Date.parse(card.data.completed_at ?? '')))
    const due = targets.filter((card) => !missing.includes(card) && Date.now() - Date.parse(card.data.completed_at) >= afterDays * DAY_MS)
    for (const card of due) {
      const date = localDate(new Date(card.data.completed_at))
      const target = join(project.boardPath, dir, date.slice(0, 7), archivedName({ date, id: card.id, title: card.data.title }))
      if (!dryRun) moveFile(project, card.path, target)
      console.log(`${dryRun ? '(dry-run) ' : ''}k${card.id} → ${target.slice(project.root.length + 1)}`)
    }
    console.log(t(dryRun ? 'archive.summaryDry' : 'archive.summary', { count: due.length, days: afterDays, columns }))
    if (missing.length == 0) return 0
    console.error(t('archive.missing', { paths: missing.map((card) => card.relPath) }))
    return 1
  })
}
