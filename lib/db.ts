import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { AGENTS, SLOTS, STARTING_BANK_PENCE } from "./config";
import { londonDayKey } from "./clock";

const globalForDb = globalThis as unknown as { __deskDb?: Database.Database };

function dbPath(): string {
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "desk.db");
}

export function getDb(): Database.Database {
  if (globalForDb.__deskDb) return globalForDb.__deskDb;
  const db = new Database(dbPath());
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seed(db);
  globalForDb.__deskDb = db;
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS desk (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cash_pence INTEGER NOT NULL,
      day_start_equity_pence INTEGER NOT NULL,
      day_key TEXT NOT NULL,
      halted INTEGER NOT NULL DEFAULT 0,
      continuous INTEGER NOT NULL DEFAULT 0,
      cycles_today INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_id TEXT NOT NULL,
      slot_name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      qty_e8 INTEGER NOT NULL,
      entry_e8 INTEGER NOT NULL,
      mark_e8 INTEGER NOT NULL,
      entry_fee_pence INTEGER NOT NULL,
      stop_e8 INTEGER NOT NULL,
      tp_e8 INTEGER NOT NULL,
      time_stop_at INTEGER NOT NULL,
      opened_at INTEGER NOT NULL,
      closed_at INTEGER,
      status TEXT NOT NULL,
      exit_reason TEXT,
      realized_pence INTEGER,
      exit_fee_pence INTEGER
    );

    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      agent TEXT NOT NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      slot_id TEXT
    );

    CREATE TABLE IF NOT EXISTS equity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      equity_pence INTEGER NOT NULL,
      cash_pence INTEGER NOT NULL,
      unrealized_pence INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      detail TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS slot_state (
      slot_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      stood_down_until INTEGER,
      last_result_pence INTEGER
    );

    CREATE TABLE IF NOT EXISTS marks (
      symbol TEXT PRIMARY KEY,
      gbp_e8 INTEGER NOT NULL,
      source TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
  `);
}

function seed(db: Database.Database): void {
  const now = Date.now();
  const desk = db.prepare("SELECT id FROM desk WHERE id = 1").get();
  if (!desk) {
    db.prepare(
      `INSERT INTO desk (id, cash_pence, day_start_equity_pence, day_key, halted, continuous, cycles_today)
       VALUES (1, ?, ?, ?, 0, 0, 0)`,
    ).run(STARTING_BANK_PENCE, STARTING_BANK_PENCE, londonDayKey(now));
    db.prepare(
      "INSERT INTO equity (ts, equity_pence, cash_pence, unrealized_pence) VALUES (?, ?, ?, 0)",
    ).run(now, STARTING_BANK_PENCE, STARTING_BANK_PENCE);
    db.prepare(
      "INSERT INTO activity (ts, agent, kind, message, slot_id) VALUES (?, 'DESK', 'lead', ?, NULL)",
    ).run(now, "Paper bank opened at £50.00. Autopilot is idle.");
  }

  const insertAgent = db.prepare(
    "INSERT OR IGNORE INTO agents (id, status, detail, updated_at) VALUES (?, 'idle', 'Idle', ?)",
  );
  for (const agent of AGENTS) insertAgent.run(agent.id, now);

  const insertSlot = db.prepare(
    "INSERT OR IGNORE INTO slot_state (slot_id, status, stood_down_until, last_result_pence) VALUES (?, 'idle', NULL, NULL)",
  );
  for (const slot of SLOTS) insertSlot.run(slot.id);
}

export function resetDb(): void {
  const db = getDb();
  db.exec(`
    DELETE FROM positions;
    DELETE FROM activity;
    DELETE FROM equity;
    DELETE FROM marks;
    UPDATE agents SET status = 'idle', detail = 'Idle', updated_at = ${Date.now()};
    UPDATE slot_state SET status = 'idle', stood_down_until = NULL, last_result_pence = NULL;
    UPDATE desk SET cash_pence = ${STARTING_BANK_PENCE},
      day_start_equity_pence = ${STARTING_BANK_PENCE},
      day_key = '${londonDayKey()}',
      halted = 0,
      continuous = 0,
      cycles_today = 0
      WHERE id = 1;
  `);
  const now = Date.now();
  db.prepare(
    "INSERT INTO equity (ts, equity_pence, cash_pence, unrealized_pence) VALUES (?, ?, ?, 0)",
  ).run(now, STARTING_BANK_PENCE, STARTING_BANK_PENCE);
  db.prepare(
    "INSERT INTO activity (ts, agent, kind, message, slot_id) VALUES (?, 'DESK', 'lead', ?, NULL)",
  ).run(now, "Paper bank reset to £50.00. Autopilot is idle.");
}

export type DeskRow = {
  cash_pence: number;
  day_start_equity_pence: number;
  day_key: string;
  halted: number;
  continuous: number;
  cycles_today: number;
};

export type PositionRow = {
  id: number;
  slot_id: string;
  slot_name: string;
  symbol: string;
  qty_e8: number;
  entry_e8: number;
  mark_e8: number;
  entry_fee_pence: number;
  stop_e8: number;
  tp_e8: number;
  time_stop_at: number;
  opened_at: number;
  closed_at: number | null;
  status: string;
  exit_reason: string | null;
  realized_pence: number | null;
  exit_fee_pence: number | null;
};

export type ActivityRow = {
  id: number;
  ts: number;
  agent: string;
  kind: string;
  message: string;
  slot_id: string | null;
};

export type AgentRow = {
  id: string;
  status: string;
  detail: string;
  updated_at: number;
};

export type SlotRow = {
  slot_id: string;
  status: string;
  stood_down_until: number | null;
  last_result_pence: number | null;
};
