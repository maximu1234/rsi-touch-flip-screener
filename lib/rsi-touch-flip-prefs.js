/**
 * Настройки бота RSI Touch Flip (как inputs в pine).
 * Не смешивать с Паттерн 1-2 / Early T3.
 */

export const RSI_TOUCH_FLIP_PREFS_KEY =
"algo_trading_rsi_touch_flip_v1";

export const RSI_TOUCH_FLIP_SIZE_EQUAL =
"equal";

export const RSI_TOUCH_FLIP_SIZE_AVERAGE =
"average";

export const RSI_TOUCH_FLIP_SIDE_BOTH =
"BOTH";

export const RSI_TOUCH_FLIP_SIDE_LONG =
"LONG";

export const RSI_TOUCH_FLIP_SIDE_SHORT =
"SHORT";

export const RSI_TOUCH_FLIP_TF_OPTIONS =
[
{
value:
"",
label:
"график"
},
{
value:
"1",
label:
"1m"
},
{
value:
"5",
label:
"5m"
},
{
value:
"15",
label:
"15m"
},
{
value:
"60",
label:
"1h"
},
{
value:
"240",
label:
"4h"
},
{
value:
"D",
label:
"1D"
}
];

const TF_VALUES =
new Set(
RSI_TOUCH_FLIP_TF_OPTIONS.map(
opt=>
opt.value
)
);

function clampNumber(
raw,
min,
max,
fallback
){

const n =
Number(
raw
);

if(
!Number.isFinite(
n
)
){
return fallback;
}

return Math.min(
max,
Math.max(
min,
n
)
);

}

function clampInt(
raw,
min,
max,
fallback
){

return Math.round(
clampNumber(
raw,
min,
max,
fallback
)
);

}

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeRsiTouchFlipTf(
raw
){

const tf =
String(
raw ??
""
).trim();

return TF_VALUES.has(
tf
)
? tf
: "";

}

/**
 * @param {unknown} raw
 * @returns {"BOTH"|"LONG"|"SHORT"}
 */
export function normalizeRsiTouchFlipSide(
raw
){

const side =
String(
raw ||
""
).trim().toUpperCase();

if(
side ===
RSI_TOUCH_FLIP_SIDE_LONG ||
side ===
RSI_TOUCH_FLIP_SIDE_SHORT
){
return side;
}

return RSI_TOUCH_FLIP_SIDE_BOTH;

}

/**
 * @param {unknown} raw
 * @returns {"equal"|"average"}
 */
export function normalizeRsiTouchFlipSizeMode(
raw
){

const mode =
String(
raw ||
""
).trim().toLowerCase();

if(
mode ===
RSI_TOUCH_FLIP_SIZE_AVERAGE ||
mode ===
"усреднение" ||
mode ===
"avg"
){
return RSI_TOUCH_FLIP_SIZE_AVERAGE;
}

return RSI_TOUCH_FLIP_SIZE_EQUAL;

}

/**
 * @returns {object}
 */
export function defaultRsiTouchFlipPrefs(){

return {
rsiLen:
14,
osLevel:
30,
obLevel:
70,
rsiTf:
"",
tradeSide:
RSI_TOUCH_FLIP_SIDE_BOTH,
maxStack:
3,
budget:
100,
sizeMode:
RSI_TOUCH_FLIP_SIZE_EQUAL,
sizeMult:
1.5,
showMarks:
true,
commissionPct:
0.04,
slippageTicks:
0,
cycleSlEnabled:
false,
cycleSlPct:
30
};

}

/**
 * @param {unknown} raw
 * @returns {object}
 */
export function normalizeRsiTouchFlipPrefs(
raw
){

const base =
defaultRsiTouchFlipPrefs();
const src =
raw &&
typeof raw ===
"object"
? raw
: {};
const osLevel =
clampNumber(
src.osLevel,
1,
50,
base.osLevel
);
let obLevel =
clampNumber(
src.obLevel,
50,
99,
base.obLevel
);

if(
obLevel <=
osLevel
){
obLevel =
Math.min(
99,
osLevel +
1
);
}

return {
rsiLen:
clampInt(
src.rsiLen,
2,
999,
base.rsiLen
),
osLevel,
obLevel,
rsiTf:
normalizeRsiTouchFlipTf(
src.rsiTf
),
tradeSide:
normalizeRsiTouchFlipSide(
src.tradeSide
),
maxStack:
clampInt(
src.maxStack,
1,
20,
base.maxStack
),
budget:
clampNumber(
src.budget,
1,
1_000_000,
base.budget
),
sizeMode:
normalizeRsiTouchFlipSizeMode(
src.sizeMode
),
sizeMult:
clampNumber(
src.sizeMult,
1,
20,
base.sizeMult
),
showMarks:
src.showMarks !==
false,
commissionPct:
clampNumber(
src.commissionPct,
0,
10,
base.commissionPct
),
slippageTicks:
clampInt(
src.slippageTicks,
0,
1000,
base.slippageTicks
),
cycleSlEnabled:
src.cycleSlEnabled ===
true,
cycleSlPct:
clampNumber(
src.cycleSlPct,
1,
90,
base.cycleSlPct
)
};

}

