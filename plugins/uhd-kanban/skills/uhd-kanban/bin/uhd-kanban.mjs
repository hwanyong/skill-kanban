#!/usr/bin/env node
// uhd-kanban 명령의 진입점. 하위 명령을 lib/commands/*.mjs 에 넘긴다.
// 종료 코드: 0 성공 · 1 규칙 위반이나 실행 실패 · 2 사용법 오류 · 3 부른 디렉터리 위에 보드(.uhd-kanban/config.json)가 없다.

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { NoProjectError, ProjectError } from '../lib/project.mjs'
import { UsageError, parseArgs } from '../lib/args.mjs'
import { stripOutputControl } from '../lib/control.mjs'
import { t } from '../lib/i18n.mjs'

const COMMANDS = {
  init: 'init.mjs',
  check: 'check.mjs',
  new: 'new.mjs',
  move: 'move.mjs',
  order: 'order.mjs',
  renumber: 'renumber.mjs',
  set: 'set.mjs',
  archive: 'archive.mjs',
  comment: 'comment.mjs',
  inbox: 'inbox.mjs',
  run: 'run.mjs',
  recover: 'recover.mjs',
  board: 'board.mjs',
  guard: 'guard.mjs',
  migrate: 'migrate.mjs',
  locale: 'locale.mjs',
}

// 제목 · 코멘트 · 파일 이름은 다른 사람이 만든 카드 파일에서 온다. 명령마다 console 을 따로 부르므로 모든 출력이 지나는 write 에서 제어 문자를 뺀다.
const guardWrite = (stream) => {
  const write = stream.write.bind(stream)
  stream.write = (chunk, ...rest) => write(typeof chunk == 'string' ? stripOutputControl(chunk) : chunk, ...rest)
}
guardWrite(process.stdout)
guardWrite(process.stderr)

const USAGE = t('usage')

const [name, ...rest] = process.argv.slice(2)
const file = COMMANDS[name]
if (!file) {
  console.error(name ? `${t('bin.unknown', { name })}\n${USAGE}` : USAGE)
  process.exit(2)
}

const skillRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const { run } = await import(join(skillRoot, 'lib', 'commands', file))
try {
  process.exitCode = await run(parseArgs(rest), { skillRoot })
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`${error.message}\n${USAGE}`)
    process.exit(2)
  }
  if (!(error instanceof ProjectError)) throw error
  console.error(error.message)
  process.exit(error instanceof NoProjectError ? 3 : 1)
}
