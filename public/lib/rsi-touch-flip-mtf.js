/**
 * RSI Touch Flip — request.security как в pine (lookahead_off).
 * На закрытии свечи графика берём RSI последнего уже закрытого бара источника.
 * 1m на 5m — младший ТФ, не HTF-проекция по open.
 */
import {
computeWilderRsiValues
} from "./rsi-touch-flip-engine.js";
import {
normalizeRsiTouchFlipPrefs
} from "./rsi-touch-flip-prefs.js";

const KLINE_PAGE =
1000;
const MAX_SOURCE_PAGES =
60;

const sourceCache =
new Map();

/**
 * @param {unknown} tf
 * @returns {number}
 */
export function rsiTouchFlipTfPeriodSec(
tf
){

const t =
String(
tf ||
""
).trim();

if(
t ===
"D"
){
return 86400;
}

if(
t ===
"W"
){
return 604800;
}

const n =
Number(
t
);

return Number.isFinite(
n
) &&
n >
0
? n *
60
: 0;

}

/**
 * @param {unknown} raw
 * @returns {number}
 */
export function rsiTouchFlipUnixSec(
raw
){

const n =
Number(
raw
);

if(
!Number.isFinite(
n
) ||
n <
0
){
return NaN;
}

return n >
1e12
? Math.floor(
n /
1000
)
: n;

}

/**
 * Сколько дней покрывает история на графике (open первой → close последней).
 * @param {Array<{time:number}>} chartCandles
 * @param {string} chartTf
 * @returns {number}
 */
export function rsiTouchFlipChartDays(
chartCandles,
chartTf
){

const rows =
Array.isArray(
chartCandles
)
? chartCandles
: [];

if(
!rows.length
){
return NaN;
}

const first =
rsiTouchFlipUnixSec(
rows[0].time
);
const last =
rsiTouchFlipUnixSec(
rows[rows.length - 1].time
);
const period =
rsiTouchFlipTfPeriodSec(
chartTf
);

if(
!Number.isFinite(
first
) ||
!Number.isFinite(
last
) ||
last <
first ||
!(
period >
0
)
){
return NaN;
}

return (
last -
first +
period
) /
86400;

}

/**
 * Сколько страниц kline (по 1000), чтобы источник покрыл весь график.
 * @param {Array<{time:number}>} chartCandles
 * @param {string} chartTf
 * @param {string} sourceTf
 * @param {number} rsiLen
 */
export function rsiTouchFlipSourcePages(
chartCandles,
chartTf,
sourceTf,
rsiLen
){

const rows =
Array.isArray(
chartCandles
)
? chartCandles
: [];
const chartSec =
rsiTouchFlipTfPeriodSec(
chartTf
);
const srcSec =
rsiTouchFlipTfPeriodSec(
sourceTf
);

if(
!rows.length ||
!(
chartSec >
0
) ||
!(
srcSec >
0
)
){
return 1;
}

const first =
rsiTouchFlipUnixSec(
rows[0].time
);
const last =
rsiTouchFlipUnixSec(
rows[rows.length - 1].time
);
const span =
last -
first +
chartSec;
const need =
Math.ceil(
span /
srcSec
) +
Math.max(
2,
Math.round(
Number(
rsiLen
) ||
14
)
) +
5;
return Math.min(
MAX_SOURCE_PAGES,
Math.max(
1,
Math.ceil(
need /
KLINE_PAGE
)
)
);

}

/**
 * Последний бар источника, который уже закрыт к закрытию свечи графика.
 * @param {Array<{time:number}>} chartCandles
 * @param {string} chartTf
 * @param {Array<{time:number}>} sourceCandles
 * @param {string} sourceTf
 * @param {number[]} sourceRsi
 * @returns {number[]}
 */
