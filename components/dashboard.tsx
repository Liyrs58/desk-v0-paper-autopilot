"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EquityChart, Marks, SlotPill, agentTone, pnlClass, statusDot } from "@/components/desk-bits";
import type { DeskSnapshot, TraceEvent } from "@/lib/types";
import { londonClock, londonStamp } from "@/lib/clock";
import { formatGbp, formatPrice, formatSignedGbp } from "@/lib/money";
import { cn } from "@/lib/utils";

export function Dashboard({ initial }: { initial: DeskSnapshot }) {
  const [snap, setSnap] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<TraceEvent[] | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const mutation = useRef(0);
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    const started = mutation.current;
    try {
      const res = await fetch("/api/desk", { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as DeskSnapshot;
      if (mutation.current !== started) return;
      setSnap(next);
    } catch {
      /* keep last frame */
    }
  }, []);

  useEffect(() => {
    setNow(Date.now());
    void refresh();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => {
      void refresh();
    }, 4000);
    return () => {
      clearInterval(clock);
      clearInterval(poll);
    };
  }, [refresh]);

  async function runCycle() {
    busyRef.current = true;
    setBusy(true);
    const mine = ++mutation.current;
    try {
      const res = await fetch("/api/cycle", { method: "POST", cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { snapshot?: DeskSnapshot; trace?: TraceEvent[] };
      if (!data.snapshot || mutation.current !== mine) return;
      setSnap(data.snapshot);
      setFlash(data.trace ?? []);
      window.setTimeout(() => setFlash(null), 4000);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function setContinuous(enabled: boolean) {
    busyRef.current = true;
    setBusy(true);
    const mine = ++mutation.current;
    try {
      const res = await fetch("/api/continuous", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) return;
      const next = (await res.json()) as DeskSnapshot;
      if (mutation.current !== mine) return;
      setSnap(next);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function resetBank() {
    busyRef.current = true;
    setBusy(true);
    const mine = ++mutation.current;
    try {
      const res = await fetch("/api/reset", { method: "POST", cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as DeskSnapshot;
      if (mutation.current !== mine) return;
      setSnap(next);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const winLabel = useMemo(() => {
    if (snap.winRate === null) return "—";
    return `${Math.round(snap.winRate * 100)}%`;
  }, [snap.winRate]);

  return (
    <div className="min-h-full bg-[#050607] text-zinc-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-white/8 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-mono text-[11px] tracking-[0.28em] text-[#c6ff4a]">DESK v0</p>
              <span className="rounded-full border border-[#c6ff4a]/30 bg-[#c6ff4a]/10 px-2 py-0.5 font-mono text-[10px] tracking-widest text-[#c6ff4a]">
                PAPER
              </span>
              {snap.continuous && (
                <span className="flex items-center gap-1 rounded-full bg-[#c6ff4a]/10 px-2 py-0.5 font-mono text-[10px] tracking-widest text-[#c6ff4a]">
                  <span className="size-1.5 animate-pulse rounded-full bg-[#c6ff4a]" />
                  LIVE
                </span>
              )}
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">PAPER AUTOPILOT</h1>
            <p className="mt-1 text-sm text-zinc-500">Hands-off paper desk. Watch the numbers.</p>
          </div>
          <div className="text-left sm:text-right">
            <p className="font-mono text-xs text-zinc-400" suppressHydrationWarning>
              {now === null ? "London" : londonClock(now)}
            </p>
            <p className="font-mono text-[11px] text-zinc-600">London · GBP</p>
          </div>
        </header>

        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <Marks marks={snap.marks} />
          <p className="font-mono text-[11px] text-zinc-600">{snap.marketSource}</p>
        </div>

        {snap.error && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {snap.error}
          </div>
        )}
        {snap.halted && (
          <div className="rounded-lg border border-[#ff5c6c]/30 bg-[#ff5c6c]/10 px-3 py-2 text-sm text-[#ff8b96]">
            Daily loss halt. No new risk until the next London day.
          </div>
        )}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Bank" value={formatGbp(snap.equityPence)} hint={`Cash ${formatGbp(snap.cashPence)}`} />
          <Stat
            label="Total P&L"
            value={formatSignedGbp(snap.pnlPence)}
            hint={snap.unrealizedPence ? `Open ${formatSignedGbp(snap.unrealizedPence)}` : "Closed + open"}
            valueClass={pnlClass(snap.pnlPence)}
          />
          <Stat
            label="Win rate"
            value={winLabel}
            hint={snap.closedCount ? `${snap.wins} up / ${snap.losses} down` : "No closed trades"}
          />
          <Stat
            label="Open"
            value={String(snap.positions.length)}
            hint={`Cap 3 · target ${formatGbp(snap.targetPence)} net`}
          />
        </section>

        <section className="flex flex-wrap gap-2">
          {snap.agents.map((agent) => (
            <div
              key={agent.id}
              className="flex min-w-[9.5rem] flex-1 items-center gap-2 rounded-full border border-white/8 bg-[#0c0e12] px-3 py-1.5"
            >
              <span className={cn("size-1.5 rounded-full", statusDot(agent.status))} />
              <div className="min-w-0">
                <p className="font-mono text-[11px] tracking-wide text-zinc-200">{agent.name}</p>
                <p className="truncate text-[10px] text-zinc-500">{agent.detail}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="relative z-10 flex flex-col gap-2 sm:flex-row">
          <button
            id="run-cycle"
            type="button"
            disabled={busy}
            onClick={() => void runCycle()}
            className="h-12 flex-1 cursor-pointer rounded-xl bg-[#c6ff4a] px-6 text-base font-semibold text-[#081000] hover:bg-[#d7ff75] disabled:cursor-wait disabled:opacity-70"
          >
            {busy ? "Running…" : "Run autopilot cycle"}
          </button>
          <button
            id="run-continuous"
            type="button"
            disabled={busy}
            onClick={() => void setContinuous(!snap.continuous)}
            className="h-12 flex-1 cursor-pointer rounded-xl border border-[#c6ff4a]/40 bg-transparent px-6 text-base font-semibold text-[#c6ff4a] hover:bg-[#c6ff4a]/10 disabled:cursor-wait disabled:opacity-70"
          >
            {snap.continuous ? "Stop continuous" : "Run continuous for today"}
          </button>
        </section>

        {flash && flash.length > 0 && (
          <p className="font-mono text-xs text-zinc-400">
            Last cycle: {flash[flash.length - 1]?.message}
          </p>
        )}

        <section className="grid gap-4 lg:grid-cols-12">
          <div className="rounded-2xl border border-white/8 bg-[#0b0d11] p-4 lg:col-span-8">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-300">Equity</h2>
              <p className="font-mono text-[11px] text-zinc-500">{snap.cyclesToday} cycles today</p>
            </div>
            <EquityChart points={snap.equity} startPence={snap.startingBankPence} />
          </div>

          <div className="rounded-2xl border border-white/8 bg-[#0b0d11] p-4 lg:col-span-4">
            <h2 className="mb-3 text-sm font-medium text-zinc-300">Open positions</h2>
            {snap.positions.length === 0 ? (
              <p className="text-sm text-zinc-500">None open.</p>
            ) : (
              <ul className="space-y-3">
                {snap.positions.map((pos) => (
                  <li key={pos.id} className="border-b border-white/5 pb-3 last:border-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-medium">
                        {pos.symbol} <span className="text-zinc-500">· {pos.slotName}</span>
                      </p>
                      <p className={cn("font-mono text-sm", pnlClass(pos.unrealizedPence))}>
                        {formatSignedGbp(pos.unrealizedPence)}
                      </p>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-zinc-500">
                      {pos.qty} @ {formatPrice(pos.entryGbp)} · mark {formatPrice(pos.markGbp)}
                    </p>
                    <p className="font-mono text-[11px] text-zinc-600">
                      To £1 net: {formatSignedGbp(Math.max(0, pos.targetLeftPence))}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-white/8 bg-[#0b0d11] p-4 lg:col-span-7">
            <h2 className="mb-3 text-sm font-medium text-zinc-300">Activity</h2>
            {snap.activity.length === 0 ? (
              <p className="text-sm text-zinc-500">Desk is quiet.</p>
            ) : (
              <ol className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
                {snap.activity.map((row) => (
                  <li key={row.id} className="flex gap-3">
                    <span className="w-14 shrink-0 font-mono text-[11px] text-zinc-600">
                      {londonStamp(row.ts)}
                    </span>
                    <div>
                      <p className={cn("font-mono text-[11px] tracking-wide", agentTone(row.agent))}>
                        {row.agent}
                      </p>
                      <p className="text-sm leading-snug text-zinc-300">{row.message}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="rounded-2xl border border-white/8 bg-[#0b0d11] p-4 lg:col-span-5">
            <h2 className="mb-3 text-sm font-medium text-zinc-300">Strategy slots</h2>
            <ul className="space-y-2">
              {snap.slots.map((slot) => (
                <li key={slot.id} className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-zinc-200">{slot.name}</p>
                    <p className="font-mono text-[11px] text-zinc-600">{slot.symbol}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {slot.lastResultPence !== null && (
                      <span className={cn("font-mono text-[11px]", pnlClass(slot.lastResultPence))}>
                        {formatSignedGbp(slot.lastResultPence)}
                      </span>
                    )}
                    <SlotPill status={slot.status} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <footer className="flex flex-col gap-2 border-t border-white/8 pt-4 text-xs text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
          <p>Paper simulation. No real orders. Fees and slippage are included. Losses happen.</p>
          <button
            type="button"
            onClick={() => void resetBank()}
            disabled={busy}
            className="text-left text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline disabled:opacity-50"
          >
            Reset paper bank to £50.00
          </button>
        </footer>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  valueClass,
}: {
  label: string;
  value: string;
  hint: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-[#0b0d11] px-4 py-3">
      <p className="font-mono text-[10px] tracking-[0.2em] text-zinc-500 uppercase">{label}</p>
      <p className={cn("mt-1 font-mono text-2xl tracking-tight sm:text-3xl", valueClass ?? "text-zinc-50")}>
        {value}
      </p>
      <p className="mt-1 text-[11px] text-zinc-600">{hint}</p>
    </div>
  );
}
