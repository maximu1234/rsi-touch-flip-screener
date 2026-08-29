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
} from "./rsi-touch-flip-prefs.js?v=6";

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
settings,
budgetOverride
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
budgetOverride
) ||
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

/**
 * @param {object} bar
 * @returns {object}
 */
export function decideRsiTouchFlipBar(
bar =
{}
){

const rsi =
Number(
bar.rsi
);
const prevRsi =
Number(
bar.prevRsi
);
const osLevel =
Number(
bar.osLevel
);
const obLevel =
Number(
bar.obLevel
);
const maxStack =
Math.max(
1,
Math.round(
Number(
bar.maxStack
) ||
1
)
);
const nOpen =
Math.max(
0,
Math.round(
Number(
bar.stack
) ||
0
)
);
const allowLong =
bar.allowLong !==
false;
const allowShort =
bar.allowShort !==
false;
const position =
String(
bar.position ||
"flat"
);
const inLong =
position ===
"long";
const inShort =
position ===
"short";
const isFlat =
!inLong &&
!inShort;
const invert =
bar.invertEntries ===
true;
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
osLevel &&
rsi <=
osLevel;
const touchOB =
ready &&
prevRsi <
obLevel &&
rsi >=
obLevel;
const slBlockLong =
bar.slBlockLong ===
true;
const slBlockShort =
bar.slBlockShort ===
true;

let closeShort;
let closeLong;
let openLong;
let openShort;
let addLong;
let addShort;

if(
!invert
){
closeShort =
touchOS &&
inShort;
addLong =
touchOS &&
inLong &&
nOpen <
maxStack;
openLong =
touchOS &&
allowLong &&
(
inShort ||
isFlat
);
closeLong =
touchOB &&
inLong;
addShort =
touchOB &&
inShort &&
nOpen <
maxStack;
openShort =
touchOB &&
allowShort &&
(
inLong ||
isFlat
);
}else{
closeLong =
touchOS &&
inLong;
addShort =
touchOS &&
inShort &&
nOpen <
maxStack;
openShort =
touchOS &&
allowShort &&
(
inLong ||
isFlat
);
closeShort =
touchOB &&
inShort;
addLong =
touchOB &&
inLong &&
nOpen <
maxStack;
openLong =
touchOB &&
allowLong &&
(
inShort ||
isFlat
);
}

return {
touchOS,
touchOB,
closeShort,
closeLong,
openLong:
!!(
openLong ||
addLong
) &&
allowLong &&
!slBlockLong,
openShort:
!!(
openShort ||
addShort
) &&
allowShort &&
!slBlockShort,
longLevel:
closeShort
? 0
: nOpen,
shortLevel:
closeLong
? 0
: nOpen
};

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
maxTradeMae:
0,
maxTradeMaePct:
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
0,
liquidations:
0,
tradingHalted:
false,
finalEquity:
capital
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
openPnl,
liquidations,
tradingHalted,
maxTradeMae,
maxTradeMaePct
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
maxTradeMae:
Number(
maxTradeMae
) ||
0,
maxTradeMaePct:
Number(
maxTradeMaePct
) ||
0,
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
openPnl,
liquidations:
Number(
liquidations
) ||
0,
tradingHalted:
!!tradingHalted,
finalEquity:
lastEquity
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
const compoundOn =
settings.compoundEnabled ===
true;
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
let entryBudget =
null;
let tradingHalted =
false;
let liquidationCount =
0;
let cycleWorstUnrealized =
0;
let cycleAdverseBudget =
null;
let maxTradeMae =
0;
let maxTradeMaePct =
0;
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

function noteCycleAdverse(
price
){

if(
!openTrades.length
){
return;
}

const unrealized =
unrealizedPnl(
price
);

if(
unrealized <
cycleWorstUnrealized
){
cycleWorstUnrealized =
unrealized;
}

}

function absorbCycleAdverse(){

if(
!(
cycleWorstUnrealized <
0
)
){
cycleWorstUnrealized =
0;
cycleAdverseBudget =
null;
return;
}

const loss =
-cycleWorstUnrealized;
const base =
Number(
cycleAdverseBudget
) >
0
? Number(
cycleAdverseBudget
)
: Number(
entryBudget
) >
0
? Number(
entryBudget
)
: capital;

if(
loss >
maxTradeMae
){
maxTradeMae =
loss;

if(
base >
0
){
maxTradeMaePct =
loss /
base *
100;
}
}

cycleWorstUnrealized =
0;
cycleAdverseBudget =
null;

}

function currentEquity(
price
){

return capital +
realized +
unrealizedPnl(
price
);

}

function enforceLiquidation(
index,
price
){

if(
tradingHalted
){
return true;
}

const equity =
currentEquity(
price
);

if(
equity >
0
){
return false;
}

if(
openTrades.length
){
closeAll(
index,
price,
"LIQUIDATION",
"LIQ"
);
}

if(
!tradingHalted
){
liquidationCount +=
1;
pushMark(
index,
"liquidation",
"LIQ"
);
tradingHalted =
true;
entryBudget =
null;
}

return true;

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

absorbCycleAdverse();

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
entryBudget =
null;
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

if(
tradingHalted
){
return false;
}

const equity =
currentEquity(
price
);

if(
!(
equity >
0
)
){
enforceLiquidation(
index,
price
);
return false;
}

if(
!openTrades.length
){
cycleWorstUnrealized =
0;

if(
compoundOn
){
entryBudget =
equity;
cycleAdverseBudget =
entryBudget;
}else{
entryBudget =
null;
cycleAdverseBudget =
Number(
settings.budget
) ||
0;
}
}else if(
compoundOn &&
!(
Number(
entryBudget
) >
0
)
){
entryBudget =
equity;
}

if(
!(
Number(
cycleAdverseBudget
) >
0
)
){
cycleAdverseBudget =
compoundOn
? entryBudget
: Number(
settings.budget
) ||
0;
}

const usdt =
notionalAt(
level,
settings,
compoundOn
? entryBudget
: undefined
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
tradingHalted
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
compoundOn
? (
Number(
entryBudget
) >
0
? Number(
entryBudget
)
: currentEquity(
price
)
)
: capital,
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
const position =
signed >
0
? "long"
: signed <
0
? "short"
: "flat";
const decision =
decideRsiTouchFlipBar(
{
rsi,
prevRsi,
osLevel:
settings.osLevel,
obLevel:
settings.obLevel,
stack:
openTrades.length,
position,
maxStack:
settings.maxStack,
allowLong,
allowShort,
slBlockLong,
slBlockShort,
invertEntries:
settings.invertEntries ===
true
}
);
const invert =
settings.invertEntries ===
true;

if(
decision.closeShort
){
closeAll(
i,
price,
invert
? "BUY ALL @ OB"
: "BUY ALL @ OS"
);
}

if(
decision.openLong &&
allowLong
){
openEntry(
i,
price,
"long",
decision.longLevel
);
}

if(
decision.closeLong
){
closeAll(
i,
price,
invert
? "SELL ALL @ OS"
: "SELL ALL @ OB"
);
}

if(
decision.openShort &&
allowShort
){
openEntry(
i,
price,
"short",
decision.shortLevel
);
}

trackEquity(
price
);
noteCycleAdverse(
price
);
enforceLiquidation(
i,
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

noteCycleAdverse(
lastPrice
);
absorbCycleAdverse();

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
openTrades:
openTrades.length,
openPnl,
liquidations:
liquidationCount,
tradingHalted,
maxTradeMae,
maxTradeMaePct
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
