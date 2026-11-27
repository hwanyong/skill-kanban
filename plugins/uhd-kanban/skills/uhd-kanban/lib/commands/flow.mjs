// 세션 흐름 view(보드 모니터 mod 의 두 번째 pane)에 그릴 값을 낸다: milestone 묶음, 묶음의 카드와 depends_on, 카드 세션, 세션 사이의 메시지.
// 묶음과 차례는 board 명령의 swimlane 과 같은 boardLanes 가 정한다. 묶음의 카드는 아카이브한 소속 카드까지 든다.
// 세션 판정은 run.status 열 카드에만 붙인다(board 명령과 같다). 나머지 카드는 대화 기록 경로만 낸다.
// 메시지는 카드 코멘트(머리 줄의 from= · to=)와 message-log(lib/message-log.mjs)를 시각 차례로 합친 최근 MESSAGES 개다.
// 그리기는 mod 가 하고 이 명령은 값만 낸다. board 명령과 같이 lock 안에서 읽는다.
// uhd-kanban flow [--json]   --json 이 없으면 묶음마다 board 명령과 같은 한 줄을 낸다.

import { stripControl, stripOutputControl } from '../control.mjs'
import { parseComments } from '../comments.mjs'
import { dependentsOf } from '../cards.mjs'
import { viewBoard } from '../edit.mjs'
import { t } from '../i18n.mjs'
import { boardLanes, isWork } from '../lanes.mjs'
import { readMain } from '../main.mjs'
import { readMessages } from '../message-log.mjs'
import { lastActivityAt } from '../metrics.mjs'
import { COLLECTION_TYPE, loadProject, maxParallel, milestoneStatuses } from '../project.mjs'
import { RUNNING_VERDICTS, cardSession, listSessions, sessionName, transcriptPath } from '../sessions.mjs'
import { timeOf } from '../time.mjs'
import { SWITCH } from '../args.mjs'

const MESSAGES = 200
// pane 은 메시지를 한두 줄 미리보기로, result · progress 를 노드 상세에 그린다. 전문은 카드 파일과 대화 기록(transcript)에 있다.
// 2026-11-20 plugin-pane-grid 보드(카드 38장)에서 자르지 않은 출력이 1,053,790 바이트였고, 메시지 본문이 410,266자 · result · progress 가 312,544자였다.
const MESSAGE_CHARS = 200
const CARD_TEXT_CHARS = 1000

// 카드 파일 · message-log 에서 읽은 문자열은 pane 이 그대로 그리므로 제어 문자를 뺀다. 코멘트 머리 줄의 정규식(\S+)도 ESC 를 받는다.
// 제목 · 이름 · 시각 · 경로는 한 줄로 그리므로 개행까지 빼고, 코멘트 · 메시지 본문은 개행과 탭을 남긴다.
const text = (value) => (typeof value == 'string' ? stripControl(value) : null)
const body = (value, max) => {
  if (typeof value != 'string') return null
  const clean = stripOutputControl(value)
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

// SendMessage 의 to 는 `이름 [짧은 id]` 로 올 수 있다(2026-11-20 실측 `probe-b [ac1db1]`). 이름만 남긴다.
// 받은 메시지에 답하면 to 가 보낸 세션의 소켓 주소 `uds:/tmp/cc-socks/<pid>.sock` 이다(2026-11-20 실측). 그 pid 의 세션이 지금 있으면 그 이름으로 바꾼다.
const SOCKET_ADDRESS = /^uds:.*\/(\d+)\.sock$/
const recipient = (to, pidNames) => {
  const pid = to.match(SOCKET_ADDRESS)?.[1]
  return (pid == null ? null : pidNames.get(Number(pid))) ?? to.replace(/ \[[^\]]+\]$/, '')
}

const lastText = (comments, kind) => body(comments.findLast((comment) => comment.kind == kind)?.text ?? null, CARD_TEXT_CHARS)

const earliest = (values) => {
  const times = values.map(timeOf).filter((ms) => ms != null)
  return times.length == 0 ? null : new Date(Math.min(...times)).toISOString()
}

// 받는 플래그와 위치 인자 수(lib/args.mjs 의 parseArgs).
export const ARGS = { flags: { json: SWITCH }, positional: 0 }

