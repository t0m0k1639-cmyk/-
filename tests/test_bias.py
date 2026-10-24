from keiba import bias


def rows(front_top3: bool, inner_top3: bool, n: int = 10):
    """3着以内が4角で前（または後ろ）、内枠（または外枠）だったレースの結果。"""
    order = list(range(1, n + 1)) if inner_top3 else list(range(n, 0, -1))
    out = []
    for place, num in enumerate(order, 1):
        pos = place if front_top3 else n + 1 - place
        out.append({"place": place, "number": num, "popularity": place, "corners": [pos, pos]})
    return out


def test_front_and_inner_bias():
    races = [{"venue": "東京", "number": i, "surface": "芝", "post_time": f"{9 + i}:00"} for i in range(1, 7)] + \
            [{"venue": "京都", "number": i, "surface": "ダート", "post_time": f"{9 + i}:00"} for i in range(1, 7)]
    raw = {f"東京-{i}": rows(True, True) for i in range(1, 7)}
    raw.update({f"京都-{i}": rows(False, False) for i in range(1, 7)})
    out = bias.compute([(races, raw)])
    assert out["東京|芝"]["front"] > 0 and out["東京|芝"]["inner"] > 0
    assert out["京都|ダート"]["front"] < 0 and out["京都|ダート"]["inner"] < 0
    assert out["東京|芝"]["label"] == "前残り・内枠有利"
    assert out["京都|ダート"]["label"] == "差し・追込が届く・外枠有利"
    assert out["東京|芝"]["races"] == 6


def test_before_uses_only_earlier_races():
    races = [{"venue": "東京", "number": i, "surface": "芝", "post_time": f"{9 + i}:00"} for i in range(1, 7)]
    raw = {f"東京-{i}": rows(True, True) for i in range(1, 7)}
    out = bias.compute([(races, raw)], before=("2026-10-25", 12 * 60))   # 10〜11時の2レースだけ
    assert out["東京|芝"]["races"] == 2


def test_few_races_are_weakened():
    races = [{"venue": "東京", "number": 1, "surface": "芝", "post_time": "10:00"},
             {"venue": "東京", "number": 2, "surface": "ダート", "post_time": "10:30"}]
    raw = {"東京-1": rows(True, True), "東京-2": rows(False, False)}
    one = bias.compute([(races, raw)])["東京|芝"]
    assert one["races"] == 1 and abs(one["front"]) < 0.2


def test_finished():
    from datetime import datetime
    assert bias.finished({"post_time": "10:05"}, datetime(2026, 10, 25, 10, 20))
    assert not bias.finished({"post_time": "10:05"}, datetime(2026, 10, 25, 10, 15))
    assert not bias.finished({"post_time": None}, datetime(2026, 10, 25, 10, 15))
