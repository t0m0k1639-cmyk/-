// シミュレーション（site/sim.js）の予想印と、実際の着順を比べる。
//   node keiba/eval_sim.js 復号済みの日のデータ.json 着順.json [ページ用の出力.json]
// 着順.json は {"東京-11": [{place, number, popularity}, ...]}（人気は確定時のもの）。
// ログは公開されるので、馬名・オッズは出さず、着順と人気の数字だけを出す。
"use strict";
const fs = require("fs");
const path = require("path");
global.window = {};
require(path.join(__dirname, "..", "site", "sim.js"));
const { simulate, placeValue } = window.RaceSim;

const day = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
// 回数と乱数の固定（バックテストは SIMS=20000 SEED=1 で、何度計算しても同じ印にする）
const SIMS = +(process.env.SIMS || 5000), SEED = !!process.env.SEED;
// 重みを変えて比べるとき（keiba tune）は SIM_PARAMS に JSON で渡す
const PARAMS = process.env.SIM_PARAMS ? JSON.parse(process.env.SIM_PARAMS) : undefined;
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const results = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));

// シミュレーションの印どおりに100円ずつ買っていたら（払戻金は day.payouts。keiba evaluate が入れる）
const pairs = (xs) => xs.flatMap((a, i) => xs.slice(i + 1).map((b) => [a, b]));
const triples = (xs) => xs.flatMap((a, i) => pairs(xs.slice(i + 1)).map((p) => [a, ...p]));
const perms3 = (xs) => xs.flatMap((a) => xs.filter((b) => b !== a).flatMap((b) => xs.filter((c) => c !== a && c !== b).map((c) => [a, b, c])));
const BETS = [
  ["単勝 ◎", "win", (m) => [[m[0]]]],
  ["単勝 ○", "win", (m) => [[m[1]]]],
  ["単勝 ▲", "win", (m) => [[m[2]]]],
  ["単勝 ◎○▲（3点）", "win", (m) => [[m[0]], [m[1]], [m[2]]]],
  ["複勝 ◎", "place", (m) => [[m[0]]]],
  ["複勝 ◎○▲（3点）", "place", (m) => [[m[0]], [m[1]], [m[2]]]],
  ["馬連 ◎-○", "umaren", (m) => [[m[0], m[1]]]],
  ["馬連ボックス ◎○▲（3点）", "umaren", (m) => pairs(m.slice(0, 3))],
  ["ワイド ◎-○", "wide", (m) => [[m[0], m[1]]]],
  ["ワイドボックス ◎○▲（3点）", "wide", (m) => pairs(m.slice(0, 3))],
  ["3連複 ◎○▲", "trio", (m) => [m.slice(0, 3)]],
  ["3連複 印5頭ボックス（10点）", "trio", (m) => triples(m.slice(0, 5))],
  ["3連単 ◎○▲ボックス（6点）", "tierce", (m) => perms3(m.slice(0, 3))],
  // ☆・△まで（印の上位5頭）
  ["単勝 ☆", "win", (m) => [[m[3]]]],
  ["単勝 △", "win", (m) => [[m[4]]]],
  ["単勝 印5頭（5点）", "win", (m) => m.slice(0, 5).map((n) => [n])],
  ["複勝 ☆", "place", (m) => [[m[3]]]],
  ["複勝 △", "place", (m) => [[m[4]]]],
  ["複勝 印5頭（5点）", "place", (m) => m.slice(0, 5).map((n) => [n])],
  ["馬連 ◎流し→○▲☆△（4点）", "umaren", (m) => m.slice(1, 5).map((n) => [m[0], n])],
  ["馬連ボックス 印5頭（10点）", "umaren", (m) => pairs(m.slice(0, 5))],
  ["ワイド ◎流し→○▲☆△（4点）", "wide", (m) => m.slice(1, 5).map((n) => [m[0], n])],
  ["ワイドボックス 印5頭（10点）", "wide", (m) => pairs(m.slice(0, 5))],
  ["3連複 ◎軸→○▲☆△（6点）", "trio", (m) => pairs(m.slice(1, 5)).map((p) => [m[0], ...p])],
  ["3連単 印5頭ボックス（60点）", "tierce", (m) => perms3(m.slice(0, 5))],
];
const ORDERED = new Set(["tierce", "umatan"]);
const sameSet = (a, b) => a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i]);
const bets = BETS.map(([name]) => ({ name, cost: 0, ret: 0, hits: 0, races: 0 }));
function settle(payout, marks) {
  BETS.forEach(([, kind, make], i) => {
    const tickets = make(marks).filter((t) => t.every((n) => n != null));
    if (!tickets.length) return;
    let ret = 0;
    for (const t of tickets) {
      for (const p of payout[kind] || []) {
        if (ORDERED.has(kind) ? p.nums.join("-") === t.join("-") : sameSet(p.nums, t)) ret += p.yen;
      }
    }
    const b = bets[i];
    b.cost += 100 * tickets.length; b.ret += ret; b.races++; if (ret) b.hits++;
  });
}

