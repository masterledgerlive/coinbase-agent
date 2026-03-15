// ============================================================
// COINBASE-AGENT v1.0 — Phase 1 Foundation
// Agentic AI Trading System — Coinbase Advanced Trade API
// Algorithm: Ehlers Dominant Cycle + Wave Engine + RSI/MACD/BB
// ============================================================

import crypto from 'crypto';
import https from 'https';

// ─── CONFIG ───────────────────────────────────────────────────
const CB_BASE = 'api.coinbase.com';
const CB_PATH = '/api/v3/brokerage';

// Token watchlist — Priority 1 + KITE immediately
const TOKENS = [
  'ETH-USD',
  'BTC-USD',
  'SOL-USD',
  'LINK-USD',
  'MATIC-USD',
  'DOGE-USD',
  // KITE — operator holds 777 tokens, watching for wave reversal
  'KITE-USD',
];

// Granularity: 3600 = 1-hour candles (300 candles = 12.5 days of history)
// On boot we get 12.5 days of history instantly — bot arms immediately
const CANDLE_GRANULARITY = 'ONE_HOUR';
const CANDLE_SECONDS     = 3600;
const CANDLE_COUNT       = 300;

// Cycle interval — check every 5 minutes
const CYCLE_MS = 5 * 60 * 1000;

// Minimum confirmed peaks/troughs before trading
const MIN_PEAKS   = 4;
const MIN_TROUGHS = 4;

// Profit gate — Coinbase has no gas, so threshold is lower than Guardian
const MIN_NET_MARGIN = 0.003; // 0.3% — vs 0.5% on Base chain

// Coinbase taker fee (standard tier)
const CB_FEE = 0.006; // 0.6% round-trip (buy + sell)

// KITE alert thresholds
const KITE_ENTRY_PRICE = null; // Set this to your actual buy price after first run
                               // Example: 0.85  — bot will alert at 25% Fib exit

// ─── ENV CHECK ────────────────────────────────────────────────
function checkEnv() {
  const required = [
    'COINBASE_API_KEY',
    'COINBASE_API_SECRET',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error('❌ Missing environment variables:', missing.join(', '));
    console.error('Add these in Railway → your project → Variables tab');
    process.exit(1);
  }
  console.log('✅ All environment variables present');
}

// ─── AUTH — COINBASE HMAC-SHA256 ──────────────────────────────
// Coinbase Advanced Trade requires a signed header on every request.
// The signature proves the request came from you without sending your secret.
function getCbHeaders(method, path, body = '') {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message   = timestamp + method.toUpperCase() + path + body;
  const sig = crypto
    .createHmac('sha256', process.env.COINBASE_API_SECRET)
    .update(message)
    .digest('hex');

  return {
    'CB-ACCESS-KEY':       process.env.COINBASE_API_KEY,
    'CB-ACCESS-SIGN':      sig,
    'CB-ACCESS-TIMESTAMP': timestamp,
    'Content-Type':        'application/json',
  };
}

