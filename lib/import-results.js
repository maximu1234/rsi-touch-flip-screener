import { configFingerprint, normalizeConfig } from "../src/defaults.js";

function nowIso() {
  return new Date().toISOString();
}

function num(raw) {
  if (raw === "" || raw == null) {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsvText(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (!lines.length) {
    return [];
  }
  const header = parseCsvLine(lines[0]).map((cell) => cell.trim());
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const rec = {};
    for (let i = 0; i < header.length; i += 1) {
      rec[header[i]] = cells[i] ?? "";
    }
    return rec;
  });
}

function rowFromCsvRecord(rec) {
  const symbol = String(rec.symbol || "")
    .replace(/\.P$/i, "")
    .trim()
    .toUpperCase();
  if (!symbol) {
    return null;
  }

  const status = String(rec.status || "").trim() || (rec.error ? "error" : "done");
  if (status === "error" || rec.error) {
    return {
      symbol,
      status: "error",
      error: String(rec.error || "error"),
      updatedAt: nowIso()
    };
  }

  const overview = {};
  for (const key of [
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
    "avgBars"
  ]) {
    const value = num(rec[key]);
    if (value !== undefined) {
      overview[key] = value;
    }
  }

  const combo = {
    rsiLen: num(rec.rsiLen),
    osLevel: num(rec.osLevel),
    obLevel: num(rec.obLevel),
    maxStack: num(rec.maxStack)
  };

  const ok =
    rec.ok === "yes" ? true : rec.ok === "no" ? false : undefined;
  const reasons = String(rec.reasons || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  const trainNet = num(rec.trainNet);
  const testNet = num(rec.testNet);
  const testTrades = num(rec.testTrades);

  return {
    symbol,
    status: "done",
    best: {
      combo,
      overview,
      train: trainNet !== undefined ? { netProfit: trainNet } : undefined,
      test: {
        ...(testNet !== undefined ? { netProfit: testNet } : {}),
        ...(testTrades !== undefined ? { closedTrades: testTrades } : {})
      },
      verdict: {
        ok,
        reasons
      }
    },
    updatedAt: nowIso()
  };
}

function csvToSnapshot(text) {
  const records = parseCsvText(text);
  const rows = {};
  for (const rec of records) {
    const row = rowFromCsvRecord(rec);
    if (row) {
      rows[row.symbol] = row;
    }
  }
  if (!Object.keys(rows).length) {
    throw new Error("В CSV нет распознанных строк");
  }
  return { rows };
}

/**
 * @param {unknown} raw
 * @returns {{ config: object, fingerprint: string, rows: Record<string, object>, startedAt: string|null, stoppedAt: string|null }}
 */
export function normalizeImportPayload(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  let rows = src.rows;
  if (Array.isArray(rows)) {
    rows = Object.fromEntries(
      rows
        .filter((row) => row?.symbol)
        .map((row) => [
          String(row.symbol).replace(/\.P$/i, "").trim().toUpperCase(),
          row
        ])
    );
  } else if (!rows || typeof rows !== "object") {
    throw new Error("В файле нет таблицы rows");
  }

  const normalizedRows = {};
  for (const [key, row] of Object.entries(rows)) {
    const symbol = String(row?.symbol || key)
      .replace(/\.P$/i, "")
      .trim()
      .toUpperCase();
    if (!symbol) {
      continue;
    }
    normalizedRows[symbol] = { ...row, symbol };
  }

  if (!Object.keys(normalizedRows).length) {
    throw new Error("В файле нет тикеров");
  }

  const config = normalizeConfig(src.config || {});
  return {
    config,
    fingerprint: String(src.fingerprint || configFingerprint(config)),
    rows: normalizedRows,
    startedAt: src.startedAt || null,
    stoppedAt: src.stoppedAt || nowIso()
  };
}

/**
 * @param {string} text
 * @param {string} filename
 */
export function parseImportFile(text, filename) {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".json")) {
    let parsed;
    try {
      parsed = JSON.parse(String(text || ""));
    } catch {
      throw new Error("Не удалось разобрать JSON");
    }
    return normalizeImportPayload(parsed);
  }
  if (name.endsWith(".csv")) {
    const snap = csvToSnapshot(text);
    return normalizeImportPayload(snap);
  }
  throw new Error("Поддерживаются файлы .json и .csv");
}
