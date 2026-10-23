"""荒れ度と狙い目の計算。

オッズはレースを選ぶためのスコアにだけ使う。各馬の印の判断には渡さない。
"""
from __future__ import annotations

import math
from statistics import mean, pstdev

from .models import Race, Scored


def clip(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def condition_chaos(race: Race, cfg: dict) -> tuple[float, list[str]]:
    c = cfg["condition"]
    points = 0.0
    reasons: list[str] = []

    if race.field_size:
        p = c["field_size_points"] * clip((race.field_size - 8) / 10)
        points += p
        if race.field_size >= 15:
            reasons.append(f"{race.field_size}頭の多頭数")
    if race.handicap:
        points += c["handicap"]
        reasons.append("ハンデ戦")
    if race.fillies_only:
        points += c["fillies_only"]
        reasons.append("牝馬限定")
    if race.surface == "障害":
        points += c["jump"]
    elif race.distance and race.distance <= 1400:
        if race.surface == "芝":
            points += c["turf_sprint"]
            reasons.append("芝の短距離")
        elif race.surface == "ダート":
            points += c["dirt_sprint"]
    if race.race_class:
        points += c["class"].get(race.race_class, 0)
    if race.going:
        g = c["going"].get(race.going, 0)
        points += g
        if g > 0:
            reasons.append(f"馬場が{race.going}")
    return clip(points, 0, 100), reasons


def implied_probs(odds: list[float]) -> list[float]:
    inv = [1 / o for o in odds if o and o > 1.0]
    s = sum(inv)
    return sorted((x / s for x in inv), reverse=True) if s else []


def market_chaos(odds: list[float]) -> float | None:
    """単勝オッズの分布から、市場がどれだけ混戦と見ているかを 0-100 で返す。"""
    p = implied_probs(odds)
    if len(p) < 2:
        return None
    top1 = clip((0.5 - p[0]) / 0.4)          # 1番人気の支持率 50%→0, 10%→1
    top3 = clip((0.8 - sum(p[:3])) / 0.45)   # 上位3頭の合計 80%→0, 35%→1
    entropy = -sum(x * math.log(x) for x in p) / math.log(len(p))
    return 100 * (0.4 * top1 + 0.3 * top3 + 0.3 * entropy)


def _zscores(values: list[float]) -> list[float] | None:
    if len(values) < 3:
        return None
    sd = pstdev(values)
    if sd < 1e-9:
        return None
    m = mean(values)
    return [(v - m) / sd for v in values]


def _favorite_hits(race: Race, cfg: dict) -> tuple[list[str], float]:
    names, bonus = [], 0.0
    for f in cfg.get("favorites", []):
        if "venue" in f and f["venue"] != race.venue:
            continue
        if "surface" in f and f["surface"] != race.surface:
            continue
        if "class" in f and f["class"] != race.race_class:
            continue
        if "handicap" in f and bool(f["handicap"]) != race.handicap:
            continue
        if "fillies_only" in f and bool(f["fillies_only"]) != race.fillies_only:
            continue
        if "distance_min" in f and (race.distance is None or race.distance < f["distance_min"]):
            continue
        if "distance_max" in f and (race.distance is None or race.distance > f["distance_max"]):
            continue
        names.append(f.get("name", "得意条件"))
        bonus += f.get("bonus", 0)
    return names, min(bonus, cfg["target"]["favorite_cap"])


def _info_factor(race: Race, cfg: dict) -> float:
    f = cfg["target"]["info_factor"]
    factor = 1.0
    if race.race_class == "新馬":
        factor *= f["新馬"]
    if race.surface == "障害":
        factor *= f["jump"]
    if race.field_size is not None and race.field_size <= 7:
        factor *= f["small_field"]
    return factor


def score_day(races: list[Race], cfg: dict) -> list[Scored]:
    t = cfg["target"]
    conds = [condition_chaos(r, cfg) for r in races]
    mkts = [market_chaos(r.win_odds) for r in races]

    # ズレは同じ日のレース同士で標準化してから比べる（2つの尺度の差を吸収するため）
    idx = [i for i, m in enumerate(mkts) if m is not None]
    zc = _zscores([conds[i][0] for i in idx])
    zm = _zscores([mkts[i] for i in idx])
    gaps: dict[int, float] = {}
    for j, i in enumerate(idx):
        if zc is not None and zm is not None:
            gaps[i] = zc[j] - zm[j]
        else:
            gaps[i] = (conds[i][0] - mkts[i]) / 20

    out = []
    for i, race in enumerate(races):
        cond, reasons = conds[i]
        mkt = mkts[i]
        gap = gaps.get(i)
        chaos = cond if mkt is None else (cond + mkt) / 2
        reasons = list(reasons)

        label = None
        gap_part = 0.0
        if gap is None:
            reasons.append("オッズ未取得のためズレは計算していません")
        else:
            gap_part = t["gap_points"] * clip(abs(gap) / t["gap_full"]) * _info_factor(race, cfg)
            if gap >= t["label_threshold"]:
                label = "穴狙い向き"
                reasons.append("条件は荒れ寄りなのに人気が集中")
            elif gap <= -t["label_threshold"]:
                label = "本命妙味"
                reasons.append("条件は堅めなのにオッズが割れている")

        fav_names, fav_bonus = _favorite_hits(race, cfg)
        for n in fav_names:
            reasons.append(f"得意条件: {n}")

        out.append(Scored(
            race=race,
            condition_chaos=cond,
            market_chaos=mkt,
            chaos=chaos,
            gap=gap,
            target=clip(gap_part + fav_bonus, 0, 100),
            label=label,
            favorites=fav_names,
            reasons=reasons,
        ))
    return out
