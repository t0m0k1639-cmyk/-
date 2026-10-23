"""JRAのページ構成を調べるための調査用コマンド。

読み取り結果と、見出し付近の短い HTML だけをログに出す（オッズ表などの中身は出さない）。
  python -m keiba.probe --date YYYY-MM-DD
"""
from __future__ import annotations

import argparse
import re
from datetime import date

from . import jra, parse
from .__main__ import contact, load_config
from .fetch import Fetcher


def snippet(html: str, word: str, chars: int = 1200) -> str:
    i = html.find(word)
    return "（見つからず）" if i < 0 else re.sub(r"\s+", " ", html[max(0, i - chars // 2):i + chars // 2])


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--date", required=True)
    day = date.fromisoformat(p.parse_args().date)
    cfg = load_config()
    f = Fetcher(contact(cfg), cfg["fetch"]["delay_sec"], 40)

    race_day, _, _, top = jra.is_race_day(f, day)
    print("開催日:", race_day)
    days = jra._day_actions(top, "accessD.html", day)
    print("開催:", [d.text for d in days])
    if not days:
        return
    page = f.post_cname(days[0].path, days[0].cname)
    rows = parse.parse_day_rows(page)
    print(f"\n{days[0].text}: {len(rows)} レース")
    for r in rows:
        print(" ", r.fields, "| 出馬表:", r.race_link and r.race_link.path[-40:],
              "| オッズ:", r.odds_link)
    odds_td = parse.BeautifulSoup(page, "html.parser").select("td.odds")
    print("\ntd.odds の例:", [re.sub(r"\s+", " ", str(t))[:300] for t in odds_td[:2]])

    for r in rows[:2] + [x for x in rows if x.fields.get("race_class") in ("G1", "G2", "G3")][:1]:
        html = jra._open(f, r.race_link)
        print(f"\n--- {r.fields['number']}R 出馬表 ---")
        print("parse_weight_rule:", parse.parse_weight_rule(html))
        for w in ("定量", "別定", "馬齢", "ハンデ"):
            if w in html:
                print(f"「{w}」付近:", snippet(html, w, 500))
                break

    if any(r.odds_link for r in rows):
        r = next(r for r in rows if r.odds_link)
        print("\nオッズ:", len(jra._odds(f, r.odds_link)), "頭分を読み取り")

    print("\n馬場:", jra.collect_going(f))
    print("\nリクエスト数:", f.count)


if __name__ == "__main__":
    main()
