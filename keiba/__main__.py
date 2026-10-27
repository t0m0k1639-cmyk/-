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
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from . import backtest, bias, jra, pedigree
from .crypto import decrypt, encrypt
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
              warnings: list[str], password: str, sample: bool = False,
              pedigree_stats: dict | None = None, bias_stats: dict | None = None) -> None:
    """出走馬・オッズを含むので、パスワードで暗号化して保存する。"""
    scored = score_day(races, cfg)
    payload = {
        "date": day.isoformat(),
        "generated_at": datetime.now(JST).isoformat(timespec="minutes"),
        "sample": sample,
        "source": "サンプル（架空のデータ）" if sample else "JRA公式サイト（日本中央競馬会）",
        "warnings": warnings,
        "races": [s.to_dict() for s in scored],
        "pedigree": pedigree_stats or {},
        "bias": bias_stats or {},   # 開催中の馬場の傾向（keiba/bias.py）
    }
    (data_dir / "days").mkdir(parents=True, exist_ok=True)
    text = json.dumps(encrypt(payload, password))
    (data_dir / "days" / f"{day.isoformat()}.json").write_text(text)
    dates = sorted((p.stem for p in (data_dir / "days").glob("*.json")), reverse=True)
    # 翌日分を先に取り込んだあとで当日のレースを取り直しても、latest は翌日分のままにする
    if dates[0] == day.isoformat():
        (data_dir / "latest.json").write_text(text)
    (data_dir / "dates.json").write_text(json.dumps(dates))
    write_status(data_dir, day, "ok", "", warnings)


