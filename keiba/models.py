from __future__ import annotations

from dataclasses import asdict, dataclass, field


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
    # 単勝オッズ。スコア計算にだけ使い、公開データには書き出さない
    win_odds: list[float] = field(default_factory=list, repr=False)

    @property
    def key(self) -> str:
        return f"{self.venue}-{self.number:02d}"


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

    def to_public(self) -> dict:
        """公開用の辞書。生のオッズは含めない。"""
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