// ─── HTTP HELPER ──────────────────────────────────────────────
// A simple wrapper around Node's built-in https module.
// No npm packages needed — this runs with zero dependencies beyond dotenv.
function cbRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const bodyStr  = body ? JSON.stringify(body) : '';
    const headers  = getCbHeaders(method, path, bodyStr);
    const options  = {
      hostname: CB_BASE,
      path,
      method,
      headers,
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`JSON parse failed: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── PUBLIC REQUEST (no auth — for candles, ticker) ───────────
// Candles and ticker are public endpoints — no signature needed.
function publicRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: CB_BASE,
      path,
      method:  'GET',
      headers: { 'Content-Type': 'application/json' },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`JSON parse failed: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// ─── PRICE FETCH ──────────────────────────────────────────────
// Gets the current best bid/ask for a token.
// We use the mid-price (average of bid and ask) for wave calculations.
async function fetchPrice(productId) {
  try {
    const path = `${CB_PATH}/best_bid_ask?product_ids=${productId}`;
    const data = await cbRequest('GET', path);

    if (!data.pricebooks || data.pricebooks.length === 0) {
      throw new Error(`No price data for ${productId}`);
    }

    const book = data.pricebooks[0];
    const bid  = parseFloat(book.bids[0]?.price || 0);
    const ask  = parseFloat(book.asks[0]?.price || 0);
    const mid  = (bid + ask) / 2;

    return { productId, bid, ask, mid, timestamp: Date.now() };
  } catch (err) {
    console.error(`[PRICE] ${productId} error:`, err.message);
    return null;
  }
}

// ─── CANDLE HISTORY FETCH ─────────────────────────────────────
// This is the KEY advantage over Guardian Protocol.
// We request 300 candles of 1-hour data = 12.5 days of history.
// Guardian has to WATCH prices for hours before it knows the wave shape.
// We know the wave shape on the FIRST BOOT.
async function fetchCandles(productId) {
  try {
    const end   = Math.floor(Date.now() / 1000);
    const start = end - (CANDLE_COUNT * CANDLE_SECONDS);
    const path  = `/api/v3/brokerage/products/${productId}/candles` +
                  `?start=${start}&end=${end}&granularity=${CANDLE_GRANULARITY}`;

    const data = await publicRequest(path);

    if (!data.candles || data.candles.length === 0) {
      console.warn(`[CANDLES] No candles returned for ${productId}`);
      return [];
    }

    // Coinbase returns candles newest-first. We reverse to get oldest-first
    // (chronological order) which is what the wave engine expects.
    const candles = data.candles
      .map(c => ({
        time:   parseInt(c.start),
        open:   parseFloat(c.open),
        high:   parseFloat(c.high),
        low:    parseFloat(c.low),
        close:  parseFloat(c.close),
        volume: parseFloat(c.volume),
      }))
      .sort((a, b) => a.time - b.time);

    console.log(`[CANDLES] ${productId}: ${candles.length} candles loaded ✅`);
    return candles;
  } catch (err) {
    console.error(`[CANDLES] ${productId} error:`, err.message);
    return [];
  }
}

// ─── ACCOUNT BALANCE ──────────────────────────────────────────
// Fetches your USD balance and any crypto balances.
async function fetchBalances() {
  try {
    const data = await cbRequest('GET', `${CB_PATH}/accounts`);
    if (!data.accounts) return {};

    const balances = {};
    for (const account of data.accounts) {
      const val = parseFloat(account.available_balance?.value || 0);
      if (val > 0) {
        balances[account.currency] = val;
      }
    }
    return balances;
  } catch (err) {
    console.error('[BALANCE] Error:', err.message);
    return {};
  }
}

// ─── RSI CALCULATOR ───────────────────────────────────────────
// RSI (Relative Strength Index) — measures whether a token is
// overbought (>70, likely to drop) or oversold (<30, likely to bounce).
// This is one of our buy/sell confirmation signals.
function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;

  let gains = 0, losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains  += diff;
    else          losses -= diff;
  }

  let avgGain = gains  / period;
  let avgLoss = losses / period;

  // Smooth over remaining candles using Wilder's smoothing
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1))         / period;
    } else {
      avgGain = (avgGain * (period - 1))         / period;
      avgLoss = (avgLoss * (period - 1) - diff)  / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs  = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ─── MACD CALCULATOR ──────────────────────────────────────────
// MACD (Moving Average Convergence Divergence) — detects momentum shifts.
// When MACD line crosses above signal line = bullish (buy signal).
// When MACD line crosses below signal line = bearish (sell signal).
function calculateMACD(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return null;

  function ema(data, period) {
    const k = 2 / (period + 1);
    let val = data[0];
    for (let i = 1; i < data.length; i++) {
      val = data[i] * k + val * (1 - k);
    }
    return val;
  }

  // Calculate EMA series for MACD line
  function emaArray(data, period) {
    const k   = 2 / (period + 1);
    const out = [data[0]];
    for (let i = 1; i < data.length; i++) {
      out.push(data[i] * k + out[i - 1] * (1 - k));
    }
    return out;
  }

  const fastEMA = emaArray(closes, fast);
  const slowEMA = emaArray(closes, slow);

  // MACD line = fast EMA minus slow EMA
  const macdLine = fastEMA.slice(slow - 1).map((v, i) => v - slowEMA[slow - 1 + i]);

  // Signal line = EMA of MACD line
  const signalVal  = ema(macdLine, signal);
  const macdVal    = macdLine[macdLine.length - 1];
  const prevMacd   = macdLine[macdLine.length - 2];
  const prevSignal = ema(macdLine.slice(0, -1), signal);

  return {
    macd:      macdVal,
    signal:    signalVal,
    histogram: macdVal - signalVal,
    // crossBullish = MACD just crossed ABOVE signal (buy signal)
    crossBullish: prevMacd < prevSignal && macdVal > signalVal,
    // crossBearish = MACD just crossed BELOW signal (sell signal)
    crossBearish: prevMacd > prevSignal && macdVal < signalVal,
  };
}

// ─── BOLLINGER BANDS ──────────────────────────────────────────
// Bollinger Bands — price envelope. When price touches lower band,
// it's statistically cheap relative to recent history (buy zone).
// When price touches upper band, it's expensive (sell zone).
function calculateBollingerBands(closes, period = 20, stdDev = 2) {
  if (closes.length < period) return null;

  const slice = closes.slice(-period);
  const mean  = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / period;
  const std   = Math.sqrt(variance);

  return {
    upper:  mean + std * stdDev,
    middle: mean,
    lower:  mean - std * stdDev,
    std,
  };
}

// ─── EHLERS DOMINANT CYCLE PREDICTOR ──────────────────────────
// This is the secret weapon. Most bots use fixed timeframes (14-period RSI, etc).
// Ehlers measures the ACTUAL rhythm of the market's oscillations.
// If the cycle is 20 hours, we use 20 as our period — not an arbitrary 14.
// This makes every other indicator adapt to what the market is actually doing.
function calculateEhlersCycle(closes, minPeriod = 10, maxPeriod = 48) {
  if (closes.length < maxPeriod * 2) return maxPeriod; // fallback

  // Hilbert Transform Dominant Cycle Period (simplified Ehlers)
  const n = closes.length;
  let smooth, detrender, i1, q1, ji, jq, i2, q2, re, im;
  let period = maxPeriod;

  // We track a rolling smoothed price to remove noise
  const prices = closes.slice(-maxPeriod * 2);
  const smoothed = [];

  for (let i = 3; i < prices.length; i++) {
    const s = (4 * prices[i] + 3 * prices[i-1] + 2 * prices[i-2] + prices[i-3]) / 10;
    smoothed.push(s);
  }

  // Phase accumulator — simplified dominant cycle estimate
  // Full Ehlers requires more bars; this gives stable estimate in ~50 candles
  let sumRe = 0, sumIm = 0;
  const halfLen = Math.floor(smoothed.length / 2);

  for (let i = halfLen; i < smoothed.length; i++) {
    const angle = (2 * Math.PI * (i - halfLen)) / halfLen;
    sumRe += smoothed[i] * Math.cos(angle);
    sumIm += smoothed[i] * Math.sin(angle);
  }

  // Dominant period estimate from phase angle
  const dominantAngle = Math.atan2(sumIm, sumRe);
  let estimatedPeriod = Math.round((2 * Math.PI) / Math.abs(dominantAngle || 0.1));

  // Clamp to sane range
  estimatedPeriod = Math.max(minPeriod, Math.min(maxPeriod, estimatedPeriod));

  return estimatedPeriod;
}

// ─── WAVE ENGINE ──────────────────────────────────────────────
// This is the core of the algorithm.
// It finds the natural peaks (highs) and troughs (lows) in price history.
// We need MIN_PEAKS confirmed peaks and MIN_TROUGHS confirmed troughs
// before we trust the wave pattern enough to trade.
//
// A "confirmed" peak = a high point where price moved DOWN on BOTH sides.
// A "confirmed" trough = a low point where price moved UP on BOTH sides.
function detectWaves(candles, cyclePeriod) {
  const closes = candles.map(c => c.close);
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);

  const lookback = Math.floor(cyclePeriod / 4); // quarter-cycle lookback
  const peaks    = [];
  const troughs  = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    // Peak: this candle's high is higher than all surrounding candles
    let isPeak = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && highs[j] >= highs[i]) { isPeak = false; break; }
    }
    if (isPeak) peaks.push({ index: i, price: highs[i], time: candles[i].time });

    // Trough: this candle's low is lower than all surrounding candles
    let isTrough = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && lows[j] <= lows[i]) { isTrough = false; break; }
    }
    if (isTrough) troughs.push({ index: i, price: lows[i], time: candles[i].time });
  }

  // Wave metrics
  const maxPeak   = peaks.length   > 0 ? Math.max(...peaks.map(p => p.price))   : null;
  const minTrough = troughs.length > 0 ? Math.min(...troughs.map(t => t.price)) : null;
  const latestPeak   = peaks[peaks.length - 1]   || null;
  const latestTrough = troughs[troughs.length - 1] || null;

  const isArmed = peaks.length >= MIN_PEAKS && troughs.length >= MIN_TROUGHS;

  return {
    peaks,
    troughs,
    maxPeak,
    minTrough,
    latestPeak,
    latestTrough,
    isArmed,
    peakCount:   peaks.length,
    troughCount: troughs.length,
  };
}

