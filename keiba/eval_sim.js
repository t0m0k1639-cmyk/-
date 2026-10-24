// シミュレーション（site/sim.js）の予想印と、実際の着順を比べる。
//   node keiba/eval_sim.js 復号済みの日のデータ.json 着順.json
// 着順.json は {"東京-11": [1着の馬番, 2着の馬番, ...]}。
// ログは公開されるので、馬名・オッズは出さず、着順と人気の数字だけを出す。
"use strict";
const fs = require("fs");
const path = require("path");
global.window = {};
require(path.join(__dirname, "..", "site", "sim.js"));
const { simulate } = window.RaceSim;

const day = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const results = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));

const groups = {};
function add(names, k, v) {
  for (const g of names) {
    const s = (groups[g] = groups[g] || {});
    s[k] = (s[k] || 0) + v;
  }
}
const rate = (s, k) => (s.n ? `${((100 * (s[k] || 0)) / s.n).toFixed(0)}%` : "-");

console.log("レース | 条件 | 頭数 | ◎の着順(人気) | ○ | ▲ | 1番人気の着順 | 3連複(印5頭)");
for (const r of day.races) {
  const key = `${r.venue}-${r.number}`;
  const order = results[key];
  if (!order || !order.length) continue;
  const res = simulate(Object.assign({ date: day.date }, r), {
    pedigree: day.pedigree, sims: 5000,
    cfg: { going: r.going || "良", cushion: r.cushion != null ? String(r.cushion) : "", moist: "" },
  });
  if (res.error) { console.log(`${key} | 対象外（${res.error}）`); continue; }
  const pos = (num) => { const i = order.indexOf(num); return i < 0 ? 99 : i + 1; };
  const marks = res.rows.map((x) => x.h.num);
  const horses = (r.horses || []).filter((h) => !h.scratched);
  const pop = (num) => (horses.find((h) => h.number === num) || {}).popularity || null;
  const fav = horses.find((h) => h.popularity === 1);
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
  }
  const p = horses.map((h) => h.popularity).filter(Boolean);
  if (p.length) {
    const byPop = horses.filter((h) => h.popularity).sort((a, b) => a.popularity - b.popularity).map((h) => h.number);
    add(g, "popTrio5", top3.every((m) => byPop.slice(0, 5).includes(m)) ? 1 : 0);
    add(g, "winnerPop", pop(order[0]) || 0);
  }
  add(g, "honPop", pop(marks[0]) || 0);
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
