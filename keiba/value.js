// シミュレーションの点数と確定オッズ（人気）を組み合わせて勝率を出し、期待値で買ったら回収率はどうなるかを調べる。
//   node keiba/value.js 調整用の日.json 調整用の着順.json 確認用の日.json 確認用の着順.json 重み.json
// シミュレーションの勝率をそのまま使うと、人気薄の馬の勝率を高く見すぎて期待値が大きく出てしまう（回収率が下がる）。
// そこで「オッズから見た勝率の対数」と「シミュレーションの合計点」を、調整用の期間で勝ち馬に合うように混ぜる。
// 確認用の期間で、オッズだけの場合より当てはまりが良くなれば、シミュレーションにはオッズにない情報がある。
// 新馬戦は除く。ログは公開されるので数字だけを出す。
"use strict";
const fs = require("fs");
const path = require("path");
global.window = {};
require(path.join(__dirname, "..", "site", "sim.js"));
const { _internal: I } = window.RaceSim;
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const P = Object.assign({}, I.PARAMS, process.argv[6] ? read(process.argv[6]) : {});

function dataset(day, results) {
  const out = [];
  for (const r of day.races) {
    const key = r.rkey || `${r.venue}-${r.number}`;
    const res = results[key], pay = (day.payouts || {})[key];
    if (!res || !res.length || !pay || r.surface === "障害" || (r.race_class || "").includes("新馬")) continue;
    const place = Object.fromEntries(res.map((x) => [x.number, x.place]));
    const running = (r.horses || []).filter((h) => !h.scratched && place[h.number] != null && h.odds).sort((a, b) => a.number - b.number);
    if (running.length < 5) continue;
    const cfg = Object.assign(I.configFor(Object.assign({ date: day.date }, r)), { going: r.going || "良", cushion: "", moist: "" });
    const hs = running.map((h) => I.features(h, cfg, day.pedigree));
    hs.forEach((h, i) => { h.gate = i / (running.length - 1); h.manual = 0; });
    const m = I.buildModel(hs, cfg, P);
    const inv = running.reduce((a, h) => a + 1 / h.odds, 0);
    const yen = (list, n) => (list || []).filter((p) => p.nums.length === 1 && p.nums[0] === n).reduce((a, p) => a + p.yen, 0);
    out.push({
      key, cls: r.race_class || "", n: running.length, surface: r.surface,
      horses: running.map((h, i) => ({
        num: h.number, odds: h.odds, lo: (h.place_odds || [])[0] || null, place: place[h.number],
        lpm: Math.log(1 / h.odds / inv), sim: m.base[i] / (m.sigma || 1),   // 点数を揺らぎの大きさで割って、レースごとの縮尺をそろえる
        winYen: yen(pay.win, h.number), plcYen: yen(pay.place, h.number),
      })),
    });
  }
  return out;
}

// 勝ち馬を選ぶ確率の対数（平均）と勾配。s = a × lpm + b × sim
function loglik(data, th) {
  let ll = 0; const g = [0, 0];
  for (const d of data) {
    const s = d.horses.map((h) => th[0] * h.lpm + th[1] * h.sim);
    const mx = Math.max(...s), e = s.map((v) => Math.exp(v - mx)), z = e.reduce((a, b) => a + b, 0);
    const w = d.horses.findIndex((h) => h.place === 1);
    if (w < 0) continue;
    ll += s[w] - mx - Math.log(z);
    g[0] += d.horses[w].lpm - d.horses.reduce((a, h, i) => a + e[i] * h.lpm, 0) / z;
    g[1] += d.horses[w].sim - d.horses.reduce((a, h, i) => a + e[i] * h.sim, 0) / z;
  }
  return { ll: ll / data.length, g: g.map((v) => v / data.length) };
}
function fit(data, free) {
  const th = [1, 0], m = [0, 0], v = [0, 0];
  for (let it = 1; it <= 3000; it++) {
    const { g } = loglik(data, th);
    for (let k = 0; k < 2; k++) {
      if (!free[k]) continue;
      m[k] = 0.9 * m[k] + 0.1 * g[k]; v[k] = 0.999 * v[k] + 0.001 * g[k] ** 2;
      th[k] += 0.01 * (m[k] / (1 - 0.9 ** it)) / (Math.sqrt(v[k] / (1 - 0.999 ** it)) + 1e-9);
    }
  }
  return th;
}
// 勝率から3着内率（ハーヴィル式：1着の確率から2着・3着を順に選ぶ）
function top3(p) {
  const n = p.length, out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    out[i] += p[i];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const pij = p[j] * p[i] / (1 - p[j]);
      out[i] += pij;
      for (let k = 0; k < n; k++) {
        if (k === i || k === j) continue;
        out[i] += p[k] * p[j] / (1 - p[k]) * p[i] / (1 - p[k] - p[j]);
      }
    }
  }
  return out;
}
function probs(d, th) {
  const s = d.horses.map((h) => th[0] * h.lpm + th[1] * h.sim);
  const mx = Math.max(...s), e = s.map((v) => Math.exp(v - mx)), z = e.reduce((a, b) => a + b, 0);
  const p = e.map((v) => v / z);
  return { p, p3: top3(p) };
}

