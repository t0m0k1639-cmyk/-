// 3連複・3連単の買い方を過去のレースで比べる（的中率と回収率）。
//   node keiba/trio.js 調整用の日.json 調整用の着順.json 確認用の日.json 確認用の着順.json
// 比べる相手は「人気順に買う」ふつうの買い方。並べ方は人気（確定オッズ）・シミュレーションの点数・その組み合わせ。
// 荒れそうなレース（オッズが割れているレース）だけに絞った場合も出す。新馬戦・障害戦・8頭未満は除く。
// ログは公開されるので数字だけを出す。
"use strict";
const fs = require("fs");
const path = require("path");
global.window = {};
require(path.join(__dirname, "..", "site", "sim.js"));
const { placeValue, _internal: I } = window.RaceSim;
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

function dataset(day, results) {
  const out = [];
  for (const r of day.races) {
    const key = r.rkey || `${r.venue}-${r.number}`;
    const res = results[key], pay = (day.payouts || {})[key];
    if (!res || res.length < 3 || !pay || !pay.trio || r.surface === "障害" || (r.race_class || "").includes("新馬")) continue;
    const place = Object.fromEntries(res.map((x) => [x.number, x.place]));
    const running = (r.horses || []).filter((h) => !h.scratched && place[h.number] != null && h.odds).sort((a, b) => a.number - b.number);
    if (running.length < 8) continue;
    const cfg = Object.assign(I.configFor(Object.assign({ date: day.date }, r)), { going: r.going || "良", cushion: "", moist: "" });
    const hs = running.map((h) => I.features(h, cfg, day.pedigree));
    hs.forEach((h, i) => { h.gate = i / (running.length - 1); h.manual = 0; });
    const base = I.buildModel(hs, cfg).base;
    const nums = running.map((h) => h.number);
    const byPop = nums.slice().sort((a, b) => running.find((h) => h.number === a).odds - running.find((h) => h.number === b).odds);
    const bySim = nums.map((n, i) => [n, base[i]]).sort((a, b) => b[1] - a[1]).map(([n]) => n);
    const rk = (arr) => Object.fromEntries(arr.map((n, i) => [n, i]));
    const rp = rk(byPop), rs = rk(bySim);
    // 組み合わせ：人気の順位とシミュレーションの順位の平均（同じなら人気を優先）
    const byMix = nums.slice().sort((a, b) => (rp[a] + rs[a]) - (rp[b] + rs[b]) || rp[a] - rp[b]);
    // 荒れそうか：オッズから見た勝率のばらつき（エントロピーを頭数で割る。1に近いほど割れている）
    const inv = running.reduce((a, h) => a + 1 / h.odds, 0);
    const ps = running.map((h) => 1 / h.odds / inv);
    const ent = -ps.reduce((a, p) => a + p * Math.log(p), 0) / Math.log(running.length);
    const pv = placeValue(Object.assign({}, r, { horses: running })).filter((x) => x.buy).sort((a, b) => b.ev - a.ev).map((x) => x.num);
    out.push({ key, n: running.length, byPop, bySim, byMix, ent, pv, trio: pay.trio, tierce: pay.tierce || [] });
  }
  return out;
}

const pairs = (xs) => xs.flatMap((a, i) => xs.slice(i + 1).map((b) => [a, b]));
const triples = (xs) => xs.flatMap((a, i) => pairs(xs.slice(i + 1)).map((p) => [a, ...p]));
const perms3 = (xs) => xs.flatMap((a) => xs.filter((b) => b !== a).flatMap((b) => xs.filter((c) => c !== a && c !== b).map((c) => [a, b, c])));
const uniqSets = (ts) => [...new Map(ts.filter((t) => new Set(t).size === 3).map((t) => [[...t].sort((x, y) => x - y).join("-"), t])).values()];
// 1列目 a・2列目 b・3列目 c のフォーメーション
const formTrio = (a, b, c) => uniqSets(a.flatMap((x) => b.flatMap((y) => c.map((z) => [x, y, z]))));
const formTierce = (a, b, c) => a.flatMap((x) => b.filter((y) => y !== x).flatMap((y) => c.filter((z) => z !== x && z !== y).map((z) => [x, y, z])));