// ─── FIBONACCI EXTENSION LADDER ───────────────────────────────
// After we buy at a trough, we set 6 take-profit targets.
// Each target is a Fibonacci ratio above the swing low.
// We sell a slice at each target — locking in profit while letting the rest ride.
//
// Example: Buy ETH at $2000, sell at $2000 (100%), $2054 (127.2%), etc.
function buildFibLadder(troughPrice, peakPrice) {
  const range = peakPrice - troughPrice;
  return [
    { ratio: 1.000, price: troughPrice + range * 1.000, label: 'Fib 100%' },
    { ratio: 1.272, price: troughPrice + range * 1.272, label: 'Fib 127.2%' },
    { ratio: 1.382, price: troughPrice + range * 1.382, label: 'Fib 138.2%' },
    { ratio: 1.618, price: troughPrice + range * 1.618, label: 'Fib 161.8% (Tsunami)' },
    { ratio: 2.000, price: troughPrice + range * 2.000, label: 'Fib 200%' },
    { ratio: 2.618, price: troughPrice + range * 2.618, label: 'Fib 261.8% (Moon)' },
  ];
}

// ─── TOKEN STATE ──────────────────────────────────────────────
// This object tracks everything we know about each token.
// It gets updated every cycle.
const tokenState = {};

function initTokenState(productId) {
  tokenState[productId] = {
    productId,
    candles:       [],
    currentPrice:  null,
    cyclePeriod:   24,  // default 24 hours, Ehlers will refine this
    waves:         null,
    rsi:           null,
    macd:          null,
    bb:            null,
    position:      null, // { entryPrice, quantity, usdValue, fibLadder }
    isArmed:       false,
    lastUpdate:    null,
    alertsSent:    {},   // track which alerts we've already sent (avoid spam)
  };
}

