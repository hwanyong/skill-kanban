---
name: delegate
description: 칸반 보드가 있는 프로젝트(루트에 `.uhd-kanban/`)의 메인 세션이 구현 · 수정 · 조사 · 리팩터링 · 버그 · 티켓 작업을 받으면 연다. 메인 세션은 그 작업을 직접 하지 않고 카드로 나눠 `uk run` 으로 맡긴 뒤 결과를 검토한다. "직접 하지 말고 카드로 나눠", "uk run 으로 맡겨", "티켓 처리해", "이거 고쳐", "구현해" 같은 요청이면 연다. 프롬프트에 「이 작업은 uhd-kanban 카드 k<id> 다」 또는 "This task is uhd-kanban card k<id>." 가 있는 세션(카드 세션)은 열지 않는다. English triggers: "split this into cards", "delegate with uk run", "don't do it yourself", "handle this ticket", "fix this", "implement this" in a project with `.uhd-kanban/`.
---

# delegate

보드가 있는 프로젝트의 메인 세션은 작업을 직접 하지 않는다. 작업을 카드로 나누고, 카드마다 `uk run` 으로 `claude --bg` 세션을 띄워 맡기고, 결과를 검토해 카드를 옮긴다. 메인 세션의 문맥에 구현 과정이 쌓이지 않고, 카드 세션은 카드 본문만 받아 시작하므로 문맥이 작다.

`uk` 는 `node <이 스킬의 base directory>/../uhd-kanban/bin/uhd-kanban.mjs` 를 줄여 적은 것이다. 명령 · 카드 형식 · 실행 규칙은 `../uhd-kanban/SKILL.md` 가 갖는다. 이 스킬은 메인 세션이 무엇을 하고 무엇을 하지 않는지만 갖는다.

## 이 스킬이 걸리는 세션

| 세션 | 판정 | 걸리는가 |
|---|---|---|
| 메인 세션 | 아래 두 가지가 아니다 | 걸린다 |
| 카드 세션 | 첫 프롬프트에 `이 작업은 uhd-kanban 카드 k<id> 다` 또는 `This task is uhd-kanban card k<id>.` 줄이 있다(`uk run` · `uk recover` 가 보드의 locale 로 붙인다) | 걸리지 않는다. 카드 작업을 직접 한다 |
| 사용자가 직접 하라고 한 작업 | 그 요청에 「직접 해」「카드 만들지 말고」가 있다 | 그 요청 하나에만 걸리지 않는다. 다음 요청부터 다시 걸린다. 아래 훅이 띄우는 확인 창에서 사용자가 허용한다 |

## 메인 세션이 하지 않는 것

1. **프로젝트 파일을 고치지 않는다.** `kanban/` · `.uhd-kanban/` 밖의 파일에 Edit · Write · NotebookEdit 를 쓰지 않고, Bash 로 파일을 쓰는 명령(`sed -i` · `>` · `git commit` · 패키지 설치 · 코드 생성기)을 실행하지 않는다.
2. **작업을 위한 빌드 · 실행 · 시험을 돌리지 않는다.** 그것은 카드 세션의 일이다.
3. **Agent 도구 · Workflow 로 작업을 맡기지 않는다.** 서브에이전트에 맡긴 작업은 보드에 남지 않아 `uk board` · `uk recover` · 코멘트로 추적할 수 없다.

도구를 부르기 전에 그 호출이 위 세 가지 중 하나인지 본다. 하나라도 맞으면 부르지 않고 카드를 만든다.

1 의 Edit · Write · NotebookEdit 는 도구가 막는다. 플러그인의 hooks 모듈(`hooks/register.tsx`)이 `classic.PreToolUse` 에서 `uk guard <경로> --session <session id>` 를 실행하고, 종료 코드 1 이면 권한 모드와 무관하게 사용자에게 확인 창을 띄운다(bypassPermissions 에서도 뜬다. 2026-10-29 실행 확인). 사용자가 거절하면 그 호출은 실행되지 않는다. Bash 로 파일을 쓰는 명령 · 2 · 3 은 도구가 막지 않으므로 이 스킬의 규칙으로만 지킨다.

## 메인 세션이 하는 것

