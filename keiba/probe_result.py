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
    # 着順の表の見出しと最初の2頭（オッズの欄があるか）
    for th in rs.select("table thead tr")[:1]:
        print("\n見出し:", masked(str(th), 3000))
    for row in [t for t in rs.select("table tbody tr") if t.find("td", class_="num")][:2]:
        print("\n1頭:", masked(str(row), 3000))
    print("\nオッズへのリンク:", [masked(str(x), 300) for x in rs.find_all("a", href=True) if "odds" in x["href"].lower() or "pw15" in x["href"]][:5])
    # 払戻金の欄（class に refund / pay / harai を含む要素）
    import re
    for el in rs.find_all(class_=re.compile(r"refund|pay|harai", re.I))[:3]:
        print("\n払戻の要素:", el.name, el.get("class"))
        print(masked(str(el), 6000))


if __name__ == "__main__":
    main()