def write_status(data_dir: Path, day: date, state: str, message: str, warnings=()) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "status.json").write_text(json.dumps({
        "date": day.isoformat(),
        "checked_at": datetime.now(JST).isoformat(timespec="seconds"),
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
        try:
            baba = jra.collect_baba_data(f)
        except FetchError as e:
            log.warning("含水率・クッション値の取得に失敗: %s", e)
            baba = {}
        jra.merge_going(races, going, baba)
        warnings = validate(races)
    except (FetchError, ParseError) as e:
        log.error("%s", e)
        write_status(data_dir, day, "error", str(e))
        set_output("updated", "true")
        return 2
    # 血統の記録に今日の出馬表の前走欄を足して、今日の出走馬の血統だけ集計する
    store = pedigree.Store(data_dir / "pedigree.json", password)
    added = store.add(races, day)
    store.save()
    names = {n for r in races for h in r.horses for n in (h.sire, h.dam_sire) if n}
    log.info("血統の記録: %d 走を追加（合計 %d 走）", added, len(store.runs))
    write_day(data_dir, day, races, cfg, warnings, password,
              pedigree_stats=pedigree.summarize(store.runs, names),
              bias_stats=bias.for_day(data_dir, day, password, [race_meta(r) for r in races]))
    log.info("%d レースを書き出しました（リクエスト %d 件）", len(races), f.count)
    set_output("updated", "true")
    return 0


def race_meta(r: Race) -> dict:
    return {"venue": r.venue, "number": r.number, "surface": r.surface, "post_time": r.post_time}


def cmd_refresh(args) -> int:
    """指定したレースだけ取り直して、その日のデータを書き直す（ページの更新ボタン用）。

    --race は「東京-10」か、まとめて「東京-10,京都-10,新潟-10」。終わったレースの結果も取り込んで、馬場の傾向を更新する。
    """
    cfg = load_config()
    day = date.fromisoformat(args.date) if args.date else datetime.now(JST).date()
    data_dir = Path(args.data)
    password = page_password()
    targets = [re.fullmatch(r"(\S+?)-(\d{1,2})", t.strip()) for t in (args.race or "").split(",") if t.strip()]
    path = data_dir / "days" / f"{day.isoformat()}.json"
    if not password or not targets or not all(targets) or not path.exists():
        log.error("パスワード・レース指定（例 東京-10、まとめては 東京-10,京都-10）・その日のデータのどれかがありません")
        return 2
    if day < datetime.now(JST).date():
        log.error("終わった日（%s）のレースは取り直しません", day)
        return 2
    wanted = {(m.group(1), int(m.group(2))) for m in targets}
    label = ",".join(f"{v}{n}R" for v, n in sorted(wanted))
    saved = decrypt(json.loads(path.read_text()), password)
    races = [Race.from_dict(r) for r in saved["races"]]
    try:
        f = Fetcher(contact(cfg), cfg["fetch"]["delay_sec"], 30 + 6 * len(wanted))
        race_day, _, _, top_d = jra.is_race_day(f, day)
        news = jra.collect_some(f, day, top_d, wanted) if race_day else []
        missing = wanted - {(r.venue, r.number) for r in news}
        if missing:
            raise ParseError("開催ページで見つけられませんでした: " + ",".join(f"{v}{n}R" for v, n in sorted(missing)))
        try:
            going, baba = jra.collect_going(f), jra.collect_baba_data(f)
        except FetchError as e:
            log.warning("馬場情報の取得に失敗: %s", e)
            going, baba = {}, {}
        jra.merge_going(news, going, baba)
    except (FetchError, ParseError) as e:
        log.error("%s", e)
        write_status(data_dir, day, "error", f"{label} の更新に失敗: {e}")
        return 2
    by_key = {(r.venue, r.number): r for r in news}
    races = [by_key.get((r.venue, r.number), r) for r in races]
    for new in news:   # 同じ競馬場の馬場は他のレースにも反映する
        for r in races:
            if r.venue == new.venue and new.going and r.number not in {n.number for n in news if n.venue == r.venue} \
                    and r.surface == new.surface:
                r.going, r.cushion, r.moist, r.baba_time = new.going, new.cushion, new.moist, new.baba_time
    # 終わったレースの結果（通過順）を取り込んで、馬場の傾向を出し直す。失敗しても更新は続ける
    metas = [race_meta(r) for r in races]
    try:
        raw = bias.update_raw(f, data_dir, day, password, metas, datetime.now(JST))
        bias_stats = bias.for_day(data_dir, day, password, metas, raw)
    except (FetchError, ParseError) as e:
        log.warning("馬場の傾向の更新に失敗: %s", e)
        bias_stats = saved.get("bias", {})
    write_day(data_dir, day, races, cfg, saved.get("warnings", []), password,
              pedigree_stats=saved.get("pedigree", {}), bias_stats=bias_stats)
    status = json.loads((data_dir / "status.json").read_text())
    status["refreshed"] = ",".join(f"{v}-{n:02d}" for v, n in sorted(wanted))
    (data_dir / "status.json").write_text(json.dumps(status, ensure_ascii=False, indent=1))
    log.info("%s を更新しました（リクエスト %d 件）", label, f.count)
    return 0


def cmd_sample(args) -> int:
    cfg = load_config()
    raw = json.loads((ROOT / "sample" / "races.json").read_text())
    races = [Race.from_dict(r) for r in raw["races"]]
    for r in races:
        r.win_odds = [h.odds for h in r.horses if h.odds and not h.scratched]
    password = page_password() or "sample"
    day = date.fromisoformat(raw["date"])
    store = pedigree.Store(Path(args.data) / "pedigree.json", password)
    store.add(races, day)
    names = {n for r in races for h in r.horses for n in (h.sire, h.dam_sire) if n}
    write_day(Path(args.data), day, races, cfg, [], password, sample=True,
              pedigree_stats=pedigree.summarize(store.runs, names))
    log.info("サンプルのパスワード: %s", password)
    return 0


def cmd_build_site(args) -> int:
    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "site", out)
    data = Path(args.data)
    if data.exists():
        # 血統の記録（pedigree.json）は集計用でページでは使わないので置かない
        shutil.copytree(data, out / "data", ignore=shutil.ignore_patterns(".gitkeep", "pedigree.json", bias.RAW_DIR, "backtest"))
    return 0


def cmd_evaluate(args) -> int:
    """その日のレース結果を取り込み、シミュレーションの予想印と比べる（ログには数字だけを出す）。"""
    cfg = load_config()
    day = date.fromisoformat(args.date) if args.date else datetime.now(JST).date()
    data_dir = Path(args.data)
    path = data_dir / "days" / f"{day.isoformat()}.json"
    password = page_password()
    if not password:
        log.error("パスワードがありません")
        return 2
    if not path.exists():
        log.info("%s のデータがないので比べません（開催日でない）", day)
        set_output("updated", "false")
        return 0
    saved = decrypt(json.loads(path.read_text()), password)
    f = Fetcher(contact(cfg), cfg["fetch"]["delay_sec"], cfg["fetch"]["max_requests"])
    payouts: dict = {}
    results = jra.collect_results(f, day, payouts=payouts)
    log.info("結果を取得: %d レース", len(results))
    saved["payouts"] = payouts
    if results and not args.dry_run:
        # 翌日の馬場の傾向に使う控え
        bias.save_raw(data_dir, day, password, results)
    # 検証では、各レースの発走前までにわかっていた傾向だけを使う（後のレースの結果を混ぜない）
    prev = bias.previous_day(data_dir, day)
    days = ([(bias.load_day_races(data_dir, prev, password), bias.load_raw(data_dir, prev, password))] if prev else []) \
        + [(saved["races"], results)]
    saved["bias_by_race"] = {}
    for r in saved["races"]:
        t = bias._minutes(r.get("post_time"))
        if t is not None:
            saved["bias_by_race"][f"{r['venue']}-{r['number']}"] = \
                bias.compute(days, before=(day.isoformat(), t)).get(f"{r['venue']}|{r['surface']}")
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "day.json").write_text(json.dumps(saved, ensure_ascii=False))
        (Path(tmp) / "res.json").write_text(json.dumps(results, ensure_ascii=False))
        out = "\n".join(
            subprocess.run(["node", str(ROOT / "keiba" / js), f"{tmp}/day.json", f"{tmp}/res.json"]
                           + ([f"{tmp}/page.json"] if js == "eval_sim.js" else []),
                           capture_output=True, text=True, check=True).stdout
            for js in ("eval_sim.js", "diag_sim.js"))
        page = json.loads((Path(tmp) / "page.json").read_text())
    print(out)
    if not results or args.dry_run:
        if not results:
            log.warning("結果がまだありません")
        set_output("updated", "false")
        return 0
    # ページで見る用。着順と予想印を含むので、出馬表と同じく暗号化して置く
    page.update(date=day.isoformat(), evaluated_at=datetime.now(JST).isoformat(timespec="minutes"))
    (data_dir / "results").mkdir(parents=True, exist_ok=True)
    (data_dir / "results" / f"{day.isoformat()}.json").write_text(json.dumps(encrypt(page, password)))
    set_output("updated", "true")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as fh:
            fh.write(f"## {day} の予想と結果\n\n```\n{out}\n```\n")
    return 0


def cmd_backtest(args) -> int:
    """過去のレースの結果を控えて（続きから）、シミュレーションの予想と比べる。ログには数字だけを出す。"""
    cfg = load_config()
    data_dir = Path(args.data)
    password = page_password()
    if not password:
        log.error("パスワードがありません")
        return 2
    start, end = date.fromisoformat(args.start), date.fromisoformat(args.end)
    cache = backtest.load_cache(data_dir, password)
    if not args.eval_only:
        # 検証するレースの各馬の前走〜4走前を作るため、その前の数か月分も取る
        y, m = start.year, start.month - args.lookback_months
        while m < 1:
            y, m = y - 1, m + 12
        f = Fetcher(contact(cfg), cfg["fetch"]["delay_sec"], args.max_requests)
        try:
            added = backtest.crawl(f, cache, date(y, m, 1), end)
            log.info("結果を %d レース取りました（控えは合計 %d レース、リクエスト %d 件）", added, len(cache["races"]), f.count)
            if args.odds:
                got = backtest.crawl_odds(f, cache, start, end)
                log.info("確定オッズを %d レース取りました（リクエスト %d 件）", got, f.count)
        except FetchError as e:
            log.warning("途中で止めました（続きは次の実行で取ります）: %s", e)
        finally:
            backtest.save_cache(data_dir, password, cache)
            set_output("updated", "true")
    from collections import Counter
    log.info("控えの月ごとのレース数: %s", dict(sorted(Counter(k[:7] for k in cache["races"]).items())))
    log.info("検証期間の日ごとのレース数: %s", dict(sorted(Counter(k[:10] for k in cache["races"] if args.start <= k[:10] <= args.end).items())))
    day, results = backtest.build_eval_input(cache, start, end)
    log.info("検証するレース: %d（%s〜%s）、うちオッズあり %d", len(day["races"]), start, end,
             sum(1 for r in day["races"] if any(h.get("odds") for h in r["horses"])))
    if not day["races"]:
        return 0
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "day.json").write_text(json.dumps(day, ensure_ascii=False))
        (Path(tmp) / "res.json").write_text(json.dumps(results, ensure_ascii=False))
        env = dict(os.environ, SIMS=str(args.sims), SEED="1")
        out = "\n".join(
            subprocess.run(["node", str(ROOT / "keiba" / js), f"{tmp}/day.json", f"{tmp}/res.json"],
                           capture_output=True, text=True, check=True, env=env).stdout
            for js in ("eval_sim.js", "diag_sim.js"))
    # レースごとの行は多すぎるので、集計の表だけを出す
    print("\n".join(l for l in out.splitlines() if not re.match(r"\d{4}-\d{2}-\d{2}\|", l)))
    return 0


