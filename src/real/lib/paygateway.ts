/*
 * 支付网关管理纯逻辑（/settings/payment-gateways，US-023 渠道概览 +
 * US-024 渠道与商户配置表单）。
 *
 * - 服务端读模型即脱敏合同（FR-058：渠道 / 商户列表不含任何凭据原文），
 *   客户端只做防御性解析、展示推导与提交前输入校验；
 * - 流量占比 = routing_weight / total_weight：total 只统计参与路由的渠道
 *   （未归档且启用且权重 > 0），与网关候选过滤（FR-023）可判定的部分一致；
 * - 「配置未就绪」= 启用渠道下没有启用商户的 READY 版本（网关侧同样会被
 *   候选过滤排除，启用前置 MERCHANT_VERSION_NOT_READY）。
 * - 商户版本表单按 adapter-types 的脱敏 schema 动态渲染（FR-053）；
 *   Secret 字段只在提交请求中出现，永不回显或预填（FR-058）。
 */

/** 服务端 Provider 读模型（三级配置 Provider 层；协议绑定不可变） */
export interface PaymentProviderView {
  id: string
  provider_code: string
  name: string
  adapter_type: string
  version: number
  created_at: string
  updated_at: string
}

/** 服务端渠道读模型（admin-api 渠道合同；无凭据列） */
export interface PaymentChannelView {
  id: string
  channel_code: string
  provider_id: string
  adapter_type: string
  name: string
  pay_request_url: string
  pay_callback: string
  default_payment_method: string
  environment: string
  is_enabled: boolean
  routing_weight: number
  current_version_id: string | null
  archived_at: string | null
  version: number
  created_at: string
  updated_at: string
}

/** 商户版本元数据摘要（商户列表内嵌，config_digest 为十六进制 sha256） */
export interface PaymentMerchantVersionSummary {
  id: string
  version_no: number
  config_digest: string
  validated_at: string | null
  created_at: string
}

/** 服务端商户读模型（ready_version=null 表示尚无 READY 版本） */
export interface PaymentMerchantView {
  id: string
  channel_id: string
  name: string
  merchant_number: string
  alipay_number: string
  wechatpay_number: string
  status: string
  ready_version: PaymentMerchantVersionSummary | null
  version: number
  created_at: string
  updated_at: string
}

export type ChannelLifecycle = 'enabled' | 'disabled' | 'archived'

/** 渠道生命周期展示态：归档优先（归档必然同时停用） */
export function channelLifecycle(channel: Pick<PaymentChannelView, 'archived_at' | 'is_enabled'>): ChannelLifecycle {
  if (channel.archived_at !== null) {
    return 'archived'
  }
  return channel.is_enabled ? 'enabled' : 'disabled'
}

/** 路由参与判定：未归档且启用且权重 > 0 */
export function participatesInRouting(channel: PaymentChannelView): boolean {
  return channel.archived_at === null && channel.is_enabled && channel.routing_weight > 0
}

/** 路由总权重：只统计参与路由的渠道 */
export function routingTotalWeight(channels: PaymentChannelView[]): number {
  return channels.reduce((sum, channel) => (participatesInRouting(channel) ? sum + channel.routing_weight : sum), 0)
}

/** 归一化占比（0..100 的百分数）：未参与路由或总权重为 0 时返回 null */
export function channelSharePercent(weight: number, total: number): number | null {
  if (total <= 0 || weight <= 0) {
    return null
  }
  return (weight / total) * 100
}

