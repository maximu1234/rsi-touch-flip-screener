export function uniqueSymbols(list) {
  return [
    ...new Set((list || []).map((s) => String(s || "").trim()).filter(Boolean))
  ];
}

function symbolsFromRows(rows) {
  if (!rows) {
    return [];
  }
  if (Array.isArray(rows)) {
    return uniqueSymbols(rows.map((row) => row?.symbol));
  }
  return uniqueSymbols(Object.keys(rows));
}

/**
 * Resume must keep the saved ticker queue. Re-listing Bybit after reload
 * is slow and can fail (Failed to fetch), which looks like Continue does nothing.
 * Returns null when a fresh universe fetch is required.
 */
export function pickScanSymbols(config, prevConfig, rows, resuming) {
  const current = uniqueSymbols(config?.symbols);
  if (current.length) {
    return current;
  }
  if (!resuming) {
    return null;
  }
  const previous = uniqueSymbols(prevConfig?.symbols);
  if (previous.length) {
    return previous;
  }
  const fromRows = symbolsFromRows(rows);
  return fromRows.length ? fromRows : null;
}
