import test from "node:test";
import assert from "node:assert/strict";
import { runRsiTouchFlip } from "../lib/rsi-touch-flip-engine.js";
import { gridPrefsFromConfig } from "../lib/screener-defaults.js";
import { rememberBareBaseline } from "../lib/rsi-touch-flip-overlay.js";
import { buildEquitySeries } from "../public/client/equity-chart.js";

function candlesFrom(closes) {
  return closes.map((close, i) => ({
    time: 1_700_000_000 + i * 300,
    open: close,
    high: close,
    low: close,
    close
  }));
}

test("grid search keeps Compound when the checkbox is on and still skips cycle SL", () => {
  const on = gridPrefsFromConfig({
    compoundEnabled: true,
    cycleSlEnabled: true,
    budget: 30,
    commissionPct: 0.04,
    chartTf: "5"
  });
  assert.equal(on.compoundEnabled, true);
  assert.equal(on.cycleSlEnabled, false);
  assert.equal(on.budget, 30);
  assert.equal(on.slippageTicks, 0);
  const off = gridPrefsFromConfig({ compoundEnabled: false, budget: 30, chartTf: "5" });
  assert.equal(off.compoundEnabled, false);
});

test("compound changes later trade size, and the dollar sum matches the overview", () => {
  const candles = candlesFrom([100, 100, 100, 100, 110, 110, 110, 100, 100, 100, 90]);
  const rsiValues = [50, 40, 25, 40, 50, 80, 60, 40, 25, 50, 80];
  const base = {
    rsiLen: 10,
    osLevel: 30,
    obLevel: 70,
    tradeSide: "BOTH",
    maxStack: 1,
    budget: 100,
    sizeMode: "equal",
    commissionPct: 0,
    slippageTicks: 0
  };
  const plain = runRsiTouchFlip(candles, { ...base, compoundEnabled: false }, { rsiValues });
  const compounded = runRsiTouchFlip(candles, { ...base, compoundEnabled: true }, { rsiValues });
  const sum = (result) =>
    result.closedTrades.reduce((total, trade) => total + trade.pnl, 0);
  assert.ok(Math.abs(sum(plain) - plain.overview.netProfit) < 1e-8);
  assert.ok(Math.abs(sum(compounded) - compounded.overview.netProfit) < 1e-8);
  assert.ok(Math.abs(plain.overview.netProfit - compounded.overview.netProfit) > 0.5);
  assert.ok(Math.abs(plain.overview.netProfitPct - plain.overview.netProfit) < 1e-8);
  const series = buildEquitySeries(compounded.closedTrades, candles);
  assert.ok(Math.abs(series.last - compounded.overview.netProfit) < 1e-8);
  assert.equal(series.points.filter((point) => point.marker).length, compounded.closedTrades.length);
});

test("turning Compound off restores the plain run of the same set", () => {
  const best = {
    combo: { rsiLen: 10, osLevel: 30, obLevel: 70, maxStack: 1 },
    overview: { netProfit: 8 },
    train: { netProfit: 1 },
    test: { netProfit: 2 },
    verdict: { ok: true },
    prefs: { compoundEnabled: true }
  };
  const bare = {
    overview: { netProfit: 9 },
    train: { netProfit: 3 },
    test: { netProfit: 4 },
    verdict: { ok: false },
    prefs: { compoundEnabled: false }
  };
  const sealed = rememberBareBaseline(best, {
    compoundEnabled: true,
    candles: candlesFrom([1, 2]),
    rsiValues: [1, 2],
    chartTf: "5",
    trainPct: 70,
    basePrefs: { budget: 30 }
  });
  assert.equal(sealed.fitted.overview.netProfit, 8);
  const stored = {
    ...best,
    fitted: bare
  };
  const kept = rememberBareBaseline(stored, { compoundEnabled: false });
  assert.equal(kept.fitted.overview.netProfit, 9);
});
