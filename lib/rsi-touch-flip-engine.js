/**
 * RSI Touch Flip — копия логики pine (RSI Touch Flip Strategy).
 * Касание OS → лонг/стек, касание OB → шорт/стек, противоположное касание
 * закрывает весь стек. process_orders_on_close. Опциональный СЛ цикла —
 * закрыть открытый стек, если нереализованный минус ≥ % бюджета.
 */
import {
RSI_TOUCH_FLIP_SIDE_LONG,
RSI_TOUCH_FLIP_SIDE_SHORT,
RSI_TOUCH_FLIP_SIZE_EQUAL,
normalizeRsiTouchFlipPrefs
} from "./rsi-touch-flip-prefs.js";

function rsiFromAvg(
avgGain,
avgLoss
){

if(
avgLoss ===
0
){
return 100;
}

if(
avgGain ===
0
){
return 0;
}

return 100 -
(
100 /
(
1 +
avgGain /
avgLoss
)
);

}

/**
 * Wilder RSI, как ta.rsi в TradingView.
 * @param {Array<{close:number}>} candles
 * @param {number} period
 * @returns {number[]}
 */
export function computeWilderRsiValues(
candles,
period
){

const rows =
Array.isArray(
candles
)
? candles
: [];
const len =
Math.max(
2,
Math.round(
Number(
period
) ||
14
)
);
const out =
new Array(
rows.length
).fill(
NaN
);

if(
rows.length <
len +
1
){
return out;
}

let gainSum =
0;
let lossSum =
0;

for(
let i =
1;
i <=
len;
i++
){
const diff =
Number(
rows[i]?.close
) -
Number(
rows[i - 1]?.close
);

if(
!Number.isFinite(
diff
)
){
return out;
}

if(
diff >=
0
){
gainSum +=
diff;
}else{
lossSum -=
diff;
}
}

let avgGain =
gainSum /
len;
let avgLoss =
lossSum /
len;
out[len] =
rsiFromAvg(
avgGain,
avgLoss
);

for(
let i =
len +
1;
i <
rows.length;
i++
){
const diff =
Number(
rows[i]?.close
) -
Number(
rows[i - 1]?.close
);

if(
!Number.isFinite(
diff
)
){
out[i] =
NaN;
continue;
}

const gain =
diff >
0
? diff
: 0;
const loss =
diff <
0
? -diff
: 0;
avgGain =
(
avgGain *
(
len -
1
) +
gain
) /
len;
avgLoss =
(
avgLoss *
(
len -
1
) +
loss
) /
len;
out[i] =
rsiFromAvg(
avgGain,
avgLoss
);
}

return out;

}

/**
 * @param {number} level
 * @param {object} settings
 * @returns {number}
 */
export function notionalAt(
level,
settings
){

const n =
Math.max(
1,
Math.round(
Number(
settings?.maxStack
) ||
1
)
);
const budget =
Math.max(
0,
Number(
settings?.budget
) ||
0
);
const slice =
budget /
n;

if(
settings?.sizeMode ===
RSI_TOUCH_FLIP_SIZE_EQUAL ||
Number(
settings?.sizeMult
) <=
1.000000000001
){
return slice;
}

const m =
Number(
settings.sizeMult
);
const tot =
(
Math.pow(
m,
n
) -
1
) /
(
m -
1
);

if(
!(
tot >
0
)
){
return 0;
}

return budget *
Math.pow(
m,
Math.max(
0,
level
)
) /
tot;

}

/**
 * СЛ цикла: нереализованный минус ≥ cycleSlPct от бюджета тикера.
 * @param {unknown} unrealizedPnl
 * @param {unknown} budget
 * @param {object|null|undefined} prefs
 * @returns {boolean}
 */
export function rsiTouchFlipCycleSlHit(
unrealizedPnl,
budget,
prefs
){

if(
prefs?.cycleSlEnabled !==
true
){
return false;
}

const pct =
Number(
prefs.cycleSlPct
);
const cap =
Number(
budget
);
const pnl =
Number(
unrealizedPnl
);

if(
!(
pct >
0
) ||
!(
cap >
0
) ||
!Number.isFinite(
pnl
)
){
return false;
}

return pnl <=
-(
cap *
pct
) /
100;

}

function coinsFromUsdt(
usdt,
price
){

const px =
Math.max(
Number(
price
) ||
0,
1e-12
);

return usdt /
px;

}

function commissionOn(
qty,
price,
rate
){

return Math.abs(
qty
) *
Math.max(
0,
price
) *
Math.max(
0,
rate
);

}

