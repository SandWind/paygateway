import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  Archive,
  Boxes,
  ChevronRight,
  CircleGauge,
  Clock3,
  DatabaseZap,
  FileClock,
  KeyRound,
  Menu,
  Plus,
  RefreshCcw,
  RouteIcon,
  Search,
  Settings2,
  ShieldCheck,
  Store,
  UsersRound,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// No head() here: the home route inherits title/description/og/twitter from
// __root.tsx, and ships no og:image so serve-time hosting can inject the
// project's social preview (explicit og:image or latest screenshot).
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "支付网关控制台 | PayGrid" },
      { name: "description", content: "管理支付渠道、商户凭据、路由权重与故障恢复。" },
      { property: "og:title", content: "支付网关控制台 | PayGrid" },
      { property: "og:description", content: "安全、可审计的支付网关配置与恢复中心。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Channel = {
  code: string;
  provider: string;
  merchant: string;
  version: string;
  weight: number;
  state: "READY" | "DRAINING" | "DISABLED";
};

const initialChannels: Channel[] = [
  { code: "flrqfpay-primary", provider: "flrqfpay", merchant: "baijie-main", version: "v7", weight: 6200, state: "READY" },
  { code: "peqora-wallet", provider: "peqorapay", merchant: "baijie-wallet", version: "v3", weight: 2800, state: "READY" },
  { code: "mock-fallback", provider: "mock", merchant: "sandbox-default", version: "v12", weight: 1000, state: "DRAINING" },
  { code: "flrqfpay-legacy", provider: "flrqfpay", merchant: "legacy-cn", version: "v4", weight: 0, state: "DISABLED" },
];

const navItems = [
  ["概览", CircleGauge], ["Provider", Boxes], ["渠道", RouteIcon], ["商户", Store],
  ["凭据版本", KeyRound], ["路由", Settings2], ["恢复中心", RefreshCcw], ["审计日志", FileClock],
] as const;

