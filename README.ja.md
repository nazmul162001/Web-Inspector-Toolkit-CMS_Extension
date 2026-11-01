<p align="center">
  <a href="./README.md" target="_blank" rel="noopener noreferrer">English</a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <strong>日本語</strong>
</p>

# Web Inspector Toolkit

Chromeのサイドパネルで、実際のウェブサイトを調べるツールです。色・テキスト・リンク・フォント・画像・スクリーンショットを、**すべて自分の端末の中だけ**で扱います。アップロードはしません。

<p align="center">
  <img src="icons/icon128.png" width="72" alt="Web Inspector Toolkit" />
</p>

<p align="center">
  <strong>Chrome 123+</strong> &nbsp;·&nbsp; <strong>ビルド不要</strong> &nbsp;·&nbsp; <strong>English / 日本語</strong> &nbsp;·&nbsp; <strong>ダーク / ライト</strong>
</p>

---

## できること

| | |
| :---: | --- |
| <mark><strong>カラー検索</strong></mark> | 指定した色を使っている要素を、このページまたはサイト全体から見つけます。HEX、`rgb()`、CSSの色名、カラーピッカーに対応。 |
| <mark><strong>テキスト検索</strong></mark> | 人が読んでいるテキストから、単語や文章を検索します。HTMLのソースは対象外です。 |
| <mark><strong>電話番号</strong></mark> | 書き方が違っても同じ番号を見つけます（`080-1234-5678`、`+81 80…`、全角数字、`tel:` リンク）。 |
| <mark><strong>リンク href</strong></mark> | そのアドレスを指しているリンク、ボタン、フォームを見つけます（完全一致 / 部分一致）。 |
| <mark><strong>フォント検索</strong></mark> | そのフォントを使っている要素を表示します。CSSの出典と `@font-face` のファイルも分かります。 |
| <mark><strong>半角 / 全角テキスト</strong></mark> | 全角の数字・英字・記号を見つけ、ページ上で赤くマークします。 |
| <mark><strong>画像の解像度</strong></mark> | 画像や背景にポインターを置くと、実際のピクセルサイズと表示サイズを比べられます。 |
| <mark><strong>スクリーンショット</strong></mark> | ページ全体、今見えている画面、または選択した範囲を撮影し、その場で書き込めます。<br>• 描画ツール：ペン、直線、矢印、円、長方形、正方形、テキスト<br>• ハイライト（範囲をドラッグしてから色を選ぶ）<br>• 範囲をぼかす<br>• 番号付きの円（クリックで 1、2、3…）<br>• クリップボードにコピー、または PNG で保存<br>• 「範囲を選択」のショートカット（パネルを開かなくても使えます） |
| <mark><strong>このページ / サイト全体</strong></mark> | 検索ツールは、今開いているタブだけ、または同じサイトを裏で巡回して調べられます。 |
| <mark><strong>English / 日本語</strong></mark> | 画面の言葉を切り替えます。ウェブサイト本体の文章は翻訳しません。 |
| <mark><strong>ダーク / ライト</strong></mark> | 最初はシステムの設定に従い、選んだあとはそのモードを覚えておきます。 |
| <mark><strong>端末内だけで完結</strong></mark> | 検索結果もスクリーンショットも、自分のパソコンに残ります。この拡張機能から外へ通信しません。 |

---

## Chromeへの入れ方

最初に一度だけ行います。あとは、どのウェブサイトでも拡張機能のアイコンをクリックすれば、右側にサイドパネルが開きます。

<br>

### 1. ZIPをダウンロード

GitHubでこのリポジトリを開きます。

1. 右上の緑の **<> Code** ボタンをクリックします。
2. **Download ZIP** をクリックします。

<p align="center">
  <img src="docs/setup/01-download-zip.png" width="920" alt="GitHubのCodeメニューで Download ZIP を示す画面" />
</p>

<p align="center"><sub>Code → Download ZIP</sub></p>

<br>

### 2. ZIPを解凍する

ダウンロードフォルダにある `Web-Inspector-Toolkit-CMS_Extension-main.zip` を解凍します。

- **Mac** — ZIPをダブルクリックします。同じ名前のフォルダが隣にできます。
- **Windows** — ZIPを右クリック → **すべて展開…**

Chromeに読み込むのは、**解凍したフォルダ**です。中に `manifest.json` があるものを選びます。

<br>

### 3. 「拡張機能を管理」を開く

1. **Google Chrome** を開きます。
2. 右上の **⋮** メニューをクリックします。
3. **拡張機能** にポインターを合わせます。
4. **拡張機能を管理** をクリックします。

<p align="center">
  <img src="docs/setup/03-manage-extensions.png" width="920" alt="Chromeメニュー：拡張機能 → 拡張機能を管理" />
</p>

<p align="center"><sub>⋮ → 拡張機能 → 拡張機能を管理</sub></p>

<br>

### 4. デベロッパーモードをオンにする

拡張機能のページの**右上**で、**デベロッパーモード**をオンにします。

<p align="center">
  <img src="docs/setup/04-developer-mode.jpg" width="920" alt="chrome://extensions 右上のデベロッパーモード" />
</p>

<p align="center"><sub>デベロッパーモードをオン</sub></p>

<br>

### 5. 解凍したフォルダを読み込む

1. 左上の **パッケージ化されていない拡張機能を読み込む**（Load unpacked）をクリックします。

<p align="center">
  <img src="docs/setup/05-load-unpacked.jpg" width="920" alt="拡張機能ページの「パッケージ化されていない拡張機能を読み込む」ボタン" />
</p>

<p align="center"><sub>パッケージ化されていない拡張機能を読み込む</sub></p>

2. 解凍したプロジェクトのフォルダを選びます（`manifest.json`、`background`、`content`、`sidepanel` があるフォルダです）。
3. **選択** をクリックします。

<p align="center">
  <img src="docs/setup/06-select-folder.jpg" width="920" alt="解凍した拡張機能フォルダを選ぶファイル選択画面" />
</p>

<p align="center"><sub>解凍したフォルダを選んで、選択</sub></p>

拡張機能の一覧に **Web Inspector Toolkit** が表示されます。

<br>

### 6. シークレットモードでも使う（任意）

シークレットウィンドウでも使いたい場合：

1. 拡張機能のページで、Web Inspector Toolkit のカードにある **詳細** をクリックします。

<p align="center">
  <img src="docs/setup/07-details.jpg" width="920" alt="Web Inspector Toolkit カードの詳細ボタン" />
</p>

<p align="center"><sub>詳細</sub></p>

2. 下へスクロールして、**シークレット モードでの実行を許可する** をオンにします。

<p align="center">
  <img src="docs/setup/08-allow-incognito.jpg" width="920" alt="シークレットモードでの実行を許可するスイッチ" />
</p>

<p align="center"><sub>シークレット モードでの実行を許可する</sub></p>

---

## これで完了です

任意のウェブサイトを開き、Chromeツールバーの **Web Inspector Toolkit** アイコンをクリックすると、右側にサイドパネルが開きます。

アイコンが見当たらないときは、ツールバーのパズルピース（拡張機能）をクリックして、**Web Inspector Toolkit** をピン留めしてください。

ツールがページへのアクセスを初めて必要とするとき、Chromeが一度だけ確認します。許可してから続けてください。
