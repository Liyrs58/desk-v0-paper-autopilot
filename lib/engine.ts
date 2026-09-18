import {
  AGENTS,
  CONTINUOUS_MAX_CYCLES,
  CONTINUOUS_MS,
  FEE_BPS,
  HOLD_MS,
  MAX_OPEN_POSITIONS,
  PAIRS,
  SLIPPAGE_BPS,
  SLOTS,
  STARTING_BANK_PENCE,
  STOP_COOLDOWN_MS,
  TARGET_NET_PENCE,
  type AgentId,
  type PairSymbol,
} from "./config";
import { londonDayKey, londonHour } from "./clock";
import {
  applyBps,
  feePence,
  formatGbp,
  formatPrice,
  formatQty,
  formatSignedGbp,
  notionalPence,
  priceE8ToGbp,
} from "./money";
import {
  getDb,
  type ActivityRow,
  type AgentRow,
  type DeskRow,
  type PositionRow,
  type SlotRow,
} from "./db";
import { evaluateSlot, isSkip, pickBoringTrade, type Proposal } from "./holt";
import { fetchMarket, type MarketSnapshot } from "./market";
import { estimatedNetPence, isDailyHalted, sizeTrade, tessCheck } from "./risk";
import type { DeskSnapshot, TraceEvent } from "./types";

function log(agent: AgentId, kind: string, message: string, slotId?: string): void {
  getDb()
    .prepare("INSERT INTO activity (ts, agent, kind, message, slot_id) VALUES (?, ?, ?, ?, ?)")
    .run(Date.now(), agent, kind, message, slotId ?? null);
}

function setAgent(id: AgentId, status: string, detail: string): void {
  getDb()
    .prepare("UPDATE agents SET status = ?, detail = ?, updated_at = ? WHERE id = ?")
    .run(status, detail, Date.now(), id);
}

function deskRow(): DeskRow {
  return getDb().prepare("SELECT * FROM desk WHERE id = 1").get() as DeskRow;
}

function openPositions(): PositionRow[] {
  return getDb().prepare("SELECT * FROM positions WHERE status = 'open' ORDER BY opened_at").all() as PositionRow[];
}

function slotRow(id: string): SlotRow {
  return getDb().prepare("SELECT * FROM slot_state WHERE slot_id = ?").get(id) as SlotRow;
}

function unrealizedOf(pos: PositionRow): number {
  return estimatedNetPence(pos.qty_e8, pos.entry_e8, pos.mark_e8, pos.entry_fee_pence);
}

function holdingValue(pos: PositionRow): number {
  return notionalPence(pos.qty_e8, pos.mark_e8);
}

function equityNow(cash: number, positions: PositionRow[]): { equity: number; unrealized: number } {
  const holdings = positions.reduce((s, p) => s + holdingValue(p), 0);
  const closeOut = positions.reduce((s, p) => s + unrealizedOf(p), 0);
  return { equity: cash + holdings, unrealized: closeOut };
}

function persistMarks(market: MarketSnapshot): void {
  const stmt = getDb().prepare(
    "INSERT INTO marks (symbol, gbp_e8, source, ts) VALUES (?, ?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET gbp_e8 = excluded.gbp_e8, source = excluded.source, ts = excluded.ts",
  );
  for (const pair of PAIRS) {
    stmt.run(pair.symbol, market.priceE8[pair.symbol], market.source, market.fetchedAt);
  }
}

function applyMarks(market: MarketSnapshot): void {
  const stmt = getDb().prepare("UPDATE positions SET mark_e8 = ? WHERE status = 'open' AND symbol = ?");
  for (const pair of PAIRS) stmt.run(market.priceE8[pair.symbol], pair.symbol);
}

function snapshotEquity(): void {
  const desk = deskRow();
  const opens = openPositions();
  const { equity, unrealized } = equityNow(desk.cash_pence, opens);
  getDb()
    .prepare("INSERT INTO equity (ts, equity_pence, cash_pence, unrealized_pence) VALUES (?, ?, ?, ?)")
    .run(Date.now(), equity, desk.cash_pence, unrealized);
}

