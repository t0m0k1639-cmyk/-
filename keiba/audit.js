// シミュレーション（site/sim.js）の精査。正しく動いているか・オッズにない情報があるか・使わない方が良いかを調べる。
//   LABELS=期間A,期間B node keiba/audit.js 日A.json 着順A.json 日B.json 着順B.json ...
// 最初の期間で「オッズとシミュレーションの混ぜ方」を決め、ほかの期間はそのまま当てはめて確かめる。
// 新馬戦・障害戦・5頭未満・確定オッズのないレースは除く。ログは公開されるので数字だけを出す。
"use strict";
const fs = require("fs");
const path = require("path");
global.window = {};
require(path.join(__dirname, "..", "site", "sim.js"));
const { simulate, _internal: I } = window.RaceSim;
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const SIMS = +(process.env.SIMS || 10000);
const BOOT = +(process.env.BOOT || 1000);
const LABELS = (process.env.LABELS || "").split(",");
const pct = (x, d = 0) => (x == null || !Number.isFinite(x) ? "-" : `${(100 * x).toFixed(d)}%`);
const fx = (x, d = 4) => (x == null || !Number.isFinite(x) ? "-" : x.toFixed(d));
const clip = (p, lo = 0.5 / SIMS) => Math.min(Math.max(p, lo), 1 - lo);

function harville3(p) {
  const n = p.length, out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    out[i] += p[i];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      out[i] += p[j] * p[i] / (1 - p[j]);
      for (let k = 0; k < n; k++) if (k !== i && k !== j) out[i] += p[k] * p[j] / (1 - p[k]) * p[i] / (1 - p[k] - p[j]);
    }
  }
  return out;
}
const softmax = (s) => { const mx = Math.max(...s), e = s.map((v) => Math.exp(v - mx)), z = e.reduce((a, b) => a + b, 0); return e.map((v) => v / z); };
const yenOf = (list, num) => (list || []).filter((p) => p.nums.length === 1 && p.nums[0] === num).reduce((a, p) => a + p.yen, 0);

// ---- 1レースずつ：シミュレーションを回し、オッズから見た確率と並べる
function dataset(day, results) {
  const out = [];
  const skip = { 障害: 0, 新馬: 0, 頭数: 0, オッズ: 0, 結果: 0, エラー: 0 };
  for (const r of day.races) {
    const key = r.rkey || `${r.venue}-${r.number}`;
    const res = results[key], pay = (day.payouts || {})[key];
    if (r.surface === "障害") { skip.障害++; continue; }
    if ((r.race_class || "").includes("新馬")) { skip.新馬++; continue; }
    if (!res || !res.length || !pay) { skip.結果++; continue; }
    const place = Object.fromEntries(res.map((x) => [x.number, x.place]));
    const all = (r.horses || []).filter((h) => !h.scratched && place[h.number] != null);
    if (all.length < 5) { skip.頭数++; continue; }
    if (!all.every((h) => h.odds > 0)) { skip.オッズ++; continue; }
    const running = all.slice().sort((a, b) => a.number - b.number);
    const race = Object.assign({}, r, { horses: running });
    const sim = simulate(race, { sims: SIMS, seed: hash(key), cfg: { going: r.going || "良", cushion: "", moist: "" } });
    if (sim.error) { skip.エラー++; continue; }
    const byNum = Object.fromEntries(sim.rows.map((x) => [x.h.num, x]));
    const inv = running.reduce((a, h) => a + 1 / h.odds, 0);
    const pm = running.map((h) => 1 / h.odds / inv);
    const pm3 = harville3(pm);
    // 要素ごとの値（重みを掛ける前）。向きが合っているかを見る
    const cfg = Object.assign(I.configFor(Object.assign({ date: day.date }, r)), { going: r.going || "良", cushion: "", moist: "" });
    const hs = running.map((h) => I.features(h, cfg, day.pedigree));
    hs.forEach((h, i) => { h.gate = i / (running.length - 1); h.manual = 0; });
    const { rows: terms } = I.terms(hs, cfg);
    const minOdds = Math.min(...running.map((h) => h.odds));
    out.push({
      key, n: running.length, surface: r.surface, cls: r.race_class || "",
      horses: running.map((h, i) => {
        const s = byNum[h.number];
        return {
          num: h.number, odds: h.odds, lo: (h.place_odds || [])[0] || null, place: place[h.number],
          fav: h.odds === minOdds,
          pm: pm[i], pm3: pm3[i], ps: s.win, ps3: s.top3, mix3: (s.top3 + pm3[i]) / 2, mark: s.mark || "",
          winYen: yenOf(pay.win, h.number), plcYen: yenOf(pay.place, h.number),
          raw: { cr: hs[i].cr, ten: hs[i].ten, ag: hs[i].ag, fin: hs[i].fin }, terms: terms[i],
        };
      }),
    });
  }
  return { races: out, skip };
}

