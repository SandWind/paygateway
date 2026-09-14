/**
 * 支付网关控制面数据契约（对应 admin-api :8081 的 /v1/admin/payment-gateways/*）。
 *
 * 本文件只包含用于界面演示的样例数据，字段名与后端读接口保持一致，
 * 后续接入真实接口时可直接替换 loader 中的取数逻辑。
 */

export type Role = "SUPER_ADMIN" | "SUPPORT_OPERATOR";

/** GET /v1/admin/payment-gateways/adapter-types */
export const adapterTypes = [
  { adapter_type: "mock", display_name: "Mock 适配器", capabilities: ["pay_url", "query", "callback"] },
  { adapter_type: "flrqfpay", display_name: "FLRQF Pay", capabilities: ["pay_url", "query", "callback", "refund"] },
  { adapter_type: "peqorapay", display_name: "Peqora Pay", capabilities: ["pay_url", "query", "callback"] },
];

/** GET /v1/admin/payment-gateways/providers */
export type Provider = {
  id: string;
  provider_code: string;
  adapter_type: string;
  display_name: string;
  status: "ENABLED" | "DISABLED";
  channel_count: number;
  updated_at: string;
};

export const providers: Provider[] = [
  { id: "prv_01", provider_code: "flrqfpay", adapter_type: "flrqfpay", display_name: "FLRQF 聚合支付", status: "ENABLED", channel_count: 2, updated_at: "2026-09-11 10:22" },
  { id: "prv_02", provider_code: "peqorapay", adapter_type: "peqorapay", display_name: "Peqora 钱包", status: "ENABLED", channel_count: 1, updated_at: "2026-09-09 17:04" },
  { id: "prv_03", provider_code: "mock", adapter_type: "mock", display_name: "沙箱 Mock", status: "DISABLED", channel_count: 1, updated_at: "2026-08-28 09:15" },
];

/** GET /v1/admin/payment-gateways/channels */
export type Channel = {
  id: string;
  channel_code: string;
  provider_code: string;
  display_name: string;
  weight: number;
  status: "ENABLED" | "DISABLED" | "ARCHIVED";
  expected_version: number;
  enabled_merchant_code: string | null;
  ready_version_no: number | null;
  callback_url: string;
  updated_at: string;
};

export const channels: Channel[] = [
  {
    id: "chn_01", channel_code: "flrqfpay-primary", provider_code: "flrqfpay", display_name: "FLRQF 主通道",
    weight: 6200, status: "ENABLED", expected_version: 42, enabled_merchant_code: "baijie-main", ready_version_no: 7,
    callback_url: "https://pay.example.com/v1/callbacks/flrqfpay/9f2c…", updated_at: "2026-09-14 11:02",
  },
  {
    id: "chn_02", channel_code: "peqora-wallet", provider_code: "peqorapay", display_name: "Peqora 钱包通道",
    weight: 2800, status: "ENABLED", expected_version: 18, enabled_merchant_code: "baijie-wallet", ready_version_no: 3,
    callback_url: "https://pay.example.com/v1/callbacks/peqorapay/41ab…", updated_at: "2026-09-13 20:41",
  },
  {
    id: "chn_03", channel_code: "mock-sandbox", provider_code: "mock", display_name: "沙箱通道",
    weight: 1000, status: "DISABLED", expected_version: 9, enabled_merchant_code: null, ready_version_no: null,
    callback_url: "https://pay.example.com/v1/callbacks/mock/7dd1…", updated_at: "2026-09-02 08:30",
  },
  {
    id: "chn_04", channel_code: "flrqfpay-legacy", provider_code: "flrqfpay", display_name: "FLRQF 旧通道",
    weight: 0, status: "ARCHIVED", expected_version: 31, enabled_merchant_code: "legacy-cn", ready_version_no: 4,
    callback_url: "https://pay.example.com/v1/callbacks/flrqfpay/c0e5…", updated_at: "2026-07-19 15:12",
  },
];

/** GET /v1/admin/payment-gateways/channels/{id}/merchants */
export type Merchant = {
  id: string;
  channel_code: string;
  merchant_code: string;
  display_name: string;
  status: "ENABLED" | "DISABLED";
};

export const merchants: Merchant[] = [
  { id: "mch_01", channel_code: "flrqfpay-primary", merchant_code: "baijie-main", display_name: "百捷主商户", status: "ENABLED" },
  { id: "mch_02", channel_code: "flrqfpay-primary", merchant_code: "baijie-backup", display_name: "百捷备用商户", status: "DISABLED" },
  { id: "mch_03", channel_code: "peqora-wallet", merchant_code: "baijie-wallet", display_name: "百捷钱包商户", status: "ENABLED" },
  { id: "mch_04", channel_code: "mock-sandbox", merchant_code: "sandbox-default", display_name: "沙箱商户", status: "DISABLED" },
  { id: "mch_05", channel_code: "flrqfpay-legacy", merchant_code: "legacy-cn", display_name: "历史商户", status: "ENABLED" },
];

