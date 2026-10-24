"""保存したその日のデータが、JRAの開催ページのレース一覧と合っているかを確かめる調査用コマンド。

ログは公開されるので、馬名は出さず、合っているかどうかと数字だけを出す。
  python -m keiba.check_day --date YYYY-MM-DD
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import date
from pathlib import Path

from . import jra, parse
from .__main__ import contact, load_config, page_password
from .crypto import decrypt
from .fetch import Fetcher


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--date", required=True)
    day = date.fromisoformat(p.parse_args().date)
    saved = decrypt(json.loads(Path(f"data/days/{day.isoformat()}.json").read_text()), page_password())
    races = saved["races"]
    keys = Counter((r["venue"], r["number"]) for r in races)
    print("保存したレース数:", len(races), "重複:", [k for k, c in keys.items() if c > 1])
    cfg = load_config()
    f = Fetcher(contact(cfg), cfg["fetch"]["delay_sec"], 12)
    _, _, _, top = jra.is_race_day(f, day)
    acts = jra._day_actions(top, "accessD.html", day)
    print("開催ページ:", [(a.cname, parse.parse_venue(a.text)) for a in acts])
    for venue, act in jra._venue_days(f, day, top):
        for row in parse.parse_day_rows(f.post_cname(act.path, act.cname)):
            n = row.fields["number"]
            mine = [r for r in races if r["venue"] == venue and r["number"] == n]
            if not mine:
                print(venue, n, "保存データにない")
                continue
            r = mine[0]
            diffs = [k for k in ("name", "post_time", "surface", "distance") if row.fields.get(k) != r.get(k)]
            heads = len([h for h in r.get("horses", []) if not h.get("scratched")])
            print(venue, n, "OK" if not diffs else f"違う: {diffs}", "| 頭数(保存)", heads, "| 一覧の頭数", row.fields.get("field_size"),
                  "| 発走", r.get("post_time"), row.fields.get("post_time"))


if __name__ == "__main__":
    main()
