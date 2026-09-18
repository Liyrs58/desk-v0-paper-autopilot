import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBps,
  feePence,
  formatGbp,
  formatSignedGbp,
  notionalPence,
  qtyFromNotional,
} from "./money";

test("formatGbp keeps pence as two digits", () => {
  assert.equal(formatGbp(5000), "£50.00");
  assert.equal(formatGbp(0), "£0.00");
  assert.equal(formatGbp(-122), "−£1.22");
  assert.equal(formatSignedGbp(100), "+£1.00");
  assert.equal(formatGbp(123456), "£1,234.56");
});

test("notional uses integer pence via bigint", () => {
  const priceE8 = 60_385 * 1e8;
  const qtyE8 = qtyFromNotional(4_000, priceE8);
  const notional = notionalPence(qtyE8, priceE8);
  assert.ok(Math.abs(notional - 4000) <= 1);
});

test("fees are 0.1% rounded to pence", () => {
  assert.equal(feePence(10_000, 10), 10);
  assert.equal(feePence(4_210, 10), 4);
});

test("slippage moves a long entry against the desk", () => {
  const mark = 10_000_000_000;
  const slipped = applyBps(mark, 3);
  assert.ok(slipped > mark);
});