function emptyOverview(
capital
){

return {
netProfit:
0,
netProfitPct:
0,
grossProfit:
0,
grossProfitPct:
0,
grossLoss:
0,
grossLossPct:
0,
closedTrades:
0,
longProfit:
0,
longProfitPct:
0,
shortProfit:
0,
shortProfitPct:
0,
percentProfitable:
NaN,
profitFactor:
NaN,
maxDrawdown:
0,
maxDrawdownPct:
0,
avgTrade:
NaN,
avgTradePct:
NaN,
avgBars:
NaN,
equity:
capital,
openTrades:
0,
openPnl:
0
};

}

function finishOverview(
{
capital,
closed,
equityPeak,
maxDrawdown,
lastEquity,
openTrades,
openPnl
}
){

let grossProfit =
0;
let grossLoss =
0;
let winCount =
0;
let barsSum =
0;
let longProfit =
0;
let shortProfit =
0;

for(
const trade of closed
){
const pnl =
trade.pnl;

if(
pnl >
0
){
grossProfit +=
pnl;
winCount +=
1;
}else if(
pnl <
0
){
grossLoss +=
pnl;
}

if(
trade.side ===
"long"
){
longProfit +=
pnl;
}else if(
trade.side ===
"short"
){
shortProfit +=
pnl;
}

barsSum +=
trade.bars;
}

const closedTrades =
closed.length;
const netProfit =
grossProfit +
grossLoss;
const pctOfCapital =
value=>
capital >
0
? value /
capital *
100
: 0;

return {
netProfit,
netProfitPct:
pctOfCapital(
netProfit
),
grossProfit,
grossProfitPct:
pctOfCapital(
grossProfit
),
grossLoss,
grossLossPct:
pctOfCapital(
grossLoss
),
closedTrades,
longProfit,
longProfitPct:
pctOfCapital(
longProfit
),
shortProfit,
shortProfitPct:
pctOfCapital(
shortProfit
),
percentProfitable:
closedTrades >
0
? winCount /
closedTrades *
100
: NaN,
profitFactor:
grossLoss <
0
? grossProfit /
Math.abs(
grossLoss
)
: grossProfit >
0
? Infinity
: NaN,
maxDrawdown,
maxDrawdownPct:
equityPeak >
0
? maxDrawdown /
equityPeak *
100
: 0,
avgTrade:
closedTrades >
0
? netProfit /
closedTrades
: NaN,
avgTradePct:
closedTrades >
0
? pctOfCapital(
netProfit /
closedTrades
)
: NaN,
avgBars:
closedTrades >
0
? barsSum /
closedTrades
: NaN,
equity:
lastEquity,
openTrades:
openTrades.length,
openPnl
};

}

/**
 * @param {Array<{time:number, close:number, high?:number, low?:number}>} candles
 * @param {object} [rawSettings]
 * @param {{ rsiValues?: number[] }} [opts]
 */
