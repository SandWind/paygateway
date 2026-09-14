/* 预览环境：仅保留支付网关页需要的 validateReason（与真实仓库同口径） */
export type ValidationMessage = string | null

const REASON_MAX_LENGTH = 200

function isControlChar(c: string): boolean {
  const code = c.codePointAt(0) ?? 0
  return code < 0x20 || code === 0x7f
}

/** 校验危险操作确认原因：界面层要求必填，服务端仅约束长度与控制字符 */
export function validateReason(reason: string, options?: { required?: boolean }): ValidationMessage {
  const required = options?.required !== false
  const value = reason.trim()
  if (value === '') {
    return required ? '请填写操作原因（必填）' : null
  }
  if ([...value].length > REASON_MAX_LENGTH) {
    return `原因不得超过 ${REASON_MAX_LENGTH} 个字符`
  }
  for (const c of value) {
    if (isControlChar(c)) {
      return '原因不得包含控制字符'
    }
  }
  return null
}
