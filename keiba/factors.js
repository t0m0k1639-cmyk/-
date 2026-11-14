// シミュレーションに足す候補の要素を、過去のレースで1つずつ確かめる。
//   SPLIT=2025-10-01 node keiba/factors.js 日.json 着順.json
// 日.json は keiba audit と同じ形（期間全体を1つにまとめたもの）。SPLIT より前で重みを決め、SPLIT 以降で確かめる。
// 要素ごとに2つの問いに答える：
//   1. シミュの合計点に足すと、着順の当てはまりが良くなるか（シミュが良くなるか）
//   2. オッズに足すと、当てはまりが良くなるか（オッズにない情報があるか）
// 当てはまりは、1〜3着を順に選ぶ確率の対数（プラケット＝ルース）。新馬戦・障害戦・5頭未満は除く。
// 騎手の成績は、そのレースより前の日の結果だけから出す。ログは公開されるので数字だけを出す。
"use strict";
const fs = require("fs");
const path = require("path");
global.window = {};
require(path.join(__dirname, "..", "site", "sim.js"));
const { _internal: I } = window.RaceSim;
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const SPLIT = process.env.SPLIT || "2025-10-01";
const BOOT = +(process.env.BOOT || 500);

const day = read(process.argv[2]), results = read(process.argv[3]);
const jkName = (s) => String(s || "").replace(/[\s　▲△☆★◇◆]/g, "").replace(/^[A-Z]\./, "");
const toDate = (s) => { const m = (s || "").match(/(\d{4})年(\d{1,2})月(\d{1,2})日/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const logit = (p) => Math.log(p / (1 - p));

// ---- 騎手の成績（そのレースより前の日まで）。少ない騎乗は全体の平均に寄せる
const jk = new Map();
let allN = 0, allTop3 = 0;
const jkRate = (name) => {
  const s = jk.get(jkName(name)) || { n: 0, top3: 0 };
  const p0 = allN ? allTop3 / allN : 0.2, a = 30;
  return logit((s.top3 + a * p0) / (s.n + a));
};

// ---- 要素のまとまり（列の名前と、1頭ずつの値）
const INTERVALS = [["連闘", 0, 7], ["中1週", 8, 14], ["中2〜4週", 15, 35], ["中10〜25週", 71, 180], ["半年以上", 181, 99999]];   // 基準は中5〜9週
const DISTS = [["短縮400m以上", -9999, -400], ["短縮200〜300m", -399, -150], ["延長200〜300m", 150, 399], ["延長400m以上", 400, 9999]];   // 基準は±100m
const GROUPS = {
  "騎手の実際の成績": ["騎手の複勝率"],
  "前走からの間隔": INTERVALS.map(([n]) => n),
  "距離の延長・短縮": DISTS.map(([n]) => n),
  "乗り替わり": ["乗り替わり", "騎手の格の変化"],
  "昇級初戦・クラス替わり": ["昇級初戦", "降級"],
};
const COLS = Object.values(GROUPS).flat();

function horseFeats(h, race) {
  const p = (h.past || []).filter((x) => x.surface !== "障")[0];
  const f = Object.fromEntries(COLS.map((c) => [c, 0]));
  f["騎手の複勝率"] = jkRate(h.jockey);
  if (!p) return f;
  const last = toDate(p.date), now = new Date(race.date);
  if (last) {
    const days = (now - last) / 864e5;
    for (const [n, a, b] of INTERVALS) if (days >= a && days <= b) f[n] = 1;
  }
  if (p.distance && race.distance) {
    const d = race.distance - p.distance;
    for (const [n, a, b] of DISTS) if (d >= a && d <= b) f[n] = 1;
  }
  if (p.jockey && h.jockey && jkName(p.jockey) !== jkName(h.jockey)) {
    f["乗り替わり"] = 1;
    f["騎手の格の変化"] = jkRate(h.jockey) - jkRate(p.jockey);
  }
  const cNow = I.classBase(`${race.name || ""} ${race.race_class || ""}`), cPrev = I.classBase(`${p.name || ""} ${p.race_class || ""}`);
  if (cNow != null && cPrev != null) {
    if (cNow > cPrev && p.place === 1) f["昇級初戦"] = 1;
    if (cNow < cPrev) f["降級"] = 1;
  }
  return f;
}

// ---- レースごとのデータ：馬ごとに [オッズの勝率の対数, シミュの合計点, 要素...] と、1〜3着の並び
const data = [];
const races = day.races.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
let i = 0;
while (i < races.length) {
  const d = races[i].date;
  const todays = [];
  while (i < races.length && races[i].date === d) todays.push(races[i++]);
  for (const r of todays) {
    const res = results[r.rkey];
    if (!res || !res.length || r.surface === "障害" || (r.race_class || "").includes("新馬")) continue;
    const place = Object.fromEntries(res.map((x) => [x.number, x.place]));
    const running = (r.horses || []).filter((h) => !h.scratched && place[h.number] != null && h.odds > 0).sort((a, b) => a.number - b.number);
    if (running.length < 5 || running.length !== (r.horses || []).filter((h) => !h.scratched && place[h.number] != null).length) continue;
    const cfg = Object.assign(I.configFor(r), { going: r.going || "良", cushion: "", moist: "" });
    const hs = running.map((h) => I.features(h, cfg, day.pedigree));
    hs.forEach((h, k) => { h.gate = k / (running.length - 1); h.manual = 0; });
    const m = I.buildModel(hs, cfg);
    const inv = running.reduce((a, h) => a + 1 / h.odds, 0);
    const X = running.map((h, k) => {
      const f = horseFeats(h, r);
      return { mkt: Math.log(1 / h.odds / inv), sim: m.base[k] / (m.sigma || 1), f: COLS.map((c) => f[c]) };
    });
    const order = running.map((h, k) => [place[h.number], k]).sort((a, b) => a[0] - b[0]).slice(0, 3).map(([, k]) => k);
    data.push({ key: r.rkey, test: d >= SPLIT, X, order });
  }
  // その日の結果を騎手の成績に足す（次の日から使う）
  for (const r of todays) {
    for (const x of results[r.rkey] || []) {
      const h = (r.horses || []).find((y) => y.number === x.number);
      if (!h || !h.jockey) continue;
      const k = jkName(h.jockey), s = jk.get(k) || { n: 0, top3: 0 };
      s.n++; if (x.place <= 3) s.top3++; jk.set(k, s); allN++; if (x.place <= 3) allTop3++;
    }
  }
}

// ---- プラケット＝ルース（1〜3着を順に選ぶ）の対数尤度・勾配・ヘッセ行列。cols は使う列の取り出し方
function ll(set, cols, th) {
  let s = 0, n = 0;
  for (const d of set) {
    const x = d.X.map(cols), sc = x.map((v) => v.reduce((a, b, k) => a + b * th[k], 0));
    const left = new Set(sc.keys());
    for (const w of d.order) {
      let mx = -Infinity; for (const j of left) mx = Math.max(mx, sc[j]);
      let z = 0; for (const j of left) z += Math.exp(sc[j] - mx);
      s += sc[w] - mx - Math.log(z); n++; left.delete(w);
    }
  }
  return s / n;
}
function fit(set, cols, dim) {
  let th = new Array(dim).fill(0);
  for (let it = 0; it < 30; it++) {
    const g = new Array(dim).fill(0), H = th.map(() => new Array(dim).fill(0));
    for (const d of set) {
      const x = d.X.map(cols), sc = x.map((v) => v.reduce((a, b, k) => a + b * th[k], 0));
      const left = new Set(sc.keys());
      for (const w of d.order) {
        let mx = -Infinity; for (const j of left) mx = Math.max(mx, sc[j]);
        const e = new Map(); let z = 0; for (const j of left) { const v = Math.exp(sc[j] - mx); e.set(j, v); z += v; }
        const ex = new Array(dim).fill(0);
        for (const [j, v] of e) for (let k = 0; k < dim; k++) ex[k] += v / z * x[j][k];
        for (let k = 0; k < dim; k++) {
          g[k] += x[w][k] - ex[k];
          for (let l = 0; l < dim; l++) {
            let exx = 0; for (const [j, v] of e) exx += v / z * x[j][k] * x[j][l];
            H[k][l] -= exx - ex[k] * ex[l];
          }
        }
        left.delete(w);
      }
    }
    for (let k = 0; k < dim; k++) H[k][k] -= 1e-3 * set.length;   // わずかに縮める（値のない列で発散しないように）
    const step = solve(H, g);
    th = th.map((v, k) => v - step[k]);
    if (step.reduce((a, b) => a + Math.abs(b), 0) < 1e-6) break;
  }
  return th;
}
function solve(A, b) {   // ガウスの消去法
  const n = b.length, M = A.map((r, k) => [...r, b[k]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, k) => r[n] / r[k]);
}
function bootDiff(set, colsA, thA, colsB, thB) {
  // レースを入れ替えて、確認用の期間での「B − A」の95%の幅
  const per = set.map((d) => [ll([d], colsB, thB) - ll([d], colsA, thA)]);
  let seed = 7; const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  const v = [];
  for (let b = 0; b < BOOT; b++) { let s = 0; for (let k = 0; k < per.length; k++) s += per[Math.floor(rnd() * per.length)][0]; v.push(s / per.length); }
  v.sort((a, b) => a - b);
  return [v[Math.floor(0.025 * BOOT)], v[Math.floor(0.975 * BOOT)]];
}

const train = data.filter((d) => !d.test), test = data.filter((d) => d.test);
console.log(`対象：重みを決める期間 ${train.length} レース（${SPLIT} より前）/ 確かめる期間 ${test.length} レース`);
const f4 = (v) => (v >= 0 ? "+" : "") + (1000 * v).toFixed(2);
const idx = (names) => names.map((n) => COLS.indexOf(n));

// 要素がどれくらいの馬に当てはまるか
console.log("\n要素 | 当てはまる馬の割合（確かめる期間）");
for (const c of COLS) {
  const k = COLS.indexOf(c), all = test.flatMap((d) => d.X);
  console.log(`${c} | ${c === "騎手の複勝率" || c === "騎手の格の変化" ? "全頭（数値）" : `${(100 * all.filter((x) => x.f[k]).length / all.length).toFixed(1)}%`}`);
}

for (const [base, label] of [["sim", "シミュの合計点"], ["mkt", "オッズ"]]) {
  console.log(`\n===== ${label}に足した場合（当てはまりの改善 ×1000・大きいほど良い） =====`);
  const cols0 = (x) => [x[base]];
  const th0 = fit(train, cols0, 1);
  const ll0tr = ll(train, cols0, th0), ll0te = ll(test, cols0, th0);
  console.log(`要素 | 重みを決める期間 | 確かめる期間 | 確かめる期間の95%の幅 | 決めた重み（${label}, 要素...）`);
  for (const [g, names] of [...Object.entries(GROUPS), ["5つすべて", COLS]]) {
    const ks = idx(names);
    const cols = (x) => [x[base], ...ks.map((k) => x.f[k])];
    const th = fit(train, cols, 1 + ks.length);
    const [lo, hi] = bootDiff(test, cols0, th0, cols, th);
    console.log([g, f4(ll(train, cols, th) - ll0tr), f4(ll(test, cols, th) - ll0te), `${f4(lo)}〜${f4(hi)}`, th.map((v) => v.toFixed(3)).join(", ")].join(" | "));
  }
}

// 参考：1位に選んだ馬の成績（シミュの合計点だけ / 5つの要素を足した場合 / オッズ）
console.log("\n確かめる期間で1位に選んだ馬 | 1着 | 3着内");
const thSim = fit(train, (x) => [x.sim], 1), thAll = fit(train, (x) => [x.sim, ...x.f], 1 + COLS.length);
for (const [name, score] of [
  ["シミュの合計点だけ", (x) => x.sim * thSim[0]],
  ["シミュ＋5つの要素", (x) => [x.sim, ...x.f].reduce((a, b, k) => a + b * thAll[k], 0)],
  ["（比べる用）1番人気", (x) => x.mkt],
]) {
  let w = 0, t3 = 0;
  for (const d of test) {
    const s = d.X.map(score), top = s.indexOf(Math.max(...s));
    if (d.order[0] === top) w++; if (d.order.includes(top)) t3++;
  }
  console.log(`${name} | ${(100 * w / test.length).toFixed(1)}% | ${(100 * t3 / test.length).toFixed(1)}%`);
}
