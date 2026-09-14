/*
 * /settings/payment-gateways 支付网关管理（US-023 渠道概览 + US-024 渠道与
 * 商户配置表单 + US-025 危险操作强认证确认；SUPER_ADMIN 与
 * SUPPORT_OPERATOR 可读——服务端校验仍是唯一依据，其他角色 403）：
 *
 * - 渠道列表：Provider、渠道代码、环境、启用状态、当前 READY 商户版本
 *   （启用商户的 ready_version，数据源 GET /channels/{id}/merchants）、
 *   权重与归一化占比（weight/total_weight，total 只统计参与路由的渠道）；
 * - 渠道表单（仅 SUPER_ADMIN 渲染）：创建（适配器 / 代码 / 环境 / 整数
 *   权重 0..10000 输入校验）与编辑（环境 / 启用状态 / 权重 + 乐观锁
 *   expected_version）；
 * - 危险操作（US-025，FR-060 复用现有 ConfirmDialog）：渠道停用 / 归档、
 *   商户启停、凭据版本提交 / 校验 / 退休均经确认对话框（目标 + 影响 +
 *   必填原因）；STRONG_AUTH_REQUIRED 自动进入提权步骤（近期密码 + TOTP），
 *   验证成功后重试原请求；展示文案来自 lib/paygateway 的
 *   dangerousActionDialogSpec；
 * - 商户版本表单按 adapter-types 返回的脱敏 schema 动态渲染字段
 *   （FlrqfPay / PeqoraPay / mock 各自字段集），Secret 输入框只在提交时
 *   接收、永不回显或预填（FR-058）；版本校验（PENDING→READY|INVALID）
 *   与版本切换（退休旧 READY → 校验新版本）均有加载 / 成功 / 错误状态；
 * - 版本冲突（PAYMENT_CONFIG_VERSION_CONFLICT）展示专属文案并自动刷新
 *   列表；
 * - SUPPORT_OPERATOR 只读：不渲染任何写入口，并展示 403 越权提示
 *   （服务端对越权写请求返回 FORBIDDEN 并写安全审计）；
 * - 全部数据是服务端脱敏读模型；纯逻辑在 lib/paygateway.ts。
 */
import { useCallback, useEffect, useState } from 'react'
import { ApiError, apiRequest, messageForApiError } from '../lib/api.ts'
import { validateReason } from '../lib/content.ts'
import { formatDateTimeKL } from '../lib/format.ts'
import { useAdminSession } from '../lib/session.tsx'
import { Alert, SubmitButton } from '../components/ui.tsx'
import { ConfirmDialog } from '../components/ConfirmDialog.tsx'
import {
  adapterSchemaFor,
  buildChannelRows,
  credentialPayload,
  dangerousActionDialogSpec,
  formatSharePercent,
  parseAdapterTypeList,
  parseChannelList,
  parseMerchantList,
  parseProviderList,
  parseVersionList,
  shortDigest,
  validateChannelCode,
  validateChannelName,
  validateCredentialValues,
  validateDefaultPaymentMethod,
  validateEnvironment,
  validateMerchantCode,
  validateMerchantName,
  validatePayCallback,
  validatePayRequestURL,
  validateRoutingWeight,
  type PaymentAdapterTypeView,
  type PaymentChannelRow,
  type PaymentChannelView,
  type PaymentConfigFieldSchema,
  type PaymentMerchantVersionView,
  type PaymentMerchantView,
  type PaymentProviderView,
} from '../lib/paygateway.ts'

type ListPhase = 'loading' | 'ready' | 'error'

const lifecycleText: Record<PaymentChannelRow['lifecycle'], string> = {
  enabled: '启用',
  disabled: '停用',
  archived: '已归档',
}

function lifecycleTagClass(lifecycle: PaymentChannelRow['lifecycle']): string {
  switch (lifecycle) {
    case 'enabled':
      return 'tag tag--published'
    case 'disabled':
      return 'tag tag--draft'
    case 'archived':
      return 'tag tag--unpublished'
  }
}

/** 商户版本状态展示（与迁移 0016 CHECK 取值域一致） */
function versionStatusTagClass(status: string): string {
  switch (status) {
    case 'READY':
      return 'tag tag--published'
    case 'PENDING':
      return 'tag tag--draft'
    case 'INVALID':
      return 'tag tag--unpublished'
    default:
      return 'tag'
  }
}

const versionStatusText: Record<string, string> = {
  PENDING: '待校验',
  READY: '已就绪',
  INVALID: '校验失败',
  RETIRED: '已退休',
}

function adapterMark(provider: string): string {
  const normalized = provider.replace(/[^a-z0-9]/gi, '')
  return (normalized.slice(0, 2) || 'PG').toUpperCase()
}

function GatewayMetric({
  label,
  value,
  detail,
  tone = 'gold',
}: {
  label: string
  value: string | number
  detail: string
  tone?: 'gold' | 'green' | 'muted' | 'red'
}) {
  return (
    <article className={`gateway-metric gateway-metric--${tone}`}>
      <div className="gateway-metric__label">{label}</div>
      <strong className="gateway-metric__value">{value}</strong>
      <span className="gateway-metric__detail">{detail}</span>
    </article>
  )
}

