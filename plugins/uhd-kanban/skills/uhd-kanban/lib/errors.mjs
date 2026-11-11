// 보드 규칙 위반 · 실행 실패를 알리는 오류 클래스. bin/uhd-kanban.mjs 가 종료 코드로 바꾼다.
// 이 모듈은 아무 모듈도 import 하지 않는다. root.mjs · agents.mjs 처럼 i18n.mjs 보다 먼저 불리는 모듈도 이 모듈을 import 할 수 있어야 한다.

export class ProjectError extends Error {}

// 부른 디렉터리 위에 보드가 없다. 종료 코드 3 으로 끝나 보드가 있지만 틀린 경우(1)와 갈린다. 보드 모니터 mod 가 이 값으로 pane 을 열지 않는다.
export class NoProjectError extends ProjectError {}
