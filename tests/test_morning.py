import json

from keiba.__main__ import morning_inputs
from keiba.crypto import encrypt
from keiba.models import Race


def test_from_dict_keeps_morning_odds():
    r = Race.from_dict({"venue": "東京", "number": 1, "horses": [
        {"number": 1, "name": "A", "odds": 2.5, "odds_morning": 3.1, "place_odds_morning": [1.2, 1.5]}]})
    assert r.horses[0].odds_morning == 3.1 and r.horses[0].place_odds_morning == [1.2, 1.5]


def test_morning_inputs_swaps_only_odds(tmp_path):
    pw = "pw"
    (tmp_path / "days").mkdir()
    day = {"date": "2026-11-01", "sample": False, "races": [
        {"venue": "東京", "number": 1, "surface": "芝", "horses": [
            {"number": 1, "name": "A", "odds": 2.0, "odds_morning": 3.0, "place_odds_morning": [1.1, 1.3], "past": []},
            {"number": 2, "name": "B", "odds": 4.0, "odds_morning": None, "past": []}]},
        {"venue": "東京", "number": 2, "surface": "芝", "horses": [{"number": 1, "name": "C", "odds": 5.0, "past": []}]},
    ]}
    (tmp_path / "days" / "2026-11-01.json").write_text(json.dumps(encrypt(day, pw)))
    cache = {"races": {
        "2026-11-01|東京-1": {"odds": {"1": {"win": 1.8, "place": [1.0, 1.2]}, "2": {"win": 5.5, "place": [1.5, 2.0]}},
                              "payouts": {"win": [{"nums": [1], "yen": 180}]},
                              "runners": [{"place": 2, "number": 2, "popularity": 2, "corners": []},
                                          {"place": 1, "number": 1, "popularity": 1, "corners": []},
                                          {"place": None, "number": 3, "popularity": None, "corners": []}]},
        "2026-11-01|東京-2": {"odds": {"1": {"win": 5.0}}, "payouts": {}, "runners": []},
    }}
    (morning, final), labels = morning_inputs(tmp_path, pw, cache)
    assert len(labels) == 2
    m, f = morning[0]["races"], final[0]["races"]
    assert len(m) == len(f) == 1                          # 朝のオッズがないレースは除く
    assert [h["odds"] for h in m[0]["horses"]] == [3.0, None]
    assert [h["odds"] for h in f[0]["horses"]] == [1.8, 5.5]
    assert f[0]["horses"][1]["place_odds"] == [1.5, 2.0]
    assert morning[1]["2026-11-01|東京-1"] == final[1]["2026-11-01|東京-1"]
    assert [x["number"] for x in final[1]["2026-11-01|東京-1"]] == [1, 2]
    assert final[0]["payouts"]["2026-11-01|東京-1"]["win"][0]["yen"] == 180
