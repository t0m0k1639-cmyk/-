"""開催中の馬場の傾向（前が残るか・内枠が有利か）を、同じ開催の前日と当日のレース結果から出す。

レースごとに、3着以内の馬の「4角の位置（0が先頭、1が最後方）」と「馬番の位置（0が最内、1が大外）」を平均し、
競馬場・芝ダート別にまとめて、全レースの平均との差を傾向とする。
レース数が少ないうちは偶然の影響が大きいので、k / (k + 4) を掛けて弱める。
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from pathlib import Path

from . import jra
from .crypto import decrypt, encrypt

log = logging.getLogger(__name__)

RAW_DIR = "results_raw"     # 着順・通過順の控え（暗号化。ページでは使わない）
SHRINK = 4                  # レース数がこの数のとき、傾向を半分の強さで使う
SHOW = 0.04                 # これより小さい傾向は「目立った傾向なし」
PRIOR_N = 6                 # 全体の平均を出すときに足す、ふつうの値の重み（レース数）
PRIOR_FRONT, PRIOR_GATE = 0.33, 0.5


def load_raw(data_dir: Path, day: date, password: str) -> dict:
    p = data_dir / RAW_DIR / f"{day.isoformat()}.json"
    return decrypt(json.loads(p.read_text()), password) if p.exists() else {}


def save_raw(data_dir: Path, day: date, password: str, raw: dict) -> None:
    (data_dir / RAW_DIR).mkdir(parents=True, exist_ok=True)
    (data_dir / RAW_DIR / f"{day.isoformat()}.json").write_text(json.dumps(encrypt(raw, password)))


def load_day_races(data_dir: Path, day: date, password: str) -> list[dict]:
    p = data_dir / "days" / f"{day.isoformat()}.json"
    return decrypt(json.loads(p.read_text()), password)["races"] if p.exists() else []


def previous_day(data_dir: Path, day: date) -> date | None:
    """同じ週の前の開催日（2日前まで）。"""
    for back in (1, 2):
        d = day - timedelta(days=back)
        if (data_dir / "days" / f"{d.isoformat()}.json").exists():
            return d
    return None


def _minutes(post_time: str | None) -> int | None:
    try:
        h, m = (int(x) for x in (post_time or "").split(":"))
        return h * 60 + m
    except ValueError:
        return None


def finished(race: dict, now: datetime) -> bool:
    """発走から15分たったレース。"""
    t = _minutes(race.get("post_time"))
    return t is not None and now.hour * 60 + now.minute >= t + 15


def update_raw(f, data_dir: Path, day: date, password: str, races: list[dict], now: datetime) -> dict:
    """当日の終わったレースのうち、まだ控えていない結果だけ取りに行って控えに足す。"""
    raw = load_raw(data_dir, day, password)
    todo = {f"{r['venue']}-{r['number']}" for r in races if finished(r, now)} - set(raw)
    if todo:
        got = jra.collect_results(f, day, want=lambda k: k in todo)
        raw.update(got)
        save_raw(data_dir, day, password, raw)
        log.info("馬場の傾向用に結果を %d レース取得", len(got))
    return raw


def race_stats(rows: list[dict]) -> tuple[float, float] | None:
    """1レースの (3着以内の4角の位置の平均, 3着以内の馬番の位置の平均)。"""
    if len(rows) < 5:
        return None
    n = len(rows)
    field = max(r["number"] for r in rows)
    top = [r for r in rows if r["place"] <= 3][:3]
    fronts = [min(r["corners"][-1] - 1, n - 1) / (n - 1) for r in top if r.get("corners")]
    gates = [(r["number"] - 1) / (field - 1) for r in top]
    if not fronts or field < 2:
        return None
    return sum(fronts) / len(fronts), sum(gates) / len(gates)


def compute(days: list[tuple[list[dict], dict]], before: tuple[str, int] | None = None) -> dict:
    """[(その日のレース, その日の結果の控え), ...] から {"東京|芝": 傾向} を出す。

    before=(当日の日付, 発走の分) を渡すと、当日のそれより前に発走したレースだけを使う（検証用）。
    """
    groups: dict[str, list[tuple[float, float]]] = {}
    for i, (races, raw) in enumerate(days):
        for r in races:
            if r.get("surface") not in ("芝", "ダート"):
                continue
            if before and i == len(days) - 1:
                t = _minutes(r.get("post_time"))
                if t is None or t >= before[1]:
                    continue
            st = race_stats(raw.get(f"{r['venue']}-{r['number']}", []))
            if st:
                groups.setdefault(f"{r['venue']}|{r['surface']}", []).append(st)
    allst = [s for g in groups.values() for s in g]
    base_f = (sum(s[0] for s in allst) + PRIOR_FRONT * PRIOR_N) / (len(allst) + PRIOR_N)
    base_g = (sum(s[1] for s in allst) + PRIOR_GATE * PRIOR_N) / (len(allst) + PRIOR_N)
    out = {}
    for key, sts in groups.items():
        k = len(sts)
        w = k / (k + SHRINK)
        front = (base_f - sum(s[0] for s in sts) / k) * w     # 正なら前が残っている
        inner = (base_g - sum(s[1] for s in sts) / k) * w     # 正なら内枠が来ている
        parts = []
        if abs(front) >= SHOW:
            parts.append("前残り" if front > 0 else "差し・追込が届く")
        if abs(inner) >= SHOW:
            parts.append("内枠有利" if inner > 0 else "外枠有利")
        out[key] = {"front": round(front, 3), "inner": round(inner, 3), "races": k,
                    "label": "・".join(parts) or "目立った傾向なし"}
    return out


def for_day(data_dir: Path, day: date, password: str, races: list[dict], raw_today: dict | None = None) -> dict:
    """その日のページに載せる傾向（前日と、当日の終わったレース）。"""
    days = []
    prev = previous_day(data_dir, day)
    if prev:
        days.append((load_day_races(data_dir, prev, password), load_raw(data_dir, prev, password)))
    days.append((races, raw_today if raw_today is not None else load_raw(data_dir, day, password)))
    return compute(days)
