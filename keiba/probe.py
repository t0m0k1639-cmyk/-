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
    f = Fetcher(contact(cfg), cfg["fetch"]["delay_sec"], 20)

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

    html = jra._open(f, rows[0].race_link)
    soup = parse.BeautifulSoup(html, "html.parser")
    for table in soup.find_all("table"):
        if "馬名" not in table.get_text():
            continue
        print("\n=== 馬の表 ===")
        print("table の class:", table.get("class"))
        trs = table.find_all("tr")
        print("行数:", len(trs))
        for tr in trs[:3]:
            print("\n--- 行 ---")
            print(masked(str(tr)))
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
