import {
  DAILY_HALT_BPS,
  FEE_BPS,
  MAX_OPEN_POSITIONS,
  MAX_RISK_BPS,
  MIN_NOTIONAL_PENCE,
  SLIPPAGE_BPS,
  TARGET_NET_PENCE,
} from "./config";
import { applyBps, feePence, notionalPence, qtyFromNotional } from "./money";
import type { Proposal } from "./holt";

export function maxRiskPence(equityPence: number): number {
  return Math.max(1, Math.floor((equityPence * MAX_RISK_BPS) / 10_000));
}

export function isDailyHalted(equityPence: number, dayStartPence: number): boolean {
  if (dayStartPence <= 0) return false;
  const floor = Math.floor((dayStartPence * (10_000 - DAILY_HALT_BPS)) / 10_000);
  return equityPence <= floor;
}

export type SizeOk = {
  ok: true;
  qtyE8: number;
  entryE8: number;
  stopE8: number;
  tpE8: number;
  notionalPence: number;
  feePence: number;
  riskPence: number;
};

export type SizeNo = { ok: false; reason: string };

export function sizeTrade(
  proposal: Proposal,
  markE8: number,
  cashPence: number,
  equityPence: number,
  openCount = 0,
): SizeOk | SizeNo {
  if (markE8 <= 0) return { ok: false, reason: "No usable mark to size against." };
  if (cashPence < MIN_NOTIONAL_PENCE) {
    return { ok: false, reason: "Paper cash is too small to put on a new trade." };
  }

  const riskCap = maxRiskPence(equityPence);
  const stopPct = Math.max(0.003, proposal.stopPct);
  let notional = Math.floor(riskCap / stopPct);
  const cashCap = Math.floor(cashPence * 0.92);
  const remainingSlots = Math.max(1, MAX_OPEN_POSITIONS - openCount);
  const splitCap = Math.floor((cashPence * 0.9) / remainingSlots);
  notional = Math.min(notional, cashCap, splitCap);

  if (notional < MIN_NOTIONAL_PENCE) {
    return { ok: false, reason: "Sized notional would be too small after the 1% risk cap." };
  }

  const entryE8 = applyBps(markE8, SLIPPAGE_BPS);
  const qtyE8 = qtyFromNotional(notional, entryE8);
  const actualNotional = Math.max(1, notionalPence(qtyE8, entryE8));
  const entryFee = feePence(actualNotional, FEE_BPS);
  if (actualNotional + entryFee > cashPence) {
    return { ok: false, reason: "Not enough paper cash after fees." };
  }

  const riskPence = Math.max(1, Math.round(actualNotional * stopPct));
  if (riskPence > riskCap + 1) {
    return { ok: false, reason: "Risk would exceed 1% of equity." };
  }

  const exitFeeEst = feePence(actualNotional, FEE_BPS);
  const grossNeed = TARGET_NET_PENCE + entryFee + exitFeeEst;
  const tpPct = actualNotional > 0 ? grossNeed / actualNotional : 0.03;
  const stopE8 = applyBps(entryE8, -Math.round(stopPct * 10_000));
  const tpE8 = applyBps(entryE8, Math.round(tpPct * 10_000));

  return {
    ok: true,
    qtyE8,
    entryE8,
    stopE8,
    tpE8,
    notionalPence: actualNotional,
    feePence: entryFee,
    riskPence,
  };
}

export type TessInput = {
  halted: boolean;
  openCount: number;
  symbolOpen: boolean;
  slotLive: boolean;
  slotStoodDown: boolean;
  riskPence: number;
  equityPence: number;
  ret4h: number;
  boring: boolean;
};

export function tessCheck(input: TessInput): { ok: true } | { ok: false; reason: string } {
  if (input.halted) {
    return { ok: false, reason: "Daily loss halt is on. No new risk." };
  }
  if (input.openCount >= MAX_OPEN_POSITIONS) {
    return { ok: false, reason: "Three positions already open. Cap reached." };
  }
  if (input.slotLive) {
    return { ok: false, reason: "That slot already has a live trade." };
  }
  if (input.slotStoodDown) {
    return { ok: false, reason: "Slot is stood down after its target (or cooldown)." };
  }
  if (input.symbolOpen) {
    return { ok: false, reason: "Already in that coin. One position per pair." };
  }
  if (input.riskPence > maxRiskPence(input.equityPence) + 1) {
    return { ok: false, reason: "Risk is above the 1% equity cap." };
  }
  if (!input.boring && Math.abs(input.ret4h) >= 0.05) {
    return { ok: false, reason: "Move already ran. Chase rule veto." };
  }
  return { ok: true };
}

export function estimatedNetPence(
  qtyE8: number,
  entryE8: number,
  markE8: number,
  entryFee: number,
): number {
  const exitE8 = applyBps(markE8, -SLIPPAGE_BPS);
  const entryNotional = notionalPence(qtyE8, entryE8);
  const exitNotional = notionalPence(qtyE8, exitE8);
  const exitFee = feePence(exitNotional, FEE_BPS);
  return exitNotional - entryNotional - entryFee - exitFee;
}