| 일 | 수단 |
|---|---|
| 카드로 나눌 만큼 읽기 | Read · Grep · Glob · `git log` · `git diff` 같은 읽기 명령. 나눌 범위를 정하는 데까지만 읽는다 |
| 카드 만들기 · 고치기 · 옮기기 | `uk new` · `uk set` · `uk move` · `uk order` · `uk check` |
| 카드 실행 · 이어 가기 | `uk run` · `uk recover` · `uk board` |
| 카드 세션과 주고받기 | `uk inbox` · `uk comment`, 명령이 낸 SendMessage 줄 |
| 결과 검토 | `[result]` 코멘트 · 카드 세션이 바꾼 파일의 `git diff` 읽기 |
| 사용자에게 보고 | 채팅 답변 |
| 카드 세션의 질문을 모아 사용자에게 고르게 하기 | 아래 「결정 모으기」 |

## 차례

1. **나눈다.** 카드 하나는 세션 하나가 혼자 끝내고 `[result]` 를 남길 수 있는 단위다. 카드마다 두 가지를 정하고 `--depends` 로 적는다.
   - **업무 순서.** 앞 카드의 결과(바뀐 코드 · 정한 결정 · 조사 결과)가 있어야 시작할 수 있는 카드는 앞 카드에 의존한다.
   - **작업 충돌.** 카드 세션은 같은 작업 트리(프로젝트 루트)에서 돈다. 같은 파일 · 같은 생성물(빌드 폴더 · 잠금 파일 · DB 스키마)을 고치거나 같은 장치 · VM 을 다루는 카드끼리는 순서가 없어도 하나를 다른 하나에 의존시켜 함께 돌지 않게 한다.

   도구가 검사하는 것은 `depends_on` 과 동시 실행 수(`run.max_parallel`)뿐이다. 작업 충돌은 카드가 무엇을 고칠지 도구가 모르므로 여기서 판정한다(`../uhd-kanban/SKILL.md` 「동시 실행」).
2. **본문을 쓴다.** 본문이 카드 세션의 프롬프트 전부다. 메인 세션의 대화를 카드 세션은 읽지 못하므로 본문에 다음 다섯 가지를 적는다: 목표 · 고칠 파일이나 범위 · 하지 않을 것 · 끝난 판정(실행으로 확인할 것) · 참고할 카드 id. 본문은 scratchpad 의 파일에 쓰고 `--body-file` 로 넘긴다. 낱말 `ultracode` 는 `../uhd-kanban/SKILL.md` 「지킬 것」 5 대로 감싼다.
3. **태그를 단다.** `model:<프로필>` · `effort:<값>` · `ultracode` 는 아래 「모델 · effort · `ultracode` 고르기」 대로 단다. `model:` · `effort:` 태그가 없으면 claude 기본값으로 뜬다. 사람이 할 일은 `model:user` 를 단다(`uk run` 이 띄우지 않는다).
4. **만든다.** `uk new --type task --title <제목> --tags model:deep,effort:medium --depends k455 --body-file <경로>` 뒤 `uk check` 가 종료 코드 0 인지 본다. type 은 아래 「열 옮기기」의 첫 표로 고른다.
5. **맡긴다.** 의존 카드가 모두 끝난 카드부터 `uk run k<id>` 로 띄운다. 나머지는 앞 카드가 끝난 뒤 띄운다. 도는 카드 세션이 `run.max_parallel` 개에 차면 `uk run` 이 종료 코드 1 로 거절하므로, 우선순위가 높은 카드부터 띄우고 남은 카드는 하나가 끝난 뒤 띄운다.
6. **지켜본다.** 카드 세션의 `progress` · `question` · `result` 코멘트는 이 세션 앞으로 온다. `uk inbox` 로 읽는다. `question` 은 아래 「결정 모으기」 대로 처리한다. 멈춘 세션은 `uk board` 로 보고 `uk recover` 로 이어 간다. 세션이 끝났는데(state done) 작업이 남은 카드는 `uk recover --force k<id>` 로 이어 간다.
7. **검토한다.** 카드 세션은 `[result]` 를 남긴 뒤 카드를 `run.finish` 의 열(task · bug 는 `in-review`, decision 은 `decided`)로 옮긴다. `[result]` 코멘트와 `git diff` 를 읽고 끝난 판정을 만족하는지 본다. 판정에 따라 옮기는 열은 아래 「열 옮기기」가 갖는다. 고칠 것이 있으면 그 카드에 `--kind answer` 코멘트로 고칠 것과 끝난 판정을 남기고 `uk recover --force k<id>` 로 이어 가게 하거나(`[result]` 를 남긴 세션은 대개 state done 이라 `--force` 가 없으면 건너뛴다. `recover` 가 카드를 `in-progress` 로 되돌린다) 고칠 일을 새 카드로 만든다. 검토하다 고칠 자리를 찾아도 메인 세션이 고치지 않는다.
8. **보고한다.** 사용자에게 카드 id · 판정 · 남은 결정을 알린다.