// ---- 勝ち馬の当てはまり：s = a × log(オッズの勝率) + b × log(シミュの勝率)（条件付きロジット）
function ll1(d, th) {
  const s = d.horses.map((h) => th[0] * Math.log(h.pm) + th[1] * Math.log(clip(h.ps)));
  const p = softmax(s), w = d.horses.findIndex((h) => h.place === 1);
  return w < 0 ? null : { ll: Math.log(p[w]), p, w };
}
function loglik(races, th) {
  let s = 0, n = 0;
  for (const d of races) { const r = ll1(d, th); if (r) { s += r.ll; n++; } }
  return s / n;
}
// ニュートン法（2変数）。free[k] が false の重みは 0 に固定
function fit(races, free) {
  let th = free.map((f) => (f ? 0.5 : 0));
  for (let it = 0; it < 50; it++) {
    const g = [0, 0], H = [[0, 0], [0, 0]];
    for (const d of races) {
      const x = d.horses.map((h) => [Math.log(h.pm), Math.log(clip(h.ps))]);
      const r = ll1(d, th); if (!r) continue;
      const ex = [0, 1].map((k) => r.p.reduce((a, p, i) => a + p * x[i][k], 0));
      for (let k = 0; k < 2; k++) {
        g[k] += x[r.w][k] - ex[k];
        for (let l = 0; l < 2; l++) H[k][l] -= r.p.reduce((a, p, i) => a + p * x[i][k] * x[i][l], 0) - ex[k] * ex[l];
      }
    }
    const idx = [0, 1].filter((k) => free[k]);
    let step;
    if (idx.length === 2) {
      const det = H[0][0] * H[1][1] - H[0][1] * H[1][0];
      step = [(H[1][1] * g[0] - H[0][1] * g[1]) / det, (-H[1][0] * g[0] + H[0][0] * g[1]) / det];
    } else { step = [0, 0]; step[idx[0]] = g[idx[0]] / H[idx[0]][idx[0]]; }
    th = th.map((v, k) => v - step[k]);
    if (Math.abs(step[0]) + Math.abs(step[1]) < 1e-7) break;
  }
  return th;
}

// ---- レースを入れ替えて（ブートストラップ）、差の95%の幅を出す
function boot(races, stat) {
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  const vals = [];
  for (let b = 0; b < BOOT; b++) {
    const smp = races.map(() => races[Math.floor(rnd() * races.length)]);
    vals.push(stat(smp));
  }
  vals.sort((a, b) => a - b);
  return [vals[Math.floor(0.025 * BOOT)], vals[Math.floor(0.975 * BOOT)]];
}
const range = ([a, b], f) => `${f(a)}〜${f(b)}`;

// 1頭ずつの複勝の当てはまり（対数損失・小さいほど良い）
function top3Loss(races, key) {
  let s = 0, n = 0;
  for (const d of races) for (const h of d.horses) {
    const p = clip(typeof key === "function" ? key(h, d) : h[key], 1e-4); const y = h.place <= 3;
    s -= y ? Math.log(p) : Math.log(1 - p); n++;
  }
  return s / n;
}

