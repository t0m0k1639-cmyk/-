from datetime import date

from keiba import backtest

DAY = """<table><tr><th class="race_num">レース</th></tr>
<tr><th class="race_num"><a href="/JRADB/accessS.html?CNAME=pw01sde1005202604090120261025/A4"><img alt="1レース"/></a></th>
<td class="race_name"><div><div> 2歳未勝利（混合）[指定]</div></div></td>
<td class="dist">1,600<span>メートル</span></td><td class="course">ダート</td><td class="num">16<span>頭</span></td>
<td class="odds"><a href="#" onclick="return doAction('/JRADB/accessO.html', 'pw151ou1005202604090120261025Z/E6');"><img alt="1レースオッズ"/></a></td></tr>
</table>"""

RESULT = """<table>
<tr><td class="place">1</td><td class="waku"><img alt="枠7橙"/></td><td class="num">12</td>
<td class="horse"><a href="/JRADB/accessU.html?CNAME=pw01dud002024108240/08">ウマA</a></td><td class="age">牡2</td>
<td class="weight">56.0</td><td class="jockey"><a>騎手A</a></td><td class="time">1:25.3</td><td class="margin"></td>
<td class="corner"><div class="corner_list"><ul><li>6</li><li>5</li></ul></div></td><td class="f_time">36.5</td>
<td class="h_weight">538<span>(+4)</span></td><td class="pop">1</td></tr>
<tr><td class="place">2</td><td class="waku"><img alt="枠5黄"/></td><td class="num">8</td>
<td class="horse"><a href="/JRADB/accessU.html?CNAME=pw01dud002024102821/E7">ウマB</a></td><td class="age">牡2</td>
<td class="weight">56.0</td><td class="jockey">騎手B</td><td class="time">1:25.4</td><td class="margin">1</td>
<td class="corner"><ul><li>3</li><li>3</li></ul></td><td class="f_time">36.7</td>
<td class="h_weight">464<span>(0)</span></td><td class="pop">3</td></tr>
<tr><td class="place">取消</td><td class="waku"><img alt="枠1白"/></td><td class="num">1</td>
<td class="horse"><a href="/JRADB/accessU.html?CNAME=pw01dud002024100001/11">ウマC</a></td><td class="age">牝2</td>
<td class="weight">54.0</td><td class="jockey">騎手C</td><td class="time"></td><td class="corner"></td>
<td class="f_time"></td><td class="h_weight"></td><td class="pop"></td></tr>
</table>"""


def test_parse_result_day_rows():
    rows = backtest.parse_result_day_rows(DAY)
    assert rows == [{"number": 1, "name": "2歳未勝利(混合)[指定]", "race_class": "未勝利", "surface": "ダート",
                     "distance": 1600, "link": "/JRADB/accessS.html?CNAME=pw01sde1005202604090120261025/A4",
                     "odds_link": rows[0]["odds_link"]}]
    assert (rows[0]["odds_link"].path, rows[0]["odds_link"].cname) == ("/JRADB/accessO.html", "pw151ou1005202604090120261025Z/E6")


def test_parse_result_runners():
    rs = backtest.parse_result_runners(RESULT)
    assert [(r["place"], r["number"], r["horse_id"], r["waku"]) for r in rs] == [
        (1, 12, "2024108240", 7), (2, 8, "2024102821", 5), (None, 1, "2024100001", 1)]
    assert rs[0]["corners"] == [6, 5] and rs[0]["last3f"] == 36.5 and rs[0]["body_weight_diff"] == 4
    assert rs[2]["status"] == "取消"


def test_day_actions():
    html = """<a href="#" onclick="return doAction('/JRADB/accessS.html', 'pw01srl10062026040120260905/FA');">4回中山1日</a>"""
    (d, venue, act), = backtest.day_actions(html)
    assert d == date(2026, 9, 5) and venue == "中山" and act.cname.endswith("/FA")


def test_build_eval_input_uses_only_earlier_runs():
    runners = backtest.parse_result_runners(RESULT)
    race = lambda d, n: {"date": d, "venue": "東京", "number": n, "name": "2歳未勝利", "race_class": "未勝利",
                         "surface": "ダート", "distance": 1600, "going": "良", "runners": runners, "payouts": {}}
    cache = {"races": {"2026-09-01|東京-1": race("2026-09-01", 1), "2026-10-04|東京-2": race("2026-10-04", 2),
                       "2026-10-11|東京-3": race("2026-10-11", 3)}, "days": []}
    day, results = backtest.build_eval_input(cache, date(2026, 10, 4), date(2026, 10, 31))
    assert [r["rkey"] for r in day["races"]] == ["2026-10-04|東京-2", "2026-10-11|東京-3"]
    a = day["races"][0]["horses"][0]
    assert [p["date"] for p in a["past"]] == ["2026年9月1日"]       # 当日と、それより後の走は入れない
    assert a["past"][0]["margin"] == 0.0 and day["races"][0]["horses"][1]["past"][0]["margin"] == 0.1
    assert day["races"][1]["horses"][0]["past"][0]["date"] == "2026年10月4日"
    assert day["races"][0]["horses"][2]["scratched"]
    assert results["2026-10-04|東京-2"][0] == {"place": 1, "number": 12, "popularity": 1, "corners": [6, 5]}
