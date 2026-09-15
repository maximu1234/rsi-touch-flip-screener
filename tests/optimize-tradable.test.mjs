import test from "node:test";
import assert from "node:assert/strict";
import {
  isBetterRsiTouchFlipLaunch,
  isBetterRsiTouchFlipTradable,
  optimizeRsiTouchFlipParams,
  packRsiTouchFlipScreenerBest,
  pickRsiTouchFlipTradeRow
} from "../lib/rsi-touch-flip-optimize.js";
import { formatRsiTouchFlipOverviewBestNote } from "../lib/rsi-touch-flip-walkforward.js";

function oscillatingSeries(count) {
  const candles = [];
  const rsi = [];
  for (let i = 0; i < count; i++) {
    const phase = i % 6;
    const os = phase <= 1;
    const ob = phase === 3 || phase === 4;
    const price = ob ? 110 : 100;
    candles.push({
      time: 1_700_000_000 + i * 60,
      open: price,
      high: price,
      low: price,
      close: price
    });
    rsi.push(os ? 25 : ob ? 80 : 50);
  }
  return { candles, rsi };
}

test("tradable winner ignores red Overview champ", () => {
  const passing = {
    verdict: { ok: true },
    overview: { closedTrades: 20, netProfit: 8 }
  };
  const failing = {
    verdict: { ok: false, reasons: ["Test не прибыльный"] },
    overview: { closedTrades: 40, netProfit: 40 }
  };
  assert.equal(isBetterRsiTouchFlipLaunch(failing, passing), true);
  assert.equal(isBetterRsiTouchFlipTradable(passing, failing), true);
  assert.equal(isBetterRsiTouchFlipTradable(failing, passing), false);
  assert.equal(isBetterRsiTouchFlipTradable(failing, null), false);
});

test("screener packs tradable row and keeps Overview champ as a note", () => {
  const tradable = {
    combo: { rsiLen: 14, osLevel: 25, obLevel: 85, maxStack: 1 },
    prefs: { rsiLen: 14, osLevel: 25, obLevel: 85, maxStack: 1, rsiTf: "1" },
    overview: { closedTrades: 38, netProfit: 12.25 },
    train: { closedTrades: 26, netProfit: 9 },
    test: { closedTrades: 12, netProfit: 3.17, profitFactor: 1.4 },
    verdict: { ok: true, reasons: [] }
  };
  const champ = {
    combo: { rsiLen: 20, osLevel: 32, obLevel: 78, maxStack: 1 },
    prefs: { rsiLen: 20, osLevel: 32, obLevel: 78, maxStack: 1, rsiTf: "1" },
    overview: { closedTrades: 80, netProfit: 40 },
    train: { closedTrades: 50, netProfit: 45 },
    test: { closedTrades: 12, netProfit: -2, profitFactor: 0.8 },
    verdict: { ok: false, reasons: ["Test не прибыльный"] }
  };
  const picked = pickRsiTouchFlipTradeRow({
    best: champ,
    bestTradable: tradable
  });
  assert.equal(picked.pick.combo.rsiLen, 14);
  assert.equal(picked.overviewBest.combo.rsiLen, 20);

  const packed = packRsiTouchFlipScreenerBest({
    best: champ,
    bestTradable: tradable
  });
  assert.equal(packed.combo.rsiLen, 14);
  assert.equal(packed.verdict.ok, true);
  assert.equal(packed.overviewBest.combo.rsiLen, 20);
  assert.equal(packed.overviewBest.verdict.ok, false);
  assert.match(
    formatRsiTouchFlipOverviewBestNote(packed.overviewBest),
    /RSI 20/
  );

  const same = packRsiTouchFlipScreenerBest({
    best: tradable,
    bestTradable: tradable
  });
  assert.equal(same.overviewBest, null);
});

test("without a green Test the packed row is the Overview champ", () => {
  const champ = {
    combo: { rsiLen: 5, osLevel: 15, obLevel: 71, maxStack: 10 },
    prefs: { rsiLen: 5, osLevel: 15, obLevel: 71, maxStack: 10 },
    overview: { closedTrades: 40, netProfit: -2.35 },
    train: { closedTrades: 30, netProfit: -2 },
    test: { closedTrades: 10, netProfit: -0.21, profitFactor: 0.9 },
    verdict: { ok: false, reasons: ["Test не прибыльный"] }
  };
  const packed = packRsiTouchFlipScreenerBest({
    best: champ,
    bestTradable: null
  });
  assert.equal(packed.combo.rsiLen, 5);
  assert.equal(packed.verdict.ok, false);
  assert.equal(packed.overviewBest, null);
});

test("optimize returns bestTradable alongside Overview best", async () => {
  const { candles, rsi } = oscillatingSeries(240);
  const rsiByLen = new Map([
    [7, rsi],
    [14, rsi]
  ]);
  const result = await optimizeRsiTouchFlipParams({
    candles,
    rsiByLen,
    combos: [
      { rsiLen: 7, osLevel: 25, obLevel: 80, maxStack: 1 },
      { rsiLen: 14, osLevel: 25, obLevel: 80, maxStack: 2 }
    ],
    basePrefs: {
      commissionPct: 0,
      budget: 90,
      maxStack: 3,
      tradeSide: "BOTH"
    },
    chartTf: "1",
    trainPct: 70,
    yieldEvery: 0
  });
  assert.equal(result.cancelled, false);
  assert.ok(result.best);
  assert.equal("bestTradable" in result, true);
  if (result.best.verdict?.ok) {
    assert.equal(result.bestTradable?.prefs?.rsiLen, result.best.prefs.rsiLen);
  }
});
