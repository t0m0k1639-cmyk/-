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


# 出馬表の馬の表（2026年10月に確認した構造を最小限に再現。馬名などは架空）
RACE_HTML = """
<div class="cell weight">定量</div>
<table class="basic narrow-xy mt20">
<tr><th class="waku">枠</th><th class="num">馬番</th><th class="horse">馬名 / 単勝オッズ(人気)</th>
<th class="jockey">性齢/毛色<br/>負担重量<br/>騎手名</th><th class="past p1">前走</th></tr>
<tr><td class="waku"><img alt="枠1白" src="/JRADB/img/waku/1.png"/></td><td class="num">1</td>
<td class="horse"><div class="name_line"><div class="name"><a href="#">テストアルファ</a></div>
<div class="odds"><span class="num">3.4</span><span class="pop">(2番人気)</span></div></div>
<div class="result_line"><div class="cell result">(1.0.0.2)</div></div>
<p class="trainer"><a href="#">調教師 一郎</a><span class="division">(美浦)</span></p></td>
<td class="jockey"><p class="age">牝3/鹿毛</p><p class="weight">55.0kg</p><p class="jockey"><a href="#">騎手 太郎</a></p></td>
<td class="past p1">1着 12.3</td></tr>
<tr><td class="waku"><img alt="枠2黒" src="/JRADB/img/waku/2.png"/></td><td class="num">2</td>
<td class="horse"><div class="name_line"><div class="name"><a href="#">テストブラボー</a></div></div>
<div class="result_line"><div class="cell result">(0.0.0.2)</div></div></td>
<td class="jockey"><p>牡4/栗毛</p><p>57.0kg</p><p class="jockey">騎手 次郎</p></td></tr>
<tr><td class="waku"><img alt="枠3赤" src="/JRADB/img/waku/3.png"/></td><td class="num">3</td>
<td class="horse"><div class="name_line"><div class="name">テストチャーリー</div><div>取消</div></div></td>
<td class="jockey"><p>セ5/芦毛</p><p>56.0kg</p></td></tr>
</table>"""


def test_parse_horses():
    a, b, c = parse.parse_horses(RACE_HTML)
    assert (a.number, a.waku, a.name) == (1, 1, "テストアルファ")
    assert (a.sex_age, a.weight, a.jockey) == ("牝3", 55.0, "騎手 太郎")
    assert (a.odds, a.popularity) == (3.4, 2)
    assert a.trainer == "調教師 一郎"
    # 発売前（オッズなし）。前走欄の数字や (0.0.0.2) をオッズと取り違えない
    assert b.odds is None and b.popularity is None
    assert (b.sex_age, b.weight, b.jockey) == ("牡4", 57.0, "騎手 次郎")
    assert c.scratched and not a.scratched
    assert parse.parse_weight_rule(RACE_HTML) == "定量"


# 前走欄（2026年10月に確認した構造。名前などは架空）
PAST_TD = """<table><tr><td class="num">1</td><td class="horse"><div class="name">テストデルタ</div></td>
<td class="jockey"><p>牝3/鹿毛</p><p>55.0kg</p><p class="jockey">騎手 三郎</p></td>
<td class="past p1"><div class="date_line"><div class="date">2026年10月10日</div><div class="rc">東京</div></div>
<div class="race_line"><div class="name"><a href="#">3歳以上1勝クラス</a></div><div class="r_class"></div></div>
<div class="place_line"><div class="place">14<span>着</span></div><div class="num"><span class="max">16<span>頭</span></span>
<span class="gate">8<span>番</span></span><span class="pop">14<span>番人気</span></span></div></div>
<div class="info_line1"><div class="jockey">騎手 四郎</div><div class="weight">54.0<span>kg</span></div></div>
<div class="info_line2"><div class="line"><div class="col left"><span class="dist">1800ダ</span></div>
<div class="col right"><p class="time">1:54.7</p></div></div><div class="line"><div class="col left"><span class="condition">良</span></div>
<div class="col right"><p class="h_weight">442<span>kg</span></p></div></div></div>
<div class="info_line3"><div class="line"><div class="corner_list"><ul><li title="1コーナー">4</li><li>5</li><li>5</li><li>5</li></ul></div>
<div class="f3">3F 39.2</div></div><p class="fin">テストウィナー<span class="time">(2.5)</span></p></div></td>
<td class="past p2"><div class="date_line"><div class="date">2026年5月17日</div><div class="rc">新潟</div></div>
<div class="race_line"><div class="name">精進湖特別</div><div class="r_class">2勝クラス</div></div>
<div class="place_line"><div class="place">1<span>着</span></div><div class="num"><span class="max">13<span>頭</span></span></div></div>
<div class="info_line2"><span class="dist">1600芝</span><p class="time">1:33.9</p><span class="condition">稍重</span></div>
<div class="info_line3"><div class="corner_list"><ul><li>3</li><li>3</li></ul></div><div class="f3">3F 34.0</div>
<p class="fin">テストセカンド<span class="time">(0.1)</span></p></div></td>
<td class="past p3"></td></tr></table>"""