// 人気より高く評価している馬（穴）を買っていたら。人気は確定時のもの
const VALUE = [
  ["シミュ1位 × 4番人気以下", (rk, pop) => rk === 1 && pop >= 4],
  ["シミュ3位以内 × 5番人気以下", (rk, pop) => rk <= 3 && pop >= 5],
  ["シミュ3位以内 × 7番人気以下", (rk, pop) => rk <= 3 && pop >= 7],
  ["シミュ5位以内 × 8番人気以下", (rk, pop) => rk <= 5 && pop >= 8],
  ["人気よりシミュが5つ以上上", (rk, pop) => pop - rk >= 5],
  ["（参考）シミュ1位 × 1〜3番人気", (rk, pop) => rk === 1 && pop <= 3],
];
const value = VALUE.map(([name]) => ({ name, n: 0, win: 0, plc: 0, wins: 0, plcs: 0 }));
// 期待値（シミュレーションの確率 × 確定オッズ）で買っていたら。x = {p1 勝率, p3 複勝率, pm 人気から見た勝率, o 単勝, lo 複勝の下限, mark 印の順}
const blend = (x) => Math.sqrt(x.p1 * x.pm);   // シミュレーションと人気を半分ずつ（あとでレース内で合計1にそろえる）
const EV = [
  ["単勝", "単勝 期待値1.0以上", (x) => x.p1 * x.o >= 1.0],
  ["単勝", "単勝 期待値1.2以上", (x) => x.p1 * x.o >= 1.2],
  ["単勝", "単勝 期待値1.5以上", (x) => x.p1 * x.o >= 1.5],
  ["単勝", "単勝 期待値2.0以上", (x) => x.p1 * x.o >= 2.0],
  ["単勝", "単勝 期待値1.2以上・オッズ20倍まで", (x) => x.p1 * x.o >= 1.2 && x.o <= 20],
  ["単勝", "単勝 人気と混ぜた期待値1.1以上", (x) => x.pb * x.o >= 1.1],
  ["単勝", "単勝 人気と混ぜた期待値1.2以上", (x) => x.pb * x.o >= 1.2],
  ["複勝", "複勝 期待値1.0以上（下限で計算）", (x) => x.lo && x.p3 * x.lo >= 1.0],
  ["複勝", "複勝 期待値1.2以上（下限で計算）", (x) => x.lo && x.p3 * x.lo >= 1.2],
  ["複勝", "複勝 期待値1.5以上（下限で計算）", (x) => x.lo && x.p3 * x.lo >= 1.5],
  ["複勝", "複勝 期待値1.2以上・複勝率30%以上", (x) => x.lo && x.p3 >= 0.3 && x.p3 * x.lo >= 1.2],
  ["複勝", "複勝◎ 下限1.5倍以上のときだけ", (x) => x.mark === 0 && x.lo >= 1.5],
  ["複勝", "複勝◎ 下限2.0倍以上のときだけ", (x) => x.mark === 0 && x.lo >= 2.0],
  ["複勝", "複勝◎○ 下限2.0倍以上のときだけ", (x) => x.mark <= 1 && x.lo >= 2.0],
  ["単勝", "単勝◎ 5倍以上のときだけ", (x) => x.mark === 0 && x.o >= 5],
];
const ev = EV.map(([kind, name]) => ({ kind, name, n: 0, hit: 0, ret: 0, races: new Set() }));
// ページの「買い候補（複勝）」をすべて100円ずつ買っていたら（ページに出ていた時点のオッズで判定）
const cand = { name: "買い候補（複勝・期待値1.0以上）をすべて", cost: 0, ret: 0, hits: 0, races: 0 };
const days = new Set();
const yenOf = (list, num) => (list || []).filter((p) => p.nums.length === 1 && p.nums[0] === num).reduce((a, p) => a + p.yen, 0);
function spearman(x, y) {
  const rk = (a) => { const idx = a.map((_, i) => i).sort((p, q) => a[p] - a[q]), r = new Array(a.length);
    for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && a[idx[j + 1]] === a[idx[i]]) j++; for (let k = i; k <= j; k++) r[idx[k]] = (i + j) / 2; i = j + 1; } return r; };
  const rx = rk(x), ry = rk(y), n = x.length, m = (n - 1) / 2;
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < n; i++) { a += (rx[i] - m) * (ry[i] - m); b += (rx[i] - m) ** 2; c += (ry[i] - m) ** 2; }
  return b && c ? a / Math.sqrt(b * c) : 0;
}
const classOf = (c) => /新馬/.test(c) ? "新馬" : /未勝利/.test(c) ? "未勝利" : /1勝/.test(c) ? "1勝クラス" : /2勝/.test(c) ? "2勝クラス" : /3勝/.test(c) ? "3勝クラス" : "オープン・重賞";

