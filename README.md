# Desk v0 PAPER AUTOPILOT

A hands-off paper trading desk. You watch. The agents run.

This is a **paper simulation**. No real exchange orders. No real money. Numbers include fees, slippage, and losses. A slot that is live aims for **£1 net after fees**, then stands down — that is a target, not a promise.

## Run

```bash
npm i
npm run dev
```

Open [http://localhost:43145](http://localhost:43145) and watch.

The paper bank starts at **£50.00**. Click **Run autopilot cycle** for one pass, or **Run continuous for today** to keep checking.

## What you are looking at

- Shared GBP paper bank (stored as integer pence)
- Six roles in one process: HOLT Scan → ILSA Size → TESS Risk → BRAM Fill → KETT Hold, with DESK Lead
- Public marks for BTC, ETH, SOL, XRP, LTC (Binance when reachable; otherwise CoinGecko / Coinbase / OKX)
- Max 3 open positions, 1% equity risk per trade, −5% London-day halt
- Chase rule: do not enter a move that already ran without a fresh setup
