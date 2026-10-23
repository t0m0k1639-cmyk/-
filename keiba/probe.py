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

    # 開催ページで最も多い cname の形をレースのリンクとみなして1つ開く
    common = Counter(a.cname[:7] for a in acts if a.cname != days[0].cname).most_common(1)
    if common:
        race = next(a for a in acts if a.cname.startswith(common[0][0]))
        html = f.post_cname(race.path, race.cname)
        text = parse.page_text(html)
        print("\nレースページの冒頭:", text[:500])
        print("header_part:", parse.header_part(text)[:500])
        print("parse_conditions:", parse.parse_conditions(parse.header_part(text)))
        print("parse_field_size:", parse.parse_field_size(html))
        print("race_name:", jra._race_name(html))
        classes = Counter(c for el in parse.BeautifulSoup(html, "html.parser").find_all(class_=True)
                          for c in el.get("class", []))
        print("class の多い順:", classes.most_common(40))

    otop = f.post_cname(*entry_o)
    show_actions("オッズトップ", parse.extract_actions(otop), 30)
    odays = jra._day_actions(otop, "accessO.html", day)
    if odays:
        opage = f.post_cname(odays[0].path, odays[0].cname)
        show_actions("オッズ開催ページ", parse.extract_actions(opage))

    baba = f.get("/keiba/baba/")
    print("\n馬場ページ:", parse.parse_venue(parse.page_text(baba)), parse.parse_going(parse.page_text(baba)))
    print("馬場ページ内リンク:", sorted(set(re.findall(r'href="(/keiba/baba/[^"]+)"', baba)))[:20])
    print("\nリクエスト数:", f.count)


if __name__ == "__main__":
    main()