export function runRsiTouchFlip(
candles,
rawSettings,
opts =
{}
){

const settings =
normalizeRsiTouchFlipPrefs(
rawSettings
);
const rows =
Array.isArray(
candles
)
? candles
: [];
const capital =
Number(
settings.budget
);
const commissionRate =
settings.commissionPct /
100;
const allowLong =
settings.tradeSide !==
RSI_TOUCH_FLIP_SIDE_SHORT;
const allowShort =
settings.tradeSide !==
RSI_TOUCH_FLIP_SIDE_LONG;
const rsiValues =
Array.isArray(
opts.rsiValues
) &&
opts.rsiValues.length ===
rows.length
? opts.rsiValues
: computeWilderRsiValues(
rows,
settings.rsiLen
);

const closed =
[];
/** @type {Array<{side:"long"|"short", qty:number, entryPrice:number, entryIndex:number, tag:string, entryCommission:number}>} */
let openTrades =
[];
let realized =
0;
let peak =
capital;
let maxDrawdown =
0;
let slBlockLong =
false;
let slBlockShort =
false;
const marks =
[];

function positionSize(){

let signed =
0;

for(
const trade of openTrades
){
signed +=
trade.side ===
"long"
? trade.qty
: -trade.qty;
}

return signed;

}

function unrealizedPnl(
price
){

let pnl =
0;

for(
const trade of openTrades
){
const move =
trade.side ===
"long"
? price -
trade.entryPrice
: trade.entryPrice -
price;
pnl +=
move *
trade.qty;
}

return pnl;

}

function pushMark(
index,
kind,
text
){

const bar =
rows[index];
const time =
Number(
bar?.time
);

if(
!Number.isFinite(
time
)
){
return;
}

marks.push(
{
time,
index,
kind,
text,
price:
Number(
bar.close
)
}
);

}

function closeAll(
index,
price,
comment,
markText
){

if(
!openTrades.length
){
return;
}

const side =
openTrades[0].side;

for(
const trade of openTrades
){
const exitCommission =
commissionOn(
trade.qty,
price,
commissionRate
);
const move =
trade.side ===
"long"
? price -
trade.entryPrice
: trade.entryPrice -
price;
const pnl =
move *
trade.qty -
trade.entryCommission -
exitCommission;
realized +=
pnl;
closed.push(
{
side:
trade.side,
tag:
trade.tag,
qty:
trade.qty,
entryPrice:
trade.entryPrice,
exitPrice:
price,
entryIndex:
trade.entryIndex,
exitIndex:
index,
bars:
Math.max(
0,
index -
trade.entryIndex
),
pnl,
comment
}
);
}

openTrades =
[];
pushMark(
index,
"close",
markText ||
(
side ===
"long"
? "SELL ALL"
: "BUY ALL"
)
);

return side;

}

function openEntry(
index,
price,
side,
level
){

const usdt =
notionalAt(
level,
settings
);
const qty =
coinsFromUsdt(
usdt,
price
);

if(
!(
qty >
0
)
){
return false;
}

const tagPrefix =
side ===
"long"
? "L"
: "S";
const tag =
`${tagPrefix}${level + 1}`;
openTrades.push(
{
side,
qty,
entryPrice:
price,
entryIndex:
index,
tag,
entryCommission:
commissionOn(
qty,
price,
commissionRate
)
}
);
pushMark(
index,
side,
tag
);
return true;

}

function trackEquity(
price
){

const equity =
capital +
realized +
unrealizedPnl(
price
);

if(
equity >
peak
){
peak =
equity;
}

const dd =
peak -
equity;

if(
dd >
maxDrawdown
){
maxDrawdown =
dd;
}

return equity;

}

for(
let i =
0;
i <
rows.length;
i++
){
const price =
Number(
rows[i]?.close
);
const rsi =
Number(
rsiValues[i]
);
const prevRsi =
Number(
rsiValues[i - 1]
);
const ready =
Number.isFinite(
rsi
) &&
Number.isFinite(
prevRsi
);
const touchOS =
ready &&
prevRsi >
settings.osLevel &&
rsi <=
settings.osLevel;
const touchOB =
ready &&
prevRsi <
settings.obLevel &&
rsi >=
settings.obLevel;

if(
touchOS
){
pushMark(
i,
"os",
"OS"
);
}

if(
touchOB
){
pushMark(
i,
"ob",
"OB"
);
}

if(
!Number.isFinite(
price
) ||
price <=
0
){
trackEquity(
price
);
continue;
}

if(
rsiTouchFlipCycleSlHit(
unrealizedPnl(
price
),
capital,
settings
) &&
openTrades.length
){
const slSide =
closeAll(
i,
price,
"CYCLE SL",
"SL"
);

if(
slSide ===
"long"
){
slBlockLong =
true;
}

if(
slSide ===
"short"
){
slBlockShort =
true;
}

}

if(
slBlockLong &&
Number.isFinite(
rsi
) &&
rsi >
settings.osLevel
){
slBlockLong =
false;
}

if(
slBlockShort &&
Number.isFinite(
rsi
) &&
rsi <
settings.obLevel
){
slBlockShort =
false;
}

const signed =
positionSize();
const inLong =
signed >
0;
const inShort =
signed <
0;
const isFlat =
signed ===
0;
const nOpen =
openTrades.length;
const osCloseShort =
touchOS &&
inShort;
const osAddLong =
touchOS &&
inLong &&
nOpen <
settings.maxStack &&
!slBlockLong;
const osOpenLong =
touchOS &&
allowLong &&
(
inShort ||
isFlat
) &&
!slBlockLong;
const obCloseLong =
touchOB &&
inLong;
const obAddShort =
touchOB &&
inShort &&
nOpen <
settings.maxStack &&
!slBlockShort;
const obOpenShort =
touchOB &&
allowShort &&
(
inLong ||
isFlat
) &&
!slBlockShort;
const longLevel =
osCloseShort
? 0
: nOpen;
const shortLevel =
obCloseLong
? 0
: nOpen;

if(
osCloseShort
){
closeAll(
i,
price,
"BUY ALL @ OS"
);
}

if(
(
osOpenLong ||
osAddLong
) &&
allowLong
){
openEntry(
i,
price,
"long",
longLevel
);
}

if(
obCloseLong
){
closeAll(
i,
price,
"SELL ALL @ OB"
);
}

if(
(
obOpenShort ||
obAddShort
) &&
allowShort
){
openEntry(
i,
price,
"short",
shortLevel
);
}

trackEquity(
price
);
}

const lastPrice =
Number(
rows[rows.length - 1]?.close
) ||
0;
const openPnl =
unrealizedPnl(
lastPrice
);
const lastEquity =
capital +
realized +
openPnl;

return {
overview:
rows.length
? finishOverview(
{
capital,
closed,
equityPeak:
peak,
maxDrawdown,
lastEquity,
openTrades,
openPnl
}
)
: emptyOverview(
capital
),
marks,
closedTrades:
closed,
openTrades
};

}