const groups = {};
const raceOut = [];
// シミュレーションの複勝率が、実際の3着内率と合っているか（複勝率の帯ごと）
const CALIB = [[0, 0.1], [0.1, 0.2], [0.2, 0.3], [0.3, 0.5], [0.5, 1.01]];
const calib = CALIB.map(([lo, hi]) => ({ lo, hi, n: 0, pred: 0, hit: 0 }));
function add(names, k, v) {
  for (const g of names) {
    const s = (groups[g] = groups[g] || {});
    s[k] = (s[k] || 0) + v;
  }
}
const rate = (s, k) => (s.n ? `${((100 * (s[k] || 0)) / s.n).toFixed(0)}%` : "-");

console.log("レース | 条件 | 頭数 | ◎の着順(人気) | ○ | ▲ | 1番人気の着順 | 3連複(印5頭)");
for (const r of day.races) {
  const key = r.rkey || `${r.venue}-${r.number}`;   // バックテストは「日付|競馬場-番号」
  const result = results[key];
  if (!result || !result.length) continue;
  const order = result.map((x) => x.number);
  const res = simulate(Object.assign({ date: day.date }, r), {
    pedigree: day.pedigree, sims: SIMS, seed: SEED ? hash(key) : undefined, params: PARAMS,
    cfg: { going: r.going || "良", cushion: r.cushion != null ? String(r.cushion) : "", moist: "",
      // 発走前までにわかっていた馬場の傾向（keiba evaluate が出す）
      bias: (day.bias_by_race || {})[key] || null },
  });
  if (res.error) {
    console.log(`${key} | 対象外（${res.error}）`);
    raceOut.push({ key, result, sim: null, note: res.error });
    continue;
  }
  const pos = (num) => { const i = order.indexOf(num); return i < 0 ? 99 : i + 1; };
  const marks = res.rows.map((x) => x.h.num);
  const horses = (r.horses || []).filter((h) => !h.scratched);
  const pop = (num) => (result.find((x) => x.number === num) || {}).popularity || null;
  const fav = result.find((x) => x.popularity === 1);
  const top3 = order.slice(0, 3);
  const g = ["全体", r.surface || "?", r.race_class && r.race_class.includes("新馬") ? "新馬" : "新馬以外",
    res.noData + res.byPedigree > horses.length / 3 ? "データ少" : "データ十分", classOf(r.race_class || ""),
    horses.length <= 10 ? "10頭以下" : horses.length <= 14 ? "11〜14頭" : "15頭以上"];
  add(g, "n", 1);
  add(g, "honWin", pos(marks[0]) === 1 ? 1 : 0);
  add(g, "honTop3", pos(marks[0]) <= 3 ? 1 : 0);
  add(g, "taiTop3", pos(marks[1]) <= 3 ? 1 : 0);
  add(g, "umaren", [marks[0], marks[1]].every((m) => pos(m) <= 2) ? 1 : 0);
  add(g, "trio3", top3.every((m) => marks.slice(0, 3).includes(m)) ? 1 : 0);
  add(g, "trio5", top3.every((m) => marks.slice(0, 5).includes(m)) ? 1 : 0);
  add(g, "inTop3", top3.filter((m) => marks.slice(0, 3).includes(m)).length);
  if (fav) {
    add(g, "favN", 1);
    add(g, "favWin", pos(fav.number) === 1 ? 1 : 0);
    add(g, "favTop3", pos(fav.number) <= 3 ? 1 : 0);
    const byPop = result.filter((x) => x.popularity).sort((a, b) => a.popularity - b.popularity).map((x) => x.number);
    add(g, "popTrio5", top3.every((m) => byPop.slice(0, 5).includes(m)) ? 1 : 0);
    add(g, "winnerPop", pop(order[0]) || 0);
  }
  add(g, "honPop", pop(marks[0]) || 0);
  const pay = day.payouts && day.payouts[key];
  // 新馬戦は前走のデータがなく当たり外れが大きいので、払戻の集計（買い方・穴狙い・期待値）からは外す
  const newcomer = (r.race_class || "").includes("新馬");
  if (pay && !newcomer) {
    settle(pay, marks);
    const buys = placeValue(r).filter((x) => x.buy);
    if (buys.length) {
      const y = buys.reduce((a, x) => a + yenOf(pay.place, x.num), 0);
      cand.cost += 100 * buys.length; cand.ret += y; cand.races++; if (y) cand.hits++;
    }
    add(g, "pay", 1);
    add(g, "honWinYen", yenOf(pay.win, marks[0]));
    add(g, "honPlcYen", yenOf(pay.place, marks[0]));
    const oddsOf = (num) => (r.horses || []).find((h) => h.number === num) || {};
    const inv = res.rows.reduce((a, x) => a + (oddsOf(x.h.num).odds ? 1 / oddsOf(x.h.num).odds : 0), 0);
    if (inv) {
      days.add(r.date || day.date);
      const xs = res.rows.map((x, i) => {
        const h = oddsOf(x.h.num);
        return h.odds ? { num: x.h.num, p1: x.win, p3: x.top3, pm: 1 / h.odds / inv, o: h.odds, lo: (h.place_odds || [])[0], mark: i } : null;
      }).filter(Boolean);
      const bs = xs.reduce((a, x) => a + blend(x), 0);
      xs.forEach((x) => (x.pb = blend(x) / bs));
      for (const x of xs) {
        EV.forEach(([kind, , ok], j) => {
          if (!ok(x)) return;
          const e = ev[j], y = yenOf(kind === "単勝" ? pay.win : pay.place, x.num);
          e.n++; e.ret += y; if (y) e.hit++; e.races.add(key);
        });
      }
    }
    res.rows.forEach((x, i) => {
      const pp = pop(x.h.num);
      if (!pp) return;
      VALUE.forEach(([, ok], j) => {
        if (!ok(i + 1, pp)) return;
        const v = value[j], w = yenOf(pay.win, x.h.num), p = yenOf(pay.place, x.h.num);
        v.n++; v.win += w; v.plc += p; if (w) v.wins++; if (p) v.plcs++;
      });
    });
  }
  const fin = res.rows.filter((x) => pos(x.h.num) < 99);
  if (fin.length >= 4) { add(g, "rhoN", 1); add(g, "rho", spearman(fin.map((_, i) => -i), fin.map((x) => -pos(x.h.num)))); }
  for (const x of res.rows) {
    const c = calib.find((b) => x.top3 >= b.lo && x.top3 < b.hi);
    c.n++; c.pred += x.top3; c.hit += pos(x.h.num) <= 3 ? 1 : 0;
  }
  raceOut.push({ key, result, sim: res.rows.map((x) => ({ num: x.h.num, mark: x.mark, win: +x.win.toFixed(3), top3: +x.top3.toFixed(3) })) });
  console.log([key, `${r.surface}${r.distance} ${r.race_class || ""}`, horses.length,
    `${pos(marks[0])}着(${pop(marks[0]) || "-"})`, `${pos(marks[1])}着`, `${pos(marks[2])}着`,
    fav ? `${pos(fav.number)}着` : "-", top3.every((m) => marks.slice(0, 5).includes(m)) ? "的中" : ""].join(" | "));
}