/** GET /v1/admin/payment-gateways/merchants/{id}/versions */
export type MerchantVersion = {
  id: string;
  merchant_id: string;
  version_no: number;
  state: "PENDING" | "READY" | "INVALID" | "RETIRED";
  config_digest: string;
  fingerprint: string;
  created_at: string;
  created_by: string;
};

export const merchantVersions: MerchantVersion[] = [
  { id: "ver_07", merchant_id: "mch_01", version_no: 7, state: "READY", config_digest: "sha256:3f9c…d21a", fingerprint: "•••• 8F2A", created_at: "2026-09-11 10:22", created_by: "lin@ops" },
  { id: "ver_06", merchant_id: "mch_01", version_no: 6, state: "RETIRED", config_digest: "sha256:81be…7c02", fingerprint: "•••• 4C11", created_at: "2026-06-04 09:18", created_by: "lin@ops" },
  { id: "ver_08", merchant_id: "mch_02", version_no: 1, state: "PENDING", config_digest: "sha256:待校验", fingerprint: "—", created_at: "2026-09-14 09:47", created_by: "zhou@ops" },
  { id: "ver_03", merchant_id: "mch_03", version_no: 3, state: "READY", config_digest: "sha256:aa41…9b0e", fingerprint: "•••• 91BC", created_at: "2026-09-09 17:04", created_by: "lin@ops" },
  { id: "ver_02", merchant_id: "mch_03", version_no: 2, state: "INVALID", config_digest: "sha256:c7d0…1120", fingerprint: "•••• 3D77", created_at: "2026-08-21 11:36", created_by: "zhou@ops" },
  { id: "ver_04", merchant_id: "mch_05", version_no: 4, state: "RETIRED", config_digest: "sha256:5f22…a122", fingerprint: "•••• A122", created_at: "2026-05-02 14:09", created_by: "lin@ops" },
];

/** GET /v1/admin/payment-gateways/recovery/fact-failures */
export type FactFailure = {
  id: string;
  fact_id: string;
  fact_type: "PAYMENT_PAID" | "PAYMENT_FAILED";
  channel_code: string;
  attempts: number;
  last_error: string;
  last_attempt_at: string;
  trusted_paid_delivered: boolean;
};

export const factFailures: FactFailure[] = [
  { id: "ff_01", fact_id: "fact_7K2M8", fact_type: "PAYMENT_PAID", channel_code: "flrqfpay-primary", attempts: 8, last_error: "user-api 5xx：投递重试已耗尽", last_attempt_at: "2026-09-14 07:12", trusted_paid_delivered: false },
  { id: "ff_02", fact_id: "fact_9QT41", fact_type: "PAYMENT_FAILED", channel_code: "mock-sandbox", attempts: 3, last_error: "internal_signature_mismatch", last_attempt_at: "2026-09-13 22:58", trusted_paid_delivered: true },
];

/** GET /v1/admin/payment-gateways/recovery/stopped-legs */
export type StoppedLeg = {
  id: string;
  leg_id: string;
  payment_attempt_id: string;
  channel_code: string;
  merchant_version_no: number;
  stop_reason: string;
  stopped_at: string;
  trusted_paid_delivered: boolean;
};

export const stoppedLegs: StoppedLeg[] = [
  { id: "sl_01", leg_id: "leg_4P9AX", payment_attempt_id: "pat_88213", channel_code: "peqora-wallet", merchant_version_no: 3, stop_reason: "provider_timeout：查单达到上限", stopped_at: "2026-09-14 06:40", trusted_paid_delivered: false },
  { id: "sl_02", leg_id: "leg_2M7BQ", payment_attempt_id: "pat_88109", channel_code: "flrqfpay-primary", merchant_version_no: 7, stop_reason: "provider_unknown_state", stopped_at: "2026-09-12 19:05", trusted_paid_delivered: true },
];

export const stateTone: Record<string, string> = {
  READY: "text-success bg-success/10 border-success/25",
  ENABLED: "text-success bg-success/10 border-success/25",
  PENDING: "text-warning bg-warning/10 border-warning/25",
  DISABLED: "text-muted-foreground bg-muted border-border",
  RETIRED: "text-muted-foreground bg-muted border-border",
  ARCHIVED: "text-muted-foreground bg-muted border-border",
  INVALID: "text-danger bg-danger/10 border-danger/30",
};
