import type { SlotConfig } from "./config";

export type Candle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
};

export type Proposal = {
  slot: SlotConfig;
  score: number;
  reason: string;
  stopPct: number;
  ret4h: number;
  ret1h: number;
  boring: boolean;
};

export type Skip = {
  slot: SlotConfig;
  skip: string;
};

export type ScanResult = Proposal | Skip;

export function isSkip(result: ScanResult): result is Skip {
  return "skip" in result;
}

function pct(from: number, to: number): number {
  if (from === 0) return 0;
  return (to - from) / from;
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function closeAgo(candles: Candle[], bars: number): number {
  const idx = Math.max(0, candles.length - 1 - bars);
  return candles[idx].c;
}

export function returnsFromCandles(candles: Candle[]): { ret1h: number; ret4h: number } {
  const close = candles[candles.length - 1].c;
  const spanMs = candles.length > 1 ? candles[candles.length - 1].t - candles[0].t : 0;
  const barMs = candles.length > 1 ? spanMs / (candles.length - 1) : 15 * 60 * 1000;
  const bars1h = Math.max(1, Math.round((60 * 60 * 1000) / barMs));
  const bars4h = Math.max(2, Math.round((4 * 60 * 60 * 1000) / barMs));
  return {
    ret1h: pct(closeAgo(candles, bars1h), close),
    ret4h: pct(closeAgo(candles, bars4h), close),
  };
}

export function evaluateSlot(
  slot: SlotConfig,
  candles: Candle[],
  londonHourNow: number,
): ScanResult {
  if (!slot.enabled || slot.style === "parked") {
    return { slot, skip: "Slot parked. Not in the live book." };
  }

  if (slot.style === "overnight" && londonHourNow >= 6 && londonHourNow < 22) {
    return { slot, skip: "Overnight slot only runs 22:00–06:00 London." };
  }

  if (candles.length < 12) {
    return { slot, skip: "Not enough market data to judge a setup." };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] ?? last;
  const { ret1h, ret4h } = returnsFromCandles(candles);
  const pullback = last.c < last.o && last.c <= prev.c;

  const window = candles.slice(-14);
  const atr = avg(window.map((c) => c.h - c.l));
  const atrPct = last.c > 0 ? atr / last.c : 0.01;
  const rangeBars = candles.slice(-12);
  const rangeHigh = Math.max(...rangeBars.map((c) => c.h));
  const rangeLow = Math.min(...rangeBars.map((c) => c.l));
  const rangePct = last.c > 0 ? (rangeHigh - rangeLow) / last.c : 0;
  const loc = rangeHigh === rangeLow ? 0.5 : (last.c - rangeLow) / (rangeHigh - rangeLow);

  if (Math.abs(ret4h) >= 0.045 && !pullback) {
    return {
      slot,
      skip: `Already ran ${Math.abs(ret4h * 100).toFixed(1)}% in 4 hours. Waiting for a fresh setup — not chasing.`,
    };
  }
  if (ret1h >= 0.025 && !pullback) {
    return {
      slot,
      skip: `Last hour jumped ${(ret1h * 100).toFixed(2)}%. Size the boring trade, never the runner.`,
    };
  }

  let score = 0;
  let reason = "";
  let stopPct = Math.max(0.004, Math.min(0.012, atrPct * 1.35));

  if (slot.style === "pullback" || slot.style === "tight") {
    if (ret4h > 0.006 && ret4h < 0.045 && pullback) {
      score = 72 + (0.045 - ret4h) * 180;
      reason = "Modest rise, then a dip. Fresh enough to size, not a runner.";
      if (slot.style === "tight") stopPct = Math.max(0.0035, stopPct * 0.72);
    }
  }

  if (slot.style === "range" || slot.style === "grind") {
    if (rangePct < 0.03 && loc <= 0.38) {
      score = 66 + (0.38 - loc) * 90;
      reason = "Quiet range, price sitting near the lower end. Boring on purpose.";
    }
  }

  if (slot.style === "momentum" || slot.style === "overnight") {
    if (ret1h > 0.002 && ret1h < 0.015 && Math.abs(ret4h) < 0.035) {
      score = 58 + ret1h * 350;
      reason = "Small fresh drift, not an extended move.";
    }
  }

  if (score <= 0) {
    return {
      slot,
      skip: `No setup. 4h ${formatMove(ret4h)}, last hour ${formatMove(ret1h)}.`,
    };
  }

  return { slot, score, reason, stopPct, ret4h, ret1h, boring: false };
}

export function pickBoringTrade(
  slots: SlotConfig[],
  candlesBySymbol: Record<string, Candle[]>,
  blockedSymbols: Set<string>,
  blockedSlotIds: Set<string>,
): Proposal | null {
  const ranked: Proposal[] = [];
  for (const slot of slots) {
    if (!slot.enabled || slot.style === "parked") continue;
    if (blockedSlotIds.has(slot.id) || blockedSymbols.has(slot.symbol)) continue;
    const candles = candlesBySymbol[slot.symbol];
    if (!candles || candles.length < 8) continue;
    const { ret1h, ret4h } = returnsFromCandles(candles);
    const abs4 = Math.abs(ret4h);
    if (abs4 >= 0.018) continue;
    if (Math.abs(ret1h) >= 0.012) continue;
    const stopPct = Math.max(0.0045, Math.min(0.01, 0.006 + abs4));
    ranked.push({
      slot,
      score: 40 + (0.018 - abs4) * 800,
      reason: `Quiet tape (${formatMove(ret4h)} over 4 hours). Sizing the boring trade.`,
      stopPct,
      ret4h,
      ret1h,
      boring: true,
    });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0] ?? null;
}

function formatMove(frac: number): string {
  const pct = frac * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}
