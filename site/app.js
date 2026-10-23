(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const state = { day: null, sort: "target", venue: "すべて", showOdds: true, password: null, status: null };

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
  const yosoOf = (r) => yoso[yosoKey(r)] || { m: {}, memo: "" };
  function saveYoso(r, v) {
    if (!Object.values(v.m).some(Boolean) && !v.memo) delete yoso[yosoKey(r)];
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
    const main = el("td", "h-main");
    const nameBtn = Object.assign(el("button", "h-name"), { type: "button", textContent: h.name });
    main.append(nameBtn);
    const sub = [h.sex_age, h.weight != null ? `${h.weight.toFixed(1)}kg` : null, h.jockey].filter(Boolean).join("・");
    main.append(el("span", "h-sub", h.scratched ? `取消・${sub}` : sub));
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
    const ul = el("ul", "past-list");
    if (past.length) ul.append(...past.map(pastLine));
    else ul.append(el("li", "", "前走のデータはありません（新馬など）"));
    td.append(ul);
    detail.append(td);
    nameBtn.setAttribute("aria-expanded", "false");
    nameBtn.addEventListener("click", () => {
      detail.hidden = !detail.hidden;
      nameBtn.setAttribute("aria-expanded", String(!detail.hidden));
    });
    return [tr, detail];
  }

  function pct(x) { return (x * 100).toFixed(1) + "%"; }

  function renderSim(r, out) {
    out.replaceChildren(el("p", "sim-run", "計算しています…"));
    setTimeout(() => {
      const res = window.RaceSim.simulate(Object.assign({ date: state.day.date }, r));
      if (res.error) { out.replaceChildren(el("p", "sim-err", res.error)); return; }
      const head = el("p", "sim-head",
        `${res.course}・馬場${res.going}・ペース予想 ${res.pace}（逃げ${res.nige}頭・先行${res.sen}頭）・${res.sims.toLocaleString()}回`);
      const wrap = el("div", "sim-wrap");
      const table = el("table", "sim-table");
      const thead = el("thead");
      const htr = el("tr");
      ["予想", "馬番", "馬名・脚質", "勝率", "連対", "複勝"].forEach((t) => htr.append(Object.assign(el("th", t === "連対" ? "s-top2" : "", t), { scope: "col" })));
      thead.append(htr);
      const tbody = el("tbody");
      const maxW = Math.max(...res.rows.map((x) => x.win)) || 1;
      res.rows.forEach((x) => {
        const tr = el("tr");
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
      out.replaceChildren(head, wrap, use, note);
    }, 30);
  }

  function renderRace(r) {
    const node = $("race-tpl").content.firstElementChild.cloneNode(true);
    node.id = `r-${r.key}`;
    node.querySelector(".plate-venue").textContent = r.venue;
    node.querySelector(".plate-num").textContent = r.number;
    node.querySelector(".race-name").textContent = raceTitle(r);
    const pill = node.querySelector(".pill");
    if (r.label) { pill.textContent = r.label; pill.classList.add(pillClass(r.label)); }
    node.querySelector(".race-tags").replaceChildren(...tags(r));
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
    return decrypt(env, state.password);
  }

  function showDay(day) {
    state.day = day;
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
    const day = await loadDay(null);     // 違えば WrongPassword
    if (remember) store.set("pw", password); else store.del("pw");
    showDay(day);
  }

  async function init() {
    document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
      state.sort = b.dataset.sort;
      store.set("sort", state.sort);
      renderList();
    }));
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
