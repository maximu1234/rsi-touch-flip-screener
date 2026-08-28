/**
 * Индекс пригодности (0–100) по одной строке подбора — без сравнения с другими тикерами.
 * Эвристика: насколько метрики Train/Test/Обзор согласованы для live в боте.
 */

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function profitFactorNum(raw) {
  if (raw === Infinity || raw === "Infinity") {
    return 99;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {{ best?: { overview?: object, train?: object, test?: object, verdict?: { ok?: boolean }, combo?: object } }|null|undefined} row
 * @returns {number|null}
 */
export function rsiTouchFlipSuitabilityScore(row) {
  const best = row?.best;
  if (!best?.overview || !best?.combo) {
    return null;
  }

  const o = best.overview;
  const trainNet = Number(best.train?.netProfit);
  const testNet = Number(best.test?.netProfit);
  const testTrades = Number(best.test?.closedTrades);
  const verdictOk = best.verdict?.ok === true;
  const trades = Number(o.closedTrades);
  const pf = profitFactorNum(o.profitFactor);
  const ddPct = Math.abs(Number(o.maxDrawdownPct));
  const days = Number(o.chartDays);
  const grossProfit = Number(o.grossProfit);
  const grossLoss = Math.abs(Number(o.grossLoss));

  let score = verdictOk ? 50 : 22;

  if (verdictOk) {
    score += 6;
  }

  if (Number.isFinite(testNet) && testNet > 0) {
    score += 5;
    if (Number.isFinite(trainNet) && trainNet > 0) {
      const ratio = testNet / trainNet;
      if (ratio >= 0.3) {
        score += 8;
      } else if (ratio >= 0.15) {
        score += 5;
      } else if (ratio >= 0.05) {
        score += 2;
      } else {
        score -= 6;
      }
    }
  } else if (Number.isFinite(testNet)) {
    score -= 18;
  }

  if (Number.isFinite(trades)) {
    if (trades >= 200) {
      score += 8;
    } else if (trades >= 80) {
      score += 6;
    } else if (trades >= 40) {
      score += 3;
    } else if (trades >= 25) {
      score += 1;
    } else {
      score -= 12;
    }
  }

  if (Number.isFinite(testTrades) && testTrades < 8) {
    score -= 8;
  }

  if (pf != null) {
    if (pf >= 3) {
      score += 6;
    } else if (pf >= 2) {
      score += 4;
    } else if (pf >= 1.5) {
      score += 2;
    } else if (pf < 1) {
      score -= 8;
    }
  }

  if (Number.isFinite(ddPct)) {
    if (ddPct <= 10) {
      score += 5;
    } else if (ddPct <= 18) {
      score += 2;
    } else if (ddPct > 30) {
      score -= 5;
    }
  }

  if (Number.isFinite(days) && days < 28) {
    score -= 6;
  }

  if (
    Number.isFinite(grossProfit) &&
    grossProfit > 80 &&
    Number.isFinite(trades) &&
    trades < 35
  ) {
    score -= 10;
  }

  if (
    Number.isFinite(grossProfit) &&
    grossProfit > 0 &&
    Number.isFinite(grossLoss) &&
    grossLoss < grossProfit * 0.03 &&
    Number.isFinite(trades) &&
    trades < 50
  ) {
    score -= 8;
  }

  if (!verdictOk) {
    score = Math.min(score, 38);
  }

  return clampScore(score);
}

/**
 * @param {number|null|undefined} score
 * @returns {"high"|"mid"|"low"|""}
 */
export function suitabilityBand(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) {
    return "";
  }
  if (n >= 70) {
    return "high";
  }
  if (n >= 45) {
    return "mid";
  }
  return "low";
}
