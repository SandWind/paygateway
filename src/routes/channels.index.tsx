import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { PageHeader, StateBadge, useRole } from "@/components/console-shell";
import { Button } from "@/components/ui/button";
import { channels } from "@/lib/paygateway-data";

export const Route = createFileRoute("/channels/")({
  head: () => ({
    meta: [
      { title: "支付渠道列表 | 支付网关配置" },
      { name: "description", content: "查看渠道状态、路由权重、ENABLED 商户与 READY 版本。" },
      { property: "og:title", content: "支付渠道列表 | 支付网关配置" },
      { property: "og:description", content: "查看渠道状态、路由权重、ENABLED 商户与 READY 版本。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChannelList,
});

function ChannelList() {
  const { readOnly } = useRole();
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () =>
      channels.filter((channel) =>
        `${channel.channel_code} ${channel.provider_code} ${channel.display_name}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [query],
  );

  return (
    <>
      <PageHeader
        title="渠道"
        subtitle="GET/POST/PATCH /v1/admin/payment-gateways/channels · 启用前必须存在 ENABLED 商户和 READY 版本。"
        actions={
          <Button size="sm" disabled={readOnly}>
            <Plus className="size-3.5" />
            新建渠道
          </Button>
        }
      />

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索 channel_code 或 provider_code"
          className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-3 text-xs outline-none focus:border-primary"
        />
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="hidden grid-cols-[1.4fr_1fr_1fr_auto_auto_auto] gap-4 border-b border-border px-5 py-2.5 text-[10px] uppercase tracking-wide text-muted-foreground lg:grid">
          <span>channel_code</span>
          <span>provider_code</span>
          <span>enabled_merchant</span>
          <span>ready_version</span>
          <span>weight</span>
          <span>status</span>
        </div>
        <div className="divide-y divide-border">
          {visible.map((channel) => (
            <Link
              key={channel.id}
              to="/channels/$channelCode"
              params={{ channelCode: channel.channel_code }}
              className="grid grid-cols-[1fr_auto] items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/50 lg:grid-cols-[1.4fr_1fr_1fr_auto_auto_auto] lg:gap-4"
            >
              <div className="min-w-0">
                <div className="truncate font-mono text-xs">{channel.channel_code}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground lg:hidden">
                  {channel.provider_code} · weight {channel.weight}
                </div>
                <div className="mt-0.5 hidden text-[10px] text-muted-foreground lg:block">{channel.display_name}</div>
              </div>
              <div className="hidden font-mono text-xs text-muted-foreground lg:block">{channel.provider_code}</div>
              <div className="hidden font-mono text-xs text-muted-foreground lg:block">
                {channel.enabled_merchant_code ?? "—"}
              </div>
              <div className="hidden font-mono text-xs text-muted-foreground lg:block">
                {channel.ready_version_no ? `v${channel.ready_version_no}` : "—"}
              </div>
              <div className="hidden w-14 text-right font-mono text-xs lg:block">{channel.weight}</div>
              <div className="flex items-center gap-2">
                <StateBadge value={channel.status} />
                <ChevronRight className="size-3.5 text-muted-foreground" />
              </div>
            </Link>
          ))}
          {visible.length === 0 && (
            <p className="px-5 py-8 text-center text-xs text-muted-foreground">没有匹配的渠道。</p>
          )}
        </div>
      </div>
    </>
  );
}
