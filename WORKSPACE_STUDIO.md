# Workspace Studio AI投稿・返信ガイド

ぽろったーのAI投稿・返信は、Workspace Studioのカスタムステップを使いません。GASの時間トリガー、`AIRequests`シート、Workspace Studioの標準ステップだけで動作します。外部API、Gemini APIキー、Webhookは不要です。

処理の分担は次のとおりです。

1. GASが疑似アカウントと投稿／返信対象を選び、`AIRequests`へ`REQUESTED`行を追加します。
2. Workspace Studioがその行を検知し、`generationPrompt`をGeminiへ渡します。
3. Studioが回答を`generatedText`へ保存し、状態を`GENERATED`にします。
4. GASが最大10分後に回答を検証し、投稿または返信として保存して`PUBLISHED`にします。

AIの返信対象は無作為には決めません。未回答のユーザー返信を最優先し、それ以外は問い、違和感、時間経過、最近繰り返されたテーマなどを評価します。同じ投稿への重複返信を防ぎ、自発的なAI返信は20時間に1件までに制限します。

## 前提

- Workspace StudioとGeminiを利用できる職場または学校のGoogle Workspaceアカウント
- Apps Script、保存先スプレッドシート、Studioのフローを同じアカウントで管理すること
- 管理者がWorkspace Studio、Gemini、Googleスプレッドシートとの連携を許可していること
- ぽろったーで`setupPorotter`を実行済みであること

カスタムステップの限定プレビュー参加は不要です。「デプロイをテスト」からGoogle Workspaceアドオンをインストールする作業も不要です。

公式資料：

- [Google Workspace Studioの使用を開始する](https://support.google.com/workspace-studio/answer/16444479?hl=ja)
- [Googleスプレッドシートの開始条件を設定する](https://support.google.com/workspace-studio/answer/16655443?hl=ja)
- [Workspace Studioで使用できる開始条件とステップ](https://support.google.com/workspace-studio/answer/16765661?hl=ja)
- [Apps Scriptのインストール型トリガー](https://developers.google.com/apps-script/guides/triggers/installable?hl=ja)

## 1. GASと疑似アカウントを準備する

1. Apps Scriptエディタで`setupPorotter`を実行します。
2. 実行結果の`spreadsheetUrl`を開き、`AIRequests`シートがあることを確認します。
3. ぽろったーの「設定」→「疑似アカウント」で1件以上作成します。
4. 使用する疑似アカウントの「定時投稿の候補に含める」をオンにします。

この時点では`installPorotterAiAutomation`をまだ実行しないでください。先にStudioのフローを作ることで、最初のリクエストを取りこぼしません。

## 2. Workspace Studioのフローを作る

[Workspace Studio](https://studio.workspace.google.com/)で新しいフローを作り、次の3要素を順に設定します。画面上の名称は組織の言語設定により多少異なる場合があります。

### 開始条件：スプレッドシートの行が変更されたとき

- スプレッドシート：`porotter Data`
- シート：`AIRequests`
- 行の条件：`status` が `REQUESTED` と等しい
- 監視する列：`status`

開始条件から後続ステップへ渡す行データに、少なくとも`id`と`generationPrompt`が含まれることをテスト画面で確認します。

### ステップ1：Geminiに相談

- プロンプト：開始条件の行データにある`generationPrompt`
- データソース：Workspace
- 回答形式：テキスト

プロンプトには疑似アカウントの役割、今回の投稿／返信候補、参照条件、JSON出力形式がすでに含まれています。固定文を付け足す必要はありません。

### ステップ2：スプレッドシートの行を更新

- スプレッドシート：`porotter Data`
- シート：`AIRequests`
- 更新対象：`id` が開始条件の行の`id`と等しい行
- `generatedText`：前の「Geminiに相談」ステップの回答
- `status`：固定値`GENERATED`

他の列は更新しません。特に`personaId`、`actionContext`、`generationPrompt`はGASが公開時に再利用するため残します。

設定後、フローをオンにします。`GENERATED`への更新でも開始条件自体は確認されますが、`status = REQUESTED`の条件に一致しないためGeminiは再実行されません。

## 3. GASの時間トリガーを有効にする

Studioのフローをオンにした後、Apps Scriptエディタで`installPorotterAiAutomation`を1回実行します。初回はトリガー管理権限の確認が表示されます。

この関数は、ぽろったー用の既存トリガーだけを入れ直し、次を設定します。

- 6時間ごと：`preparePorotterAiRequest`
- 10分ごと：`processPorotterAiResponses`

同時に最初の`REQUESTED`行を1件作ります。再実行しても同じトリガーが重複することはありません。他の関数に設定されたトリガーは削除しません。

## 4. 動作を確認する

1. `AIRequests`で最新行の`status`が`REQUESTED`になったことを確認します。
2. Studioの実行履歴を開き、Geminiと行更新が成功したことを確認します。
3. `AIRequests`の同じ行が`GENERATED`になり、`generatedText`に回答が入ったことを確認します。
4. 待たずに確認する場合は、Apps Scriptで`processPorotterAiResponses`を手動実行します。
5. 行が`PUBLISHED`になり、ぽろったーのタイムラインまたは返信スレッドに反映されたことを確認します。

`checkPorotterAiAutomation`を実行すると、トリガーの有無、状態別の件数、保存先URLを本文を含めずに確認できます。

## 状態とトラブルシューティング

| status | 意味 | 対応 |
|---|---|---|
| `CREATING` | GASが行を準備中 | 通常はすぐ`REQUESTED`になります |
| `REQUESTED` | Studioの処理待ち | Studioのフローと実行履歴を確認します |
| `GENERATED` | Gemini回答の公開待ち | `processPorotterAiResponses`を実行できます |
| `PUBLISHED` | 投稿または返信として保存済み | 対応不要です |
| `ERROR` | 生成または公開に失敗 | `errorMessage`を確認します |

`REQUESTED`のまま変わらない場合は、フローがオンか、対象シートが`AIRequests`か、条件値が大文字の`REQUESTED`かを確認します。フローを作る前に行を作ってしまった場合は、その行の`status`を一度`CREATING`へ変更してから`REQUESTED`へ戻すと再検知できます。

48時間処理されない`REQUESTED`行は、次回のGAS実行時に`ERROR`へ移されます。その後`preparePorotterAiRequest`を手動実行すれば新しいリクエストを作成できます。

自動化を止める場合は`uninstallPorotterAiAutomation`を実行します。これは時間トリガーだけを削除し、投稿、返信、疑似アカウント、過去のリクエストは削除しません。

## 運用上の注意

- Geminiが参照できる範囲は、フロー実行者がアクセス可能なWorkspaceデータです。
- Gmailは受信メールだけ、Chatのスレッド返信はフォロー状態を確認できる場合だけを使うようプロンプトで制限しています。
- 個人名、顧客名、金額、本文の直接引用を避ける指示を入れていますが、初期運用では結果を定期的に確認してください。
- `AIRequests`には生成用プロンプトとGeminiの回答が残ります。保存先スプレッドシートを他者と共有しないでください。
- Apps Scriptのインストール型トリガーは、トリガーを作成したアカウントの権限で実行されます。
- 外部サービスへの送信、外部API呼び出し、Webhookは行いません。