const RULES = [
  ["単勝", "期待値1.0以上", (h) => h.ev1 >= 1.0],
  ["単勝", "期待値1.1以上", (h) => h.ev1 >= 1.1],
  ["単勝", "期待値1.2以上", (h) => h.ev1 >= 1.2],
  ["単勝", "期待値1.3以上", (h) => h.ev1 >= 1.3],
  ["単勝", "期待値1.1以上・10倍まで", (h) => h.ev1 >= 1.1 && h.odds <= 10],
  ["単勝", "期待値1.1以上・20倍まで", (h) => h.ev1 >= 1.1 && h.odds <= 20],
  ["単勝", "期待値1.2以上・20倍まで", (h) => h.ev1 >= 1.2 && h.odds <= 20],
  ["複勝", "期待値1.0以上（下限）", (h) => h.lo && h.ev3 >= 1.0],
  ["複勝", "期待値1.1以上（下限）", (h) => h.lo && h.ev3 >= 1.1],
  ["複勝", "期待値1.2以上（下限）", (h) => h.lo && h.ev3 >= 1.2],
  ["複勝", "期待値1.0以上・下限3倍まで", (h) => h.lo && h.ev3 >= 1.0 && h.lo <= 3],
  ["複勝", "期待値1.1以上・下限3倍まで", (h) => h.lo && h.ev3 >= 1.1 && h.lo <= 3],
  ["（参考）", "単勝 1番人気をすべて", (h) => h.fav],
];
function backtest(data, th) {
  const st = RULES.map(() => ({ n: 0, hit: 0, ret: 0 }));
  for (const d of data) {
    const { p, p3 } = probs(d, th);
    const minOdds = Math.min(...d.horses.map((h) => h.odds));
    d.horses.forEach((h, i) => {
      const x = Object.assign({}, h, { ev1: p[i] * h.odds, ev3: h.lo ? p3[i] * h.lo : 0, fav: h.odds === minOdds });
      RULES.forEach(([kind, , ok], j) => {
        if (!ok(x)) return;
        const y = kind === "複勝" ? h.plcYen : h.winYen;
        st[j].n++; st[j].ret += y; if (y) st[j].hit++;
      });
    });
  }
  return st;
}

const dTrain = dataset(read(process.argv[2]), read(process.argv[3]));
const dTest = dataset(read(process.argv[4]), read(process.argv[5]));
console.log(`オッズのあるレース（新馬戦を除く）：調整用 ${dTrain.length} / 確認用 ${dTest.length}`);
const thMkt = fit(dTrain, [true, false]);
const thMix = fit(dTrain, [true, true]);
const thSim = [0, fit(dTrain, [false, true])[1]];
console.log("\n勝ち馬の当てはまり（大きいほど良い） | 調整用 | 確認用 | 重み（オッズ, シミュ）");
for (const [name, th] of [["オッズだけ", thMkt], ["シミュだけ", thSim], ["オッズ＋シミュ", thMix]]) {
  console.log([name, loglik(dTrain, th).ll.toFixed(4), loglik(dTest, th).ll.toFixed(4), th.map((v) => v.toFixed(3)).join(", ")].join(" | "));
}
const f = (s) => s.n ? `${s.n}頭・${Math.round((100 * s.hit) / s.n)}%・${Math.round(s.ret / s.n)}%` : "-";
for (const [title, th] of [["オッズ＋シミュ", thMix], ["オッズだけ（重み1）", [1, 0]], ["オッズだけ（調整した重み）", thMkt]]) {
  console.log(`\n買い方・勝率は${title}（100円ずつ） | 調整用：頭数・的中・回収率 | 確認用：頭数・的中・回収率`);
  const a = backtest(dTrain, th), b = backtest(dTest, th);
  RULES.forEach(([kind, name], j) => console.log([`${kind} ${name}`, f(a[j]), f(b[j])].join(" | ")));
}
// 月ごと（オッズだけ・重み1、複勝 期待値1.0以上・下限3倍まで）
const RULE = RULES.findIndex(([, n]) => n === "期待値1.0以上・下限3倍まで");
const byMonth = {};
for (const d of [...dTrain, ...dTest]) (byMonth[d.key.slice(0, 7)] = byMonth[d.key.slice(0, 7)] || []).push(d);
console.log("\n月 | 複勝 期待値1.0以上・下限3倍まで（オッズだけ）：頭数・的中・回収率");
for (const [mo, ds] of Object.entries(byMonth).sort()) console.log([mo, f(backtest(ds, [1, 0])[RULE])].join(" | "));
