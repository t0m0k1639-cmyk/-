import json

from keiba.__main__ import ROOT, load_config, validate, ParseError
from keiba.models import Race
from keiba.score import condition_chaos, market_chaos, score_day

import pytest

CFG = load_config()


def race(**kw):
    base = dict(venue="東京", number=1, surface="芝", distance=1600,
                race_class="1勝クラス", field_size=12, going="良")
    base.update(kw)
    return Race(**base)


def test_condition_chaos_rises_with_field_size_and_handicap():
    small, _ = condition_chaos(race(field_size=8), CFG)
    big, _ = condition_chaos(race(field_size=18), CFG)
    hcap, reasons = condition_chaos(race(field_size=18, handicap=True), CFG)
    assert small < big < hcap
    assert "ハンデ戦" in reasons


def test_market_chaos_low_for_heavy_favorite():
    solid = market_chaos([1.3, 8.0, 15.0, 30.0, 50.0, 80.0])
    open_ = market_chaos([4.5, 5.0, 5.5, 6.0, 7.0, 8.0])
    assert solid < 30 < open_
    assert market_chaos([]) is None


def test_labels_follow_gap_direction():
    races = [
        # 条件は荒れ寄り・人気は集中 → 穴狙い向き
        race(number=1, field_size=18, handicap=True, going="重",
             win_odds=[1.4] + [20.0] * 17),
        # 条件は堅め・オッズは割れている → 本命妙味
        race(number=2, field_size=8, race_class="G1",
             win_odds=[4.0, 4.5, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]),
        race(number=3, field_size=12, win_odds=[3.0, 4.0, 6.0, 8.0] + [20.0] * 8),
    ]
    by_num = {s.race.number: s for s in score_day(races, CFG)}
    assert by_num[1].label == "穴狙い向き"
    assert by_num[2].label == "本命妙味"
    assert by_num[1].target > by_num[3].target


def test_no_odds_means_no_gap_points():
    [s] = score_day([race()], CFG)
    assert s.gap is None and s.target == 0 and s.label is None


def test_favorites_add_bonus():
    cfg = dict(CFG, favorites=[{"name": "芝マイル", "surface": "芝",
                                "distance_min": 1600, "distance_max": 1600, "bonus": 20}])
    [hit] = score_day([race()], cfg)
    [miss] = score_day([race(surface="ダート")], cfg)
    assert hit.favorites == ["芝マイル"] and hit.target == 20
    assert miss.target == 0


def test_public_output_has_no_odds():
    [s] = score_day([race(win_odds=[2.0, 3.0, 5.0])], CFG)
    assert "win_odds" not in s.to_public()
    assert "1.0" not in json.dumps(s.to_public())


def test_validate_rejects_unparsed_pages():
    with pytest.raises(ParseError):
        validate([])
    with pytest.raises(ParseError):
        validate([Race(venue="東京", number=i) for i in range(1, 13)])
    warnings = validate([race(number=i) for i in range(1, 13)])
    assert any("オッズ" in w for w in warnings)


def test_sample_file_loads():
    raw = json.loads((ROOT / "sample" / "races.json").read_text())
    assert len(score_day([Race(**r) for r in raw["races"]], CFG)) == len(raw["races"])