def test_parse_past():
    [h] = parse.parse_horses(PAST_TD.replace("<table>", "<table><tr><th>馬名</th></tr>"))
    p1, p2 = h.past
    assert p1["date"] == "2026年10月10日" and p1["venue"] == "東京"
    assert (p1["place"], p1["heads"], p1["gate"]) == (14, 16, 8)
    assert (p1["surface"], p1["distance"], p1["going"]) == ("ダ", 1800, "良")
    assert (p1["time"], p1["last3f"], p1["margin"]) == ("1:54.7", 39.2, 2.5)
    assert p1["corners"] == [4, 5, 5, 5] and p1["jockey"] == "騎手 四郎" and p1["weight"] == 54.0
    assert "1勝クラス" in p1["name"]
    assert p2["race_class"] == "2勝クラス" and p2["place"] == 1 and p2["margin"] == 0.0
    assert (p2["surface"], p2["distance"], p2["going"]) == ("芝", 1600, "稍重")


def test_course_detail():
    html = '<div class="cell course"><span class="cap">コース：</span>1,800<span class="detail">（芝・右・外）</span></div>'
    assert parse.parse_course_detail(html) == "芝・右・外"


def test_pedigree_and_connections():
    html = """<table><tr><th>馬名</th></tr><tr><td class="num">1</td><td class="horse">
    <div class="name_line"><div class="name"><a href="#">テストエコー</a></div></div>
    <p class="owner">(有)テスト牧場</p><p class="breeder">テストファーム</p>
    <p class="trainer"><a href="#">調教師 五郎</a><span class="division">(栗東)</span></p>
    <ul class="family_line"><li class="sire"><span>父：</span>テストサイアー</li>
    <li class="mare"><span>母：</span>テストメア<span class="bloodmare">(母の父：テストブルード)</span></li></ul>
    </td><td class="jockey"><p>牡2/黒鹿毛</p><p>55.0kg</p><p class="jockey">騎手 六郎</p></td></tr></table>"""
    [h] = parse.parse_horses(html)
    assert (h.sire, h.dam, h.dam_sire) == ("テストサイアー", "テストメア", "テストブルード")
    assert (h.trainer, h.stable) == ("調教師 五郎", "栗東")
    assert (h.owner, h.breeder) == ("(有)テスト牧場", "テストファーム")
    assert h.past == []


BABA_CUSHION = """<div id="cushion_data_list">
<div id="rcA" title="東京"><div class="unit"><div class="time">10月24日(土曜)7時00分</div><div class="cushion">9.5</div></div>
<div class="unit"><div class="time">10月23日(金曜)9時00分</div><div class="cushion">9.9</div></div></div>
<div id="rcB" title="京都"><div class="unit"><div class="time">10月24日(土曜)6時00分</div><div class="cushion">9.5</div></div></div>
</div>"""
BABA_MOIST = """<div id="moist_data_list">
<div id="rcA" title="東京"><div class="unit"><div class="time">10月24日(土曜)5時00分</div>
<div class="turf"><span class="mg" data-condition="hard">12.7</span><span class="m4c">15.5</span></div>
<div class="dirt"><span class="mg">2.0</span><span class="m4c">2.4</span></div></div>
<div class="unit"><div class="time">10月23日(金曜)8時30分</div><div class="turf"><span class="mg">1.0</span><span class="m4c">1.0</span></div></div></div>
</div>"""


