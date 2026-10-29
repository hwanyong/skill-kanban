// 카드 파일 이름을 만들고 읽는다.
// 열 안의 카드: `<순서 번호>-k<id>-<제목>.md`   예: 0010-k457-로그인-오류-재현.md
// 아카이브한 카드: `<YYYY-MM-DD>-k<id>-<제목>.md`  예: 2026-10-21-k457-로그인-오류-재현.md
// 상태는 디렉터리 이름이, 순서는 파일 이름이 갖는다. frontmatter 에는 둘 다 적지 않는다.

import { t } from './i18n.mjs'

export const TITLE_LENGTH = 40

const ACTIVE = /^(\d+)-k([1-9]\d*)-(.+)\.md$/
const ARCHIVED = /^(\d{4}-\d{2}-\d{2})-k([1-9]\d*)-(.+)\.md$/

// macOS · SMB · git 이 다르게 다루는 문자를 `-` 로 바꾸고 NFC 로 맞춘다. 길이는 코드 포인트로 센다.
export const titleSlug = (title) => {
  const cleaned = String(title ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|#%]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  const cut = [...cleaned].slice(0, TITLE_LENGTH).join('').replace(/[-.]+$/, '')
  return cut == '' ? 'untitled' : cut
}

export const formatOrder = (order, width) => {
  if (!Number.isInteger(order) || order < 0) throw new RangeError(t('filename.orderInteger', { order }))
  const text = String(order)
  if (text.length > width) throw new RangeError(t('filename.orderWidth', { order, width }))
  return text.padStart(width, '0')
}

export const activeName = ({ order, id, title }, width) => `${formatOrder(order, width)}-k${id}-${titleSlug(title)}.md`

// 아카이브 파일 이름의 날짜는 이 Mac 의 시간대로 적는다. sv-SE 로캘은 날짜를 YYYY-MM-DD 로 쓴다.
export const localDate = (date) => date.toLocaleDateString('sv-SE')

export const archivedName = ({ date, id, title }) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError(t('filename.date', { date }))
  return `${date}-k${id}-${titleSlug(title)}.md`
}

// 날짜 모양을 먼저 본다. `2026-10-21-k5-…` 는 순서 번호 규칙으로도 읽히지 않지만 순서를 고정해 둔다.
// SMB(~/LOCAL) 의 readdir 는 한글 이름을 NFD 로 돌려준다(2026-10-29 실측). git 색인은 NFC 이므로 NFC 로 맞춰 읽는다.
export const parseName = (rawName) => {
  const name = rawName.normalize('NFC')
  const archived = name.match(ARCHIVED)
  if (archived) return { kind: 'archived', date: archived[1], id: Number(archived[2]), slug: archived[3] }
  const active = name.match(ACTIVE)
  if (active) return { kind: 'active', order: Number(active[1]), width: active[1].length, id: Number(active[2]), slug: active[3] }
  return null
}