// 本命の選び方ごとの成績（1レース1頭、単勝・複勝100円）
const PICKS = [
  ["1番人気", (d) => d.horses.reduce((a, h) => (h.pm > a.pm ? h : a))],
  ["シミュの勝率1位", (d) => d.horses.reduce((a, h) => (h.ps > a.ps ? h : a))],
  ["シミュの複勝率1位", (d) => d.horses.reduce((a, h) => (h.ps3 > a.ps3 ? h : a))],
  ["今のページの◎（シミュとオッズの複勝率の平均）", (d) => d.horses.find((h) => h.mark === "◎") || d.horses.reduce((a, h) => (h.mix3 > a.mix3 ? h : a))],
];
function pickStats(races, pick) {
  let win = 0, top3 = 0, wy = 0, py = 0, pop = 0;
  for (const d of races) {
    const h = pick(d);
    if (h.place === 1) win++; if (h.place <= 3) top3++;
    wy += h.winYen; py += h.plcYen;
    pop += 1 + d.horses.filter((x) => x.pm > h.pm).length;
  }
  const n = races.length;
  return { win: win / n, top3: top3 / n, wroi: wy / n / 100, proi: py / n / 100, pop: pop / n };
}

function report(label, races, thMix, thMkt, thSim) {
  const n = races.length, heads = races.reduce((a, d) => a + d.n, 0);
  console.log(`\n===== ${label}（${n}レース・${heads}頭） =====`);
  if (!n) return;

  // A. 勝ち馬の当てはまり
  const uni = races.reduce((a, d) => a - Math.log(d.n), 0) / n;
  console.log("\n勝ち馬の当てはまり（勝ち馬に付けた確率の対数の平均・大きいほど良い） | 値 | でたらめ（全馬同じ）との差");
  const llM = loglik(races, [1, 0]), llS = loglik(races, [0, 1]);
  for (const [name, th] of [["オッズだけ（そのまま）", [1, 0]], ["シミュだけ（そのまま）", [0, 1]],
    ["オッズだけ（縮尺を合わせる）", thMkt], ["シミュだけ（縮尺を合わせる）", thSim], ["オッズ＋シミュ（混ぜ方を合わせる）", thMix]]) {
    const v = loglik(races, th);
    console.log(`${name} | ${fx(v)} | ${fx(v - uni)}`);
  }
  const gain = (rs) => loglik(rs, thMix) - loglik(rs, thMkt);
  console.log(`オッズ＋シミュ − オッズだけ（95%の幅） | ${fx(gain(races), 5)} | ${range(boot(races, gain), (v) => fx(v, 5))}`);
  console.log(`（参考）シミュはオッズの情報のうち何割を持っているか（でたらめとの差の比） | ${pct((llS - uni) / (llM - uni))}`);

  // B. 複勝（3着内）の当てはまり
  console.log("\n3着内の当てはまり（1頭ずつの対数損失・小さいほど良い） | 値");
  for (const [name, k] of [["オッズから見た複勝率", "pm3"], ["シミュの複勝率", "ps3"], ["今のページ（両者の平均）", "mix3"]]) {
    console.log(`${name} | ${fx(top3Loss(races, k))}`);
  }
  const mixP3 = new Map();
  for (const d of races) {
    const p = softmax(d.horses.map((h) => thMix[0] * Math.log(h.pm) + thMix[1] * Math.log(clip(h.ps))));
    harville3(p).forEach((v, i) => mixP3.set(d.horses[i], v));
  }
  console.log(`オッズ＋シミュ（混ぜ方を合わせた勝率から） | ${fx(top3Loss(races, (h) => mixP3.get(h)))}`);
  const d3 = (rs) => top3Loss(rs, "pm3") - top3Loss(rs, "mix3");
  console.log(`今のページの平均 − オッズだけ（正ならページの方が良い・95%の幅） | ${fx(d3(races), 5)} | ${range(boot(races, d3), (v) => fx(v, 5))}`);

  // C. 本命の選び方
  console.log("\n本命の選び方（1レース1頭） | 1着 | 3着内 | 単勝の回収率 | 複勝の回収率 | 平均人気 | 単勝の回収率（95%の幅）");
  for (const [name, pick] of PICKS) {
    const s = pickStats(races, pick);
    console.log(`${name} | ${pct(s.win)} | ${pct(s.top3)} | ${pct(s.wroi)} | ${pct(s.proi)} | ${s.pop.toFixed(2)} | ${range(boot(races, (rs) => pickStats(rs, pick).wroi), pct)}`);
  }
  const fav = PICKS[0][1], simTop = PICKS[2][1];
  const diffRaces = races.filter((d) => fav(d) !== simTop(d));
  console.log(`シミュの複勝率1位が1番人気と違ったレース：${diffRaces.length}（${pct(diffRaces.length / n)}）`);
  for (const [name, pick] of [PICKS[0], PICKS[2]]) {
    const s = pickStats(diffRaces, pick);
    console.log(`  そのとき ${name} | 1着 ${pct(s.win)} | 3着内 ${pct(s.top3)} | 単勝 ${pct(s.wroi)} | 複勝 ${pct(s.proi)}`);
  }

  // D. シミュがオッズより高く見た馬は、本当に人気以上に走っているか
  console.log("\nシミュの勝率 ÷ オッズの勝率 | 頭数 | オッズの勝率(平均) | シミュの勝率(平均) | 実際の勝率 | 単勝の回収率 | 複勝の回収率");
  const BINS = [[0, 0.5], [0.5, 0.8], [0.8, 1.25], [1.25, 2], [2, 4], [4, Infinity]];
  const all = races.flatMap((d) => d.horses);
  for (const [a, b] of BINS) {
    const hs = all.filter((h) => { const r = clip(h.ps) / h.pm; return r >= a && r < b; });
    if (!hs.length) continue;
    const m = (f) => hs.reduce((s, h) => s + f(h), 0) / hs.length;
    console.log(`${a}〜${b === Infinity ? "" : b}倍 | ${hs.length} | ${pct(m((h) => h.pm), 1)} | ${pct(m((h) => h.ps), 1)} | ${pct(m((h) => +(h.place === 1)), 1)} | ${pct(m((h) => h.winYen / 100))} | ${pct(m((h) => h.plcYen / 100))}`);
  }

  // E. シミュの確率の目盛りは合っているか
  console.log("\nシミュの勝率 | 頭数 | 予想の平均 | 実際の勝率 || オッズの勝率 | 頭数 | 予想の平均 | 実際の勝率");
  const CB = [[0, 0.02], [0.02, 0.05], [0.05, 0.1], [0.1, 0.2], [0.2, 0.35], [0.35, 1.01]];
  for (const [a, b] of CB) {
    const row = [];
    for (const k of ["ps", "pm"]) {
      const hs = all.filter((h) => h[k] >= a && h[k] < b);
      const m = (f) => hs.length ? hs.reduce((s, h) => s + f(h), 0) / hs.length : null;
      row.push(`${pct(a)}〜${pct(Math.min(b, 1))} | ${hs.length} | ${pct(m((h) => h[k]), 1)} | ${pct(m((h) => +(h.place === 1)), 1)}`);
    }
    console.log(row.join(" || "));
  }

  // F. 要素ごとの向き：レース内で上位3分の1・下位3分の1の馬の3着内率（上位の方が高ければ向きは正しい）
  console.log("\n要素（重みを掛ける前） | 値のある馬 | 上位3分の1の3着内率 | 下位3分の1の3着内率 | オッズの複勝率との差（上位） | オッズの複勝率との差（下位）");
  for (const k of I.TERMS) {
    let n1 = 0, cov = 0; const top = { y: 0, p: 0, n: 0 }, bot = { y: 0, p: 0, n: 0 };
    for (const d of races) {
      const vals = d.horses.map((h) => h.terms[k]);
      const rawKey = { cr: "cr", ten: "ten", ag: "ag", fin: "fin" }[k];
      const hs = d.horses.filter((h, i) => (rawKey ? h.raw[rawKey] != null : true) && Number.isFinite(vals[i]));
      n1 += d.horses.length; cov += hs.length;
      if (hs.length < 3 || new Set(hs.map((h) => h.terms[k])).size < 2) continue;
      const s = hs.slice().sort((x, y) => y.terms[k] - x.terms[k]), t = Math.floor(s.length / 3);
      for (const h of s.slice(0, t)) { top.n++; top.y += +(h.place <= 3); top.p += h.pm3; }
      for (const h of s.slice(s.length - t)) { bot.n++; bot.y += +(h.place <= 3); bot.p += h.pm3; }
    }
    console.log(`${k} | ${pct(cov / n1)} | ${pct(top.y / top.n)} | ${pct(bot.y / bot.n)} | ${pct((top.y - top.p) / top.n, 1)} | ${pct((bot.y - bot.p) / bot.n, 1)}`);
  }
}

