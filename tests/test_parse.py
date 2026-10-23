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
