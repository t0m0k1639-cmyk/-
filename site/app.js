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
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(env.iv) }, key, fromB64(env.ct));
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (_) {
      throw new WrongPassword("パスワードが違います");
    }
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

  function horseRow(h) {
    const tr = el("tr", h.scratched ? "scratched" : "");
    const num = el("td", "h-num");
    num.append(el("span", `waku waku-${h.waku || 0}`, h.number));
    const main = el("td", "h-main");
    main.append(el("span", "h-name", h.name));
    const sub = [h.sex_age, h.weight != null ? `${h.weight.toFixed(1)}kg` : null, h.jockey].filter(Boolean).join("・");
    main.append(el("span", "h-sub", h.scratched ? `取消・${sub}` : sub));
    const odds = el("td", "col-odds h-odds");
    if (h.odds != null) {
      odds.append(el("span", "h-win", h.odds.toFixed(1)));
      if (h.popularity) odds.append(el("span", `h-pop${h.popularity <= 3 ? " top" : ""}`, `${h.popularity}人気`));
    } else {
      odds.append(el("span", "h-none", h.scratched ? "—" : "未発表"));
    }
    tr.append(num, main, odds);
    return tr;
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
    node.querySelector(".more").textContent = horses.length ? `出走馬を見る（${horses.length}頭）` : "詳しく見る";
    node.querySelector(".score-target .score-val").textContent = r.target;
    node.querySelector(".score-chaos .score-val").textContent = r.chaos;
    node.querySelector(".score-target .meter i").style.width = `${r.target}%`;
    node.querySelector(".score-chaos .meter i").style.width = `${r.chaos}%`;

    const wrap = node.querySelector(".horses-wrap");
    if (horses.length) {
      node.querySelector(".horses tbody").replaceChildren(...[...horses].sort((a, b) => a.number - b.number).map(horseRow));
    } else {
      wrap.replaceChildren(el("p", "h-empty", "出走馬はまだ読み取れていません"));
    }

    const mkt = r.market_chaos == null ? "未取得" : r.market_chaos;
    const gap = r.gap == null ? "—" : (r.gap > 0 ? "+" : "") + r.gap.toFixed(2);
    node.querySelector(".split").textContent = `荒れ度の内訳: 条件 ${r.condition_chaos} / オッズ ${mkt}　ズレ ${gap}`;
    const reasons = r.reasons.length ? r.reasons : ["目立つ要素はありません"];
    node.querySelector(".reasons").replaceChildren(...reasons.map((t) => el("li", "", t)));

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
