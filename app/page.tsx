"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import {
  Plus,
  ReceiptText,
  Package,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
} from "lucide-react";
import { getBills, getItems } from "@/lib/db";
import { Bill, Item } from "@/lib/types";
import PageHeader from "@/components/PageHeader";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const monthKey = (d: Date) => d.getFullYear() * 12 + d.getMonth();

function fmt(epoch: number) {
  const d = new Date(epoch);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function Dashboard() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    getBills().then(setBills).catch(() => setBills([]));
    getItems().then(setItems).catch(() => setItems([]));
  }, []);

  const now = new Date();
  const tm = monthKey(now);
  const revIn = (off: number) =>
    bills.filter((b) => monthKey(new Date(b.createdAt)) === tm - off).reduce((s, b) => s + b.total, 0);
  const cntIn = (off: number) =>
    bills.filter((b) => monthKey(new Date(b.createdAt)) === tm - off).length;

  const thisRev = revIn(0);
  const lastRev = revIn(1);
  const revTrend = lastRev > 0 ? ((thisRev - lastRev) / lastRev) * 100 : null;
  const billTrend = cntIn(1) > 0 ? ((cntIn(0) - cntIn(1)) / cntIn(1)) * 100 : null;

  const series = useMemo(() => {
    const out: { label: string; value: number }[] = [];
    for (let k = 5; k >= 0; k--) {
      const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
      out.push({
        label: d.toLocaleString("en", { month: "short" }),
        value: bills
          .filter((b) => monthKey(new Date(b.createdAt)) === monthKey(d))
          .reduce((s, b) => s + b.total, 0),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills]);

  // inventory status breakdown
  const inv = useMemo(() => {
    let ok = 0, low = 0, out = 0;
    for (const i of items) {
      const stock = i.stock ?? 0;
      const re = i.reorderLevel ?? 0;
      if (stock <= 0) out++;
      else if (re > 0 && stock <= re) low++;
      else ok++;
    }
    return { ok, low, out };
  }, [items]);

  const donut = [
    { name: "In stock", value: inv.ok, color: "#15803d" },
    { name: "Low", value: inv.low, color: "#b45309" },
    { name: "Out", value: inv.out, color: "#c5333a" },
  ].filter((d) => d.value > 0);

  const lowStock = useMemo(
    () =>
      items
        .filter((i) => ((i.reorderLevel ?? 0) > 0 && (i.stock ?? 0) <= (i.reorderLevel ?? 0)) || (i.stock ?? 0) <= 0)
        .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0)),
    [items]
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        subtitle="Welcome back — here is your business overview."
        action={
          <Link href="/bill/new" className="btn-primary">
            <Plus size={16} strokeWidth={2.4} />
            New Bill
          </Link>
        }
      />

      {/* metrics */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Metric label="Revenue this month" value={inr(thisRev)} trend={revTrend} />
        <Metric label="Bills this month" value={String(cntIn(0))} trend={billTrend} />
        <Metric label="Products" value={String(items.length)} sub="in catalogue" />
        <Metric label="Low stock" value={String(lowStock.length)} sub={lowStock.length ? "need reorder" : "all good"} danger={lowStock.length > 0} />
      </div>

      {/* chart + donut */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <p className="text-[15px] font-bold text-ink">Revenue trend</p>
          <p className="text-xs text-muted">Last 6 months · total {inr(bills.reduce((s, b) => s + b.total, 0))}</p>
          <div className="mt-3 h-[210px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 6, left: 6, bottom: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4338ca" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#4338ca" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#9aa3b2" }} dy={6} />
                <Tooltip
                  formatter={(v) => [inr(Number(v)), "Revenue"]}
                  contentStyle={{ borderRadius: 10, border: "1px solid #e9ebef", fontSize: 12, boxShadow: "0 8px 24px rgba(16,24,40,.1)" }}
                />
                <Area type="monotone" dataKey="value" stroke="#4338ca" strokeWidth={2.5} fill="url(#rev)" dot={{ r: 3, fill: "#fff", stroke: "#4338ca", strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card flex flex-col p-5">
          <p className="text-[15px] font-bold text-ink">Inventory status</p>
          <p className="text-xs text-muted">Across {items.length} products</p>
          {items.length === 0 ? (
            <p className="flex flex-1 items-center justify-center py-10 text-sm text-muted-light">No products yet</p>
          ) : (
            <>
              <div className="relative mx-auto mt-2 h-[150px] w-[150px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donut} dataKey="value" innerRadius={48} outerRadius={70} paddingAngle={2} stroke="none">
                      {donut.map((d) => (
                        <Cell key={d.name} fill={d.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-bold text-ink">{items.length}</span>
                  <span className="text-[10px] text-muted-light">products</span>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <Legend color="#15803d" label="In stock" value={inv.ok} total={items.length} />
                <Legend color="#b45309" label="Low stock" value={inv.low} total={items.length} />
                <Legend color="#c5333a" label="Out of stock" value={inv.out} total={items.length} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* recent + low stock */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <PanelHead title="Recent bills" href="/bills" link="View all" />
          {bills.length === 0 ? (
            <Empty text="No bills yet" />
          ) : (
            bills.slice(0, 5).map((b) => (
              <Link key={b.id} href="/bills" className="flex items-center gap-3 border-b border-line-soft px-5 py-3 last:border-0 hover:bg-canvas">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-tile border border-line bg-canvas text-muted">
                  <ReceiptText size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{b.customerName || `Bill #${b.number}`}</p>
                  <p className="font-mono text-[11px] text-muted-light">#{b.number} · {fmt(b.createdAt)}</p>
                </div>
                <p className="text-sm font-bold text-ink">{inr(b.total)}</p>
              </Link>
            ))
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line-soft px-5 py-3.5">
            <span className="eyebrow">Low stock alerts</span>
            {lowStock.length > 0 ? (
              <span className="pill bg-danger-soft text-danger">{lowStock.length} to reorder</span>
            ) : (
              <Link href="/items" className="text-xs font-semibold text-brand hover:underline">Manage</Link>
            )}
          </div>
          {lowStock.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-10 text-sm text-muted-light">
              <CheckCircle2 size={22} className="text-ok" />
              Everything well stocked
            </div>
          ) : (
            lowStock.slice(0, 6).map((i) => {
              const stock = i.stock ?? 0;
              const reorder = i.reorderLevel ?? 1;
              const pct = Math.max(4, Math.min(100, (stock / Math.max(1, reorder)) * 100));
              return (
                <Link key={i.id} href="/items" className="block border-b border-line-soft px-5 py-3 last:border-0 hover:bg-canvas">
                  <div className="flex items-center justify-between">
                    <p className="truncate text-sm font-semibold text-ink">
                      {i.name}{i.size ? <span className="font-normal text-muted-light"> · {i.size}</span> : null}
                    </p>
                    <span className={`ml-2 flex-none rounded px-1.5 py-0.5 text-[11px] font-bold ${stock <= 0 ? "bg-danger-soft text-danger" : "bg-amber-soft text-amber-deep"}`}>
                      {stock <= 0 ? "Out" : "Low"}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas">
                      <div className={`h-full rounded-full ${stock <= 0 ? "bg-danger" : "bg-amber"}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="font-mono text-[11px] text-muted-light">{stock} / {reorder}</span>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  trend,
  danger,
}: {
  label: string;
  value: string;
  sub?: string;
  trend?: number | null;
  danger?: boolean;
}) {
  return (
    <div className="card p-4 sm:p-5">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      <div className={`mt-2 text-[23px] font-bold tracking-[-.02em] sm:text-[26px] ${danger ? "text-danger" : "text-ink"}`}>
        {value}
      </div>
      {trend != null ? (
        <span className={`mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold ${trend >= 0 ? "text-ok" : "text-danger"}`}>
          {trend >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
          {Math.abs(trend).toFixed(1)}%
          <span className="font-normal text-muted-light">vs last month</span>
        </span>
      ) : (
        <span className="mt-1.5 inline-block text-[11.5px] text-muted-light">{sub ?? "new"}</span>
      )}
    </div>
  );
}

function Legend({ color, label, value, total }: { color: string; label: string; value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: color }} />
      <span className="flex-1 text-muted-dark">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
      <span className="w-9 text-right text-xs text-muted-light">{pct}%</span>
    </div>
  );
}

function PanelHead({ title, href, link }: { title: string; href: string; link: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line-soft px-5 py-3.5">
      <span className="eyebrow">{title}</span>
      <Link href={href} className="text-xs font-semibold text-brand hover:underline">{link}</Link>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-5 py-10 text-center text-sm text-muted-light">{text}</p>;
}
