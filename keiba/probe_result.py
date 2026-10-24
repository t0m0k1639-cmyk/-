"""レース結果のページ構成を調べる調査用コマンド。

ログは公開されるので、HTML の構造だけを出し、日本語の文字は伏せ字にする。
  python -m keiba.probe_result --date YYYY-MM-DD
"""
from __future__ import annotations

import argparse
from datetime import date

from . import jra, parse
from .__main__ import contact, load_config
from .fetch import Fetcher
from .probe import masked


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--date", required=True)
    day = date.fromisoformat(p.parse_args().date)
    cfg = load_config()
    f = Fetcher(contact(cfg), cfg["fetch"]["delay_sec"], 12)

    home = parse.extract_actions(f.get("/"))
    print("トップのリンク:", [(a.path, a.cname) for a in home if "accessS" in a.path][:5])
    entry = next(((a.path, a.cname) for a in home if a.path.endswith("accessS.html")),
                 ("/JRADB/accessS.html", "pw01sli00/AF"))
    top = f.post_cname(*entry)
    days = jra._day_actions(top, "accessS.html", day)
    print("当日の開催:", [(a.cname, masked(a.text, 80)) for a in days])
    if not days:
        print("結果トップ:", masked(parse.main_part(top), 3000))
        return
    page = f.post_cname(days[0].path, days[0].cname)
    soup = parse.BeautifulSoup(page, "html.parser")
    tr = soup.select("table tr")
    print("開催ページの行数:", len(tr))
    for t in tr[:3]:
        print("行:", masked(str(t), 1200))
    a = soup.select_one("th.race_num a[href]")
    res = jra._open(f, parse.Link(a["href"], None, ""))
    rs = parse.BeautifulSoup(res, "html.parser")
    for t in rs.select("table"):
        print("\n表の class:", t.get("class"), "行数:", len(t.select("tr")))
        for r in t.select("tr")[:3]:
            print("行:", masked(str(r), 2000))


if __name__ == "__main__":
    main()
