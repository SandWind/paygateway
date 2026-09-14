/*
 * 危险操作确认对话框（PRD 5.5：展示目标、影响、必填原因）。
 *
 * 提交经调用方注入的 run(reason) 执行；当服务端返回 STRONG_AUTH_REQUIRED
 * （发布/下架要求 10 分钟内的密码 + TOTP 提权，服务端判定是唯一依据）时，
 * 对话框切换到提权步骤，验证成功后自动重试一次原操作。
 */
import { useEffect, useState } from 'react'
import { ApiError, apiRequest, messageForApiError } from '../lib/api.ts'
import { SubmitButton } from './ui.tsx'
import { validateReason } from '../lib/content.ts'

interface EscalateResponse {
  strong_auth_expires_in?: unknown
}

export interface ConfirmDialogProps {
  open: boolean
  /** 对话框标题，如“发布作品” */
  title: string
  /** 操作目标描述（必填原因之外的第二重确认信息） */
  target: string
  /** 操作影响描述 */
  impact: string
  confirmLabel: string
  csrfToken: string
  onClose: () => void
  /** 执行危险操作；失败时抛 ApiError（STRONG_AUTH_REQUIRED 触发提权步骤） */
  run: (reason: string) => Promise<void>
  /** 提权成功后回调（刷新会话的 strong_auth_at 展示） */
  onEscalated?: () => void
}

export function ConfirmDialog({
  open,
  title,
  target,
  impact,
  confirmLabel,
  csrfToken,
  onClose,
  run,
  onEscalated,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'reason' | 'escalate'>('reason')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setReason('')
      setReasonError(null)
      setPassword('')
      setCode('')
      setStep('reason')
      setError(null)
      setNotice(null)
      setBusy(false)
    }
  }, [open])

  if (!open) {
    return null
  }

  const reasonInvalid = validateReason(reason)

  const execute = async () => {
    setBusy(true)
    setError(null)
    try {
      await run(reason.trim())
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STRONG_AUTH_REQUIRED' && step === 'reason') {
        // 危险操作超窗：切换到提权步骤，验证成功后重试
        setStep('escalate')
        setNotice('该操作需要 10 分钟内的强认证，请重新验证密码与动态口令，验证成功后将自动重试。')
      } else {
        setError(messageForApiError(err))
      }
    } finally {
      setBusy(false)
    }
  }

  const escalate = async () => {
    setBusy(true)
    setError(null)
    try {
      await apiRequest<EscalateResponse>({
        method: 'POST',
        path: '/v1/admin/auth/escalate',
        body: { password, code: code.trim() },
        csrfToken,
      })
      setPassword('')
      setCode('')
      onEscalated?.()
      // 提权成功：重试一次原操作
      await run(reason.trim())
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STRONG_AUTH_REQUIRED') {
        setError('提权未生效，请稍后重试或重新登录')
      } else {
        setError(messageForApiError(err))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" data-testid="confirm-dialog" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="modal__title">{title}</h2>
        <dl className="modal__facts">
          <div className="modal__fact">
            <dt>目标</dt>
            <dd data-testid="confirm-target">{target}</dd>
          </div>
          <div className="modal__fact">
            <dt>影响</dt>
            <dd>{impact}</dd>
          </div>
        </dl>

        {step === 'reason' ? (
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault()
              if (reasonInvalid !== null) {
                setReasonError(reasonInvalid)
                return
              }
              setReasonError(null)
              void execute()
            }}
          >
            <div className="form__field">
              <label className="form__label" htmlFor="confirm-reason">
                操作原因（必填，将写入审计）
              </label>
              <textarea
                id="confirm-reason"
                data-testid="confirm-reason"
                value={reason}
                maxLength={500}
                rows={3}
                onChange={(event) => setReason(event.target.value)}
                placeholder="例如：定档上线 / 内容整改下架"
              />
              {reasonError !== null ? <p className="form__error">{reasonError}</p> : null}
            </div>
            {error !== null ? <p className="alert alert--error">{error}</p> : null}
            <div className="modal__actions">
              <SubmitButton busy={busy} disabled={reasonInvalid !== null} data-testid="confirm-submit">
                {confirmLabel}
              </SubmitButton>
              <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
                取消
              </button>
            </div>
          </form>
        ) : (
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault()
              if (password === '' || code.trim() === '') {
                setError('请输入密码与动态口令')
                return
              }
              void escalate()
            }}
          >
            {notice !== null ? <p className="alert alert--info">{notice}</p> : null}
            <div className="form__field">
              <label className="form__label" htmlFor="escalate-password">
                管理员密码
              </label>
              <input
                id="escalate-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="form__field">
              <label className="form__label" htmlFor="escalate-code">
                TOTP 动态口令（6 位）
              </label>
              <input
                id="escalate-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            {error !== null ? <p className="alert alert--error">{error}</p> : null}
            <div className="modal__actions">
              <SubmitButton busy={busy} data-testid="escalate-submit">
                验证并重试
              </SubmitButton>
              <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
                取消
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
