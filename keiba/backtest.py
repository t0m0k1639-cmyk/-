"""過去のレースでシミュレーションを検証する（バックテスト）。

JRA公式サイトの「過去のレース結果」から、月ごとの開催一覧 → 開催日 → 各レースの結果ページをたどり、
着順・通過順・上がり・タイム・馬体重・人気・払戻金を控える（2秒に1回、robots.txt に従う）。
過去の出馬表（前走〜4走前の欄）は残っていないので、控えた結果ページから馬ごとの成績を作り直し、
検証するレースより前の4走を、出馬表の前走欄と同じ形にしてシミュレーションに渡す。

控えは暗号化して data/backtest/races.json に置く（ページには載せない）。途中で止まっても続きから取れる。
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date
from pathlib import Path

from bs4 import BeautifulSoup

from . import jra, parse
from .crypto import decrypt, encrypt
from .fetch import FetchError, Fetcher

log = logging.getLogger(__name__)

CACHE = Path("backtest") / "races.json"
SEARCH = ("/JRADB/accessS.html", "pw01skl00999999/B3")


def load_cache(data_dir: Path, password: str) -> dict:
    p = data_dir / CACHE
    return decrypt(json.loads(p.read_text()), password) if p.exists() else {"races": {}, "days": []}


def save_cache(data_dir: Path, password: str, cache: dict) -> None:
    (data_dir / CACHE).parent.mkdir(parents=True, exist_ok=True)
    (data_dir / CACHE).write_text(json.dumps(encrypt(cache, password)))


def _sec(t: str | None) -> float | None:
    m = re.fullmatch(r"(?:(\d+):)?(\d+(?:\.\d)?)", (t or "").strip())
    return (int(m.group(1) or 0) * 60 + float(m.group(2))) if m else None


def month_codes(search_html: str) -> dict[str, str]:
    """過去のレース結果の検索ページにある月ごとのコード（objParam["2609"]="3B"）。"""
    return dict(re.findall(r'objParam\["(\d{4})"\]="(\w\w)"', search_html))


def day_actions(month_html: str) -> list[tuple[date, str, parse.Action]]:
    """月のページから (開催日, 競馬場, 開催日ページへのリンク)。cname の末尾8桁が日付。"""
    out = []
    for a in parse.extract_actions(month_html):
        m = re.match(r"pw01srl\w*?(\d{8})/", a.cname)
        venue = parse.parse_venue(a.text) or parse.parse_venue(a.context)
        if m and venue:
            d = date(int(m.group(1)[:4]), int(m.group(1)[4:6]), int(m.group(1)[6:]))
            out.append((d, venue, a))
    return out


def parse_result_day_rows(html: str) -> list[dict]:
    """結果の開催日ページのレース一覧（th.race_num / td.race_name / td.dist / td.course / td.num）。"""
    soup = BeautifulSoup(html, "html.parser")
    rows = []
    for th in soup.select("th.race_num"):
        a, tr = th.find("a", href=True), th.find_parent("tr")
        if a is None or tr is None:
            continue
        img = a.find("img")
        number = parse.parse_race_number(parse.norm(img.get("alt", "") if img else a.get_text(" ")))
        if number is None:
            continue
        cell = lambda c: parse.norm(tr.find("td", class_=c).get_text(" ")) if tr.find("td", class_=c) else ""
        name, course = cell("race_name"), cell("course")
        dist = tr.find("td", class_="dist")
        distance = parse._digits(dist.find(string=True, recursive=False) or dist.get_text(" ")) if dist else None
        surface = "障害" if ("障害" in name or "障害" in course) else ("ダート" if course.startswith("ダ") else "芝")
        rows.append({
            "number": number, "name": name, "race_class": parse.parse_conditions(name).get("race_class") or "",
            "surface": surface, "distance": distance, "link": a["href"],
        })
    return rows


def parse_result_runners(html: str) -> list[dict]:
    """結果ページの1頭ずつ（着順・枠・馬番・馬ID・馬名・性齢・斤量・騎手・タイム・通過順・上がり・馬体重・人気）。"""
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for tr in soup.select("table tr"):
        num, horse = tr.find("td", class_="num"), tr.find("td", class_="horse")
        if not (num and horse):
            continue
        n = parse._digits(parse.norm(num.get_text()))
        if n is None:
            continue
        cell = lambda c: parse.norm(tr.find("td", class_=c).get_text(" ")) if tr.find("td", class_=c) else ""
        place_t = cell("place")
        link = horse.find("a", href=True)
        m = re.search(r"CNAME=pw01dud\d{2}(\d{10})", link["href"]) if link else None
        waku_img = tr.select_one("td.waku img")
        bw = re.search(r"(\d{3})\s*\(\s*([+\-]?\d+)\s*\)", cell("h_weight"))
        kin = re.search(r"\d{2}\.\d", cell("weight"))
        f3 = re.search(r"\d{2}\.\d", cell("f_time"))
        corner = tr.find("td", class_="corner")
        out.append({
            "place": int(place_t) if place_t.isdigit() else None,
            "status": "" if place_t.isdigit() else place_t,          # 取消・除外・中止など
            "waku": parse._digits(waku_img.get("alt", "")) if waku_img else None,
            "number": n,
            "horse_id": m.group(1) if m else None,
            "name": parse.norm(link.get_text()) if link else cell("horse"),
            "sex_age": cell("age"),
            "kin": float(kin.group(0)) if kin else None,
            "jockey": cell("jockey"),
            "time": cell("time") or None,
            "corners": [int(t) for t in (parse.norm(li.get_text()) for li in corner.select("li")) if t.isdigit()] if corner else [],
            "last3f": float(f3.group(0)) if f3 else None,
            "body_weight": int(bw.group(1)) if bw else None,
            "body_weight_diff": int(bw.group(2)) if bw else None,
            "popularity": parse._digits(cell("pop")),
        })
    return out


def race_going(html: str, surface: str) -> str | None:
    g = parse.parse_going(parse.page_text(parse.main_part(html)))
    return g.get("ダート" if surface == "ダート" else "芝") or next(iter(g.values()), None)


def crawl(f: Fetcher, cache: dict, start: date, end: date) -> int:
    """start〜end の全レースの結果を控えに足す（控えにあるレースは飛ばす）。足したレース数を返す。"""
    codes = month_codes(f.post_cname(*SEARCH))
    added = 0
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        code = codes.get(f"{y % 100:02d}{m:02d}")
        if not code:
            log.warning("%d年%d月のコードがありません", y, m)
        else:
            for d, venue, act in day_actions(f.post_cname("/JRADB/accessS.html", f"pw01skl10{y}{m:02d}/{code}")):
                if not (start <= d <= end) or f"{d}|{venue}" in cache["days"]:
                    continue
                try:
                    rows = parse_result_day_rows(f.post_cname(act.path, act.cname))
                    for row in rows:
                        key = f"{d}|{venue}-{row['number']}"
                        if key in cache["races"]:
                            continue
                        html = jra._open(f, parse.Link(row.pop("link"), None, ""))
                        cache["races"][key] = dict(row, date=d.isoformat(), venue=venue,
                                                   going=race_going(html, row["surface"]),
                                                   runners=parse_result_runners(html),
                                                   payouts=parse.parse_payouts(html))
                        added += 1
                    cache["days"].append(f"{d}|{venue}")
                except FetchError as e:
                    if "上限" in str(e):
                        raise
                    log.warning("%s %s を取れませんでした: %s", d, venue, e)
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return added


def _past_record(race: dict, r: dict, winner_sec: float | None, heads: int) -> dict:
    d = date.fromisoformat(race["date"])
    sec = _sec(r["time"])
    return {
        "date": f"{d.year}年{d.month}月{d.day}日", "venue": race["venue"], "name": race["name"],
        "race_class": race["race_class"],
        "place": r["place"] if r["place"] is not None else (r["status"] or None),
        "heads": heads, "gate": r["number"], "jockey": r["jockey"], "weight": r["kin"],
        "distance": race["distance"], "surface": {"ダート": "ダ", "障害": "障"}.get(race["surface"], "芝"),
        "time": r["time"], "going": race["going"], "body_weight": r["body_weight"],
        "corners": r["corners"], "last3f": r["last3f"],
        "margin": 0.0 if r["place"] == 1 else (round(sec - winner_sec, 1) if sec and winner_sec else None),
    }


def horse_history(cache: dict) -> dict[str, list[tuple[str, dict]]]:
    """馬ID → [(日付, 前走欄と同じ形の1走), ...]（新しい順）。"""
    hist: dict[str, list[tuple[str, dict]]] = {}
    for race in cache["races"].values():
        runners = race["runners"]
        heads = len([r for r in runners if r["place"] is not None or r["status"] in ("中止", "失格")])
        win = next((r for r in runners if r["place"] == 1), None)
        winner_sec = _sec(win["time"]) if win else None
        for r in runners:
            if r["horse_id"] and r["status"] not in ("取消", "除外", "競走除外"):
                hist.setdefault(r["horse_id"], []).append((race["date"], _past_record(race, r, winner_sec, heads)))
    for v in hist.values():
        v.sort(key=lambda x: x[0], reverse=True)
    return hist


def build_eval_input(cache: dict, start: date, end: date) -> tuple[dict, dict]:
    """シミュレーションの検証（keiba/eval_sim.js）に渡す (日のデータ, 着順) を作る。

    レースの key は「2026-10-04|東京-11」。各馬の前走〜4走前は、そのレースより前の日付の結果だけから作る。
    """
    hist = horse_history(cache)
    races, results, payouts = [], {}, {}
    for key, race in sorted(cache["races"].items()):
        d = date.fromisoformat(race["date"])
        if not (start <= d <= end):
            continue
        horses = []
        for r in race["runners"]:
            past = [p for dd, p in hist.get(r["horse_id"], []) if dd < race["date"]][:4]
            prev_bw = next((p["body_weight"] for p in past if p["body_weight"]), None)
            horses.append({
                "number": r["number"], "waku": r["waku"], "name": r["name"], "sex_age": r["sex_age"],
                "weight": r["kin"], "jockey": r["jockey"], "popularity": r["popularity"], "past": past,
                "scratched": r["status"] in ("取消", "除外", "競走除外"),
                "body_weight": r["body_weight"], "body_weight_diff": r["body_weight_diff"],
            })
        races.append({
            "rkey": key, "date": race["date"], "venue": race["venue"], "number": race["number"],
            "name": race["name"], "race_class": race["race_class"], "surface": race["surface"],
            "distance": race["distance"], "going": race["going"], "horses": horses,
            "field_size": len([h for h in horses if not h["scratched"]]),
        })
        results[key] = sorted(({"place": r["place"], "number": r["number"], "popularity": r["popularity"],
                                "corners": r["corners"]} for r in race["runners"] if r["place"]),
                              key=lambda x: x["place"])
        payouts[key] = race["payouts"]
    return {"date": start.isoformat(), "races": races, "pedigree": {}, "payouts": payouts}, results
