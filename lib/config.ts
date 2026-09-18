export const STARTING_BANK_PENCE = 5_000;
export const TARGET_NET_PENCE = 100;
export const FEE_BPS = 10;
export const SLIPPAGE_BPS = 3;
export const MAX_OPEN_POSITIONS = 3;
export const MAX_RISK_BPS = 100;
export const DAILY_HALT_BPS = 500;
export const HOLD_MS = 40 * 60 * 1000;
export const STOP_COOLDOWN_MS = 20 * 60 * 1000;
export const MIN_NOTIONAL_PENCE = 800;
export const MARK_CACHE_MS = 12_000;
export const CONTINUOUS_MS = 8_000;
export const CONTINUOUS_MAX_CYCLES = 72;

export const AGENTS = [
  { id: "HOLT", name: "HOLT Scan" },
  { id: "ILSA", name: "ILSA Size" },
  { id: "TESS", name: "TESS Risk" },
  { id: "BRAM", name: "BRAM Fill" },
  { id: "KETT", name: "KETT Hold" },
  { id: "DESK", name: "DESK Lead" },
] as const;

export type AgentId = (typeof AGENTS)[number]["id"];

export type SlotStyle =
  | "pullback"
  | "range"
  | "momentum"
  | "tight"
  | "grind"
  | "overnight"
  | "parked";

export type PairSymbol = "BTC" | "ETH" | "SOL" | "XRP" | "LTC";

export type Pair = {
  symbol: PairSymbol;
  geckoId: string;
  okx: string;
  coinbase: string | null;
};

export const PAIRS: Pair[] = [
  { symbol: "BTC", geckoId: "bitcoin", okx: "BTC-USDT", coinbase: "BTC-GBP" },
  { symbol: "ETH", geckoId: "ethereum", okx: "ETH-USDT", coinbase: "ETH-GBP" },
  { symbol: "SOL", geckoId: "solana", okx: "SOL-USDT", coinbase: "SOL-GBP" },
  { symbol: "XRP", geckoId: "ripple", okx: "XRP-USDT", coinbase: null },
  { symbol: "LTC", geckoId: "litecoin", okx: "LTC-USDT", coinbase: "LTC-GBP" },
];

export type SlotConfig = {
  id: string;
  name: string;
  symbol: PairSymbol;
  style: SlotStyle;
  enabled: boolean;
};

export const SLOTS: SlotConfig[] = [
  { id: "btc-pullback", name: "BTC Pullback", symbol: "BTC", style: "pullback", enabled: true },
  { id: "eth-fade", name: "ETH Range Fade", symbol: "ETH", style: "range", enabled: true },
  { id: "sol-drift", name: "SOL Drift", symbol: "SOL", style: "pullback", enabled: true },
  { id: "ltc-quiet", name: "LTC Quiet", symbol: "LTC", style: "range", enabled: true },
  { id: "xrp-pulse", name: "XRP Pulse", symbol: "XRP", style: "momentum", enabled: true },
  { id: "btc-overnight", name: "BTC Overnight", symbol: "BTC", style: "overnight", enabled: true },
  { id: "eth-momentum", name: "ETH Momentum", symbol: "ETH", style: "momentum", enabled: true },
  { id: "btc-tight", name: "BTC Tight Stop", symbol: "BTC", style: "tight", enabled: true },
  { id: "eth-grind", name: "ETH Slow Grind", symbol: "ETH", style: "grind", enabled: true },
  { id: "desk-spare", name: "Desk Spare", symbol: "BTC", style: "parked", enabled: false },
];