## 모델 · effort · `ultracode` 고르기

기준의 출처는 Addy Osmani 의 「Which Claude model should you build with?」(https://claude.dev/blog/which-claude-model-should-you-build-with/, 2026-11-09)다. 2026-11-10 사용자 승인으로 이 절에 옮겼다. 마지막 행인 「되돌리기 어려운 일」은 poieve 의 Nimbalyst tracker 기준(2026-10-12)에서 가져왔다. 프로필이 가리키는 모델은 2026-11-10 에 Claude Code 2.1.322 의 `claude -p --model <값> --output-format json` 출력 `modelUsage` 로 확인했다: `fable` 은 `claude-fable-5-2`, `opus` 는 `claude-opus-5-5`, `sonnet` 은 `claude-sonnet-5-5`, `haiku` 는 `claude-haiku-5-5` 다.

### 모델과 처음 effort

| 작업 | 프로필 | 처음 effort |
|---|---|---|
| 무엇인지 아직 모르는 작업, 일상 구현 · 디버깅, 여러 파일에 걸친 기능 | `model:deep` | `medium` |
| 범위가 정해진 코딩(버그 수정, 스펙이 있는 작업) | `model:standard` | `medium` |
| 정해진 절차의 조사 · 리뷰 · 초안 | `model:standard` | `medium` |
| 분류 · 태깅 · 대량 추출 | `model:fast` | `medium` |
| 컴퓨터 사용, 스크린샷이 많은 작업(VM · 앱 화면 조작) | `model:deep` | `medium` |
| 마이그레이션 · 성능 최적화 | `model:deep`, 규모가 크면 `model:top` | `medium` |
| 대규모 리팩터링, 아키텍처 설계 | `model:top` | `medium` |
| 보안 · 결제 · 인증 · 법적 문구처럼 틀리면 되돌리기 어려운 일 | 위 행 중 그 작업의 프로필 | `high` |

스펙이 명확해도 마이그레이션 · 성능 최적화는 `model:standard` 로 내리지 않는다. 출처는 스펙의 명확함이 아니라 작업의 어려움으로 모델을 고른다.

### 결과가 모자랄 때

검토에서 끝난 판정을 만족하지 못한 카드는 아래 차례로 한 가지씩 바꾸고 `uk recover --force k<id>` 로 다시 돌린다. 태그는 `uk set k<id> --remove-tag effort:medium --add-tag effort:high` 처럼 바꾼다.

1. 본문의 끝난 판정에 카드 세션이 직접 실행할 검증 수단(시험 명령 · 빌드 · 스크립트)이 있는지 본다. 없으면 먼저 본문에 넣는다. 출처는 이것이 effort 를 올리는 것보다 비용과 지연이 적다고 적었다.
2. effort 를 한 단계 올린다(`low` 에서 `medium`, `medium` 에서 `high`).
3. `high` 에서도 모자라면 `xhigh` 로 올리지 않는다. 한 단계 위 프로필(`standard` 에서 `deep`, `deep` 에서 `top`)로 바꾸고 effort 를 `medium` 으로 되돌린다.

`xhigh` · `max` 는 같은 카드를 두 effort 로 돌려 결과 차이를 잰 뒤에만 단다. 출처의 SWE-bench Pro 측정(Opus 5.5)에서 `xhigh` 는 `high` 보다 약 1.4점 높았고 비용은 `high` 의 약 2.5배였다. 같은 측정에서 `medium` 은 `high` 보다 약 2.5점 낮았고 비용은 약 70% 였다.

### `ultracode`

카드 하나의 작업이 아래 두 가지를 모두 만족할 때만 `ultracode` 를 켠다.

1. 한 세션의 컨텍스트 창(2.1.322 에서 `modelUsage.contextWindow` 1000000 토큰)에 들어가지 않는다. 예: 파일 수백 개를 하나씩 읽어야 하는 결함 검색.
2. 서로 독립이고 모양이 같은 하위 작업(파일마다 · 레코드마다)으로 나뉜다.

앞 단계의 결과를 뒤 단계가 쓰는 작업과 한 컨텍스트 창에 들어가는 작업에는 켜지 않는다. 출처는 그런 작업에서 계획하고 결과를 합치는 비용이 아끼는 비용보다 크다고 적었다. 하위 작업마다 따로 검토할 결과가 나오면 `ultracode` 대신 카드를 나눈다(위 「차례」 1). 켜는 방법은 `../uhd-kanban/SKILL.md` 「지킬 것」 5 이고, `ultracode` 카드에는 `model:` 태그가 있어야 한다(없으면 `uk run` 이 띄우지 않는다). 그 세션이 Workflow 도구를 실제로 부르는지는 아직 확인하지 않았다(`../uhd-kanban/SKILL.md` 「실행」).

## 메인 세션 바꾸기

메인 세션의 대화가 길어지면 새 세션을 열어 이어받는다. 카드 세션은 역할 이름 `main` 앞으로 보고하고, `main` 이 가리키는 세션은 `.uhd-kanban/main.json` 한 곳에 있다(`../uhd-kanban/SKILL.md` 「코멘트」).

1. 옛 세션이 대화에만 있는 지시와 남은 결정을 그 카드에 `uk comment` 로 남긴다. 새 세션은 옛 세션의 대화를 읽지 못한다.
2. 새 세션을 옛 세션과 다른 이름으로 연다. SendMessage 는 이름으로 보내므로 같은 이름의 세션이 둘이면 `uk main --set` 이 거절한다.
3. 새 세션에서 `uk main --set` 을 실행한다. 그 뒤로 `uk comment` 가 `main` 앞으로 내는 SendMessage 줄은 새 세션 이름으로 나온다.
4. 새 세션에서 `uk inbox` 로 답하지 않은 코멘트를 읽고 `uk board` 로 도는 카드를 본다.
5. 옛 세션을 `claude stop` 으로 멈춘다.

`uk main` 으로 지금 등록된 세션을 본다. 등록된 세션이 없으면 `uk run` · `uk recover` 가 카드 세션을 띄운 뒤 그 명령을 부른 세션을 등록한다.

## 열 옮기기

각 열의 뜻은 `../uhd-kanban/SKILL.md` 의 열 표가 갖는다. 메인 세션은 카드의 상태가 그 뜻과 맞도록 아래대로 만들고 옮긴다.

| 만들 것 | type | 처음 열 |
|---|---|---|
| 코드 · 문서를 고치는 일, 조사 | `task` | `to-do` |
| 잘못된 동작을 고치는 일 | `bug` | `to-do` |
| 고를 것이 있고 그 답이 다른 카드의 작업을 정하는 일 | `decision` | `to-do`. 카드 세션이 선택지를 조사해 `[question]` 으로 올리고, 답을 받아 `[result]` 에 정한 것을 적는다 |
| 여러 카드를 한 목표로 묶는 것 | `milestone` | `planned`(`uk new` 의 기본). 묶일 카드는 `--collection k<milestone id>` 로 만든다 |

작업 카드를 만들 때 `uk board` 가 낸 milestone 줄에 `(active)` 가 있으면 카드가 그 목표에 속하는지 판단한다. 속하면 `--collection k<milestone id>` 를 적고, 속하는 milestone 이 없으면 적지 않는다. 소속이 없는 카드는 보드 모니터 pane 의 「소속 없음」 행에 든다.

`uk move` · `uk run` · `uk recover` 가 작업 카드를 `run.status` 의 열로 옮기면 그 카드가 속한 `planned` milestone 을 `active` 로 함께 옮긴다. 메인 세션이 따로 옮기지 않는다.

| 그때 | 하는 일 |
|---|---|
| task · bug 가 `in-review` 에 왔고 끝난 판정을 만족한다 | `uk move k<id> done` |
| decision 이 `decided` 에 왔다 | 그 결정을 반영할 task 카드를 만들고 `--depends` 에 decision 카드를 넣는다. `decided` 는 `dependencies.resolved` 에 있어 바로 띄울 수 있다 |
| decision 을 반영한 카드가 모두 `done` 이다 | `uk move k<decision id> implemented` |
| decision 에 반영할 코드가 없다 | `uk move k<decision id> done` |
| 카드 세션이 `run.finish` 의 열로 옮기지 않고 끝났다(`uk recover` 의 「끝남」) | `[result]` 를 읽고 그 열로 옮긴다 |
| `uk check` 가 `active` milestone 의 소속 카드가 모두 끝났다고 알렸다 | 그 목표를 마쳤으면 `uk move k<milestone id> done`. 카드를 더 만들 목표면 그대로 둔다. `active → done` 은 도구가 옮기지 않는다 |
| `uk check` 가 `planned` milestone 에 `in-progress` 소속 카드가 있다고 알렸다 | 진행 중이면 `uk move k<milestone id> active` |
| task · bug · decision 을 하지 않기로 했다 | `uk board` 로 세션이 도는지 보고, 돌면 `claude stop <session>` 뒤 `uk move k<id> cancelled` |
| `cancelled` 로 옮긴 `move` 가 기다리는 카드를 냈다 | 카드마다 고른다. 그만둔 카드의 결과가 없어도 할 수 있는 일이면 낸 `uk set … --remove-depends` 를, 아니면 함께 그만두는 `uk move … cancelled` 를 실행한다. 이 둘로 정할 수 없으면 「결정 모으기」로 사용자에게 묻는다 |

## 결정 모으기

카드 세션은 고를 것이 생기면 `[question]` 코멘트를 이 세션 앞으로 남기고 답을 기다린다. 질문 본문은 무엇을 정해야 하는지 · 선택지 2~4개(각각 결과와 대가) · 권장안과 이유 · 답이 올 때까지 멈추는 일을 갖는다(`uk run` 프롬프트가 정한다). 메인 세션은 질문을 하나씩 사용자에게 넘기지 않고, 모아서 정리한 뒤 한 번에 고르게 한다.

1. **모은다.** `uk inbox --kind question` 으로 답하지 않은 질문을 모두 읽는다. `[progress]` · `[result]` 코멘트가 섞이지 않는다.
2. **가른다.** 질문마다 누가 답할지 정한다.

   | 답하는 쪽 | 질문 |
   |---|---|
   | 메인 세션 | 답이 저장소 · 보드 · 이전 결정 코멘트(`[decision]` · `[user-decision]`) · 사용자가 이미 한 지시에 있다 |
   | 사용자 | 범위 · 우선순위 · 비용 · 되돌리기 어려운 일 · 외부로 나가는 일(push · 배포 · 메시지) · 위 자료로 정할 수 없는 일 |

   메인 세션이 답한 것은 `uk comment k<id> --kind answer --to k<id> --text "c<번호> 답: <답 · 근거>"` 로 남긴다.
3. **정리한다.** 사용자에게 넘길 질문을 다음과 같이 다시 쓴다. 카드 세션의 글을 그대로 붙이지 않는다.
   - 같은 것을 묻는 질문은 하나로 합치고, 걸린 카드 id 를 모두 적는다.
   - 질문마다 카드 id · 정해야 할 것 · 선택지 · 각 선택지의 결과와 대가 · 권장안을 적는다. 질문 본문에 근거가 모자라면 그 카드 파일과 앞 코멘트를 읽어 채운다.
   - 다른 결정을 막고 있는 질문(그 답을 기다리는 카드가 많은 것)을 앞에 둔다.
4. **고르게 한다.** AskUserQuestion 으로 묻는다. 한 번에 질문 네 개까지, 질문마다 선택지 2~4개다. 권장안을 첫 선택지에 두고 레이블 끝에 `(권장)` 을 붙인다. 질문 글은 대화의 앞 내용 없이 읽혀야 하므로 카드 id 와 정해야 할 것을 질문 안에 적는다. 질문이 네 개를 넘으면 앞의 네 개부터 묻는다. 선택지가 다섯 개 이상이거나 글이 길어 AskUserQuestion 에 맞지 않으면 채팅 답변에 표로 적고 답을 받는다.
5. **남긴다.** 고른 답을 카드마다 `uk comment k<id> --kind user-decision --to k<id> --text "c<번호> 결정: <고른 것> (사용자 선택)"` 로 남기고, 명령이 낸 SendMessage 줄을 보낸다. 합친 질문은 걸린 카드 모두에 남긴다. 사용자가 「Other」 로 적은 답은 그 글을 그대로 옮긴다.
6. **확인한다.** `uk inbox --kind question` 이 사용자가 아직 고르지 않은 질문만 내는지 본다. 고르지 않은 질문은 다음 보고에 다시 올린다.

## 막히는 때

| 상황 | 하는 일 |
|---|---|
| 고치려던 파일에 확인 창이 떴다 | 메인 세션이 프로젝트 파일을 고치려 한 것이다. 사용자가 직접 하라고 하지 않았으면 그 일을 카드로 만든다 |
| `uk run` 이 `Workspace not trusted` 로 실패한다 | 사용자에게 프로젝트 루트에서 `claude` 를 한 번 열어 trust 대화 상자를 수락해 달라고 한다. 메인 세션이 대신 작업하지 않는다 |
| 작업이 너무 작아 카드가 낭비로 보인다 | 그래도 카드로 만든다. 직접 할지는 사용자가 정한다(위 「이 스킬이 걸리는 세션」의 세 번째 줄) |
| 카드로 나눌 범위를 정할 수 없다 | 조사 카드를 하나 만들어 맡기고, 그 `[result]` 로 나눈다 |