// ---- 動作の確認：同じ乱数なら同じ結果か、回数によるブレはどれくらいか
function selfCheck(races, day) {
  const r = day.races.find((x) => x.rkey === races[0].key);
  const race = Object.assign({}, r, { horses: (r.horses || []).filter((h) => !h.scratched) });
  const opt = (seed, sims) => ({ sims, seed, cfg: { going: r.going || "良", cushion: "", moist: "" } });
  const a = simulate(race, opt(1, SIMS)), b = simulate(race, opt(1, SIMS)), c = simulate(race, opt(2, SIMS));
  const same = a.rows.every((x, i) => x.top3 === b.rows[i].top3);
  const map = Object.fromEntries(c.rows.map((x) => [x.h.num, x]));
  const diff = Math.max(...a.rows.map((x) => Math.abs(x.top3 - map[x.h.num].top3)));
  const sumWin = a.rows.reduce((s, x) => s + x.win, 0), sumTop3 = a.rows.reduce((s, x) => s + x.top3, 0);
  console.log(`\n動作の確認 | 同じ乱数で同じ結果: ${same ? "はい" : "いいえ"} | 乱数を変えたときの複勝率の差(最大): ${pct(diff, 2)} | 勝率の合計: ${sumWin.toFixed(3)} | 複勝率の合計: ${sumTop3.toFixed(3)}（3になるはず）`);
}

