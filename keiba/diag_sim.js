// シミュレーションのどの要素が実際の着順と合っているかを調べる。
//   node keiba/diag_sim.js 復号済みの日のデータ.json 着順.json
// 要素ごとに、レース内での順位相関（1 なら着順と完全一致、0 なら無関係）と、
// その要素で1位の馬の1着率・3着内率を出す。ログは公開されるので数字だけを出す。
"use strict";
const fs = require("fs");
const path = require("path");
global.window = {};
require(path.join(__dirname, "..", "site", "sim.js"));
const { simulate, _internal: I } = window.RaceSim;

const day = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const results = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));

// 順位相関（Spearman）。値のない馬は除く
function ranks(a) {
  const idx = a.map((v, i) => i).sort((x, y) => a[x] - a[y]);
  const r = new Array(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && a[idx[j + 1]] === a[idx[i]]) j++;
    for (let k = i; k <= j; k++) r[idx[k]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}
function spearman(x, y) {
  const ok = x.map((v, i) => v != null && Number.isFinite(v) && y[i] != null);
  const xs = x.filter((_, i) => ok[i]), ys = y.filter((_, i) => ok[i]);
  if (xs.length < 4 || new Set(xs).size < 2) return null;
  const rx = ranks(xs), ry = ranks(ys), n = xs.length;
  const mx = (n - 1) / 2;
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < n; i++) { a += (rx[i] - mx) * (ry[i] - mx); b += (rx[i] - mx) ** 2; c += (ry[i] - mx) ** 2; }
  return a / Math.sqrt(b * c);
}

// 前走〜4走前から別の作り方の能力値（比較用）
function alt(h, surf) {
  const past = (h.past || []).filter((p) => p.surface && p.surface !== "障").slice(0, 4);
  const sc = (p) => {
    const base = I.classBase(`${p.name || ""} ${p.race_class || ""}`);
    if (base === null || typeof p.place !== "number") return null;
    return base - 6 * Math.min(Number.isFinite(p.margin) ? p.margin : 1.5, 3);
  };
  const scores = past.map(sc).filter((v) => v !== null);
  const same = past.filter((p) => p.surface === surf);
  const placeR = past.filter((p) => typeof p.place === "number" && p.heads > 1).map((p) => 1 - (p.place - 1) / (p.heads - 1));
  const margins = past.map((p) => p.margin).filter(Number.isFinite);
  const l3 = same.map((p) => p.last3f).filter(Number.isFinite);
  return {
    "能力(前走だけ)": scores.length ? scores[0] : null,
    "能力(近走の最高)": scores.length ? Math.max(...scores) : null,
    "着順の良さ(近走平均)": placeR.length ? placeR.reduce((a, b) => a + b, 0) / placeR.length : null,
    "着差の小ささ(近走平均・クラス無視)": margins.length ? -margins.reduce((a, b) => a + b, 0) / margins.length : null,
    "前走の着差の小ささ": Number.isFinite((past[0] || {}).margin) ? -past[0].margin : null,
    "上がり3Fの速さ(同じ芝ダ・平均)": l3.length ? -l3.reduce((a, b) => a + b, 0) / l3.length : null,
    "前走のクラスの高さ": past[0] ? I.classBase(`${past[0].name || ""} ${past[0].race_class || ""}`) : null,
  };
}

const stats = {};
function add(group, name, rho, topWin, topTop3) {
  const k = `${group}\t${name}`;
  const s = (stats[k] = stats[k] || { rho: 0, nr: 0, win: 0, top3: 0, n: 0 });
  if (rho !== null) { s.rho += rho; s.nr++; }
  if (topWin !== null) { s.win += topWin; s.top3 += topTop3; s.n++; }
}

for (const r of day.races) {
  const key = `${r.venue}-${r.number}`;
  const result = results[key];
  if (!result || !result.length || r.surface === "障害") continue;
  const place = Object.fromEntries(result.map((x) => [x.number, x.place]));
  const pop = Object.fromEntries(result.map((x) => [x.number, x.popularity]));
  const running = (r.horses || []).filter((h) => !h.scratched && place[h.number] != null).sort((a, b) => a.number - b.number);
  if (running.length < 4) continue;
  const cfg = Object.assign(I.configFor(Object.assign({ date: day.date }, r)), { going: r.going || "良", cushion: r.cushion != null ? String(r.cushion) : "" });
  const hs = running.map((h) => I.features(h, cfg, day.pedigree));
  hs.forEach((h, i) => { h.gate = running.length > 1 ? i / (running.length - 1) : 0; h.manual = 0; });
  const m = I.buildModel(hs, cfg);
  const sim = simulate(Object.assign({ date: day.date }, r, { horses: running }), { pedigree: day.pedigree, sims: 3000, cfg: { going: cfg.going, cushion: cfg.cushion, moist: "" } });
  const winP = Object.fromEntries(sim.rows.map((x) => [x.h.num, x.win]));
  const surf = r.surface === "ダート" ? "ダ" : "芝";
  const alts = running.map((h) => alt(h, surf));
  const feats = {
    "シミュレーションの勝率": running.map((h) => winP[h.number]),
    "合計点(base)": m.base,
    "能力(cr・今の計算)": hs.map((h) => h.cr),
    "位置取りの前さ(ten)": hs.map((h) => h.ten),
    "末脚(ag)": hs.map((h) => h.ag),
    "上位騎手": hs.map((h) => (h.jkRank === "A" ? 1 : 0)),
    "内枠": hs.map((h) => -h.gate),
    "斤量の軽さ": hs.map((h) => (h.kin == null ? null : -h.kin)),
    "（参考）人気": running.map((h) => (pop[h.number] ? -pop[h.number] : null)),
  };
  for (const k of Object.keys(alts[0])) feats[k] = alts.map((a) => a[k]);
  const y = running.map((h) => -place[h.number]);
  const groups = ["全体", r.surface === "ダート" ? "ダート" : "芝", (r.race_class || "").includes("新馬") ? "新馬" : "新馬以外"];
  for (const [name, x] of Object.entries(feats)) {
    const rho = spearman(x, y);
    const vals = x.map((v, i) => [v, i]).filter(([v]) => v != null && Number.isFinite(v));
    let topWin = null, topTop3 = null;
    if (vals.length >= 4 && new Set(vals.map(([v]) => v)).size > 1) {
      const best = Math.max(...vals.map(([v]) => v));
      const tops = vals.filter(([v]) => v === best).map(([, i]) => place[running[i].number]);
      // 同点で1位が複数いるときは平均
      topWin = tops.filter((p) => p === 1).length / tops.length;
      topTop3 = tops.filter((p) => p <= 3).length / tops.length;
    }
    for (const g of groups) add(g, name, rho, topWin, topTop3);
  }
}

console.log("区分 | 要素 | 順位相関(平均) | 1位の馬の1着率 | 1位の馬の3着内率 | レース数");
for (const [k, s] of Object.entries(stats)) {
  const [g, name] = k.split("\t");
  console.log([g, name, s.nr ? (s.rho / s.nr).toFixed(2) : "-", s.n ? `${Math.round((100 * s.win) / s.n)}%` : "-",
    s.n ? `${Math.round((100 * s.top3) / s.n)}%` : "-", s.nr].join(" | "));
}
