"""JRA公式サイトへの丁寧なアクセス。

- robots.txt に従う（読めないときは取得しない）
- 連絡先入りの User-Agent
- リクエスト間に待ち時間、1回の実行あたりの上限
"""
from __future__ import annotations

import re
import time
from urllib import robotparser

import requests

BASE = "https://www.jra.go.jp"


class FetchError(RuntimeError):
    pass


def decode_html(content: bytes, header_encoding: str | None) -> str:
    m = re.search(rb'charset=["\']?([A-Za-z0-9_\-]+)', content[:2048])
    enc = m.group(1).decode() if m else (header_encoding or "utf-8")
    if enc.lower() in ("shift_jis", "sjis", "x-sjis"):
        enc = "cp932"
    return content.decode(enc, errors="replace")


class Fetcher:
    def __init__(self, contact: str, delay: float = 2.0, max_requests: int = 150,
                 session: requests.Session | None = None):
        self.delay = delay
        self.max_requests = max_requests
        self.count = 0
        self._last = 0.0
        self.s = session or requests.Session()
        self.ua = f"keiba-morning-analysis/0.1 (+{contact})"
        self.s.headers["User-Agent"] = self.ua
        self.robots = self._load_robots()

    def _load_robots(self) -> robotparser.RobotFileParser:
        rp = robotparser.RobotFileParser()
        r = self._request("GET", "/robots.txt")
        if r.status_code == 404:
            rp.parse([])            # robots.txt が無い = 制限なし
        elif r.ok:
            rp.parse(decode_html(r.content, r.encoding).splitlines())
        else:
            raise FetchError(f"robots.txt を読めませんでした (HTTP {r.status_code})")
        return rp

    def _request(self, method: str, path: str, **kw) -> requests.Response:
        if self.count >= self.max_requests:
            raise FetchError(f"リクエスト上限 {self.max_requests} 件に達しました")
        wait = self._last + self.delay - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self.count += 1
        try:
            r = self.s.request(method, BASE + path, timeout=30, **kw)
        except requests.RequestException as e:
            raise FetchError(f"{path} に接続できませんでした: {e}") from e
        finally:
            self._last = time.monotonic()
        return r

    def _allowed(self, path: str) -> None:
        if not self.robots.can_fetch(self.ua, BASE + path):
            raise FetchError(f"robots.txt で禁止されているため取得しません: {path}")

    def get(self, path: str, encoding: str | None = None) -> str:
        """encoding を指定すると、ページ内の charset 表記がなくてもその文字コードで読む。"""
        self._allowed(path)
        r = self._request("GET", path)
        if not r.ok:
            raise FetchError(f"{path}: HTTP {r.status_code}")
        if encoding:
            return r.content.decode(encoding, errors="replace")
        return decode_html(r.content, r.encoding)

    def post_cname(self, path: str, cname: str) -> str:
        """JRADB のページ（doAction でフォーム送信されるページ）を取得する。"""
        self._allowed(path)
        r = self._request("POST", path, data={"cname": cname})
        if not r.ok:
            raise FetchError(f"{path} ({cname}): HTTP {r.status_code}")
        return decode_html(r.content, r.encoding)
