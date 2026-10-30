// 複勝の買い候補（site/sim.js の placeValue）を過去のレースで確かめる。
//   LABELS=期間A,期間B node keiba/place.js 日A.json 着順A.json 日B.json 着順B.json ...
// 単勝オッズから出した3着内率（ハーヴィル式）× 複勝オッズの下限 = 期待値。今のページは「期待値1.0以上・下限3倍まで」。
// 1. 今の条件の成績を期間ごと・条件ごとに出す（回収率の95%の幅つき）
// 2. 条件を変えた表を出し、最初の期間で一番良かった条件が、ほかの期間でも良いかを見る（後から選んだ条件は良く見えるため）
// 確定オッズで判定しているので、実際に買う時点のオッズでは成績が下がりうる。ログは公開されるので数字だけを出す。
"use strict";
const fs = require("fs");
const path = require("path");
global.window = {};
require(path.join(__dirname, "..", "site", "sim.js"));
const { placeValue, PLACE_RULE } = window.RaceSim;
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const BOOT = +(process.env.BOOT || 2000);
const LABELS = (process.env.LABELS || "").split(",");
const pct = (x) => (x == null || !Number.isFinite(x) ? "-" : `${Math.round(100 * x)}%`);
const yenOf = (list, num) => (list || []).filter((p) => p.nums.length === 1 && p.nums[0] === num).reduce((a, p) => a + p.yen, 0);

// 1頭ずつの候補（買う・買わないに関係なく、期待値が出せた馬すべて）
function candidates(day, results) {
  const out = [];
  for (const r of day.races) {
    const key = r.rkey || `${r.venue}-${r.number}`;
    const res = results[key], pay = (day.payouts || {})[key];
    if (!res || !res.length || !pay || !(pay.place || []).length) continue;
    const place = Object.fromEntries(res.map((x) => [x.number, x.place]));
    // 結果のない馬（取消・除外）は買えないので除いてから計算する（ページは発売中の馬で計算する）
    const race = Object.assign({}, r, { horses: (r.horses || []).filter((h) => !h.scratched && place[h.number] != null) });
    const pv = placeValue(race);
    if (!pv.length) continue;
    const n = race.horses.filter((h) => h.odds).length;
    const pops = pv.map((x) => x.p3).sort((a, b) => b - a);
    for (const x of pv) {
      if (x.ev == null) continue;
      out.push({
        key, month: key.slice(0, 7), year: key.slice(0, 4), venue: r.venue, surface: r.surface, n,
        cls: classOf(r.race_class || r.name || ""), ev: x.ev, lo: x.lo, p3: x.p3, rank: pops.indexOf(x.p3) + 1,
        hit: yenOf(pay.place, x.num) > 0, yen: yenOf(pay.place, x.num),   // 7頭以下は2着まで
      });
    }
  }
  return out;
}
const classOf = (c) => /未勝利/.test(c) ? "未勝利" : /1勝|500万/.test(c) ? "1勝クラス" : /2勝|1000万/.test(c) ? "2勝クラス"
  : /3勝|1600万/.test(c) ? "3勝クラス" : "オープン・重賞";

function stats(bets) {
  const n = bets.length;
  if (!n) return { n: 0 };
  const ret = bets.reduce((a, b) => a + b.yen, 0) / 100;
  return { n, hit: bets.filter((b) => b.hit).length / n, roi: ret / n };
}
// レース単位で入れ替えて（同じレースの馬はまとめて）回収率の95%の幅と、100%を下回る割合を出す
function bootRoi(bets) {
  if (bets.length < 20) return null;
  const byRace = new Map();
  for (const b of bets) { if (!byRace.has(b.key)) byRace.set(b.key, [0, 0]); const v = byRace.get(b.key); v[0]++; v[1] += b.yen / 100; }
  const races = [...byRace.values()];
  let seed = 2026;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  const vals = [];
  for (let k = 0; k < BOOT; k++) {
    let n = 0, ret = 0;
    for (let i = 0; i < races.length; i++) { const v = races[Math.floor(rnd() * races.length)]; n += v[0]; ret += v[1]; }
    vals.push(ret / n);
  }
  vals.sort((a, b) => a - b);
  return { lo: vals[Math.floor(0.025 * BOOT)], hi: vals[Math.floor(0.975 * BOOT)], below: vals.filter((v) => v < 1).length / BOOT };
}
const line = (name, bets) => {
  const s = stats(bets), b = bootRoi(bets);
  return [name, s.n, pct(s.hit), pct(s.roi), b ? `${pct(b.lo)}〜${pct(b.hi)}` : "-", b ? pct(b.below) : "-"].join(" | ");
};
const HEAD = "頭数 | 的中率 | 回収率 | 回収率の95%の幅 | 100%未満になる見込み";

const isRule = (minEv, maxLo, minLo = 0) => (c) => c.ev >= minEv && c.lo <= maxLo && c.lo >= minLo;
const now = isRule(PLACE_RULE.minEv, PLACE_RULE.maxLo);

