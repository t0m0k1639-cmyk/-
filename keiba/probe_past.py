"""JRA公式サイトの過去のレース結果（月ごとの開催一覧）と、馬の成績ページの作りを調べる調査用コマンド。

  python -m keiba.probe_past --month 2026-09 --date 2026-10-25
"""
from __future__ import annotations

import argparse
import re
from datetime import date

from bs4 import BeautifulSoup

from . import jra, parse
from .__main__ import contact, load_config
from .fetch import Fetcher
from .probe import masked


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--month", required=True)
    p.add_argument("--date", required=True)
    a = p.parse_args()
    y, m = a.month.split("-")
    cfg = load_config()
    f = Fetcher(contact(cfg), cfg["fetch"]["delay_sec"], 12)
    search = f.post_cname("/JRADB/accessS.html", "pw01skl00999999/B3")
    params = dict(re.findall(r'objParam\["(\d{4})"\]="(\w\w)"', search))
    for fn in re.findall(r"function\s+\w+\s*\([^)]*\)\s*\{[^}]*objParam[^}]*\}", search)[:2]:
        print("関数:", masked(fn, 800))
    code = params.get(y[2:] + m)
    print("月のコード:", y[2:] + m, code)
    for cname in (f"pw01skl10{y}{m}/{code}", f"pw01skl00{y}{m}/{code}"):
        try:
            page = f.post_cname("/JRADB/accessS.html", cname)
        except Exception as e:
            print(cname, "失敗", e)
            continue
        acts = [x for x in parse.extract_actions(page) if x.cname.startswith("pw01srl")]
        print(cname, "開催日のリンク:", len(acts), [(x.cname, masked(x.text, 30)) for x in acts[:4]])
        if acts:
            break

    # 馬の成績ページ（結果ページの馬名リンク）
    day = date.fromisoformat(a.date)
    top = f.post_cname("/JRADB/accessS.html", "pw01sli00/AF")
    d = jra._day_actions(top, "accessS.html", day)[0]
    row = parse.parse_day_rows(f.post_cname(d.path, d.cname))[5]
    res = BeautifulSoup(jra._open(f, row.race_link), "html.parser")
    href = res.select_one("td.horse a[href]")["href"]
    print("\n馬のリンク:", href)
    hp = BeautifulSoup(jra._open(f, parse.Link(href, None, "")), "html.parser")
    for t in hp.select("table"):
        trs = t.select("tr")
        print("\n表:", t.get("class"), "行数:", len(trs))
        for r in trs[:3]:
            print("行:", masked(str(r), 2500))


if __name__ == "__main__":
    main()
