import assert from "node:assert/strict";
import test from "node:test";
import { SLOTS } from "./config";
import { evaluateSlot, isSkip, pickBoringTrade, type Candle } from "./holt";

function fromCloses(closes: number[]): Candle[] {
  const now = 1_700_000_000_000;
  const bar = 15 * 60 * 1000;
  return closes.map((c, i) => {
    const prev = closes[i - 1] ?? c;
    return {
      t: now + i * bar,
      o: prev,
      h: Math.max(prev, c) * 1.001,
      l: Math.min(prev, c) * 0.999,
      c,
    };
  });
}

const btc = SLOTS.find((s) => s.id === "btc-pullback")!;
const fade = SLOTS.find((s) => s.id === "eth-fade")!;
const spare = SLOTS.find((s) => s.id === "desk-spare")!;
const overnight = SLOTS.find((s) => s.id === "btc-overnight")!;

test("parked slot never proposes", () => {
  const result = evaluateSlot(spare, fromCloses(Array(20).fill(100)), 12);
  assert.equal(isSkip(result), true);
});

test("chase rule skips a 6% runner with no dip", () => {
  const closes = Array.from({ length: 24 }, (_, i) => 100 * (1 + i * 0.004));
  const result = evaluateSlot(btc, fromCloses(closes), 12);
  assert.equal(isSkip(result), true);
  if (isSkip(result)) assert.match(result.skip, /not chasing|runner/i);
});

test("pullback after a modest rise is a setup", () => {
  const up = Array.from({ length: 20 }, (_, i) => 100 * (1 + i * 0.0016));
  const last = up[up.length - 1];
  const closes = [...up, last * 0.997, last * 0.994, last * 0.991];
  const result = evaluateSlot(btc, fromCloses(closes), 12);
  assert.equal(isSkip(result), false);
});

test("overnight slot is idle during London daytime", () => {
  const result = evaluateSlot(overnight, fromCloses(Array(20).fill(100)), 14);
  assert.equal(isSkip(result), true);
});

test("quiet tape can be picked as the boring trade", () => {
  const quiet = fromCloses(Array.from({ length: 24 }, (_, i) => 100 + (i % 3) * 0.05));
  const pick = pickBoringTrade([fade], { ETH: quiet }, new Set(), new Set());
  assert.ok(pick);
  assert.equal(pick?.boring, true);
});
