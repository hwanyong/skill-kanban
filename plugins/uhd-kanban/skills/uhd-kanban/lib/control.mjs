// 터미널은 ESC · BEL · C1(CSI 는 U+009B) 같은 제어 문자를 글자가 아니라 명령으로 해석한다. 카드 파일에서 읽은 값이 터미널 명령이 되지 않게 거른다.

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
const CONTROL_EXCEPT_TAB_NEWLINE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

export const hasControl = (text) => text.search(CONTROL) >= 0

// 제목처럼 한 줄로 그리는 값. 개행과 탭도 뺀다.
export const stripControl = (text) => text.replace(CONTROL, '')

// 여러 줄 출력. 개행과 탭은 출력 형식에 쓰므로 남긴다.
export const stripOutputControl = (text) => text.replace(CONTROL_EXCEPT_TAB_NEWLINE, '')