def _node(js: str, day: dict, results: dict, **env) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "day.json").write_text(json.dumps(day, ensure_ascii=False))
        (Path(tmp) / "res.json").write_text(json.dumps(results, ensure_ascii=False))
        return subprocess.run(["node", str(ROOT / "keiba" / js), f"{tmp}/day.json", f"{tmp}/res.json"],
                              capture_output=True, text=True, check=True, env=dict(os.environ, **env)).stdout


def cmd_tune(args) -> int:
    """控えにある過去のレースで重みを決め（keiba/tune.js）、調整に使っていない期間で今の重みと比べる。数字だけを出す。"""
    password = page_password()
    if not password:
        log.error("パスワードがありません")
        return 2
    cache = backtest.load_cache(Path(args.data), password)
    d = date.fromisoformat
    train = backtest.build_eval_input(cache, d(args.train_start), d(args.train_end))
    test = backtest.build_eval_input(cache, d(args.test_start), d(args.test_end))
    with tempfile.TemporaryDirectory() as tmp:
        paths = []
        for name, (day, res) in (("train", train), ("test", test)):
            for suffix, obj in (("day", day), ("res", res)):
                (Path(tmp) / f"{name}_{suffix}.json").write_text(json.dumps(obj, ensure_ascii=False))
                paths.append(f"{tmp}/{name}_{suffix}.json")
        out = subprocess.run(["node", str(ROOT / "keiba" / "tune.js"), *paths], capture_output=True, text=True, check=True,
                             env=dict(os.environ, TUNE_SIMS=str(args.tune_sims))).stdout
    print(out)
    params = next(l[len("PARAMS "):] for l in out.splitlines() if l.startswith("PARAMS "))
    only_totals = lambda text: "\n".join(l for l in text.splitlines() if not re.match(r"\d{4}-\d{2}-\d{2}\|", l))
    runs = [("確認用の期間・今の重み", test, {}), ("確認用の期間・調整後", test, {"SIM_PARAMS": params}),
            ("調整用の期間・調整後", train, {"SIM_PARAMS": params})]
    if args.recent_start:
        recent = backtest.build_eval_input(cache, d(args.recent_start), d(args.test_end))
        runs += [("直近・今の重み", recent, {}), ("直近・調整後", recent, {"SIM_PARAMS": params})]
    for title, (day, res), env in runs:
        print(f"\n===== {title}（{len(day['races'])}レース） =====")
        print(only_totals(_node("eval_sim.js", day, res, SIMS=str(args.sims), SEED="1", **env)))
    return 0


