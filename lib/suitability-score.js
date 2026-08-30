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
 * @param {{ best?: { overview?: object, train?: object, test?: object, verdict?: { ok?: boolean, reasons?: string[] }, combo?: object } }|null|undefined} row
 * @returns {{ score: number|null, reasons: string[] }}
 */
export function rsiTouchFlipSuitabilityDetail(row) {
  const best = row?.best;
  if (!best?.overview || !best?.combo) {
    return { score: null, reasons: [] };
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
  const reasons = [];

  let score = verdictOk ? 50 : 22;

  if (verdictOk) {
    score += 6;
    reasons.push("Test прошёл проверку");
  } else {
    const verdictReasons = Array.isArray(best.verdict?.reasons)
      ? best.verdict.reasons.filter(Boolean)
      : [];
    if (verdictReasons.length) {
      reasons.push(...verdictReasons);
    } else {
      reasons.push("Test не прошёл проверку");
    }
  }

  if (Number.isFinite(testNet) && testNet > 0) {
    score += 5;
    reasons.push("Test в плюсе");
    if (Number.isFinite(trainNet) && trainNet > 0) {
      const ratio = testNet / trainNet;
      if (ratio >= 0.3) {
        score += 8;
        reasons.push("Test сопоставим с Train");
      } else if (ratio >= 0.15) {
        score += 5;
        reasons.push("Test слабее Train, но приемлемо");
      } else if (ratio >= 0.05) {
        score += 2;
        reasons.push("Test заметно слабее Train");
      } else {
        score -= 6;
        reasons.push("Test слишком слабый относительно Train");
      }
    }
  } else if (Number.isFinite(testNet)) {
    score -= 18;
    reasons.push("Test в минусе");
  }

  if (Number.isFinite(trades)) {
    if (trades >= 200) {
      score += 8;
      reasons.push(`Много сделок на графике (${trades})`);
    } else if (trades >= 80) {
      score += 6;
      reasons.push(`Достаточно сделок на графике (${trades})`);
    } else if (trades >= 40) {
      score += 3;
    } else if (trades >= 25) {
      score += 1;
    } else {
      score -= 12;
      reasons.push(`Мало сделок на всём графике (${trades})`);
    }
  }

  if (Number.isFinite(testTrades) && testTrades < 8) {
    score -= 8;
    reasons.push(`Мало сделок на Test (${testTrades})`);
  }

  if (pf != null) {
    if (pf >= 3) {
      score += 6;
      reasons.push(`Высокий profit factor (${pf.toFixed(2)})`);
    } else if (pf >= 2) {
      score += 4;
      reasons.push(`Хороший profit factor (${pf.toFixed(2)})`);
    } else if (pf >= 1.5) {
      score += 2;
    } else if (pf < 1) {
      score -= 8;
      reasons.push(`Profit factor < 1 (${pf.toFixed(2)})`);
    }
  }

  if (Number.isFinite(ddPct)) {
    if (ddPct <= 10) {
      score += 5;
      reasons.push(`Низкая просадка (${ddPct.toFixed(1)}%)`);
    } else if (ddPct <= 18) {
      score += 2;
    } else if (ddPct > 30) {
      score -= 5;
      reasons.push(`Большая просадка (${ddPct.toFixed(1)}%)`);
    }
  }

  if (Number.isFinite(days) && days < 28) {
    score -= 6;
    reasons.push(`Короткая история (${days} дн.)`);
  }

  if (
    Number.isFinite(grossProfit) &&
    grossProfit > 80 &&
    Number.isFinite(trades) &&
    trades < 35
  ) {
    score -= 10;
    reasons.push("Мало сделок при высокой прибыли — ненадёжно");
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
    reasons.push("Почти нет убыточных сделок — мало статистики");
  }

  if (!verdictOk) {
    score = Math.min(score, 38);
    if (!reasons.some((r) => r.includes("ограничен"))) {
      reasons.push("Без зелёного Test индекс не выше 38%");
    }
  }

  return {
    score: clampScore(score),
    reasons
  };
}

/**
 * @param {{ best?: object }|null|undefined} row
 * @returns {number|null}
 */
export function rsiTouchFlipSuitabilityScore(row) {
  return rsiTouchFlipSuitabilityDetail(row).score;
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

/**
 * @param {unknown} value
 * @returns {string}
 */
export function formatSuitabilityTooltip(reasons) {
  const list = Array.isArray(reasons) ? reasons.filter(Boolean) : [];
  return list.length
    ? list.join(" · ")
    : "Индекс по метрикам Train, Test и Обзор";
}
