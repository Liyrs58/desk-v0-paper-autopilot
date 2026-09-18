import { MARK_CACHE_MS, PAIRS, type PairSymbol } from "./config";
import { londonHour } from "./clock";
import { gbpToPriceE8 } from "./money";
import type { Candle } from "./holt";

export type MarketSnapshot = {
  prices: Record<PairSymbol, number>;
  priceE8: Record<PairSymbol, number>;
  candles: Record<PairSymbol, Candle[]>;
  source: string;
  fetchedAt: number;
  londonHour: number;
};

type Cache = { snap: MarketSnapshot; at: number };
const g = globalThis as unknown as { __deskMarket?: Cache };

async function fetchJson(url: string, timeoutMs = 7000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function syntheticCandles(closes: number[], now = Date.now(), barMs = 60 * 60 * 1000): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    const prev = closes[i - 1] ?? c;
    candles.push({
      t: now - (closes.length - 1 - i) * barMs,
      o: prev,
      h: Math.max(prev, c),
      l: Math.min(prev, c),
      c,
    });
  }
  return candles;
}

function scaleSparkline(spark: number[], gbp: number): number[] {
  const last = spark[spark.length - 1] || 1;
  return spark.map((p) => gbp * (p / last));
}

async function fromCoinGecko(): Promise<MarketSnapshot> {
  const ids = PAIRS.map((p) => p.geckoId).join(",");
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=gbp&ids=${ids}&order=market_cap_desc&sparkline=true&price_change_percentage=1h,24h`;
  const rows = (await fetchJson(url)) as Array<{
    id: string;
    current_price: number;
    sparkline_in_7d?: { price: number[] };
  }>;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const prices = {} as Record<PairSymbol, number>;
  const priceE8 = {} as Record<PairSymbol, number>;
  const candles = {} as Record<PairSymbol, Candle[]>;
  const now = Date.now();
  for (const pair of PAIRS) {
    const row = byId.get(pair.geckoId);
    if (!row?.current_price) throw new Error(`missing ${pair.symbol}`);
    prices[pair.symbol] = row.current_price;
    priceE8[pair.symbol] = gbpToPriceE8(row.current_price);
    const spark = row.sparkline_in_7d?.price ?? [];
    const hourly = spark.length > 0 ? scaleSparkline(spark.slice(-36), row.current_price) : [row.current_price];
    candles[pair.symbol] = syntheticCandles(hourly, now);
  }
  return { prices, priceE8, candles, source: "CoinGecko GBP", fetchedAt: now, londonHour: londonHour(now) };
}

type OkxCandle = [string, string, string, string, string];

async function okxCandles(instId: string): Promise<Candle[]> {
  const json = (await fetchJson(
    `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=15m&limit=96`,
  )) as { data?: OkxCandle[] };
  const rows = json.data ?? [];
  return rows
    .map((row) => ({
      t: Number(row[0]),
      o: Number(row[1]),
      h: Number(row[2]),
      l: Number(row[3]),
      c: Number(row[4]),
    }))
    .sort((a, b) => a.t - b.t);
}

async function fromCoinbaseOkx(): Promise<MarketSnapshot> {
  const now = Date.now();
  const cb = await Promise.all(
    PAIRS.map(async (pair) => {
      if (!pair.coinbase) return [pair.symbol, null] as const;
      try {
        const json = (await fetchJson(
          `https://api.exchange.coinbase.com/products/${pair.coinbase}/ticker`,
        )) as { price?: string };
        return [pair.symbol, json.price ? Number(json.price) : null] as const;
      } catch {
        return [pair.symbol, null] as const;
      }
    }),
  );
  const gbp: Partial<Record<PairSymbol, number>> = {};
  for (const [symbol, price] of cb) {
    if (price) gbp[symbol] = price;
  }

  const btcUsdtRows = await okxCandles("BTC-USDT");
  const btcUsdt = btcUsdtRows[btcUsdtRows.length - 1]?.c;
  const btcGbp = gbp.BTC;
  if (!btcUsdt || !btcGbp) throw new Error("no FX");
  const fx = btcGbp / btcUsdt;

  const candles = {} as Record<PairSymbol, Candle[]>;
  const prices = {} as Record<PairSymbol, number>;
  const priceE8 = {} as Record<PairSymbol, number>;

  await Promise.all(
    PAIRS.map(async (pair) => {
      const raw = await okxCandles(pair.okx);
      candles[pair.symbol] = raw.map((c) => ({
        t: c.t,
        o: c.o * fx,
        h: c.h * fx,
        l: c.l * fx,
        c: c.c * fx,
      }));
      const last = candles[pair.symbol][candles[pair.symbol].length - 1]?.c;
      const mark = gbp[pair.symbol] ?? last;
      if (!mark) throw new Error(`no mark ${pair.symbol}`);
      prices[pair.symbol] = mark;
      priceE8[pair.symbol] = gbpToPriceE8(mark);
    }),
  );

  return {
    prices,
    priceE8,
    candles,
    source: "Coinbase GBP + OKX candles",
    fetchedAt: now,
    londonHour: londonHour(now),
  };
}

async function fromBinance(): Promise<MarketSnapshot> {
  const host = "https://api.binance.com";
  const now = Date.now();
  const btcGbpJson = (await fetchJson(`${host}/api/v3/ticker/price?symbol=BTCGBP`, 2500)) as {
    price?: string;
    msg?: string;
  };
  if (!btcGbpJson.price) throw new Error(btcGbpJson.msg || "binance blocked");
  const btcUsdtJson = (await fetchJson(`${host}/api/v3/ticker/price?symbol=BTCUSDT`, 2500)) as {
    price: string;
  };
  const fx = Number(btcGbpJson.price) / Number(btcUsdtJson.price);

  const prices = {} as Record<PairSymbol, number>;
  const priceE8 = {} as Record<PairSymbol, number>;
  const candles = {} as Record<PairSymbol, Candle[]>;

  await Promise.all(
    PAIRS.map(async (pair) => {
      const klines = (await fetchJson(
        `${host}/api/v3/klines?symbol=${pair.symbol}USDT&interval=15m&limit=96`,
        2500,
      )) as Array<[number, string, string, string, string]>;
      if (!Array.isArray(klines) || klines.length < 8) throw new Error(`klines ${pair.symbol}`);
      candles[pair.symbol] = klines.map((row) => ({
        t: Number(row[0]),
        o: Number(row[1]) * fx,
        h: Number(row[2]) * fx,
        l: Number(row[3]) * fx,
        c: Number(row[4]) * fx,
      }));
      const last = candles[pair.symbol][candles[pair.symbol].length - 1].c;
      prices[pair.symbol] = last;
      priceE8[pair.symbol] = gbpToPriceE8(last);
    }),
  );

  return {
    prices,
    priceE8,
    candles,
    source: "Binance USDT→GBP",
    fetchedAt: now,
    londonHour: londonHour(now),
  };
}

export async function fetchMarket(force = false): Promise<MarketSnapshot> {
  const hit = g.__deskMarket;
  if (!force && hit && Date.now() - hit.at < MARK_CACHE_MS) return hit.snap;

  const errors: string[] = [];
  for (const loader of [fromCoinGecko, fromCoinbaseOkx, fromBinance]) {
    try {
      const snap = await loader();
      g.__deskMarket = { snap, at: Date.now() };
      return snap;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (hit) return hit.snap;
  throw new Error(`Public prices unavailable (${errors.join("; ")})`);
}