def cmd_value(args) -> int:
    """シミュレーションと確定オッズを組み合わせて、期待値で買ったら回収率はどうなるか（keiba/value.js）。数字だけを出す。"""
    password = page_password()
    if not password:
        log.error("パスワードがありません")
        return 2
    cache = backtest.load_cache(Path(args.data), password)
    d = date.fromisoformat
    parts = [backtest.build_eval_input(cache, d(args.train_start), d(args.train_end)),
             backtest.build_eval_input(cache, d(args.test_start), d(args.test_end))]
    with tempfile.TemporaryDirectory() as tmp:
        paths = []
        for i, (day, res) in enumerate(parts):
            for suffix, obj in (("day", day), ("res", res)):
                (Path(tmp) / f"{i}_{suffix}.json").write_text(json.dumps(obj, ensure_ascii=False))
                paths.append(f"{tmp}/{i}_{suffix}.json")
        print(subprocess.run(["node", str(ROOT / "keiba" / "value.js"), *paths], capture_output=True, text=True, check=True).stdout)
    return 0


def main(argv=None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    p = argparse.ArgumentParser(prog="keiba")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--date")
    r.add_argument("--data", default=str(ROOT / "data"))
    rf = sub.add_parser("refresh")
    rf.add_argument("--race", required=True, help="例: 東京-10")
    rf.add_argument("--date")
    rf.add_argument("--data", default=str(ROOT / "data"))
    e = sub.add_parser("evaluate")
    e.add_argument("--date")
    e.add_argument("--data", default=str(ROOT / "data"))
    e.add_argument("--dry-run", action="store_true", help="集計をログに出すだけで、data/ には書かない")
    bt = sub.add_parser("backtest")
    bt.add_argument("--start", required=True)
    bt.add_argument("--end", required=True)
    bt.add_argument("--lookback-months", type=int, default=6)
    bt.add_argument("--max-requests", type=int, default=4000)
    bt.add_argument("--sims", type=int, default=20000)
    bt.add_argument("--eval-only", action="store_true", help="控えにあるレースだけで比べる（JRAにアクセスしない）")
    bt.add_argument("--odds", action="store_true", help="検証期間のレースの確定オッズ（単勝・複勝）も取る")
    bt.add_argument("--data", default=str(ROOT / "data"))
    tu = sub.add_parser("tune")
    tu.add_argument("--train-start", required=True)
    tu.add_argument("--train-end", required=True)
    tu.add_argument("--test-start", required=True)
    tu.add_argument("--test-end", required=True)
    tu.add_argument("--recent-start", help="この日から --test-end までも別に比べる（先週など）")
    tu.add_argument("--sims", type=int, default=10000)
    tu.add_argument("--tune-sims", type=int, default=2000)
    tu.add_argument("--data", default=str(ROOT / "data"))
    va = sub.add_parser("value")
    for k in ("--train-start", "--train-end", "--test-start", "--test-end"):
        va.add_argument(k, required=True)
    va.add_argument("--data", default=str(ROOT / "data"))
    s = sub.add_parser("sample")
    s.add_argument("--data", default=str(ROOT / ".preview" / "data"))
    b = sub.add_parser("build-site")
    b.add_argument("--out", default="_site")
    b.add_argument("--data", default=str(ROOT / "data"))
    args = p.parse_args(argv)
    return {"run": cmd_run, "refresh": cmd_refresh, "evaluate": cmd_evaluate, "backtest": cmd_backtest, "tune": cmd_tune, "value": cmd_value, "sample": cmd_sample,
            "build-site": cmd_build_site}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
