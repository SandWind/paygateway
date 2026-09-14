import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
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
import { adapterTypes, providers } from "@/lib/paygateway-data";

export const Route = createFileRoute("/providers")({
  head: () => ({
    meta: [
      { title: "Provider 登记 | 支付网关配置" },
      { name: "description", content: "登记支付 Provider 并绑定编译期注册的适配器类型。" },
      { property: "og:title", content: "Provider 登记 | 支付网关配置" },
      { property: "og:description", content: "登记支付 Provider 并绑定编译期注册的适配器类型。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Providers,
});

function Providers() {
  const { readOnly } = useRole();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <>
      <PageHeader
        title="Provider"
        subtitle="GET/POST/PATCH /v1/admin/payment-gateways/providers · 适配器由代码编译期注册，后台只能选择已注册类型。"
        actions={
          <Button size="sm" disabled={readOnly} onClick={() => { setReason(""); setOpen(true); }}>
            <Plus className="size-3.5" />
            登记 Provider
          </Button>
        }
      />

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {providers.map((provider) => (
          <article key={provider.id} className="rounded-md border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-sm">{provider.provider_code}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{provider.display_name}</div>
              </div>
              <StateBadge value={provider.status} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="adapter_type">{provider.adapter_type}</Field>
              <Field label="channel_count">{provider.channel_count}</Field>
              <Field label="capabilities">
                {adapterTypes.find((type) => type.adapter_type === provider.adapter_type)?.capabilities.join(" · ") ?? "—"}
              </Field>
              <Field label="updated_at">{provider.updated_at}</Field>
            </div>
          </article>
        ))}
      </div>

      <section className="mt-5 rounded-md border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">已注册适配器类型</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">GET /v1/admin/payment-gateways/adapter-types</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {adapterTypes.map((type) => (
            <span key={type.adapter_type} className="rounded border border-border bg-muted px-2.5 py-1 font-mono text-[11px]">
              {type.adapter_type}
            </span>
          ))}
        </div>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono">登记 Provider</DialogTitle>
            <DialogDescription>provider_code 与适配器类型建立绑定，创建后不可更换适配器。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <label className="block text-xs text-muted-foreground">
              provider_code
              <input placeholder="例如 flrqfpay" className="mt-1.5 h-10 w-full rounded-md border border-border bg-muted px-3 font-mono text-foreground outline-none focus:border-primary" />
            </label>
            <label className="block text-xs text-muted-foreground">
              adapter_type
              <select className="mt-1.5 h-10 w-full rounded-md border border-border bg-muted px-3 font-mono text-foreground">
                {adapterTypes.map((type) => (
                  <option key={type.adapter_type}>{type.adapter_type}</option>
                ))}
              </select>
            </label>
            <ReasonBox value={reason} onChange={setReason} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button disabled={!reason.trim()} onClick={() => setOpen(false)}>提交</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
