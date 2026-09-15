import { computeWilderRsiValues } from "../lib/rsi-touch-flip-engine.js";
import {
  projectClosedSourceRsiOntoChart,
  rsiTouchFlipSourcePages,
  rsiTouchFlipTfPeriodSec,
  rsiTouchFlipUnixSec
} from "../lib/rsi-touch-flip-mtf.js";
import { RSI_TOUCH_FLIP_LEN_GRID } from "../lib/rsi-touch-flip-optimize.js";

export function sourcePagesForChart(chartCandles, chartTf, rsiTf, rsiLen) {
  const chartSec = rsiTouchFlipTfPeriodSec(chartTf);
  const srcSec = rsiTouchFlipTfPeriodSec(rsiTf);
  if (!(chartSec > 0) || !(srcSec > 0) || rsiTf === chartTf || !rsiTf) {
    return 0;
  }
  return rsiTouchFlipSourcePages(chartCandles, chartTf, rsiTf, rsiLen);
}

export function sourceEndMs(chartCandles, chartTf) {
  const last = rsiTouchFlipUnixSec(chartCandles[chartCandles.length - 1]?.time);
  const chartSec = rsiTouchFlipTfPeriodSec(chartTf);
  if (!Number.isFinite(last) || !(chartSec > 0)) {
    return Date.now();
  }
  return (last + chartSec) * 1000;
}

export function rsiSourceRequired(chartTf, rsiTf) {
  return Boolean(rsiTf) && rsiTf !== chartTf;
}

export function rsiHistoryComplete(chartTf, rsiTf, history) {
  if (!history?.candles?.length) {
    return false;
  }
  if (rsiSourceRequired(chartTf, rsiTf) && !history.sourceCandles?.length) {
    return false;
  }
  return true;
}

export function buildRsiForLen(chartCandles, sourceCandles, chartTf, rsiTf, rsiLen) {
  if (
    rsiSourceRequired(chartTf, rsiTf) &&
    (!Array.isArray(sourceCandles) || !sourceCandles.length)
  ) {
    throw new Error("нет свечей RSI ТФ");
  }
  if (!rsiTf || rsiTf === chartTf) {
    return computeWilderRsiValues(chartCandles, rsiLen);
  }
  const sourceRsi = computeWilderRsiValues(sourceCandles, rsiLen);
  return projectClosedSourceRsiOntoChart(
    chartCandles,
    chartTf,
    sourceCandles,
    rsiTf,
    sourceRsi
  );
}

export function buildRsiByLen(chartCandles, sourceCandles, chartTf, rsiTf) {
  const map = new Map();
  for (const rsiLen of RSI_TOUCH_FLIP_LEN_GRID) {
    map.set(
      rsiLen,
      buildRsiForLen(chartCandles, sourceCandles, chartTf, rsiTf, rsiLen)
    );
  }
  return map;
}
