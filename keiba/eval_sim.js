// シミュレーション（site/sim.js）の予想印と、実際の着順を比べる。
//   node keiba/eval_sim.js 復号済みの日のデータ.json 着順.json [ページ用の出力.json]
// 着順.json は {"東京-11": [{place, number, popularity}, ...]}（人気は確定時のもの）。
// ログは公開されるので、馬名・オッズは出さず、着順と人気の数字だけを出す。
"use strict";
const fs = require("fs");
const path = require("path");
global.window = {};
require(path.join(__dirname, "..", "site", "sim.js"));
const { simulate } = window.RaceSim;

const day = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
// 回数と乱数の固定（バックテストは SIMS=20000 SEED=1 で、何度計算しても同じ印にする）
const SIMS = +(process.env.SIMS || 5000), SEED = !!process.env.SEED;
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
    pedigree: day.pedigree, sims: SIMS, seed: SEED ? hash(key) : undefined,
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
    res.noData + res.byPedigree > horses.length / 3 ? "データ少" : "データ十分"];
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
  if (day.payouts && day.payouts[key]) settle(day.payouts[key], marks);
  for (const x of res.rows) {
    const c = calib.find((b) => x.top3 >= b.lo && x.top3 < b.hi);
    c.n++; c.pred += x.top3; c.hit += pos(x.h.num) <= 3 ? 1 : 0;
  }
  raceOut.push({ key, result, sim: res.rows.map((x) => ({ num: x.h.num, mark: x.mark, win: +x.win.toFixed(3), top3: +x.top3.toFixed(3) })) });
  console.log([key, `${r.surface}${r.distance} ${r.race_class || ""}`, horses.length,
    `${pos(marks[0])}着(${pop(marks[0]) || "-"})`, `${pos(marks[1])}着`, `${pos(marks[2])}着`,
    fav ? `${pos(fav.number)}着` : "-", top3.every((m) => marks.slice(0, 5).includes(m)) ? "的中" : ""].join(" | "));
}

console.log("\n区分 | レース数 | ◎1着 | ◎3着内 | ○3着内 | 馬連◎○ | 3連複◎○▲ | 3連複 印5頭BOX | 3着内に入った印上位3頭(平均) | 1番人気1着 | 1番人気3着内 | 人気上位5頭BOX | ◎の平均人気 | 勝ち馬の平均人気");
for (const [name, s] of Object.entries(groups)) {
  console.log([name, s.n, rate(s, "honWin"), rate(s, "honTop3"), rate(s, "taiTop3"), rate(s, "umaren"),
    rate(s, "trio3"), rate(s, "trio5"), (s.inTop3 / s.n).toFixed(2),
    s.favN ? `${((100 * s.favWin) / s.favN).toFixed(0)}%` : "-", s.favN ? `${((100 * s.favTop3) / s.favN).toFixed(0)}%` : "-",
    rate(s, "popTrio5"), (s.honPop / s.n).toFixed(1), (s.winnerPop / s.n).toFixed(1)].join(" | "));
}

console.log("\nシミュレーションの複勝率 | 頭数 | 予想の平均 | 実際の3着内率");
for (const c of calib) {
  if (c.n) console.log([`${c.lo * 100}〜${Math.min(c.hi, 1) * 100}%`, c.n, `${((100 * c.pred) / c.n).toFixed(0)}%`, `${((100 * c.hit) / c.n).toFixed(0)}%`].join(" | "));
}

if (bets.some((b) => b.races)) {
  console.log("\n買い方（100円ずつ） | レース数 | 投資 | 払戻 | 回収率 | 的中レース");
  for (const b of bets) {
    console.log([b.name, b.races, `${b.cost.toLocaleString()}円`, `${b.ret.toLocaleString()}円`,
      b.cost ? `${Math.round((100 * b.ret) / b.cost)}%` : "-", b.hits].join(" | "));
  }
}

if (process.argv[4]) {
  fs.writeFileSync(process.argv[4], JSON.stringify({ races: raceOut, groups, calib, bets: bets.filter((b) => b.races) }));
}