function rollLondonDay(): void {
  const desk = deskRow();
  const today = londonDayKey();
  if (desk.day_key === today) return;
  const opens = openPositions();
  const { equity } = equityNow(desk.cash_pence, opens);
  getDb()
    .prepare(
      "UPDATE desk SET day_key = ?, day_start_equity_pence = ?, halted = 0, cycles_today = 0 WHERE id = 1",
    )
    .run(today, equity);
  getDb()
    .prepare(
      "UPDATE slot_state SET status = 'idle', stood_down_until = NULL WHERE status = 'stood_down'",
    )
    .run();
  log("DESK", "lead", `New London day. Day-start paper equity ${formatGbp(equity)}.`);
}

function refreshHalt(): void {
  const desk = deskRow();
  const { equity } = equityNow(desk.cash_pence, openPositions());
  const halted = isDailyHalted(equity, desk.day_start_equity_pence) ? 1 : 0;
  if (halted && !desk.halted) {
    log(
      "TESS",
      "veto",
      `Daily loss halt. Paper equity ${formatGbp(equity)} is 5% under the London-day start.`,
    );
  }
  if (!halted && desk.halted) {
    log("TESS", "ok", "Daily loss halt cleared.");
  }
  getDb().prepare("UPDATE desk SET halted = ? WHERE id = 1").run(halted);
}

function closePosition(pos: PositionRow, reason: "target" | "stop" | "time", markE8: number): number {
  const exitE8 = applyBps(markE8, -SLIPPAGE_BPS);
  const entryNotional = notionalPence(pos.qty_e8, pos.entry_e8);
  const exitNotional = notionalPence(pos.qty_e8, exitE8);
  const exitFee = feePence(exitNotional, FEE_BPS);
  const realized = exitNotional - entryNotional - pos.entry_fee_pence - exitFee;
  const db = getDb();
  db.prepare(
    `UPDATE positions SET status = 'closed', closed_at = ?, exit_reason = ?, realized_pence = ?, exit_fee_pence = ?, mark_e8 = ?
     WHERE id = ?`,
  ).run(Date.now(), reason, realized, exitFee, markE8, pos.id);
  db.prepare("UPDATE desk SET cash_pence = cash_pence + ? WHERE id = 1").run(exitNotional - exitFee);

  const until = reason === "target" ? londonEndMs() : Date.now() + STOP_COOLDOWN_MS;
  const slotStatus = reason === "target" ? "stood_down" : "idle";
  db.prepare(
    "UPDATE slot_state SET status = ?, stood_down_until = ?, last_result_pence = ? WHERE slot_id = ?",
  ).run(slotStatus, until, realized, pos.slot_id);

  if (reason === "target") {
    log(
      "KETT",
      "close",
      `Closed ${pos.slot_name}. Result ${formatSignedGbp(realized)} after fees. Slot stands down — £1 net target met.`,
      pos.slot_id,
    );
  } else if (reason === "stop") {
    log(
      "KETT",
      "close",
      `Stopped ${pos.slot_name}. Result ${formatSignedGbp(realized)} after fees.`,
      pos.slot_id,
    );
  } else {
    log(
      "KETT",
      "close",
      `Time-stop on ${pos.slot_name}. Result ${formatSignedGbp(realized)} after fees.`,
      pos.slot_id,
    );
  }
  return realized;
}

function londonEndMs(ms = Date.now()): number {
  const day = londonDayKey(ms);
  const noonUtc = Date.parse(`${day}T12:00:00Z`);
  for (let offset = -2; offset <= 26; offset++) {
    const cand = noonUtc + offset * 3600_000;
    if (londonDayKey(cand) === day && londonHour(cand) === 23) {
      const mins = 59 - new Date(cand).getUTCMinutes();
      return cand + mins * 60_000 + 59_000;
    }
  }
  return ms + 8 * 3600_000;
}

