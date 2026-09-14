/*
 * admin-api HTTP 客户端封装（api/admin-openapi.yaml）。
 *
 * - 错误信封统一为 { error: { code, message } }：客户端只依据稳定错误码
 *   分支，message 仅作展示兜底；MFA 流程码表见 FR-AUTH-05；
 * - ApiError 携带 Retry-After 头（限流提示）；
 * - 后台写操作（POST）经 X-CSRF-Token 头回传会话派生的 CSRF Token；
 * - 请求走同源相对路径（dev 由 Vite 代理 /v1 到 admin-api :8081）。
 */

/** 稳定错误码 + HTTP 状态的 API 业务错误 */
export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly retryAfterSeconds: number | null

  constructor(
    message: string,
    code: string,
    status: number,
    retryAfterSeconds: number | null,
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/** 网络层错误（无法到达服务端） */
export class NetworkError extends Error {
  constructor(message = '网络异常') {
    super(message)
    this.name = 'NetworkError'
  }
}

export interface ApiOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
  csrfToken?: string
  signal?: AbortSignal
}

export interface ApiResult<T> {
  status: number
  data: T | null
}

export async function apiRequest<T>(options: ApiOptions): Promise<ApiResult<T>> {
  // 预览环境：用内置模拟数据替代 admin-api（真实仓库走同源 /v1 代理）
  await new Promise((resolve) => setTimeout(resolve, 180))
  if (options.method !== 'GET') {
    applyMockWrite(options)
    return { status: 200, data: { ok: true } as T }
  }
  const data = mockResponse(options.path)
  return { status: 200, data: data as T }
}

const NOW = '2026-09-12T08:30:00Z'

const providers = [
  { id: 'pv-flrqf', provider_code: 'flrqfpay', name: 'FlrqfPay', adapter_type: 'flrqfpay', version: 3, created_at: '2026-05-02T03:12:00Z', updated_at: NOW },
  { id: 'pv-peqora', provider_code: 'peqorapay', name: 'PeqoraPay', adapter_type: 'peqorapay', version: 2, created_at: '2026-05-20T09:40:00Z', updated_at: '2026-09-01T06:00:00Z' },
  { id: 'pv-mock', provider_code: 'mock', name: 'Mock 沙箱', adapter_type: 'mock', version: 1, created_at: '2026-04-11T02:00:00Z', updated_at: '2026-08-18T11:20:00Z' },
]

const adapterTypes = {
  adapter_types: [
    {
      provider: 'flrqfpay',
      capabilities: { callback_methods: ['GET', 'POST'], supported_currencies: ['MYR', 'USD'] },
      config_schema: [
        { key: 'merchant_id', label: '商户号', kind: 'string', required: true, secret: false, description: 'FlrqfPay 分配的商户标识' },
        { key: 'gateway_url', label: '网关地址', kind: 'url', required: true, secret: false, description: '下单请求地址' },
        { key: 'api_secret', label: 'API 密钥', kind: 'secret', required: true, secret: true, description: '签名密钥，提交后不回显' },
        { key: 'callback_pubkey', label: '回调公钥', kind: 'secret', required: true, secret: true, description: 'RSA 回调验签公钥' },
      ],
    },
    {
      provider: 'peqorapay',
      capabilities: { callback_methods: ['POST'], supported_currencies: ['MYR'] },
      config_schema: [
        { key: 'app_id', label: '应用 ID', kind: 'string', required: true, secret: false, description: 'PeqoraPay 应用标识' },
        { key: 'private_key', label: 'RSA 私钥', kind: 'secret', required: true, secret: true, description: 'PEM 格式，提交后不回显' },
        { key: 'platform_pubkey', label: '平台公钥', kind: 'secret', required: true, secret: true, description: '回调验签用' },
      ],
    },
    {
      provider: 'mock',
      capabilities: { callback_methods: ['POST'], supported_currencies: ['MYR', 'USD', 'SGD'] },
      config_schema: [
        { key: 'endpoint', label: '模拟端点', kind: 'url', required: true, secret: false, description: '沙箱回调端点' },
      ],
    },
  ],
}

