function nowIso() {
  return new Date().toISOString();
}

function csvEscape(cell) {
  const s = String(cell);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function rowsToCsv(rows) {
  const header = [
    "symbol",
    "status",
    "ok",
    "rsiLen",
    "osLevel",
    "obLevel",
    "maxStack",
    "chartDays",
    "netProfit",
    "netProfitPct",
    "longProfit",
    "longProfitPct",
    "shortProfit",
    "shortProfitPct",
    "grossProfit",
    "grossProfitPct",
    "grossLoss",
    "grossLossPct",
    "closedTrades",
    "percentProfitable",
    "profitFactor",
    "maxDrawdown",
    "maxDrawdownPct",
    "avgTrade",
    "avgTradePct",
    "avgBars",
    "trainNet",
    "testNet",
    "testTrades",
    "reasons",
    "error"
  ];
  const lines = [header.join(",")];
  for (const row of rows || []) {
    const o = row.best?.overview || {};
    const c = row.best?.combo || {};
    const v = row.best?.verdict || {};
    const cells = [
      row.symbol,
      row.status || (row.error ? "error" : row.best ? "done" : "queued"),
      v.ok === true ? "yes" : v.ok === false ? "no" : "",
      c.rsiLen ?? "",
      c.osLevel ?? "",
      c.obLevel ?? "",
      c.maxStack ?? "",
      o.chartDays ?? "",
      o.netProfit ?? "",
      o.netProfitPct ?? "",
      o.longProfit ?? "",
      o.longProfitPct ?? "",
      o.shortProfit ?? "",
      o.shortProfitPct ?? "",
      o.grossProfit ?? "",
      o.grossProfitPct ?? "",
      o.grossLoss ?? "",
      o.grossLossPct ?? "",
      o.closedTrades ?? "",
      o.percentProfitable ?? "",
      o.profitFactor ?? "",
      o.maxDrawdown ?? "",
      o.maxDrawdownPct ?? "",
      o.avgTrade ?? "",
      o.avgTradePct ?? "",
      o.avgBars ?? "",
      row.best?.train?.netProfit ?? "",
      row.best?.test?.netProfit ?? "",
      row.best?.test?.closedTrades ?? "",
      (v.reasons || []).join("; "),
      row.error || row.note || ""
    ];
    lines.push(cells.map(csvEscape).join(","));
  }
  return `\uFEFF${lines.join("\n")}\n`;
}

export function downloadText(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportBasename(exchange = "bybit") {
  return `rsi-touch-flip-${exchange}-${nowIso().slice(0, 10)}`;
}
