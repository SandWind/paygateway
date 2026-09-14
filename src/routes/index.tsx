import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, KeyRound, RouteIcon, Activity, ChevronRight } from "lucide-react";

import { PageHeader, StateBadge } from "@/components/console-shell";
import { channels, factFailures, merchantVersions, stoppedLegs } from "@/lib/paygateway-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "支付网关配置概览 | 后台控制面" },
      { name: "description", content: "查看渠道路由权重、READY 凭据版本与待恢复的支付事实。" },
      { property: "og:title", content: "支付网关配置概览 | 后台控制面" },
      { property: "og:description", content: "查看渠道路由权重、READY 凭据版本与待恢复的支付事实。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Overview,
});

function Overview() {
  const routable = channels.filter((channel) => channel.status === "ENABLED");
  const totalWeight = routable.reduce((sum, channel) => sum + channel.weight, 0);
  const readyVersions = merchantVersions.filter((version) => version.state === "READY").length;

  const stats = [
    { label: "可路由渠道", value: `${routable.length} / ${channels.length}`, note: "ENABLED 且有 READY 版本", icon: Activity },
    { label: "路由总权重", value: totalWeight.toLocaleString(), note: "HMAC-SHA256 无模偏抽签", icon: RouteIcon },
    { label: "READY 版本", value: `${readyVersions}`, note: `共 ${merchantVersions.length} 个版本记录`, icon: KeyRound },
    { label: "待恢复项", value: `${factFailures.length + stoppedLegs.length}`, note: "失败事实 + 停止查单腿", icon: AlertTriangle },
  ];

  return (
    <>
      <PageHeader title="概览" subtitle="配置读接口只返回元数据、能力描述与脱敏摘要，Secret 永不回显。" />

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="运行摘要">
        {stats.map(({ label, value, note, icon: Icon }) => (
          <article key={label} className="rounded-md border border-border bg-card p-4">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{label}</span>
              <Icon className="size-4" />
            </div>
            <div className="mt-2 font-mono text-2xl font-semibold">{value}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">{note}</div>
          </article>
        ))}
      </section>

      <section className="mt-5 overflow-hidden rounded-md border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold">渠道路由权重</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">weight 取值 0..10000 · 更新走 PATCH /channels/{"{id}"}/routing</p>
          </div>
          <Link to="/channels" className="flex items-center gap-1 text-[11px] text-primary hover:underline">
            管理渠道 <ChevronRight className="size-3" />
          </Link>
        </div>
        <div className="divide-y divide-border">
          {channels.map((channel) => (
            <div key={channel.id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-5 py-3.5 sm:grid-cols-[1.4fr_1fr_auto_auto] sm:gap-4">
              <div className="min-w-0">
                <div className="truncate font-mono text-xs">{channel.channel_code}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">{channel.provider_code} · rev {channel.expected_version}</div>
              </div>
              <div className="hidden truncate text-xs text-muted-foreground sm:block">
                {channel.enabled_merchant_code ?? "无 ENABLED 商户"}
              </div>
              <div className="order-last col-span-2 flex items-center gap-2 sm:order-none sm:col-span-1">
                <div className="h-1.5 w-24 overflow-hidden rounded bg-muted sm:w-32">
                  <div className="h-full bg-primary" style={{ width: `${channel.weight / 100}%` }} />
                </div>
                <span className="w-12 text-right font-mono text-xs">{channel.weight}</span>
              </div>
              <StateBadge value={channel.status} />
            </div>
          ))}
        </div>
      </section>

      <section className="mt-5 grid gap-3 text-[11px] text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
        {[
          "channel_code 创建后不可变",
          "同一渠道最多一个 ENABLED 商户",
          "每商户只允许一个 READY 版本",
          "渠道归档后冻结配置，历史腿仍可收回调",
        ].map((rule) => (
          <p key={rule} className="rounded-md border border-border bg-card px-3 py-2.5">
            {rule}
          </p>
        ))}
      </section>
    </>
  );
}
