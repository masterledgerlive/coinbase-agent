# 🌊 coinbase-agent

> **Agentic AI crypto trading on Coinbase Advanced Trade.**
> Autonomous wave detection, Fibonacci exits, zero gas fees.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/Platform-Railway-blueviolet.svg)](https://railway.app)
[![Exchange](https://img.shields.io/badge/Exchange-Coinbase%20Advanced-0052FF.svg)](https://advanced.coinbase.com)

---

## What Is This?

coinbase-agent is a fully autonomous trading bot that runs 24/7 on [Railway](https://railway.app) and trades directly on Coinbase Advanced Trade — no blockchain, no gas fees, no wallets to manage.

It detects natural price cycles using the **Ehlers Dominant Cycle** algorithm, confirms entries and exits with RSI, MACD, and Bollinger Bands, and executes Fibonacci-laddered partial exits to lock in profit at each wave peak.

You set it up once. It runs forever. Every trade is reported to your Telegram.

---

## Why Coinbase Instead of On-Chain?

| | coinbase-agent | On-chain bot (e.g. Guardian Protocol) |
|---|---|---|
| Gas fees | ❌ None | ✅ ~$0.20–0.50 per trade |
| Candle history on boot | ✅ 300 candles instantly | ⏳ Must watch for hours first |
| Token liquidity | ✅ Deep CEX order books | ⚠️ Thin DEX pools, slippage risk |
| Execution speed | ✅ Milliseconds | ⏳ 45s blockchain confirm |
| Slippage | ✅ None on majors | ⚠️ Can be severe on small tokens |
| Arms on first boot | ✅ Yes | ❌ No — needs warm-up period |

---

## Token Watchlist

| Token | Pair | Priority | Notes |
|-------|------|----------|-------|
| Ethereum | ETH-USD | 🔴 P1 | Anchor token. Always watching. |
| Bitcoin | BTC-USD | 🔴 P1 | Drives all other cycles. |
| Solana | SOL-USD | 🔴 P1 | Highest wave amplitude of majors. |
| Chainlink | LINK-USD | 🔴 P1 | Reliable 3–5 day wave cycles. |
| Polygon | MATIC-USD | 🔴 P1 | Base ecosystem adjacent. |
| Dogecoin | DOGE-USD | 🔴 P1 | Meme momentum plays. |
| Kite AI | KITE-USD | 🟡 P1+ | Special watchlist — wave reversal alerts. |
| Virtual Protocol | VIRTUAL-USD | 🟠 P2 | Added after stable. |
| Aerodrome | AERO-USD | 🟠 P2 | Added after stable. |
| Brett | BRETT-USD | 🟠 P2 | Added after stable. |

---

## Algorithm

```
Boot
 └─ Load 300 × 1hr candles per token (12.5 days of history, instant)
 └─ Ehlers Dominant Cycle → finds natural wave rhythm (e.g. 20hr for ETH)
 └─ RSI + MACD + Bollinger Bands initialized
 └─ Wave detection → needs 4 confirmed peaks + 4 confirmed troughs to ARM

Every 5 minutes (per token)
 └─ Fetch live price
 └─ Recalculate all indicators
 └─ If ARMED + trough confirmed + RSI oversold + MACD bullish → BUY
 └─ If position open + Fibonacci target hit + MACD bearish → SELL (partial)
 └─ Profit gate: never sells at net loss after fees
 └─ Telegram alert on every event
```

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                   coinbase-agent                    │
│                                                     │
│  ┌──────────────┐    ┌──────────────────────────┐  │
│  │ Ehlers Cycle │───▶│     Wave Engine          │  │
│  │  Predictor   │    │  (peaks + troughs)       │  │
│  └──────────────┘    └──────────┬───────────────┘  │
│                                 │                   │
│  ┌──────────────┐    ┌──────────▼───────────────┐  │
│  │  RSI / MACD  │───▶│   Signal Confirmation    │  │
│  │     / BB     │    │   (buy / sell gate)      │  │
│  └──────────────┘    └──────────┬───────────────┘  │
│                                 │                   │
│  ┌──────────────┐    ┌──────────▼───────────────┐  │
│  │  Fibonacci   │───▶│    Order Execution       │  │
│  │   Ladder     │    │  (Coinbase market order) │  │
│  └──────────────┘    └──────────┬───────────────┘  │
│                                 │                   │
│                      ┌──────────▼───────────────┐  │
│                      │    Telegram Alerts        │  │
│                      └──────────────────────────┘  │
└─────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
  Coinbase Advanced               GitHub (state)
  Trade API                       bot-state branch
```

---

## Setup Guide

### Prerequisites
- A [Coinbase](https://coinbase.com) account (Advanced Trade enabled)
- A [GitHub](https://github.com) account
- A [Railway](https://railway.app) account
- A Telegram bot (create one free via [@BotFather](https://t.me/BotFather))
- Node.js 18+ (only needed if running locally)

---

### Step 1 — Fork or clone this repo

```bash
git clone https://github.com/YOUR_USERNAME/coinbase-agent.git
cd coinbase-agent
```

> **On Chromebook:** Press `Ctrl+Alt+T` to open the terminal, or use the Linux environment.

---

### Step 2 — Get your Coinbase API keys

1. Go to [coinbase.com](https://coinbase.com) → log in
2. Click your profile picture → **Settings**
3. Click **API** in the left sidebar
4. Click **New API Key**
5. Name it: `coinbase-agent`
6. Permissions: ✅ **View** and ✅ **Trade** — do NOT check Transfer
7. Click **Create Key**
8. ⚠️ Copy the **secret immediately** — you only see it once

---

### Step 3 — Create a `.env` file (local testing only)

```bash
cp .env.example .env
```

Open `.env` and fill in your values:

```
COINBASE_API_KEY=your_api_key_here
COINBASE_API_SECRET=your_api_secret_here
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
```

> **In Railway (production):** Never commit a `.env` file. Add variables directly in the Railway dashboard → Variables tab. The `.gitignore` in this repo already blocks `.env` from being uploaded to GitHub.

---

### Step 4 — Deploy to Railway

1. Push this repo to your GitHub account
2. Go to [railway.app](https://railway.app) → **New Project**
3. Click **Deploy from GitHub repo**
4. Select your `coinbase-agent` repo
5. Click the service → **Variables** tab
6. Add the 4 variables from Step 3
7. Click **Deploy**

Railway detects `package.json` and runs `node coinbase-agent.js` automatically.

---

### Step 5 — Verify it's running

Railway → **Deployments** → click the latest build → view logs.

You should see:
```
✅ All environment variables present
[BOOT] Fetching account balances...
[CANDLES] ETH-USD: 300 candles loaded ✅
[CANDLES] BTC-USD: 300 candles loaded ✅
```

And a boot message in your Telegram within 60 seconds.

---

### Step 6 — Set your KITE entry price (optional)

If you hold KITE and want precise profit alerts, open `coinbase-agent.js` and find:

```javascript
const KITE_ENTRY_PRICE = null;
```

Change `null` to your actual average buy price:

```javascript
const KITE_ENTRY_PRICE = 0.25; // replace with your real entry price
```

Commit, push, Railway redeploys automatically.

---

## Telegram Commands

> *(Available from Phase 3 onward — bot currently sends alerts, commands coming soon)*

| Command | What it does |
|---------|-------------|
| `/status` | Full portfolio report — all positions, P&L |
| `/positions` | Open positions with entry price and % gain/loss |
| `/waves` | Wave status for all tokens (armed / building) |
| `/fib SYMBOL` | Full Fibonacci ladder for one token (e.g. `/fib KITE`) |
| `/race` | Racehorse standings — best performing token this cycle |
| `/sell SYMBOL` | Manual full sell (emergency override) |
| `/sellhalf SYMBOL` | Sell 50% of a position |
| `/buy SYMBOL` | Manual buy at current price |
| `/bank` | Full capital statement |
| `/help` | All commands |

---

## Phase Roadmap

- [x] **Phase 1 — Foundation**
  Auth, price feeds, 300-candle history loader, Ehlers cycle predictor, RSI/MACD/Bollinger Bands, wave detection engine, KITE watchlist with Telegram alerts

- [ ] **Phase 2 — Trading Engine**
  Buy/sell execution via Coinbase market orders, position sizing, stale position handling, dry-run mode

- [ ] **Phase 3 — Fibonacci Exits**
  6-level partial sell ladder (100% → 261.8%), profit gates, Telegram commands, `/sell` override

- [ ] **Phase 4 — Intelligence Layer**
  Big Kahuna whale radar (order book pressure), Smart Money signal (top wallet tracking), volume surge detection

- [ ] **Phase 5 — Shared Brain**
  Writes `shared-intelligence.json` to GitHub after every trade → Guardian Protocol reads it to pre-arm Base chain positions before price moves

---

## Relation to Guardian Protocol

This bot is the CEX companion to **Guardian Protocol**, which trades Base chain tokens on Uniswap V3.

```
Guardian Protocol              coinbase-agent
(Base chain / Uniswap V3)      (Coinbase Advanced Trade)
        │                               │
        │◄──── shared-intelligence ─────┤
        │       (GitHub JSON sync)      │
        ▼                               ▼
 Small-cap Base tokens          ETH / BTC / SOL / KITE
 Compound wave by wave          Profits top up Guardian ETH
```

The two bots compound together: Coinbase earns on liquid majors → tops up Guardian's ETH wallet → Guardian trades Base ecosystem tokens → both share wave signal data via GitHub.

---

## Environment Variables Reference

| Variable | Where to get it | Required |
|----------|----------------|----------|
| `COINBASE_API_KEY` | Coinbase → Settings → API | ✅ |
| `COINBASE_API_SECRET` | Coinbase → Settings → API | ✅ |
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) on Telegram | ✅ |
| `TELEGRAM_CHAT_ID` | Send a message to your bot, then visit `api.telegram.org/bot<TOKEN>/getUpdates` | ✅ |
| `GITHUB_TOKEN` | GitHub → Settings → Developer Settings → Personal Access Tokens | Phase 5 |
| `GITHUB_REPO` | `your_username/coinbase-agent` | Phase 5 |
| `STATE_BRANCH` | `bot-state` | Phase 5 |

---

## Disclaimer

This software is provided for educational purposes only. Cryptocurrency trading involves substantial risk of loss. The algorithm does not guarantee profitable trades. Never invest more than you can afford to lose entirely. You are solely responsible for all trading activity conducted by this bot on your account.

---

## License

[MIT](LICENSE) — free to use, fork, and build on.

---

*coinbase-agent v1.0 · Companion to Guardian Protocol v14.5*
*Built with Node.js · Deployed on Railway · Trading on Coinbase Advanced*