function manageHolds(market: MarketSnapshot, trace: TraceEvent[]): void {
  const opens = openPositions();
  if (opens.length === 0) {
    setAgent("KETT", "ok", "No open trades.");
    trace.push({ agent: "KETT", status: "ok", message: "No open trades to manage." });
    log("KETT", "hold", "No open trades to manage.");
    return;
  }

  setAgent("KETT", "working", "Checking exits.");
  let acted = 0;
  for (const pos of opens) {
    const markE8 = market.priceE8[pos.symbol as PairSymbol] ?? pos.mark_e8;
    const net = estimatedNetPence(pos.qty_e8, pos.entry_e8, markE8, pos.entry_fee_pence);
    if (net >= TARGET_NET_PENCE) {
      closePosition(pos, "target", markE8);
      acted += 1;
      continue;
    }
    if (markE8 <= pos.stop_e8) {
      closePosition(pos, "stop", markE8);
      acted += 1;
      continue;
    }
    if (Date.now() >= pos.time_stop_at) {
      closePosition(pos, "time", markE8);
      acted += 1;
    }
  }
  const still = openPositions().length;
  const message =
    acted === 0
      ? `Holding ${still} open trade${still === 1 ? "" : "s"}. Marks updated.`
      : `Worked ${acted} exit${acted === 1 ? "" : "s"}. ${still} still open.`;
  setAgent("KETT", "ok", message);
  trace.push({ agent: "KETT", status: "ok", message });
  if (acted === 0) log("KETT", "hold", message);
}

function expireCooldowns(): void {
  const now = Date.now();
  getDb()
    .prepare(
      "UPDATE slot_state SET status = 'idle', stood_down_until = NULL WHERE status != 'live' AND stood_down_until IS NOT NULL AND stood_down_until <= ?",
    )
    .run(now);
}

