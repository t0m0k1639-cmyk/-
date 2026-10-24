// レースシミュレーター（2026年9月に作った「レースシミュレーター」の計算部分を移したもの）
// 前走〜4走前の成績から能力・位置取り・末脚を出し、コースと馬場の補正をかけて
// 同じレースを何千回も走らせ、勝率・連対率・複勝率を出す。オッズと人気は使わない。
(() => {
  "use strict";

  const STYLE_NAMES = ["逃げ", "先行", "差し", "追込"];
  const STYLE_FRONT = [1, 0.66, 0.33, 0];
  const MARKS = ["◎", "○", "▲", "☆", "△"];

  // 直線(m)・1周(m)・坂(0平坦/1小さい坂/2急坂)の目安
  const VENUES = {
    "札幌": { dir: "R", turf: { "": { L: 266, lap: 1641, slope: 0 } }, dirt: { L: 264, lap: 1487, slope: 0 } },
    "函館": { dir: "R", turf: { "": { L: 262, lap: 1627, slope: 0 } }, dirt: { L: 260, lap: 1476, slope: 0 } },
    "福島": { dir: "R", turf: { "": { L: 292, lap: 1600, slope: 1 } }, dirt: { L: 296, lap: 1445, slope: 1 } },
    "新潟": { dir: "L", turf: { "外回り": { L: 659, lap: 2223, slope: 0 }, "内回り": { L: 359, lap: 1623, slope: 0 }, "直線": { L: 1000, lap: 1000, slope: 0, straight: true } }, dirt: { L: 354, lap: 1472, slope: 0 } },
    "東京": { dir: "L", turf: { "": { L: 526, lap: 2083, slope: 1 } }, dirt: { L: 502, lap: 1899, slope: 1 } },
    "中山": { dir: "R", turf: { "内回り": { L: 310, lap: 1667, slope: 2 }, "外回り": { L: 310, lap: 1840, slope: 2 } }, dirt: { L: 308, lap: 1493, slope: 2 } },
    "中京": { dir: "L", turf: { "": { L: 413, lap: 1706, slope: 2 } }, dirt: { L: 411, lap: 1530, slope: 2 } },
    "京都": { dir: "R", turf: { "外回り": { L: 404, lap: 1894, slope: 0 }, "内回り": { L: 328, lap: 1783, slope: 0 } }, dirt: { L: 329, lap: 1608, slope: 0 } },
    "阪神": { dir: "R", turf: { "外回り": { L: 474, lap: 2089, slope: 2 }, "内回り": { L: 357, lap: 1689, slope: 2 } }, dirt: { L: 353, lap: 1518, slope: 2 } },
    "小倉": { dir: "R", turf: { "": { L: 293, lap: 1615, slope: 0 } }, dirt: { L: 291, lap: 1445, slope: 0 } },
  };
  // スタートから最初のコーナーまでの距離（m・目安）
  const CORNER = {
    "中山": { "芝1200外": 275, "芝1600外": 240, "芝1800内": 205, "芝2000内": 405, "芝2200外": 432, "芝2500内": 192, "芝3600内": 337, "ダ1200": 502, "ダ1800": 375 },
    "東京": { "芝1400": 342, "芝1600": 542, "芝1800": 156, "芝2000": 126, "芝2400": 349, "芝2500": 449, "ダ1300": 342, "ダ1400": 442, "ダ1600": 640, "ダ2100": 240 },
    "阪神": { "芝1200内": 258, "芝1400内": 443, "芝1600外": 444, "芝1800外": 645, "芝2000内": 325, "芝2200内": 525, "ダ1200": 342, "ダ1400": 525, "ダ1800": 303, "ダ2000": 503 },
    "京都": { "芝1200内": 316, "芝1400内": 511, "芝1400外": 511, "芝1600外": 711, "芝1800外": 911, "芝2000内": 309, "芝2200外": 397, "芝2400外": 597, "芝3000外": 217, "芝3200外": 417, "ダ1200": 402, "ダ1800": 286, "ダ1900": 386 },
    "中京": { "芝1200": 315, "芝1400": 515, "芝2000": 314, "芝2200": 514, "ダ1200": 407, "ダ1800": 291, "ダ1900": 391 },
    "新潟": { "芝1200内": 445, "芝1600外": 548, "芝1800外": 748, "芝2000外": 948, "芝2000内": 448, "ダ1200": 525, "ダ1800": 389 },
    "札幌": { "芝1200": 406, "芝1500": 170, "芝1800": 185, "芝2000": 385, "ダ1700": 241 },
    "函館": { "芝1200": 489, "芝1800": 275, "芝2000": 475, "ダ1700": 329 },
    "福島": { "芝1200": 412, "芝1800": 305, "芝2000": 505, "ダ1700": 358 },
    "小倉": { "芝1200": 479, "芝1800": 272, "芝2000": 472, "ダ1700": 343 },
  };
  const CLASS_BASE = [["GⅠ", 100], ["G1", 100], ["GⅡ", 94], ["G2", 94], ["GⅢ", 90], ["G3", 90], ["リステッド", 87], ["OP", 86], ["オープン", 86], ["3勝", 80], ["2勝", 74], ["1勝", 68], ["新馬", 60], ["未勝利", 60]];
  // 近走の重み。2026/10/24 の35レースの検証で、前走だけの能力の方が着順と合っていたので前走を重く見る
  const REC_W = [1, 0.5, 0.3, 0.2];
  const GOING_LVL = { "良": 0, "稍重": 0.4, "重": 0.8, "不良": 1 };
  // 同じ検証で上位騎手は着順とやや合っていた（芝で特に）ので、以前より重くする
  const JK_WEIGHT = { A: 2.5, B: 0, C: -0.5 };
  // 同じ検証で末脚（走破タイムと上がり3Fの差）は着順とほぼ無関係だったので、効き方を1/4にする
  const AG_SCALE = 0.25;
  // 調教評価と脚色（以前のシミュレーターと同じ点数）。JRA公式には調教のデータがないので、自分で入れる
  const TRAIN = { A: 2, B: 1, C: 0, D: -2 };
  const KAKU = { "馬なり": 0.5, "G前仕掛け": 0.25, "強め": 0, "一杯": -0.5 };
  const JK_TOP = ["C.ルメール", "川田将雅", "戸崎圭太", "横山武史", "坂井瑠星", "武豊", "岩田望来", "松山弘平", "鮫島克駿", "西村淳也", "横山和生", "北村友一", "菅原明良", "佐々木大輔"];

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const nospace = (s) => String(s || "").replace(/[\s　]/g, "");

  function classBase(c) { for (const [k, v] of CLASS_BASE) if ((c || "").includes(k)) return v; return null; }
  function toSec(t) { const m = (t || "").match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/); return m ? (+(m[1] || 0)) * 60 + (+m[2]) : null; }
  function toDate(s) { const m = (s || "").match(/(\d{4})年(\d{1,2})月(\d{1,2})日/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function zscore(arr) {
    const vals = arr.filter((v) => v !== null);
    if (!vals.length) return arr.map(() => 0);
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length) || 1;
    return arr.map((v) => (v === null ? 0 : (v - m) / sd));
  }
  function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // 騎手名が上位騎手の一覧にあれば A（出馬表は「C.ルメール」「ルメール」など表記が揺れるので部分一致）
  function jockeyRank(name) {
    const n = nospace(name).replace(/^[A-Z]\./, "");
    if (!n) return "";
    return JK_TOP.some((t) => { const x = nospace(t).replace(/^[A-Z]\./, ""); return x.includes(n) || n.includes(x); }) ? "A" : "";
  }

  // ---- レース条件 → シミュレーターの設定
  function configFor(race) {
    const detail = race.course_detail || "";
    const surface = race.surface === "ダート" ? "dirt" : "turf";
    const v = VENUES[race.venue];
    let layout = "";
    if (v && surface === "turf") {
      const keys = Object.keys(v.turf);
      if (detail.includes("直線")) layout = "直線";
      else if (detail.includes("外")) layout = keys.includes("外回り") ? "外回り" : keys[0];
      else if (detail.includes("内")) layout = keys.includes("内回り") ? "内回り" : keys[0];
      else layout = keys[0];
    }
    return {
      venue: race.venue, surface, layout, dist: race.distance || 1600, going: race.going || "良",
      pace: "auto", post: "flat", style: "flat", strength: "2", chaos: "mid", weight: 50,
      corner: "auto", useCourse: "on", raceDate: race.date ? new Date(race.date) : new Date(),
    };
  }
  function courseSpec(cfg) {
    const v = VENUES[cfg.venue];
    const c = cfg.surface === "turf" ? v.turf[cfg.layout] || Object.values(v.turf)[0] : v.dirt;
    return Object.assign({ dir: v.dir }, c);
  }
  function cornerDist(cfg) {
    const t = CORNER[cfg.venue] || {}, sf = cfg.surface === "turf" ? "芝" : "ダ";
    const lay = cfg.surface === "turf" ? (cfg.layout || "").slice(0, 1) : "";
    return t[sf + cfg.dist + lay] ?? t[sf + cfg.dist] ?? null;
  }
  function courseEffect(cfg) {
    const c = courseSpec(cfg), d = cfg.dist, dirt = cfg.surface === "dirt";
    const e = { front: 0, agMul: 1, tenMul: 1, crMul: 1, post: 0, spec: c };
    if (cfg.useCourse !== "on") return e;
    if (c.straight) { e.front = 0.1; e.tenMul = 1.35; e.agMul = 0.85; e.post = -0.35; return e; } // 千直：外枠有利
    e.front = clamp((380 - c.L) / 380 * 0.4, -0.3, 0.25) + (c.slope === 0 ? 0.05 : c.slope === 2 ? -0.06 : 0) + (dirt ? 0.08 : 0);
    e.agMul = clamp(0.8 + (c.L - 260) / 400 * 0.6, 0.8, 1.4) * (c.slope === 2 ? 1.05 : 1);
    if (d <= 1400) { e.tenMul = 1.3; e.agMul *= 0.85; } else if (d >= 2400) { e.tenMul = 0.75; e.crMul = 1.15; }
    let cp;
    if (cfg.corner === "auto") { const cd = cornerDist(cfg); cp = cd === null ? 0.07 : clamp((500 - cd) / 300 * 0.2, 0, 0.22); }
    else cp = { short: 0.2, mid: 0.07, long: 0 }[cfg.corner];
    e.post = cp + (c.lap < 1700 ? 0.05 : 0) + (dirt ? -0.08 : 0);
    return e;
  }
  function goingEffect(cfg) {
    const dirt = cfg.surface === "dirt";
    let lvl = GOING_LVL[cfg.going] || 0;
    const m = parseFloat(cfg.moist), cu = parseFloat(cfg.cushion);
    if (dirt && Number.isFinite(m)) lvl = clamp((m - 5) / 10, 0, 1);   // 含水率が分かればそちらで決める
    const e = { lvl, front: 0, tenMul: 1, agMul: 1, sigma: 0, txt: [] };
    if (dirt) { e.front = 0.1 * lvl; e.tenMul = 1 + 0.15 * lvl; if (lvl) e.txt.push("脚抜けが良く前寄り・テン重視"); }
    else {
      e.agMul = 1 - 0.15 * lvl; e.sigma = 0.1 * lvl; e.front = 0.05 * lvl;
      if (lvl) e.txt.push("時計がかかり上がり勝負になりにくい・波乱度アップ");
      if (Number.isFinite(cu)) {
        if (cu >= 10.5) { e.agMul *= 1.06; e.txt.push("クッション値高め：硬く速い馬場"); }
        else if (cu <= 8) { e.agMul *= 0.92; e.sigma += 0.05; e.txt.push("クッション値低め：軟らかい馬場"); }
      }
    }
    return e;
  }

  // ---- 血統（父・母の父の産駒成績。Python 側の keiba/pedigree.py が集計したもの）
  // perf は着差ベース（0 が勝ち、-3 が大敗）。能力値に直すときは前走と同じ「基準点 - 6 × 着差」にそろえる
  function pedStats(ped, name, role, surf) {
    const e = ped && name && ped[name] && ped[name][role];
    if (!e) return null;
    return { all: e.all[surf], two: e.two[surf], apt: e.aptitude, label: e.label };
  }
  function aptToward(s, surf) { return s ? (surf === "芝" ? s.apt : -s.apt) : 0; }
  function pedFeatures(h, cfg, ped) {
    const surf = cfg.surface === "turf" ? "芝" : "ダ";
    const sire = pedStats(ped, h.sire, "sire", surf), ds = pedStats(ped, h.dam_sire, "dam_sire", surf);
    if (!sire && !ds) return null;
    // 新馬戦は仕上がりの早さが大事なので、父の2歳時の成績を重く見る
    const parts = [];
    if (sire && sire.two.n) parts.push([sire.two.perf, 0.5]);
    if (sire) parts.push([sire.all.perf, 0.3]);
    if (ds) parts.push([ds.all.perf, 0.2]);
    const wsum = parts.reduce((a, [, w]) => a + w, 0);
    const perf = parts.reduce((a, [v, w]) => a + v * w, 0) / wsum;
    // 芝向き・ダート向き（産駒の芝ダートの成績差と、どちらで多く使われているか）
    const apt = clamp(0.7 * aptToward(sire, surf) + 0.3 * aptToward(ds, surf), -1.5, 1.5);
    const src = sire && sire.all.n ? sire.all : ds && ds.all;
    return {
      // 産駒の成績から1頭の能力を推定するのは当たりにくい（同じ検証で順位相関0.1程度）ので、差を小さめにつける
      cr: 60 + 3 * perf + 1.5 * apt,
      pos: src && src.pos != null ? src.pos : null,
      // 血統から出した末脚は着順と逆向きだったので使わない
      kick: null,
      apt, sire, ds,
    };
  }
  function pedNote(h, p, surf) {
    const s = p.sire, bits = [];
    if (s) bits.push(`父${h.sire}（${s.label}・${surf}${s.all.n}走${s.all.top3_rate != null ? `・3着内${Math.round(s.all.top3_rate * 100)}%` : ""}${s.two.n ? `・2歳時${s.two.n}走` : ""}）`);
    if (p.ds) bits.push(`母の父${h.dam_sire}（${p.ds.label}）`);
    return "血統で推定：" + bits.join("・");
  }

  // ---- 前走〜4走前 → 能力・位置取り・末脚（元のシミュレーターの馬柱読み込みと同じ計算）
  function features(h, cfg, ped) {
    const surf = cfg.surface === "turf" ? "芝" : "ダ";
    const notes = [];
    let posS = 0, posW = 0, kickS = 0, kickW = 0, abS = 0, abW = 0, used = 0, sameUsed = 0;
    let gS = 0, gW = 0, wS = 0, wW = 0;
    const skipped = [], discounted = [];
    const past = (h.past || []).slice(0, 4);
    past.forEach((p, k) => {
      const label = ["前走", "前々走", "3走前", "4走前"][k];
      const cls = `${p.name || ""} ${p.race_class || ""}`;
      if (p.surface === "障" || cls.includes("障害")) { skipped.push(`${label}(障害)`); return; }
      const other = !!(p.surface && p.surface !== surf);
      if (other) discounted.push(label);
      const w = REC_W[k] * (other ? 0.4 : 1); used++; if (!other) sameUsed++;
      const pass = p.corners && p.corners.length ? p.corners[0] : null;
      if (pass && p.heads > 1) { const pw = other ? REC_W[k] * 0.6 : w; posS += pw * ((pass - 1) / (p.heads - 1)); posW += pw; }
      const sec = toSec(p.time), dist = p.distance, l3 = p.last3f;
      if (!other && sec && dist && Number.isFinite(l3)) { kickS += w * (sec / dist * 600 - l3); kickW += w; }
      const base = classBase(cls), rank = typeof p.place === "number" ? p.place : NaN;
      if (base !== null && Number.isFinite(rank)) {
        let sc = base - 6 * Math.min(Number.isFinite(p.margin) ? p.margin : 1.5, 3) - (other ? 3 : 0);
        if (p.venue === cfg.venue && Math.abs(dist - cfg.dist) <= 200 && rank <= 3) sc += 1.5;
        abS += w * sc; abW += w;
        if (!other) { if (/稍|重|不/.test(p.going || "")) { wS += w * sc; wW += w; } else { gS += w * sc; gW += w; } }
      }
    });
    const last = past[0] && toDate(past[0].date);
    if (last) { const days = (cfg.raceDate - last) / 864e5; if (days > 180) notes.push(`休み明け${Math.round(days / 30)}か月`); }
    if (skipped.length) notes.push("除外：" + skipped.join("・"));
    if (discounted.length) notes.push(`${surf === "芝" ? "ダート" : "芝"}戦を割引：${discounted.join("・")}`);
    if (used && !sameUsed) notes.push(`${surf === "芝" ? "芝" : "ダート"}の近走なし`);
    if (!used) notes.push("前走データなし（平均扱い）");
    let pos = posW ? posS / posW : null;
    let ab = abW ? abS / abW : null;
    let ag = kickW ? kickS / kickW : null;
    let aptAdj = 0, byPedigree = false;
    const pf = pedFeatures(h, cfg, ped);
    if (pf && ab === null && pos === null && ag === null) {
      // 前走がない馬（新馬など）は血統から推定する
      ab = pf.cr; pos = pf.pos; ag = pf.kick; byPedigree = true;
      const i = notes.indexOf("前走データなし（平均扱い）");
      if (i >= 0) notes.splice(i, 1);
      notes.push(pedNote(h, pf, surf));
    } else if (pf && used && !sameUsed && Math.abs(pf.apt) >= 0.2) {
      // 初めての芝・ダートは、血統の向き不向きで加減点
      aptAdj = 3 * pf.apt;
      notes.push(`${surf === "芝" ? "初芝" : "初ダート"}：血統は${pf.apt > 0 ? "向く" : "向かない"}（${(pf.sire || pf.ds).label}）`);
    }
    const style = pos === null ? 1 : pos < 0.15 ? 0 : pos < 0.4 ? 1 : pos < 0.7 ? 2 : 3;
    // 馬体重の増減（元のシミュレーターと同じ：大きく減った馬と、休み明け以外で大きく増えた馬だけ減点）
    let bwAdj = 0;
    const bw = h.body_weight_diff;
    if (bw != null) {
      const rested = notes.some((n) => n.startsWith("休み明け"));
      if (bw <= -16) bwAdj = -3;
      else if (bw <= -10) bwAdj = -1.5;
      else if (bw >= 14 && !rested) bwAdj = -1.5;
      if (bwAdj) notes.unshift(`馬体重${bw > 0 ? "+" : ""}${bw}kgで減点`);
    }
    if (ab !== null && notes.some((n) => n.startsWith("休み明け"))) ab -= 1.5;
    const wetN = wW, wetDiff = (wW && gW) ? wS / wW - gS / gW : null;
    if (wW) notes.push(`道悪経験あり${wetDiff === null ? "" : (wetDiff >= 0 ? "（良より好走）" : "（良より低調）")}`);
    const ref = past.find((p) => p.surface !== "障");
    const kinDiff = (ref && Number.isFinite(h.weight) && Number.isFinite(ref.weight)) ? h.weight - ref.weight : 0;
    if (kinDiff) notes.push(`斤量${kinDiff > 0 ? "+" : ""}${kinDiff}kg`);
    if (ref && h.jockey && ref.jockey && nospace(h.jockey) !== nospace(ref.jockey)) notes.push("乗り替わり");
    if (ref && ref.distance && Math.abs(cfg.dist - ref.distance) >= 200) notes.push(`距離${cfg.dist > ref.distance ? "延長" : "短縮"}${Math.abs(cfg.dist - ref.distance)}m`);
    return {
      num: h.number, name: h.name, waku: h.waku, cr: ab, ten: pos === null ? null : -pos, ag,
      style, notes, pos, wetDiff, wetN, kinDiff, kin: Number.isFinite(h.weight) ? h.weight : null, jkRank: jockeyRank(h.jockey),
      aptAdj, byPedigree, bwAdj,
    };
  }

  function autoPace(hs) {
    const n = hs.length, nige = hs.filter((h) => h.style === 0).length, sen = hs.filter((h) => h.style === 1).length;
    const front = n ? (nige + sen) / n : 0;
    let pace = "M";
    if ((nige >= 2 && front >= 0.4) || front >= 0.6) pace = "H";
    else if (nige === 0 && front <= 0.4) pace = "S";
    else if (nige <= 1 && front <= 0.3) pace = "S";
    return { pace, nige, sen };
  }

  function buildModel(hs, c) {
    const n = hs.length;
    const cr = zscore(hs.map((h) => h.cr)), ten = zscore(hs.map((h) => h.ten)), ag = zscore(hs.map((h) => h.ag));
    const ge = goingEffect(c);
    const kins = hs.map((h) => h.kin).filter(Number.isFinite);
    const kinMean = kins.length >= Math.ceil(hs.length / 2) ? kins.reduce((a, b) => a + b, 0) / kins.length : null;
    const perKg = 0.9 * clamp(c.dist / 1600, 0.75, 1.4); // 1kg≒0.15秒（1600m基準・距離が長いほど大きく）
    const extra = hs.map((h) => {
      const kinTerm = (kinMean != null && Number.isFinite(h.kin)) ? -perKg * (h.kin - kinMean) : -0.9 * (h.kinDiff || 0);
      let p = kinTerm + (JK_WEIGHT[h.jkRank] || 0) + 1.5 * (h.manual || 0) + (h.aptAdj || 0) + (h.bwAdj || 0)
        + (TRAIN[h.train] || 0) + (KAKU[h.kaku] || 0);
      if (ge.lvl && h.wetDiff != null) p += ge.lvl * clamp(h.wetDiff, -6, 6) * 0.6 * (h.wetN / (h.wetN + 1.5));
      return p / 5;
    });
    const pace = c.pace === "auto" ? autoPace(hs).pace : c.pace;
    const paceFront = { S: 0.3, M: 0, H: -0.3 }[pace];
    const agMul = { S: 0.75, M: 1, H: 1.3 }[pace];
    const k = [0, 0.2, 0.4, 0.65][+c.strength];
    const noiseR = { low: 0.9, mid: 1.2, high: 1.55 }[c.chaos] + ge.sigma;
    const t = c.weight / 100;
    const ce = courseEffect(c);
    const wTen = (0.15 + 0.5 * (1 - t)) * ce.tenMul * ge.tenMul, wAg = AG_SCALE * (0.15 + 0.5 * t) * agMul * ce.agMul * ge.agMul;
    const postSign = { in: 1, flat: 0, out: -1 }[c.post];
    const styleSign = { front: 1, flat: 0, back: -1 }[c.style];
    const base = hs.map((h, i) => extra[i] + ce.crMul * cr[i] + wTen * ten[i] + wAg * ag[i] + (postSign * k + ce.post) * (1 - 2 * h.gate));
    const early = hs.map((h, i) => ten[i] * 0.7 + STYLE_FRONT[h.style] * 1.5);
    const frontK = paceFront + styleSign * k + ce.front + ge.front;
    // 揺らぎは馬ごとの点数差の大きさに比例させる（補正を重ねても勝率が極端にならないように）
    const mB = base.reduce((a, b) => a + b, 0) / n;
    const sdB = Math.sqrt(base.reduce((a, b) => a + (b - mB) ** 2, 0) / n) || 1;
    const sigma = Math.max(0.6, sdB * noiseR);
    return { n, base, early, frontK, sigma, pace, ce };
  }

  function runOne(m) {
    const n = m.n, idx = [...Array(n).keys()];
    const e = m.early.map((v) => v + gauss() * 0.45);
    const eo = idx.slice().sort((a, b) => e[b] - e[a]);
    const eRank = new Array(n); eo.forEach((h, r) => (eRank[h] = r));
    const fs = idx.map((i) => {
      const f = n > 1 ? 1 - eRank[i] / (n - 1) : 1;
      const jump = Math.random() < 0.12 ? gauss() * m.sigma * 1.6 : 0; // たまに起きる大駆け・大凡走
      return m.base[i] + m.frontK * (2 * f - 1) + gauss() * m.sigma + jump;
    });
    const fo = idx.slice().sort((a, b) => fs[b] - fs[a]);
    const fRank = new Array(n); fo.forEach((h, r) => (fRank[h] = r));
    return fRank;
  }

  // race: ページのレースデータ。manual: {馬番: -2〜+2}（自分の補正）
  function simulate(race, opts = {}) {
    if (race.surface === "障害") return { error: "障害戦はシミュレーションの対象外です" };
    if (!VENUES[race.venue]) return { error: `${race.venue}のコースデータがありません` };
    const cfg = Object.assign(configFor(race), opts.cfg || {});
    const running = (race.horses || []).filter((h) => !h.scratched).sort((a, b) => a.number - b.number);
    if (running.length < 2) return { error: "出走馬が2頭以上必要です" };
    const hs = running.map((h) => features(h, cfg, opts.pedigree));
    const n = hs.length;
    hs.forEach((h, i) => {
      h.gate = n > 1 ? i / (n - 1) : 0;
      h.manual = (opts.manual || {})[h.num] || 0;
      if (h.manual) h.notes.unshift(`自分の補正${h.manual > 0 ? "+" : ""}${h.manual}`);
      h.train = (opts.train || {})[h.num] || "";
      h.kaku = (opts.kaku || {})[h.num] || "";
      if (h.train || h.kaku) h.notes.unshift(`調教${h.train}${h.train && h.kaku ? "・" : ""}${h.kaku}`);
    });
    const noData = hs.filter((h) => h.cr === null && h.ten === null && h.ag === null).length;
    const byPedigree = hs.filter((h) => h.byPedigree).length;
    const m = buildModel(hs, cfg), N = opts.sims || 5000;
    const win = new Array(n).fill(0), top2 = new Array(n).fill(0), top3 = new Array(n).fill(0), sumR = new Array(n).fill(0);
    for (let s = 0; s < N; s++) {
      const fRank = runOne(m);
      for (let i = 0; i < n; i++) { const rk = fRank[i]; sumR[i] += rk + 1; if (rk === 0) win[i]++; if (rk < 2) top2[i]++; if (rk < 3) top3[i]++; }
    }
    const rows = hs.map((h, i) => ({ h, win: win[i] / N, top2: top2[i] / N, top3: top3[i] / N, avg: sumR[i] / N }));
    rows.sort((a, b) => b.win - a.win || b.top3 - a.top3);
    rows.forEach((r, i) => (r.mark = MARKS[i] || ""));
    const ap = autoPace(hs);
    const spec = m.ce.spec;
    const course = spec.straight ? "直線1000m" :
      `${cfg.venue}${cfg.surface === "turf" ? "芝" : "ダ"}${cfg.dist}${cfg.layout || ""}・直線約${spec.L}m・${spec.dir === "R" ? "右" : "左"}回り`;
    const ge = goingEffect(cfg);
    const goingLabel = cfg.surface === "dirt" && Number.isFinite(parseFloat(cfg.moist)) ? `含水率${cfg.moist}%`
      : `${cfg.going}${cfg.surface === "turf" && cfg.cushion !== "" && cfg.cushion != null ? `・クッション値${cfg.cushion}` : ""}`;
    return {
      rows, sims: N, course, going: goingLabel, goingNote: ge.txt.join("・"), noData, byPedigree,
      pace: { S: "スロー", M: "ミドル", H: "ハイ" }[m.pace], nige: ap.nige, sen: ap.sen,
    };
  }

  // _internal は成績の検証用（keiba/diag_sim.js）
  window.RaceSim = { simulate, pedStats, STYLE_NAMES, MARKS, _internal: { features, buildModel, configFor, classBase, toSec } };
})();
