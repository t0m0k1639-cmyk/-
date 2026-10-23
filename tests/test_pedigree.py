from datetime import date

from keiba import pedigree
from keiba.models import Horse, Race


def past(d, surface, place, margin, corners=(3,), heads=12):
    return {"date": d, "surface": surface, "place": place, "heads": heads, "margin": margin,
            "corners": list(corners), "time": "1:35.0", "distance": 1600, "last3f": 35.0}


def test_store_dedupes_and_summarizes(tmp_path):
    today = date(2026, 10, 24)
    h1 = Horse(number=1, name="アルファ", sex_age="牡3", sire="ダートサイアー", dam_sire="ブルードA", past=[
        past("2026年10月1日", "ダ", 1, 0.0), past("2026年9月1日", "ダ", 2, 0.1),
        past("2025年8月1日", "ダ", 1, 0.0),   # 2歳時
        past("2026年6月1日", "芝", 10, 2.5)])
    h2 = Horse(number=2, name="ブラボー", sex_age="牝2", sire="ダートサイアー", past=[
        past("2026年9月20日", "ダ", 3, 0.4)])
    h3 = Horse(number=3, name="チャーリー", sex_age="牡4", sire="シバサイアー", past=[
        past("2026年10月1日", "芝", 1, 0.0), past("2026年9月1日", "芝", 2, 0.2),
        past("2026年8月1日", "芝", 1, 0.0), past("2026年7月1日", "ダ", 12, 3.0)])
    race = Race(venue="東京", number=1, horses=[h1, h2, h3])
    store = pedigree.Store(tmp_path / "p.json", "pw")
    assert store.add([race], today) == 9
    assert store.add([race], today) == 0          # 同じ走は数えない
    store.save()
    assert "ダートサイアー" not in (tmp_path / "p.json").read_text()   # 暗号化されている
    again = pedigree.Store(tmp_path / "p.json", "pw")
    assert len(again.runs) == 9

    s = pedigree.summarize(again.runs, {"ダートサイアー", "シバサイアー", "ブルードA"})
    assert s["ダートサイアー"]["sire"]["label"] == "ダート向き"
    assert s["シバサイアー"]["sire"]["label"] == "芝向き"
    assert s["ダートサイアー"]["sire"]["all"]["ダ"]["n"] == 4
    # 2歳時の走: アルファの2025年の走と、ブラボー（今2歳）の走
    assert s["ダートサイアー"]["sire"]["two"]["ダ"]["n"] == 2
    assert "dam_sire" in s["ブルードA"]


def test_wrong_password_starts_fresh(tmp_path):
    store = pedigree.Store(tmp_path / "p.json", "pw")
    store.runs = {"k": ["A", "", "芝", "2026-10-01", 0.0, 0.1, 1.0, True, False]}
    store.save()
    assert pedigree.Store(tmp_path / "p.json", "other").runs == {}
