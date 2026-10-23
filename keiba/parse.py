"""JRA公式サイトの HTML から必要な項目を取り出す。

ページの細かいマークアップに依存しすぎないよう、表示テキストへの正規表現を中心にしている。
JRA側のページ構成が変わったら、ここを直す。
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from bs4 import BeautifulSoup

VENUES = ["札幌", "函館", "福島", "新潟", "東京", "中山", "中京", "京都", "阪神", "小倉"]
VENUE_RE = "|".join(VENUES)

DOACTION_RE = re.compile(
    r"doAction\(\s*['\"](/JRADB/[^'\"]+)['\"]\s*,\s*['\"]([^'\"]+)['\"]")


def norm(s: str) -> str:
    """全角英数・記号を半角に、連続空白を1つにする。"""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", s)).strip()


def page_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for t in soup(["script", "style", "noscript"]):
        t.decompose()
    return norm(soup.get_text(" "))


@dataclass
class Action:
    path: str
    cname: str
    text: str       # リンク自身の文字
    context: str    # 周辺（親要素）の文字。日付やレース番号を探すのに使う


def extract_actions(html: str) -> list[Action]:
    soup = BeautifulSoup(html, "html.parser")
    out: list[Action] = []
    seen: set[tuple[str, str]] = set()
    for tag in soup.find_all(True):
        attrs = " ".join(str(tag.get(a, "")) for a in ("onclick", "href"))
        m = DOACTION_RE.search(attrs)
        if not m or (m.group(1), m.group(2)) in seen:
            continue
        seen.add((m.group(1), m.group(2)))
        text = norm(tag.get_text(" ") or " ".join(i.get("alt", "") for i in tag.find_all("img")))
        ctx_tag, ctx = tag, text
        for _ in range(4):
            if ctx_tag.parent is None:
                break
            ctx_tag = ctx_tag.parent
            # 他のリンクも含む親まで上がると、隣の日付やレースの文字を拾ってしまう
            if len(DOACTION_RE.findall(str(ctx_tag))) > 1:
                break
            t = norm(ctx_tag.get_text(" "))
            if len(t) > 400:
                break
            ctx = t
        out.append(Action(m.group(1), m.group(2), text, ctx))
    return out


@dataclass
class Link:
    """doAction（POST, cname あり）か、普通の href（GET, cname なし）のリンク。"""
    path: str
    cname: str | None
    text: str


def link_from_tag(tag) -> Link | None:
    attrs = " ".join(str(tag.get(a, "")) for a in ("onclick", "href"))
    m = DOACTION_RE.search(attrs)
    text = norm(tag.get_text(" ") or " ".join(i.get("alt", "") for i in tag.find_all("img")))
    if m:
        return Link(m.group(1), m.group(2), text)
    href = tag.get("href", "")
    if href.startswith("/JRADB/") and ".html" in href:
        return Link(href, None, text)
    return None


def extract_links(html: str) -> list[Link]:
    soup = BeautifulSoup(html, "html.parser")
    links = (link_from_tag(a) for a in soup.find_all("a"))
    return [l for l in links if l]


@dataclass
class DayRow:
    fields: dict            # Race に渡す項目
    race_link: Link | None  # 出馬表
    odds_link: Link | None  # オッズ（発売前は None）


def _digits(s: str) -> int | None:
    m = re.search(r"\d[\d,]*", s)
    return int(m.group(0).replace(",", "")) if m else None


def parse_day_rows(html: str) -> list[DayRow]:
    """開催ページのレース一覧表を1行ずつ読む。"""
    soup = BeautifulSoup(html, "html.parser")
    rows = []
    for th in soup.select("th.race_num"):
        a = th.find("a")
        tr = th.find_parent("tr")
        if a is None or tr is None:
            continue    # 見出し行
        img = a.find("img")
        number = parse_race_number(norm(img.get("alt", "") if img else a.get_text(" ")))
        if number is None:
            continue
        fields: dict = {"number": number}

        t = tr.find("td", class_="time")
        m = re.search(r"(\d{1,2})\s*[時:]\s*(\d{2})", norm(t.get_text(" "))) if t else None
        if m:
            fields["post_time"] = f"{int(m.group(1))}:{m.group(2)}"

        n = tr.find("td", class_="race_name")
        name = norm(n.get_text(" ")) if n else ""
        fields["name"] = name
        cond = parse_conditions(name)
        fields["race_class"] = cond.get("race_class")
        # 一覧表では牝馬限定が「2歳未勝利牝[指定]」のように括弧なしで書かれる
        fields["fillies_only"] = "牝" in name
        fields["handicap"] = cond.get("handicap", False)

        d = tr.find("td", class_="dist")
        if d:
            course = d.find("span", class_="course")
            course = norm(course.get_text(" ")) if course else ""
            dist = d.find("span", class_="dist")
            num = d.find("span", class_="num")
            fields["distance"] = _digits(dist.get_text(" ")) if dist else None
            fields["field_size"] = _digits(num.get_text(" ")) if num else None
            if "障害" in name or "障害" in course:
                fields["surface"] = "障害"
            elif course.startswith("ダ"):
                fields["surface"] = "ダート"
            elif course.startswith("芝"):
                fields["surface"] = "芝"

        o = tr.find("td", class_="odds")
        odds_link = None
        if o:
            for tag in o.find_all(["a", "button"]):
                odds_link = link_from_tag(tag)
                if odds_link:
                    break
        rows.append(DayRow(fields, link_from_tag(a), odds_link))
    return rows


ODDS_POP_RE = re.compile(r"(?<![\d.])(\d{1,4}(?:,\d{3})*\.\d)(?![\d.])\s*[(（]\s*(\d{1,2})\s*番?人気")
ODDS_RE = re.compile(r"(?<![\d.])(\d{1,4}(?:,\d{3})*\.\d)(?![\d.])")


def _text(el) -> str:
    return norm(el.get_text(" ")) if el else ""


def parse_horses(html: str):
    """出馬表の馬の表（table.basic で「馬名」を含むもの）を読む。

    行の構造（2026年10月に確認）: td.waku（img alt「枠1白」）/ td.num（馬番）/
    td.horse（div.name に馬名、p.trainer に調教師、当日は単勝オッズと人気）/
    td.jockey（性齢・斤量・騎手）/ td.past（前走など）
    """
    from .models import Horse

    soup = BeautifulSoup(html, "html.parser")
    table = next((t for t in soup.find_all("table") if "馬名" in t.get_text()), None)
    if table is None:
        return []
    horses = []
    for tr in table.find_all("tr"):
        num_td = tr.find("td", class_="num")
        horse_td = tr.find("td", class_="horse")
        if not num_td or not horse_td:
            continue
        number = _digits(_text(num_td))
        if number is None:
            continue
        name = _text(horse_td.find(class_="name")) or _text(horse_td.find("a"))

        waku = None
        w = tr.find("td", class_="waku")
        if w:
            img = w.find("img")
            waku = _digits(img.get("alt", "") if img else _text(w))

        odds = pop = None
        # 前走欄などの数字を拾わないよう、オッズは馬名の欄からだけ探す
        htext = _text(horse_td.find(class_="name_line")) + " " + _text(horse_td.find(class_=re.compile("odds")))
        m = ODDS_POP_RE.search(htext)
        if m:
            odds, pop = float(m.group(1).replace(",", "")), int(m.group(2))
        else:
            m = ODDS_RE.search(_text(horse_td.find(class_=re.compile("odds"))))
            if m:
                odds = float(m.group(1).replace(",", ""))

        jt = tr.find("td", class_="jockey")
        jtext = _text(jt)
        sex_age = weight = jockey = None
        m = re.search(r"([牡牝セ騸])\s*(\d{1,2})", jtext)
        if m:
            sex_age = m.group(1) + m.group(2)
        m = re.search(r"(\d{2}\.\d)\s*(?:kg|キロ)?", jtext)
        if m:
            weight = float(m.group(1))
        if jt:
            j = jt.find(class_="jockey") or (jt.find_all("a")[-1] if jt.find_all("a") else None)
            jockey = _text(j) or None

        trainer = _text(horse_td.find(class_="trainer")).split("(")[0].strip() or None
        row_text = _text(tr.find("td", class_="num")) + _text(horse_td.find(class_="name_line")) + jtext
        horses.append(Horse(
            number=number, name=name, waku=waku, sex_age=sex_age, weight=weight,
            jockey=jockey, trainer=trainer, odds=odds, popularity=pop,
            scratched=bool(SCRATCH_RE.search(row_text)),
        ))
    return horses


WEIGHT_RULES = ("馬齢", "定量", "別定", "ハンデ")


def parse_weight_rule(html: str) -> str | None:
    """出馬表の負担重量の種類（馬齢・定量・別定・ハンデ）。"""
    soup = BeautifulSoup(html, "html.parser")
    for s in soup.find_all(string=True):
        t = norm(str(s))
        if t in WEIGHT_RULES:
            return t
    m = re.search(r"(馬齢|定量|別定|ハンデ)", header_part(page_text(html))[-600:])
    return m.group(1) if m else None


def main_part(html: str) -> str:
    """ヘッダーのメニュー（全競馬場の名前が並ぶ）を除いた本文。"""
    soup = BeautifulSoup(html, "html.parser")
    for sel in ("#contents", "#main", "main", "#contentsBody"):
        el = soup.select_one(sel)
        if el:
            return str(el)
    for t in soup.find_all(["header", "nav", "footer"]):
        t.decompose()
    return str(soup)


def date_patterns(month: int, day: int) -> list[str]:
    return [f"{month}月{day}日", f"{month:02d}月{day:02d}日", f"{month}/{day}"]


def mentions_date(text: str, month: int, day: int) -> bool:
    return any(p in text for p in date_patterns(month, day))


def parse_venue(text: str) -> str | None:
    m = re.search(rf"\d+回\s*({VENUE_RE})\s*\d+日", text)
    if m:
        return m.group(1)
    m = re.search(VENUE_RE, text)
    return m.group(0) if m else None


def parse_race_number(text: str) -> int | None:
    m = re.search(r"(?<!\d)(\d{1,2})\s*(?:R|レース)(?![a-zA-Z])", text)
    if m and 1 <= int(m.group(1)) <= 12:
        return int(m.group(1))
    return None


def header_part(text: str) -> str:
    """出馬表の上部（レース条件の部分）。馬の一覧の「牝3」などを拾わないために切り出す。"""
    cut = len(text)
    for w in ("馬番", "枠番", "馬名"):
        i = text.find(w)
        if 0 < i < cut:
            cut = i
    return text[: min(cut, 1500)]


CLASS_RULES = [
    ("G1", r"G\s*(?:1|I)(?![I\d])"),
    ("G2", r"G\s*(?:2|II)(?![I\d])"),
    ("G3", r"G\s*(?:3|III)(?![I\d])"),
    ("リステッド", r"リステッド|\(L\)"),
    ("オープン", r"オープン"),
    ("3勝クラス", r"3勝クラス"),
    ("2勝クラス", r"2勝クラス"),
    ("1勝クラス", r"1勝クラス"),
    ("未勝利", r"未勝利"),
    ("新馬", r"新馬"),
]


def parse_conditions(header: str) -> dict:
    h = norm(header)
    out: dict = {}
    if "障害" in h:
        out["surface"] = "障害"
    m = (re.search(r"(芝|ダート|ダ)\s*[・･]?\s*([0-9,]{3,5})\s*(?:メートル|m)", h)
         or re.search(r"([0-9,]{3,5})\s*(?:メートル|m)\s*\(?\s*(芝|ダート|ダ)", h))
    if m:
        a, b = m.groups()
        surf, dist = (a, b) if not a[0].isdigit() else (b, a)
        out.setdefault("surface", "ダート" if surf.startswith("ダ") else "芝")
        out["distance"] = int(dist.replace(",", ""))
    elif out.get("surface") == "障害":
        m = re.search(r"([0-9,]{4,5})\s*(?:メートル|m)", h)
        if m:
            out["distance"] = int(m.group(1).replace(",", ""))
    for name, pat in CLASS_RULES:
        if re.search(pat, h):
            out["race_class"] = name
            break
    out["handicap"] = "ハンデ" in h
    out["fillies_only"] = bool(re.search(r"\(牝\)|牝馬限定", h))
    m = re.search(r"(\d{1,2})\s*[時:]\s*(\d{2})\s*分?\s*発走", h)
    if m:
        out["post_time"] = f"{int(m.group(1))}:{m.group(2)}"
    return out


SCRATCH_RE = re.compile(r"取消|除外|競走除外")


def _rows(html: str):
    soup = BeautifulSoup(html, "html.parser")
    for table in soup.find_all("table"):
        for tr in table.find_all("tr"):
            cells = [norm(td.get_text(" ")) for td in tr.find_all(["td", "th"])]
            yield table, tr, cells


def parse_field_size(html: str) -> int | None:
    """出走頭数。馬名の表の行数（取消・除外を除く）から数える。"""
    best = 0
    soup = BeautifulSoup(html, "html.parser")
    for table in soup.find_all("table"):
        if "馬名" not in table.get_text():
            continue
        horses = set()
        for tr in table.find_all("tr"):
            cells = [norm(td.get_text(" ")) for td in tr.find_all("td")]
            row = " ".join(cells)
            if not cells or SCRATCH_RE.search(row):
                continue
            nums = [int(c) for c in cells[:3] if re.fullmatch(r"\d{1,2}", c)]
            if nums and 1 <= nums[-1] <= 18:
                horses.add(nums[-1])
        best = max(best, len(horses))
    if best:
        return best
    m = re.search(r"(\d{1,2})\s*頭", page_text(html))
    return int(m.group(1)) if m else None


def parse_win_odds(html: str) -> list[float]:
    """単勝オッズを馬番順に返す（取消は除く）。"""
    odds: dict[int, float] = {}
    soup = BeautifulSoup(html, "html.parser")
    for tr in soup.find_all("tr"):
        tds = tr.find_all("td")
        if not tds:
            continue
        cells = [norm(td.get_text(" ")) for td in tds]
        if SCRATCH_RE.search(" ".join(cells)):
            continue
        num = next((int(c) for c in cells[:3] if re.fullmatch(r"\d{1,2}", c)), None)
        if num is None or not 1 <= num <= 18:
            continue
        val = None
        for td, c in zip(tds, cells):
            if "tan" in " ".join(td.get("class", [])) and re.fullmatch(r"\d+(?:,\d{3})*\.\d", c):
                val = c
                break
        if val is None:
            val = next((c for c in cells if re.fullmatch(r"\d+(?:,\d{3})*\.\d", c)), None)
        if val is not None:
            odds.setdefault(num, float(val.replace(",", "")))
    return [odds[k] for k in sorted(odds)]


GOINGS = ["不良", "稍重", "重", "良"]   # 「稍重」を「重」より先に


def parse_going(text: str) -> dict[str, str]:
    """馬場情報ページ1枚から {"芝": "良", "ダート": "稍重"} を返す。"""
    t = norm(text)
    out = {}
    for surf, pat in (("芝", r"芝"), ("ダート", r"ダート")):
        m = re.search(rf"{pat}\s*[:：]?\s*({'|'.join(GOINGS)})", t)
        if m:
            out[surf] = m.group(1)
    return out
