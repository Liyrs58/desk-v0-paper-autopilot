import assert from "node:assert/strict";
import test from "node:test";
import { SLOTS } from "./config";
import { isDailyHalted, maxRiskPence, sizeTrade, tessCheck } from "./risk";
import type { Proposal } from "./holt";

const slot = SLOTS[0];
const proposal: Proposal = {
  slot,
  score: 70,
  reason: "test",
  stopPct: 0.008,
  ret4h: 0.02,
  ret1h: -0.004,
  boring: false,
};

test("max risk is 1% of equity in pence", () => {
  assert.equal(maxRiskPence(5000), 50);
});

test("daily halt trips at -5%", () => {
  assert.equal(isDailyHalted(4750, 5000), true);
  assert.equal(isDailyHalted(4751, 5000), false);
});

test("size stays inside cash and 1% risk", () => {
  const sized = sizeTrade(proposal, 60_385 * 1e8, 5000, 5000, 0);
  assert.equal(sized.ok, true);
  if (sized.ok) {
    assert.ok(sized.notionalPence + sized.feePence <= 5000);
    assert.ok(sized.notionalPence <= 1500);
    assert.ok(sized.riskPence <= 50 + 1);
  }
});

test("tess vetoes a full desk and a chase", () => {
  const full = tessCheck({
    halted: false,
    openCount: 3,
    symbolOpen: false,
    slotLive: false,
    slotStoodDown: false,
    riskPence: 40,
    equityPence: 5000,
    ret4h: 0.01,
    boring: false,
  });
  assert.equal(full.ok, false);

  const chase = tessCheck({
    halted: false,
    openCount: 0,
    symbolOpen: false,
    slotLive: false,
    slotStoodDown: false,
    riskPence: 40,
    equityPence: 5000,
    ret4h: 0.06,
    boring: false,
  });
  assert.equal(chase.ok, false);
});
