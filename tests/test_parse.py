"""パーサーのテスト。

HTML は JRA のページを模して手で書いた最小限のものです（実際のページの写しではありません）。
実ページで読み取りに失敗したら、そのとき分かった構造に合わせてここにケースを足してください。
"""
from keiba import parse


def test_extract_actions_with_context():
    html = """
    <ul>
      <li><div>10月25日（土曜）</div>
        <a href="#" onclick="return doAction('/JRADB/accessD.html', 'pw01dde0105202504070120251025/AB');">4回東京7日</a></li>
      <li><div>10月26日（日曜）</div>
        <a href="javascript:doAction('/JRADB/accessD.html','pw01dde0105202504080120251026/CD')">4回東京8日</a></li>
    </ul>"""
    acts = parse.extract_actions(html)
    assert [a.cname[-2:] for a in acts] == ["AB", "CD"]
    assert parse.mentions_date(acts[0].context, 10, 25)
    assert not parse.mentions_date(acts[0].context, 10, 26)
    assert parse.parse_venue(acts[1].text) == "東京"


def test_race_number():
    assert parse.parse_race_number("11R") == 11
    assert parse.parse_race_number(parse.norm("１レース")) == 1
    assert parse.parse_race_number("2000m") is None


def test_conditions_turf_handicap_fillies():
    h = parse.norm("4回東京7日 11R アイビーステークス 3歳以上３勝クラス （混）（牝）［指定］ ハンデ "
                   "コース：1,800メートル（芝・左） 15時45分発走 馬番 馬名 牝4")
    c = parse.parse_conditions(parse.header_part(h))
    assert c["surface"] == "芝" and c["distance"] == 1800
    assert c["race_class"] == "3勝クラス"
    assert c["handicap"] and c["fillies_only"]
    assert c["post_time"] == "15:45"


def test_conditions_dirt_and_grades():
    c = parse.parse_conditions("2歳未勝利 ダート 1,200メートル 馬齢")
    assert (c["surface"], c["distance"], c["race_class"]) == ("ダート", 1200, "未勝利")
    assert not c["handicap"] and not c["fillies_only"]
    assert parse.parse_conditions(parse.norm("天皇賞（秋）（ＧⅠ） 芝 2000メートル"))["race_class"] == "G1"
    assert parse.parse_conditions("毎日王冠(GII) 芝1800m")["race_class"] == "G2"
    assert parse.parse_conditions("(GIII) 芝1600m")["race_class"] == "G3"


def test_conditions_jump():
    c = parse.parse_conditions("障害3歳以上未勝利 芝→ダート 2,880メートル")
    assert c["surface"] == "障害" and c["distance"] == 2880


def test_header_part_ignores_horse_sex():
    text = "3歳以上1勝クラス 芝1600m 定量 馬番 馬名 性齢 1 サンプル 牝3"
    assert not parse.parse_conditions(parse.header_part(text))["fillies_only"]


ODDS_HTML = """
<table><tr><th>枠</th><th>馬番</th><th>馬名</th><th>単勝</th><th>複勝</th></tr>
<tr><td>1</td><td>1</td><td>アルファ</td><td class="odds_tan">3.4</td><td>1.2-1.6</td></tr>
<tr><td>2</td><td>2</td><td>ブラボー</td><td class="odds_tan">12.0</td><td>3.0-4.5</td></tr>
<tr><td>3</td><td>3</td><td>チャーリー</td><td>取消</td><td></td></tr>
<tr><td>4</td><td>4</td><td>デルタ</td><td class="odds_tan">1,024.5</td><td>99.0-150.0</td></tr>
</table>"""


def test_win_odds_skips_scratched():
    assert parse.parse_win_odds(ODDS_HTML) == [3.4, 12.0, 1024.5]


def test_field_size_from_table():
    assert parse.parse_field_size(ODDS_HTML) == 3


def test_going():
    assert parse.parse_going("東京競馬場 馬場状態 芝：良 ダート：稍重") == {"芝": "良", "ダート": "稍重"}
    assert parse.parse_going("芝 不良 ダート 重") == {"芝": "不良", "ダート": "重"}


# 開催ページの一覧表の行（2026年10月に確認した構造を最小限に再現）
DAY_HTML = """
<table>
<tr><th class="race_num" scope="col">レース<span>番号</span></th><th class="time">発走時刻</th>
<th class="race_name">レース名</th><th class="dist"><span>コース</span><span>距離</span><span>頭数</span></th>
<th class="odds">オッズ</th></tr>
<tr><th class="race_num" scope="row"><a href="/JRADB/accessD.html?CNAME=pw01dde0105202604080120261024/D9">
<img alt="1レース" src="x.png"/></a></th>
<td class="time">10時05分</td>
<td class="race_name"><div><div> 2歳未勝利（混合）［指定］</div><div></div></div></td>
<td class="change"></td>
<td class="dist"><span class="course">ダート</span><span class="dist">1,400<span class="unit">m</span></span>
<span class="num">14<span class="unit">頭</span></span></td>
<td class="odds"> 未発表</td></tr>
<tr><th class="race_num" scope="row"><a href="/JRADB/accessD.html?CNAME=pw01dde0105202604081120261024/2B">
<img alt="11レース" src="x.png"/></a></th>
<td class="time">15時45分</td>
<td class="race_name"><div><div>アルファステークス</div><div>3歳以上オープン（国際）（牝）（特指）</div></div></td>
<td class="dist"><span class="course">芝</span><span class="dist">1,800<span class="unit">m</span></span>
<span class="num">18<span class="unit">頭</span></span></td>
<td class="odds"><a href="#" onclick="doAction('/JRADB/accessO.html','pw151ou1005202604081120261024Z/AA');">オッズ</a></td></tr>
</table>"""


def test_day_rows():
    rows = parse.parse_day_rows(DAY_HTML)
    assert [r.fields["number"] for r in rows] == [1, 11]
    r1, r11 = rows
    assert r1.fields["post_time"] == "10:05"
    assert (r1.fields["surface"], r1.fields["distance"], r1.fields["field_size"]) == ("ダート", 1400, 14)
    assert r1.fields["race_class"] == "未勝利"
    assert r1.race_link.cname is None and "CNAME=" in r1.race_link.path
    assert r1.odds_link is None
    assert r11.fields["race_class"] == "オープン" and r11.fields["fillies_only"]
    assert r11.fields["surface"] == "芝" and r11.fields["field_size"] == 18
    assert r11.odds_link.cname.startswith("pw151ou")


def test_weight_rule():
    assert parse.parse_weight_rule("<div><span>ハンデ</span></div>") == "ハンデ"
    assert parse.parse_weight_rule("<p>定量</p><td>牝4</td>") == "定量"
    assert parse.parse_weight_rule("<p>なし</p>") is None


def test_day_rows_bare_fillies_mark():
    html = DAY_HTML.replace("2歳未勝利（混合）［指定］", "2歳未勝利牝[指定]")
    assert parse.parse_day_rows(html)[0].fields["fillies_only"]
