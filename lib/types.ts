import type { AgentId } from "./config";

export type TraceEvent = {
  agent: AgentId;
  status: "working" | "ok" | "skip" | "veto" | "idle";
  message: string;
};

export type PositionView = {
  id: number;
  slotId: string;
  slotName: string;
  symbol: string;
  qty: string;
  entryGbp: number;
  markGbp: number;
  unrealizedPence: number;
  targetLeftPence: number;
  openedAt: number;
};

export type DeskSnapshot = {
  cashPence: number;
  equityPence: number;
  unrealizedPence: number;
  pnlPence: number;
  winRate: number | null;
  wins: number;
  losses: number;
  closedCount: number;
  halted: boolean;
  dayKey: string;
  continuous: boolean;
  cyclesToday: number;
  marketSource: string;
  marks: { symbol: string; gbp: number }[];
  agents: { id: string; name: string; status: string; detail: string }[];
  positions: PositionView[];
  slots: {
    id: string;
    name: string;
    symbol: string;
    status: string;
    lastResultPence: number | null;
  }[];
  activity: { id: number; ts: number; agent: string; kind: string; message: string }[];
  equity: { ts: number; equityPence: number }[];
  targetPence: number;
  startingBankPence: number;
  error?: string;
};
