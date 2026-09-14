import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, Archive, KeyRound, Plus, Power, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Field, PageHeader, ReasonBox, StateBadge, useRole } from "@/components/console-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { channels, merchants, merchantVersions } from "@/lib/paygateway-data";

export const Route = createFileRoute("/channels/$channelCode")({
  loader: ({ params }) => {
    const channel = channels.find((item) => item.channel_code === params.channelCode);
    if (!channel) throw notFound();
    return { channelCode: channel.channel_code };
  },
  head: ({ params }) => ({
    meta: [
      { title: `${params.channelCode} · 渠道配置 | 支付网关` },
      { name: "description", content: "调整路由权重、管理商户启用状态与不可变凭据版本。" },
      { property: "og:title", content: `${params.channelCode} · 渠道配置 | 支付网关` },
      { property: "og:description", content: "调整路由权重、管理商户启用状态与不可变凭据版本。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  notFoundComponent: () => <p className="text-sm text-muted-foreground">找不到该渠道。</p>,
  errorComponent: ({ error }) => <p role="alert" className="text-sm text-danger">{error.message}</p>,
  component: ChannelDetail,
});

function ChannelDetail() {
  const { channelCode } = Route.useParams();
  const { readOnly } = useRole();
  const channel = channels.find((item) => item.channel_code === channelCode)!;
  const channelMerchants = merchants.filter((item) => item.channel_code === channelCode);

  const [weight, setWeight] = useState(channel.weight);
  const [routingOpen, setRoutingOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const frozen = channel.status === "ARCHIVED";

  return (
    <>
      <Link to="/channels" className="mb-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> 返回渠道列表
      </Link>

      <PageHeader
        title={channel.channel_code}
        subtitle={`${channel.display_name} · channel_code 创建后不可变${frozen ? " · 渠道已归档，配置冻结" : ""}`}
        actions={
          <>
            <Button variant="outline" size="sm" disabled={readOnly || frozen}>
              <Power className="size-3.5" />
              {channel.status === "ENABLED" ? "停用渠道" : "启用渠道"}
            </Button>
            <Button variant="outline" size="sm" disabled={readOnly || frozen}>
              <Archive className="size-3.5" />
              归档
            </Button>
          </>
        }
      />

      <section className="grid gap-3 lg:grid-cols-3">
        <article className="rounded-md border border-border bg-card p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">渠道元数据</h2>
            <StateBadge value={channel.status} />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="provider_code">{channel.provider_code}</Field>
            <Field label="expected_version（乐观锁）">{channel.expected_version}</Field>
            <Field label="enabled_merchant">{channel.enabled_merchant_code ?? "无"}</Field>
            <Field label="ready_version">{channel.ready_version_no ? `v${channel.ready_version_no}` : "无"}</Field>
            <div className="sm:col-span-2">
              <Field label="callback_url（服务端组装）">{channel.callback_url}</Field>
            </div>
          </div>
        </article>

        <article className="rounded-md border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">路由权重</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">PATCH /channels/{"{id}"}/routing · 0..10000</p>
          <div className="mt-4 font-mono text-3xl font-semibold">{weight}</div>
          <input
            aria-label="路由权重"
            type="range"
            min={0}
            max={10000}
            step={100}
            value={weight}
            disabled={readOnly || frozen}
            onChange={(event) => setWeight(Number(event.target.value))}
            className="mt-3 h-1.5 w-full accent-primary"
          />
          <Button
            className="mt-4 w-full"
            size="sm"
            disabled={readOnly || frozen || weight === channel.weight}
            onClick={() => { setReason(""); setRoutingOpen(true); }}
          >
            提交权重变更
          </Button>
        </article>
      </section>

      <section className="mt-5 space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-sm font-semibold">商户与凭据版本</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              同一渠道最多一个 ENABLED 商户；每商户只允许一个 READY 版本。
            </p>
          </div>
        </div>

        {channelMerchants.map((merchant) => {
          const versions = merchantVersions.filter((version) => version.merchant_id === merchant.id);
          return (
            <article key={merchant.id} className="overflow-hidden rounded-md border border-border bg-card">
              <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5">
                <div>
                  <div className="font-mono text-xs">{merchant.merchant_code}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{merchant.display_name}</div>
                </div>
                <StateBadge value={merchant.status} />
                <div className="ml-auto flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={readOnly || frozen}>
                    {merchant.status === "ENABLED" ? "禁用商户" : "启用商户"}
                  </Button>
                  <Button size="sm" disabled={readOnly || frozen} onClick={() => { setReason(""); setVersionOpen(merchant.merchant_code); }}>
                    <Plus className="size-3.5" />
                    新建版本
                  </Button>
                </div>
              </div>
              <div className="divide-y divide-border">
                {versions.map((version) => (
                  <div key={version.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <KeyRound className="size-4 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="font-mono text-xs">v{version.version_no} · {version.config_digest}</div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        指纹 {version.fingerprint} · {version.created_at} · {version.created_by}
                      </div>
                    </div>
                    <StateBadge value={version.state} />
                    <div className="ml-auto flex gap-2">
                      <Button variant="outline" size="sm" disabled={readOnly || frozen || version.state !== "PENDING"}>
                        校验
                      </Button>
                      <Button variant="outline" size="sm" disabled={readOnly || frozen || version.state !== "READY"}>
                        退休
                      </Button>
                    </div>
                  </div>
                ))}
                {versions.length === 0 && (
                  <p className="px-5 py-6 text-center text-xs text-muted-foreground">尚无版本记录。</p>
                )}
              </div>
            </article>
          );
        })}
      </section>

      <p className="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
        版本提交时 Secret 仅在请求体短暂出现，服务端立即用 PAYMENT_CONFIG_SEAL_KEY 密封；详情只返回 config_digest、字段类型与末尾指纹。
      </p>

      <Dialog open={routingOpen} onOpenChange={setRoutingOpen}>
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono">更新路由权重</DialogTitle>
            <DialogDescription>
              {channel.channel_code}：{channel.weight} → {weight}，请求携带 expected_version={channel.expected_version}，并发修改会被拒绝。
            </DialogDescription>
          </DialogHeader>
          <ReasonBox value={reason} onChange={setReason} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoutingOpen(false)}>取消</Button>
            <Button disabled={!reason.trim()} onClick={() => setRoutingOpen(false)}>提交</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(versionOpen)} onOpenChange={(open) => !open && setVersionOpen(null)}>
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono">新建版本 · {versionOpen}</DialogTitle>
            <DialogDescription>版本不可变，状态从 PENDING 开始；校验通过后旧 READY 自动退休为 RETIRED。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <label className="block text-xs text-muted-foreground">
              merchant_id / 协议参数
              <input placeholder="第三方商户号" className="mt-1.5 h-10 w-full rounded-md border border-border bg-muted px-3 font-mono text-foreground outline-none focus:border-primary" />
            </label>
            <label className="block text-xs text-muted-foreground">
              secret（提交后密封，不再回显）
              <input type="password" className="mt-1.5 h-10 w-full rounded-md border border-border bg-muted px-3 font-mono text-foreground outline-none focus:border-primary" />
            </label>
            <ReasonBox value={reason} onChange={setReason} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVersionOpen(null)}>取消</Button>
            <Button disabled={!reason.trim()} onClick={() => setVersionOpen(null)}>创建版本</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