const STRATS = [
  // [名前, 券種, (d) => 買い目]
  ["3連複 人気1〜5番のBOX（ふつうの買い方）", "trio", (d) => triples(d.byPop.slice(0, 5))],
  ["3連複 シミュ上位5頭のBOX", "trio", (d) => triples(d.bySim.slice(0, 5))],
  ["3連複 人気＋シミュ 上位5頭のBOX", "trio", (d) => triples(d.byMix.slice(0, 5))],
  ["3連複 人気2〜6番のBOX（1番人気を外す）", "trio", (d) => triples(d.byPop.slice(1, 6))],
  ["3連複 人気＋シミュ 上位6頭のBOX", "trio", (d) => triples(d.byMix.slice(0, 6))],
  ["3連複 1番人気軸→人気2〜7番流し", "trio", (d) => pairs(d.byPop.slice(1, 7)).map((p) => [d.byPop[0], ...p])],
  ["3連複 人気＋シミュ1位軸→2〜7位流し", "trio", (d) => pairs(d.byMix.slice(1, 7)).map((p) => [d.byMix[0], ...p])],
  ["3連複 人気1〜2番→人気1〜5番→人気1〜8番", "trio", (d) => formTrio(d.byPop.slice(0, 2), d.byPop.slice(0, 5), d.byPop.slice(0, 8))],
  ["3連複 人気＋シミュ1〜2位→1〜5位→1〜8位", "trio", (d) => formTrio(d.byMix.slice(0, 2), d.byMix.slice(0, 5), d.byMix.slice(0, 8))],
  ["3連複 複勝の買い候補軸→人気＋シミュ上位6頭流し", "trio", (d) => d.pv.length ? pairs(d.byMix.filter((n) => n !== d.pv[0]).slice(0, 6)).map((p) => [d.pv[0], ...p]) : []],
  ["3連単 人気1〜4番のBOX（ふつうの買い方）", "tierce", (d) => perms3(d.byPop.slice(0, 4))],
  ["3連単 人気＋シミュ 上位4頭のBOX", "tierce", (d) => perms3(d.byMix.slice(0, 4))],
  ["3連単 1番人気1着→人気2〜5番→人気2〜5番", "tierce", (d) => formTierce([d.byPop[0]], d.byPop.slice(1, 5), d.byPop.slice(1, 5))],
  ["3連単 人気＋シミュ1位1着→2〜5位→2〜5位", "tierce", (d) => formTierce([d.byMix[0]], d.byMix.slice(1, 5), d.byMix.slice(1, 5))],
  ["3連単 人気＋シミュ1〜2位→1〜4位→1〜6位", "tierce", (d) => formTierce(d.byMix.slice(0, 2), d.byMix.slice(0, 4), d.byMix.slice(0, 6))],
];

function run(data) {
  const st = STRATS.map(() => ({ races: 0, cost: 0, ret: 0, hit: 0, best: 0 }));
  for (const d of data) {
    STRATS.forEach(([, kind, make], i) => {
      const ts = make(d);
      if (!ts.length) return;
      let ret = 0;
      for (const t of ts) {
        for (const p of d[kind]) {
          const ok = kind === "tierce" ? p.nums.join("-") === t.join("-")
            : [...p.nums].sort((a, b) => a - b).join("-") === [...t].sort((a, b) => a - b).join("-");
          if (ok) ret += p.yen;
        }
      }
      const s = st[i];
      s.races++; s.cost += 100 * ts.length; s.ret += ret; if (ret) { s.hit++; s.best = Math.max(s.best, ret); }
    });
  }
  return st;
}
const fmt = (s) => s.races ? `${Math.round(s.cost / s.races / 100)}点・的中${Math.round((100 * s.hit) / s.races)}%・回収${Math.round((100 * s.ret) / s.cost)}%` : "-";

const dTrain = dataset(read(process.argv[2]), read(process.argv[3]));
const dTest = dataset(read(process.argv[4]), read(process.argv[5]));
console.log(`8頭以上のレース（新馬戦を除く）：調整用 ${dTrain.length} / 確認用 ${dTest.length}`);

// 荒れそうか：調整用の期間で3等分する境目を決める
const ents = dTrain.map((d) => d.ent).sort((a, b) => a - b);
const cut = [ents[Math.floor(ents.length / 3)], ents[Math.floor((2 * ents.length) / 3)]];
const level = (d) => (d.ent < cut[0] ? "堅そう" : d.ent < cut[1] ? "ふつう" : "荒れそう");

const sections = [["全レース", () => true], ["荒れそうなレース（オッズが割れている上位3分の1）", (d) => level(d) === "荒れそう"],
  ["ふつうのレース", (d) => level(d) === "ふつう"], ["堅そうなレース（1番人気が抜けている下位3分の1）", (d) => level(d) === "堅そう"]];
for (const [title, ok] of sections) {
  const a = run(dTrain.filter(ok)), b = run(dTest.filter(ok));
  console.log(`\n${title}（調整用 ${dTrain.filter(ok).length} / 確認用 ${dTest.filter(ok).length} レース） | 調整用 | 確認用 | 当たったときの最高払戻（両期間）`);
  STRATS.forEach(([name], i) => console.log([name, fmt(a[i]), fmt(b[i]), `${Math.max(a[i].best, b[i].best).toLocaleString()}円`].join(" | ")));
}
