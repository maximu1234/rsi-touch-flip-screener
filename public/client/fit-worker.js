import { runRsiTouchFlip } from "../lib/rsi-touch-flip-engine.js";
import { normalizeRsiTouchFlipPrefs } from "../lib/rsi-touch-flip-prefs.js";
import {
  listRsiTouchFlipOptimizeCombos,
  optimizeRsiTouchFlipParams
} from "../lib/rsi-touch-flip-optimize.js";
import { buildRsiByLen } from "./rsi-prep.js";

function compact(overview) {
  if (!overview) {
    return null;
  }
  return {
    chartDays: overview.chartDays,
    netProfit: overview.netProfit,
    netProfitPct: overview.netProfitPct,
    longProfit: overview.longProfit,
    longProfitPct: overview.longProfitPct,
    shortProfit: overview.shortProfit,
    shortProfitPct: overview.shortProfitPct,
    grossProfit: overview.grossProfit,
    grossProfitPct: overview.grossProfitPct,
    grossLoss: overview.grossLoss,
    grossLossPct: overview.grossLossPct,
    closedTrades: overview.closedTrades,
    percentProfitable: overview.percentProfitable,
    profitFactor:
      overview.profitFactor === Infinity ? "Infinity" : overview.profitFactor,
    maxDrawdown: overview.maxDrawdown,
    maxDrawdownPct: overview.maxDrawdownPct,
    maxTradeMae: overview.maxTradeMae,
    maxTradeMaePct: overview.maxTradeMaePct,
    liquidations: overview.liquidations,
    avgTrade: overview.avgTrade,
    avgTradePct: overview.avgTradePct,
    avgBars: overview.avgBars
  };
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (!msg || msg.type !== "run") {
    return;
  }
  const {
    symbol,
    candles,
    sourceCandles,
    chartTf,
    rsiTf,
    basePrefs,
    trainPct,
    comboLimit
  } = msg;
  let cancelled = false;
  const onCancel = (e) => {
    if (e.data?.type === "cancel") {
      cancelled = true;
    }
  };
  self.addEventListener("message", onCancel);
  try {
    const all = listRsiTouchFlipOptimizeCombos();
    const combos =
      comboLimit > 0 ? all.slice(0, comboLimit) : all;
    const rsiByLen = buildRsiByLen(candles, sourceCandles, chartTf, rsiTf);
    let lastPosted = 0;
    const result = await optimizeRsiTouchFlipParams({
      candles,
      rsiByLen,
      basePrefs,
      chartTf,
      trainPct,
      combos,
      signal: {
        get cancelled() {
          return cancelled;
        }
      },
      yieldEvery: 64,
      onProgress: (p) => {
        if (p.done === p.total || p.done - lastPosted >= 500) {
          lastPosted = p.done;
          self.postMessage({
            type: "progress",
            symbol,
            done: p.done,
            total: p.total
          });
        }
      }
    });

    let overview = compact(result.best?.overview);
    if (result.best?.combo && !result.cancelled) {
      const prefs = normalizeRsiTouchFlipPrefs({
        ...basePrefs,
        ...result.best.combo
      });
      const rsiFull = rsiByLen.get(result.best.combo.rsiLen);
      if (Array.isArray(rsiFull)) {
        const full = runRsiTouchFlip(candles, prefs, { rsiValues: rsiFull });
        overview = compact({
          ...full.overview,
          chartDays: result.best.overview?.chartDays
        });
      }
    }

    self.postMessage({
      type: "done",
      symbol,
      cancelled: result.cancelled === true,
      best: result.best
        ? {
            combo: result.best.combo,
            prefs: {
              rsiLen: result.best.prefs.rsiLen,
              osLevel: result.best.prefs.osLevel,
              obLevel: result.best.prefs.obLevel,
              maxStack: result.best.prefs.maxStack,
              rsiTf: result.best.prefs.rsiTf,
              tradeSide: result.best.prefs.tradeSide,
              cycleSlEnabled: result.best.prefs.cycleSlEnabled,
              cycleSlPct: result.best.prefs.cycleSlPct
            },
            overview,
            train: compact(result.best.train),
            test: compact(result.best.test),
            verdict: result.best.verdict
          }
        : null,
      split: result.split
        ? {
            trainDays: result.split.train.days,
            testDays: result.split.test.days,
            trainBars: result.split.train.bars,
            testBars: result.split.test.bars
          }
        : null,
      tried: result.tried,
      total: result.total
    });
  } catch (err) {
    self.postMessage({
      type: "error",
      symbol,
      message: err?.message || String(err)
    });
  } finally {
    self.removeEventListener("message", onCancel);
  }
};
