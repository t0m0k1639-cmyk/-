"""JRA公式サイトから当日の全レースを集める。

出馬表・オッズは JRADB というページ群で、リンクは doAction('/JRADB/accessX.html', 'cname')
というフォーム送信になっている。cname は固定のURLを組み立てず、ページ内のリンクをたどって得る。
"""
from __future__ import annotations

import logging
import re
from datetime import date

from bs4 import BeautifulSoup

from . import parse
from .fetch import Fetcher
from .models import Race

log = logging.getLogger(__name__)

# トップページから見つからなかったときの入口（JRAサイトのメニューで使われている値）
FALLBACK_ENTRY = {
    "出馬表": ("/JRADB/accessD.html", "pw01dli00/F3"),
    "オッズ": ("/JRADB/accessO.html", "pw15oli00/6D"),
}


def _entry(home_actions: list[parse.Action], label: str, path_suffix: str) -> tuple[str, str]:
    for a in home_actions:
        if a.path.endswith(path_suffix) and label in a.text:
            return a.path, a.cname
    return FALLBACK_ENTRY[label]


def _day_actions(html: str, path_suffix: str, today: date) -> list[parse.Action]:
    ymd = today.strftime("%Y%m%d")
    return [a for a in parse.extract_actions(html)
            if a.path.endswith(path_suffix)
            and (parse.mentions_date(a.context, today.month, today.day) or ymd in a.cname)]


def _race_actions(html: str, path_suffix: str, visited: set[str]) -> dict[int, parse.Action]:
    out: dict[int, parse.Action] = {}
    for a in parse.extract_actions(html):
        if not a.path.endswith(path_suffix) or a.cname in visited:
            continue
        n = parse.parse_race_number(a.text)
        if n is not None and n not in out:
            out[n] = a
    return out


def _race_name(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for el in soup.find_all(class_=re.compile("race_name")):
        t = parse.norm(el.get_text(" "))
        if t:
            return t[:40]
    return ""


def is_race_day(f: Fetcher, today: date) -> tuple[bool, tuple[str, str], tuple[str, str], str]:
    home = parse.extract_actions(f.get("/"))
    entry_d = _entry(home, "出馬表", "accessD.html")
    entry_o = _entry(home, "オッズ", "accessO.html")
    top = f.post_cname(*entry_d)
    return bool(_day_actions(top, "accessD.html", today)), entry_d, entry_o, top


def collect_races(f: Fetcher, today: date, entry_d, top_d: str) -> list[Race]:
    races: list[Race] = []
    visited: set[str] = {entry_d[1]}
    for day in _day_actions(top_d, "accessD.html", today):
        visited.add(day.cname)
        page = f.post_cname(day.path, day.cname)
        day_venue = parse.parse_venue(day.context) or parse.parse_venue(parse.page_text(page))
        for num, a in sorted(_race_actions(page, "accessD.html", visited).items()):
            visited.add(a.cname)
            html = f.post_cname(a.path, a.cname)
            header = parse.header_part(parse.page_text(html))
            cond = parse.parse_conditions(header)
            races.append(Race(
                venue=parse.parse_venue(header) or day_venue or "不明",
                number=num,
                name=_race_name(html),
                field_size=parse.parse_field_size(html),
                **cond,
            ))
    return races


def collect_odds(f: Fetcher, today: date, entry_o) -> dict[tuple[str, int], list[float]]:
    out: dict[tuple[str, int], list[float]] = {}
    visited: set[str] = {entry_o[1]}
    top = f.post_cname(*entry_o)
    for day in _day_actions(top, "accessO.html", today):
        visited.add(day.cname)
        page = f.post_cname(day.path, day.cname)
        venue = parse.parse_venue(day.context) or parse.parse_venue(parse.page_text(page))
        for num, a in sorted(_race_actions(page, "accessO.html", visited).items()):
            visited.add(a.cname)
            html = f.post_cname(a.path, a.cname)
            odds = parse.parse_win_odds(html)
            if not odds:
                # 単勝・複勝のタブが別ページのとき
                tan = next((x for x in parse.extract_actions(html)
                            if "単勝" in x.text and x.cname not in visited), None)
                if tan:
                    visited.add(tan.cname)
                    odds = parse.parse_win_odds(f.post_cname(tan.path, tan.cname))
            if odds and venue:
                out[(venue, num)] = odds
    return out


def collect_going(f: Fetcher) -> dict[str, dict[str, str]]:
    first = f.get("/keiba/baba/")
    pages = [first]
    for href in sorted(set(re.findall(r'href="(/keiba/baba/index\d+\.html)"', first))):
        pages.append(f.get(href))
    out: dict[str, dict[str, str]] = {}
    for html in pages:
        text = parse.page_text(html)
        venue = parse.parse_venue(text)
        going = parse.parse_going(text)
        if venue and going:
            out.setdefault(venue, going)
    return out


def merge(races: list[Race], odds: dict, going: dict) -> None:
    for r in races:
        r.win_odds = odds.get((r.venue, r.number), [])
        g = going.get(r.venue, {})
        r.going = g.get("ダート" if r.surface == "ダート" else "芝")
        if r.field_size is None and r.win_odds:
            r.field_size = len(r.win_odds)