const channels = [
  { id: 'ch-flrqf-myr', channel_code: 'flrqf-myr-prod', provider_id: 'pv-flrqf', adapter_type: 'flrqfpay', name: 'FlrqfPay 马来主站', pay_request_url: 'https://pay.flrqf.example/checkout', pay_callback: 'flrqf', default_payment_method: 'ewallet', environment: 'PROD', is_enabled: true, routing_weight: 6200, current_version_id: 'mv-f-3', archived_at: null, version: 12, created_at: '2026-05-02T03:20:00Z', updated_at: NOW },
  { id: 'ch-peqora-myr', channel_code: 'peqora-myr-prod', provider_id: 'pv-peqora', adapter_type: 'peqorapay', name: 'PeqoraPay 马来备用', pay_request_url: 'https://api.peqora.example/orders', pay_callback: 'peqora', default_payment_method: 'card', environment: 'PROD', is_enabled: true, routing_weight: 2800, current_version_id: 'mv-p-2', archived_at: null, version: 7, created_at: '2026-05-21T07:00:00Z', updated_at: '2026-09-10T09:00:00Z' },
  { id: 'ch-mock-test', channel_code: 'mock-test', provider_id: 'pv-mock', adapter_type: 'mock', name: 'Mock 沙箱联调', pay_request_url: 'https://sandbox.mock.example/pay', pay_callback: 'mock', default_payment_method: 'ewallet', environment: 'TEST', is_enabled: true, routing_weight: 1000, current_version_id: 'mv-m-1', archived_at: null, version: 3, created_at: '2026-04-11T02:10:00Z', updated_at: '2026-08-30T04:00:00Z' },
  { id: 'ch-flrqf-old', channel_code: 'flrqf-myr-legacy', provider_id: 'pv-flrqf', adapter_type: 'flrqfpay', name: 'FlrqfPay 旧入口', pay_request_url: 'https://legacy.flrqf.example/pay', pay_callback: 'flrqf', default_payment_method: 'ewallet', environment: 'PROD', is_enabled: false, routing_weight: 0, current_version_id: null, archived_at: '2026-08-01T00:00:00Z', version: 21, created_at: '2025-11-02T03:20:00Z', updated_at: '2026-08-01T00:00:00Z' },
]

const merchantsByChannel: Record<string, unknown[]> = {
  'ch-flrqf-myr': [
    { id: 'm-f-1', channel_id: 'ch-flrqf-myr', name: '主站商户', merchant_number: 'FLR8821001', alipay_number: 'ali-flr-001', wechatpay_number: 'wx-flr-001', status: 'ENABLED', ready_version: { id: 'mv-f-3', version_no: 3, config_digest: '9f2ac41d77e3b002', validated_at: '2026-09-01T02:00:00Z', created_at: '2026-08-28T10:00:00Z' }, version: 5, created_at: '2026-05-02T03:30:00Z', updated_at: NOW },
  ],
  'ch-peqora-myr': [
    { id: 'm-p-1', channel_id: 'ch-peqora-myr', name: '备用商户 A', merchant_number: 'PEQ100223', alipay_number: 'ali-peq-002', wechatpay_number: 'wx-peq-002', status: 'ENABLED', ready_version: { id: 'mv-p-2', version_no: 2, config_digest: '51be09aa31c74d90', validated_at: '2026-08-12T06:30:00Z', created_at: '2026-08-10T03:00:00Z' }, version: 4, created_at: '2026-05-21T07:10:00Z', updated_at: '2026-09-10T09:00:00Z' },
    { id: 'm-p-2', channel_id: 'ch-peqora-myr', name: '备用商户 B', merchant_number: 'PEQ100987', alipay_number: 'ali-peq-003', wechatpay_number: 'wx-peq-003', status: 'DISABLED', ready_version: null, version: 1, created_at: '2026-06-15T08:00:00Z', updated_at: '2026-07-01T08:00:00Z' },
  ],
  'ch-mock-test': [
    { id: 'm-m-1', channel_id: 'ch-mock-test', name: '沙箱商户', merchant_number: 'MOCK0001', alipay_number: 'ali-mock-1', wechatpay_number: 'wx-mock-1', status: 'ENABLED', ready_version: null, version: 2, created_at: '2026-04-11T02:20:00Z', updated_at: '2026-08-30T04:00:00Z' },
  ],
  'ch-flrqf-old': [],
}

