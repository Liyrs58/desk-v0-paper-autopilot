export function gbpToPence(gbp: number): number {
  return Math.round(gbp * 100);
}

export function gbpToPriceE8(gbp: number): number {
  return Math.round(gbp * 1e8);
}

export function priceE8ToGbp(priceE8: number): number {
  return priceE8 / 1e8;
}

const SCALE_14 = BigInt(10) ** BigInt(14);

export function notionalPence(qtyE8: number, priceE8: number): number {
  if (qtyE8 <= 0 || priceE8 <= 0) return 0;
  return Number((BigInt(qtyE8) * BigInt(priceE8)) / SCALE_14);
}

export function qtyFromNotional(notionalPence: number, priceE8: number): number {
  if (notionalPence <= 0 || priceE8 <= 0) return 0;
  return Number((BigInt(notionalPence) * SCALE_14) / BigInt(priceE8));
}

export function applyBps(priceE8: number, bps: number): number {
  return Number((BigInt(priceE8) * BigInt(10_000 + bps)) / BigInt(10_000));
}

export function feePence(notional: number, feeBps: number): number {
  return Math.round((notional * feeBps) / 10_000);
}

export function groupThousands(n: number): string {
  return String(Math.trunc(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatGbp(pence: number): string {
  const sign = pence < 0 ? "−" : "";
  const abs = Math.abs(pence);
  const pounds = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}£${groupThousands(pounds)}.${frac}`;
}

export function formatPrice(gbp: number): string {
  if (!Number.isFinite(gbp) || gbp === 0) return "£0.00";
  const sign = gbp < 0 ? "−" : "";
  const abs = Math.abs(gbp);
  const decimals = abs >= 1 ? 2 : 4;
  const [whole, frac = "00"] = abs.toFixed(decimals).split(".");
  return `${sign}£${groupThousands(Number(whole))}.${frac}`;
}

export function formatSignedGbp(pence: number): string {
  if (pence > 0) return `+${formatGbp(pence)}`;
  return formatGbp(pence);
}

export function formatQty(qtyE8: number): string {
  const n = qtyE8 / 1e8;
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.01) return n.toFixed(5);
  return n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatPct(frac: number): string {
  const pct = frac * 100;
  const body = Math.abs(pct) >= 10 ? pct.toFixed(1) : pct.toFixed(2);
  if (pct > 0) return `+${body}%`;
  if (pct < 0) return `${body}%`;
  return "0.00%";
}
