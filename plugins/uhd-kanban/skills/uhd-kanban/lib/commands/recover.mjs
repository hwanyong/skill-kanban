// run.status 열의 카드마다 세션 상태를 보고, 멈춘 세션을 `claude --bg --resume <session>` 으로 이어 간다. 판정은 sessions.mjs 의 cardSession 이다.
// id 로 준 카드가 다른 열(검토에서 돌아온 in-review 카드 등)에 있으면 이어 갈 때 run 과 같이 run.status 열로 옮긴다. 그래야 run.max_parallel 이 그 세션을 센다.
// 2026-10-29 실측: `--bg --resume` 은 이전 대화를 이어받은 새 session id 로 떴다. 그래서 카드의 session 을 새 id 로 고쳐 적는다.
// 체크포인트는 카드의 [progress] 코멘트다. 이어 간 세션에 그 코멘트를 읽으라고 프롬프트로 준다.
// uhd-kanban recover [<k id>…] [--dry-run] [--force]   id 를 주지 않으면 run.status 열의 카드 전부.
// --force 는 끝난(state done) 세션도 이어 간다. 세션이 끝났는데 카드에 작업이 남은 때다. 이어 감 판정과 같이 run.max_parallel 에 센다.
// 재부팅으로 pid 없이 state failed 가 된 세션은 --force 없이 이어 간다(sessions.mjs 의 classify).

import { relative } from 'node:path'
import { cardId } from '../args.mjs'
import { assignCard, launchCard } from '../assign.mjs'
import { checkMove, findCard } from '../cards.mjs'
import { readBoard } from '../board.mjs'
import { USER } from '../comments.mjs'
import { editBoard } from '../edit.mjs'
import { startedNote, t, translator } from '../i18n.mjs'
import { reportName } from '../main.mjs'
import { runSpec } from '../profiles.mjs'
import { ProjectError } from '../errors.mjs'
import { maxParallel } from '../project.mjs'
import { resumePrompt } from '../prompt.mjs'
import { backgroundCommand, cardSession, hasRoom, runningCards, listSessions, sessionName, startedAt, stopSession, transcriptsDir, envArgs } from '../sessions.mjs'

// 이어 가지 않는 판정. 메시지는 recover.<판정> 키에 있다.
const SKIPPED = ['live', 'pending', 'done', 'unknown']

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

// card 의 실행 인자(profiles.mjs 의 runSpec). 프로필이 틀린 카드는 그 카드 하나의 실패로 보고 다음 카드로 넘어가려고 오류 문구를 돌려준다.
const specOf = (card, profiles) => {
  try {
    return { spec: runSpec(card, profiles) }
  } catch (error) {
    if (!(error instanceof ProjectError)) throw error
    return { problem: error.message }
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
    const from = reportName(project, sessions) ?? USER
    const counts = { live: 0, pending: 0, done: 0, unknown: 0, resumed: 0, waiting: 0, failed: 0 }
    // run.status 열에서 멈춘(restart) 세션은 이미 센 것을 바꿔 띄우므로 수가 늘지 않는다. 그 밖의 이어 가는 세션은 하나씩 늘린다.
    let running = runningCards(project, board, sessions).length
    for (const id of targets) {
      // 앞 카드를 옮기면서 열을 다시 매겼으면 이 카드의 경로도 바뀌었으므로 차례마다 보드를 다시 읽는다.
      const current = readBoard(project)
      const card = findCard(current, id)
      const sessionId = card.data.session
      const found = cardSession(card, sessions)
      const { session, transcript } = found
      // 세션이 일하던 디렉터리(worktree)에서 이어 간다. root 에서 이어 가면 대화가 root 로 복사되고 세션이 root 에서 파일을 고친다(sessions.mjs 의 lastTurn).
      const cwd = found.cwd ?? project.root
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
        console.log(t('recover.noTranscript', { id: card.id, sessionId, base: transcriptsDir() }))
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
      const { spec, problem } = specOf(card, project.profiles)
      if (problem) {
        counts.failed += 1
        console.log(t('recover.cannotRun', { id: card.id, problem }))
        continue
      }
      if (!counted) running += 1
      const args = ['--resume', sessionId, '-n', sessionName(card.id), ...spec.cliArgs, ...envArgs(project.config)]
      const tr = translator(project.locale)
      const why = verdict == 'restart' ? tr('recover.whyRestart', { startedAt: startedAt(session), toolPending: found.toolPending }) : session ? `state ${session.state}${found.verdict == 'done' ? ', --force' : ''}` : tr('recover.whyMissing')
      counts.resumed += 1
      if (dryRun) {
        console.log(`(dry-run) k${card.id} ${why} → ${cwd == project.root ? '' : `cd ${relative(project.root, cwd)}; `}${verdict == 'restart' ? `claude stop ${session.id}; ` : ''}${backgroundCommand(args)}${card.status == status ? '' : ` · ${card.status} → ${status}`}`)
        continue
      }
      if (verdict == 'restart') stopSession(session.id)
      const { shortId, session: resumed } = await launchCard(project, sessions, args, resumePrompt(project, card, { skillRoot }), cwd)
      const text = tr('recover.assigned', { why, sessionId, resumed: resumed?.sessionId ?? `${shortId}(${tr('recover.notFound')})` })
      const moved = assignCard(project, current, card, status, { from, text, session: resumed })
      console.log(`k${card.id} ${t('recover.resumed', { why })}: ${shortId} ${resumed?.sessionId ?? ''}${moved ? ` ${card.status} → ${status}: ${relative(project.root, moved.path)}${startedNote(moved.started)}` : ''}`)
    }
    console.log(t(dryRun ? 'recover.summaryDry' : 'recover.summary', { total: targets.length, ...counts }))
    return counts.failed + counts.waiting + counts.unknown > 0 ? 1 : 0
  })
}
