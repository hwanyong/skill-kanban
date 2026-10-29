# uhd-kanban

프로젝트마다 `kanban/` 디렉터리의 `.md` 카드 파일로 칸반 보드를 운영하는 Claude Code 플러그인이다. 두 가지가 들어 있다.

| 구성 | 경로 | 하는 일 |
|---|---|---|
| 스킬 `uhd-kanban` | `skills/uhd-kanban/` | 카드 만들기 · 열 옮기기 · 순서 · 코멘트 · 아카이브 · 카드를 `claude --bg` 세션으로 실행 · 멈춘 세션 이어 가기. 사용법은 `skills/uhd-kanban/SKILL.md` |
| 보드 모니터 | `hooks/register.tsx` | 세션 디렉터리 위에 `.uhd-kanban/config.json` 이 있으면 pane 을 열고, 열마다 카드 하나를 한 칸으로 그린다. 갱신 주기는 `config.json` 의 `monitor.interval_seconds`(기본 60초) |

## 설치

```
/plugin marketplace add <owner>/<repo>
/plugin install uhd-kanban@skill-kanban
```

이 저장소를 내려받은 폴더로 설치하려면 `claude plugin marketplace add <폴더>` 뒤 `claude plugin install uhd-kanban@skill-kanban` 을 실행한다. 폴더로 설치하면 Claude Code 가 그 폴더를 직접 읽으므로, 고친 뒤 `/reload-plugins` 로 다시 읽는다.

## 필요한 것

- Claude Code 2.1.312 이상(hooks 모듈 API 를 이 판에서 확인했다)
- `node` 21 이상(`Object.groupBy`). PATH 에 있어야 한다
- 보드를 쓸 프로젝트 루트에서 `node <플러그인 폴더>/skills/uhd-kanban/bin/uhd-kanban.mjs init`

## 출처

[mattjoyce/kanban-skill](https://github.com/mattjoyce/kanban-skill)(커밋 b86a6ec, Apache-2.0)을 참고해 Node ESM 으로 새로 작성했다.

## 라이선스

MIT. `LICENSE` 를 본다.
