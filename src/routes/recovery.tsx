import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Clock3, RefreshCcw } from "lucide-react";
import { useState } from "react";

import { Field, PageHeader, ReasonBox, useRole } from "@/components/console-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { factFailures, stoppedLegs } from "@/lib/paygateway-data";

export const Route = createFileRoute("/recovery")({
  head: () => ({
    meta: [
      { title: "支付恢复中心 | 支付网关配置" },
      { name: "description", content: "重新投递失败事实、恢复已停止查单的渠道腿，全部写入管理员审计。" },
      { property: "og:title", content: "支付恢复中心 | 支付网关配置" },
      { property: "og:description", content: "重新投递失败事实、恢复已停止查单的渠道腿，全部写入管理员审计。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Recovery,
});

type Pending = { id: string; label: string; action: string; audit: string } | null;

function Recovery() {
  const { readOnly } = useRole();
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState("");

  const open = (item: NonNullable<Pending>) => {
    setReason("");
    setPending(item);
  };

  return (
    <>
      <PageHeader
        title="恢复中心"
        subtitle="恢复只重试原 fact_id、原腿与原载荷，不允许修改金额、订单身份或 Provider 状态。"
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="overflow-hidden rounded-md border border-border bg-card">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-semibold">失败事实投递</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              GET /recovery/fact-failures · POST /recovery/fact-failures/{"{id}"}/requeue
            </p>
          </div>
          <div className="divide-y divide-border">
            {factFailures.map((item) => (
              <div key={item.id} className="p-4">
                <div className="flex items-center gap-2">
                  <Clock3 className="size-4 text-danger" />
                  <span className="font-mono text-xs">{item.fact_id}</span>
                  <span className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {item.fact_type}
                  </span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Field label="channel_code">{item.channel_code}</Field>
                  <Field label="attempts">{item.attempts}</Field>
                  <Field label="last_attempt_at">{item.last_attempt_at}</Field>
                </div>
                <p className="mt-3 rounded border border-border bg-muted/50 p-2.5 text-[11px] text-muted-foreground">
                  {item.last_error}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={readOnly || item.trusted_paid_delivered}
                    onClick={() => open({ id: item.fact_id, label: "重新投递事实", action: "requeue", audit: "ADMIN_PAYMENT_FACT_REQUEUED" })}
                  >
                    <RefreshCcw className="size-3.5" />
                    重新投递
                  </Button>
                  {item.trusted_paid_delivered && (
                    <span className="text-[10px] text-muted-foreground">已存在可信 PAID 投递，不可恢复</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-md border border-border bg-card">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-semibold">已停止查单渠道腿</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              GET /recovery/stopped-legs · POST /recovery/stopped-legs/{"{id}"}/resume
            </p>
          </div>
          <div className="divide-y divide-border">
            {stoppedLegs.map((item) => (
              <div key={item.id} className="p-4">
                <div className="flex items-center gap-2">
                  <Clock3 className="size-4 text-warning" />
                  <span className="font-mono text-xs">{item.leg_id}</span>
                  <span className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                    v{item.merchant_version_no}
                  </span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Field label="payment_attempt_id">{item.payment_attempt_id}</Field>
                  <Field label="channel_code">{item.channel_code}</Field>
                  <Field label="stopped_at">{item.stopped_at}</Field>
                </div>
                <p className="mt-3 rounded border border-border bg-muted/50 p-2.5 text-[11px] text-muted-foreground">
                  {item.stop_reason}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={readOnly || item.trusted_paid_delivered}
                    onClick={() => open({ id: item.leg_id, label: "恢复渠道腿查单", action: "resume", audit: "ADMIN_PAYMENT_QUERY_RESUMED" })}
                  >
                    <RefreshCcw className="size-3.5" />
                    恢复查单
                  </Button>
                  {item.trusted_paid_delivered && (
                    <span className="text-[10px] text-muted-foreground">已存在可信 PAID 投递，不可恢复</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <p className="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
        {readOnly
          ? "SUPPORT_OPERATOR 只能查看恢复诊断，无法执行恢复任务。"
          : "恢复动作需要 SUPER_ADMIN 与近期强认证，操作原因和审计动作在同一事务写入 admin_audit。"}
      </p>

      <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono">{pending?.label} · {pending?.id}</DialogTitle>
            <DialogDescription>
              需要近期强认证。审计动作：{pending?.audit}。原载荷不可修改。
            </DialogDescription>
          </DialogHeader>
          <ReasonBox value={reason} onChange={setReason} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>取消</Button>
            <Button variant="destructive" disabled={!reason.trim()} onClick={() => setPending(null)}>确认执行</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
