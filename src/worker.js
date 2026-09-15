import { parentPort } from "node:worker_threads";
import { runRsiTouchFlip } from "../lib/rsi-touch-flip-engine.js";
import { normalizeRsiTouchFlipPrefs } from "../lib/rsi-touch-flip-prefs.js";
import {
  optimizeRsiTouchFlipParams,
  packRsiTouchFlipScreenerBest,
  pickRsiTouchFlipTradeRow
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

parentPort.on("message", async (msg) => {
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
    combos
  } = msg;
  let cancelled = false;
  const onCancel = (m) => {
    if (m?.type === "cancel") {
      cancelled = true;
    }
  };
  parentPort.on("message", onCancel);
  try {
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
      yieldEvery: 0,
      onProgress: (p) => {
        if (p.done === p.total || p.done - lastPosted >= 500) {
          lastPosted = p.done;
          parentPort.postMessage({
            type: "progress",
            symbol,
            done: p.done,
            total: p.total
          });
        }
      }
    });

    const { pick } = pickRsiTouchFlipTradeRow(result);
    let overview = compact(pick?.overview);
    if (pick?.combo && !result.cancelled) {
      const prefs = normalizeRsiTouchFlipPrefs({
        ...basePrefs,
        ...pick.combo
      });
      const rsiFull = rsiByLen.get(pick.combo.rsiLen);
      if (Array.isArray(rsiFull)) {
        const full = runRsiTouchFlip(candles, prefs, { rsiValues: rsiFull });
        overview = compact({
          ...full.overview,
          chartDays: pick.overview?.chartDays
        });
      }
    }

    parentPort.postMessage({
      type: "done",
      symbol,
      cancelled: result.cancelled === true,
      best: packRsiTouchFlipScreenerBest(result, overview),
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
    parentPort.postMessage({
      type: "error",
      symbol,
      message: err?.message || String(err)
    });
  } finally {
    parentPort.off("message", onCancel);
  }
});
