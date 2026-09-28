/**
 * Кривая доходности по закрытым сделкам, в долларах.
 * Точки — выходы, как Cumulative PnL на странице Алготрейдинг.
 */

function timeOf(candles, index) {
  const raw = Number(candles[index]?.time);
  if (!Number.isFinite(raw) || raw <= 0) {
    return null;
  }
  return raw > 1e12 ? raw : raw * 1000;
}

export function buildEquitySeries(closedTrades, candles) {
  const rows = Array.isArray(candles) ? candles : [];
  const trades = (Array.isArray(closedTrades) ? closedTrades : [])
    .filter((trade) => {
      const idx = Math.floor(Number(trade?.exitIndex));
      return Number.isFinite(idx) && idx >= 0 && Number.isFinite(Number(trade?.pnl));
    })
    .slice()
    .sort((a, b) => Math.floor(a.exitIndex) - Math.floor(b.exitIndex));
  const points = [];
  const bars = [];
  const start = timeOf(rows, 0);
  if (start != null) {
    points.push({ time: start, value: 0, marker: false });
  }
  let cumulative = 0;
  for (const trade of trades) {
    const time = timeOf(rows, Math.floor(Number(trade.exitIndex)));
    if (time == null) {
      continue;
    }
    const pnl = Number(trade.pnl);
    cumulative += pnl;
    const last = points[points.length - 1];
    if (last && last.time === time) {
      last.value = cumulative;
      last.marker = true;
    } else if (!last || time > last.time) {
      points.push({ time, value: cumulative, marker: true });
    }
    const prevBar = bars[bars.length - 1];
    if (prevBar && prevBar.time === time) {
      prevBar.value += pnl;
    } else {
      bars.push({ time, value: pnl });
    }
  }
  const end = timeOf(rows, rows.length - 1);
  if (end != null && (!points.length || end > points[points.length - 1].time)) {
    points.push({ time: end, value: cumulative, marker: false });
  }
  return { points, bars, last: cumulative };
}

export function drawEquityChart(canvas, series) {
  const points = series?.points || [];
  const bars = series?.bars || [];
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(320, canvas.clientWidth || 640);
  const height = 220;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0f1419";
  ctx.fillRect(0, 0, width, height);
  const padL = 8;
  const padR = 64;
  const padT = 16;
  const padB = 22;
  const plotH = height - padT - padB;
  const histH = Math.round(plotH * 0.18);
  const lineH = plotH - histH - 8;
  const times = points.map((point) => point.time);
  const minT = times.length ? Math.min(...times) : 0;
  const maxT = times.length ? Math.max(...times) : 1;
  const span = Math.max(1, maxT - minT);
  const xAt = (time) => padL + ((time - minT) / span) * (width - padL - padR);
  let minV = 0;
  let maxV = 0;
  for (const point of points) {
    minV = Math.min(minV, point.value);
    maxV = Math.max(maxV, point.value);
  }
  if (minV === maxV) {
    maxV = minV + 1;
  }
  const yAt = (value) => padT + (1 - (value - minV) / (maxV - minV)) * lineH;
  ctx.strokeStyle = "#2a3548";
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  const y0 = yAt(0);
  ctx.moveTo(padL, y0);
  ctx.lineTo(width - padR, y0);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.strokeStyle = "#22c55e";
  ctx.lineWidth = 2;
  points.forEach((point, index) => {
    const x = xAt(point.time);
    const y = yAt(point.value);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
  ctx.fillStyle = "#22c55e";
  for (const point of points) {
    if (!point.marker) {
      continue;
    }
    ctx.beginPath();
    ctx.arc(xAt(point.time), yAt(point.value), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const last = points.length ? points[points.length - 1].value : 0;
  ctx.fillStyle = "#22c55e";
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const lastPoint = points[points.length - 1];
  if (lastPoint) {
    ctx.fillText(last.toFixed(2), xAt(lastPoint.time) + 6, yAt(lastPoint.value));
  }
  const baseY = padT + lineH + 8 + histH;
  let maxBar = 0;
  for (const bar of bars) {
    maxBar = Math.max(maxBar, Math.abs(bar.value));
  }
  maxBar = maxBar || 1;
  const barW = Math.max(2, Math.min(8, (width - padL - padR) / Math.max(bars.length, 1) * 0.6));
  for (const bar of bars) {
    const h = (Math.abs(bar.value) / maxBar) * (histH - 2);
    const x = xAt(bar.time) - barW / 2;
    ctx.fillStyle = bar.value >= 0 ? "#26a69a" : "#ef5350";
    if (bar.value >= 0) {
      ctx.fillRect(x, baseY - h, barW, h);
    } else {
      ctx.fillRect(x, baseY, barW, h);
    }
  }
  ctx.fillStyle = "#9ca3af";
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  if (points.length) {
    const from = new Date(minT);
    const to = new Date(maxT);
    const label = (date) =>
      date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    ctx.fillText(label(from), padL, height - 6);
    ctx.textAlign = "right";
    ctx.fillText(label(to), width - padR, height - 6);
  }
}