const versionsByMerchant: Record<string, unknown[]> = {
  'm-f-1': [
    { id: 'mv-f-3', merchant_id: 'm-f-1', version_no: 3, status: 'READY', callback_key: 'cbk_f3a9', callback_url: 'https://api.example.com/v1/pay/callback/flrqf/cbk_f3a9', config_digest: '9f2ac41d77e3b002', config: [ { key: 'merchant_id', value: 'FLR8821001', secret: false }, { key: 'gateway_url', value: 'https://pay.flrqf.example/checkout', secret: false }, { key: 'api_secret', value: '9f2ac41d…b002', secret: true }, { key: 'callback_pubkey', value: '77e3b002…c41d', secret: true } ], validated_at: '2026-09-01T02:00:00Z', created_at: '2026-08-28T10:00:00Z' },
    { id: 'mv-f-4', merchant_id: 'm-f-1', version_no: 4, status: 'PENDING', callback_key: 'cbk_f4b1', callback_url: 'https://api.example.com/v1/pay/callback/flrqf/cbk_f4b1', config_digest: 'aa10d4f29c871e55', config: [ { key: 'merchant_id', value: 'FLR8821001', secret: false }, { key: 'gateway_url', value: 'https://pay.flrqf.example/checkout', secret: false }, { key: 'api_secret', value: 'aa10d4f2…1e55', secret: true } ], validated_at: null, created_at: '2026-09-11T07:40:00Z' },
    { id: 'mv-f-2', merchant_id: 'm-f-1', version_no: 2, status: 'RETIRED', callback_key: 'cbk_f2c7', callback_url: '', config_digest: '0b3e77aa12f904cd', config: [], validated_at: '2026-06-20T02:00:00Z', created_at: '2026-06-18T10:00:00Z' },
  ],
  'm-p-1': [
    { id: 'mv-p-2', merchant_id: 'm-p-1', version_no: 2, status: 'READY', callback_key: 'cbk_p2d4', callback_url: 'https://api.example.com/v1/pay/callback/peqora/cbk_p2d4', config_digest: '51be09aa31c74d90', config: [ { key: 'app_id', value: 'PEQ100223', secret: false }, { key: 'private_key', value: '51be09aa…4d90', secret: true } ], validated_at: '2026-08-12T06:30:00Z', created_at: '2026-08-10T03:00:00Z' },
    { id: 'mv-p-1', merchant_id: 'm-p-1', version_no: 1, status: 'INVALID', callback_key: 'cbk_p1e8', callback_url: '', config_digest: '77aa12f90b3e04cd', config: [], validated_at: null, created_at: '2026-07-02T03:00:00Z' },
  ],
  'm-m-1': [
    { id: 'mv-m-1', merchant_id: 'm-m-1', version_no: 1, status: 'READY', callback_key: 'cbk_m1f2', callback_url: 'https://api.example.com/v1/pay/callback/mock/cbk_m1f2', config_digest: 'cd04f977aa12b3e0', config: [ { key: 'endpoint', value: 'https://sandbox.mock.example/pay', secret: false } ], validated_at: '2026-04-11T02:40:00Z', created_at: '2026-04-11T02:30:00Z' },
  ],
}

/** 预览环境：把渠道写操作落到内存数据，让启停切换等交互可见 */
function applyMockWrite(options: ApiOptions): void {
  const body = (options.body ?? {}) as Record<string, unknown>
  if (options.method === 'PATCH' && options.path.endsWith('/channels')) {
    const target = channels.find((channel) => channel.id === body['channel_id'])
    if (target) {
      if (typeof body['is_enabled'] === 'boolean') target.is_enabled = body['is_enabled']
      if (typeof body['routing_weight'] === 'number') target.routing_weight = body['routing_weight']
      if (typeof body['environment'] === 'string') target.environment = body['environment']
      if (typeof body['name'] === 'string') target.name = body['name']
      target.version += 1
    }
    return
  }
  const actionMatch = /\/channels\/([^/]+)\/(disable|archive)$/.exec(options.path)
  if (actionMatch) {
    const target = channels.find((channel) => channel.id === actionMatch[1])
    if (target) {
      target.is_enabled = false
      if (actionMatch[2] === 'archive') target.archived_at = '2026-09-14T00:00:00Z'
      target.version += 1
    }
  }
}

function mockResponse(path: string): unknown {
  if (path.endsWith('/providers')) return { providers }
  if (path.endsWith('/adapter-types')) return adapterTypes
  if (path.endsWith('/channels')) return { channels }
  const merchantsMatch = /\/channels\/([^/]+)\/merchants$/.exec(path)
  if (merchantsMatch) {
    const channelId = merchantsMatch[1]
    if (channelId) return { merchants: merchantsByChannel[channelId] ?? [] }
  }
  const versionsMatch = /\/merchants\/([^/]+)\/versions$/.exec(path)
  if (versionsMatch) {
    const merchantId = versionsMatch[1]
    if (merchantId) return { versions: versionsByMerchant[merchantId] ?? [] }
  }
  return {}
}

