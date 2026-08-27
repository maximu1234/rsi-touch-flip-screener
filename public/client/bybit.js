const BASE = "https://api.bybit.com";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(path, params = {}, attempt = 0) {
  const url = new URL(path, BASE);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const res = await fetch(url, {
    credentials: "omit",
    headers: { accept: "application/json" }
  });
  if (res.status === 429 && attempt < 6) {
    await sleep(400 * (attempt + 1));
    return getJson(path, params, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(`Bybit HTTP ${res.status} ${path}`);
  }
  const json = await res.json();
  const retCode = Number(json?.retCode);
  const msg = String(json?.retMsg || "");
  if (
    (retCode === 10006 || /too many|too frequent/i.test(msg)) &&
    attempt < 6
  ) {
    await sleep(500 * (attempt + 1));
    return getJson(path, params, attempt + 1);
  }
  if (retCode !== 0) {
    throw new Error(`Bybit ${retCode}: ${msg || path}`);
  }
  return json.result || {};
}

function mapKlineRow(raw) {
  const timeMs = Number(raw?.[0]);
  const open = Number(raw?.[1]);
  const high = Number(raw?.[2]);
  const low = Number(raw?.[3]);
  const close = Number(raw?.[4]);
  const volume = Number(raw?.[5]);
  if (!Number.isFinite(timeMs) || !(close > 0)) {
    return null;
  }
  return {
    time: timeMs > 1e12 ? Math.floor(timeMs / 1000) : timeMs,
    open,
    high,
    low,
    close,
    volume
  };
}

export async function listLinearUsdtPerps() {
  const out = [];
  let cursor = "";
  for (let i = 0; i < 20; i++) {
    const result = await getJson("/v5/market/instruments-info", {
      category: "linear",
      limit: 1000,
      cursor
    });
    const list = Array.isArray(result.list) ? result.list : [];
    for (const row of list) {
      const symbol = String(row?.symbol || "").toUpperCase();
      const quote = String(row?.quoteCoin || "").toUpperCase();
      const status = String(row?.status || "");
      const type = String(row?.contractType || "");
      if (
        symbol &&
        quote === "USDT" &&
        status === "Trading" &&
        type === "LinearPerpetual"
      ) {
        out.push(symbol);
      }
    }
    cursor = String(result.nextPageCursor || "");
    if (!cursor || !list.length) {
      break;
    }
  }
  return [...new Set(out)].sort();
}

export async function listTurnoverBySymbol() {
  const result = await getJson("/v5/market/tickers", { category: "linear" });
  const list = Array.isArray(result.list) ? result.list : [];
  const map = new Map();
  for (const row of list) {
    const symbol = String(row?.symbol || "").toUpperCase();
    const turnover = Number(row?.turnover24h);
    if (symbol && Number.isFinite(turnover)) {
      map.set(symbol, turnover);
    }
  }
  return map;
}

export async function fetchKlinePages(symbol, interval, pages, endMs) {
  const limit = Math.min(10, Math.max(1, Math.round(Number(pages) || 1)));
  const extra = Math.max(0, Math.round(Number(pages) || 1) - 10);
  const batchCount = Math.min(60, limit + extra);
  let end = Number.isFinite(endMs) ? endMs : Date.now();
  const rows = [];

  for (let i = 0; i < batchCount; i++) {
    const result = await getJson("/v5/market/kline", {
      category: "linear",
      symbol,
      interval: String(interval || "5"),
      limit: 1000,
      end: String(Math.floor(end))
    });
    const list = Array.isArray(result.list) ? result.list : [];
    if (!list.length) {
      break;
    }
    rows.push(...list);
    const oldest = Math.min(
      ...list.map((raw) => Number(raw?.[0])).filter(Number.isFinite)
    );
    if (!Number.isFinite(oldest)) {
      break;
    }
    end = oldest - 1;
    if (i < batchCount - 1) {
      await sleep(80);
    }
  }

  const unique = new Map();
  for (const raw of rows) {
    const candle = mapKlineRow(raw);
    if (candle) {
      unique.set(candle.time, candle);
    }
  }
  return [...unique.values()].sort((a, b) => a.time - b.time);
}
