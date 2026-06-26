# ぽろったー（porotter）

仕事の中で生まれた気づきや違和感を、外部SNSへ公開せずに残すための個人用メモアプリです。Xのような短文タイムラインと返信スレッドを、Google Apps Script、Googleスプレッドシート、Google Workspace Studioで動かします。

## 初期版でできること

- 280文字までの短文投稿
- 投稿・返信内のURLを自動でハイパーリンク化
- 本文とは別に保存・表示できる任意の参考リンク
- ホームと分離された検索画面
- AIを含むホームと、ユーザー投稿だけの「自分の投稿」画面
- 自分の投稿または参加したスレッドへの新しいAI返信を知らせる通知画面
- 色分けされた疑似アカウントの作成・編集・停止
- Webアプリからの初期セットアップと手動AI投稿
- AI投稿・返信の実行頻度設定（10分刻み、最短10分）
- Workspace StudioとGeminiによる、Drive・受信メール・対象を限定したChatを踏まえた定時のAI投稿・返信
- 「AI返信不要」を付けた投稿・返信を除外できる自動フォローアップ
- タグ付けとタグ絞り込み
- キーワード、日付、返信有無による検索
- 自分の投稿への返信
- 投稿・返信の編集と削除
- お気に入り一覧
- ごみ箱からの復元と完全削除
- 過去投稿のランダムな再提示
- データ保存先スプレッドシートへの導線
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
            ├─ Entries
            ├─ Personas
            ├─ AIRequests
            └─ Settings

Workspace Studio（定時実行）
  ├─ AIRequestsのREQUESTED行を標準のSheets開始条件で検知
  ├─ Geminiが投稿候補や最近のDrive・受信メール・対象Chatから短文を生成
  └─ 生成結果を同じ行へGENERATEDとして保存

Apps Script時間トリガー
  ├─ 疑似アカウントと投稿／返信を選択してAIRequestsへ追加
  └─ GENERATED行を検証してEntriesへ保存
```

スプレッドシートの行番号はIDに使わず、投稿と返信はどちらもEntries上の1レコードとしてUUIDを割り当てます。返信は`parentId`と`rootId`でスレッド構造を表します。削除はまず論理削除として扱い、ごみ箱から完全削除したときだけ行を取り除きます。

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

### 2. ウェブアプリとしてデプロイする

Apps Scriptで「デプロイ」→「新しいデプロイ」→「ウェブアプリ」を選択し、次のように設定します。

- 次のユーザーとして実行：ウェブアプリにアクセスしているユーザー
- アクセスできるユーザー：自分のみ

デプロイ後に表示されたURLがアプリのURLです。初期設定機能を安全に提供するため、アクセス範囲は必ず「自分のみ」にします。

`ログイン中のメールアドレスを確認できません` と表示された場合は、「ウェブアプリにアクセスしているユーザー」として実行されていることを確認してください。

### 3. Webアプリで初期セットアップする

デプロイしたURLを開き、「初期セットアップを実行」を押します。初回だけGoogleの権限確認が表示されます。

この処理は次を行います。

- porotter Dataスプレッドシートをマイドライブに作成
- Entries、Settings、Personas、AIRequestsシートを作成
- ログイン中のGoogle Workspaceアカウントを唯一の利用許可アカウントとして保存

再実行しても既存データは消えません。Apps ScriptエディタからsetupPorotterを実行する従来の方法も、復旧用として残しています。

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

## Workspace StudioによるAI投稿・返信

疑似アカウントを設定画面で作成した後、[Workspace Studio設定ガイド](WORKSPACE_STUDIO.md)に沿って標準のSheets／Geminiステップを一度だけ設定します。その後はWebアプリの設定画面から自動化の有効化、AI実行頻度の変更、手動AI投稿、生成状態の確認を行えます。AI実行時は「AI返信不要」が付いていない未返信のユーザー投稿・返信からランダムに1件を選んで返信します。返信候補がないときは新規投稿にフォールバックします。生成時には最近のDrive更新、受信メール、Chatの新規投稿とフォロー中スレッドを参照候補にしつつ、同じ疑似アカウントの過去投稿・参照済みソースとの重複を避けます。外部APIやWebhookは不要です。

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
- `test`：Apps Scriptサービスをモックし、Web初期設定、投稿、検索、ユーザー投稿フィルター、通知、AI頻度、手動AI投稿、ごみ箱、エクスポート、認可を一連で検証

投稿数を100〜50,000件に増やす負荷シミュレーションと運用目安は、[性能検証](PERFORMANCE.md)を参照してください。

## 主なファイル

| ファイル | 役割 |
|---|---|
| `Code.gs` | ウェブアプリと初期設定の入口 |
| `Config.gs` | 定数、認可、入力検証、共通処理 |
| `Automation.gs` | AIRequestsキューと時間トリガーの管理 |
| `Repository.gs` | スプレッドシートのスキーマと読み書き |
| `Domain.gs` | 投稿・返信レコードの生成と所有者別集計 |
| `Api.gs` | ブラウザから呼び出す公開API |
| `SyncService.gs` | 画面同期用の軽量カーソル管理 |
| `TimelineService.gs` | タイムライン、検索、再提示の構築 |
| `NotificationService.gs` | 通知一覧と既読状態の管理 |
| `PresentationService.gs` | 表示用データ変換と共通コレクション処理 |
| `Index.html` | 画面構造 |
| `Styles.html` | レスポンシブデザイン |
| `Client*.html` | 画面状態、操作、同期、AI設定などのクライアント処理 |
| `dev/preview-api.js` | ローカルプレビュー用のモックAPI |
| `tests/server.test.mjs` | サーバー側の自動テスト |

## セキュリティ上の実装

- すべての公開APIでログインユーザーを再確認
- Script Propertiesに保存した1アカウントだけを許可
- 投稿の更新・削除時にも所有者を確認
- 書き込みを`LockService`で排他制御
- 本文をHTMLへ表示するときにエスケープ
- データ保存先スプレッドシートのURLは許可済みユーザーにのみ表示
- 投稿本文をサーバーログへ記録しない

データの共有範囲は、Apps Scriptプロジェクトと自動作成されるスプレッドシートのGoogleドライブ共有設定にも依存します。意図せず共有されていないことを定期的に確認してください。

## 今後の候補

- 投稿傾向の週次ダイジェスト
- 指定期間のアーカイブ
- 承認済み生成AIとの連携

生成AI連携は、投稿本文を送信できるサービスとデータ取扱条件が別途承認された場合だけ追加する想定です。
