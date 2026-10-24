from __future__ import annotations

from dataclasses import asdict, dataclass, field, fields


@dataclass
class Horse:
    number: int                     # 馬番
    name: str
    waku: int | None = None         # 枠番
    sex_age: str | None = None      # 性齢（例: 牝3）
    weight: float | None = None     # 斤量
    jockey: str | None = None
    trainer: str | None = None
    odds: float | None = None       # 単勝オッズ
    popularity: int | None = None   # 人気
    scratched: bool = False         # 取消・除外
    past: list[dict] = field(default_factory=list)  # 前走から新しい順に最大4走
    sire: str | None = None         # 父
    dam: str | None = None          # 母
    dam_sire: str | None = None     # 母の父
    stable: str | None = None       # 所属（美浦・栗東）
    owner: str | None = None        # 馬主
    breeder: str | None = None      # 生産者
    body_weight: int | None = None  # 馬体重（kg・当日発表）
    body_weight_diff: int | None = None  # 前走からの増減（kg）


@dataclass
class Race:
    venue: str                      # 競馬場（例: 東京）
    number: int                     # レース番号
    name: str = ""                  # レース名
    surface: str | None = None      # "芝" / "ダート" / "障害"
    distance: int | None = None     # メートル
    race_class: str | None = None   # config の class 名
    handicap: bool = False
    fillies_only: bool = False
    field_size: int | None = None   # 頭数（取消を除く）
    going: str | None = None        # 馬場状態
    post_time: str | None = None    # 発走時刻 "15:40"
    course_detail: str | None = None  # 出馬表のコース表記（例: 芝・右・外）
    cushion: float | None = None    # 芝のクッション値（JRA発表の最新値）
    moist: list[float] | None = None  # その馬場の含水率 [ゴール前, 4コーナー]（%）
    baba_time: str | None = None    # 含水率・クッション値の測定時刻
    horses: list[Horse] = field(default_factory=list)
    # 単勝オッズ。スコア計算に使う（各馬の odds があればそこから作る）
    win_odds: list[float] = field(default_factory=list, repr=False)

    @property
    def key(self) -> str:
        return f"{self.venue}-{self.number:02d}"

    @classmethod
    def from_dict(cls, d: dict) -> "Race":
        """保存したページ用の辞書（スコアなど余分な項目を含む）からも戻せるようにする。"""
        names = {f.name for f in fields(cls)}
        hnames = {f.name for f in fields(Horse)}
        d = {k: v for k, v in d.items() if k in names}
        d["horses"] = [Horse(**{k: v for k, v in h.items() if k in hnames}) for h in d.get("horses", [])]
        r = cls(**d)
        if not r.win_odds:
            r.win_odds = [h.odds for h in r.horses if h.odds and not h.scratched]
        return r


@dataclass
class Scored:
    race: Race
    condition_chaos: float          # 条件からの荒れ度 0-100
    market_chaos: float | None      # オッズからの荒れ度 0-100
    chaos: float                    # 表示用の荒れ度 0-100
    gap: float | None               # 標準化した ズレ（正: 条件の方が荒れ寄り）
    target: float                   # 狙い目 0-100
    label: str | None               # "穴狙い向き" / "本命妙味" / None
    favorites: list[str]
    reasons: list[str]

    def to_dict(self) -> dict:
        """ページ用の辞書（暗号化して保存する）。"""
        r = asdict(self.race)
        r.pop("win_odds")
        return {
            "key": self.race.key,
            **r,
            "condition_chaos": round(self.condition_chaos),
            "market_chaos": None if self.market_chaos is None else round(self.market_chaos),
            "chaos": round(self.chaos),
            "gap": None if self.gap is None else round(self.gap, 2),
            "target": round(self.target),
            "label": self.label,
            "favorites": self.favorites,
            "reasons": self.reasons,
        }