export function projectClosedSourceRsiOntoChart(
chartCandles,
chartTf,
sourceCandles,
sourceTf,
sourceRsi
){

const chart =
Array.isArray(
chartCandles
)
? chartCandles
: [];
const source =
Array.isArray(
sourceCandles
)
? sourceCandles
: [];
const rsi =
Array.isArray(
sourceRsi
)
? sourceRsi
: [];
const out =
new Array(
chart.length
).fill(
NaN
);
const chartSec =
rsiTouchFlipTfPeriodSec(
chartTf
);
const srcSec =
rsiTouchFlipTfPeriodSec(
sourceTf
);

if(
!(
chartSec >
0
) ||
!(
srcSec >
0
) ||
!source.length
){
return out;
}

let j =
0;

for(
let i =
0;
i <
chart.length;
i++
){
const open =
rsiTouchFlipUnixSec(
chart[i]?.time
);

if(
!Number.isFinite(
open
)
){
continue;
}

const cutoff =
open +
chartSec -
srcSec;

while(
j +
1 <
source.length &&
rsiTouchFlipUnixSec(
source[j + 1].time
) <=
cutoff
){
j++;
}

const srcOpen =
rsiTouchFlipUnixSec(
source[j]?.time
);
const value =
Number(
rsi[j]
);

if(
Number.isFinite(
srcOpen
) &&
srcOpen <=
cutoff &&
Number.isFinite(
value
)
){
out[i] =
value;
}

}

return out;

}

async function loadSourceCandles(
symbol,
sourceTf,
pages,
endMs,
loadHistory
){

const key =
[
String(
symbol ||
""
).toUpperCase(),
sourceTf,
pages,
endMs
].join(
"|"
);
const hit =
sourceCache.get(
key
);

if(
hit
){
return hit;
}

const loaded =
await loadHistory(
symbol,
sourceTf,
pages,
{
parallel:
true,
batchGapMs:
0,
endMs
}
);
const rows =
Array.isArray(
loaded
)
? loaded
: [];
sourceCache.set(
key,
rows
);

if(
sourceCache.size >
8
){
const first =
sourceCache.keys().next().value;
sourceCache.delete(
first
);
}

return rows;

}

/**
 * RSI, выровненный по свечам графика — как ta.rsi + request.security.
 * @param {Array} chartCandles
 * @param {object} rawSettings
 * @param {{ chartTf: string, symbol: string, loadHistory: Function }} host
 * @returns {Promise<number[]>}
 */
export async function resolveRsiTouchFlipChartRsi(
chartCandles,
rawSettings,
host
){

const settings =
normalizeRsiTouchFlipPrefs(
rawSettings
);
const chart =
Array.isArray(
chartCandles
)
? chartCandles
: [];
const rsiTf =
String(
settings.rsiTf ||
""
).trim();
const chartTf =
String(
host?.chartTf ||
""
).trim();

if(
!chart.length
){
return [];
}

if(
!rsiTf ||
rsiTf ===
chartTf
){
return computeWilderRsiValues(
chart,
settings.rsiLen
);
}

const chartSec =
rsiTouchFlipTfPeriodSec(
chartTf
);
const srcSec =
rsiTouchFlipTfPeriodSec(
rsiTf
);

if(
!(
chartSec >
0
) ||
!(
srcSec >
0
)
){
return computeWilderRsiValues(
chart,
settings.rsiLen
);
}

const pages =
rsiTouchFlipSourcePages(
chart,
chartTf,
rsiTf,
settings.rsiLen
);
const last =
rsiTouchFlipUnixSec(
chart[chart.length - 1].time
);
const endMs =
(
last +
chartSec
) *
1000;
const source =
await loadSourceCandles(
host.symbol,
rsiTf,
pages,
endMs,
host.loadHistory
);
const sourceRsi =
computeWilderRsiValues(
source,
settings.rsiLen
);
return projectClosedSourceRsiOntoChart(
chart,
chartTf,
source,
rsiTf,
sourceRsi
);

}
