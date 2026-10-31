// run.status 열의 카드마다 세션 상태를 보고, 멈춘 세션을 `claude --bg --resume <session>` 으로 이어 간다. 판정은 sessions.mjs 의 cardSession 이다.
// id 로 준 카드가 다른 열(검토에서 돌아온 in-review 카드 등)에 있으면 이어 갈 때 run 과 같이 run.status 열로 옮긴다. 그래야 run.max_parallel 이 그 세션을 센다.
// 2026-10-29 실측: `--bg --resume` 은 이전 대화를 이어받은 새 session id 로 떴다. 그래서 카드의 session 을 새 id 로 고쳐 적는다.
// 체크포인트는 카드의 [progress] 코멘트다. 이어 간 세션에 그 코멘트를 읽으라고 프롬프트로 준다.
// uhd-kanban recover [<k id>…] [--dry-run] [--force]   id 를 주지 않으면 run.status 열의 카드 전부.
// --force 는 끝난(state done) 세션도 이어 간다. 세션이 끝났는데 카드에 작업이 남은 때다. 이어 감 판정과 같이 run.max_parallel 에 센다.

import { cardId } from '../args.mjs'
import { checkMove, findCard, moveCard, now, writeCard } from '../cards.mjs'
import { readBoard } from '../board.mjs'
import { USER, appendComment } from '../comments.mjs'
import { editBoard } from '../edit.mjs'
import { startedNote, t, translator } from '../i18n.mjs'
import { runSpec } from '../profiles.mjs'
import { ProjectError, maxParallel } from '../project.mjs'
import { resumePrompt, sessionName } from '../prompt.mjs'
import { BACKGROUND_ARGS, cardSession, hasRoom, runningCards, currentSessionName, findSession, launchBackground, listSessions, startedAt, stopSession } from '../sessions.mjs'

// 이어 가지 않는 판정. 메시지는 recover.<판정> 키에 있다.
const SKIPPED = ['live', 'pending', 'done']

// card 를 status 열로 옮길 수 없으면 그 이유. 세션을 띄우기 전에 보고, 옮길 수 없는 카드는 띄우지 않는다.
const movable = (project, board, card, status) => {
  try {
    checkMove(project, board, card, status)
    return null
  } catch (error) {
    if (!(error instanceof ProjectError)) throw error
    return error.message
  }
}

export const run = async ({ positional, flags }, { skillRoot }) => {
  const ids = positional.map((ref) => cardId(ref))
  const dryRun = flags['dry-run'] == true
  const force = flags.force == true
  return editBoard(async ({ project, board }) => {
    const status = project.config.run.status
    const targets = ids.length > 0 ? ids.map((id) => findCard(board, id).id) : board.cards.filter((card) => card.status == status).map((card) => card.id)
    const sessions = listSessions({ all: true })
    const from = currentSessionName(sessions) ?? USER
    const counts = { live: 0, pending: 0, done: 0, resumed: 0, waiting: 0, failed: 0 }
    // run.status 열에서 멈춘(restart) 세션은 이미 센 것을 바꿔 띄우므로 수가 늘지 않는다. 그 밖의 이어 가는 세션은 하나씩 늘린다.
    let running = runningCards(project, board, sessions).length
    for (const id of targets) {
      // 앞 카드를 옮기면서 열을 다시 매겼으면 이 카드의 경로도 바뀌었으므로 차례마다 보드를 다시 읽는다.
      const current = readBoard(project)
      const card = findCard(current, id)
      const sessionId = card.data.session
      const found = cardSession(card, sessions)
      const { session, transcript } = found
      const verdict = force && found.verdict == 'done' ? 'resume' : found.verdict
      if (verdict == 'none') {
        counts.failed += 1
        console.log(t('recover.noSession', { id: card.id }))
        continue
      }
      if (SKIPPED.includes(verdict)) {
        counts[verdict] += 1
        console.log(`k${card.id} ${t(`recover.${verdict}`)}: ${sessionId} state=${session.state ?? '-'} status=${session.status ?? '-'} pid=${session.pid ?? '-'}`)
        continue
      }
      if (!transcript) {
        counts.failed += 1
        console.log(t('recover.noTranscript', { id: card.id, sessionId }))
        continue
      }
      const counted = verdict == 'restart' && card.status == status
      if (!counted && !hasRoom(project, running)) {
        counts.waiting += 1
        console.log(t('recover.waiting', { id: card.id, max: maxParallel(project.config) }))
        continue
      }
      const moveProblem = card.status == status ? null : movable(project, current, card, status)
      if (moveProblem) {
        counts.failed += 1
        console.log(t('recover.cannotMove', { id: card.id, status, problem: moveProblem }))
        continue
      }
      if (!counted) running += 1
      const spec = runSpec(card, project.profiles)
      const args = ['--resume', sessionId, '-n', sessionName(card.id), ...spec.cliArgs]
      const tr = translator(project.locale)
      const why = verdict == 'restart' ? tr('recover.whyRestart', { startedAt: startedAt(session) }) : session ? `state ${session.state}${found.verdict == 'done' ? ', --force' : ''}` : tr('recover.whyMissing')
      counts.resumed += 1
      if (dryRun) {
        console.log(`(dry-run) k${card.id} ${why} → ${verdict == 'restart' ? `claude stop ${session.id}; ` : ''}claude ${[...BACKGROUND_ARGS, ...args].join(' ')} <${t('run.prompt')}>${card.status == status ? '' : ` · ${card.status} → ${status}`}`)
        continue
      }
      if (verdict == 'restart') stopSession(session.id)
      const shortId = launchBackground(args, resumePrompt(project, card, { skillRoot }), project.root)
      const resumed = findSession(listSessions({ all: true }), shortId)
      const changes = resumed ? { session: resumed.sessionId, session_started_at: startedAt(resumed) } : {}
      const text = tr('recover.assigned', { why, sessionId, resumed: resumed?.sessionId ?? `${shortId}(${tr('recover.notFound')})` })
      const { body } = appendComment(card.body, { kind: 'assign', from, to: [sessionName(card.id)], at: now(), text })
      const moved = card.status == status ? null : moveCard(project, current, { ...card, body }, status, { changes })
      if (!moved) writeCard(card.path, { ...card.data, ...changes, updated_at: now() }, body)
      console.log(`k${card.id} ${t('recover.resumed', { why })}: ${shortId} ${resumed?.sessionId ?? ''}${moved ? ` ${card.status} → ${status}: ${moved.path.slice(project.root.length + 1)}${startedNote(moved.started)}` : ''}`)
    }
    console.log(t(dryRun ? 'recover.summaryDry' : 'recover.summary', { total: targets.length, ...counts }))
    return counts.failed + counts.waiting > 0 ? 1 : 0
  })
}
