// 過去のレースで、シミュレーション（site/sim.js）の要素の重みを決める。
//   node keiba/tune.js 調整用の日.json 調整用の着順.json 確認用の日.json 確認用の着順.json
// 1. 要素ごとの重み：1〜3着の順に「残りの馬から選ばれる確率」が高くなるように決める（条件付きロジット）
// 2. 揺らぎの大きさ：その重みで実際にシミュレーションを回し、勝率・複勝率が実際と一番合う値を選ぶ
// 調整に使っていない期間（確認用）でも、今の重みと比べる。ログは公開されるので数字だけを出す。
// 最後の行「PARAMS {...}」が決めた重み（keiba tune がこれを読んで検証に回す）。
"use strict";
const fs = require("fs");
const path = require("path");
global.window = {};
require(path.join(__dirname, "..", "site", "sim.js"));
const { simulate, _internal: I } = window.RaceSim;
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

// cr には fixed（コースの枠の有利不利など、重みを決めない部分）を足しておく：fixed は cr と同じ縮尺
const FEATS = ["cr", "ten", "ag", "fin", "jk", "kin", "bw", "post"];

function dataset(day, results) {
  const out = [];
  for (const r of day.races) {
    const key = r.rkey || `${r.venue}-${r.number}`;
    const res = results[key];
    if (!res || !res.length || r.surface === "障害") continue;
    const place = Object.fromEntries(res.map((x) => [x.number, x.place]));
    const running = (r.horses || []).filter((h) => !h.scratched && place[h.number] != null).sort((a, b) => a.number - b.number);
    if (running.length < 5) continue;
    const cfg = Object.assign(I.configFor(Object.assign({ date: day.date }, r)), { going: r.going || "良", cushion: "", moist: "" });
    const hs = running.map((h) => I.features(h, cfg, day.pedigree));
    hs.forEach((h, i) => { h.gate = i / (running.length - 1); h.manual = 0; });
    const { rows } = I.terms(hs, cfg);
    const X = rows.map((t) => FEATS.map((f) => (f === "cr" ? t.cr + t.fixed : t[f])));
    const order = running.map((h, i) => [place[h.number], i]).sort((a, b) => a[0] - b[0]).slice(0, 3).map(([, i]) => i);
    out.push({ key, race: r, running, X, order });
  }
  return out;
}

// 1〜3着を順に選ぶ確率の対数（平均）と、その勾配
function loglik(data, th) {
  let ll = 0, cnt = 0;
  const g = new Array(th.length).fill(0);
  for (const d of data) {
    const s = d.X.map((x) => x.reduce((a, v, k) => a + v * th[k], 0));
    const left = new Set(d.X.keys());
    for (const w of d.order) {
      let mx = -Infinity; for (const i of left) mx = Math.max(mx, s[i]);
      let z = 0; const e = {};
      for (const i of left) { e[i] = Math.exp(s[i] - mx); z += e[i]; }
      ll += s[w] - mx - Math.log(z); cnt++;
      for (let k = 0; k < th.length; k++) {
        let ex = 0; for (const i of left) ex += e[i] * d.X[i][k];
        g[k] += d.X[w][k] - ex / z;
      }
      left.delete(w);
    }
  }
  return { ll: ll / cnt, g: g.map((v) => v / cnt) };
}

function fit(data, init, free) {
  // Adam。free[k] が false の要素は init のまま
  const th = init.slice(), m = th.map(() => 0), v = th.map(() => 0);
  const L2 = 1e-3;
  for (let it = 1; it <= 1500; it++) {
    const { g } = loglik(data, th);
    for (let k = 0; k < th.length; k++) {
      if (!free[k]) continue;
      const gk = g[k] - L2 * th[k];
      m[k] = 0.9 * m[k] + 0.1 * gk; v[k] = 0.999 * v[k] + 0.001 * gk * gk;
      th[k] += 0.03 * (m[k] / (1 - 0.9 ** it)) / (Math.sqrt(v[k] / (1 - 0.999 ** it)) + 1e-8);
    }
  }
  return th;
}
// 今の重みのまま、全体の強さ（縮尺）だけを合わせる
function fitScale(data, P) {
  let best = null;
  for (let lam = 0.1; lam <= 3; lam += 0.05) {
    const ll = loglik(data, FEATS.map((f) => lam * P[f])).ll;
    if (!best || ll > best.ll) best = { lam, ll };
  }
  return best;
}

function ranks(a) {
  const idx = a.map((_, i) => i).sort((x, y) => a[x] - a[y]), r = new Array(a.length);
  for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && a[idx[j + 1]] === a[idx[i]]) j++; for (let k = i; k <= j; k++) r[idx[k]] = (i + j) / 2; i = j + 1; }
  return r;
}
function spearman(x, y) {
  const rx = ranks(x), ry = ranks(y), n = x.length, mx = (n - 1) / 2;
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < n; i++) { a += (rx[i] - mx) * (ry[i] - mx); b += (rx[i] - mx) ** 2; c += (ry[i] - mx) ** 2; }
  return b && c ? a / Math.sqrt(b * c) : 0;
}
// 重みを掛けた合計点と、実際の着順の順位相関（レースごとの平均）
function rho(data, results, P) {
  let s = 0;
  for (const d of data) {
    const place = Object.fromEntries(results[d.key].map((x) => [x.number, x.place]));
    const sc = d.X.map((x) => x.reduce((a, v, k) => a + v * P[FEATS[k]], 0));
    s += spearman(sc, d.running.map((h) => -place[h.number]));
  }
  return s / data.length;
}

