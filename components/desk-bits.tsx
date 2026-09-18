"use client";

import type { DeskSnapshot } from "@/lib/types";
import { formatGbp, formatPrice } from "@/lib/money";
import { cn } from "@/lib/utils";

export function EquityChart({
  points,
  startPence,
}: {
  points: { ts: number; equityPence: number }[];
  startPence: number;
}) {
  const values = points.length > 0 ? points.map((p) => p.equityPence) : [startPence];
  const last = values[values.length - 1] ?? startPence;
  const up = last >= startPence;
  const min = Math.min(...values, startPence);
  const max = Math.max(...values, startPence);
  const pad = Math.max(20, Math.round((max - min) * 0.12));
  const lo = min - pad;
  const hi = max + pad;
  const w = 640;
  const h = 180;
  const span = Math.max(1, hi - lo);

  const series = values.length === 1 ? [values[0], values[0]] : values;
  const coords = series.map((v, i) => {
    const x = (i / (series.length - 1)) * w;
    const y = h - ((v - lo) / span) * h;
    return [x, y] as const;
  });
  const d = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(" ");
  const startY = h - ((startPence - lo) / span) * h;
  const first = coords[0];
  const lastPt = coords[coords.length - 1];
  const fill = `${d} L${lastPt[0].toFixed(1)},${startY.toFixed(1)} L${first[0].toFixed(1)},${startY.toFixed(1)} Z`;
  const stroke = up ? "#c6ff4a" : "#ff5c6c";
  const fillColor = up ? "rgba(198,255,74,0.16)" : "rgba(255,92,108,0.16)";

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-44 w-full overflow-visible" role="img" aria-label="Equity">
        <line
          x1="0"
          x2={w}
          y1={startY}
          y2={startY}
          stroke="#2a313c"
          strokeDasharray="4 4"
          strokeWidth="1"
        />
        <path d={fill} fill={fillColor} />
        <path d={d} fill="none" stroke={stroke} strokeWidth="2.4" strokeLinejoin="round" />
      </svg>
      <div className="pointer-events-none absolute top-1 left-1 font-mono text-[10px] tracking-wide text-zinc-500">
        START {formatGbp(startPence)}
      </div>
    </div>
  );
}

export function pnlClass(pence: number): string {
  if (pence > 0) return "text-[#c6ff4a]";
  if (pence < 0) return "text-[#ff5c6c]";
  return "text-zinc-200";
}

export function agentTone(agent: string): string {
  switch (agent) {
    case "HOLT":
      return "text-cyan-300";
    case "ILSA":
      return "text-amber-300";
    case "TESS":
      return "text-rose-300";
    case "BRAM":
      return "text-violet-300";
    case "KETT":
      return "text-sky-300";
    default:
      return "text-[#c6ff4a]";
  }
}

export function statusDot(status: string): string {
  if (status === "working") return "bg-[#c6ff4a] animate-pulse";
  if (status === "ok") return "bg-[#c6ff4a]";
  if (status === "veto") return "bg-[#ff5c6c]";
  if (status === "skip") return "bg-zinc-500";
  return "bg-zinc-600";
}

export function SlotPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase",
        status === "live" && "bg-[#c6ff4a]/15 text-[#c6ff4a]",
        status === "stood_down" && "bg-zinc-800 text-zinc-400",
        status === "parked" && "bg-zinc-900 text-zinc-600",
        (status === "idle" || status === "ok") && "bg-zinc-800/80 text-zinc-500",
      )}
    >
      {status === "stood_down" ? "stood down" : status}
    </span>
  );
}

export function Marks({ marks }: { marks: DeskSnapshot["marks"] }) {
  if (marks.length === 0) {
    return <p className="text-xs text-zinc-500">Marks loading…</p>;
  }
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-zinc-400">
      {marks.map((m) => (
        <span key={m.symbol}>
          <span className="text-zinc-500">{m.symbol}</span>{" "}
          {formatPrice(m.gbp)}
        </span>
      ))}
    </div>
  );
}