// ─── TELEGRAM ─────────────────────────────────────────────────
// Sends messages to your Telegram bot.
// Same format as Guardian Protocol so you see everything in one chat.
async function sendTelegram(message) {
  try {
    const body = JSON.stringify({
      chat_id:    process.env.TELEGRAM_CHAT_ID,
      text:       message,
      parse_mode: 'HTML',
    });

    await new Promise((resolve, reject) => {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const path  = `/bot${token}/sendMessage`;
      const headers = {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      };

      const req = https.request(
        { hostname: 'api.telegram.org', path, method: 'POST', headers },
        res => { res.resume(); resolve(); }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  } catch (err) {
    console.error('[TELEGRAM] Send error:', err.message);
  }
}

// ─── KITE WATCHLIST ALERTS ────────────────────────────────────
// Special logic for KITE-USD because the operator holds 777 tokens underwater.
// We watch for specific conditions and alert immediately when they trigger.
async function checkKiteAlerts(state) {
  const { currentPrice, waves, rsi, macd } = state;
  if (!currentPrice || !waves) return;

  const alerts = state.alertsSent;

  // Alert 1: MACD crosses bullish after oversold RSI — wave is turning up
  if (macd?.crossBullish && rsi < 45 && !alerts.kite_macd_bullish) {
    alerts.kite_macd_bullish = true;
    const msg = [
      '🌊 <b>KITE WAVE ALERT</b>',
      '',
      `Price: $${currentPrice.toFixed(6)}`,
      `RSI: ${rsi.toFixed(1)} (oversold territory)`,
      `MACD: CROSSED BULLISH ✅`,
      '',
      '⚡ Wave may be turning up. Watch for trough confirmation.',
      'If capital available: consider small re-entry to average down.',
    ].join('\n');
    await sendTelegram(msg);
  }

  // Alert 2: Price hits a confirmed trough (potential re-entry)
  if (waves.isArmed && waves.latestTrough) {
    const troughPrice    = waves.latestTrough.price;
    const distFromTrough = Math.abs(currentPrice - troughPrice) / troughPrice;

    if (distFromTrough < 0.01 && !alerts[`kite_trough_${troughPrice.toFixed(6)}`]) {
      alerts[`kite_trough_${troughPrice.toFixed(6)}`] = true;
      const msg = [
        '📉 <b>KITE TROUGH DETECTED</b>',
        '',
        `Current Price: $${currentPrice.toFixed(6)}`,
        `Confirmed Trough: $${troughPrice.toFixed(6)}`,
        `RSI: ${rsi?.toFixed(1) || 'N/A'}`,
        '',
        '⚡ This is a historically low point in KITE\'s wave cycle.',
        'If you want to average down, this is the zone.',
      ].join('\n');
      await sendTelegram(msg);
    }
  }

  // Alert 3: Fibonacci 100% — if we know the entry price, alert at breakeven+
  if (KITE_ENTRY_PRICE && waves.isArmed && waves.latestTrough && waves.latestPeak) {
    const fibLadder  = buildFibLadder(waves.latestTrough.price, waves.latestPeak.price);
    const fib100     = fibLadder[0].price;
    const distFromFib = (currentPrice - fib100) / fib100;

    if (distFromFib >= -0.005 && distFromFib <= 0.02 && !alerts.kite_fib100) {
      alerts.kite_fib100 = true;
      const msg = [
        '🎯 <b>KITE FIB 100% ZONE</b>',
        '',
        `Current Price: $${currentPrice.toFixed(6)}`,
        `Fib 100% Target: $${fib100.toFixed(6)}`,
        '',
        '✅ Strategy: SELL 25% here (partial exit, recover cost basis)',
        '🌊 Let remaining 75% ride toward Fib 161.8% (Tsunami)',
        `Tsunami target: $${fibLadder[3].price.toFixed(6)}`,
      ].join('\n');
      await sendTelegram(msg);
    }
  }
}

// ─── MAIN ANALYSIS FUNCTION ───────────────────────────────────
// Runs for every token every cycle.
// Loads candles, calculates all indicators, detects waves, checks signals.
async function analyzeToken(productId) {
  const state = tokenState[productId];
  if (!state) return;

  // 1. Fetch current price
  const priceData = await fetchPrice(productId);
  if (!priceData) return;

  state.currentPrice = priceData.mid;
  state.lastUpdate   = Date.now();

  // 2. Fetch candle history (only on boot or every 10 cycles to save API calls)
  const needsCandles = state.candles.length === 0;
  if (needsCandles) {
    console.log(`[BOOT] Loading ${CANDLE_COUNT} candles for ${productId}...`);
    state.candles = await fetchCandles(productId);
  }

  if (state.candles.length < 50) {
    console.warn(`[${productId}] Not enough candles (${state.candles.length}). Skipping.`);
    return;
  }

  // Append current price as a synthetic candle for real-time analysis
  const now = Math.floor(Date.now() / 1000);
  const liveCandle = {
    time:   now,
    open:   state.candles[state.candles.length - 1].close,
    high:   Math.max(state.candles[state.candles.length - 1].close, state.currentPrice),
    low:    Math.min(state.candles[state.candles.length - 1].close, state.currentPrice),
    close:  state.currentPrice,
    volume: 0,
  };
  const allCandles = [...state.candles, liveCandle];
  const closes     = allCandles.map(c => c.close);

  // 3. Ehlers Dominant Cycle — finds the natural rhythm
  state.cyclePeriod = calculateEhlersCycle(closes);

  // 4. RSI — overbought/oversold
  state.rsi = calculateRSI(closes, Math.min(state.cyclePeriod, 14));

  // 5. MACD — momentum direction
  state.macd = calculateMACD(closes);

  // 6. Bollinger Bands — price envelope
  state.bb = calculateBollingerBands(closes);

  // 7. Wave detection — the core buy/sell logic
  state.waves   = detectWaves(allCandles, state.cyclePeriod);
  state.isArmed = state.waves.isArmed;

  // 8. KITE special alerts
  if (productId === 'KITE-USD') {
    await checkKiteAlerts(state);
  }

  // 9. Log status
  const waveStr = state.isArmed
    ? `ARMED (${state.waves.peakCount}P/${state.waves.troughCount}T)`
    : `BUILDING (${state.waves.peakCount}/${MIN_PEAKS}P, ${state.waves.troughCount}/${MIN_TROUGHS}T)`;

  const rsiStr  = state.rsi  ? state.rsi.toFixed(1)          : 'N/A';
  const macdStr = state.macd ? state.macd.histogram.toFixed(4) : 'N/A';

  console.log([
    `[${productId.padEnd(9)}]`,
    `Price: $${state.currentPrice.toFixed(4).padStart(10)}`,
    `| Cycle: ${String(state.cyclePeriod).padStart(2)}h`,
    `| RSI: ${rsiStr.padStart(5)}`,
    `| MACD hist: ${macdStr.padStart(8)}`,
    `| Wave: ${waveStr}`,
  ].join(' '));
}

// ─── BOOT STATUS MESSAGE ──────────────────────────────────────
async function sendBootMessage(balances) {
  const usd = balances['USD'] || 0;
  const lines = [
    '🤖 <b>COINBASE-AGENT v1.0 — ONLINE</b>',
    '',
    `💰 USD Balance: $${usd.toFixed(2)}`,
    '',
    '📋 Watching:',
    ...TOKENS.map(t => `  • ${t}`),
    '',
    '🌊 Loading 300 candles per token...',
    '⚡ Bot arms when 4+ peaks &amp; 4+ troughs confirmed per token.',
    '',
    '🔍 KITE watchlist: ACTIVE — alerts on wave reversal signals',
  ];
  await sendTelegram(lines.join('\n'));
}

// ─── MAIN LOOP ────────────────────────────────────────────────
async function runCycle() {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`[CYCLE] ${new Date().toISOString()}`);
  console.log(`${'─'.repeat(70)}`);

  for (const token of TOKENS) {
    await analyzeToken(token);
    // Small delay between tokens to avoid rate-limiting (30 req/s limit)
    await new Promise(r => setTimeout(r, 300));
  }
}

// ─── STARTUP ──────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║         COINBASE-AGENT v1.0 — PHASE 1 FOUNDATION        ║');
  console.log('║         Agentic AI Trading  |  Coinbase Advanced Trade   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // Load .env locally (Railway injects these automatically in production)
  try {
    const { default: dotenv } = await import('dotenv');
    dotenv.config();
  } catch {
    // dotenv not installed — fine in Railway (env vars are injected directly)
  }

  checkEnv();

  // Initialize state for all tokens
  for (const token of TOKENS) {
    initTokenState(token);
  }

  // Fetch account balances
  console.log('[BOOT] Fetching account balances...');
  const balances = await fetchBalances();
  console.log('[BOOT] Balances:', balances);

  // Send Telegram boot message
  await sendBootMessage(balances);

  // Run first cycle immediately on boot
  await runCycle();

  // Then run every 5 minutes
  console.log(`\n[LOOP] Cycling every ${CYCLE_MS / 1000}s. Press Ctrl+C to stop.\n`);
  setInterval(runCycle, CYCLE_MS);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
