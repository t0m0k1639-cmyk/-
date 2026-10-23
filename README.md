# 朝の狙い目レース

JRA の開催日の朝に、その日の全レースを **荒れ度** と **狙い目** で並べるスマホ向けページです。
GitHub Actions が毎朝自動でデータを集め、GitHub Pages に公開します。

## しくみ

```
GitHub Actions（毎日 7:30 と 9:30 JST）
  └ python -m keiba run
      1. JRA公式サイトの出馬表で、今日が開催日か確認（違えばここで終了）
      2. 全レースの条件（頭数・芝ダ・距離・クラス・ハンデ戦・牝馬限定）を取得
      3. 単勝オッズと馬場状態を取得
      4. スコアを計算して data/ に保存（生のオッズは保存しない）
  └ data/ をコミット → site/ と合わせて GitHub Pages に公開
```

| ファイル | 役割 |
|---|---|
| `keiba/fetch.py` | JRA公式サイトへのアクセス（robots.txt 遵守、2秒間隔、1回150件まで） |
| `keiba/parse.py` | HTML から項目を取り出す |
| `keiba/jra.py` | ページをたどって当日の全レースを集める |
| `keiba/score.py` | 荒れ度と狙い目の計算 |
| `config.toml` | スコアの重みと得意条件 |
| `site/` | 公開ページ（HTML / CSS / JS） |
| `data/` | 毎朝の計算結果（自動でコミットされる） |

## スコア

- **荒れ度**: 「条件からの荒れ度」と「オッズからの荒れ度」の平均（0〜100）
  - 条件: 頭数、ハンデ戦、牝馬限定、クラス、馬場状態、芝ダと距離
  - オッズ: 1番人気の支持率、上位3頭の支持率合計、オッズのばらつき
- **狙い目**: 条件とオッズの **ズレ** と **得意条件ボーナス** の合計（0〜100）
  - ズレは同じ日のレース同士で標準化して比べます
  - 条件は荒れ寄りなのに人気が集中 → **穴狙い向き**
  - 条件は堅めなのにオッズが割れている → **本命妙味**
  - 新馬戦・障害戦・7頭以下はズレの点を割り引きます

オッズはレースを選ぶための計算にだけ使い、各馬の印の判断には使いません。

重みはすべて仮の値です。`config.toml` で変えられます。

### 得意条件の設定

`config.toml` の末尾にある例を参考に `[[favorites]]` を追加してください。

```toml
[[favorites]]
name = "芝の中距離"
surface = "芝"
distance_min = 1800
distance_max = 2200
bonus = 15
```

## 初回のセットアップ

1. このブランチをデフォルトブランチ（main）にマージする。スケジュール実行はデフォルトブランチでしか動きません
2. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする
3. （任意）**Settings → Secrets and variables → Actions → Variables** に `KEIBA_CONTACT` を作り、User-Agent に入れる連絡先（URL など）を設定する。未設定ならリポジトリの URL を使います
4. **Actions → 朝の更新 → Run workflow** を一度手動で実行し、ページが公開されることを確認する

## 手元での確認

```sh
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest -q

# 架空のサンプルデータでページを見る
python -m keiba sample
python -m keiba build-site --out .preview/site --data .preview/data
python -m http.server -d .preview/site 8000
```

## データの扱い

- データ元は JRA公式サイト（日本中央競馬会）です。netkeiba など、規約で自動取得が認められていないサイトは使いません
- 公開ページと `data/` に載せるのは、レース条件の要約と独自に計算したスコアだけです。オッズ表や出馬表そのものは載せません
- アクセスは robots.txt に従い、2秒以上の間隔をあけ、1回の実行で150リクエストまでに制限しています
- JRA のページ構成が変わって読み取れなくなったときは、間違ったデータを公開せずに「取得失敗」と表示し、Actions の実行を失敗扱いにします
