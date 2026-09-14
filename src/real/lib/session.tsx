/* 预览环境：模拟已登录的 SUPER_ADMIN 会话（真实仓库为 GET /v1/admin/me） */
export type AdminRole = 'SUPER_ADMIN' | 'CONTENT_OPERATOR' | 'SUPPORT_OPERATOR'

export interface AdminIdentity {
  id: string
  email: string
  display_name?: string
  status: 'ACTIVE' | 'DISABLED'
  roles: AdminRole[]
}

export interface AdminSession {
  admin: AdminIdentity
  csrfToken: string
  strongAuthAt?: string
  features: string[]
}

export type AdminSessionState = { status: 'loading' } | { status: 'anon' } | ({ status: 'authed' } & AdminSession)

export function useAdminSession(): { state: AdminSessionState; refresh: () => Promise<void> } {
  return {
    state: {
      status: 'authed',
      admin: {
        id: 'preview-admin',
        email: 'lin@example.com',
        display_name: 'Lin',
        status: 'ACTIVE',
        roles: ['SUPER_ADMIN'],
      },
      csrfToken: 'preview-csrf-token',
      features: [],
    },
    refresh: async () => {},
  }
}
