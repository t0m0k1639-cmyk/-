(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const state = { dates: [], day: null, sort: "target", venue: "すべて", showOdds: true, password: null, status: null };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* 保存できない環境では覚えない */ } },
    del(k) { try { localStorage.removeItem(k); } catch (_) { /* 無視 */ } },
  };
  state.sort = store.get("sort") || state.sort;

  // ---- 印とメモ（この端末にだけ保存）
  const MARK_CYCLE = ["", "◎", "○", "▲", "△", "☆", "✕"];
  let yoso = {};
  try { yoso = JSON.parse(store.get("yoso") || "{}") || {}; } catch (_) { yoso = {}; }
  const yosoKey = (r) => `${state.day.date}|${r.key}`;
  const yosoOf = (r) => Object.assign({ m: {}, memo: "", adj: {}, tr: {}, kk: {} }, yoso[yosoKey(r)]);
  function saveYoso(r, v) {
    const b = v.baba || {};
    if (!Object.values(v.m).some(Boolean) && !v.memo && !Object.values(v.adj || {}).some(Boolean)
        && !Object.values(v.tr || {}).some(Boolean) && !Object.values(v.kk || {}).some(Boolean)
        && !b.going && !b.cushion && !b.moist) delete yoso[yosoKey(r)];
    else yoso[yosoKey(r)] = v;
    store.set("yoso", JSON.stringify(yoso));
  }
  function markSummary(r) {
    const m = yosoOf(r).m;
    return MARK_CYCLE.slice(1).flatMap((mk) => Object.keys(m).filter((n) => m[n] === mk).map((n) => `${mk}${n}`)).join(" ");
  }
  state.showOdds = store.get("showOdds") !== "0";

  async function getJSON(path) {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw Object.assign(new Error(`${path}: ${r.status}`), { status: r.status });
    return r.json();
  }

  // ---- 復号（Python 側の keiba/crypto.py と同じ方式）----
  class WrongPassword extends Error {}

  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function decrypt(env, password) {
    if (!env.ct) return env;    // 暗号化前の古いデータ
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: fromB64(env.salt), iterations: env.iter },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    let plain;
    try {
      plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(env.iv) }, key, fromB64(env.ct));
    } catch (_) {
      throw new WrongPassword("パスワードが違います");
    }
    if (env.z === "gzip") {
      const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(stream).text());
    }
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // ---- 表示の部品 ----
  function fmtTime(iso) {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function fmtDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const w = "日月火水木金土"[new Date(y, m - 1, d).getDay()];
    return `${m}月${d}日(${w})`;
  }

  function notice(kind, lines) {
    const el = $("notice");
    el.className = `notice ${kind}`;
    el.replaceChildren(...lines.map((t) => Object.assign(document.createElement("p"), { textContent: t })));
    el.hidden = false;
  }

  const el = (tag, className, text) => Object.assign(document.createElement(tag), className ? { className } : {}, text != null ? { textContent: text } : {});

  function surfaceClass(s) {
    return s === "芝" ? "tag-turf" : s === "ダート" ? "tag-dirt" : s === "障害" ? "tag-jump" : "";
  }

  function tags(r) {
    const out = [];
    const add = (text, cls = "") => out.push(el("span", `tag ${cls}`, text));
    if (r.surface) add(`${r.surface}${r.distance ? r.distance + "m" : ""}`, surfaceClass(r.surface));
    if (r.field_size) add(`${r.field_size}頭`, r.field_size >= 15 ? "tag-hot" : "");
    if (r.race_class) add(r.race_class);
    if (r.handicap) add("ハンデ", "tag-hot");
    if (r.fillies_only) add("牝馬限定");
    if (r.going) add(`馬場 ${r.going}`, r.going === "良" ? "" : "tag-hot");
    if (r.post_time) add(`${r.post_time}発走`);
    return out;
  }

  function pillClass(label) {
    return label === "穴狙い向き" ? "pill-ana" : label === "本命妙味" ? "pill-hon" : "";
  }

  function raceTitle(r) {
    return r.name || [r.race_class, r.surface && `${r.surface}${r.distance || ""}`].filter(Boolean).join(" ");
  }

  const SURF_SHORT = { "芝": "芝", "ダ": "ダ", "障": "障" };

  function pastChip(p) {
    const place = typeof p.place === "number" ? `${p.place}着` : (p.place || "—");
    const c = el("span", `pchip${typeof p.place === "number" && p.place <= 3 ? " top" : ""}`);
    c.append(el("b", "", place), el("small", "", `${(p.venue || "").slice(0, 1)}${SURF_SHORT[p.surface] || ""}${p.distance || ""}`));
    return c;
  }

  function pastLine(p) {
    const md = (p.date || "").replace(/^\d{4}年/, "").replace("月", "/").replace("日", "");
    const parts = [
      md, p.venue, p.name,
      `${p.surface || ""}${p.distance || ""}${p.going ? "・" + p.going : ""}`,
      p.heads ? `${p.heads}頭${p.gate ? p.gate + "番" : ""}` : null,
      typeof p.place === "number" ? `${p.place}着${p.margin != null ? `（${p.margin.toFixed(1)}）` : ""}` : p.place,
      p.corners && p.corners.length ? `通過 ${p.corners.join("-")}` : null,
      p.last3f ? `上がり ${p.last3f.toFixed(1)}` : null,
      p.time, p.jockey, p.weight ? `${p.weight.toFixed(1)}kg` : null,
    ];
    return el("li", "", parts.filter(Boolean).join("　"));
  }

  // 血統の集計を1行にする（例: 芝 12走・3着内42%／ダ 3走・3着内0%・2歳時 芝5走 → 芝向き）
  function pedLine(name, role) {
    const e = name && state.day.pedigree && state.day.pedigree[name] && state.day.pedigree[name][role];
    if (!e) return name ? "まだ集計がありません" : null;
    const f = (s, x) => x.n ? `${s} ${x.n}走${x.top3_rate != null ? `・3着内${Math.round(x.top3_rate * 100)}%` : ""}` : `${s} 0走`;
    const two = ["芝", "ダ"].filter((s) => e.two[s].n).map((s) => `${s}${e.two[s].n}走`).join("・");
    return `${f("芝", e.all["芝"])}／${f("ダ", e.all["ダ"])}${two ? `（うち2歳時 ${two}）` : ""} → ${e.label}`;
  }
  function pedBadge(name) {
    const e = name && state.day.pedigree && state.day.pedigree[name] && state.day.pedigree[name].sire;
    return e && (e.label === "芝向き" || e.label === "ダート向き") ? e.label : null;
  }

  function horseRow(h, r, onMark) {
    const tr = el("tr", h.scratched ? "scratched" : "");
    const mk = el("td", "h-mark");
    const btn = Object.assign(el("button", "mark-btn"), { type: "button" });
    const cur = yosoOf(r).m[h.number] || "";
    btn.textContent = cur || "・";
    btn.dataset.mark = cur;
    btn.setAttribute("aria-label", `${h.number}番の印`);
    btn.disabled = h.scratched;
    btn.addEventListener("click", () => {
      const v = yosoOf(r);
      const next = MARK_CYCLE[(MARK_CYCLE.indexOf(v.m[h.number] || "") + 1) % MARK_CYCLE.length];
      // ◎○▲ は1頭だけ。ほかの馬に付いていたら外す
      if (["◎", "○", "▲"].includes(next)) Object.keys(v.m).forEach((n) => { if (v.m[n] === next) v.m[n] = ""; });
      v.m[h.number] = next;
      saveYoso(r, v);
      onMark();
    });
    mk.append(btn);
    const num = el("td", "h-num");
    num.append(el("span", `waku waku-${h.waku || 0}`, h.number));
    const place = placeOf(reviewOf(r), h.number);
    if (place) num.append(el("span", `h-place${place <= 3 ? " top" : ""}`, `${place}着`));
    const main = el("td", "h-main");
    const nameBtn = Object.assign(el("button", "h-name"), { type: "button", textContent: h.name });
    main.append(nameBtn);
    const sub = [h.sex_age, h.weight != null ? `${h.weight.toFixed(1)}kg` : null, h.jockey].filter(Boolean).join("・");
    main.append(el("span", "h-sub", h.scratched ? `取消・${sub}` : sub));
    if (h.body_weight) {
      const d = h.body_weight_diff;
      const big = d != null && (d <= -10 || d >= 14);
      main.append(el("span", `bw${big ? " bw-big" : ""}`, `馬体重 ${h.body_weight}kg${d != null ? `（${d > 0 ? "+" : ""}${d}）` : ""}`));
    }
    const pb = pedBadge(h.sire);
    if (pb) main.append(el("span", `ped-badge ${pb === "芝向き" ? "turf" : "dirt"}`, `父:${pb}`));
    const badges = el("span", "h-badges");
    const renderBadges = () => {
      const y = yosoOf(r), a = y.adj[h.number] || 0, t = y.tr[h.number], k = y.kk[h.number];
      badges.replaceChildren();
      if (t || k) badges.append(el("span", `adj-badge ${t === "A" || t === "B" ? "plus" : t === "D" ? "minus" : "flat"}`, `調教${t || ""}${t && k ? "・" : ""}${k || ""}`));
      if (a) badges.append(el("span", `adj-badge ${a > 0 ? "plus" : "minus"}`, `補正${a > 0 ? "+" : ""}${a}`));
    };
    renderBadges();
    main.append(badges);
    const past = h.past || [];
    if (past.length) {
      const chips = el("span", "h-past");
      chips.append(...past.map(pastChip));
      main.append(chips);
    }
    const odds = el("td", "col-odds h-odds");
    if (h.odds != null) {
      odds.append(el("span", "h-win", h.odds.toFixed(1)));
      if (h.popularity) odds.append(el("span", `h-pop${h.popularity <= 3 ? " top" : ""}`, `${h.popularity}人気`));
    } else {
      odds.append(el("span", "h-none", h.scratched ? "—" : "未発表"));
    }
    tr.append(mk, num, main, odds);

    const detail = el("tr", "past-detail");
    detail.hidden = true;
    const td = el("td");
    td.colSpan = 4;
    const info = el("dl", "h-info");
    const addInfo = (k, v) => { if (v) info.append(el("dt", "", k), el("dd", "", v)); };
    addInfo("血統", [h.sire && `父 ${h.sire}`, h.dam && `母 ${h.dam}`, h.dam_sire && `母の父 ${h.dam_sire}`].filter(Boolean).join("　"));
    addInfo("父の産駒", pedLine(h.sire, "sire"));
    addInfo("母の父", pedLine(h.dam_sire, "dam_sire"));
    addInfo("調教師", h.trainer && `${h.trainer}${h.stable ? `（${h.stable}）` : ""}`);
    addInfo("生産者", h.breeder);
    addInfo("馬主", h.owner);
    const ul = el("ul", "past-list");
    if (past.length) ul.append(...past.map(pastLine));
    else ul.append(el("li", "", "前走のデータはありません（新馬など）"));

    // 調教・脚色・自分の補正（シミュレーションに反映）。field は yoso の項目名、空の値は「入れていない」
    const segBox = (label, field, options, none = "") => {
      const box = el("div", "adj");
      box.append(el("span", "adj-label", label));
      const seg = el("div", "adj-seg");
      seg.style.gridTemplateColumns = `repeat(${options.length}, minmax(0, 1fr))`;
      for (const [v, text] of options) {
        const b = Object.assign(el("button", "", text), { type: "button" });
        b.setAttribute("aria-pressed", String((yosoOf(r)[field][h.number] || none) === v));
        b.addEventListener("click", () => {
          const y = yosoOf(r);
          if (v) y[field][h.number] = v; else delete y[field][h.number];
          saveYoso(r, y);
          seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          renderBadges();
        });
        seg.append(b);
      }
      box.append(seg);
      return box;
    };
    td.append(info, ul);
    if (!h.scratched) {
      td.append(
        segBox("調教評価（以前のシミュレーターと同じ：A +2・B +1・C 0・D −2）", "tr", [["", "—"], ["A", "A"], ["B", "B"], ["C", "C"], ["D", "D"]]),
        segBox("調教の脚色", "kk", [["", "—"], ["馬なり", "馬なり"], ["G前仕掛け", "G前"], ["強め", "強め"], ["一杯", "一杯"]]),
        segBox("自分の補正", "adj", [[-2, "-2"], [-1, "-1"], [0, "±0"], [1, "+1"], [2, "+2"]], 0),
      );
    }
    detail.append(td);
    nameBtn.setAttribute("aria-expanded", "false");
    nameBtn.addEventListener("click", () => {
      detail.hidden = !detail.hidden;
      nameBtn.setAttribute("aria-expanded", String(!detail.hidden));
    });
    return [tr, detail];
  }

  function pct(x) { return (x * 100).toFixed(1) + "%"; }

  // ---- 「このレースを最新にする」：GitHub の取得処理（refresh.yml）を呼び出し、終わったら読み直す
  const GH = (() => {
    const owner = location.hostname.endsWith(".github.io") ? location.hostname.split(".")[0] : null;
    const repo = location.pathname.split("/").filter(Boolean)[0] || null;
    return { owner, repo, api: owner && repo ? `https://api.github.com/repos/${owner}/${repo}` : null };
  })();
  const token = () => store.get("ghToken");
  // 失敗したときは、どこを直せばよいかを具体的に返す
  async function gh(path, opts = {}) {
    let r;
    try {
      r = await fetch(GH.api + path, Object.assign({}, opts, {
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token()}`, "X-GitHub-Api-Version": "2022-11-28" },
      }));
    } catch (_) {
      throw new Error("GitHub につながりませんでした。通信状態を確かめてください");
    }
    if (r.status === 401) throw new Error("【401】合鍵が違うか、期限切れです。合鍵を作り直して保存してください");
    if (r.status === 404) throw new Error(`【404】合鍵でこのリポジトリ（${GH.repo}）が選ばれていません。合鍵の「Repository access」で「${GH.repo}」を選んでください`);
    if (r.status === 403 || r.status === 422) {
      throw new Error(opts.method === "POST"
        ? `【${r.status}】合鍵に「Actions」の書き込み権限がありません。「Repository permissions」の「Actions」を「Read and write」にしてください`
        : `【${r.status}】合鍵の権限が足りません。「Repository permissions」の「Actions」を「Read and write」にしてください`);
    }
    if (!r.ok) throw new Error(`GitHub からエラーが返りました（${r.status}）`);
    return r.status === 204 ? null : r.json();
  }
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  // 指定したレース（1つでも、まとめてでも）を取り直す。done(day) は読み直したあとに呼ぶ
  async function refreshRaces(list, msg, btn, done) {
    if (!GH.api) { msg.textContent = "公開ページ（github.io）でだけ使えます"; return; }
    if (!token()) {
      msg.textContent = "先にページ下の「更新ボタンの設定」で合鍵を保存してください";
      $("token-box").open = true;
      $("token-box").scrollIntoView({ block: "start" });
      return;
    }
    btn.disabled = true;
    const started = Date.now();
    const tick = (t) => { msg.textContent = `${t}（${Math.round((Date.now() - started) / 1000)}秒）`; };
    try {
      const before = (await getJSON("data/status.json").catch(() => ({}))).checked_at || "";
      tick("取得を依頼しています");
      const { default_branch: ref } = await gh("");
      await gh("/actions/workflows/refresh.yml/dispatches", {
        method: "POST", body: JSON.stringify({ ref, inputs: { race: list.map((r) => `${r.venue}-${r.number}`).join(","), date: state.day.date } }),
      });
      let run = null;
      while (Date.now() - started < (4 + list.length) * 60e3) {
        await sleep(5000);
        if (!run) {
          const list = await gh("/actions/workflows/refresh.yml/runs?event=workflow_dispatch&per_page=5");
          run = (list.workflow_runs || []).find((x) => Date.parse(x.created_at) >= started - 15e3) || null;
          tick(run ? "JRAから取得しています" : "順番待ちです");
          continue;
        }
        run = await gh(`/actions/runs/${run.id}`);
        if (run.status !== "completed") { tick(run.status === "queued" ? "順番待ちです" : "JRAから取得して、ページを作り直しています"); continue; }
        if (run.conclusion !== "success") throw new Error("取得処理が失敗しました");
        // ページの公開が終わるのを待って読み直す
        tick("ページの反映を待っています");
        for (let i = 0; i < 24; i++) {
          const st = await getJSON(`data/status.json?t=${Date.now()}`).catch(() => ({}));
          if ((st.checked_at || "") > before) {
            const day = await loadDay(state.day.date);
            showDay(day);
            done(day);
            return;
          }
          await sleep(5000);
        }
        throw new Error("取得は終わりましたが、ページへの反映が遅れています。少し待って再読み込みしてください");
      }
      throw new Error("時間がかかりすぎています。少し待って再読み込みしてください");
    } catch (e) {
      msg.textContent = `うまくいきませんでした：${e.message}`;
    } finally {
      btn.disabled = false;
    }
  }

  async function refreshRace(r, msg, btn) {
    await refreshRaces([r], msg, btn, (day) => {
      const card = document.getElementById(`r-${r.key}`);
      if (card) {
        card.querySelector(".race-head").click();
        card.querySelector(".refresh-msg").textContent = `最新にしました（${fmtTime(day.generated_at)}）`;
        card.scrollIntoView({ block: "start" });
      }
    });
  }

  // この後に発走する各競馬場の次の n レース（今日のページを見ているときだけ）
  function upcoming(n) {
    const now = new Date(Date.now() + 9 * 3600e3);
    if (!state.day || state.day.date !== now.toISOString().slice(0, 10)) return null;
    const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
    const toMin = (t) => { const m = (t || "").match(/^(\d+):(\d+)$/); return m ? +m[1] * 60 + +m[2] : null; };
    const byVenue = {};
    for (const r of state.day.races) {
      const t = toMin(r.post_time);
      if (t !== null && t > mins) (byVenue[r.venue] = byVenue[r.venue] || []).push([t, r]);
    }
    return Object.values(byVenue).flatMap((xs) => xs.sort((a, b) => a[0] - b[0]).slice(0, n).map(([, r]) => r));
  }
  function setupBatchRefresh() {
    const msg = $("batch-msg");
    document.querySelectorAll("#batch button").forEach((btn) => btn.addEventListener("click", async () => {
      const list = upcoming(+btn.dataset.n);
      if (list === null) { msg.textContent = "今日のレースを表示しているときに使えます"; return; }
      if (!list.length) { msg.textContent = "この後に発走するレースはありません"; return; }
      const names = list.map((r) => `${r.venue}${r.number}R`).join("・");
      document.querySelectorAll("#batch button").forEach((b) => (b.disabled = true));
      try {
        await refreshRaces(list, msg, btn, (day) => { msg.textContent = `最新にしました：${names}（${fmtTime(day.generated_at)}）`; });
      } finally {
        document.querySelectorAll("#batch button").forEach((b) => (b.disabled = false));
      }
    }));
  }

  // 即PATへのリンクと、印のコピー（即PATに買い目を自動で入れる仕組みはJRAにないため、見返す用）
  const IPAT_URL = "https://www.ipat.jra.go.jp/";
  function marksText(r, res) {
    const m = yosoOf(r).m;
    const mine = MARK_CYCLE.slice(1, 6).flatMap((mk) => Object.keys(m).filter((n) => m[n] === mk).map((n) => `${mk}${n}`));
    const picks = mine.length ? mine : res.rows.filter((x) => x.mark).map((x) => `${x.mark}${x.h.num}`);
    return `${r.venue}${r.number}R ${raceTitle(r)}\n${picks.join(" ")}${mine.length ? "" : "（シミュレーションの予想印）"}`;
  }
  function betBar(r, res) {
    const bar = el("div", "bet-bar");
    const link = Object.assign(el("a", "bet-ipat", "即PATを開く ↗"), { href: IPAT_URL, target: "_blank", rel: "noopener" });
    const copy = Object.assign(el("button", "bet-copy", "印をコピー"), { type: "button" });
    const msg = el("span", "bet-msg");
    copy.addEventListener("click", async () => {
      const text = marksText(r, res);
      try {
        await navigator.clipboard.writeText(text);
        msg.textContent = "コピーしました";
      } catch (_) {
        msg.textContent = text.replace("\n", " ");   // コピーできない環境では画面に出して手で写せるように
      }
    });
    bar.append(link, copy, msg);
    return bar;
  }

  function renderSim(r, out) {
    out.replaceChildren(el("p", "sim-run", "計算しています…"));
    setTimeout(() => {
      const baba = yosoOf(r).baba || {};
      const res = window.RaceSim.simulate(Object.assign({ date: state.day.date }, r), {
        manual: yosoOf(r).adj, train: yosoOf(r).tr, kaku: yosoOf(r).kk, pedigree: state.day.pedigree,
        // クッション値は入力がなければJRA発表の最新値を使う。含水率は競馬場ごとに基準が違うので入力したときだけ使う
        cfg: { going: baba.going || r.going || "良", cushion: baba.cushion || (r.cushion != null ? String(r.cushion) : ""), moist: baba.moist || "",
          bias: biasOf(r) },
      });
      if (res.error) { out.replaceChildren(el("p", "sim-err", res.error)); return; }
      const warn = [];
      if (res.byPedigree) {
        warn.push(el("p", "sim-info", `前走がない${res.byPedigree}頭は、血統（父の2歳時と全体の成績・母の父の成績、${r.surface === "ダート" ? "ダート" : "芝"}での成績と向き不向き）から能力・脚質・末脚を推定しています。血統の集計は毎週の出馬表から貯めているので、始めのうちは走数が少なめです。`));
      }
      if (res.noData >= res.rows.length / 2) {
        warn.push(el("p", "sim-warn", `${res.rows.length}頭中${res.noData}頭は前走データがありません（新馬など）。能力・脚質・末脚は平均扱いなので、この結果は騎手・枠・自分の補正の差だけで決まっています。馬名をタップして血統や調教師を見て、「自分の補正」を入れてから計算し直すのがおすすめです。`));
      } else if (res.noData) {
        warn.push(el("p", "sim-warn", `前走データがない馬が${res.noData}頭います。その馬は平均扱いで計算しています。`));
      }
      const head = el("p", "sim-head",
        `${res.course}・馬場${res.going}${res.goingNote ? `（${res.goingNote}）` : ""}${res.bias ? `・馬場の傾向 ${res.bias}` : ""}・ペース予想 ${res.pace}（逃げ${res.nige}頭・先行${res.sen}頭）・${res.sims.toLocaleString()}回`);
      const wrap = el("div", "sim-wrap");
      const table = el("table", "sim-table");
      const thead = el("thead");
      const htr = el("tr");
      // 結果が出ているレースは、着順の列と的中の早見を足す
      const rv = reviewOf(r);
      const placeNum = (num) => placeOf(rv, num);
      ["予想", "馬番", "馬名・脚質", "勝率", "連対", "複勝"].forEach((t) => htr.append(Object.assign(el("th", t === "連対" ? "s-top2" : "", t), { scope: "col" })));
      thead.append(htr);
      const tbody = el("tbody");
      const maxW = Math.max(...res.rows.map((x) => x.win)) || 1;
      res.rows.forEach((x) => {
        const p = rv ? placeNum(x.h.num) : null;
        const tr = el("tr", p && p <= 3 ? "s-hit" : "");
        const nm = el("td", "s-name");
        const sub = el("span", "h-sub", [window.RaceSim.STYLE_NAMES[x.h.style], ...x.h.notes].join("・"));
        sub.title = sub.textContent;
        nm.append(el("span", "h-name-plain", x.h.name), sub);
        const w = el("td", "s-num");
        const bar = el("span", "s-bar");
        bar.append(Object.assign(el("i"), { style: `width:${(x.win / maxW * 100).toFixed(0)}%` }));
        w.append(bar, document.createTextNode(pct(x.win)));
        const num = el("td");
        num.append(el("span", `waku waku-${x.h.waku || 0}`, x.h.num));
        if (rv) num.append(el("span", `h-place${p && p <= 3 ? " top" : ""}`, p ? `${p}着` : "—"));
        tr.append(el("td", "s-mark", x.mark), num, nm, w, el("td", "s-num s-top2", pct(x.top2)), el("td", "s-num", pct(x.top3)));
        tbody.append(tr);
      });
      table.append(thead, tbody);
      wrap.append(table);
      const use = Object.assign(el("button", "sim-use"), { type: "button", textContent: "この予想印を自分の印にする" });
      use.addEventListener("click", () => {
        const v = yosoOf(r);
        v.m = {};
        res.rows.forEach((x) => { if (x.mark) v.m[x.h.num] = x.mark; });
        saveYoso(r, v);
        renderList();
        const card = document.getElementById(`r-${r.key}`);
        if (card) { card.querySelector(".race-head").click(); card.scrollIntoView({ block: "start" }); }
      });
      const note = el("p", "sim-note", "前走〜4走前の着差・クラス・通過順・上がりから能力と脚質を出し、コースと馬場の補正をかけて走らせています。オッズと人気は使っていません。勝率は実際の結果で検証した数字ではないので、馬同士の順番と差の目安として見てください。");
      const check = rv ? resultCheck(rv, res.rows.map((x) => x.h.num)) : null;
      out.replaceChildren(head, ...warn, ...(check ? [check] : []), wrap, use, betBar(r, res), note);
    }, 30);
  }

  // シミュレーションの印で買っていたら当たったか（結果が出ているレースだけ）
  function resultCheck(rv, order) {
    const pl = (n) => placeOf(rv, n) || 99;
    const [a, b, c] = order;
    const top3 = rv.result.slice(0, 3).map((x) => x.number);
    const box5 = order.slice(0, 5);
    const items = [
      ["単勝◎", pl(a) === 1],
      ["複勝◎", pl(a) <= 3],
      ["馬連◎○", pl(a) <= 2 && pl(b) <= 2],
      ["ワイド◎○", pl(a) <= 3 && pl(b) <= 3],
      ["3連複◎○▲", top3.length === 3 && top3.every((n) => [a, b, c].includes(n))],
      ["3連複 印5頭BOX", top3.length === 3 && top3.every((n) => box5.includes(n))],
    ];
    const box = el("div", "sim-result");
    box.append(el("p", "sim-result-head", `結果　${rv.result.slice(0, 3).map((x) => `${x.place}着 ${circled(x.number)}`).join("　")}`));
    const list = el("div", "sim-result-list");
    for (const [name, hit] of items) list.append(el("span", `sim-result-item${hit ? " hit" : ""}`, `${name} ${hit ? "的中" : "×"}`));
    box.append(list);
    return box;
  }

  function renderRace(r) {
    const node = $("race-tpl").content.firstElementChild.cloneNode(true);
    node.id = `r-${r.key}`;
    node.querySelector(".plate-venue").textContent = r.venue;
    node.querySelector(".plate-num").textContent = r.number;
    node.querySelector(".race-name").textContent = raceTitle(r);
    const pill = node.querySelector(".pill");
    if (r.label) { pill.textContent = r.label; pill.classList.add(pillClass(r.label)); }
    const babaNow = () => yosoOf(r).baba || {};
    const refreshTags = () => {
      const b = babaNow();
      node.querySelector(".race-tags").replaceChildren(...tags(Object.assign({}, r, { going: b.going || r.going })));
      if (b.going && b.going !== r.going) {
        node.querySelectorAll(".race-tags .tag").forEach((x) => { if (x.textContent.startsWith("馬場")) x.textContent += "（入力）"; });
      }
      const bs = biasOf(r);
      if (bs && bs.races) {
        node.querySelector(".race-tags").append(el("span", `tag tag-bias${bs.label === "目立った傾向なし" ? "" : " on"}`, `傾向 ${bs.label}（${bs.races}R）`));
      }
    };
    refreshTags();
    const rv = reviewOf(r);
    if (rv && rv.sim) {
      const hon = rv.sim[0];
      const p = placeOf(rv, hon.num);
      node.querySelector(".race-title").append(el("span", `rv-chip${p && p <= 3 ? " hit" : ""}`, `◎${circled(hon.num)} ${p ? `${p}着` : "—"}`));
    }
    if (rv) {
      const box = el("div", "rv-race");
      const top = rv.result.slice(0, 3).map((x) => `${x.place}着 ${circled(x.number)}${x.popularity ? `（${x.popularity}人気）` : ""}`).join("　");
      box.append(el("p", "rv-line", `結果　${top}`));
      if (rv.sim) {
        box.append(el("p", "rv-line", `シミュレーション　${rv.sim.slice(0, 5).map((x) => `${x.mark}${circled(x.num)} ${placeOf(rv, x.num) || "—"}着`).join("　")}`));
      } else if (rv.note) {
        box.append(el("p", "rv-line", `シミュレーション　対象外（${rv.note}）`));
      }
      const m = yosoOf(r).m;
      const mine = MARK_CYCLE.slice(1).flatMap((mk) => Object.keys(m).filter((n) => m[n] === mk).map((n) => `${mk}${circled(+n)} ${placeOf(rv, +n) || "—"}着`));
      if (mine.length) box.append(el("p", "rv-line", `自分の印　${mine.join("　")}`));
      node.querySelector(".race-detail").prepend(box);
    }
    const horses = r.horses || [];
    const marks = markSummary(r);
    node.querySelector(".more").textContent = marks ? `印 ${marks}` : (horses.length ? `出走馬を見る（${horses.length}頭）` : "詳しく見る");
    node.querySelector(".score-target .score-val").textContent = r.target;
    node.querySelector(".score-chaos .score-val").textContent = r.chaos;
    node.querySelector(".score-target .meter i").style.width = `${r.target}%`;
    node.querySelector(".score-chaos .meter i").style.width = `${r.chaos}%`;

    const wrap = node.querySelector(".horses-wrap");
    const tbody = node.querySelector(".horses tbody");
    const fillHorses = () => {
      tbody.replaceChildren(...[...horses].sort((a, b) => a.number - b.number).flatMap((h) => horseRow(h, r, () => {
        fillHorses();
        const m = markSummary(r);
        node.querySelector(".more").textContent = m ? `印 ${m}` : `出走馬を見る（${horses.length}頭）`;
      })));
    };
    if (horses.length) {
      fillHorses();
    } else {
      wrap.replaceChildren(el("p", "h-empty", "出走馬はまだ読み取れていません"));
    }

    const mkt = r.market_chaos == null ? "未取得" : r.market_chaos;
    const gap = r.gap == null ? "—" : (r.gap > 0 ? "+" : "") + r.gap.toFixed(2);
    node.querySelector(".split").textContent = `荒れ度の内訳: 条件 ${r.condition_chaos} / オッズ ${mkt}　ズレ ${gap}`;
    const reasons = r.reasons.length ? r.reasons : ["目立つ要素はありません"];
    node.querySelector(".reasons").replaceChildren(...reasons.map((t) => el("li", "", t)));

    // 馬場の入力（シミュレーション用。この端末に保存）
    const babaBox = node.querySelector(".baba");
    const seg = babaBox.querySelector(".baba-seg");
    const isDirt = r.surface === "ダート";
    const saveBaba = (patch) => { const y = yosoOf(r); y.baba = Object.assign({}, y.baba, patch); saveYoso(r, y); refreshTags(); };
    ["", "良", "稍重", "重", "不良"].forEach((g) => {
      const b = Object.assign(el("button", "", g || `JRA発表（${r.going || "未発表"}）`), { type: "button" });
      b.setAttribute("aria-pressed", String((babaNow().going || "") === g));
      b.addEventListener("click", () => {
        saveBaba({ going: g });
        seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      });
      seg.append(b);
    });
    const num = babaBox.querySelector(".baba-num");
    num.id = `baba-${r.key}`;
    babaBox.querySelector(".baba-num-label").textContent = isDirt ? "含水率（%・任意）" : "クッション値（任意）";
    babaBox.querySelector(".baba-num-label").htmlFor = num.id;
    num.placeholder = isDirt ? "例 8.5" : "例 9.5";
    num.value = (isDirt ? babaNow().moist : babaNow().cushion) || "";
    num.addEventListener("change", () => saveBaba(isDirt ? { moist: num.value.trim() } : { cushion: num.value.trim() }));
    const jraBits = [];
    if (r.cushion != null) jraBits.push(`クッション値 ${r.cushion}`);
    if (r.moist) jraBits.push(`含水率 ゴール前${r.moist[0]}%・4コーナー${r.moist[1]}%`);
    const jraLine = jraBits.length ? `JRA発表：${jraBits.join("／")}${r.baba_time ? `（${r.baba_time}）` : ""}` : "";
    if (!isDirt && r.cushion != null) num.placeholder = `JRA ${r.cushion}`;
    babaBox.querySelector(".baba-hint").textContent = [jraLine, isDirt
      ? "含水率は競馬場ごとに基準が違うので、自動では計算に使いません。入れたときだけ、馬場状態より優先して計算します（数字が大きいほど脚抜けが良く前が止まりにくい）。"
      : "クッション値は入れなければJRA発表の値で計算します。10.5以上で硬め（上がりが出やすい）、8以下で軟らかめ（時計がかかり荒れやすい）。"].filter(Boolean).join("　");
    if (r.surface === "障害") babaBox.hidden = true;

    const refreshBtn = node.querySelector(".refresh-btn");
    refreshBtn.addEventListener("click", () => refreshRace(r, node.querySelector(".refresh-msg"), refreshBtn));

    const simBtn = node.querySelector(".sim-btn");
    if (!horses.length || r.surface === "障害") simBtn.disabled = true;
    simBtn.addEventListener("click", () => renderSim(r, node.querySelector(".sim-out")));

    const memo = node.querySelector(".memo textarea");
    memo.id = `memo-${r.key}`;
    memo.value = yosoOf(r).memo || "";
    memo.addEventListener("input", () => { const v = yosoOf(r); v.memo = memo.value; saveYoso(r, v); });

    const head = node.querySelector(".race-head");
    const detail = node.querySelector(".race-detail");
    head.addEventListener("click", () => {
      const open = head.getAttribute("aria-expanded") === "true";
      head.setAttribute("aria-expanded", String(!open));
      detail.hidden = open;
    });
    return node;
  }

  function sorted(races) {
    const list = races.filter((r) => state.venue === "すべて" || r.venue === state.venue);
    const byNum = (a, b) => a.venue.localeCompare(b.venue, "ja") || a.number - b.number;
    if (state.sort === "number") return list.sort((a, b) => (a.post_time || "").localeCompare(b.post_time || "") || byNum(a, b));
    return list.sort((a, b) => b[state.sort] - a[state.sort] || byNum(a, b));
  }

  function renderList() {
    document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.sort === state.sort)));
    document.querySelectorAll("#venues button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.venue === state.venue)));
    const list = sorted(state.day.races);
    const ul = $("races");
    if (!list.length) {
      ul.replaceChildren(el("li", "empty", "この条件のレースはありません"));
      return;
    }
    ul.replaceChildren(...list.map(renderRace));
  }

  function renderOddsToggle() {
    document.body.classList.toggle("hide-odds", !state.showOdds);
    const b = $("odds-toggle");
    b.setAttribute("aria-pressed", String(state.showOdds));
    b.textContent = state.showOdds ? "オッズ表示中" : "オッズを隠しています";
  }

  function renderTop(races) {
    const top = [...races].sort((a, b) => b.target - a.target).filter((r) => r.target > 0).slice(0, 3);
    $("top").hidden = !top.length;
    $("top-list").replaceChildren(...top.map((r) => {
      const li = document.createElement("li");
      const a = Object.assign(document.createElement("a"), { href: `#r-${r.key}` });
      a.append(
        el("span", "t-race", `${r.venue}${r.number}R`),
        el("span", "t-sub", r.label || (r.favorites[0] ? `得意: ${r.favorites[0]}` : raceTitle(r))),
        el("span", "t-score", `狙い目 ${r.target}`),
      );
      li.append(a);
      return li;
    }));
  }

  function renderVenues(races) {
    const venues = ["すべて", ...new Set(races.map((r) => r.venue))];
    if (!venues.includes(state.venue)) state.venue = "すべて";
    $("venues").replaceChildren(...venues.map((v) => {
      const b = Object.assign(document.createElement("button"), { type: "button", textContent: v });
      b.dataset.venue = v;
      b.addEventListener("click", () => { state.venue = v; renderList(); });
      return b;
    }));
  }

  async function loadDay(dateStr) {
    const env = await getJSON(dateStr ? `data/days/${dateStr}.json` : "data/latest.json");
    const day = await decrypt(env, state.password);
    // レース後に自動で比べた結果（keiba evaluate）。まだなければ null
    try {
      day.review = await decrypt(await getJSON(`data/results/${day.date}.json`), state.password);
    } catch (_) {
      day.review = null;
    }
    return day;
  }

  // ---- 開催中の馬場の傾向（前日と当日の終わったレースから。keiba/bias.py）
  const biasOf = (r) => ((state.day && state.day.bias) || {})[`${r.venue}|${r.surface}`] || null;

  // ---- 予想と結果（レース後の比較）
  const reviewOf = (r) => (state.day.review ? state.day.review.races.find((x) => x.key === r.key) : null);
  const circled = (n) => (n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `(${n})`);
  function placeOf(rv, num) {
    const x = rv && rv.result.find((y) => y.number === num);
    return x ? x.place : null;
  }
  function renderReview(day) {
    const box = $("review");
    const rv = day.review;
    box.hidden = !rv;
    if (!rv) return;
    const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "—");
    const g = rv.groups["全体"] || {};
    // 自分の印（この端末に保存したもの）
    let myN = 0, myWin = 0, myTop3 = 0, markN = 0, markTop3 = 0;
    for (const r of day.races) {
      const x = rv.races.find((y) => y.key === r.key);
      if (!x) continue;
      const m = yosoOf(r).m;
      const hon = Object.keys(m).find((n) => m[n] === "◎");
      if (hon) { myN++; const p = placeOf(x, +hon); if (p === 1) myWin++; if (p && p <= 3) myTop3++; }
      for (const n of Object.keys(m)) { if (m[n] && m[n] !== "✕") { markN++; const p = placeOf(x, +n); if (p && p <= 3) markTop3++; } }
    }
    const table = el("table", "rv-table");
    table.append(el("tr", "", ""));
    table.firstChild.append(el("th", "", ""), el("th", "", "1着"), el("th", "", "3着以内"), el("th", "", "レース数"));
    const row = (name, a, b, n) => { const tr = el("tr"); tr.append(el("th", "", name), el("td", "", a), el("td", "", b), el("td", "", String(n))); table.append(tr); };
    row("シミュレーションの◎", pct(g.honWin || 0, g.n), pct(g.honTop3 || 0, g.n), g.n || 0);
    row("1番人気", pct(g.favWin || 0, g.favN), pct(g.favTop3 || 0, g.favN), g.favN || 0);
    if (myN) row("自分の◎", pct(myWin, myN), pct(myTop3, myN), myN);
    const lines = [
      `3連複（印の上位5頭のボックス）：シミュレーション ${pct(g.trio5 || 0, g.n)}　人気上位5頭 ${pct(g.popTrio5 || 0, g.favN)}`,
    ];
    if (markN) lines.push(`自分が印（✕以外）を付けた馬 ${markN}頭のうち、3着以内 ${markTop3}頭（${pct(markTop3, markN)}）`);
    const cal = el("table", "rv-table");
    const ch = el("tr");
    ch.append(el("th", "", "複勝率の予想"), el("th", "", "馬の数"), el("th", "", "予想の平均"), el("th", "", "実際"));
    cal.append(ch);
    for (const c of rv.calib.filter((c) => c.n)) {
      const tr = el("tr");
      tr.append(el("th", "", `${Math.round(c.lo * 100)}〜${Math.round(Math.min(c.hi, 1) * 100)}%`), el("td", "", String(c.n)),
        el("td", "", pct(c.pred, c.n)), el("td", "", pct(c.hit, c.n)));
      cal.append(tr);
    }
    box.replaceChildren(
      el("h2", "eyebrow", "予想と結果"),
      el("p", "rv-meta", `${fmtTime(rv.evaluated_at)} に JRA公式サイトの着順と比べました。シミュレーションはレース後に同じ計算で出し直したもので、自分の補正・調教・手で入れた馬場は入っていません。`),
      table,
      ...lines.map((t) => el("p", "rv-line", t)),
      el("p", "rv-sub", "シミュレーションの複勝率は当てになるか（予想の平均と実際が近いほど信頼できる）"),
      cal,
    );
  }

  function showDay(day) {
    state.day = day;
    $("date").value = day.date;
    const status = state.status;
    $("meta").textContent = `${fmtDate(day.date)}・${fmtTime(day.generated_at)} 更新・${day.races.length}レース`;
    $("notice").hidden = true;
    if (day.sample) {
      notice("sample", ["これは動作確認用の架空データです。実在のレース・馬・オッズではありません。"]);
    } else if (status && status.state === "error" && status.date >= day.date) {
      notice("err", [`${fmtTime(status.checked_at)} の取得に失敗しました: ${status.message}`, "前回取得したデータを表示しています。"]);
    } else if (day.warnings && day.warnings.length) {
      notice("warn", day.warnings);
    }
    $("lock").hidden = true;
    $("content").hidden = false;
    renderReview(day);
    // まとめて最新にするのは、今日のレースを見ているときだけ
    $("batch").hidden = day.date !== new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    renderTop(day.races);
    renderVenues(day.races);
    renderOddsToggle();
    renderList();
  }

  function showLock(message) {
    $("content").hidden = true;
    $("lock").hidden = false;
    $("meta").textContent = "パスワードで保護されています";
    const err = $("lock-error");
    err.textContent = message || "";
    err.hidden = !message;
  }

  async function unlock(password, remember) {
    state.password = password;
    // 前日昼に翌日分を取り込むので、当日のレースが終わる17時までは当日分を先に開く
    const now = new Date(Date.now() + 9 * 3600e3);
    const today = now.toISOString().slice(0, 10);
    const first = state.dates.includes(today) && now.getUTCHours() < 17 ? today : null;
    const day = await loadDay(first);     // 違えば WrongPassword
    if (remember) store.set("pw", password); else store.del("pw");
    showDay(day);
  }

  async function init() {
    document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
      state.sort = b.dataset.sort;
      store.set("sort", state.sort);
      renderList();
    }));
    setupBatchRefresh();
    $("token-save").addEventListener("click", async () => {
      const v = $("gh-token").value.trim();
      if (!v) { $("token-msg").textContent = "合鍵を貼り付けてから押してください"; return; }
      store.set("ghToken", v);
      $("gh-token").value = "";
      $("token-msg").textContent = "確認しています…";
      try {
        if (!GH.api) throw new Error("公開ページ（github.io）でだけ確認できます");
        await gh("/actions/workflows/refresh.yml");
        $("token-msg").textContent = "保存しました（読み取りは確認済み）。各レースの「このレースを最新にする」を押すと、書き込み権限も確かめます。";
      } catch (e) {
        $("token-msg").textContent = `保存しましたが、確認できませんでした：${e.message}`;
      }
    });
    $("token-clear").addEventListener("click", () => {
      store.del("ghToken");
      $("token-msg").textContent = "合鍵を消しました";
    });
    $("token-msg").textContent = token() ? "合鍵は保存済みです" : "まだ合鍵が保存されていません";

    $("odds-toggle").addEventListener("click", () => {
      state.showOdds = !state.showOdds;
      store.set("showOdds", state.showOdds ? "1" : "0");
      renderOddsToggle();
    });
    $("lock").addEventListener("submit", async (e) => {
      e.preventDefault();
      $("unlock").disabled = true;
      try {
        await unlock($("password").value, $("remember").checked);
        $("password").value = "";
      } catch (err) {
        showLock(err instanceof WrongPassword ? "パスワードが違います。もう一度入れてください。" : `読み込めませんでした（${err.message}）`);
      } finally {
        $("unlock").disabled = false;
      }
    });

    const [dates, status] = await Promise.all([
      getJSON("data/dates.json").catch(() => []),
      getJSON("data/status.json").catch(() => null),
    ]);
    state.status = status;
    state.dates = dates;
    const sel = $("date");
    sel.replaceChildren(...dates.map((d) => Object.assign(document.createElement("option"), { value: d, textContent: fmtDate(d) })));
    sel.hidden = dates.length < 2;
    sel.addEventListener("change", () => loadDay(sel.value).then(showDay).catch(fail));

    if (!dates.length) {
      $("meta").textContent = "データがまだありません";
      notice(status && status.state === "error" ? "err" : "warn",
        status && status.state === "error"
          ? [`${fmtTime(status.checked_at)} の取得に失敗しました: ${status.message}`]
          : ["最初の開催日の朝に自動で更新されます。"]);
      return;
    }

    const saved = store.get("pw");
    if (!saved) { showLock(); return; }
    try {
      await unlock(saved, true);
    } catch (err) {
      if (err instanceof WrongPassword) { store.del("pw"); showLock("パスワードが変わったようです。入れ直してください。"); }
      else fail(err);
    }
  }

  function fail(e) {
    notice("err", [`データを読み込めませんでした（${e.message}）。時間をおいて再読み込みしてください。`]);
  }

  init();
})();