def test_baba_data_latest_per_venue():
    d = parse.parse_baba_data(BABA_CUSHION, BABA_MOIST)
    assert d["東京"]["cushion"] == 9.5 and d["京都"]["cushion"] == 9.5
    assert d["東京"]["moist_turf"] == [12.7, 15.5] and d["東京"]["moist_dirt"] == [2.0, 2.4]
    assert d["東京"]["cushion_time"] == "10月24日(土曜)7時00分"
    assert "moist_turf" not in d["京都"]


def test_body_weight():
    base = """<table><tr><th>馬名</th></tr><tr><td class="num">{n}</td><td class="horse">
    <div class="name_line"><div class="name">テスト{n}</div></div>
    <div class="result_line">{w}</div></td><td class="jockey"><p>牡3</p><p>57.0kg</p></td>
    <td class="past p1"><div class="date">2026年10月1日</div><p class="h_weight">500<span>kg</span></p></td></tr></table>"""
    [a] = parse.parse_horses(base.format(n=1, w='<div class="cell weight">442kg<span class="transition">(+8)</span></div>'))
    assert (a.body_weight, a.body_weight_diff) == (442, 8)
    [b] = parse.parse_horses(base.format(n=2, w='<div class="cell weight">506kg<span class="transition">(-12)</span></div>'))
    assert (b.body_weight, b.body_weight_diff) == (506, -12)
    [c] = parse.parse_horses(base.format(n=3, w='<div class="cell weight">444kg<span class="transition">(0)</span></div>'))
    assert c.body_weight_diff == 0
    # 発表前（戦績だけ）は読まない。前走欄の馬体重とも取り違えない
    [d] = parse.parse_horses(base.format(n=4, w='<div class="cell result">(0.0.0.2)</div>'))
    assert d.body_weight is None and d.body_weight_diff is None


def test_parse_result():
    html = """<table><tr><th class="place">着順</th></tr>
    <tr><td class="place">2</td><td class="num">8</td><td class="pop">3</td></tr>
    <tr><td class="place">1</td><td class="num">12</td><td class="pop">1</td>
      <td class="corner"><div class="corner_list"><ul><li title="3コーナー">6</li><li title="4コーナー">5</li></ul></div></td></tr>
    <tr><td class="place">中止</td><td class="num">5</td><td class="pop">9</td></tr></table>"""
    assert parse.parse_result(html) == [
        {"place": 1, "number": 12, "popularity": 1, "corners": [6, 5]},
        {"place": 2, "number": 8, "popularity": 3, "corners": []},
    ]


def test_parse_payouts():
    html = """<div class="refund_unit"><ul>
    <li class="win"><dl><dd><div class="line"><div class="num">16</div><div class="yen">990<span>円</span></div></div></dd></dl></li>
    <li class="place"><dl><dd>
      <div class="line"><div class="num">16</div><div class="yen">320円</div></div>
      <div class="line"><div class="num">13</div><div class="yen">180円</div></div></dd></dl></li>
    <li class="wide"><dl><dd><div class="line"><div class="num">11-16</div><div class="yen">1,750円</div></div></dd></dl></li>
    <li class="tierce"><dl><dd><div class="line"><div class="num">16-13-11</div><div class="yen">40,860円</div></div></dd></dl></li>
    </ul></div>"""
    p = parse.parse_payouts(html)
    assert p["win"] == [{"nums": [16], "yen": 990}]
    assert [x["yen"] for x in p["place"]] == [320, 180]
    assert p["wide"] == [{"nums": [11, 16], "yen": 1750}]
    assert p["tierce"] == [{"nums": [16, 13, 11], "yen": 40860}]


def test_parse_odds_table():
    from keiba.parse import parse_odds_table
    html = """<table><tr><th>枠</th><th>馬番</th></tr>
    <tr><td class="waku"><img alt="枠1"/></td><td class="num">1</td><td class="horse">ウマA</td><td class="odds_tan">12.5</td><td class="odds_fuku">2.1 - 3.4</td></tr>
    <tr><td class="waku"><img alt="枠2"/></td><td class="num">2</td><td class="horse">ウマB</td><td class="odds_tan">1,234.0</td><td class="odds_fuku">45.0-120.3</td></tr>
    <tr><td class="waku"><img alt="枠3"/></td><td class="num">3</td><td class="horse">ウマC</td><td>取消</td><td></td></tr></table>"""
    assert parse_odds_table(html) == {1: {"win": 12.5, "place": [2.1, 3.4]}, 2: {"win": 1234.0, "place": [45.0, 120.3]}}