// 実際にシミュレーションを回して、勝率・複勝率がどれだけ当たっているか（対数損失。小さいほど良い）
function simLoss(data, results, P, sims) {
  let loss = 0, n = 0;
  const top = { n: 0, pred: 0, hit: 0 };
  for (const d of data) {
    const res = simulate(Object.assign({ date: d.race.date }, d.race, { horses: d.running }),
      { sims, seed: hash(d.key), params: P, cfg: { going: d.race.going || "良", cushion: "", moist: "" } });
    if (res.error) continue;
    const place = Object.fromEntries(results[d.key].map((x) => [x.number, x.place]));
    for (const x of res.rows) {
      const p1 = Math.min(Math.max(x.win, 1e-3), 1 - 1e-3), p3 = Math.min(Math.max(x.top3, 1e-3), 1 - 1e-3);
      const pl = place[x.h.num];
      loss -= pl === 1 ? Math.log(p1) : Math.log(1 - p1);
      loss -= pl <= 3 ? Math.log(p3) : Math.log(1 - p3);
      n++;
      if (x.top3 >= 0.5) { top.n++; top.pred += x.top3; top.hit += pl <= 3 ? 1 : 0; }
    }
  }
  return { loss: loss / n, top };
}

const train = read(process.argv[2]), trainRes = read(process.argv[3]);
const test = read(process.argv[4]), testRes = read(process.argv[5]);
const dTrain = dataset(train, trainRes), dTest = dataset(test, testRes);
console.log(`調整用 ${dTrain.length} レース / 確認用 ${dTest.length} レース`);

const OLD = Object.assign({}, I.PARAMS);
const sOld = fitScale(dTrain, OLD);
const init = FEATS.map((f) => sOld.lam * OLD[f]);
const th = fit(dTrain, init, FEATS.map(() => true));
const NEW = Object.assign({}, OLD);
FEATS.forEach((f, k) => (NEW[f] = +(th[k] / th[0]).toFixed(3)));   // cr を 1 にそろえる

console.log("\n要素 | 今の重み | 調整後の重み");
for (const f of FEATS) console.log([f, OLD[f], NEW[f]].join(" | "));

const llOldTest = loglik(dTest, FEATS.map((f) => sOld.lam * OLD[f])).ll;
const llNewTest = loglik(dTest, th).ll;
console.log("\n合計点の当てはまり | 調整用の期間 | 確認用の期間");
console.log(["1〜3着を選ぶ確率の対数(平均・大きいほど良い) 今", sOld.ll.toFixed(4), llOldTest.toFixed(4)].join(" | "));
console.log(["同 調整後", loglik(dTrain, th).ll.toFixed(4), llNewTest.toFixed(4)].join(" | "));
console.log(["順位相関 今", rho(dTrain, trainRes, OLD).toFixed(3), rho(dTest, testRes, OLD).toFixed(3)].join(" | "));
console.log(["順位相関 調整後", rho(dTrain, trainRes, NEW).toFixed(3), rho(dTest, testRes, NEW).toFixed(3)].join(" | "));

// 要素を1つずつ外したとき（確認用の期間）。下がり幅が大きい要素ほど効いている
console.log("\n外した要素 | 確認用の順位相関");
for (const f of FEATS.slice(1)) console.log([f, rho(dTest, testRes, Object.assign({}, NEW, { [f]: 0 })).toFixed(3)].join(" | "));

// 揺らぎの大きさ（調整用の期間で選ぶ）
const SIMS = +(process.env.TUNE_SIMS || 2000);
console.log("\n揺らぎ | 損失(今の重み) | 損失(調整後) | 複勝率50%以上の馬：予想→実際(調整後)");
let best = null;
for (const noise of [1.2, 1.5, 1.8, 2.1, 2.5, 3.0]) {
  const a = simLoss(dTrain, trainRes, Object.assign({}, OLD, { noise }), SIMS);
  const b = simLoss(dTrain, trainRes, Object.assign({}, NEW, { noise }), SIMS);
  const t = b.top;
  console.log([noise, a.loss.toFixed(4), b.loss.toFixed(4), t.n ? `${Math.round((100 * t.pred) / t.n)}%→${Math.round((100 * t.hit) / t.n)}%（${t.n}頭）` : "-"].join(" | "));
  if (!best || b.loss < best.loss) best = { noise, loss: b.loss };
}
NEW.noise = best.noise;
const c0 = simLoss(dTest, testRes, OLD, SIMS), c1 = simLoss(dTest, testRes, NEW, SIMS);
console.log(`\n確認用の期間の損失：今 ${c0.loss.toFixed(4)} → 調整後 ${c1.loss.toFixed(4)}`);
console.log("PARAMS " + JSON.stringify(NEW));
