"""他サイトの robots.txt と利用規約らしきページを読む調査用コマンド（自動取得してよいかの確認用）。

  python -m keiba.probe_site https://example.com
"""
from __future__ import annotations

import re
import sys

import requests
from bs4 import BeautifulSoup

UA = "keiba-analysis-check (terms check)"


def text_of(url: str) -> str:
    r = requests.get(url, headers={"User-Agent": UA}, timeout=20)
    r.encoding = r.apparent_encoding
    return f"[{r.status_code}] " + re.sub(r"\s+", " ", BeautifulSoup(r.text, "html.parser").get_text(" "))


def main() -> None:
    base = sys.argv[1].rstrip("/")
    r = requests.get(base + "/robots.txt", headers={"User-Agent": UA}, timeout=20)
    print("robots.txt:", r.status_code, r.text[:2000])
    top = requests.get(base + "/", headers={"User-Agent": UA}, timeout=20)
    top.encoding = top.apparent_encoding
    soup = BeautifulSoup(top.text, "html.parser")
    print("トップ:", top.status_code, re.sub(r"\s+", " ", soup.get_text(" "))[:800])
    links = {a.get("href") for a in soup.find_all("a") if re.search(r"規約|terms|tos|免責|ポリシー|policy|運営", (a.get_text() or "") + (a.get("href") or ""), re.I)}
    links |= {base + p for p in ("/terms", "/kiyaku", "/rule")}
    for href in sorted(h for h in links if h):
        url = href if href.startswith("http") else base + "/" + href.lstrip("/")
        try:
            t = text_of(url)
        except Exception as e:
            print(url, "読めず", e)
            continue
        print("\n---", url, "\n", t[:4000])
        for m in re.finditer(r".{0,120}(自動|スクレイピング|クロール|プログラム|複製|転載|二次利用|私的).{0,160}", t):
            print("  >>", m.group(0))


if __name__ == "__main__":
    main()
