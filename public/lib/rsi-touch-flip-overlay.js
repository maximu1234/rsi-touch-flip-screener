import { evaluateRsiTouchFlipCombo } from "./rsi-touch-flip-optimize.js";

export function snapshotFittedBest(best) {
  if (!best) {
    return null;
  }
  if (best.fitted) {
    return best;
  }
  return {
    ...best,
    fitted: {
      overview: best.overview,
      train: best.train,
      test: best.test,
      verdict: best.verdict,
      prefs: best.prefs
    }
  };
}

export function restoreFittedBest(best) {
  if (!best) {
    return null;
  }
  const snapped = snapshotFittedBest(best);
  if (!snapped.fitted) {
    return snapped;
  }
  return {
    ...snapped,
    overview: snapped.fitted.overview,
    train: snapped.fitted.train,
    test: snapped.fitted.test,
    verdict: snapped.fitted.verdict,
    prefs: snapped.fitted.prefs
  };
}

export function paintBestWithCycleSl(best, opts = {}) {
  const snapped = snapshotFittedBest(best);
  if (!snapped) {
    return null;
  }
  if (opts.cycleSlEnabled !== true) {
    return restoreFittedBest(snapped);
  }
  if (!snapped.combo || !opts.candles?.length || !opts.rsiValues) {
    return snapped;
  }
  const scored = evaluateRsiTouchFlipCombo({
    candles: opts.candles,
    rsiValues: opts.rsiValues,
    chartTf: opts.chartTf,
    trainPct: opts.trainPct,
    prefs: {
      ...(opts.basePrefs || {}),
      ...snapped.combo,
      cycleSlEnabled: true,
      cycleSlPct: opts.cycleSlPct
    }
  });
  if (!scored) {
    return snapped;
  }
  return {
    ...snapped,
    prefs: scored.prefs,
    overview: scored.overview,
    train: scored.train,
    test: scored.test,
    verdict: scored.verdict
  };
}
