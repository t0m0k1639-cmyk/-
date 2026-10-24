"""馬場情報ページ（含水率・クッション値）の構成を調べる調査用コマンド。

数字と見出しの周辺だけを出す。
  python -m keiba.probe_baba
"""
from __future__ import annotations

import re

from . import parse
from .__main__ import contact, load_config
from .fetch import Fetcher


def around(text: str, word: str, before: int = 40, after: int = 260) -> list[str]:
    return [text[max(0, m.start() - before):m.start() + after] for m in re.finditer(word, text)][:3]


def main() -> None:
    cfg = load_config()
    f = Fetcher(contact(cfg), cfg["fetch"]["delay_sec"], 10)
    first = f.get("/keiba/baba/")
    names = sorted(set(re.findall(r'href="(?:/keiba/baba/)?(index\d+\.html)"', first)))
    for i, html in enumerate([first] + [f.get(f"/keiba/baba/{n}") for n in names]):
        text = parse.page_text(parse.main_part(html))
        print(f"\n===== ページ{i} 競馬場: {parse.parse_venue(text)} 馬場: {parse.parse_going(text)} =====")
        for w in ("クッション値", "含水率"):
            for s in around(text, w):
                print(f"[{w}] {s}")
        if i == 0:
            # クッション値の数字がどこにあるか（画像・スクリプト・属性など）
            for m in re.finditer(r"(?i)cushion|クッション値", html):
                seg = re.sub(r"\s+", " ", html[max(0, m.start() - 150):m.start() + 350])
                if "基礎知識" not in seg:
                    print("--- クッション値付近のHTML ---", seg)
            print("script src:", re.findall(r'<script[^>]+src="([^"]+)"', html)[:20])
            for m in re.finditer(r"(?i)\.(json|xml|csv|js)\b[^\"']*", html):
                pass
            print("データファイルらしきもの:", sorted(set(re.findall(r'["\']([^"\']*(?:baba|cushion|moist)[^"\']*\.(?:json|xml|csv|js))["\']', html)))[:20])
    print("\nリクエスト数:", f.count)


if __name__ == "__main__":
    main()