console.log("\n区分 | レース数 | ◎1着 | ◎3着内 | ○3着内 | 馬連◎○ | 3連複◎○▲ | 3連複 印5頭BOX | 3着内に入った印上位3頭(平均) | 1番人気1着 | 1番人気3着内 | 人気上位5頭BOX | ◎の平均人気 | 勝ち馬の平均人気 | 単勝◎の回収率 | 複勝◎の回収率 | 印の順と着順の順位相関");
for (const [name, s] of Object.entries(groups)) {
  console.log([name, s.n, rate(s, "honWin"), rate(s, "honTop3"), rate(s, "taiTop3"), rate(s, "umaren"),
    rate(s, "trio3"), rate(s, "trio5"), (s.inTop3 / s.n).toFixed(2),
    s.favN ? `${((100 * s.favWin) / s.favN).toFixed(0)}%` : "-", s.favN ? `${((100 * s.favTop3) / s.favN).toFixed(0)}%` : "-",
    rate(s, "popTrio5"), (s.honPop / s.n).toFixed(1), (s.winnerPop / s.n).toFixed(1),
    s.pay ? `${Math.round((s.honWinYen || 0) / s.pay)}%` : "-", s.pay ? `${Math.round((s.honPlcYen || 0) / s.pay)}%` : "-",
    s.rhoN ? (s.rho / s.rhoN).toFixed(3) : "-"].join(" | "));
}

