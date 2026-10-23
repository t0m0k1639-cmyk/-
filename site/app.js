(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const state = { day: null, sort: "target", venue: "すべて" };

  try {
    state.sort = localStorage.getItem("sort") || state.sort;
  } catch (_) { /* 保存できない環境では既定値のまま */ }

  async function getJSON(path) {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }

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

  function surfaceClass(s) {
    return s === "芝" ? "tag-turf" : s === "ダート" ? "tag-dirt" : s === "障害" ? "tag-jump" : "";
  }

  function tags(r) {
    const out = [];
    const add = (text, cls = "") => out.push(Object.assign(document.createElement("span"), { className: `tag ${cls}`, textContent: text }));
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

  function renderRace(r) {
    const node = $("race-tpl").content.firstElementChild.cloneNode(true);
    node.id = `r-${r.key}`;
    node.querySelector(".plate-venue").textContent = r.venue;
    node.querySelector(".plate-num").textContent = r.number;
    node.querySelector(".race-name").textContent = raceTitle(r);
    const pill = node.querySelector(".pill");
    if (r.label) { pill.textContent = r.label; pill.classList.add(pillClass(r.label)); }
    node.querySelector(".race-tags").replaceChildren(...tags(r));
    node.querySelector(".score-target .score-val").textContent = r.target;
    node.querySelector(".score-chaos .score-val").textContent = r.chaos;
    node.querySelector(".score-target .meter i").style.width = `${r.target}%`;
    node.querySelector(".score-chaos .meter i").style.width = `${r.chaos}%`;

    const mkt = r.market_chaos == null ? "未取得" : r.market_chaos;
    const gap = r.gap == null ? "—" : (r.gap > 0 ? "+" : "") + r.gap.toFixed(2);
    node.querySelector(".split").textContent = `荒れ度の内訳: 条件 ${r.condition_chaos} / オッズ ${mkt}　ズレ ${gap}`;
    const reasons = r.reasons.length ? r.reasons : ["目立つ要素はありません"];
    node.querySelector(".reasons").replaceChildren(...reasons.map((t) => Object.assign(document.createElement("li"), { textContent: t })));

    const jra = node.querySelector(".jra-link");
    if (r.jra_url) { jra.href = r.jra_url; jra.hidden = false; }

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
      ul.replaceChildren(Object.assign(document.createElement("li"), { className: "empty", textContent: "この条件のレースはありません" }));
      return;
    }
    ul.replaceChildren(...list.map(renderRace));
  }

  function renderTop(races) {
    const top = [...races].sort((a, b) => b.target - a.target).filter((r) => r.target > 0).slice(0, 3);
    $("top").hidden = !top.length;
    $("top-list").replaceChildren(...top.map((r) => {
      const li = document.createElement("li");
      const a = Object.assign(document.createElement("a"), { href: `#r-${r.key}` });
      a.append(
        Object.assign(document.createElement("span"), { className: "t-race", textContent: `${r.venue}${r.number}R` }),
        Object.assign(document.createElement("span"), { className: "t-sub", textContent: r.label || (r.favorites[0] ? `得意: ${r.favorites[0]}` : raceTitle(r)) }),
        Object.assign(document.createElement("span"), { className: "t-score", textContent: `狙い目 ${r.target}` }),
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

  async function showDay(dateStr, status) {
    const day = await getJSON(dateStr ? `data/days/${dateStr}.json` : "data/latest.json");
    state.day = day;
    $("meta").textContent = `${fmtDate(day.date)}・${fmtTime(day.generated_at)} 更新・${day.races.length}レース`;
    $("notice").hidden = true;
    const lines = [];
    if (day.sample) {
      notice("sample", ["これは動作確認用の架空データです。実在のレース・オッズではありません。"]);
    } else if (status && status.state === "error" && status.date >= day.date) {
      notice("err", [`${fmtTime(status.checked_at)} の取得に失敗しました: ${status.message}`, "前回取得したデータを表示しています。"]);
    } else if (day.warnings && day.warnings.length) {
      lines.push(...day.warnings);
      notice("warn", lines);
    }
    renderTop(day.races);
    renderVenues(day.races);
    renderList();
  }

  async function init() {
    document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
      state.sort = b.dataset.sort;
      try { localStorage.setItem("sort", state.sort); } catch (_) { /* 無視 */ }
      renderList();
    }));

    const [dates, status] = await Promise.all([
      getJSON("data/dates.json").catch(() => []),
      getJSON("data/status.json").catch(() => null),
    ]);
    const sel = $("date");
    sel.replaceChildren(...dates.map((d) => Object.assign(document.createElement("option"), { value: d, textContent: fmtDate(d) })));
    sel.hidden = dates.length < 2;
    sel.addEventListener("change", () => showDay(sel.value, null).catch(fail));

    try {
      await showDay(null, status);
    } catch (e) {
      $("meta").textContent = "データがまだありません";
      if (status && status.state === "error") {
        notice("err", [`${fmtTime(status.checked_at)} の取得に失敗しました: ${status.message}`]);
      } else {
        notice("warn", ["最初の開催日の朝に自動で更新されます。"]);
      }
    }
  }

  function fail(e) {
    notice("err", [`データを読み込めませんでした（${e.message}）。時間をおいて再読み込みしてください。`]);
  }

  init();
})();