function Status({ value }: { value: Channel["state"] | "RETIRED" | "PENDING" }) {
  const tone = value === "READY" ? "text-success bg-success/10 border-success/20" : value === "DRAINING" || value === "PENDING" ? "text-warning bg-warning/10 border-warning/20" : "text-muted-foreground bg-muted border-border";
  return <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] ${tone}`}><span className="size-1.5 rounded-full bg-current" />{value}</span>;
}

function Index() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [active, setActive] = useState("概览");
  const [role, setRole] = useState<"SUPER_ADMIN" | "SUPPORT_OPERATOR">("SUPER_ADMIN");
  const [query, setQuery] = useState("");
  const [channels, setChannels] = useState(initialChannels);
  const [selected, setSelected] = useState(initialChannels[0].code);
  const [versionOpen, setVersionOpen] = useState(false);
  const [recoveryItem, setRecoveryItem] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const readOnly = role === "SUPPORT_OPERATOR";
  const visibleChannels = useMemo(() => channels.filter((channel) => `${channel.code} ${channel.provider} ${channel.merchant}`.toLowerCase().includes(query.toLowerCase())), [channels, query]);

  const adjustWeight = (code: string, weight: number) => {
    setChannels((items) => items.map((item) => item.code === code ? { ...item, weight } : item));
  };

  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className={`${sidebarOpen ? "w-60" : "w-14"} fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col border-r border-border bg-card transition-[width] md:relative ${sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
        <div className="flex h-16 items-center border-b border-border px-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/15 font-mono font-semibold text-primary">P</div>
          {sidebarOpen && <div className="ml-2.5"><div className="text-sm font-semibold">PAYGRID</div><div className="font-mono text-[10px] text-muted-foreground">GATEWAY OPS</div></div>}
          {sidebarOpen && <Button variant="ghost" size="icon" className="ml-auto md:hidden" aria-label="关闭导航" onClick={() => setSidebarOpen(false)}><X className="size-4" /></Button>}
        </div>
        <nav className="flex-1 space-y-1 px-2 py-4" aria-label="支付网关导航">
          {navItems.map(([label, Icon]) => <Button key={label} variant="ghost" onClick={() => setActive(label)} title={label} className={`w-full justify-start px-3 ${active === label ? "bg-primary/10 text-primary" : ""}`}><Icon className="size-4 shrink-0" />{sidebarOpen && <span>{label}</span>}{sidebarOpen && label === "恢复中心" && <span className="ml-auto size-1.5 rounded-full bg-danger" />}</Button>)}
        </nav>
        <div className="border-t border-border p-3">
          <button className="flex w-full items-center gap-2.5 rounded-md p-2 text-left hover:bg-muted" onClick={() => setRole((value) => value === "SUPER_ADMIN" ? "SUPPORT_OPERATOR" : "SUPER_ADMIN")}>
            <div className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary/20 text-secondary"><UsersRound className="size-4" /></div>
            {sidebarOpen && <div className="min-w-0"><div className="truncate text-xs">Lin · 支付运维</div><div className="mt-0.5 font-mono text-[9px] text-success">{role} · {readOnly ? "READ" : "WRITE"}</div></div>}
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex min-h-16 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur md:px-6">
          <Button variant="ghost" size="icon" aria-label="切换导航" onClick={() => setSidebarOpen((value) => !value)}><Menu className="size-4" /></Button>
          <div className="min-w-0"><h1 className="font-mono text-sm font-semibold">支付网关控制台</h1><p className="hidden text-[11px] text-muted-foreground sm:block">Provider → Channel → Merchant → Version</p></div>
          <div className="relative ml-auto hidden w-60 lg:block"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索渠道、商户或版本" className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-3 text-xs outline-none focus:border-primary" /></div>
          <span className="hidden rounded border border-warning/25 bg-warning/10 px-2.5 py-1 text-[11px] text-warning sm:inline">2 项待处理</span>
          <Button size="sm" onClick={() => setVersionOpen(true)} disabled={readOnly}><Plus className="size-3.5" />新建版本</Button>
        </header>

        <main className="p-4 md:p-6">
          {notice && <div role="status" className="fixed right-5 top-20 z-50 rounded-md border border-success/30 bg-card px-4 py-3 text-xs text-success shadow-xl">{notice}</div>}
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="font-mono text-[10px] text-primary">LIVE CONTROL PLANE</p><h2 className="mt-1 text-xl font-semibold">{active}</h2></div><div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span className="size-2 rounded-full bg-success" />网关运行正常 <span className="font-mono">· 14:32:08 CST</span></div></div>

          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="运行摘要">
            {[["在线渠道", "3 / 4", "3 个可参与路由", Activity], ["有效权重", "10,000", "确定性加权", RouteIcon], ["失败事实", "2", "1 个停止查单", AlertTriangle], ["凭据版本", "16", "3 个 READY", KeyRound]].map(([label, value, note, Icon]) => <article key={label as string} className="rounded-md border border-border bg-card p-4"><div className="flex items-center justify-between text-[11px] text-muted-foreground"><span>{label as string}</span><Icon className="size-4" /></div><div className="mt-2 font-mono text-2xl font-semibold">{value as string}</div><div className={`mt-1 text-[11px] ${label === "失败事实" ? "text-danger" : "text-muted-foreground"}`}>{note as string}</div></article>)}
          </section>

          <section className="mt-5 overflow-hidden rounded-md border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5"><div><h3 className="text-sm font-semibold">路由权重</h3><p className="mt-0.5 text-[11px] text-muted-foreground">有效范围 0–10000 · 乐观锁保护配置更新</p></div><span className="font-mono text-[10px] text-muted-foreground">rev 42</span></div>
            <div className="divide-y divide-border">
              {visibleChannels.map((channel) => <button key={channel.code} onClick={() => setSelected(channel.code)} className={`grid w-full grid-cols-[minmax(150px,1.2fr)_minmax(130px,1fr)_minmax(150px,2fr)_72px] items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-muted/50 ${selected === channel.code ? "bg-muted/70" : ""}`}>
                <div className="min-w-0"><div className="truncate font-mono text-xs">{channel.code}</div><div className="mt-0.5 text-[10px] text-muted-foreground">{channel.provider} · {channel.version}</div></div>
                <div className="truncate text-xs text-muted-foreground">{channel.merchant}</div>
                <div className="flex items-center gap-3"><input aria-label={`${channel.code} 路由权重`} type="range" min="0" max="10000" step="100" value={channel.weight} disabled={readOnly || channel.state === "DISABLED"} onClick={(event) => event.stopPropagation()} onChange={(event) => adjustWeight(channel.code, Number(event.target.value))} className="h-1.5 min-w-0 flex-1 accent-primary" /><span className="w-12 text-right font-mono text-xs">{channel.weight}</span></div>
                <Status value={channel.state} />
              </button>)}
            </div>
          </section>

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <section className="overflow-hidden rounded-md border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-5 py-3.5"><div><h3 className="text-sm font-semibold">不可变凭据版本</h3><p className="mt-0.5 text-[11px] text-muted-foreground">Secret 已密封，后台永不回显</p></div><ShieldCheck className="size-4 text-success" /></div>
              <div className="divide-y divide-border">
                {[["baijie-main", "v7", "READY", "RSA · •••• 8F2A"], ["baijie-wallet", "v3", "READY", "HMAC · •••• 91BC"], ["sandbox-default", "v12", "PENDING", "待校验"], ["legacy-cn", "v4", "RETIRED", "RSA · •••• A122"]].map(([merchant, version, state, digest]) => <div key={`${merchant}-${version}`} className="flex items-center gap-3 px-5 py-3"><DatabaseZap className="size-4 text-muted-foreground" /><div><div className="font-mono text-xs">{merchant}</div><div className="mt-0.5 text-[10px] text-muted-foreground">{digest}</div></div><span className="ml-auto font-mono text-[11px] text-muted-foreground">{version}</span><Status value={state as "READY" | "RETIRED" | "PENDING"} /></div>)}
              </div>
            </section>

            <section className="overflow-hidden rounded-md border border-danger/25 bg-card">
              <div className="flex items-center justify-between border-b border-border px-5 py-3.5"><div><h3 className="flex items-center gap-2 text-sm font-semibold"><span className="size-2 rounded-full bg-danger" />恢复队列</h3><p className="mt-0.5 text-[11px] text-muted-foreground">仅重试原事实与原渠道腿</p></div><span className="font-mono text-[10px] text-danger">STRONG AUTH</span></div>
              <div className="space-y-2.5 p-4">
                {[{ id: "fact_7K2M8", type: "事实投递失败", meta: "flrqfpay-primary · 已耗尽 8 次重试", action: "重新投递" }, { id: "leg_4P9AX", type: "查单已停止", meta: "peqora-wallet · provider_timeout", action: "恢复查单" }].map((item) => <div key={item.id} className="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-3"><Clock3 className="size-4 text-danger" /><div className="min-w-0"><div className="font-mono text-[11px]">{item.id} <span className="font-sans text-muted-foreground">· {item.type}</span></div><div className="mt-1 truncate text-[10px] text-muted-foreground">{item.meta}</div></div><Button variant="danger" size="sm" className="ml-auto" disabled={readOnly} onClick={() => { setReason(""); setRecoveryItem(item.id); }}>{item.action}</Button></div>)}
                <p className="flex items-start gap-2 pt-1 text-[10px] leading-relaxed text-muted-foreground"><AlertTriangle className="mt-0.5 size-3 shrink-0" />恢复操作不会修改金额、订单身份或 Provider 状态，并会写入管理员审计。</p>
              </div>
            </section>
          </div>

          <section className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4 text-[11px] text-muted-foreground"><Archive className="size-3.5" /><span>渠道代码创建后不可变</span><span>·</span><span>每渠道最多一个 ENABLED 商户</span><span>·</span><span>每商户最多一个 READY 版本</span><button className="ml-auto flex items-center gap-1 text-primary hover:underline">查看审计日志 <ChevronRight className="size-3" /></button></section>
        </main>
      </div>

      <Dialog open={versionOpen} onOpenChange={setVersionOpen}><DialogContent className="border-border bg-popover sm:max-w-md"><DialogHeader><DialogTitle className="font-mono">创建商户配置版本</DialogTitle><DialogDescription>新版本不可变。Secret 提交后将被密封，之后仅显示摘要与末尾指纹。</DialogDescription></DialogHeader><div className="space-y-4 py-2"><label className="block text-xs text-muted-foreground">商户<select className="mt-1.5 h-10 w-full rounded-md border border-border bg-muted px-3 text-foreground"><option>baijie-main · flrqfpay</option><option>baijie-wallet · peqorapay</option></select></label><label className="block text-xs text-muted-foreground">Secret<input type="password" placeholder="仅本次输入可见" className="mt-1.5 h-10 w-full rounded-md border border-border bg-muted px-3 font-mono text-foreground outline-none focus:border-primary" /></label><label className="block text-xs text-muted-foreground">操作原因<textarea placeholder="必填，例如：季度密钥轮换" className="mt-1.5 h-20 w-full resize-none rounded-md border border-border bg-muted p-3 text-foreground outline-none focus:border-primary" /></label></div><DialogFooter><Button variant="outline" onClick={() => setVersionOpen(false)}>取消</Button><Button onClick={() => { setVersionOpen(false); notify("新版本已创建，等待配置校验"); }}>创建并校验</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(recoveryItem)} onOpenChange={(open) => !open && setRecoveryItem(null)}><DialogContent className="border-border bg-popover sm:max-w-md"><DialogHeader><DialogTitle className="font-mono">确认恢复 {recoveryItem}</DialogTitle><DialogDescription>此操作需要近期强认证，并将使用原始载荷继续处理。</DialogDescription></DialogHeader><label className="block text-xs text-muted-foreground">操作原因<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="说明本次恢复的判断依据" className="mt-1.5 h-24 w-full resize-none rounded-md border border-border bg-muted p-3 text-foreground outline-none focus:border-primary" /></label><DialogFooter><Button variant="outline" onClick={() => setRecoveryItem(null)}>取消</Button><Button variant="danger" disabled={!reason.trim()} onClick={() => { setRecoveryItem(null); notify("恢复任务已进入队列，审计记录已生成"); }}>确认恢复</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
