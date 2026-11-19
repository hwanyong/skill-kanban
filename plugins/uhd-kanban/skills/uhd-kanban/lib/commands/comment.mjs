// 카드에 코멘트를 덧붙이고, 받는 세션마다 SendMessage 로 보낼 줄을 stdout 에 낸다.
// 받는 이름 main 은 등록된 메인 세션(lib/main.mjs)이다. 코멘트에는 main 을 적고 SendMessage 줄에만 실제 이름을 적는다.
// progress · question · result 는 --to 에 메인 세션이 없어도 메인 세션이 받는다(lib/main.mjs 의 recipientsOf).
// 이 명령은 메시지를 보내지 않는다. Claude Code 에 메시지를 보내는 CLI 명령이 없다(2.1.312 · 2.1.328 의 claude --help).
// 카드 세션이 부르면 같은 메시지를 outbox(lib/outbox.mjs)에도 적고, 보드 모니터 mod 의 tool.call 훅이 그 Bash 호출이 끝난 자리에서 꺼내 $.session.send 로 보낸다.
// 다른 세션이 부르면 그 줄을 읽은 AI 가 SendMessage 도구를 부른다.
// 훅은 Bash 결과에 `SendMessage to=` 로 시작하는 줄이 있을 때만 outbox 를 꺼낸다. 이 줄의 앞머리를 바꾸면 hooks/register.tsx 의 SEND_LINE 도 바꾼다.
// uhd-kanban comment <k id> --kind <kind> --to <이름>[,<이름>] [--from <이름>] (--text <글> | --text-file <경로>)

import { relative } from 'node:path'
import { t } from '../i18n.mjs'
import { callerSessionId } from '../agents.mjs'
import { UsageError, cardId, listFrom, readFlagFile, stringFlag } from '../args.mjs'
import { findCard, updateCard } from '../cards.mjs'
import { now } from '../time.mjs'
import { USER, appendComment, isName, textProblems } from '../comments.mjs'
import { editBoard } from '../edit.mjs'
import { recipientsOf, resolveName, roleName } from '../main.mjs'
import { ProjectError } from '../errors.mjs'
import { appendOutbox, isSessionId } from '../outbox.mjs'
import { assertKind, loadProject } from '../project.mjs'
import { currentSessionName, isCardSessionName, listSessions } from '../sessions.mjs'

const readText = (flags) => {
  const given = ['text', 'text-file'].filter((key) => stringFlag(flags, key) != null)
  if (given.length != 1) throw new UsageError(t('comment.textOrFile'))
  return given[0] == 'text' ? flags.text : readFlagFile(flags, 'text-file')
}

// 세션 목록을 못 읽어도 코멘트는 쓴다. 받는 이름을 대조하지 못했다는 것만 알린다.
const trySessions = () => {
  try {
    return listSessions()
  } catch (error) {
    console.error(t('comment.agentsFailed', { message: error.message.split('\n')[0] }))
    return null
  }
}

// outbox 에 적을 세션 id. 이 명령을 부른 세션이 카드 세션일 때만 있고, 아니면 null 이다. 세션 목록을 못 읽었으면 카드 세션인지 몰라 null 이다.
const cardSessionId = (sessions) => {
  const id = callerSessionId()
  return sessions != null && isSessionId(id) && isCardSessionName(currentSessionName(sessions)) ? id : null
}

export const run = async ({ positional, flags }) => {
  if (positional[0] == null) throw new UsageError(t('comment.usage'))
  const id = cardId(positional[0])
  if (stringFlag(flags, 'kind') == null) throw new UsageError(t('args.required', { flag: '--kind' }))
  const given = listFrom(flags.to)
  if (given.length == 0) throw new UsageError(t('args.required', { flag: '--to' }))
  const text = readText(flags).replace(/\s+$/, '')
  const sessions = trySessions()
  const from = stringFlag(flags, 'from') ?? (sessions && roleName(loadProject(), currentSessionName(sessions)))
  if (from == null) throw new UsageError(t('comment.noFrom'))
  const badNames = [from, ...given].filter((name) => !isName(name))
  if (badNames.length > 0) throw new UsageError(t('comment.badNames', { names: badNames }))
  const problems = textProblems(text)
  if (problems.length > 0) throw new ProjectError(t('comment.badText', { problems }))
  return editBoard(async ({ project, board }) => {
    const kind = assertKind(project, flags.kind)
    const to = recipientsOf(project, { kind, from, to: given })
    const card = findCard(board, id)
    const { body, n } = appendComment(card.body, { kind, from, to, at: now(), text })
    updateCard(card, {}, body)
    console.log(`k${id} c${n} ${relative(project.root, card.path)}`)
    const known = new Set((sessions ?? []).map((session) => session.name))
    const summary = `k${id} c${n} [${kind}] ${text.split('\n')[0]}`
    const messages = to.filter((name) => name != USER).map((name) => {
      const target = resolveName(project, name)
      const note = target == null ? ` # ${t('comment.noteNoMain')}` : sessions == null ? ` # ${t('comment.noteNoSessions')}` : known.has(target) ? '' : ` # ${t('comment.noteUnknown')}`
      const line = `SendMessage to=${target ?? name} message=${JSON.stringify(summary)}${note}`
      console.log(line)
      return { to: target, text: summary, line }
    })
    const sessionId = cardSessionId(sessions)
    if (sessionId != null) appendOutbox(project, sessionId, messages.filter((message) => message.to != null))
    return 0
  })
}
