"""血統（父・母の父）ごとの産駒成績を、毎回の出馬表の前走欄から集計する。

- 出馬表には各馬の父・母の父と、前走〜4走前の成績が載っている。これを1走ずつ記録して貯めていく
- 同じ馬の同じ走は1回だけ数える（馬名と日付から作った鍵で重複を除く）
- 記録はパスワードで暗号化して data/pedigree.json に保存する
- 集計は芝・ダート別、さらに2歳時の成績（新馬戦向けの仕上がりの早さ）を別に出す
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import date
from pathlib import Path

from .crypto import decrypt, encrypt
from .models import Race

log = logging.getLogger(__name__)

KEEP_YEARS = 3          # これより古い走は捨てる
SHRINK = 8              # 走数が少ない血統は全体平均へ寄せる（この走数ぶん平均を混ぜる）
SURFACES = ("芝", "ダ")


def _date(s: str) -> date | None:
    m = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日", s or "")
    return date(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def _age(sex_age: str | None) -> int | None:
    m = re.search(r"(\d{1,2})", sex_age or "")
    return int(m.group(1)) if m else None


def _secs(t: str | None) -> float | None:
    m = re.match(r"^(?:(\d+):)?(\d+(?:\.\d+)?)$", t or "")
    return int(m.group(1) or 0) * 60 + float(m.group(2)) if m else None


def run_record(horse, p: dict, today: date) -> tuple[str, list] | None:
    """前走1つを記録用の形にする。使えない走は None。"""
    d = _date(p.get("date"))
    if not d or p.get("surface") not in SURFACES or not isinstance(p.get("place"), int):
        return None
    heads = p.get("heads") or 0
    if heads < 2:
        return None
    margin = p.get("margin")
    # 着差（秒）を成績の物差しにする。3秒以上は同じ扱い。着差がなければ着順から近似
    perf = -min(margin, 3.0) if margin is not None else -2.0 * (p["place"] - 1) / (heads - 1)
    corners = p.get("corners") or []
    pos = (corners[0] - 1) / (heads - 1) if corners else None
    sec, l3, dist = _secs(p.get("time")), p.get("last3f"), p.get("distance")
    kick = sec / dist * 600 - l3 if sec and l3 and dist else None
    # JRAの馬齢は1月1日に1つ増える。今の年齢から、その走のときに2歳だったかを出す
    age = _age(horse.sex_age)
    two = age is not None and d.year == today.year - age + 2
    key = hashlib.sha1(f"{horse.name}|{d.isoformat()}".encode()).hexdigest()[:16]
    return key, [horse.sire or "", horse.dam_sire or "", p["surface"], d.isoformat(),
                 round(perf, 2), None if pos is None else round(pos, 3),
                 None if kick is None else round(kick, 2), p["place"] <= 3, two]


class Store:
    def __init__(self, path: Path, password: str):
        self.path, self.password = path, password
        self.runs: dict[str, list] = {}
        if path.exists():
            try:
                self.runs = decrypt(json.loads(path.read_text()), password).get("runs", {})
            except Exception as e:  # パスワードを変えたときなど。集計は作り直しになる
                log.warning("血統の記録を読めなかったので作り直します: %s", e)

    def add(self, races: list[Race], today: date) -> int:
        before = len(self.runs)
        for r in races:
            for h in r.horses:
                if not h.sire:
                    continue
                for p in h.past:
                    rec = run_record(h, p, today)
                    if rec:
                        self.runs[rec[0]] = rec[1]
        cutoff = date(today.year - KEEP_YEARS, today.month, 1).isoformat()
        self.runs = {k: v for k, v in self.runs.items() if v[3] >= cutoff}
        return len(self.runs) - before

    def save(self) -> None:
        self.path.write_text(json.dumps(encrypt({"runs": self.runs}, self.password)))


def _agg(runs: list[list]) -> dict:
    n = len(runs)
    pos = [r[5] for r in runs if r[5] is not None]
    kick = [r[6] for r in runs if r[6] is not None]
    return {
        "n": n,
        "perf_sum": sum(r[4] for r in runs),
        "top3": sum(1 for r in runs if r[7]),
        "pos": round(sum(pos) / len(pos), 3) if pos else None,
        "kick": round(sum(kick) / len(kick), 2) if kick else None,
    }


def summarize(runs: dict[str, list], names: set[str]) -> dict:
    """今日の出走馬に出てくる血統だけ、芝・ダート別と2歳時の成績をまとめる。

    perf は着差ベースの平均（0 が勝ち、-3 が大敗）を、走数が少ないほど全体平均に寄せたもの。
    """
    rows = list(runs.values())
    if not rows:
        return {}
    mean = {s: (sum(r[4] for r in rows if r[2] == s) / max(1, sum(1 for r in rows if r[2] == s))) for s in SURFACES}

    def rate(group: list[list], s: str) -> dict:
        g = [r for r in group if r[2] == s]
        a = _agg(g)
        a["perf"] = round((a.pop("perf_sum") + SHRINK * mean[s]) / (a["n"] + SHRINK), 3)
        a["top3_rate"] = round(a["top3"] / a["n"], 3) if a["n"] else None
        return a

    out = {}
    for role, idx in (("sire", 0), ("dam_sire", 1)):
        by: dict[str, list] = {}
        for r in rows:
            if r[idx] in names:
                by.setdefault(r[idx], []).append(r)
        for name, group in by.items():
            entry = out.setdefault(name, {})
            two = [r for r in group if r[8]]
            stats = {s: rate(group, s) for s in SURFACES}
            n_t, n_d = stats["芝"]["n"], stats["ダ"]["n"]
            # 向き: 芝とダートの成績差に、産駒が芝とダートのどちらで多く使われているかを足す
            share = (n_t - n_d) / (n_t + n_d) if n_t + n_d else 0.0
            apt = (stats["芝"]["perf"] - stats["ダ"]["perf"]) + 0.6 * share
            label = "芝向き" if apt >= 0.35 else "ダート向き" if apt <= -0.35 else "芝ダート兼用"
            entry[role] = {
                "all": stats, "two": {s: rate(two, s) for s in SURFACES},
                "aptitude": round(apt, 2), "label": label if n_t + n_d >= 4 else "データ不足",
            }
    return out
