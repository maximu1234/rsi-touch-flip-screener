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

export function buildRsiByLen(chartCandles, sourceCandles, chartTf, rsiTf) {
  const map = new Map();
  const same =
    !rsiTf ||
    rsiTf === chartTf ||
    !Array.isArray(sourceCandles) ||
    !sourceCandles.length;
  for (const rsiLen of RSI_TOUCH_FLIP_LEN_GRID) {
    if (same) {
      map.set(rsiLen, computeWilderRsiValues(chartCandles, rsiLen));
      continue;
    }
    const sourceRsi = computeWilderRsiValues(sourceCandles, rsiLen);
    map.set(
      rsiLen,
      projectClosedSourceRsiOntoChart(
        chartCandles,
        chartTf,
        sourceCandles,
        rsiTf,
        sourceRsi
      )
    );
  }
  return map;
}