const periods = [];
for (let i = 2, j = 0; i + 1 < process.argv.length; i += 2, j++) {
  const c = candidates(read(process.argv[i]), read(process.argv[i + 1]));
  periods.push({ label: LABELS[j] || `期間${j + 1}`, c });
}
const all = periods.flatMap((p) => p.c);
console.log(`今のページの条件：期待値${PLACE_RULE.minEv}以上・複勝の下限${PLACE_RULE.maxLo}倍まで（確定オッズで判定）`);

// 1. 今の条件
console.log(`\n今の条件 | ${HEAD}`);
for (const p of periods) console.log(line(p.label, p.c.filter(now)));
if (periods.length > 1) console.log(line("全期間", all.filter(now)));

console.log(`\n今の条件・年ごと | ${HEAD}`);
for (const y of [...new Set(all.map((c) => c.year))].sort()) console.log(line(y, all.filter((c) => c.year === y && now(c))));
console.log(`\n今の条件・月ごと | 頭数 | 的中率 | 回収率`);
for (const m of [...new Set(all.map((c) => c.month))].sort()) { const s = stats(all.filter((c) => c.month === m && now(c))); console.log([m, s.n, pct(s.hit), pct(s.roi)].join(" | ")); }
const months = [...new Set(all.map((c) => c.month))].sort().map((m) => stats(all.filter((c) => c.month === m && now(c)))).filter((s) => s.n);
console.log(`回収率100%以上の月：${months.filter((s) => s.roi >= 1).length} / ${months.length}`);

// 今の条件を分けて見る（全期間）
const SPLITS = [
  ["芝・ダート", (c) => c.surface],
  ["クラス", (c) => c.cls],
  ["頭数", (c) => (c.n <= 10 ? "10頭以下" : c.n <= 14 ? "11〜14頭" : "15頭以上")],
  ["複勝の下限", (c) => (c.lo < 1.3 ? "1.0〜1.2倍" : c.lo < 1.6 ? "1.3〜1.5倍" : c.lo < 2 ? "1.6〜1.9倍" : "2.0〜3.0倍")],
  ["期待値", (c) => (c.ev < 1.05 ? "1.00〜1.04" : c.ev < 1.1 ? "1.05〜1.09" : c.ev < 1.2 ? "1.10〜1.19" : "1.20以上")],
  ["オッズから見た複勝率の順位", (c) => (c.rank <= 1 ? "1位" : c.rank <= 3 ? "2〜3位" : "4位以下")],
  ["競馬場", (c) => c.venue],
];
for (const [name, f] of SPLITS) {
  console.log(`\n今の条件・${name}ごと（全期間） | ${HEAD}`);
  const bets = all.filter(now);
  for (const g of [...new Set(bets.map(f))].sort()) console.log(line(g, bets.filter((c) => f(c) === g)));
}

// 2. 条件を変えた表。最初の期間で決め、ほかの期間で確かめる
const GRID = [];
for (const minEv of [0.9, 0.95, 1.0, 1.05, 1.1, 1.2]) for (const maxLo of [1.5, 2, 3, 5, 99]) GRID.push([minEv, maxLo]);
console.log(`\n条件を変えた場合（期待値の下限・複勝の下限の上限） | ${periods.map((p) => `${p.label}：頭数・的中率・回収率`).join(" | ")}`);
for (const [e, l] of GRID) {
  const f = isRule(e, l);
  console.log([`期待値${e}以上・下限${l === 99 ? "制限なし" : `${l}倍まで`}`, ...periods.map((p) => { const s = stats(p.c.filter(f)); return s.n ? `${s.n}・${pct(s.hit)}・${pct(s.roi)}` : "-"; })].join(" | "));
}
if (periods.length > 1) {
  const first = periods[0];
  const ok = GRID.map(([e, l]) => ({ e, l, s: stats(first.c.filter(isRule(e, l))) })).filter((x) => x.s.n >= 300);
  const best = ok.sort((a, b) => b.s.roi - a.s.roi)[0];
  if (best) {
    const f = isRule(best.e, best.l);
    console.log(`\n${first.label}で一番良かった条件（300頭以上）：期待値${best.e}以上・下限${best.l === 99 ? "制限なし" : `${best.l}倍まで`} | ${HEAD}`);
    for (const p of periods) console.log(line(p.label, p.c.filter(f)));
  }
}

// （参考）買い方の基準：期待値に関係なく、オッズから見た複勝率の順位ごとに全部買った場合
console.log(`\n（参考）オッズから見た複勝率の順位ごとに全部買った場合（全期間） | ${HEAD}`);
for (const r of [1, 2, 3, 4, 5]) console.log(line(`${r}位`, all.filter((c) => c.rank === r)));
console.log(line("6位以下", all.filter((c) => c.rank >= 6)));