console.log("\nシミュレーションの複勝率 | 頭数 | 予想の平均 | 実際の3着内率");
for (const c of calib) {
  if (c.n) console.log([`${c.lo * 100}〜${Math.min(c.hi, 1) * 100}%`, c.n, `${((100 * c.pred) / c.n).toFixed(0)}%`, `${((100 * c.hit) / c.n).toFixed(0)}%`].join(" | "));
}

if (cand.cost) bets.push(cand);
if (bets.some((b) => b.races)) {
  console.log("\n買い方（100円ずつ・新馬戦を除く） | レース数 | 投資 | 払戻 | 回収率 | 的中レース");
  for (const b of bets) {
    console.log([b.name, b.races, `${b.cost.toLocaleString()}円`, `${b.ret.toLocaleString()}円`,
      b.cost ? `${Math.round((100 * b.ret) / b.cost)}%` : "-", b.hits].join(" | "));
  }
}

if (value.some((v) => v.n)) {
  console.log("\n穴狙い（該当馬の単勝・複勝を100円ずつ・新馬戦を除く） | 頭数 | 単勝の的中 | 単勝の回収率 | 複勝の的中 | 複勝の回収率");
  for (const v of value) {
    if (!v.n) continue;
    console.log([v.name, v.n, `${Math.round((100 * v.wins) / v.n)}%`, `${Math.round(v.win / v.n)}%`,
      `${Math.round((100 * v.plcs) / v.n)}%`, `${Math.round(v.plc / v.n)}%`].join(" | "));
  }
}

if (ev.some((e) => e.n)) {
  console.log(`\n期待値で買う（確定オッズ・100円ずつ・新馬戦を除く・${days.size}日） | 買った頭数 | 1日あたり | 的中率 | 回収率`);
  for (const e of ev) {
    if (!e.n) continue;
    console.log([e.name, e.n, (e.n / days.size).toFixed(1), `${Math.round((100 * e.hit) / e.n)}%`, `${Math.round(e.ret / e.n)}%`].join(" | "));
  }
}

if (process.argv[4]) {
  fs.writeFileSync(process.argv[4], JSON.stringify({ races: raceOut, groups, calib, bets: bets.filter((b) => b.races) }));
}
