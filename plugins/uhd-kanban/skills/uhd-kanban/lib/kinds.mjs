// 코멘트 kind 는 카드 파일의 머리 줄 `### c<n> [<kind>]` 에 기록하는 영어 id 다. 보드의 locale 과 무관하게 같은 값을 쓴다.
// 사람에게 보일 때의 이름은 messages/<locale>.mjs 의 `kind.<id>` 가 갖는다(i18n.mjs 의 kindText).

export const KIND_ID = /^[a-z][a-z0-9-]*$/

// run · recover 가 카드에 쓰거나 세션에 쓰라고 하는 kind. comments.kinds 에 있어야 한다.
export const RUN_KINDS = ['assign', 'progress', 'question', 'result']

// 0.4.0 까지는 한국어 낱말을 kind 로 기록했다. migrate 가 이 표로 카드 파일과 config.json 을 바꿔 쓴다.
// 이미 기록된 값의 표라 고치지 않는다. 표시 이름을 바꾸려면 messages/ko.mjs 를 고친다.
// 가져옴 은 tools/import-nimbalyst.mjs 가 kind 를 정하지 못한 코멘트에 썼다.
export const LEGACY_KINDS = {
  '질문': 'question',
  '답': 'answer',
  '결정': 'decision',
  '결과': 'result',
  '진행': 'progress',
  '보고': 'report',
  '정정': 'correction',
  '배정': 'assign',
  '넘김': 'handoff',
  '멈춤': 'pause',
  'done 근거': 'done-evidence',
  '사용자 답': 'user-answer',
  '사용자 결정': 'user-decision',
  '가져옴': 'imported',
}

// 명령이 받은 kind 를 id 로 바꾼다. 0.4.0 의 프롬프트를 받은 채 돌고 있는 카드 세션이 `--kind 진행` 처럼 한국어로 쓰므로 LEGACY_KINDS 의 낱말을 받는다.
export const kindId = (kind) => (Object.hasOwn(LEGACY_KINDS, kind) ? LEGACY_KINDS[kind] : kind)