/** 占比展示：整数不带小数，否则保留一位小数（30% / 12.5%） */
export function formatSharePercent(percent: number): string {
  const rounded = Math.round(percent * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded}%`
}

/** 版本摘要指纹：sha256 前 8 位（服务端脱敏口径一致） */
export function shortDigest(digest: string): string {
  return digest.slice(0, 8)
}

export interface ReadyMerchantVersion {
  merchantId: string
  merchantName: string
  versionNo: number
  configDigest: string
}

/** 渠道当前 READY 商户版本：启用商户的 ready_version（每商户 READY 唯一） */
export function findReadyMerchantVersion(
  merchants: PaymentMerchantView[],
): ReadyMerchantVersion | null {
  for (const merchant of merchants) {
    if (merchant.status === 'ENABLED' && merchant.ready_version !== null) {
      return {
        merchantId: merchant.id,
        merchantName: merchant.name,
        versionNo: merchant.ready_version.version_no,
        configDigest: merchant.ready_version.config_digest,
      }
    }
  }
  return null
}

/** 渠道概览行展示模型（占比与就绪状态由渠道 + 商户事实推导） */
export interface PaymentChannelRow {
  channel: PaymentChannelView
  lifecycle: ChannelLifecycle
  ready: ReadyMerchantVersion | null
  /** 配置未就绪：启用但无可用 READY 版本（不参与新支付路由） */
  notReady: boolean
  sharePercent: number | null
}

/** 组装概览行：按 channel_code ASC, id ASC 排序，占比对全部渠道统一计算 */
export function buildChannelRows(
  channels: PaymentChannelView[],
  merchantsByChannel: Record<string, PaymentMerchantView[]>,
): PaymentChannelRow[] {
  const total = routingTotalWeight(channels)
  const rows = channels.map((channel): PaymentChannelRow => {
    const ready = findReadyMerchantVersion(merchantsByChannel[channel.id] ?? [])
    const participates = participatesInRouting(channel)
    return {
      channel,
      lifecycle: channelLifecycle(channel),
      ready,
      notReady: channelLifecycle(channel) === 'enabled' && ready === null,
      sharePercent: participates ? channelSharePercent(channel.routing_weight, total) : null,
    }
  })
  rows.sort((a, b) => a.channel.channel_code.localeCompare(b.channel.channel_code) || a.channel.id.localeCompare(b.channel.id))
  return rows
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function optionalString(value: unknown): string | null | undefined {
  if (value === null) {
    return null
  }
  return typeof value === 'string' ? value : undefined
}

/** 防御性解析 GET /v1/admin/payment-gateways/providers 响应 */
export function parseProviderList(value: unknown): PaymentProviderView[] {
  if (!isRecord(value) || !Array.isArray(value.providers)) {
    return []
  }
  const parsed: PaymentProviderView[] = []
  for (const raw of value.providers) {
    if (
      !isRecord(raw) ||
      typeof raw.id !== 'string' ||
      typeof raw.provider_code !== 'string' ||
      typeof raw.name !== 'string' ||
      typeof raw.adapter_type !== 'string' ||
      typeof raw.version !== 'number' ||
      typeof raw.created_at !== 'string' ||
      typeof raw.updated_at !== 'string'
    ) {
      continue
    }
    parsed.push({
      id: raw.id,
      provider_code: raw.provider_code,
      name: raw.name,
      adapter_type: raw.adapter_type,
      version: raw.version,
      created_at: raw.created_at,
      updated_at: raw.updated_at,
    })
  }
  return parsed
}

/** 防御性解析 GET /v1/admin/payment-gateways/channels 响应：丢弃不合格行 */
export function parseChannelList(value: unknown): PaymentChannelView[] {
  if (!isRecord(value) || !Array.isArray(value.channels)) {
    return []
  }
  const parsed: PaymentChannelView[] = []
  for (const raw of value.channels) {
    if (!isRecord(raw)) {
      continue
    }
    const archivedAt = optionalString(raw.archived_at)
    const currentVersionId = optionalString(raw.current_version_id)
    if (
      typeof raw.id !== 'string' ||
      typeof raw.channel_code !== 'string' ||
      typeof raw.provider_id !== 'string' ||
      typeof raw.adapter_type !== 'string' ||
      typeof raw.name !== 'string' ||
      typeof raw.pay_request_url !== 'string' ||
      typeof raw.pay_callback !== 'string' ||
      typeof raw.default_payment_method !== 'string' ||
      typeof raw.environment !== 'string' ||
      typeof raw.is_enabled !== 'boolean' ||
      typeof raw.routing_weight !== 'number' ||
      !Number.isInteger(raw.routing_weight) ||
      typeof raw.version !== 'number' ||
      typeof raw.created_at !== 'string' ||
      typeof raw.updated_at !== 'string' ||
      archivedAt === undefined ||
      currentVersionId === undefined
    ) {
      continue
    }
    parsed.push({
      id: raw.id,
      channel_code: raw.channel_code,
      provider_id: raw.provider_id,
      adapter_type: raw.adapter_type,
      name: raw.name,
      pay_request_url: raw.pay_request_url,
      pay_callback: raw.pay_callback,
      default_payment_method: raw.default_payment_method,
      environment: raw.environment,
      is_enabled: raw.is_enabled,
      routing_weight: raw.routing_weight,
      current_version_id: currentVersionId,
      archived_at: archivedAt,
      version: raw.version,
      created_at: raw.created_at,
      updated_at: raw.updated_at,
    })
  }
  return parsed
}

function parseVersionSummary(value: unknown): PaymentMerchantVersionSummary | null {
  if (value === null) {
    return null
  }
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.version_no !== 'number' ||
    typeof value.config_digest !== 'string' ||
    typeof value.created_at !== 'string'
  ) {
    return null
  }
  const validatedAt = optionalString(value.validated_at)
  return validatedAt === undefined
    ? null
    : {
        id: value.id,
        version_no: value.version_no,
        config_digest: value.config_digest,
        validated_at: validatedAt,
        created_at: value.created_at,
      }
}

/** 防御性解析 GET /v1/admin/payment-gateways/channels/{id}/merchants 响应 */
export function parseMerchantList(value: unknown): PaymentMerchantView[] {
  if (!isRecord(value) || !Array.isArray(value.merchants)) {
    return []
  }
  const parsed: PaymentMerchantView[] = []
  for (const raw of value.merchants) {
    if (!isRecord(raw)) {
      continue
    }
    if (
      typeof raw.id !== 'string' ||
      typeof raw.channel_id !== 'string' ||
      typeof raw.name !== 'string' ||
      typeof raw.merchant_number !== 'string' ||
      typeof raw.alipay_number !== 'string' ||
      typeof raw.wechatpay_number !== 'string' ||
      typeof raw.status !== 'string' ||
      typeof raw.version !== 'number' ||
      typeof raw.created_at !== 'string' ||
      typeof raw.updated_at !== 'string'
    ) {
      continue
    }
    parsed.push({
      id: raw.id,
      channel_id: raw.channel_id,
      name: raw.name,
      merchant_number: raw.merchant_number,
      alipay_number: raw.alipay_number,
      wechatpay_number: raw.wechatpay_number,
      status: raw.status,
      ready_version: parseVersionSummary(raw.ready_version),
      version: raw.version,
      created_at: raw.created_at,
      updated_at: raw.updated_at,
    })
  }
  return parsed
}

// ---- US-024：配置表单（适配器 schema 解析 + 输入校验 + 提交载荷） ----

/** 适配器脱敏配置 schema 字段（GET adapter-types，FR-053；kind ∈ string|url|secret|int） */
export interface PaymentConfigFieldSchema {
  key: string
  label: string
  kind: string
  required: boolean
  secret: boolean
  description: string
}

/** 适配器脱敏自描述（商户版本表单按 config_schema 动态渲染字段） */
export interface PaymentAdapterTypeView {
  provider: string
  callbackMethods: string[]
  supportedCurrencies: string[]
  configSchema: PaymentConfigFieldSchema[]
}

/** 防御性解析 GET /v1/admin/payment-gateways/adapter-types 响应：丢弃不合格行 */
export function parseAdapterTypeList(value: unknown): PaymentAdapterTypeView[] {
  if (!isRecord(value) || !Array.isArray(value.adapter_types)) {
    return []
  }
  const parsed: PaymentAdapterTypeView[] = []
  for (const raw of value.adapter_types) {
    if (!isRecord(raw) || typeof raw.provider !== 'string' || !Array.isArray(raw.config_schema)) {
      continue
    }
    const capabilities = isRecord(raw.capabilities) ? raw.capabilities : {}
    const methods = Array.isArray(capabilities.callback_methods)
      ? capabilities.callback_methods.filter((m): m is string => typeof m === 'string')
      : []
    const currencies = Array.isArray(capabilities.supported_currencies)
      ? capabilities.supported_currencies.filter((c): c is string => typeof c === 'string')
      : []
    const schema: PaymentConfigFieldSchema[] = []
    for (const field of raw.config_schema) {
      if (
        !isRecord(field) ||
        typeof field.key !== 'string' ||
        typeof field.label !== 'string' ||
        typeof field.kind !== 'string' ||
        typeof field.required !== 'boolean' ||
        typeof field.secret !== 'boolean' ||
        typeof field.description !== 'string'
      ) {
        continue
      }
      schema.push({
        key: field.key,
        label: field.label,
        kind: field.kind,
        required: field.required,
        secret: field.secret,
        description: field.description,
      })
    }
    parsed.push({
      provider: raw.provider,
      callbackMethods: methods,
      supportedCurrencies: currencies,
      configSchema: schema,
    })
  }
  return parsed
}

/** 渠道适配器的配置 schema（未注册适配器返回 null，表单侧提示不可配置） */
export function adapterSchemaFor(
  adapterTypes: PaymentAdapterTypeView[],
  adapterType: string,
): PaymentConfigFieldSchema[] | null {
  const found = adapterTypes.find((a) => a.provider === adapterType)
  return found === undefined ? null : found.configSchema
}

/** 商户版本脱敏配置字段（FR-058：Secret 字段 value 为「摘要…末尾指纹」） */
export interface PaymentMaskedConfigField {
  key: string
  value: string
  secret: boolean
}

/** 商户版本完整读模型（GET merchants/{id}/versions；无任何凭据原文） */
export interface PaymentMerchantVersionView {
  id: string
  merchantId: string
  versionNo: number
  /** PENDING / READY / INVALID / RETIRED */
  status: string
  callbackKey: string
  /** 服务端按渠道回调入口 + callback_key 组装的完整可复制回调地址；入口缺失为空 */
  callbackUrl: string
  configDigest: string
  config: PaymentMaskedConfigField[]
  validatedAt: string | null
  createdAt: string
}

/** 防御性解析 GET /v1/admin/payment-gateways/merchants/{id}/versions 响应 */
export function parseVersionList(value: unknown): PaymentMerchantVersionView[] {
  if (!isRecord(value) || !Array.isArray(value.versions)) {
    return []
  }
  const parsed: PaymentMerchantVersionView[] = []
  for (const raw of value.versions) {
    if (!isRecord(raw)) {
      continue
    }
    const validatedAt = optionalString(raw.validated_at)
    const config: PaymentMaskedConfigField[] = []
    if (Array.isArray(raw.config)) {
      for (const field of raw.config) {
        if (
          isRecord(field) &&
          typeof field.key === 'string' &&
          typeof field.value === 'string' &&
          typeof field.secret === 'boolean'
        ) {
          config.push({ key: field.key, value: field.value, secret: field.secret })
        }
      }
    }
    if (
      typeof raw.id !== 'string' ||
      typeof raw.merchant_id !== 'string' ||
      typeof raw.version_no !== 'number' ||
      typeof raw.status !== 'string' ||
      typeof raw.callback_key !== 'string' ||
      typeof raw.callback_url !== 'string' ||
      typeof raw.config_digest !== 'string' ||
      typeof raw.created_at !== 'string' ||
      validatedAt === undefined
    ) {
      continue
    }
    parsed.push({
      id: raw.id,
      merchantId: raw.merchant_id,
      versionNo: raw.version_no,
      status: raw.status,
      callbackKey: raw.callback_key,
      callbackUrl: raw.callback_url,
      configDigest: raw.config_digest,
      config,
      validatedAt,
      createdAt: raw.created_at,
    })
  }
  return parsed
}

/** 渠道代码校验：必填且最多 64 字符（服务端同口径，Trim 后判定） */
export function validateChannelCode(code: string): string | null {
  const value = code.trim()
  if (value === '') {
    return '请填写渠道代码'
  }
  if ([...value].length > 64) {
    return '渠道代码不得超过 64 个字符'
  }
  return null
}

/** 环境校验：必填且最多 64 字符 */
export function validateEnvironment(environment: string): string | null {
  const value = environment.trim()
  if (value === '') {
    return '请填写环境（例如 PROD / TEST）'
  }
  if ([...value].length > 64) {
    return '环境不得超过 64 个字符'
  }
  return null
}

/** 整数权重校验：0..10000 的正则可解析整数（禁止小数、负数与溢界） */
export function validateRoutingWeight(weight: string): string | null {
  const value = weight.trim()
  if (value === '') {
    return '请填写路由权重'
  }
  if (!/^\d+$/.test(value)) {
    return '权重必须是整数（禁止小数或负数）'
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10000) {
    return '权重必须在 0..10000 之间'
  }
  return null
}

/** 商户名称校验：必填且最多 200 字符 */
export function validateMerchantName(name: string): string | null {
  const value = name.trim()
  if (value === '') {
    return '请填写商户名称'
  }
  if ([...value].length > 200) {
    return '商户名称不得超过 200 个字符'
  }
  return null
}

/** 渠道展示名：可选、最多 200 字符（留空由服务端回退渠道代码） */
export function validateChannelName(name: string): string | null {
  if ([...name.trim()].length > 200) {
    return '渠道展示名不得超过 200 个字符'
  }
  return null
}

/** 完整下单地址：可选，填写时必须是完整 http(s) 地址（含路径，不重复拼接） */
export function validatePayRequestURL(value: string): string | null {
  const url = value.trim()
  if (url === '') {
    return null
  }
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '下单地址必须是 http(s) 完整地址'
    }
    if (parsed.pathname === '/' || parsed.pathname === '') {
      return '下单地址必须包含完整路径（服务端不再拼接路径）'
    }
  } catch {
    return '下单地址必须是合法完整地址'
  }
  return null
}

/**
 * 回调入口：可选，填写时必须是本站 https 入口（origin 或含回调路由的地址）。
 * 完整回调地址由服务端在版本提交时绑定 callback_key 组装，无需手工拼接。
 */
export function validatePayCallback(value: string): string | null {
  const url = value.trim()
  if (url === '') {
    return null
  }
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.search !== '' || parsed.hash !== '') {
      return '回调入口必须是本站 HTTPS 地址'
    }
    let path = parsed.pathname.replace(/\/$/, '')
    try {
      path = decodeURIComponent(path)
    } catch {
      return '回调入口必须是合法 HTTPS 地址'
    }
    if (path !== '' && path !== '/v1/payments/webhooks' && path !== '/v1/payments/webhooks/{callback_key}') {
      return '回调入口路径必须是 /v1/payments/webhooks'
    }
  } catch {
    return '回调入口必须是合法 HTTPS 地址'
  }
  return null
}

/** 默认支付方式：空（未定）或 ALIPAY / WECHAT */
export function validateDefaultPaymentMethod(value: string): string | null {
  if (value !== '' && value !== 'ALIPAY' && value !== 'WECHAT') {
    return '默认支付方式只能是 ALIPAY 或 WECHAT'
  }
  return null
}

/** 商户编码字段校验：可选、字符串、≤200 字符、保留前导零（只禁控制字符） */
export function validateMerchantCode(value: string, label: string): string | null {
  if (value.length > 200 || /[\r\n\x00]/.test(value)) {
    return `${label}不得超过 200 个字符且不能包含换行`
  }
  return null
}

/**
 * 商户版本凭据校验：schema 必填字段不得为空（提交前提示）；
 * 值格式（URL / RSA 密钥等）由服务端适配器 ValidateConfig 终审。
 */
export function validateCredentialValues(
  schema: PaymentConfigFieldSchema[],
  values: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of schema) {
    if (field.required && (values[field.key] ?? '').trim() === '') {
      errors[field.key] = `请填写${field.label}（必填）`
    }
  }
  return errors
}

/**
 * 构造提交凭据载荷：Trim 后丢弃空值（可选字段留空不提交，
 * 服务端密封前同样剔除空可选值）；键集由动态表单限定，不会出现未知键。
 */
export function credentialPayload(
  schema: PaymentConfigFieldSchema[],
  values: Record<string, string>,
): Record<string, string> {
  const payload: Record<string, string> = {}
  for (const field of schema) {
    const value = (values[field.key] ?? '').trim()
    if (value !== '') {
      payload[field.key] = value
    }
  }
  return payload
}

// ---- US-025：危险操作确认对话框（停用 / 归档 / 凭据变更） ----

/** 危险操作（均经 ConfirmDialog：目标 + 影响 + 必填原因 + 强认证提权重试） */
export type PaymentDangerousAction =
  | { kind: 'disable-channel'; channelCode: string; adapterType: string }
  | { kind: 'archive-channel'; channelCode: string; adapterType: string }
  | { kind: 'enable-merchant' | 'disable-merchant'; merchantName: string }
  | { kind: 'validate-version' | 'retire-version'; merchantName: string; versionNo: number }
  | { kind: 'submit-version'; merchantName: string }

/** ConfirmDialog 展示合同（与 MembershipPlansPage 的 confirmDialogSpec 同形） */
export interface PaymentDialogSpec {
  title: string
  target: string
  impact: string
  confirmLabel: string
}

/** 危险操作 → 确认对话框展示（目标 / 影响 / 确认按钮文案） */
export function dangerousActionDialogSpec(action: PaymentDangerousAction): PaymentDialogSpec {
  switch (action.kind) {
    case 'disable-channel':
      return {
        title: '停用渠道',
        target: `渠道 ${action.channelCode}（${action.adapterType}）`,
        impact:
          '停用后该渠道立即退出新支付路由；历史渠道腿继续按原绑定接收回调与查单。之后可随时重新启用。',
        confirmLabel: '确认停用',
      }
    case 'archive-channel':
      return {
        title: '归档渠道',
        target: `渠道 ${action.channelCode}（${action.adapterType}）`,
        impact:
          '归档后渠道强制停用、配置列永久冻结且不可恢复；历史渠道腿继续按原绑定接收回调与查单。',
        confirmLabel: '确认归档',
      }
    case 'enable-merchant':
      return {
        title: '启用商户',
        target: `商户 ${action.merchantName}`,
        impact: '启用后该商户的 READY 版本成为渠道路由候选（同一渠道最多一个启用商户）。',
        confirmLabel: '确认启用',
      }
    case 'disable-merchant':
      return {
        title: '停用商户',
        target: `商户 ${action.merchantName}`,
        impact: '停用后该商户不再参与新支付路由；已绑定历史渠道腿不受影响。',
        confirmLabel: '确认停用',
      }
    case 'validate-version':
      return {
        title: `校验凭据版本 v${action.versionNo}`,
        target: `商户 ${action.merchantName} 的版本 v${action.versionNo}`,
        impact:
          '执行适配器 ValidateConfig：通过则版本转为 READY 并可作为路由候选；失败则保存为 INVALID（须提交新版本），旧 READY 版本继续服务。',
        confirmLabel: '确认校验',
      }
    case 'retire-version':
      return {
        title: `退休凭据版本 v${action.versionNo}`,
        target: `商户 ${action.merchantName} 的版本 v${action.versionNo}`,
        impact: '退休后该版本不可再被启用；历史渠道腿继续按该版本绑定接收回调与查单。',
        confirmLabel: '确认退休',
      }
    case 'submit-version':
      return {
        title: '提交新凭据版本',
        target: `商户 ${action.merchantName}`,
        impact:
          '凭据将密封加密保存为不可变的新版本（PENDING），页面不回显任何 Secret；须再执行「校验版本」通过后方可用于路由。',
        confirmLabel: '确认提交',
      }
  }
}
