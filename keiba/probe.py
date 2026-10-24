"""JRAのページ構成を調べるための調査用コマンド。

ログは公開されるので、HTML の構造だけを出し、日本語の文字は伏せ字にする。
  python -m keiba.probe --date YYYY-MM-DD
"""
from __future__ import annotations

import argparse
import re
from datetime import date

from . import jra, parse
from .__main__ import contact, load_config
from .fetch import Fetcher


def masked(html: str, limit: int = 3000) -> str:
    """タグと class は残し、2文字以上の日本語の並びを ◯ に置き換える。"""
    s = re.sub(r"\s+", " ", html)
    s = re.sub(r"[぀-ヿ一-鿿・ー]{2,}", lambda m: "◯" * len(m.group(0)), s)
    return s[:limit]


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--date", required=True)
    day = date.fromisoformat(p.parse_args().date)
    cfg = load_config()
    f = Fetcher(contact(cfg), cfg["fetch"]["delay_sec"], 24)

    _, _, _, top = jra.is_race_day(f, day)
    days = jra._day_actions(top, "accessD.html", day)
    if not days:
        print("開催なし")
        return
    page = f.post_cname(days[0].path, days[0].cname)
    rows = parse.parse_day_rows(page)
    print("td.odds:", [masked(str(t), 400) for t in
                       parse.BeautifulSoup(page, "html.parser").select("td.odds")[:2]])
    print("オッズのリンク:", [r.odds_link for r in rows[:2]])

    # 馬体重（発表済みの最初のレース）
    html1 = jra._open(f, rows[0].race_link)
    soup1 = parse.BeautifulSoup(html1, "html.parser")
    for cls in ("h_weight", "weight", "body_weight"):
        els = soup1.select(f"table .{cls}")[:3]
        if els:
            print(f"出馬表の .{cls}:", [masked(str(e), 300) for e in els])
    for m in list(re.finditer(r"\d{3}\s*(?:kg)?\s*[(（]\s*[+\-－±]?\d{1,2}\s*[)）]", parse.page_text(html1)))[:3]:
        print("馬体重らしき文字:", m.group(0))
    tr = soup1.select("table tr")[1:2]
    if tr:
        print("1頭目の行:", masked(str(tr[0]), 1500))
    if rows[0].odds_link:
        oh = jra._open(f, rows[0].odds_link)
        print("オッズページの h_weight:", [parse.norm(t.get_text(" ")) for t in parse.BeautifulSoup(oh, "html.parser").select("td.h_weight")][:5])

    # 前走欄の構造（3歳以上の条件戦の方が過去走が多い）
    target = next((r for r in rows if r.fields.get("race_class") in ("1勝クラス", "2勝クラス")), rows[0])
    html = jra._open(f, target.race_link)
    horses = parse.parse_horses(html)
    print("\nコース表記:", parse.parse_course_detail(html))
    print("前走の読み取り（馬番, 走数, 前走の着順・頭数・芝ダ・距離・上がり・着差・通過）:")
    for h in horses:
        p = h.past[0] if h.past else {}
        print(" ", h.number, len(h.past), [p.get(k) for k in ("place", "heads", "surface", "distance", "last3f", "margin", "corners")])
    print("単勝オッズ・人気の読み取り:", [(h.number, h.odds, h.popularity) for h in horses])
    soup = parse.BeautifulSoup(html, "html.parser")
    first = soup.select_one("td.horse")
    if first:
        nl = first.find(class_="name_line")
        print("馬名欄（オッズの位置確認）:", masked(str(nl or first), 1200))
    shown = 0
    for td in soup.select("td.past"):
        if len(td.get_text(strip=True)) < 10:
            continue
        print("\n--- 前走欄 ---")
        print(masked(str(td), 2500))
        shown += 1
        if shown >= 3:
            break

    if rows[0].odds_link:
        ohtml = jra._open(f, rows[0].odds_link)
        osoup = parse.BeautifulSoup(ohtml, "html.parser")
        print("\n=== オッズページ ===")
        print("parse_win_odds の件数:", len(parse.parse_win_odds(ohtml)))
        for t in osoup.find_all("table")[:2]:
            print("table の class:", t.get("class"))
            for tr in t.find_all("tr")[:3]:
                print(masked(str(tr), 1500))
    otop = f.post_cname(*jra.FALLBACK_ENTRY["オッズ"])
    t = parse.page_text(otop)
    i = t.find("今週のオッズ")
    print("\nオッズトップ:", t[i:i + 120] if i >= 0 else "（見出しなし）")
    print("オッズトップのリンク:", [(a.text, a.cname[:12]) for a in parse.extract_actions(otop)
                              if a.path.endswith("accessO.html")][:12])
    print("\nリクエスト数:", f.count)


if __name__ == "__main__":
    main()
