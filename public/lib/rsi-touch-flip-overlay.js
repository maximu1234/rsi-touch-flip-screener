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

/**
 * Пересчёт метрик для уже найденного combo (СЛ цикла, Compound, …).
 */
export function repaintFittedBest(best, opts = {}) {
  const snapped = snapshotFittedBest(best);
  if (!snapped) {
    return null;
  }
  const cycleSl = opts.cycleSlEnabled === true;
  const compound = opts.compoundEnabled === true;
  if (!cycleSl && !compound) {
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
      cycleSlEnabled: cycleSl,
      cycleSlPct: opts.cycleSlPct,
      compoundEnabled: compound
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

/** @deprecated use repaintFittedBest */
export function paintBestWithCycleSl(best, opts = {}) {
  return repaintFittedBest(best, opts);
}
