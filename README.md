# ぽろったー（porotter）

仕事の中で生まれた気づきや違和感を、外部SNSへ公開せずに残すための個人用メモアプリです。Xのような短文タイムラインと返信スレッドを、Google Apps Script、Googleスプレッドシート、Google Workspace Studioで動かします。

## 初期版でできること

- 280文字までの短文投稿
- 投稿・返信内のURLを自動でハイパーリンク化
- ホームと分離された検索画面
- 疑似アカウントの作成・編集・停止
- Workspace StudioとGeminiによる定時のAI投稿
- タグ付けとタグ絞り込み
- キーワード、日付、返信有無による検索
- 自分の投稿への返信
- 投稿・返信の編集と削除
- お気に入り一覧
- ごみ箱からの復元と完全削除
- 過去投稿のランダムな再提示
- JSONバックアップと投稿CSVの書き出し
- ライト／ダークテーマ
- PC・スマートフォン対応
- Google Workspaceアカウントによる本人限定アクセス

外部API、CDN、アクセス解析は使用しません。AI投稿だけはGoogle Workspace Studio内のGeminiを使用し、結果を同じApps Scriptとスプレッドシートへ保存します。投稿本文をアプリのログへ出力する処理はありません。

## 導入済み環境

- [ぽろったー ウェブアプリ](https://script.google.com/macros/s/AKfycbyLujPAqhQAQlg9BRebiBxbZJUyDwwrRc4gLFz3vs3Zl_rHDS0bSPOLm-3sukeAmurPJw/exec)
- [Apps Scriptプロジェクト](https://script.google.com/d/1uB3yERLAOsqqWxrumc8xdT7RnucxyAWPtZ3QC3XSX2nFJ_keevE9UVf0/edit)

ローカルの `.clasp.json` にGASプロジェクトとの紐付けを保存しています。スクリプトIDをGitHubへ固定しない方針のため、このファイルはGit管理対象外です。

## 構成

```text
ブラウザ
  └─ Apps Script HTML Service
       ├─ 認証・入力検証・排他制御
       └─ Googleスプレッドシート
            ├─ Posts
            ├─ Replies
            ├─ Personas
            └─ Settings

Workspace Studio（定時実行）
  ├─ 疑似アカウントをランダム選択
  ├─ Geminiが最近のDrive内容から短文を生成
  └─ Apps ScriptカスタムステップでPostsへ保存
```

スプレッドシートの行番号はIDに使わず、投稿と返信にはUUIDを割り当てます。削除はまず論理削除として扱い、ごみ箱から完全削除したときだけ行を取り除きます。

## セットアップ

### 1. Apps Scriptプロジェクトを用意する

[Google Apps Script](https://script.google.com/)で新しいスタンドアロンプロジェクトを作成し、プロジェクト名を `porotter` にします。

ファイルの反映には `clasp` を使う方法が簡単です。

1. Apps Scriptの「プロジェクトの設定」からスクリプトIDをコピーします。
2. このフォルダの直下に、次の内容で `.clasp.json` を作成します。このファイルはGit管理されません。

```json
{
  "scriptId": "ここにスクリプトID",
  "rootDir": "."
}
```

3. PowerShellで以下を実行します。

```powershell
npx @google/clasp login
npx @google/clasp push
```

`clasp`を利用できない環境では、`.gs`ファイルと`.html`ファイルをApps Scriptエディタへ同名で作成し、内容をコピーしてください。`appsscript.json`は「マニフェスト ファイルをエディタで表示する」を有効にして置き換えます。

### 2. 保存先と利用者を初期化する

Apps Scriptエディタ上部の関数選択で `setupPorotter` を選び、実行します。初回だけGoogleの権限確認が表示されます。

この処理は次を行います。

- `porotter Data` スプレッドシートをマイドライブに作成
- `Posts`、`Replies`、`Settings`シートを作成
- 実行したGoogle Workspaceアカウントを唯一の利用許可アカウントとして保存

実行ログに返される `spreadsheetUrl` から保存先を確認できます。再実行しても既存データは消えません。

### 3. ウェブアプリとしてデプロイする

Apps Scriptで「デプロイ」→「新しいデプロイ」→「ウェブアプリ」を選択し、次のように設定します。

- 次のユーザーとして実行：ウェブアプリにアクセスしているユーザー
- アクセスできるユーザー：Google Workspace組織内のユーザー

組織内の別ユーザーがURLを開いても、サーバー側の本人確認で投稿データへのアクセスは拒否されます。デプロイ後に表示されたURLがアプリのURLです。

`ログイン中のメールアドレスを確認できません` と表示された場合は、「ウェブアプリにアクセスしているユーザー」として実行されていることを確認してください。

## 更新方法

コードを変更したら、テスト後にApps Scriptへ反映し、ウェブアプリの新しいバージョンをデプロイします。

```powershell
npm.cmd run check
npm.cmd test
npx @google/clasp push
```

ウェブアプリへ反映する場合は、push後に既存デプロイを更新します。

```powershell
npx @google/clasp deploy --deploymentId AKfycbyLujPAqhQAQlg9BRebiBxbZJUyDwwrRc4gLFz3vs3Zl_rHDS0bSPOLm-3sukeAmurPJw --description "変更内容"
```

既存のスプレッドシートIDと利用許可アカウントはScript Propertiesに残るため、通常のコード更新で再設定は不要です。

## Workspace StudioによるAI投稿

疑似アカウントを設定画面で作成した後、[Workspace Studio設定ガイド](WORKSPACE_STUDIO.md)に沿って定時フローを作成します。外部APIやWebhookは不要です。

## ローカル確認

Node.js 20以上があれば、Googleサービスへ接続しないモックデータでUIを確認できます。

```powershell
npm.cmd run dev
```

ブラウザで `http://127.0.0.1:4173` を開きます。ローカルプレビューに入力した内容はメモリ上だけにあり、Googleスプレッドシートへ保存されません。

## テスト

```powershell
npm.cmd run check
npm.cmd test
```

- `check`：GAS／ブラウザJavaScriptの構文、マニフェスト、HTML IDを検査
- `test`：Apps Scriptサービスをモックし、投稿、検索、お気に入り、返信、ごみ箱、復元、エクスポート、認可を一連で検証

## 主なファイル

| ファイル | 役割 |
|---|---|
| `Code.gs` | ウェブアプリと初期設定の入口 |
| `Config.gs` | 定数、認可、入力検証、共通処理 |
| `Repository.gs` | スプレッドシートのスキーマと読み書き |
| `Api.gs` | ブラウザから呼び出すアプリAPI |
| `Index.html` | 画面構造 |
| `Styles.html` | レスポンシブデザイン |
| `JavaScript.html` | 画面状態と操作処理 |
| `dev/preview-api.js` | ローカルプレビュー用のモックAPI |
| `tests/server.test.mjs` | サーバー側の自動テスト |

## セキュリティ上の実装

- すべての公開APIでログインユーザーを再確認
- Script Propertiesに保存した1アカウントだけを許可
- 投稿の更新・削除時にも所有者を確認
- 書き込みを`LockService`で排他制御
- 本文をHTMLへ表示するときにエスケープ
- CSVの数式インジェクションを無効化
- スプレッドシートIDをブラウザへ送信しない
- 投稿本文をサーバーログへ記録しない

データの共有範囲は、Apps Scriptプロジェクトと自動作成されるスプレッドシートのGoogleドライブ共有設定にも依存します。意図せず共有されていないことを定期的に確認してください。

## 今後の候補

- 定型質問による安全な自動返信
- 投稿傾向の週次ダイジェスト
- 指定期間のアーカイブ
- 承認済み生成AIとの連携

生成AI連携は、投稿本文を送信できるサービスとデータ取扱条件が別途承認された場合だけ追加する想定です。
