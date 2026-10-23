"""JRAのページ構成を調べるための調査用コマンド。

リンクの文字と cname、見出し付近の文字だけをログに出す（オッズ表などの中身は出さない）。
  python -m keiba.probe --date YYYY-MM-DD
"""
from __future__ import annotations

import argparse
import re
from collections import Counter
from datetime import date

from . import jra, parse
from .__main__ import contact, load_config
from .fetch import Fetcher


def show_actions(title: str, acts: list[parse.Action], limit: int = 60) -> None:
    print(f"\n=== {title}: {len(acts)} 件 ===")
    print("cname 先頭7文字の内訳:", Counter(a.cname[:7] for a in acts).most_common(10))
    for a in acts[:limit]:
        print(f"  {a.path:22} {a.cname:45} text={a.text[:30]!r} ctx={a.context[:60]!r}")


def markup_near_first_action(html: str, chars: int = 600) -> None:
    m = parse.DOACTION_RE.search(html)
    if m:
        start = max(0, m.start() - chars // 2)
        print("\n--- 最初のリンク付近のHTML ---")
        print(re.sub(r"\s+", " ", html[start:start + chars]))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--date", required=True)
    day = date.fromisoformat(p.parse_args().date)
    cfg = load_config()
    f = Fetcher(contact(cfg), cfg["fetch"]["delay_sec"], 40)

    race_day, entry_d, entry_o, top = jra.is_race_day(f, day)
    print("入口:", entry_d, entry_o, "開催日:", race_day)
    show_actions("出馬表トップ", parse.extract_actions(top), 30)

    days = jra._day_actions(top, "accessD.html", day)
    if not days:
        return
    page = f.post_cname(days[0].path, days[0].cname)
    print("\n開催ページの見出し:", parse.page_text(page)[:300])
    acts = parse.extract_actions(page)
    show_actions("開催ページ", acts)
    markup_near_first_action(page)

    soup = parse.BeautifulSoup(page, "html.parser")
    nums = soup.find_all(class_="race_num")
    print(f"\nrace_num の要素: {len(nums)} 件")
    for el in nums[:2]:
        row = el.find_parent("tr") or el.parent.parent
        print("\n--- レース行のHTML ---")
        print(re.sub(r"\s+", " ", str(row))[:2500])
    print("\nJRADB への href:", sorted(set(re.findall(r'href="([^"]*JRADB[^"]*)"', page)))[:20])

    otop = f.post_cname(*entry_o)
    print("\nオッズトップの本文:", parse.page_text(otop)[1500:2300])
    i = otop.find("東京")
    print("\n--- オッズトップの「東京」付近のHTML ---")
    print(re.sub(r"\s+", " ", otop[max(0, i - 800):i + 800]))

    baba = f.get("/keiba/baba/")
    print("\n馬場ページ:", parse.parse_venue(parse.page_text(baba)), parse.parse_going(parse.page_text(baba)))
    print("馬場ページの href（index を含む）:", sorted(set(re.findall(r'href="([^"]*index[^"]*)"', baba))))
    i = baba.find("京都")
    print("馬場ページの「京都」付近:", re.sub(r"\s+", " ", baba[max(0, i - 300):i + 300]))
    print("\nリクエスト数:", f.count)


if __name__ == "__main__":
    main()
