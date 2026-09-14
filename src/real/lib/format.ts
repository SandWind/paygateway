/*
 * 展示格式化工具：业务时间存储与传输一律 UTC，对管理员展示按
 * Asia/Kuala_Lumpur 格式化（PRD 文档头、DEC-07）；与 user-web 的
 * format.ts 同款约定。
 */

const klFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Kuala_Lumpur',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** RFC3339 UTC 时间 → 马来西亚时间（UTC+8）展示文案；非法值返回占位符 */
export function formatDateTimeKL(iso: string | null | undefined): string {
  if (iso === undefined || iso === null || iso === '') {
    return '—'
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  return `${klFormatter.format(date)}（UTC+8）`
}

/** 媒体版本等长 UUID 的短展示（保留前 8 位便于人工比对） */
export function shortId(id: string | null | undefined): string {
  if (id === undefined || id === null || id === '') {
    return '—'
  }
  return id.slice(0, 8)
}