function fillProposal(proposal: Proposal, market: MarketSnapshot, trace: TraceEvent[]): void {
  const desk = deskRow();
  const opens = openPositions();
  const { equity } = equityNow(desk.cash_pence, opens);
  const markE8 = market.priceE8[proposal.slot.symbol];

  setAgent("ILSA", "working", `Sizing ${proposal.slot.name}.`);
  const sized = sizeTrade(proposal, markE8, desk.cash_pence, equity, opens.length);
  if (!sized.ok) {
    setAgent("ILSA", "skip", sized.reason);
    setAgent("TESS", "skip", "No ticket.");
    setAgent("BRAM", "skip", "No fill.");
    log("ILSA", "skip", sized.reason, proposal.slot.id);
    trace.push({ agent: "ILSA", status: "skip", message: sized.reason });
    return;
  }
  const sizeMsg = `Sized ${proposal.slot.name} at ${formatGbp(sized.notionalPence)}. If the stop hits, paper loss is about ${formatGbp(sized.riskPence)}.`;
  setAgent("ILSA", "ok", sizeMsg);
  log("ILSA", "size", sizeMsg, proposal.slot.id);
  trace.push({ agent: "ILSA", status: "ok", message: sizeMsg });

  setAgent("TESS", "working", "Risk check.");
  const slot = slotRow(proposal.slot.id);
  const tess = tessCheck({
    halted: desk.halted === 1,
    openCount: opens.length,
    symbolOpen: opens.some((p) => p.symbol === proposal.slot.symbol),
    slotLive: slot.status === "live",
    slotStoodDown: slot.status === "stood_down" && (slot.stood_down_until ?? 0) > Date.now(),
    riskPence: sized.riskPence,
    equityPence: equity,
    ret4h: proposal.ret4h,
    boring: proposal.boring,
  });
  if (!tess.ok) {
    setAgent("TESS", "veto", tess.reason);
    setAgent("BRAM", "skip", "Vetoed.");
    log("TESS", "veto", tess.reason, proposal.slot.id);
    trace.push({ agent: "TESS", status: "veto", message: tess.reason });
    return;
  }
  setAgent("TESS", "ok", "Approved.");
  log("TESS", "ok", `Approved ${proposal.slot.name}.`, proposal.slot.id);
  trace.push({ agent: "TESS", status: "ok", message: `Approved ${proposal.slot.name}.` });

  setAgent("BRAM", "working", "Paper fill.");
  const db = getDb();
  db.prepare("UPDATE desk SET cash_pence = cash_pence - ? WHERE id = 1").run(
    sized.notionalPence + sized.feePence,
  );
  db.prepare(
    `INSERT INTO positions (
      slot_id, slot_name, symbol, qty_e8, entry_e8, mark_e8, entry_fee_pence,
      stop_e8, tp_e8, time_stop_at, opened_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
  ).run(
    proposal.slot.id,
    proposal.slot.name,
    proposal.slot.symbol,
    sized.qtyE8,
    sized.entryE8,
    sized.entryE8,
    sized.feePence,
    sized.stopE8,
    sized.tpE8,
    Date.now() + HOLD_MS,
    Date.now(),
  );
  db.prepare("UPDATE slot_state SET status = 'live', stood_down_until = NULL WHERE slot_id = ?").run(
    proposal.slot.id,
  );
  const fillPx = formatPrice(priceE8ToGbp(sized.entryE8));
  const fillMsg = `Paper-bought ${formatQty(sized.qtyE8)} ${proposal.slot.symbol} at ${fillPx}. Fees ${formatGbp(sized.feePence)}. Not a real order.`;
  setAgent("BRAM", "ok", fillMsg);
  log("BRAM", "fill", fillMsg, proposal.slot.id);
  trace.push({ agent: "BRAM", status: "ok", message: fillMsg });
}

function scanForEntry(market: MarketSnapshot, trace: TraceEvent[]): void {
  const desk = deskRow();
  const opens = openPositions();
  expireCooldowns();

  if (desk.halted === 1) {
    const msg = "No new risk. Daily loss halt is on.";
    setAgent("HOLT", "skip", msg);
    setAgent("ILSA", "skip", msg);
    setAgent("TESS", "veto", msg);
    setAgent("BRAM", "skip", msg);
    log("TESS", "veto", msg);
    trace.push({ agent: "TESS", status: "veto", message: msg });
    return;
  }
  if (opens.length >= MAX_OPEN_POSITIONS) {
    const msg = "Three positions already open. Scan still ran; no new ticket.";
    setAgent("HOLT", "skip", msg);
    setAgent("ILSA", "skip", "Desk full.");
    setAgent("TESS", "veto", "Cap reached.");
    setAgent("BRAM", "skip", "No fill.");
    log("TESS", "veto", "Three positions already open. Cap reached.");
    trace.push({ agent: "TESS", status: "veto", message: "Three positions already open. Cap reached." });
    return;
  }

  setAgent("HOLT", "working", "Scanning slots.");
  const blockedSymbols = new Set(opens.map((p) => p.symbol));
  const blockedSlots = new Set<string>();
  const proposals: Proposal[] = [];
  const hour = market.londonHour;

  for (const slot of SLOTS) {
    const state = slotRow(slot.id);
    if (state.status === "live") {
      blockedSlots.add(slot.id);
      continue;
    }
    if (state.status === "stood_down" && (state.stood_down_until ?? 0) > Date.now()) {
      blockedSlots.add(slot.id);
      continue;
    }
    const candles = market.candles[slot.symbol] ?? [];
    const result = evaluateSlot(slot, candles, hour);
    if (isSkip(result)) {
      const notable = /already ran|never the runner|not chasing/i.test(result.skip);
      if (notable) log("HOLT", "skip", `${slot.name}: ${result.skip}`, slot.id);
      continue;
    }
    proposals.push(result);
  }

  proposals.sort((a, b) => b.score - a.score);
  let pick = proposals[0];
  if (!pick) {
    const boring = pickBoringTrade(SLOTS, market.candles, blockedSymbols, blockedSlots);
    if (boring) {
      pick = boring;
      log("HOLT", "scan", `${pick.slot.name}: ${pick.reason}`, pick.slot.id);
    }
  } else {
    log("HOLT", "scan", `${pick.slot.name}: ${pick.reason}`, pick.slot.id);
  }

  if (!pick) {
    const msg = "No fresh setup across the book. Nothing to size.";
    setAgent("HOLT", "skip", msg);
    setAgent("ILSA", "skip", "No ticket.");
    setAgent("TESS", "skip", "No ticket.");
    setAgent("BRAM", "skip", "No fill.");
    log("HOLT", "skip", msg);
    trace.push({ agent: "HOLT", status: "skip", message: msg });
    return;
  }

  setAgent("HOLT", "ok", `${pick.slot.name}: ${pick.reason}`);
  trace.push({ agent: "HOLT", status: "ok", message: `${pick.slot.name}: ${pick.reason}` });
  fillProposal(pick, market, trace);
}

const cycleLock = { on: false };

export async function runAutopilotCycle(): Promise<{ snapshot: DeskSnapshot; trace: TraceEvent[] }> {
  if (cycleLock.on) {
    return {
      snapshot: await getSnapshot(),
      trace: [{ agent: "DESK", status: "skip", message: "Cycle already running." }],
    };
  }
  cycleLock.on = true;
  const trace: TraceEvent[] = [];
  try {
    rollLondonDay();
    expireCooldowns();
    const db = getDb();
    db.prepare("UPDATE desk SET cycles_today = cycles_today + 1 WHERE id = 1").run();
    setAgent("DESK", "working", "Cycle running.");
    log("DESK", "lead", "Autopilot cycle started.");
    trace.push({ agent: "DESK", status: "working", message: "Autopilot cycle started." });

    let market: MarketSnapshot;
    try {
      market = await fetchMarket(true);
      persistMarks(market);
      applyMarks(market);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Public prices unavailable.";
      setAgent("HOLT", "skip", msg);
      setAgent("KETT", "skip", "No fresh marks.");
      setAgent("DESK", "skip", msg);
      log("DESK", "lead", `Cycle skipped. ${msg}`);
      trace.push({ agent: "DESK", status: "skip", message: msg });
      return { snapshot: await getSnapshot(msg), trace };
    }

    manageHolds(market, trace);
    refreshHalt();
    scanForEntry(market, trace);
    snapshotEquity();
    refreshHalt();

    const snap = await getSnapshot();
    const end = snap.halted
      ? `Cycle done. Paper equity ${formatGbp(snap.equityPence)}. New risk halted.`
      : `Cycle done. Paper equity ${formatGbp(snap.equityPence)}. P&L ${formatSignedGbp(snap.pnlPence)}.`;
    setAgent("DESK", "ok", end);
    log("DESK", "lead", end);
    trace.push({ agent: "DESK", status: "ok", message: end });
    return { snapshot: snap, trace };
  } finally {
    cycleLock.on = false;
  }
}

export async function getSnapshot(error?: string): Promise<DeskSnapshot> {
  rollLondonDay();
  const db = getDb();
  let marketError = error;
  try {
    const market = await fetchMarket();
    persistMarks(market);
    applyMarks(market);
  } catch (err) {
    marketError = marketError ?? (err instanceof Error ? err.message : "Prices unavailable.");
  }
  refreshHalt();

  const desk = deskRow();
  const opens = openPositions();
  const { equity, unrealized } = equityNow(desk.cash_pence, opens);
  const closed = db
    .prepare("SELECT realized_pence FROM positions WHERE status = 'closed' AND realized_pence IS NOT NULL")
    .all() as { realized_pence: number }[];
  const wins = closed.filter((r) => r.realized_pence > 0).length;
  const losses = closed.filter((r) => r.realized_pence <= 0).length;

  const agents = (db.prepare("SELECT * FROM agents").all() as AgentRow[]).map((row) => ({
    id: row.id,
    name: AGENTS.find((a) => a.id === row.id)?.name ?? row.id,
    status: row.status,
    detail: row.detail,
  }));

  const slotStates = db.prepare("SELECT * FROM slot_state").all() as SlotRow[];
  const slots = SLOTS.map((slot) => {
    const state = slotStates.find((s) => s.slot_id === slot.id);
    return {
      id: slot.id,
      name: slot.name,
      symbol: slot.symbol,
      status: slot.enabled ? (state?.status ?? "idle") : "parked",
      lastResultPence: state?.last_result_pence ?? null,
    };
  });

  const activity = (
    db.prepare("SELECT * FROM activity ORDER BY id DESC LIMIT 80").all() as ActivityRow[]
  ).map((row) => ({
    id: row.id,
    ts: row.ts,
    agent: row.agent,
    kind: row.kind,
    message: row.message,
  }));

  const equityRows = db
    .prepare("SELECT ts, equity_pence FROM equity ORDER BY id DESC LIMIT 80")
    .all() as { ts: number; equity_pence: number }[];

  const markRows = db.prepare("SELECT symbol, gbp_e8, source FROM marks").all() as {
    symbol: string;
    gbp_e8: number;
    source: string;
  }[];
  const marks = PAIRS.map((p) => {
    const row = markRows.find((m) => m.symbol === p.symbol);
    return { symbol: p.symbol, gbp: row ? priceE8ToGbp(row.gbp_e8) : 0 };
  }).filter((m) => m.gbp > 0);

  return {
    cashPence: desk.cash_pence,
    equityPence: equity,
    unrealizedPence: unrealized,
    pnlPence: equity - STARTING_BANK_PENCE,
    winRate: closed.length === 0 ? null : wins / closed.length,
    wins,
    losses,
    closedCount: closed.length,
    halted: desk.halted === 1,
    dayKey: desk.day_key,
    continuous: desk.continuous === 1,
    cyclesToday: desk.cycles_today,
    marketSource: markRows[0]?.source ?? "waiting",
    marks,
    agents,
    positions: opens.map((p) => {
      const u = unrealizedOf(p);
      return {
        id: p.id,
        slotId: p.slot_id,
        slotName: p.slot_name,
        symbol: p.symbol,
        qty: formatQty(p.qty_e8),
        entryGbp: priceE8ToGbp(p.entry_e8),
        markGbp: priceE8ToGbp(p.mark_e8),
        unrealizedPence: u,
        targetLeftPence: TARGET_NET_PENCE - u,
        openedAt: p.opened_at,
      };
    }),
    slots,
    activity,
    equity: equityRows.reverse().map((row) => ({ ts: row.ts, equityPence: row.equity_pence })),
    targetPence: TARGET_NET_PENCE,
    startingBankPence: STARTING_BANK_PENCE,
    error: marketError,
  };
}

const g = globalThis as unknown as {
  __deskTimer?: ReturnType<typeof setInterval>;
  __deskCont?: boolean;
};

export function startContinuous(): void {
  getDb().prepare("UPDATE desk SET continuous = 1 WHERE id = 1").run();
  g.__deskCont = true;
  log("DESK", "lead", "Continuous mode on for the London day. Cycles every 8 seconds.");
  if (g.__deskTimer) return;
  void runAutopilotCycle().catch(() => undefined);
  g.__deskTimer = setInterval(() => {
    if (!g.__deskCont) return;
    const desk = deskRow();
    if (desk.continuous !== 1 || desk.cycles_today >= CONTINUOUS_MAX_CYCLES) {
      stopContinuous("Continuous run stopped.");
      return;
    }
    void runAutopilotCycle().catch(() => undefined);
  }, CONTINUOUS_MS);
}

export function stopContinuous(message = "Continuous mode off."): void {
  g.__deskCont = false;
  getDb().prepare("UPDATE desk SET continuous = 0 WHERE id = 1").run();
  if (g.__deskTimer) {
    clearInterval(g.__deskTimer);
    g.__deskTimer = undefined;
  }
  log("DESK", "lead", message);
  setAgent("DESK", "idle", "Idle");
}

export function ensureContinuousTimer(): void {
  const desk = deskRow();
  if (desk.continuous === 1 && !g.__deskTimer) startContinuous();
}
