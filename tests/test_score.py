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


def test_saved_day_is_encrypted(tmp_path):
    from keiba.__main__ import write_day
    from keiba.crypto import decrypt
    from keiba.models import Horse
    from datetime import date
    r = race(win_odds=[2.0, 3.0, 5.0], horses=[Horse(number=1, name="テストホース", odds=2.0)])
    write_day(tmp_path, date(2026, 10, 24), [r], CFG, [], "pw")
    raw = (tmp_path / "latest.json").read_text()
    assert "テストホース" not in raw and "東京" not in raw
    day = decrypt(json.loads(raw), "pw")
    assert day["races"][0]["horses"][0]["name"] == "テストホース"
    with pytest.raises(Exception):
        decrypt(json.loads(raw), "wrong")


def test_validate_rejects_unparsed_pages():
    with pytest.raises(ParseError):
        validate([])
    with pytest.raises(ParseError):
        validate([Race(venue="東京", number=i) for i in range(1, 13)])
    warnings = validate([race(number=i) for i in range(1, 13)])
    assert any("オッズ" in w for w in warnings)


def test_sample_file_loads():
    raw = json.loads((ROOT / "sample" / "races.json").read_text())
    assert len(score_day([Race.from_dict(r) for r in raw["races"]], CFG)) == len(raw["races"])


def test_refresh_replaces_one_race(tmp_path, monkeypatch):
    """更新ボタン用の処理: 指定したレースだけ差し替えて、ほかのレースは残す。"""
    from datetime import date
    from keiba import __main__ as m, jra
    from keiba.crypto import decrypt
    from keiba.models import Horse
    day = date(2026, 10, 24)
    old = [race(number=i, horses=[Horse(number=1, name=f"馬{i}", odds=3.0)]) for i in (1, 2)]
    m.write_day(tmp_path, day, old, CFG, [], "pw", pedigree_stats={"父A": {}})
    new = race(number=2, horses=[Horse(number=1, name="馬2", odds=9.9, body_weight=480, body_weight_diff=-12)])
    monkeypatch.setenv("PAGE_PASSWORD", "pw")
    monkeypatch.setattr(m, "Fetcher", lambda *a, **k: type("F", (), {"count": 3})())
    monkeypatch.setattr(jra, "is_race_day", lambda f, d: (True, None, None, ""))
    monkeypatch.setattr(jra, "collect_one", lambda f, d, t, v, n: new if (v, n) == ("東京", 2) else None)
    monkeypatch.setattr(jra, "collect_going", lambda f: {})
    monkeypatch.setattr(jra, "collect_baba_data", lambda f: {})
    assert m.main(["refresh", "--race", "東京-2", "--date", "2026-10-24", "--data", str(tmp_path)]) == 0
    saved = decrypt(json.loads((tmp_path / "latest.json").read_text()), "pw")
    by = {r["number"]: r for r in saved["races"]}
    assert by[2]["horses"][0]["body_weight_diff"] == -12 and by[2]["horses"][0]["odds"] == 9.9
    assert by[1]["horses"][0]["odds"] == 3.0 and saved["pedigree"] == {"父A": {}}
    assert json.loads((tmp_path / "status.json").read_text())["refreshed"] == "東京-02"