// ---- 実行
const periods = [];
for (let i = 2, j = 0; i + 1 < process.argv.length; i += 2, j++) {
  const day = read(process.argv[i]);
  const { races, skip } = dataset(day, read(process.argv[i + 1]));
  periods.push({ label: LABELS[j] || `期間${j + 1}`, races, skip, day });
  console.log(`${LABELS[j] || `期間${j + 1}`}：対象 ${races.length} レース / 除いたレース ${JSON.stringify(skip)}`);
}
const base = periods.find((p) => p.races.length);
if (!base) { console.log("対象のレースがありません"); process.exit(0); }
selfCheck(base.races, base.day);
const thMix = fit(base.races, [true, true]), thMkt = fit(base.races, [true, false]), thSim = fit(base.races, [false, true]);
console.log(`\n混ぜ方（${base.label}で決めた重み） | オッズ | シミュ`);
console.log(`オッズ＋シミュ | ${fx(thMix[0], 3)} | ${fx(thMix[1], 3)}`);
console.log(`オッズだけ | ${fx(thMkt[0], 3)} | 0`);
console.log(`シミュだけ | 0 | ${fx(thSim[1], 3)}`);
for (const p of periods) report(p.label, p.races, thMix, thMkt, thSim);
const allRaces = periods.flatMap((p) => p.races);
if (periods.length > 1) report("全期間", allRaces, thMix, thMkt, thSim);
