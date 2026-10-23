"""JRA公式サイトから当日の全レースを集める。

JRADB のページ構成（2026年10月に確認）:
- 出馬表トップ（doAction で cname=pw01dli00/F3 を POST）に、開催ごとのリンクがある。
  cname に開催日 YYYYMMDD が入っている（例: pw01drl00052026040820261024/BC、文字は「4回東京8日」）
- 開催ページにはレースの一覧表がある。各行は
  th.race_num（出馬表へのリンク、img alt「1レース」）/ td.time「10時05分」/ td.race_name /
  td.dist（span.course・span.dist・span.num）/ td.odds（発売前は「未発表」）
- 各レースの出馬表は accessD.html?CNAME=... の GET で開ける
"""
from __future__ import annotations

import logging
import re
from datetime import date
from urllib.parse import urlparse

from . import parse
from .fetch import BASE, Fetcher
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
    # 「4回東京8日」のように競馬場名があるものだけ（「今週の出走馬一覧」などを除く）
    return [a for a in parse.extract_actions(html)
            if a.path.endswith(path_suffix) and parse.parse_venue(a.text)
            and (parse.mentions_date(a.context, today.month, today.day) or ymd in a.cname)]


def is_race_day(f: Fetcher, today: date) -> tuple[bool, tuple[str, str], tuple[str, str], str]:
    home = parse.extract_actions(f.get("/"))
    entry_d = _entry(home, "出馬表", "accessD.html")
    entry_o = _entry(home, "オッズ", "accessO.html")
    top = f.post_cname(*entry_d)
    return bool(_day_actions(top, "accessD.html", today)), entry_d, entry_o, top


def _open(f: Fetcher, link: parse.Link) -> str:
    if link.cname is not None:
        return f.post_cname(link.path, link.cname)
    u = urlparse(link.path)
    return f.get(u.path + (f"?{u.query}" if u.query else ""))


def collect(f: Fetcher, today: date, top_d: str) -> list[Race]:
    races: list[Race] = []
    for day in _day_actions(top_d, "accessD.html", today):
        page = f.post_cname(day.path, day.cname)
        venue = parse.parse_venue(day.text) or parse.parse_venue(day.context) or "不明"
        for row in parse.parse_day_rows(page):
            race = Race(venue=venue, **row.fields)
            if row.race_link and row.race_link.cname is None:
                race.jra_url = BASE + row.race_link.path
            if row.race_link:
                try:
                    html = _open(f, row.race_link)
                    race.handicap = race.handicap or parse.parse_weight_rule(html) == "ハンデ"
                except Exception as e:  # 1レース分の失敗で全体を止めない
                    log.warning("%s%dR の出馬表を読めませんでした: %s", venue, race.number, e)
            if row.odds_link:
                try:
                    race.win_odds = _odds(f, row.odds_link)
                except Exception as e:
                    log.warning("%s%dR のオッズを読めませんでした: %s", venue, race.number, e)
            races.append(race)
    return races


def _odds(f: Fetcher, link: parse.Link) -> list[float]:
    html = _open(f, link)
    odds = parse.parse_win_odds(html)
    if not odds:
        # 単勝・複勝のタブが別ページのとき
        tan = next((l for l in parse.extract_links(html) if "単勝" in l.text), None)
        if tan:
            odds = parse.parse_win_odds(_open(f, tan))
    return odds


def collect_going(f: Fetcher) -> dict[str, dict[str, str]]:
    """馬場情報。index.html が1場目、index2.html・index3.html が2場目以降。"""
    first = f.get("/keiba/baba/")
    pages = [first]
    for name in sorted(set(re.findall(r'href="(?:/keiba/baba/)?(index\d+\.html)"', first))):
        pages.append(f.get(f"/keiba/baba/{name}"))
    out: dict[str, dict[str, str]] = {}
    for html in pages:
        text = parse.page_text(parse.main_part(html))
        venue = parse.parse_venue(text)
        going = parse.parse_going(text)
        if venue and going:
            out.setdefault(venue, going)
    return out


def merge_going(races: list[Race], going: dict) -> None:
    for r in races:
        g = going.get(r.venue, {})
        r.going = g.get("ダート" if r.surface == "ダート" else "芝")