/**
 * @returns {object}
 */
export function loadRsiTouchFlipPrefs(){

try{
const raw =
localStorage.getItem(
RSI_TOUCH_FLIP_PREFS_KEY
);

if(
!raw
){
return defaultRsiTouchFlipPrefs();
}

return normalizeRsiTouchFlipPrefs(
JSON.parse(
raw
)
);
}catch{
return defaultRsiTouchFlipPrefs();
}

}

/**
 * @param {object} [patch]
 * @returns {object}
 */
export function saveRsiTouchFlipPrefs(
patch =
{}
){

const next =
normalizeRsiTouchFlipPrefs(
{
...loadRsiTouchFlipPrefs(),
...patch
}
);

try{
localStorage.setItem(
RSI_TOUCH_FLIP_PREFS_KEY,
JSON.stringify(
next
)
);
}catch{
/* ignore quota */
}

return next;

}

export const RSI_TOUCH_FLIP_BOT_PREFS_KEY =
"algo_trading_rsi_touch_flip_bot_v1";

export const RSI_TOUCH_FLIP_BOT_PREFS_CHANGE_EVENT =
"algo-rsi-touch-flip-bot-prefs";

/**
 * Поля запуска (без комиссии/меток аналитики).
 * @param {unknown} raw
 * @returns {object}
 */
export function pickRsiTouchFlipLaunchPrefs(
raw
){

const p =
normalizeRsiTouchFlipPrefs(
raw
);

return {
rsiLen:
p.rsiLen,
osLevel:
p.osLevel,
obLevel:
p.obLevel,
rsiTf:
p.rsiTf,
tradeSide:
p.tradeSide,
maxStack:
p.maxStack,
budget:
p.budget,
sizeMode:
p.sizeMode,
sizeMult:
p.sizeMult,
cycleSlEnabled:
p.cycleSlEnabled,
cycleSlPct:
p.cycleSlPct
};

}

/**
 * @returns {object}
 */
export function loadRsiTouchFlipBotPrefs(){

try{
const raw =
localStorage.getItem(
RSI_TOUCH_FLIP_BOT_PREFS_KEY
);

if(
!raw
){
return pickRsiTouchFlipLaunchPrefs(
loadRsiTouchFlipPrefs()
);
}

return pickRsiTouchFlipLaunchPrefs(
JSON.parse(
raw
)
);
}catch{
return pickRsiTouchFlipLaunchPrefs(
loadRsiTouchFlipPrefs()
);
}

}

/**
 * @param {object} [patch]
 * @returns {object}
 */
export function saveRsiTouchFlipBotPrefs(
patch =
{}
){

const next =
pickRsiTouchFlipLaunchPrefs(
{
...loadRsiTouchFlipBotPrefs(),
...patch
}
);

try{
localStorage.setItem(
RSI_TOUCH_FLIP_BOT_PREFS_KEY,
JSON.stringify(
next
)
);
}catch{
/* ignore quota */
}

return next;

}

/**
 * Копия текущих полей панели Данные → настройки бота.
 * @returns {object}
 */
export function copyRsiTouchFlipAnalysisToBot(){

return saveRsiTouchFlipBotPrefs(
pickRsiTouchFlipLaunchPrefs(
loadRsiTouchFlipPrefs()
)
);

}

export const RSI_TOUCH_FLIP_BALANCE_PCT_KEY =
"algo_trading_rsi_touch_flip_balance_pct_v1";

export const RSI_TOUCH_FLIP_BALANCE_PCT_DEFAULT =
100;

/**
 * @param {unknown} raw
 * @returns {number}
 */
export function normalizeRsiTouchFlipBalancePct(
raw
){

return clampNumber(
raw,
1,
100,
RSI_TOUCH_FLIP_BALANCE_PCT_DEFAULT
);

}

/**
 * @returns {number}
 */
export function loadRsiTouchFlipBalancePct(){

try{
const raw =
localStorage.getItem(
RSI_TOUCH_FLIP_BALANCE_PCT_KEY
);

if(
raw ==
null ||
raw ===
""
){
return RSI_TOUCH_FLIP_BALANCE_PCT_DEFAULT;
}

return normalizeRsiTouchFlipBalancePct(
JSON.parse(
raw
)
);
}catch{
return RSI_TOUCH_FLIP_BALANCE_PCT_DEFAULT;
}

}

/**
 * @param {unknown} raw
 * @returns {number}
 */
export function saveRsiTouchFlipBalancePct(
raw
){

const next =
normalizeRsiTouchFlipBalancePct(
raw
);

try{
localStorage.setItem(
RSI_TOUCH_FLIP_BALANCE_PCT_KEY,
JSON.stringify(
next
)
);
}catch{
/* ignore quota */
}

return next;

}