function GatewaySignal({ state, label }: { state: 'loading' | 'ready' | 'degraded' | 'paused'; label: string }) {
  return (
    <div className={`gateway-signal gateway-signal--${state}`}>
      <span className="gateway-signal__dot" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function PaymentGatewaysPage() {
  const { state } = useAdminSession()
  const readOnly = state.status === 'authed' && !state.admin.roles.includes('SUPER_ADMIN')
  const csrfToken = state.status === 'authed' ? state.csrfToken : ''

  const [rows, setRows] = useState<PaymentChannelRow[]>([])
  /** 商户列表拉取失败的渠道（版本列显示查询失败，不误报「未就绪」） */
  const [failedChannels, setFailedChannels] = useState<string[]>([])
  /** 渠道 → 商户列表（配置面板与就绪推导共用同一份数据） */
  const [merchantsByChannel, setMerchantsByChannel] = useState<Record<string, PaymentMerchantView[]>>({})
  const [adapterTypes, setAdapterTypes] = useState<PaymentAdapterTypeView[]>([])
  /** 三级配置 Provider 层（渠道创建时绑定；协议绑定不可变） */
  const [providers, setProviders] = useState<PaymentProviderView[]>([])
  const [phase, setPhase] = useState<ListPhase>('loading')
  const [loadError, setLoadError] = useState('')
  const [noPermission, setNoPermission] = useState(false)
  /** 页面级成功提示（表单重载会重挂载，成功态放页面层才能持续展示） */
  const [notice, setNotice] = useState<string | null>(null)
  /** 页面级错误提示（版本冲突自动重载会重挂载表单，错误态放页面层） */
  const [pageError, setPageError] = useState<string | null>(null)
  const notify = useCallback((message: string) => {
    setNotice(message)
    setPageError(null)
  }, [])
  const notifyError = useCallback((message: string) => {
    setPageError(message)
    setNotice(null)
  }, [])
  /** 展开配置面板的渠道 */
  const [openChannelId, setOpenChannelId] = useState<string | null>(null)
  /** 正在提交启停切换的渠道 */
  const [togglingChannelId, setTogglingChannelId] = useState<string | null>(null)
  /** 新建渠道抽屉（默认收起，避免创建表单长期占据首屏） */
  const [createOpen, setCreateOpen] = useState(false)
  const [providerOpen, setProviderOpen] = useState(false)
  const [merchantOpen, setMerchantOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  /** 渠道列表筛选（本地视图状态，不改变服务端读模型） */
  const [keyword, setKeyword] = useState('')
  const [lifecycleFilter, setLifecycleFilter] = useState<'all' | PaymentChannelRow['lifecycle']>('all')


  const reload = useCallback(async () => {
    setPhase('loading')
    try {
      const [channelsRes, adaptersRes, providersRes] = await Promise.all([
        apiRequest<unknown>({
          method: 'GET',
          path: '/v1/admin/payment-gateways/channels',
        }),
        // 适配器自描述失败不阻塞渠道概览（创建表单会提示不可用）
        apiRequest<unknown>({
          method: 'GET',
          path: '/v1/admin/payment-gateways/adapter-types',
        }).catch(() => null),
        apiRequest<unknown>({
          method: 'GET',
          path: '/v1/admin/payment-gateways/providers',
        }).catch(() => null),
      ])
      const channels = parseChannelList(channelsRes.data)
      setAdapterTypes(adaptersRes === null ? [] : parseAdapterTypeList(adaptersRes.data))
      setProviders(providersRes === null ? [] : parseProviderList(providersRes.data))
      // 每渠道拉商户列表取「当前 READY 商户版本」（渠道列表合同不含该字段）；
      // 单渠道失败不阻塞概览，对应行版本列显示查询失败。
      const merchants: Record<string, PaymentMerchantView[]> = {}
      const failed: string[] = []
      await Promise.all(
        channels.map(async (channel) => {
          try {
            const res = await apiRequest<unknown>({
              method: 'GET',
              path: `/v1/admin/payment-gateways/channels/${channel.id}/merchants`,
            })
            merchants[channel.id] = parseMerchantList(res.data)
          } catch {
            failed.push(channel.id)
          }
        }),
      )
      setFailedChannels(failed)
      setMerchantsByChannel(merchants)
      setRows(buildChannelRows(channels, merchants))
      setNoPermission(false)
      setLoadError('')
      setPhase('ready')
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'FORBIDDEN' || err.status === 403)) {
        setNoPermission(true)
        setPhase('ready')
        return
      }
      setLoadError(messageForApiError(err))
      setPhase('error')
    }
  }, [])

  /** 渠道卡片上的启用 / 停用快捷切换（PATCH 带 expected_version 乐观锁 + 审计原因） */
  const toggleChannelEnabled = useCallback(
    async (row: PaymentChannelRow) => {
      const channel = row.channel
      const nextEnabled = !channel.is_enabled
      setTogglingChannelId(channel.id)
      try {
        await apiRequest({
          method: 'PATCH',
          path: '/v1/admin/payment-gateways/channels',
          body: {
            channel_id: channel.id,
            expected_version: channel.version,
            environment: channel.environment,
            is_enabled: nextEnabled,
            routing_weight: channel.routing_weight,
            name: channel.name,
            pay_request_url: channel.pay_request_url,
            pay_callback: channel.pay_callback,
            default_payment_method: channel.default_payment_method,
            reason: nextEnabled ? '渠道列表快捷启用' : '渠道列表快捷停用',
          },
          csrfToken,
        })
        notify(
          nextEnabled
            ? `渠道「${channel.channel_code}」已启用并重新参与路由`
            : `渠道「${channel.channel_code}」已停用：只摘除新支付路由，历史渠道腿继续接收回调与查单`,
        )
        await reload()
      } catch (err) {
        if (err instanceof ApiError && err.code === 'PAYMENT_CONFIG_VERSION_CONFLICT') {
          await reload()
          notifyError('渠道配置已被其他管理员修改，列表已刷新；请基于最新版本重试')
          return
        }
        notifyError(messageForApiError(err))
      } finally {
        setTogglingChannelId(null)
      }
    },
    [csrfToken, notify, notifyError, reload],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  if (noPermission) {
    return (
      <section className="page" data-testid="no-permission">
        <h1 className="page__title">无访问权限</h1>
        <p className="page__desc">支付网关管理仅超级管理员与客服可读，当前角色没有访问该页面的权限。</p>
      </section>
    )
  }

  const openRow = openChannelId === null ? null : (rows.find((row) => row.channel.id === openChannelId) ?? null)
  const enabledRows = rows.filter((row) => row.lifecycle === 'enabled')
  const weightedRows = rows.filter((row) => row.sharePercent !== null)
  const eligibleRows = weightedRows.filter((row) => row.ready !== null)
  const readyRows = rows.filter((row) => row.ready !== null)
  const notReadyRows = rows.filter((row) => row.notReady)
  const merchantCount = Object.values(merchantsByChannel).reduce((sum, merchants) => sum + merchants.length, 0)
  const routeWeight = weightedRows.reduce((sum, row) => sum + row.channel.routing_weight, 0)
  const signalState: 'loading' | 'ready' | 'degraded' | 'paused' =
    phase === 'loading' ? 'loading' : eligibleRows.length === 0 ? 'paused' : notReadyRows.length > 0 ? 'degraded' : 'ready'
  const signalLabel =
    signalState === 'loading'
      ? '同步配置中'
      : signalState === 'ready'
        ? '路由可用'
        : signalState === 'degraded'
          ? '存在未就绪渠道'
          : '暂无可用路由'

  // 列表筛选只作用于展示，摘要指标始终反映服务端返回的全量渠道
  const normalizedKeyword = keyword.trim().toLowerCase()
  const visibleRows = rows.filter((row) => {
    if (lifecycleFilter !== 'all' && row.lifecycle !== lifecycleFilter) {
      return false
    }
    if (normalizedKeyword === '') {
      return true
    }
    return `${row.channel.channel_code} ${row.channel.adapter_type} ${row.channel.environment}`
      .toLowerCase()
      .includes(normalizedKeyword)
  })
  const filters: { key: 'all' | PaymentChannelRow['lifecycle']; label: string; count: number }[] = [
    { key: 'all', label: '全部', count: rows.length },
    { key: 'enabled', label: '启用', count: enabledRows.length },
    { key: 'disabled', label: '停用', count: rows.filter((row) => row.lifecycle === 'disabled').length },
    { key: 'archived', label: '已归档', count: rows.filter((row) => row.lifecycle === 'archived').length },
  ]
  const merchantEntries = Object.entries(merchantsByChannel).flatMap(([channelId, merchants]) =>
    merchants.map((merchant) => ({ merchant, channel: rows.find((row) => row.channel.id === channelId)?.channel ?? null })),
  )

  return (
    <section className="gateway-page gateway-reference" data-testid="payment-gateways-page">
      <div className={`gateway-admin-shell${sidebarOpen ? ' sidebar-open' : ''}`}>
        <aside className="gateway-sidebar" aria-label="后台导航">
          <div className="gateway-sidebar__brand"><span>VB</span><strong>VideoBot</strong></div>
          <nav>
            <a href="#summary"><span aria-hidden="true">⌂</span>工作台</a>
            <a href="#summary"><span aria-hidden="true">▦</span>订单管理</a>
            <a href="#providers" className="is-active"><span aria-hidden="true">◇</span>支付管理</a>
            <a href="#merchants"><span aria-hidden="true">◎</span>商户配置</a>
            <a href="#channels"><span aria-hidden="true">⇄</span>渠道路由</a>
          </nav>
          <div className="gateway-sidebar__user"><span>SA</span><div><strong>超级管理员</strong><small>SUPER_ADMIN</small></div></div>
        </aside>
        {sidebarOpen ? <button className="gateway-sidebar-scrim" type="button" aria-label="关闭导航" onClick={() => setSidebarOpen(false)} /> : null}

        <main className="gateway-reference__main">
          <header className="gateway-reference__topbar">
            <button type="button" className="gateway-mobile-menu" aria-label="打开导航" onClick={() => setSidebarOpen(true)}>☰</button>
            <div><span>支付管理</span><b>/</b><strong>支付网关配置</strong></div>
            <div className="gateway-topbar-status"><GatewaySignal state={signalState} label={signalLabel} /><button type="button" onClick={() => void reload()} disabled={phase === 'loading'} aria-label="刷新配置">↻</button></div>
          </header>

          <div className="gateway-reference__content">
            <div className="gateway-reference__heading" id="summary">
              <div><p>PAYMENT GATEWAY MANAGEMENT</p><h1>支付接入配置</h1><span>统一管理 Provider、商户凭据与渠道流量分配</span></div>
              <div className="gateway-reference__security"><span>●</span> 强认证保护 · Secret 永不回显</div>
            </div>

            <div className="gateway-statstrip" aria-label="支付网关摘要">
              <GatewayMetric label="已登记 Provider" value={providers.length.toString().padStart(2, '0')} detail={`${adapterTypes.length} 个适配器已注册`} tone="gold" />
              <GatewayMetric label="支付商户" value={merchantCount.toString().padStart(2, '0')} detail={`${merchantEntries.filter(({ merchant }) => merchant.status === 'ENABLED').length} 个正在启用`} tone="green" />
              <GatewayMetric label="启用渠道" value={enabledRows.length.toString().padStart(2, '0')} detail={`${weightedRows.length} 个参与路由`} tone="gold" />
              <GatewayMetric label="READY 版本" value={readyRows.length.toString().padStart(2, '0')} detail={notReadyRows.length > 0 ? `${notReadyRows.length} 个渠道待处理` : '全部配置正常'} tone={notReadyRows.length > 0 ? 'red' : 'muted'} />
            </div>

            {notice !== null ? <div className="gateway-notice"><Alert kind="success">{notice}</Alert></div> : null}
            {pageError !== null ? <div className="gateway-notice"><Alert kind="error">{pageError}</Alert></div> : null}

            {readOnly ? <div className="gateway-readonly" data-testid="readonly-forbidden-notice"><span className="gateway-readonly__icon">◌</span><div><strong>只读观察模式</strong><p>当前角色只能查看脱敏配置，写操作需要超级管理员。</p></div><span className="gateway-readonly__lock">SERVER ENFORCED</span></div> : null}

            {phase === 'loading' ? <div className="gateway-state-card gateway-state-card--loading"><div className="gateway-state-card__spinner" /><div><strong>正在同步渠道配置</strong><span>读取 Provider、渠道与商户版本…</span></div></div> : null}

            {phase === 'error' ? <div className="gateway-state-card gateway-state-card--error"><div className="gateway-state-card__icon">!</div><div><strong>配置同步失败</strong><span>{loadError}</span></div><button type="button" className="btn btn--ghost" onClick={() => void reload()}>重新连接</button></div> : null}

            {phase === 'ready' ? <>
              <section className="gateway-reference-section" id="providers">
                <div className="gateway-reference-section__head"><div><p>PROVIDER REGISTRY</p><h2>Provider 列表</h2><span>支付协议与适配器登记</span></div>{!readOnly ? <button type="button" className="btn btn--primary" data-testid="create-provider-toggle" onClick={() => setProviderOpen(true)}>＋ 新增 Provider</button> : null}</div>
                <div className="gateway-provider-grid">
                  {providers.map((provider) => { const bound = rows.filter((row) => row.channel.provider_id === provider.id); return <article className="gateway-provider-card" key={provider.id}><div className="gateway-provider-card__top"><div className={`gateway-provider-mark gateway-provider-mark--${provider.adapter_type}`}>{adapterMark(provider.adapter_type)}</div><div className="gateway-provider-card__id"><strong>{provider.name}</strong><span>{provider.provider_code}</span></div><span className="tag tag--published">已接入</span></div><dl className="gateway-provider-card__meta"><div><dt>适配器类型</dt><dd>{provider.adapter_type}</dd></div><div><dt>支付渠道</dt><dd>{bound.length} 个</dd></div><div><dt>配置版本</dt><dd>v{provider.version}</dd></div></dl><footer><span>更新于 {formatDateTimeKL(provider.updated_at)}</span><button type="button" onClick={() => setLifecycleFilter('all')}>查看详情 →</button></footer></article> })}
                </div>
              </section>

              <section className="gateway-reference-section" id="merchants">
                <div className="gateway-reference-section__head"><div><p>MERCHANT ACCOUNTS</p><h2>支付商户</h2><span>商户号、渠道编码与凭据版本</span></div>{!readOnly ? <button type="button" className="btn btn--primary" data-testid="create-merchant-toggle" onClick={() => setMerchantOpen(true)} disabled={rows.length === 0}>＋ 新增商户</button> : null}</div>
                <div className="gateway-merchant-summary-grid">
                  {merchantEntries.map(({ merchant, channel }) => <article className="gateway-merchant-summary" key={merchant.id}><header><div><strong>{merchant.name}</strong><code>{merchant.merchant_number}</code></div><span className={merchant.status === 'ENABLED' ? 'tag tag--published' : 'tag tag--draft'}>{merchant.status === 'ENABLED' ? '已启用' : '已停用'}</span></header><dl><div><dt>所属渠道</dt><dd>{channel?.name || channel?.channel_code || '—'}</dd></div><div><dt>支付宝编码</dt><dd>{merchant.alipay_number || '—'}</dd></div><div><dt>微信编码</dt><dd>{merchant.wechatpay_number || '—'}</dd></div><div><dt>凭据版本</dt><dd>{merchant.ready_version !== null ? `READY · v${merchant.ready_version.version_no}` : '尚未就绪'}</dd></div></dl><footer><span>{merchant.ready_version !== null ? `摘要 ${shortDigest(merchant.ready_version.config_digest)}` : '需要提交凭据版本'}</span>{!readOnly && channel !== null ? <button type="button" onClick={() => setOpenChannelId(channel.id)}>管理凭据 →</button> : null}</footer></article>)}
                </div>
              </section>

              <section className="gateway-reference-section" id="channels">
                <div className="gateway-reference-section__head gateway-reference-section__head--channels"><div><p>PAYMENT CHANNELS</p><h2>支付渠道</h2><span>渠道状态、支付权重与归一化流量</span></div><div className="gateway-section-actions"><label className="gateway-search"><span>⌕</span><input type="search" value={keyword} data-testid="channel-search" placeholder="搜索渠道" onChange={(event) => setKeyword(event.target.value)} /></label>{!readOnly ? <button type="button" className="btn btn--primary gateway-create-channel-btn" data-testid="create-channel-toggle" onClick={() => setCreateOpen(true)}>＋ 新增渠道</button> : null}</div></div>
                <div className="gateway-filter-chips" role="group" aria-label="按生命周期筛选">{filters.map((filter) => <button key={filter.key} type="button" className={`gateway-chip${lifecycleFilter === filter.key ? ' is-active' : ''}`} aria-pressed={lifecycleFilter === filter.key} onClick={() => setLifecycleFilter(filter.key)}>{filter.label}<em>{filter.count}</em></button>)}</div>
                <div className="gateway-channel-grid" data-testid="payment-channels-table">
                  {visibleRows.map((row) => <article className={`gateway-channel-card is-${row.lifecycle}`} key={row.channel.id} data-testid={`payment-channel-${row.channel.channel_code}`}><header><div className={`gateway-provider-mark gateway-provider-mark--${row.channel.adapter_type}`}>{adapterMark(row.channel.adapter_type)}</div><div><strong>{row.channel.name || row.channel.channel_code}</strong><code>{row.channel.channel_code}</code></div><span className={lifecycleTagClass(row.lifecycle)}>{lifecycleText[row.lifecycle]}</span></header><div className="gateway-channel-facts"><div><span>Provider</span><strong>{row.channel.adapter_type}</strong></div><div><span>运行环境</span><strong>{row.channel.environment}</strong></div><div><span>READY 绑定</span><strong>{row.ready !== null ? `${row.ready.merchantName} · v${row.ready.versionNo}` : failedChannels.includes(row.channel.id) ? '查询失败' : '未就绪'}</strong></div></div><div className="gateway-channel-weight"><div><span>支付权重</span><strong>{row.channel.routing_weight}</strong><em>{row.sharePercent !== null ? `${formatSharePercent(row.sharePercent)} 流量` : '不参与路由'}</em></div><input type="range" min="0" max="10000" value={row.channel.routing_weight} readOnly aria-label={`${row.channel.channel_code} 当前支付权重`} /><small>进入配置后可拖动调整，保存需填写审计原因</small></div><footer><span>配置版本 v{row.channel.version}</span>{!readOnly ? <div className="gateway-channel-card__actions">{row.lifecycle !== 'archived' ? <button type="button" className={`gateway-toggle${row.channel.is_enabled ? ' is-on' : ''}`} role="switch" aria-checked={row.channel.is_enabled} disabled={togglingChannelId === row.channel.id} data-testid={`channel-enable-toggle-${row.channel.channel_code}`} onClick={() => void toggleChannelEnabled(row)}><span className="gateway-toggle__track"><span className="gateway-toggle__knob" /></span><span className="gateway-toggle__label">{togglingChannelId === row.channel.id ? '切换中…' : row.channel.is_enabled ? '已启用' : '已停用'}</span></button> : <span>配置已冻结</span>}<button type="button" className="btn btn--small btn--ghost" data-testid={`channel-config-toggle-${row.channel.channel_code}`} onClick={() => setOpenChannelId(row.channel.id)}>编辑</button></div> : <span>只读</span>}</footer></article>)}
                </div>
              </section>
            </> : null}
          </div>
        </main>
      </div>

      {providerOpen ? <div className="gateway-modal-layer" role="presentation"><div className="gateway-modal" role="dialog" aria-modal="true" aria-label="新增 Provider"><header><div><p>PROVIDER REGISTRY</p><h2>新增 Provider</h2></div><button type="button" aria-label="关闭" onClick={() => setProviderOpen(false)}>×</button></header><form className="form" onSubmit={(event) => { event.preventDefault(); setProviderOpen(false); notify('Provider 登记由后端配置流程完成') }}><div className="form__field"><label className="form__label" htmlFor="provider-code">Provider 编码</label><input id="provider-code" placeholder="例如：flrqfpay" /></div><div className="form__field"><label className="form__label" htmlFor="provider-name">Provider 名称</label><input id="provider-name" placeholder="例如：FlrqfPay" /></div><div className="form__field"><label className="form__label" htmlFor="provider-note">接入说明</label><textarea id="provider-note" rows={4} placeholder="填写支付协议、回调方式与接入注意事项" /></div><div className="gateway-modal__note">Provider 协议绑定创建后不可变，正式登记由服务端配置流程完成。</div><div className="gateway-modal__actions"><button type="button" className="btn btn--ghost" onClick={() => setProviderOpen(false)}>取消</button><button type="submit" className="btn btn--primary">确认登记</button></div></form></div></div> : null}

      {merchantOpen && rows[0] !== undefined ? <div className="gateway-modal-layer" role="presentation"><div className="gateway-modal gateway-modal--wide" role="dialog" aria-modal="true" aria-label="新增支付商户"><header><div><p>MERCHANT ACCOUNT</p><h2>新增支付商户</h2></div><button type="button" aria-label="关闭" onClick={() => setMerchantOpen(false)}>×</button></header><CreateMerchantForm channelId={rows[0].channel.id} csrfToken={csrfToken} reload={reload} notify={notify} /></div></div> : null}

      {createOpen ? <div className="gateway-modal-layer" role="presentation"><div className="gateway-modal gateway-modal--wide" role="dialog" aria-modal="true" aria-label="新增支付渠道"><header><div><p>PAYMENT CHANNEL</p><h2>新增支付渠道</h2></div><button type="button" aria-label="关闭" onClick={() => setCreateOpen(false)}>×</button></header><CreateChannelForm providers={providers} csrfToken={csrfToken} reload={reload} notify={notify} /></div></div> : null}

      {openRow !== null && !readOnly ? <div className="gateway-modal-layer" role="presentation"><div className="gateway-modal gateway-modal--wide" role="dialog" aria-modal="true" aria-label={`${openRow.channel.channel_code} 渠道配置`}><header><div><p>CHANNEL CONFIGURATION</p><h2>{openRow.channel.name || openRow.channel.channel_code}</h2></div><button type="button" aria-label="关闭" onClick={() => setOpenChannelId(null)}>×</button></header><ChannelConfigPanel key={`${openRow.channel.id}:${openRow.channel.version}`} row={openRow} adapterTypes={adapterTypes} csrfToken={csrfToken} reload={reload} notify={notify} notifyError={notifyError} /></div></div> : null}

    </section>
  )
}

// ---- 创建渠道（三级配置：Provider 绑定 + 完整下单地址 + 回调入口 + 默认方式） ----

interface CreateChannelFormProps {
  providers: PaymentProviderView[]
  csrfToken: string
  reload: () => Promise<void>
  notify: (message: string) => void
}

type ChannelFormErrors = Partial<Record<'adapter_type' | 'channel_code' | 'name' | 'pay_request_url' | 'pay_callback' | 'default_payment_method' | 'environment' | 'routing_weight' | 'reason', string | null>>

function CreateChannelForm({ providers, csrfToken, reload, notify }: CreateChannelFormProps) {
  const [providerID, setProviderID] = useState(providers[0]?.id ?? '')
  const [channelCode, setChannelCode] = useState('')
  const [channelName, setChannelName] = useState('')
  const [payRequestURL, setPayRequestURL] = useState('')
  const [payCallback, setPayCallback] = useState('')
  const [defaultMethod, setDefaultMethod] = useState('')
  const [environment, setEnvironment] = useState('')
  const [routingWeight, setRoutingWeight] = useState('100')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<ChannelFormErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selectedProvider = providers.find((p) => p.id === providerID) ?? null

  const submit = async () => {
    setServerError(null)
    const next: ChannelFormErrors = {
      adapter_type: providerID === '' ? '请选择 Provider（可先在下方登记）' : null,
      channel_code: validateChannelCode(channelCode),
      name: validateChannelName(channelName),
      pay_request_url: validatePayRequestURL(payRequestURL),
      pay_callback: validatePayCallback(payCallback),
      default_payment_method: validateDefaultPaymentMethod(defaultMethod),
      environment: validateEnvironment(environment),
      routing_weight: validateRoutingWeight(routingWeight),
      reason: validateReason(reason),
    }
    for (const key of Object.keys(next) as (keyof ChannelFormErrors)[]) {
      if (next[key] === null || next[key] === undefined) {
        delete next[key]
      }
    }
    setErrors(next)
    if (Object.keys(next).length > 0) {
      return
    }
    setBusy(true)
    try {
      await apiRequest({
        method: 'POST',
        path: '/v1/admin/payment-gateways/channels',
        body: {
          channel_code: channelCode.trim(),
          provider_id: providerID,
          name: channelName.trim(),
          pay_request_url: payRequestURL.trim(),
          pay_callback: payCallback.trim(),
          default_payment_method: defaultMethod,
          environment: environment.trim(),
          routing_weight: Number(routingWeight.trim()),
          reason: reason.trim(),
        },
        csrfToken,
      })
      const created = channelCode.trim()
      setChannelCode('')
      setChannelName('')
      setPayRequestURL('')
      setPayCallback('')
      setDefaultMethod('')
      setEnvironment('')
      setRoutingWeight('100')
      setReason('')
      notify(`已创建渠道「${created}」（初始为停用状态，配置并校验 READY 商户版本后可启用）`)
      await reload()
    } catch (err) {
      setServerError(messageForApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="card form gateway-create-card"
      data-testid="create-channel-form"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="gateway-form-heading">
        <div>
          <span className="gateway-form-heading__eyebrow">NEW CHANNEL</span>
          <h2 className="card__title">新建渠道</h2>
        </div>
        <span className="gateway-form-heading__state">初始状态 · 停用</span>
      </div>
      {providers.length === 0 ? (
        <Alert kind="info">Provider 清单为空：渠道必须绑定已登记的 Provider；请确认登记流程或刷新页面。</Alert>
      ) : null}
      <div className="form__row gateway-form-grid">
        <div className="form__field">
          <label className="form__label" htmlFor="create-channel-provider">
            Provider（绑定支付协议，创建后不可换绑）
          </label>
          <select
            id="create-channel-provider"
            data-testid="create-channel-provider"
            value={providerID}
            onChange={(event) => setProviderID(event.target.value)}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（{p.provider_code} · {p.adapter_type}）
              </option>
            ))}
          </select>
          {errors.adapter_type !== undefined ? <p className="form__error">{errors.adapter_type}</p> : null}
        </div>
        <div className="form__field">
          <label className="form__label" htmlFor="create-channel-code">
            渠道代码（创建后不可变，全局唯一）
          </label>
          <input
            id="create-channel-code"
            data-testid="create-channel-code"
            value={channelCode}
            placeholder="例如：flrqf_main"
            onChange={(event) => setChannelCode(event.target.value)}
          />
          {errors.channel_code !== undefined ? <p className="form__error">{errors.channel_code}</p> : null}
        </div>
        <div className="form__field">
          <label className="form__label" htmlFor="create-channel-name">
            渠道展示名（可选，留空使用渠道代码）
          </label>
          <input
            id="create-channel-name"
            data-testid="create-channel-name"
            value={channelName}
            placeholder="例如：FlrqfPay 主渠道"
            onChange={(event) => setChannelName(event.target.value)}
          />
          {errors.name !== undefined ? <p className="form__error">{errors.name}</p> : null}
        </div>
        <div className="form__field">
          <label className="form__label" htmlFor="create-channel-request-url">
            完整下单地址 payRequesturl（含路径，不再重复拼接）
          </label>
          <input
            id="create-channel-request-url"
            data-testid="create-channel-request-url"
            value={payRequestURL}
            placeholder={selectedProvider === null ? 'https://provider.example.com/api/pay/create' : `例如：https://provider.example.com/${selectedProvider.adapter_type}/create`}
            onChange={(event) => setPayRequestURL(event.target.value)}
          />
          {errors.pay_request_url !== undefined ? <p className="form__error">{errors.pay_request_url}</p> : null}
        </div>
        <div className="form__field">
          <label className="form__label" htmlFor="create-channel-callback">
            回调入口 payCallback（本站 HTTPS 地址；完整回调地址由服务端按版本自动组装）
          </label>
          <input
            id="create-channel-callback"
            data-testid="create-channel-callback"
            value={payCallback}
            placeholder="例如：https://www.example.com/v1/payments/webhooks"
            onChange={(event) => setPayCallback(event.target.value)}
          />
          {errors.pay_callback !== undefined ? <p className="form__error">{errors.pay_callback}</p> : null}
        </div>
        <div className="form__field">
          <label className="form__label" htmlFor="create-channel-method">
            默认支付方式（决定读取商户的支付宝/微信编码）
          </label>
          <select
            id="create-channel-method"
            data-testid="create-channel-method"
            value={defaultMethod}
            onChange={(event) => setDefaultMethod(event.target.value)}
          >
            <option value="">暂不确定（启用前必须配置）</option>
            <option value="ALIPAY">支付宝（ALIPAY）</option>
            <option value="WECHAT">微信（WECHAT）</option>
          </select>
          {errors.default_payment_method !== undefined ? <p className="form__error">{errors.default_payment_method}</p> : null}
        </div>
        <div className="form__field">
          <label className="form__label" htmlFor="create-channel-environment">
            环境（例如 PROD / TEST，创建后可编辑）
          </label>
          <input
            id="create-channel-environment"
            data-testid="create-channel-environment"
            value={environment}
            placeholder="例如：PROD"
            onChange={(event) => setEnvironment(event.target.value)}
          />
          {errors.environment !== undefined ? <p className="form__error">{errors.environment}</p> : null}
        </div>
        <div className="form__field gateway-weight-field">
          <div className="gateway-weight-field__heading">
            <label className="form__label" htmlFor="create-channel-weight">
              渠道权重
            </label>
            <output className="gateway-weight-field__value" htmlFor="create-channel-weight">
              {routingWeight}
            </output>
          </div>
          <input
            id="create-channel-weight"
            data-testid="create-channel-weight"
            className="gateway-weight-slider"
            type="range"
            min="0"
            max="10000"
            step="1"
            value={routingWeight}
            aria-valuetext={`${routingWeight} / 10000`}
            onChange={(event) => setRoutingWeight(event.target.value)}
          />
          <div className="gateway-weight-field__scale" aria-hidden="true">
            <span>0</span>
            <span>拖动调整路由流量</span>
            <span>10000</span>
          </div>
          {errors.routing_weight !== undefined ? <p className="form__error">{errors.routing_weight}</p> : null}
        </div>
      </div>
      <div className="form__field gateway-form-reason">
        <label className="form__label" htmlFor="create-channel-reason">
          操作原因（必填，将写入审计）
        </label>
        <input
          id="create-channel-reason"
          data-testid="create-channel-reason"
          value={reason}
          placeholder="例如：接入 FlrqfPay 主渠道"
          onChange={(event) => setReason(event.target.value)}
        />
        {errors.reason !== undefined ? <p className="form__error">{errors.reason}</p> : null}
      </div>
      {serverError !== null ? <Alert kind="error">{serverError}</Alert> : null}
      <div className="stack stack--row gateway-form-actions">
        <SubmitButton busy={busy} data-testid="create-channel-submit">
          创建渠道
        </SubmitButton>
      </div>
    </form>
  )
}

// ---- 渠道配置面板：编辑 / 停用 / 商户与版本管理 ----

interface ChannelConfigPanelProps {
  row: PaymentChannelRow
  adapterTypes: PaymentAdapterTypeView[]
  csrfToken: string
  reload: () => Promise<void>
  notify: (message: string) => void
  notifyError: (message: string) => void
}

function ChannelConfigPanel({ row, adapterTypes, csrfToken, reload, notify, notifyError }: ChannelConfigPanelProps) {
  const { refresh } = useAdminSession()
  const channel = row.channel
  const schema = adapterSchemaFor(adapterTypes, channel.adapter_type)
  /** 危险操作目标（US-025：停用 / 归档经 ConfirmDialog + 强认证提权重试） */
  const [channelAction, setChannelAction] = useState<'disable' | 'archive' | null>(null)
  if (row.lifecycle === 'archived') {
      return (
      <section className="card section-card gateway-config-panel" data-testid="channel-config-panel">
        <div className="gateway-config-heading">
          <div><span className="gateway-section__eyebrow">ARCHIVED CHANNEL</span><h2 className="card__title">{channel.channel_code}</h2></div>
          <span className="gateway-config-heading__identity">配置已冻结</span>
        </div>
        <p className="gateway-archive-note">该渠道已归档；历史渠道腿继续按原绑定接收回调与查单，新支付不会再进入此渠道。</p>
      </section>
    )
  }
  return (
    <section className="card section-card gateway-config-panel" data-testid="channel-config-panel">
      <div className="gateway-config-heading">
        <div>
          <span className="gateway-section__eyebrow">CHANNEL CONFIGURATION</span>
          <h2 className="card__title">{channel.channel_code}</h2>
        </div>
        <div className="gateway-config-heading__identity"><code>{channel.adapter_type}</code><span>配置版本 v{channel.version}</span></div>
      </div>

      <EditChannelForm channel={channel} csrfToken={csrfToken} reload={reload} notify={notify} notifyError={notifyError} />

      <div className="stack stack--row gateway-danger-actions">
        {channel.is_enabled ? (
          <button
            type="button"
            className="btn btn--small btn--ghost"
            data-testid="channel-disable"
            onClick={() => setChannelAction('disable')}
          >
            停用渠道…
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--small btn--ghost"
          data-testid="channel-archive"
          onClick={() => setChannelAction('archive')}
        >
          归档渠道…
        </button>
      </div>

      {channelAction !== null ? (
        <ConfirmDialog
          open
          {...dangerousActionDialogSpec({
            kind: channelAction === 'disable' ? 'disable-channel' : 'archive-channel',
            channelCode: channel.channel_code,
            adapterType: channel.adapter_type,
          })}
          csrfToken={csrfToken}
          onClose={() => setChannelAction(null)}
          onEscalated={() => void refresh()}
          run={async (reason) => {
            await apiRequest({
              method: 'POST',
              path: `/v1/admin/payment-gateways/channels/${channel.id}/${channelAction}`,
              body: { expected_version: channel.version, reason },
              csrfToken,
            })
            notify(
              channelAction === 'disable'
                ? '渠道已停用：只摘除新支付路由，历史渠道腿继续接收回调与查单'
                : '渠道已归档，配置列已冻结；历史渠道腿继续按原绑定接收回调与查单',
            )
            await reload()
          }}
        />
      ) : null}

      {channelAction !== null ? (
        <ConfirmDialog
          open
          {...dangerousActionDialogSpec({
            kind: channelAction === 'disable' ? 'disable-channel' : 'archive-channel',
            channelCode: channel.channel_code,
            adapterType: channel.adapter_type,
          })}
          csrfToken={csrfToken}
          onClose={() => setChannelAction(null)}
          onEscalated={() => void refresh()}
          run={async (reason) => {
            await apiRequest({
              method: 'POST',
              path: `/v1/admin/payment-gateways/channels/${channel.id}/${channelAction}`,
              body: { expected_version: channel.version, reason },
              csrfToken,
            })
            notify(
              channelAction === 'disable'
                ? '渠道已停用：只摘除新支付路由，历史渠道腿继续接收回调与查单'
                : '渠道已归档，配置列已冻结；历史渠道腿继续按原绑定接收回调与查单',
            )
            await reload()
          }}
        />
      ) : null}
    </section>
  )
}

// ---- 编辑渠道（环境 / 启用状态 / 权重 + 乐观锁 expected_version） ----

function EditChannelForm({
  channel,
  csrfToken,
  reload,
  notify,
  notifyError,
}: {
  channel: PaymentChannelView
  csrfToken: string
  reload: () => Promise<void>
  notify: (message: string) => void
  notifyError: (message: string) => void
}) {
  const [environment, setEnvironment] = useState(channel.environment)
  const [isEnabled, setIsEnabled] = useState(channel.is_enabled)
  const [routingWeight, setRoutingWeight] = useState(String(channel.routing_weight))
  const [channelName, setChannelName] = useState(channel.name)
  const [payRequestURL, setPayRequestURL] = useState(channel.pay_request_url)
  const [payCallback, setPayCallback] = useState(channel.pay_callback)
  const [defaultMethod, setDefaultMethod] = useState(channel.default_payment_method)
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<ChannelFormErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setServerError(null)
    const next: ChannelFormErrors = {
      environment: validateEnvironment(environment),
      routing_weight: validateRoutingWeight(routingWeight),
      name: validateChannelName(channelName),
      pay_request_url: validatePayRequestURL(payRequestURL),
      pay_callback: validatePayCallback(payCallback),
      default_payment_method: validateDefaultPaymentMethod(defaultMethod),
      reason: validateReason(reason),
    }
    for (const key of Object.keys(next) as (keyof ChannelFormErrors)[]) {
      if (next[key] === null || next[key] === undefined) {
        delete next[key]
      }
    }
    setErrors(next)
    if (Object.keys(next).length > 0) {
      return
    }
    setBusy(true)
    try {
      await apiRequest({
        method: 'PATCH',
        path: '/v1/admin/payment-gateways/channels',
        body: {
          channel_id: channel.id,
          expected_version: channel.version,
          environment: environment.trim(),
          is_enabled: isEnabled,
          routing_weight: Number(routingWeight.trim()),
          name: channelName.trim(),
          pay_request_url: payRequestURL.trim(),
          pay_callback: payCallback.trim(),
          default_payment_method: defaultMethod,
          reason: reason.trim(),
        },
        csrfToken,
      })
      notify(`已保存渠道「${channel.channel_code}」的配置（版本 v${channel.version + 1}）`)
      setReason('')
      await reload()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PAYMENT_CONFIG_VERSION_CONFLICT') {
        await reload()
        notifyError('渠道配置已被其他管理员修改（PAYMENT_CONFIG_VERSION_CONFLICT），列表已自动刷新；请基于最新版本重新提交')
        return
      }
      setServerError(messageForApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
      <form
      className="form gateway-inline-form gateway-edit-form"
      data-testid="edit-channel-form"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="form__row gateway-form-grid gateway-form-grid--edit">
        <div className="form__field">
          <label className="form__label" htmlFor="edit-channel-name">
            渠道展示名（留空使用渠道代码）
          </label>
          <input
            id="edit-channel-name"
            data-testid="edit-channel-name"
            value={channelName}
            onChange={(event) => setChannelName(event.target.value)}
          />
          {errors.name !== undefined ? <p className="form__error">{errors.name}</p> : null}
        </div>
        <div className="form__field">
          <label className="form__label" htmlFor="edit-channel-request-url">
            完整下单地址 payRequesturl（含路径）
          </label>
          <input
            id="edit-channel-request-url"
            data-testid="edit-channel-request-url"
            value={payRequestURL}
            onChange={(event) => setPayRequestURL(event.target.value)}
          />
          {errors.pay_request_url !== undefined ? <p className="form__error">{errors.pay_request_url}</p> : null}
        </div>
        <div className="form__field">
          <label className="form__label" htmlFor="edit-channel-callback">
            回调入口 payCallback（完整回调地址按版本自动组装）
          </label>
          <input
            id="edit-channel-callback"
            data-testid="edit-channel-callback"
            value={payCallback}
            onChange={(event) => setPayCallback(event.target.value)}
          />
          {errors.pay_callback !== undefined ? <p className="form__error">{errors.pay_callback}</p> : null}
        </div>
        <div className="form__field">
          <label className="form__label" htmlFor="edit-channel-method">
            默认支付方式（读取商户对应编码）
          </label>
          <select
            id="edit-channel-method"
            data-testid="edit-channel-method"
            value={defaultMethod}
            onChange={(event) => setDefaultMethod(event.target.value)}
          >
            <option value="">暂不确定</option>
            <option value="ALIPAY">支付宝（ALIPAY）</option>
            <option value="WECHAT">微信（WECHAT）</option>
          </select>
          {errors.default_payment_method !== undefined ? <p className="form__error">{errors.default_payment_method}</p> : null}
        </div>
        <div className="form__field">
          <label className="form__label" htmlFor="edit-channel-environment">
            环境
          </label>
          <input
            id="edit-channel-environment"
            data-testid="edit-channel-environment"
            value={environment}
            onChange={(event) => setEnvironment(event.target.value)}
          />
          {errors.environment !== undefined ? <p className="form__error">{errors.environment}</p> : null}
        </div>
        <div className="form__field gateway-weight-field">
          <div className="gateway-weight-field__heading">
            <label className="form__label" htmlFor="edit-channel-weight">
              渠道权重
            </label>
            <output className="gateway-weight-field__value" htmlFor="edit-channel-weight">
              {routingWeight}
            </output>
          </div>
          <input
            id="edit-channel-weight"
            data-testid="edit-channel-weight"
            className="gateway-weight-slider"
            type="range"
            min="0"
            max="10000"
            step="1"
            value={routingWeight}
            aria-valuetext={`${routingWeight} / 10000`}
            onChange={(event) => setRoutingWeight(event.target.value)}
          />
          <div className="gateway-weight-field__scale" aria-hidden="true">
            <span>0</span>
            <span>保存后即时生效</span>
            <span>10000</span>
          </div>
          {errors.routing_weight !== undefined ? <p className="form__error">{errors.routing_weight}</p> : null}
        </div>
        <div className="form__field">
          <label>
            <input
              type="checkbox"
              data-testid="edit-channel-enabled"
              checked={isEnabled}
              onChange={(event) => setIsEnabled(event.target.checked)}
            />{' '}
            启用渠道（启用要求该渠道存在启用商户的 READY 版本）
          </label>
        </div>
      </div>
      <div className="form__field">
        <label className="form__label" htmlFor="edit-channel-reason">
          操作原因（必填，将写入审计；乐观锁版本 v{channel.version}）
        </label>
        <input
          id="edit-channel-reason"
          data-testid="edit-channel-reason"
          value={reason}
          placeholder="例如：调整主渠道权重"
          onChange={(event) => setReason(event.target.value)}
        />
        {errors.reason !== undefined ? <p className="form__error">{errors.reason}</p> : null}
      </div>
      {serverError !== null ? <Alert kind="error">{serverError}</Alert> : null}
      <div className="stack stack--row gateway-form-actions">
        <SubmitButton busy={busy} data-testid="edit-channel-submit">
          保存渠道配置
        </SubmitButton>
      </div>
    </form>
  )
}

// ---- 新建商户 ----

function CreateMerchantForm({
  channelId,
  csrfToken,
  reload,
  notify,
}: {
  channelId: string
  csrfToken: string
  reload: () => Promise<void>
  notify: (message: string) => void
}) {
  const [name, setName] = useState('')
  const [merchantNumber, setMerchantNumber] = useState('')
  const [alipayNumber, setAlipayNumber] = useState('')
  const [wechatpayNumber, setWechatpayNumber] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<{ name?: string | null; merchant_number?: string | null; alipay_number?: string | null; wechatpay_number?: string | null; reason?: string | null }>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setServerError(null)
    const next: { name?: string | null; merchant_number?: string | null; alipay_number?: string | null; wechatpay_number?: string | null; reason?: string | null } = {
      name: validateMerchantName(name),
      merchant_number: validateMerchantCode(merchantNumber, '商户号'),
      alipay_number: validateMerchantCode(alipayNumber, '支付宝编码'),
      wechatpay_number: validateMerchantCode(wechatpayNumber, '微信编码'),
      reason: validateReason(reason),
    }
    for (const key of Object.keys(next) as (keyof typeof next)[]) {
      if (next[key] === null) {
        delete next[key]
      }
    }
    setErrors(next)
    if (Object.keys(next).length > 0) {
      return
    }
    setBusy(true)
    try {
      await apiRequest({
        method: 'POST',
        path: `/v1/admin/payment-gateways/channels/${channelId}/merchants`,
        body: {
          name: name.trim(),
          merchant_number: merchantNumber.trim(),
          alipay_number: alipayNumber.trim(),
          wechatpay_number: wechatpayNumber.trim(),
          reason: reason.trim(),
        },
        csrfToken,
      })
      const created = name.trim()
      setName('')
      setMerchantNumber('')
      setAlipayNumber('')
      setWechatpayNumber('')
      setReason('')
      notify(`已创建商户「${created}」（初始为停用状态）；下一步提交凭据版本并校验`)
      await reload()
    } catch (err) {
      setServerError(messageForApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="form gateway-inline-form gateway-merchant-form"
      data-testid="create-merchant-form"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="form__row gateway-form-grid gateway-form-grid--merchant">
        <div className="form__field">
          <label className="form__label" htmlFor="create-merchant-name">
            新建商户名称 MerchantName（≤200 字符）
          </label>
          <input
            id="create-merchant-name"
            data-testid="create-merchant-name"
            value={name}
            placeholder="例如：FlrqfPay 主商户"
            onChange={(event) => setName(event.target.value)}
          />
          {errors.name !== undefined ? <p className="form__error">{errors.name}</p> : null}
        </div>
        <div className="form__field">
          <label className="form__label" htmlFor="create-merchant-number">
            商户号 MerchantNumber（字符串，保留前导零）
          </label>
          <input
            id="create-merchant-number"
            data-testid="create-merchant-number"
            value={merchantNumber}
            placeholder="例如：0012345678"
            onChange={(event) => setMerchantNumber(event.target.value)}
          />
          {errors.merchant_number !== undefined ? <p className="form__error">{errors.merchant_number}</p> : null}
        </div>
        <div className="form__field">
          <label className="form__label" htmlFor="create-merchant-alipay">
            支付宝上游渠道编码 AlipayNumber（可选）
          </label>
          <input
            id="create-merchant-alipay"
            data-testid="create-merchant-alipay"
            value={alipayNumber}
            placeholder="例如：ALIPAY_SCAN_01"
            onChange={(event) => setAlipayNumber(event.target.value)}
          />
          {errors.alipay_number !== undefined ? <p className="form__error">{errors.alipay_number}</p> : null}
        </div>
        <div className="form__field">
          <label className="form__label" htmlFor="create-merchant-wechat">
            微信上游渠道编码 WechatpayNumber（可选）
          </label>
          <input
            id="create-merchant-wechat"
            data-testid="create-merchant-wechat"
            value={wechatpayNumber}
            placeholder="例如：WECHAT_SCAN_01"
            onChange={(event) => setWechatpayNumber(event.target.value)}
          />
          {errors.wechatpay_number !== undefined ? <p className="form__error">{errors.wechatpay_number}</p> : null}
        </div>
        <div className="form__field">
          <label className="form__label" htmlFor="create-merchant-reason">
            操作原因（必填，将写入审计）
          </label>
          <input
            id="create-merchant-reason"
            data-testid="create-merchant-reason"
            value={reason}
            placeholder="例如：接入新商户号"
            onChange={(event) => setReason(event.target.value)}
          />
          {errors.reason !== undefined ? <p className="form__error">{errors.reason}</p> : null}
        </div>
      </div>
      {serverError !== null ? <Alert kind="error">{serverError}</Alert> : null}
      <div className="stack stack--row gateway-form-actions">
        <SubmitButton busy={busy} data-testid="create-merchant-submit">
          创建商户
        </SubmitButton>
      </div>
    </form>
  )
}

// ---- 商户卡片：启停 + 版本管理（列表 / 动态表单 / 校验 / 退休） ----

function MerchantCard({
  merchant,
  schema,
  csrfToken,
  reload,
  notify,
  notifyError,
}: {
  merchant: PaymentMerchantView
  schema: PaymentConfigFieldSchema[] | null
  csrfToken: string
  reload: () => Promise<void>
  notify: (message: string) => void
  notifyError: (message: string) => void
}) {
  const { refresh } = useAdminSession()
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<PaymentMerchantVersionView[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  /** 商户启停（US-025 危险操作：确认对话框 + 强认证提权重试） */
  const [toggleMerchant, setToggleMerchant] = useState(false)

  const loadVersions = useCallback(async () => {
    setPhase('loading')
    try {
      const { data } = await apiRequest<unknown>({
        method: 'GET',
        path: `/v1/admin/payment-gateways/merchants/${merchant.id}/versions`,
      })
      setVersions(parseVersionList(data))
      setPhase('ready')
    } catch (err) {
      setError(messageForApiError(err))
      setPhase('error')
    }
  }, [merchant.id])

  useEffect(() => {
    if (open) {
      void loadVersions()
    }
  }, [open, loadVersions])

  /** 版本操作目标（同一时刻只展开一个确认对话框） */
  const [versionAction, setVersionAction] = useState<{ kind: 'validate' | 'retire'; version: PaymentMerchantVersionView } | null>(null)

  return (
    <div className="card gateway-merchant-card" data-testid={`merchant-card-${merchant.id}`}>
      <div className="card__header gateway-merchant-card__header">
        <div className="gateway-merchant-card__name">
          <span className="gateway-section__eyebrow">MERCHANT ACCOUNT</span>
          <h3 className="card__title">{merchant.name}</h3>
        </div>
        <p className="card__meta gateway-merchant-card__meta">
          <span className={merchant.status === 'ENABLED' ? 'tag tag--published' : 'tag tag--draft'}>
            {merchant.status === 'ENABLED' ? '启用商户' : '停用商户'}
          </span>{' '}
          {merchant.merchant_number !== '' ? <span className="table__mono">商户号 {merchant.merchant_number}</span> : null}
          {merchant.alipay_number !== '' || merchant.wechatpay_number !== '' ? (
            <span className="table__mono">
              支付宝 {merchant.alipay_number || '—'} · 微信 {merchant.wechatpay_number || '—'}
            </span>
          ) : null}
          {merchant.ready_version !== null ? (
            <span className="table__mono">
              当前 READY：v{merchant.ready_version.version_no}（{shortDigest(merchant.ready_version.config_digest)}）
            </span>
          ) : (
            <span>尚无 READY 版本</span>
          )}
        </p>
        <button
          type="button"
          className="btn btn--small btn--ghost gateway-secondary-button"
          data-testid={`merchant-versions-toggle-${merchant.id}`}
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? '收起版本管理' : '版本管理'}
        </button>
      </div>

      <button
        type="button"
        className="btn btn--small btn--ghost gateway-secondary-button"
        data-testid={`merchant-toggle-${merchant.id}`}
        onClick={() => setToggleMerchant(true)}
      >
        {merchant.status === 'ENABLED' ? '停用商户…' : '启用商户…'}
      </button>

      {toggleMerchant ? (
        <ConfirmDialog
          open
          {...dangerousActionDialogSpec({
            kind: merchant.status === 'ENABLED' ? 'disable-merchant' : 'enable-merchant',
            merchantName: merchant.name,
          })}
          csrfToken={csrfToken}
          onClose={() => setToggleMerchant(false)}
          onEscalated={() => void refresh()}
          run={async (reason) => {
            await apiRequest({
              method: 'POST',
              path: `/v1/admin/payment-gateways/merchants/${merchant.id}/${merchant.status === 'ENABLED' ? 'disable' : 'enable'}`,
              body: { reason },
              csrfToken,
            })
            notify(merchant.status === 'ENABLED' ? '商户已停用' : '商户已启用（同渠道最多一个启用商户）')
            await reload()
          }}
        />
      ) : null}

      {open ? (
        <div data-testid={`merchant-versions-${merchant.id}`}>
          {phase === 'loading' ? <p className="state-hint">正在加载版本…</p> : null}
          {phase === 'error' ? (
            <div>
              <Alert kind="error">{error}</Alert>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => void loadVersions()}>
                重试
              </button>
            </div>
          ) : null}
          {phase === 'ready' ? (
            <>
              {versions.length === 0 ? (
                <p className="empty-state">该商户尚无凭据版本。</p>
              ) : (
                <div className="table-wrap gateway-version-table-wrap">
                  <table className="table gateway-version-table" data-testid={`merchant-versions-table-${merchant.id}`}>
                    <thead>
                      <tr>
                        <th>版本</th>
                        <th>状态</th>
                        <th>配置摘要</th>
                        <th>回调地址（可直接复制给第三方）</th>
                        <th>脱敏配置</th>
                        <th>校验时间</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {versions.map((version) => (
                        <tr key={version.id} data-testid={`merchant-version-${version.id}`}>
                          <td className="table__mono">v{version.versionNo}</td>
                          <td>
                            <span className={versionStatusTagClass(version.status)}>
                              {versionStatusText[version.status] ?? version.status}
                            </span>
                          </td>
                          <td className="table__mono">{shortDigest(version.configDigest)}</td>
                          <td>
                            {version.callbackUrl !== '' ? (
                              <code
                                className="table__mono gateway-callback-url"
                                data-testid={`version-callback-url-${version.id}`}
                                title="点击复制完整回调地址"
                                style={{ cursor: 'copy' }}
                                onClick={() => {
                                  void navigator.clipboard?.writeText(version.callbackUrl).then(
                                    () => notify('回调地址已复制到剪贴板'),
                                    () => notifyError('复制失败：请手动选择并复制该地址'),
                                  )
                                }}
                              >
                                {version.callbackUrl}
                              </code>
                            ) : (
                              <span className="table__mono" title="渠道未配置回调入口，第三方配置需使用该 key 手工核对">
                                key: {version.callbackKey}
                              </span>
                            )}
                          </td>
                          <td>
                            <div className="stack">
                              {version.config.map((field) => (
                                <span key={field.key} className="table__mono">
                                  {field.key}: {field.secret ? `${field.value}（加密）` : field.value}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td>{version.validatedAt !== null ? formatDateTimeKL(version.validatedAt) : '—'}</td>
                          <td>
                            <div className="stack stack--row">
                              {version.status === 'PENDING' ? (
                                <button
                                  type="button"
                                  className="btn btn--small btn--ghost"
                                  data-testid={`version-action-validate-${version.id}`}
                                  onClick={() => setVersionAction({ kind: 'validate', version })}
                                >
                                  校验版本…
                                </button>
                              ) : null}
                              {version.status === 'READY' ? (
                                <button
                                  type="button"
                                  className="btn btn--small btn--ghost"
                                  data-testid={`version-action-retire-${version.id}`}
                                  onClick={() => setVersionAction({ kind: 'retire', version })}
                                >
                                  退休版本…
                                </button>
                              ) : null}
                              {version.status !== 'PENDING' && version.status !== 'READY' ? '—' : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {versionAction !== null ? (
                <ConfirmDialog
                  open
                  {...dangerousActionDialogSpec({
                    kind: versionAction.kind === 'validate' ? 'validate-version' : 'retire-version',
                    merchantName: merchant.name,
                    versionNo: versionAction.version.versionNo,
                  })}
                  csrfToken={csrfToken}
                  onClose={() => setVersionAction(null)}
                  onEscalated={() => void refresh()}
                  run={async (reason) => {
                    const path =
                      versionAction.kind === 'validate'
                        ? `/v1/admin/payment-gateways/merchant-versions/${versionAction.version.id}/validate`
                        : `/v1/admin/payment-gateways/merchant-versions/${versionAction.version.id}/retire`
                    const { data } = await apiRequest<{ status?: unknown }>({
                      method: 'POST',
                      path,
                      body: { reason },
                      csrfToken,
                    })
                    if (versionAction.kind === 'validate') {
                      notify(
                        data?.status === 'READY'
                          ? `校验通过：版本 v${versionAction.version.versionNo} 已 READY，可作为路由候选`
                          : `校验未通过：版本 v${versionAction.version.versionNo} 保存为 INVALID（须提交新版本），旧 READY 版本继续服务`,
                      )
                    } else {
                      notify(`版本 v${versionAction.version.versionNo} 已退休；历史渠道腿继续按原绑定收回调与查单`)
                    }
                    await Promise.all([loadVersions(), reload()])
                  }}
                />
              ) : null}

              {schema !== null ? (
                <SubmitVersionForm
                  merchantId={merchant.id}
                  merchantName={merchant.name}
                  schema={schema}
                  csrfToken={csrfToken}
                  onSubmitted={loadVersions}
                  notify={notify}
                />
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// ---- 提交新版本（按适配器 schema 动态渲染；Secret 不回显；确认对话框收原因） ----

function SubmitVersionForm({
  merchantId,
  merchantName,
  schema,
  csrfToken,
  onSubmitted,
  notify,
}: {
  merchantId: string
  merchantName: string
  schema: PaymentConfigFieldSchema[]
  csrfToken: string
  onSubmitted: () => Promise<void>
  notify: (message: string) => void
}) {
  const { refresh } = useAdminSession()
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<{ credentials?: Record<string, string> }>({})
  const [confirming, setConfirming] = useState(false)

  const submit = () => {
    const credentialErrors = validateCredentialValues(schema, values)
    setErrors(Object.keys(credentialErrors).length > 0 ? { credentials: credentialErrors } : {})
    if (Object.keys(credentialErrors).length === 0) {
      // 凭据变更（US-025 危险操作）：必填原因与强认证提权在确认对话框内完成
      setConfirming(true)
    }
  }

  return (
    <>
    <form
      className="form gateway-inline-form gateway-credentials-form"
        data-testid="submit-version-form"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
      <div className="gateway-form-heading">
        <div>
          <span className="gateway-form-heading__eyebrow">IMMUTABLE CREDENTIAL VERSION</span>
          <h4 className="card__title">提交新凭据版本</h4>
        </div>
        <span className="gateway-form-heading__state">Secret 只写入</span>
      </div>
      <p className="gateway-form-note">提交后生成 PENDING 版本，再执行适配器校验；页面不会保留任何 Secret。</p>
      <div className="form__row gateway-credentials-grid">
        {schema.map((field) => (
          <div className="form__field" key={field.key}>
            <label className="form__label" htmlFor={`credential-${field.key}`}>
              {field.label}（{field.key}
              {field.required ? '，必填' : '，可选'}）
            </label>
            <input
              id={`credential-${field.key}`}
              data-testid={`credential-${field.key}`}
              type={field.secret ? 'password' : 'text'}
              inputMode={field.kind === 'int' ? 'numeric' : undefined}
              autoComplete="off"
              value={values[field.key] ?? ''}
              placeholder={field.secret ? '仅提交时接收，保存后不回显' : field.description}
              onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
            />
            {errors.credentials?.[field.key] !== undefined ? (
              <p className="form__error">{errors.credentials[field.key]}</p>
            ) : null}
          </div>
        ))}
      </div>
        <div className="stack stack--row">
          <button type="submit" className="btn" data-testid="submit-version-submit">
            提交新版本…
          </button>
        </div>
      </form>

      {/* 对话框渲染在表单外：嵌套 <form> 是非法 HTML，对话框的确认按钮会
          误触发外层凭据表单提交（整页导航） */}
      {confirming ? (
        <ConfirmDialog
          open
          {...dangerousActionDialogSpec({ kind: 'submit-version', merchantName })}
          csrfToken={csrfToken}
          onClose={() => setConfirming(false)}
          onEscalated={() => void refresh()}
          run={async (reason) => {
            await apiRequest({
              method: 'POST',
              path: `/v1/admin/payment-gateways/merchants/${merchantId}/versions`,
              body: { credentials: credentialPayload(schema, values), reason },
              csrfToken,
            })
            // 提交成功后清空全部输入：Secret 只在提交时接收，页面不保留任何明文
            setValues({})
            notify('版本已提交（PENDING）；凭据已加密保存，点击「校验版本」执行适配器校验')
            await onSubmitted()
          }}
        />
      ) : null}
    </>
  )
}