export const run = async ({ flags }) => {
  const project = loadProject()
  const { config } = project
  const board = await viewBoard(project)
  const runStatus = config.run.status
  const lanes = boardLanes(project, board)
  const members = [...new Map(lanes.flatMap((lane) => lane.members).map((card) => [card.id, card])).values()]
  const logs = readMessages(project)
  const running = members.filter((card) => card.status == runStatus)
  const sessions = running.length > 0 || logs.length > 0 ? listSessions({ all: true }) : []
  const verdicts = new Map(running.map((card) => [card.id, cardSession(card, sessions)]))
  const main = readMain(project)
  // session id → 메시지에 적을 이름. 카드 세션은 그 카드의 k<id>, 메인 세션은 main.json 의 이름, 나머지는 claude agents --json 의 name 이다.
  const names = new Map([
    ...sessions.filter((session) => session.name).map((session) => [session.sessionId, text(session.name)]),
    ...(main?.session ? [[main.session, text(main.name)]] : []),
    ...members.filter((card) => card.data.session).map((card) => [card.data.session, sessionName(card.id)]),
  ])
  const pidNames = new Map(sessions.filter((session) => session.pid != null && names.has(session.sessionId)).map((session) => [session.pid, names.get(session.sessionId)]))
  const columnIndex = new Map(config.columns.map((column, index) => [column.status, index]))
  const commented = members.map((card) => ({ card, comments: parseComments(card.body).comments }))
  const cards = commented.map(({ card, comments }) => {
    const verdict = verdicts.get(card.id)
    return {
      id: card.id,
      title: text(card.data.title),
      status: text(card.status),
      column_index: columnIndex.get(card.status) ?? null,
      // 배치는 카드 id(정수)로 잇는다. 정수가 아닌 항목은 uk check 가 위반으로 알리고 여기서는 뺀다.
      depends_on: Array.isArray(card.data.depends_on) ? card.data.depends_on.filter(Number.isInteger) : [],
      dependents: dependentsOf(board, card.id).filter(isWork).map((dependent) => dependent.id),
      verdict: verdict?.verdict ?? null,
      session: text(card.data.session),
      started_at: text(card.data.session_started_at),
      completed_at: text(card.data.completed_at),
      last_activity_at: lastActivityAt(card),
      commits: Array.isArray(card.data.commits) ? card.data.commits.length : 0,
      progress: lastText(comments, 'progress'),
      result: lastText(comments, 'result'),
      transcript: text(verdict ? verdict.transcript : card.data.session ? transcriptPath(card.data.session) : null),
      // 카드 파일의 절대 경로. 노드 상세의 열기 · 위치 보기 Button 이 운영체제 명령에 넘긴다. 아카이브한 카드는 archive.dir 아래 경로다.
      path: text(card.path),
    }
  })
  const fromComments = commented.flatMap(({ card, comments }) => comments.map((comment) => ({ at: text(comment.at), from: text(comment.from), to: text(comment.to.join(',')), kind: text(comment.kind), card: card.id, text: body(comment.text, MESSAGE_CHARS) })))
  const fromLogs = logs.map((entry) => ({ at: text(entry.at), from: text(names.get(entry.from_session) ?? entry.from_session), to: text(recipient(typeof entry.to == 'string' ? entry.to : '', pidNames)), kind: null, card: null, text: body(entry.text, MESSAGE_CHARS) }))
  const messages = [...fromComments, ...fromLogs].filter((message) => timeOf(message.at) != null).toSorted((a, b) => timeOf(a.at) - timeOf(b.at)).slice(-MESSAGES)
  const { running: runningMilestone } = milestoneStatuses(config)
  const result = {
    root: project.root,
    interval_seconds: config.monitor.interval_seconds,
    run_status: runStatus,
    max_parallel: maxParallel(config),
    main: text(main?.name ?? null),
    working: [...verdicts.values()].filter((verdict) => RUNNING_VERDICTS.includes(verdict.verdict)).length,
    columns: config.columns.flatMap((column, index) => (column.types.some((type) => type != COLLECTION_TYPE) ? [{ status: column.status, index }] : [])),
    groups: lanes.map(({ milestone, members: inGroup, finished, total }) => ({
      key: milestone ? `k${milestone.id}` : 'none',
      id: milestone?.id ?? null,
      title: text(milestone?.data.title ?? null),
      status: text(milestone?.status ?? null),
      is_running: milestone != null && milestone.status == runningMilestone,
      finished,
      total,
      started_at: earliest(inGroup.map((card) => card.data.session_started_at).filter((value) => value != null)),
      cards: inGroup.map((card) => card.id),
    })),
    cards,
    messages,
  }
  if (flags.json == true) {
    console.log(JSON.stringify(result))
    return 0
  }
  result.groups.forEach((group) => console.log(t('board.lane', group)))
  return 0
}
