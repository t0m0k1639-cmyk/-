"""JRA公式サイトの「過去のレース結果」がどこまで遡れるかを調べる調査用コマンド。

  python -m keiba.probe_past
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup

from . import parse
from .__main__ import contact, load_config
from .fetch import Fetcher
from .probe import masked


def main() -> None:
    cfg = load_config()
    f = Fetcher(contact(cfg), cfg["fetch"]["delay_sec"], 8)
    home = parse.extract_actions(f.get("/"))
    entry = next(((a.path, a.cname) for a in home if a.cname.startswith("pw01skl")), ("/JRADB/accessS.html", "pw01skl00999999/B3"))
    page = f.post_cname(*entry)
    soup = BeautifulSoup(page, "html.parser")
    years = sorted({int(y) for y in re.findall(r"(19[5-9]\d|20[0-3]\d)", " ".join(o.get_text() + " " + str(o.get("value", "")) for o in soup.find_all("option")))})
    print("年の選択肢:", years[:3], "…", years[-3:], "（", len(years), "年分）")
    acts = parse.extract_actions(page)
    print("リンク数:", len(acts), "例:", [(a.cname, masked(a.text, 40)) for a in acts[:8]])
    print("本文:", masked(parse.main_part(page), 2500))
    sel = soup.find("select")
    if sel:
        print("select:", masked(str(sel)[:1500], 1500))


if __name__ == "__main__":
    main()
