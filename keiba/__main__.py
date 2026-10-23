"""使い方:
  python -m keiba run [--date YYYY-MM-DD]   JRA公式サイトから取得してスコアを data/ に書く
  python -m keiba sample                     サンプルデータ（架空）でスコアを data/ に書く
  python -m keiba build-site --out _site     site/ と data/ を公開用にまとめる
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import sys
import tomllib
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from . import jra
from .crypto import encrypt
from .fetch import FetchError, Fetcher
from .models import Race
from .score import score_day

ROOT = Path(__file__).resolve().parent.parent
JST = ZoneInfo("Asia/Tokyo")
log = logging.getLogger("keiba")


class ParseError(RuntimeError):
    pass


def load_config(path: Path = ROOT / "config.toml") -> dict:
    with open(path, "rb") as fp:
        return tomllib.load(fp)


def contact(cfg: dict) -> str:
    if os.environ.get("KEIBA_CONTACT"):
        return os.environ["KEIBA_CONTACT"]
    if cfg["fetch"].get("contact"):
        return cfg["fetch"]["contact"]
    repo = os.environ.get("GITHUB_REPOSITORY")
    return f"https://github.com/{repo}" if repo else "personal use"


def set_output(key: str, value: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a") as fp:
            fp.write(f"{key}={value}\n")


def validate(races: list[Race]) -> list[str]:
    """取得結果がおかしければ ParseError。軽い問題は警告として返す。"""
    if not races:
        raise ParseError("開催日なのにレースを1つも読み取れませんでした（ページ構成が変わった可能性）")
    complete = [r for r in races if r.surface and r.distance and r.field_size]
    if len(complete) < 0.7 * len(races):
        raise ParseError(f"レース条件を読み取れたのは {len(complete)}/{len(races)} レースだけでした"
                         "（ページ構成が変わった可能性）")
    warnings = []
    with_odds = sum(1 for r in races if r.win_odds)
    if with_odds < len(races):
        warnings.append(f"オッズを取得できたのは {with_odds}/{len(races)} レースです")
    with_horses = sum(1 for r in races if r.horses)
    if with_horses < len(races):
        warnings.append(f"出走馬を読み取れたのは {with_horses}/{len(races)} レースです")
    if not any(r.going for r in races):
        warnings.append("馬場状態を取得できませんでした")
    return warnings


def page_password() -> str | None:
    return os.environ.get("PAGE_PASSWORD") or None


def write_day(data_dir: Path, day: date, races: list[Race], cfg: dict,
              warnings: list[str], password: str, sample: bool = False) -> None:
    """出走馬・オッズを含むので、パスワードで暗号化して保存する。"""
    scored = score_day(races, cfg)
    payload = {
        "date": day.isoformat(),
        "generated_at": datetime.now(JST).isoformat(timespec="minutes"),
        "sample": sample,
        "source": "サンプル（架空のデータ）" if sample else "JRA公式サイト（日本中央競馬会）",
        "warnings": warnings,
        "races": [s.to_dict() for s in scored],
    }
    (data_dir / "days").mkdir(parents=True, exist_ok=True)
    text = json.dumps(encrypt(payload, password))
    (data_dir / "days" / f"{day.isoformat()}.json").write_text(text)
    (data_dir / "latest.json").write_text(text)
    dates = sorted((p.stem for p in (data_dir / "days").glob("*.json")), reverse=True)
    (data_dir / "dates.json").write_text(json.dumps(dates))
    write_status(data_dir, day, "ok", "", warnings)


def write_status(data_dir: Path, day: date, state: str, message: str, warnings=()) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "status.json").write_text(json.dumps({
        "date": day.isoformat(),
        "checked_at": datetime.now(JST).isoformat(timespec="minutes"),
        "state": state,
        "message": message,
        "warnings": list(warnings),
    }, ensure_ascii=False, indent=1))


def cmd_run(args) -> int:
    cfg = load_config()
    day = date.fromisoformat(args.date) if args.date else datetime.now(JST).date()
    data_dir = Path(args.data)
    password = page_password()
    if not password:
        msg = "ページのパスワード（GitHub の Secret「PAGE_PASSWORD」）が設定されていません"
        log.error(msg)
        write_status(data_dir, day, "error", msg)
        set_output("updated", "true")
        return 2
    try:
        f = Fetcher(contact(cfg), cfg["fetch"]["delay_sec"], cfg["fetch"]["max_requests"])
        race_day, entry_d, entry_o, top_d = jra.is_race_day(f, day)
        if not race_day:
            if day.weekday() >= 5:
                # 土日はほぼ必ず開催がある。見つからないのは読み取り失敗の可能性が高い
                raise ParseError("土日なのに当日の開催が見つかりませんでした"
                                 "（年末年始などの休催日でなければ、ページ構成が変わった可能性）")
            log.info("%s は開催日ではありません", day)
            set_output("updated", "false")
            return 0
        races = jra.collect(f, day, top_d)
        try:
            going = jra.collect_going(f)
        except FetchError as e:
            log.warning("馬場情報の取得に失敗: %s", e)
            going = {}
        jra.merge_going(races, going)
        warnings = validate(races)
    except (FetchError, ParseError) as e:
        log.error("%s", e)
        write_status(data_dir, day, "error", str(e))
        set_output("updated", "true")
        return 2
    write_day(data_dir, day, races, cfg, warnings, password)
    log.info("%d レースを書き出しました（リクエスト %d 件）", len(races), f.count)
    set_output("updated", "true")
    return 0


def cmd_sample(args) -> int:
    cfg = load_config()
    raw = json.loads((ROOT / "sample" / "races.json").read_text())
    races = [Race.from_dict(r) for r in raw["races"]]
    for r in races:
        r.win_odds = [h.odds for h in r.horses if h.odds and not h.scratched]
    password = page_password() or "sample"
    write_day(Path(args.data), date.fromisoformat(raw["date"]), races, cfg, [], password, sample=True)
    log.info("サンプルのパスワード: %s", password)
    return 0


def cmd_build_site(args) -> int:
    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "site", out)
    data = Path(args.data)
    if data.exists():
        shutil.copytree(data, out / "data", ignore=shutil.ignore_patterns(".gitkeep"))
    return 0


def main(argv=None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    p = argparse.ArgumentParser(prog="keiba")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--date")
    r.add_argument("--data", default=str(ROOT / "data"))
    s = sub.add_parser("sample")
    s.add_argument("--data", default=str(ROOT / ".preview" / "data"))
    b = sub.add_parser("build-site")
    b.add_argument("--out", default="_site")
    b.add_argument("--data", default=str(ROOT / "data"))
    args = p.parse_args(argv)
    return {"run": cmd_run, "sample": cmd_sample, "build-site": cmd_build_site}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
