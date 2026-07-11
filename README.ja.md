# Fanqie Publisher Skill

[![Release](https://img.shields.io/github/v/release/amm10090/fanqie-publisher-skill?display_name=tag&style=flat-square)](https://github.com/amm10090/fanqie-publisher-skill/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](./LICENSE)
[![OpenClaw Skill](https://img.shields.io/badge/OpenClaw-Skill-blue?style=flat-square)](./SKILL.md)
[![Playwright](https://img.shields.io/badge/Playwright-Automation-45ba4b?style=flat-square)](https://playwright.dev/)

**ローカルの Markdown ファイルから小説の章を、ブラウザ自動化（Playwright + CDP）を通じて番茄小説の執筆者バックエンドに公開します。**

> これは**公式の番茄小説 SDK や公開 API ラッパーではありません**。バックエンドの再設計により自動化が機能しなくなる可能性があります。実際の公開前に必ずセーフモードで検証してください。

**🌐 [English](./README.md) · [简体中文](./README.zh-CN.md) · 日本語**

---

## 特徴

- Markdown の章を自動解析し、章番号・タイトル・本文を分割
- ローカルディレクトリから単章または一括公開
- 再設計された番茄エディタへの中国語・Emoji・Unicode 入力に対応（往復読み取り検証付き）
- セッション切れ時に QR コードログインを案内、ブラウザセッションを再利用
- 即時公開およびプラットフォームネイティブの予約公開
- 誤字警告・コンテンツリスク検出・最終公開設定モーダルの検出と処理
- 公開後の検証：章管理画面に戻り、ステータス（`审核中` または `已发布`）を確認
- 安全な `--fill-only` モード — エディタフィールドを埋めるが送信はしない
- 明確な段階区分：プレビューのみ → フィルのみ → 最終モーダル到達 → 送信済み未検証 → 検証済み公開

## プラットフォーム対応

| プラットフォーム | ステータス | エントリファイル | 備考 |
|----------|--------|------------|-------|
| [OpenClaw](https://github.com/openclaw/openclaw) | ✅ **検証済み** | [`SKILL.md`](./SKILL.md) | ネイティブスキル形式。YAML フロントマター、コマンド、ルールを含む。注入されるプロンプトファイル：`AGENTS.md`、`SOUL.md`、`TOOLS.md`。 |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | ✅ **検証済み** | [`SKILL.md`](./SKILL.md)（再利用） | 同じ `SKILL.md` を再利用。`hermes claw migrate`（公式移行パス）でインポート。詳細は [Hermes Agent チュートリアル](#hermes-agent) を参照。 |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) | ✅ **検証済み** | [`CLAUDE.md`](./CLAUDE.md) | 薄いアダプタ — 共有の `SKILL.md` と `references/` を参照してビジネスロジックを取得。 |
| [OpenAI Codex CLI](https://github.com/openai/codex) | ✅ **検証済み** | [`AGENTS.md`](./AGENTS.md) | 薄いアダプタ。すべてのビジネスロジックは `SKILL.md`、`references/`、`scripts/` から取得。 |
| [Cline](https://github.com/cline/cline) | ✅ **検証済み** | [`.clinerules`](./.clinerules) | 薄いアダプタ。すべてのビジネスロジックは `SKILL.md`、`references/`、`scripts/` から取得。 |

> 各薄いアダプタ（OpenClaw/Hermes を除く）は**軽量エントリポイントとしてのみ機能**します。ビジネスロジック、セレクタ、安全ルールは `SKILL.md`、`references/`、`scripts/` に格納されています。どのアダプタも公開実装を重複しません。

## 環境要件

- **Node.js** および npm
- **Python 3**
- **Chromium/Chrome** ブラウザ（Playwright CDP 経由で制御可能）
- バックエンドにアクセスできる**番茄小説の作者アカウント**
- 初回使用前にリポジトリルートで `npm install` を実行

> 依存関係の自動インストールや、これらの環境が自動的に利用可能であることを主張しないでください。各項目は手動でインストールまたは設定する必要があります。

## クイックスタート

```bash
git clone https://github.com/amm10090/fanqie-publisher-skill.git
cd fanqie-publisher-skill
npm install
```

**基本的なワークフロー：**

1. 章を `.md` ファイルとして準備する（1ファイル = 1章）
2. 解析結果をプレビューする：`python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview`
3. CDP 経由でログイン済みブラウザに接続する：`node scripts/login_fanqie.js --cdp http://127.0.0.1:9222`
4. 安全なフィルテスト：`node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only`
5. 内容とページ状態を確認した上で、そのセッション内で明示的な確認を得てから、**`--fill-only` を削除**し `--confirm-publish` を追加して実際に公開する

## 章の形式

各 `.md` ファイルが1つの章を表します：

```text
第001章_标题.md

# 第001章 标题

正文第一段。

第二段。
```

パーサーは最初の Markdown 見出しを本文から分離し、`第001章 标题` を番号 `1` と表示タイトル `标题` に分割して、番茄エディタの該当フィールドに入力します。番号の先頭のゼロは実際の数値入力時に除去されます。

## プラットフォームチュートリアル

### OpenClaw

クローンしたリポジトリディレクトリを OpenClaw ワークスペースの skills フォルダに配置するか、OpenClaw にこのディレクトリを指定します。[`SKILL.md`](./SKILL.md) ファイルが完全なスキル定義として機能し、以下を含みます：

- YAML フロントマター（`name`、`description`）— 自動スキル検出用
- すべてのエントリポイントを網羅する完全な `commands` セクション
- 安全制限、ログイン処理、プラットフォーム制限を含む `rules` セクション
- 検証済みの段階的公開ワークフロー

OpenClaw はワークスペースレベルで `AGENTS.md`、`SOUL.md`、`TOOLS.md` をグローバルプロンプトファイルとして注入します。

```bash
# スキルロード後に使用可能なコマンド：
python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview
node scripts/login_fanqie.js --cdp http://127.0.0.1:9222
node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only
```

一括公開、予約公開、巻の選択、リトライについては [`SKILL.md`](./SKILL.md) を参照してください。

---

### Hermes Agent

Hermes Agent は OpenClaw と**同じ `SKILL.md` ファイル**を使用します。公式の移行コマンドでインポートします。

#### 前提条件

- Hermes Agent がインストールされていること（公式リポジトリ：[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)）
- このリポジトリがローカルにチェックアウトされていること

#### 移行パス（公式方式）

Hermes は `hermes claw migrate` コマンドを提供し、OpenClaw スキルを `~/.hermes/skills/openclaw-imports/` にインポートします。`--source` オプションには**OpenClaw ルートディレクトリ**を指定する必要があります（このリポジトリを直接指定するのではありません）。

**ステップ 1 — コマンドとドライランフラグを確認する：**

```bash
hermes claw migrate --help
```

`--source` が OpenClaw ディレクトリパスを指すこと、`--dry-run` が「プレビューのみ — 移行予定の内容を表示したら停止する」と説明されていることを確認してください。

**ステップ 2 — このリポジトリを OpenClaw 互換のソースディレクトリ構成に組み立てる：**

リポジトリルートで以下のコマンドを実行します：

```bash
OPENCLAW_SOURCE="$(mktemp -d "${TMPDIR:-/tmp}/fanqie-openclaw-source-XXXXXX")"
SKILL_SOURCE="$OPENCLAW_SOURCE/workspace/skills/fanqie-publisher"
mkdir -p "$SKILL_SOURCE"
cp SKILL.md package.json "$SKILL_SOURCE/"
cp -R references scripts "$SKILL_SOURCE/"
```

この操作はスキル定義と共有ランタイムファイルのみを一時ソースツリーにコピーします。`.git`、`state/`、ログイントークン、スクリーンショット、章ファイルはコピーしません。

**ステップ 3 — `--dry-run` で移行をプレビューする：**

```bash
hermes claw migrate --source "$OPENCLAW_SOURCE" --dry-run
```

ドライランの出力は、移行される内容とスキップされる内容を一覧表示します。**変更を加える前に注意深く確認してください。** ソースは一時的な OpenClaw ルートに解決される必要があり、計画されたスキルターゲットは `~/.hermes/skills/openclaw-imports/fanqie-publisher/` である必要があります。

**ステップ 4 — プレビュー確認後に実際の移行を実行する：**

```bash
hermes claw migrate --source "$OPENCLAW_SOURCE"
```

移行が成功し、インポートされたファイルを確認した後、必要がなければ `OPENCLAW_SOURCE` に格納された一時ディレクトリを削除します。未検証のパスを再帰的クリーンアップコマンドで使用しないでください。

**⚠️ 重要な安全上の注意：**
- **必ず最初に `--dry-run` を実行し**、実際の移行前に出力を確認してください
- 移行は `SKILL.md`、`package.json`、`references/`、`scripts/` をインポートします — `.git`、`state/`、ログイントークン、ユーザーの章ファイルは**コピーしません**
- 実際の `publish_fanqie.js` スクリプトは移行中**実行されません** — ファイルコピーのみ行われます
- **実際の設定を保護してください**：隔離環境でテストする場合、実際の `~/.hermes` および `~/.openclaw` ディレクトリが移行ターゲットとして使用されないことを必ず確認してください。実際のユーザーデータを保護することが最優先です
- 移行後、`~/.hermes/skills/openclaw-imports/fanqie-publisher/` のスキルは `references/` および `scripts/` への有効な相対参照を含みます

**Hermes にロード後、同じコマンドを使用します：**

```bash
python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview
node scripts/login_fanqie.js --cdp http://127.0.0.1:9222
node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only
```

---

### Claude Code

Claude Code はプロジェクトルートから [`CLAUDE.md`](./CLAUDE.md) を読み取ります。この薄いアダプタは Claude に以下を指示します：

1. `SKILL.md`、`references/workflow.md`、`references/selectors.md`、および `scripts/publish_fanqie.js`（フラグのみ）を読み取る
2. `SKILL.md` のエントリポイントから共有コマンドを使用する
3. 同じ安全ルールに従う（50,000 文字/日の上限、30 分の予約編集ウィンドウ、明示的な `是否使用AI → 否`）

```bash
# 章解析のプレビュー
python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview

# ログインまたは再接続
node scripts/login_fanqie.js --cdp http://127.0.0.1:9222

# 安全なフィルのみ公開
node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only
```

実際の公開時：同じ審査済み引数を使用し、**`--fill-only` を削除**して `--confirm-publish` を追加します。

---

### Codex CLI

Codex CLI はプロジェクトルートから [`AGENTS.md`](./AGENTS.md) を読み取ります。この薄いアダプタは：

- すべてのビジネスロジックと安全ルールについて `SKILL.md` を参照
- セレクタとワークフローの詳細について `references/` を参照
- 唯一の公開エントリポイントとして `scripts/publish_fanqie.js` を参照
- 自動インストール、自動ログイン、人間の確認のバイパスを**主張しない**

**コマンドは他のプラットフォームと同じです：**

```bash
# 構文チェック＋エディタテスト
npm run test:all

# 章のプレビュー
python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview

# ログイン
node scripts/login_fanqie.js --cdp http://127.0.0.1:9222

# 安全なフィルのみ
node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only
```

---

### Cline

Cline はプロジェクトルートから [`.clinerules`](./.clinerules) を読み取ります。この薄いアダプタは同じ設計に従います：共有ファイルを参照し、共有コマンドを使用し、共有安全ルールを適用します。

**コマンド：**

```bash
python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview
node scripts/login_fanqie.js --cdp http://127.0.0.1:9222
node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only
```

**実際の公開例（注意：`--fill-only` は削除され、`--confirm-publish` と併用しません）：**

```bash
node scripts/publish_fanqie.js \
  --cdp http://127.0.0.1:9222 \
  --file "/path/to/chapter.md" \
  --mode immediate \
  --confirm-publish
```

## 安全な公開ワークフロー

常に以下の段階を順に進めてください。ステップをスキップしないでください。

### 段階 1：プレビューのみ（Preview Only）
```bash
python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview
```
章番号、タイトル、本文が正しく解析されることを確認します。

### 段階 2：フィルのみ（Fill Only、セーフモード）
```bash
node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only
```
エディタのフィールドが埋められます。**何も送信されません。** 章番号、タイトル、本文、巻の選択、ページ状態を確認します。

### 段階 3：最終モーダル到達（At Final Modal）
`--fill-only` を使用すると、スクリプトはフィールドを埋め、誤字/リスク検出モーダルを通過して最終公開ダイアログに到達し、`确认发布` をクリックする手前で停止します。これにより、すべての中間ゲートが通過可能であることが確認されます。

### 段階 4：送信済み未検証（Submitted But Unverified）
`--confirm-publish` で実際に公開した後、送信ボタンはクリックされていますが、管理ページはまだ確認されていません。**これは検証済みの成功ではありません。**

### 段階 5：検証済み公開（Verified Publication）✅
スクリプトは章管理画面に戻り、対象行が存在し、ステータスが `审核中`（審査中）または `已发布`（公開済み）であることを確認します。この段階のみが公開成功を確定します。

> **正しい実際の公開例：** フィルテストと同じ引数を使用し、**`--fill-only` を削除**して `--confirm-publish` を追加してください。`--fill-only` と `--confirm-publish` を**同時に使用しないでください**。

## 安全境界

- 実際の公開前には、まず1章または `--fill-only` でテストしてください
- 送信前に対象作品、巻、章番号、タイトル、本文を確認してください
- **1日 50,000 文字**は実用的な安全上限です（公式クォータではありません）
- 予約公開された章は、公開時刻の約 **30 分前**から**編集不可**になります — 土壇場での編集は試みないでください
- ログイントークン、ブラウザセッション、スクリーンショット、QR コード、一時的な状態ファイルをコミットしないでください
- 番茄小説のバックエンド更新によりセレクタは変更されます — 使用前に確認し、セレクタが常に安定していると想定しないでください
- 最終公開設定モーダルでは、**常に「是否使用AI」を「否」に設定してください**

## トラブルシューティング

### 中国語 / Emoji / Unicode 入力の問題

再設計された番茄エディタでは、非 ASCII 文字に特別な処理が必要です：

- スクリプトは**1文字ずつの入力**と**往復読み取り検証**を使用して、中国語、Emoji、特殊 Unicode 文字を処理します
- 入力検証に失敗した場合、スクリプトは `input-validation-failed` を報告します — 元のテキストを修正して再試行し、公開成功として報告しないでください
- 空のエディタ装飾ノードは自動的に処理されます；本文フィールドが応答しない場合は、入力前にエディタが完全にロードされていることを確認してください

### ログインの問題

- セッションが切れた場合、スクリプトは**QR コードログイン**を案内します（手動でスキャンが必要です）
- `node scripts/login_fanqie.js --cdp http://127.0.0.1:9222` で再接続してください
- QR コードのパスをプログラムで取得する必要がある場合は、代わりに `scripts/login_fanqie_notify.js` を使用してください
- **自動ログインは実行しません** — 常に QR コードとの手動操作が必要です

### セレクタ / ページ状態の問題

あるステップが予期せず失敗した場合：

1. 現在のページ状態を手動で確認してください
2. [`references/selectors.md`](./references/selectors.md) で最新のセマンティックセレクタを確認してください
3. [`references/workflow.md`](./references/workflow.md) で検証済みの公開フローを確認してください
4. [`references/editor-recon.md`](./references/editor-recon.md) でエディタ調査ノートを確認してください
5. バックエンドが変更された場合は、`scripts/publish_fanqie.js` のセレクタを更新してください

### モーダル / ダイアログ処理

公開フローでは、いくつかの中間ダイアログが表示されることがあります：

| ダイアログ | トリガー | 操作 |
|--------|---------|--------|
| 誤字/スペルチェック警告 | 「下一步」クリック後 | 「提交」をクリックして続行 |
| コンテンツリスク検出 | 誤字チェック通過後 | 「确定」をクリックして続行 |
| ガイドツアー / オンボーディング | エディタ初回訪問 | 「知道了」/「我知道了」/「下一步」/「跳过」を試行 |
| 最終公開設定 | 送信前 | 「是否使用AI」を「否」に設定、即時または予約公開を選択、「确认发布」をクリック |

## FAQ

**Q: 予約公開はできますか？**
A: はい — `--mode schedule` と `--scheduled-time` を使用してください。これは外部の cron ジョブではなく、番茄バックエンドのネイティブ予約公開 UI を使用します。

**Q: 複数の章を一度に公開できますか？**
A: はい — `--file` の代わりに `--dir` を使用し、必要に応じて `--volume` で巻を選択できます。

**Q: 1日の制限に達した場合はどうなりますか？**
A: スクリプトは 1 日 50,000 文字を実用的な安全上限として使用します。大量公開日には、`--already-published-chars` を渡して、スクリプトが疑わしい制限に達する前に停止できるようにします。

**Q: 番茄のバックエンドが変更された場合でも動作しますか？**
A: 自動化は CSS セレクタと DOM 構造に依存しています。バックエンドの再設計により特定のセレクタが機能しなくなる可能性があります — `references/selectors.md` を更新し、まず `--fill-only` でテストしてください。

**Q: ブラウザを開かずに使用できますか？**
A: いいえ — CDP 経由で制御される Chromium/Chrome ブラウザセッションが必要です。

## 参考ファイル

| ファイル | 目的 |
|------|---------|
| [`SKILL.md`](./SKILL.md) | 完全なスキル定義、コマンド、安全ルール、公開フロー |
| [`references/workflow.md`](./references/workflow.md) | 検証済みの段階的公開ワークフロー |
| [`references/selectors.md`](./references/selectors.md) | 番茄バックエンドページ用のセマンティック CSS セレクタ |
| [`references/editor-recon.md`](./references/editor-recon.md) | エディタ調査とモーダル処理に関するメモ |
| [`references/data-format.md`](./references/data-format.md) | 章ソース形式の仕様 |
| [`scripts/publish_fanqie.js`](./scripts/publish_fanqie.js) | メイン公開エントリポイント（単一の信頼できる情報源） |
| [`scripts/prepare_chapters.py`](./scripts/prepare_chapters.py) | Markdown 章パーサーとプレビュー |
| [`scripts/login_fanqie.js`](./scripts/login_fanqie.js) | ログインとセッション管理 |
| [`scripts/editor_input.js`](./scripts/editor_input.js) | 往復読み取り検証付きの Unicode 入力 |
| [`CHANGELOG.md`](./CHANGELOG.md) | リリース履歴 |

## 開発とテスト

```bash
npm run test:all
```

これにより、JavaScript 構文チェックとエディタ入力テストが実行されます。コアソースファイル：

- `scripts/publish_fanqie.js` — 公開メインフロー
- `scripts/editor_input.js` — Unicode 入力と読み取り検証
- `scripts/login_fanqie.js` — ログインとセッション管理
- `scripts/prepare_chapters.py` — Markdown 章解析

## コントリビューション

コントリビューションを歓迎します。以下のガイドラインに従ってください：

1. 変更を議論するために最初に issue を開いてください
2. 薄いアダプタは薄く保つ — ビジネスロジックは `SKILL.md`、`references/`、`scripts/` に属します
3. 番茄バックエンドが変更された場合、`references/selectors.md` を更新してください
4. すべての変更は送信前に `--fill-only` でテストしてください
5. ログイントークン、ブラウザセッション、スクリーンショット、またはユーザーデータをコミットしないでください
6. UTF-8 エンコーディングを維持し、エディタ変更後は中国語と Emoji の入力をテストしてください

## ライセンス

[MIT](./LICENSE)
