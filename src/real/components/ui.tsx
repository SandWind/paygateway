/*
 * 共享 UI 基础组件：站内链接、提示条、表单按钮。
 * 样式统一消费 @huayu/ui-tokens 令牌（见 index.css）。
 */
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'


export function Link({
  to,
  children,
  ...rest
}: { to: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(event) => {
        rest.onClick?.(event)
        // 修饰键点击交给浏览器原生行为（新标签等）
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return
        }
        event.preventDefault()
        window.location.href = to
      }}
    >
      {children}
    </a>
  )
}

export type AlertKind = 'error' | 'success' | 'info'

export function Alert({ kind, children }: { kind: AlertKind; children: ReactNode }) {
  return <div className={`alert alert--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>
}

export function SubmitButton({
  busy,
  children,
  type = 'submit',
  disabled,
  className = 'btn btn--primary',
  ...rest
}: { busy?: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={className} disabled={busy === true || disabled} {...rest}>
      {busy === true ? '处理中…' : children}
    </button>
  )
}
