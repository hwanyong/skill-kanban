// 보드 모니터 pane 의 그래프에 쓸 값을 카드 파일에서 센다. board 명령이 --json 에 metrics 로 낸다.
// 끝난 카드는 completed_at 이 있는 작업 카드다. completed_at 은 archive.columns 의 열(기본 보드는 done)에 들어갈 때만 적히므로(cards.mjs 의 moveCard),
// decided · implemented · cancelled 로 끝난 카드는 세지 않는다(2026-11-04 사용자 결정 「done 만」).
// 날짜는 이 Mac 의 시간대로 나눈다. 아카이브 파일 이름의 날짜(filename.mjs 의 localDate)와 같은 규칙이다.

import { parseComments } from './comments.mjs'
import { localDate } from './filename.mjs'
import { isWork } from './lanes.mjs'

// days 의 길이. pane 은 폭에 들어가는 만큼 최근 날짜부터 그린다.
export const DAYS = 30
// hours 의 길이. 1시간 한 칸이다.
export const HOURS = 24
// milestone 의 처리 속도와 7일 합계를 세는 기간(일).
export const WINDOW_DAYS = 7
// 카드 세션이 일을 하고 있다는 코멘트 kind. assign · question 처럼 메인 세션이나 사용자가 남기는 kind 는 세지 않는다.
const ACTIVITY_KINDS = ['progress', 'result', 'done-evidence']

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const timeOf = (text) => {
  const ms = Date.parse(text ?? '')
  return Number.isNaN(ms) ? null : ms
}

// 오늘을 끝으로 하는 count 개의 날짜. setDate 로 세어 일광 절약 시간이 바뀌는 날에도 날짜가 빠지거나 겹치지 않는다.
const recentDates = (nowMs, count) => Array.from({ length: count }, (_, index) => {
  const date = new Date(nowMs)
  date.setDate(date.getDate() - (count - 1 - index))
  return localDate(date)
})

const countByDate = (times) => times.reduce((counts, ms) => {
  const date = localDate(new Date(ms))
  return counts.set(date, (counts.get(date) ?? 0) + 1)
}, new Map())

const activityTimes = (card) => parseComments(card.body).comments.filter((comment) => ACTIVITY_KINDS.includes(comment.kind)).map((comment) => timeOf(comment.at)).filter((ms) => ms != null)

const latest = (times) => (times.length == 0 ? null : new Date(Math.max(...times)).toISOString())

// 기간 안에 끝난 카드 수. members 는 lanes.mjs 의 boardLanes 가 낸 소속 작업 카드(아카이브 포함)다.
export const recentFinished = (members, nowMs) => members.filter((card) => {
  const ms = timeOf(card.data.completed_at)
  return ms != null && nowMs - ms < WINDOW_DAYS * DAY_MS
}).length

// 반환: { window_days, days: [{ date, finished, created }], hours: number[], last_activity_at, running: [{ id, last_activity_at }] }.
// days · hours 는 오래된 것부터다. hours 의 마지막 칸은 지금부터 1시간 전까지다.
// running 은 run.status 열의 작업 카드이고, last_activity_at 은 ACTIVITY_KINDS 코멘트와 session_started_at 중 늦은 시각이다.
export const boardMetrics = (project, { cards, archived }, nowMs = Date.now()) => {
  const work = [...cards, ...archived].filter(isWork)
  const finished = countByDate(work.map((card) => timeOf(card.data.completed_at)).filter((ms) => ms != null))
  const created = countByDate(work.map((card) => timeOf(card.data.created_at)).filter((ms) => ms != null))
  const activity = cards.filter(isWork).flatMap(activityTimes)
  const hours = Array.from({ length: HOURS }, () => 0)
  activity.forEach((ms) => {
    const age = Math.floor((nowMs - ms) / HOUR_MS)
    if (age >= 0 && age < HOURS) hours[HOURS - 1 - age] += 1
  })
  const runStatus = project.config.run.status
  return {
    window_days: WINDOW_DAYS,
    days: recentDates(nowMs, DAYS).map((date) => ({ date, finished: finished.get(date) ?? 0, created: created.get(date) ?? 0 })),
    hours,
    last_activity_at: latest(activity),
    running: cards.filter((card) => card.status == runStatus && isWork(card)).map((card) => ({
      id: card.id,
      last_activity_at: latest([...activityTimes(card), timeOf(card.data.session_started_at)].filter((ms) => ms != null)),
    })),
  }
}