function retryAfterText(retryAfterSeconds: number | null): string {
  return retryAfterSeconds !== null && retryAfterSeconds > 0
    ? `尝试过于频繁，请 ${retryAfterSeconds} 秒后再试`
    : '尝试过于频繁，请稍后再试'
}

/** 按稳定错误码映射管理员可读文案（客户端唯一分支依据是 code） */
export function messageForApiError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'AUTH_FAILED':
        return '邮箱或密码不正确'
      case 'ADMIN_DISABLED':
        return '账号已停用，请联系超级管理员'
      case 'RATE_LIMITED':
      case 'MFA_RATE_LIMITED':
        return retryAfterText(err.retryAfterSeconds)
      case 'INVALID_EMAIL':
        return '邮箱格式不正确'
      case 'INVALID_PASSWORD':
        return '密码格式不正确'
      case 'INVALID_REQUEST':
        return '请求格式有误，请检查后重试'
      case 'MFA_REQUIRED':
        return '请完成第二因素验证'
      case 'MFA_ENROLLMENT_REQUIRED':
        return '请先完成 TOTP 绑定'
      case 'MFA_ALREADY_ENROLLED':
        return '已绑定 TOTP，无需重复绑定'
      case 'MFA_INVALID':
        return '验证码不正确'
      case 'MFA_REPLAYED':
        return '验证码已使用，请使用最新一枚验证码'
      case 'MFA_CHALLENGE_EXPIRED':
        return '验证已过期，请重新从密码登录开始'
      case 'UNAUTHENTICATED':
        return '请先完成管理员登录'
      case 'SESSION_EXPIRED':
        return '登录状态已失效，请重新登录'
      case 'CSRF_REQUIRED':
        return '会话校验失败，请刷新页面后重试'
      case 'FORBIDDEN':
        return '当前角色没有执行该操作的权限'
      case 'STRONG_AUTH_REQUIRED':
        return '该操作需要近期强认证，请重新验证密码与动态口令'
      // 管理员与审计域稳定错误码（US-039 契约）
      case 'INVITE_INVALID':
        return '邀请令牌无效、已使用或已过期'
      case 'ADMIN_EMAIL_EXISTS':
        return '该邮箱已是管理员'
      case 'INVITE_ALREADY_PENDING':
        return '该邮箱已有待接受的邀请'
      case 'ROLE_NOT_ASSIGNABLE':
        return '仅允许分配固定系统角色'
      case 'ROLE_NOT_ASSIGNED':
        return '该管理员没有此角色'
      case 'SELF_TARGET_FORBIDDEN':
        return '不能对自己执行该操作'
      case 'LAST_SUPER_ADMIN':
        return '系统必须保留至少一名可登录的超级管理员'
      case 'ADMIN_NOT_FOUND':
        return '管理员不存在'
      // 客服与订单查询域稳定错误码（US-038 契约）
      case 'CUSTOMER_NOT_FOUND':
        return '用户不存在'
      case 'ORDER_NOT_FOUND':
        return '未找到匹配的订单或事件'
      case 'COMMAND_MALFORMED':
        return '命令参数不完整，请检查后重试'
      case 'COMMAND_CONFLICT':
        return '命令编号冲突，未执行；请勿重复提交'
      case 'COMMAND_CHANNEL_UNCONFIGURED':
        return '内部命令通道未配置，人工处置暂不可用'
      // 内容域稳定错误码（US-015 契约）
      case 'SERIES_NOT_FOUND':
        return '作品不存在或已被删除'
      case 'EPISODE_NOT_FOUND':
        return '剧集不存在或已被删除'
      case 'TRAILER_NOT_FOUND':
        return 'Trailer 不存在或已被删除'
      case 'SLUG_ALREADY_EXISTS':
        return 'slug 已被其他作品占用'
      case 'EPISODE_NO_ALREADY_EXISTS':
        return '该集号已存在'
      case 'DISPLAY_ORDER_CONFLICT':
        return '该展示顺序已被占用'
      case 'INVALID_STATUS_TRANSITION':
        return '当前状态不允许该操作'
      case 'SERIES_NOT_PUBLISHED':
        return '父作品未发布，不能发布子剧集'
      case 'TRAILER_ACTIVE_MEDIA_REQUIRED':
        return '缺少已激活的媒体版本，不能发布'
      case 'TRAILER_ACTIVE_MEDIA_INVALID':
        return '当前媒体版本不满足发布条件'
      case 'TRAILER_DURATION_REQUIRED':
        return '缺少有效的服务端时长，不能发布'
      case 'TRAILER_HAS_MEDIA':
        return 'Trailer 仍被媒体版本引用，不能删除'
      case 'MEDIA_VERSION_KV_NOT_SYNCED':
        return '媒体映射尚未同步，请在媒体上传页同步后再激活。'
      case 'MEDIA_VERSION_NOT_SYNCABLE':
        return '该媒体版本尚未通过校验，暂不能同步。'
      case 'MEDIA_KV_SYNC_DISABLED':
        return '媒体同步未启用，请联系管理员配置。'
      case 'MEDIA_VERSION_NOT_FOUND':
        return '媒体版本不存在或已被清理'
      case 'MEDIA_VERSION_NOT_ACTIVATABLE':
        return '仅校验通过（READY）的版本可激活，请先在媒体上传页完成校验'
      case 'MEDIA_VERSION_OWNER_MISMATCH':
        return '媒体版本与目标归属不匹配，请刷新页面后重试'
      // 上传域稳定错误码（US-029 契约）
      case 'UPLOAD_VERSION_NOT_DELETABLE':
        return '该会话对应的媒体版本已就绪或在使用中，不能删除'
      case 'UPLOAD_DELETE_FAILED':
        return '删除存储对象失败，记录已保留，请稍后重试'
	  case 'SERIES_IMAGES_REQUIRED':
		return '作品缺少发布必需的横版海报或竖版封面'
	  case 'ASSET_TYPE_MISMATCH':
		return '所选素材的用途、格式或状态与字段不匹配'
	  case 'ASSET_IN_USE':
		return '素材仍被内容或品牌引用，不能归档'
	  case 'ASSET_CHECKSUM_MISMATCH':
		return '图片上传后的 SHA-256 校验失败，请重新上传'
	  case 'ASSET_DIMENSION_INVALID':
		return '图片尺寸超出该用途允许范围（比例不限，过大的图会自动等比缩小）'
	  case 'ASSET_OBJECT_MISSING':
		return '对象存储中没有找到这张图片'
      // 字体设置域稳定错误码（全站字体样式后台配置契约）
      case 'CONTENT_VERSION_CONFLICT':
        return '配置已被其他管理员修改，请重新加载后再试'
      // 支付网关域稳定错误码（configstore 契约，US-024）
      case 'ADAPTER_NOT_REGISTERED':
        return '适配器未注册：只能选择编译期注册的支付适配器'
      case 'CHANNEL_CODE_CONFLICT':
        return '渠道代码已被其他渠道占用'
      case 'ROUTING_WEIGHT_INVALID':
        return '路由权重必须是 0..10000 的整数'
      case 'MERCHANT_CONFIG_SCHEMA_INVALID':
        return '商户凭据不符合适配器配置 schema（字段缺失、未知或取值非法）'
      case 'PAYMENT_CONFIG_VERSION_CONFLICT':
        return '支付渠道配置已被其他管理员修改，请刷新页面后基于最新版本重试'
      case 'CHANNEL_ARCHIVED':
        return '渠道已归档，配置列已冻结'
      case 'CHANNEL_NOT_FOUND':
        return '支付渠道不存在或已被删除'
      case 'MERCHANT_NOT_FOUND':
        return '商户不存在'
      case 'MERCHANT_ALREADY_ENABLED':
        return '该渠道已存在启用的商户（最多一个 ENABLED）'
      case 'MERCHANT_VERSION_NOT_FOUND':
        return '商户版本不存在'
      case 'MERCHANT_VERSION_NOT_PENDING':
        return '版本不在待校验状态（仅 PENDING 可校验，INVALID 须提交新版本）'
      case 'MERCHANT_VERSION_NOT_READY':
        return '没有 READY 的商户版本，无法启用（请先提交并校验通过商户版本）'
      default:
        return '服务暂时不可用，请稍后重试'
    }
  }
  if (err instanceof NetworkError) {
    return err.message
  }
  return '操作失败，请稍后重试'
}
