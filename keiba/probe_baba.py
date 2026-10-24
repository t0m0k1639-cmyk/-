"""馬場情報の含水率・クッション値のデータファイルを調べる調査用コマンド。

  python -m keiba.probe_baba
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup

from . import parse
from .__main__ import contact, load_config
from .fetch import BASE, Fetcher


def raw_cp932(f: Fetcher, path: str) -> str:
    f._allowed(path)
    r = f._request("GET", path)
    return r.content.decode("cp932", errors="replace")


def main() -> None:
    cfg = load_config()
    f = Fetcher(contact(cfg), cfg["fetch"]["delay_sec"], 12)
    pages = {"index.html": f.get("/keiba/baba/")}
    for n in sorted(set(re.findall(r'href="(?:/keiba/baba/)?(index\d+\.html)"', pages["index.html"]))):
        pages[n] = f.get(f"/keiba/baba/{n}")
    for name, html in pages.items():
        text = parse.page_text(parse.main_part(html))
        refs = sorted(set(re.findall(r"_curRC\s*=\s*['\"]?(\w+)", html) + re.findall(r'id="(rc[A-Z])"', html)
                          + re.findall(r'data-rc="(\w+)"', html)))
        i = text.find("ゴール前と4コーナーの含水率")
        print(f"{name}: 競馬場={parse.parse_venue(text)} rc参照={refs} 本文の含水率={text[i:i + 60] if i >= 0 else ''}")
    js = f.get("/keiba/baba/_js/baba2025.js")
    for line in js.splitlines():
        if "_curRC" in line:
            print("JS:", line.strip()[:200])
    for fn in ("_data_cushion.html", "_data_moist.html"):
        soup = BeautifulSoup(raw_cp932(f, f"/keiba/baba/{fn}"), "html.parser")
        print(f"\n=== {fn} ===")
        for block in soup.find_all("div", id=re.compile(r"^rc[A-Z]$")):
            units = block.find_all("div", class_="unit", recursive=False)
            u = units[0] if units else None
            vals = " ".join(parse.norm(x.get_text(" ")) for x in u.find_all(["div", "span"]) if x.get("class") and x.get("class")[0] in ("time", "cushion", "mg", "m4c")) if u else ""
            print(f"{block['id']} title={block.get('title')!r} 件数={len(units)} 最新: {vals}")
    print("\nリクエスト数:", f.count)


if __name__ == "__main__":
    main()
