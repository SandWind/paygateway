import { Link } from "@tanstack/react-router";
import { Boxes, CircleGauge, Menu, RefreshCcw, RouteIcon, ShieldCheck, UsersRound, X } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { Role } from "@/lib/paygateway-data";
import { stateTone } from "@/lib/paygateway-data";

const RoleContext = createContext<{ role: Role; readOnly: boolean; setRole: (role: Role) => void }>({
  role: "SUPER_ADMIN",
  readOnly: false,
  setRole: () => {},
});

export const useRole = () => useContext(RoleContext);

export function StateBadge({ value }: { value: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] ${stateTone[value] ?? "text-muted-foreground bg-muted border-border"}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {value}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-xs break-all">{children}</div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="font-mono text-[10px] text-primary">PAYMENT GATEWAY CONTROL PLANE</p>
        <h1 className="mt-1 text-xl font-semibold">{title}</h1>
        <p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

const nav = [
  { to: "/", label: "概览", icon: CircleGauge },
  { to: "/providers", label: "Provider", icon: Boxes },
  { to: "/channels", label: "渠道 / 商户 / 版本", icon: RouteIcon },
  { to: "/recovery", label: "恢复中心", icon: RefreshCcw },
] as const;

export function ConsoleShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>("SUPER_ADMIN");
  const readOnly = role === "SUPPORT_OPERATOR";

  return (
    <RoleContext.Provider value={{ role, readOnly, setRole }}>
      <div className="flex min-h-screen bg-background text-foreground">
        {open && (
          <button
            aria-label="关闭导航"
            className="fixed inset-0 z-30 bg-background/70 md:hidden"
            onClick={() => setOpen(false)}
          />
        )}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-card transition-transform md:relative md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
        >
          <div className="flex h-16 items-center gap-2.5 border-b border-border px-4">
            <div className="grid size-8 place-items-center rounded-md bg-primary/15 font-mono font-semibold text-primary">P</div>
            <div>
              <div className="text-sm font-semibold">支付网关配置</div>
              <div className="font-mono text-[10px] text-muted-foreground">admin-api :8081</div>
            </div>
            <Button variant="ghost" size="icon" className="ml-auto md:hidden" aria-label="关闭导航" onClick={() => setOpen(false)}>
              <X className="size-4" />
            </Button>
          </div>
          <nav className="flex-1 space-y-1 px-2 py-4" aria-label="支付网关导航">
            {nav.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to as "/"}
                onClick={() => setOpen(false)}
                activeOptions={{ exact: to === "/" }}
                className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                activeProps={{ className: "bg-primary/10 text-primary" }}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </Link>
            ))}
          </nav>
          <div className="border-t border-border p-3">
            <button
              className="flex w-full items-center gap-2.5 rounded-md p-2 text-left hover:bg-muted"
              onClick={() => setRole(readOnly ? "SUPER_ADMIN" : "SUPPORT_OPERATOR")}
            >
              <div className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary/20 text-secondary">
                <UsersRound className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-xs">Lin · 支付运维</div>
                <div className="mt-0.5 font-mono text-[9px] text-muted-foreground">
                  {role} · {readOnly ? "READ ONLY" : "READ / WRITE"}
                </div>
              </div>
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex min-h-14 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur md:px-6">
            <Button variant="ghost" size="icon" aria-label="打开导航" className="md:hidden" onClick={() => setOpen(true)}>
              <Menu className="size-4" />
            </Button>
            <p className="font-mono text-[11px] text-muted-foreground">Provider → Channel → Merchant → Merchant Version</p>
            <span className="ml-auto flex items-center gap-1.5 rounded border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground">
              <ShieldCheck className="size-3 text-success" />
              CSRF · 强认证 · admin_audit
            </span>
          </header>
          <main className="p-4 md:p-6">{children}</main>
        </div>
      </div>
    </RoleContext.Provider>
  );
}

export function ReasonBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-xs text-muted-foreground">
      操作原因（必填，写入 admin_audit）
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="例如：季度密钥轮换"
        className="mt-1.5 h-20 w-full resize-none rounded-md border border-border bg-muted p-3 text-foreground outline-none focus:border-primary"
      />
    </label>
  );
}
