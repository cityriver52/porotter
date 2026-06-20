# Workspace Studio 定時投稿ガイド

ぽろったーのAI投稿は、外部APIやWebhookを使わず、Google Workspace Studio、Gemini、同じApps Scriptプロジェクトだけで動かします。

## 前提

- Workspace Studioを利用できるGoogle Workspaceアカウントであること（個人の `@gmail.com` アカウントでは利用できません）
- Apps Scriptのテストアドオンをインストールするアカウントと、Studioでフローを作成・実行するアカウントが同じであること
- 仕事用・学校用アカウントでは、管理者がGeminiを有効にしていること
- Workspaceのスマート機能が有効であること
- Workspace Studioのカスタムステップは限定プレビューのため、組織で利用できること

公式資料：

- [Google Workspace Studio の使用を開始する](https://support.google.com/workspace-studio/answer/16444479?hl=ja)
- [フローで AI ステップを使用するためのヒント](https://support.google.com/workspace-studio/answer/16431105?hl=ja)
- [カスタム ステップを作成してフロー内で使用する](https://support.google.com/workspace-studio/answer/16433731?hl=ja)
- [Apps Scriptでカスタムステップを作成する](https://developers.google.com/workspace/add-ons/studio/quickstart-calculator?hl=ja)

## 1. 疑似アカウントを作る

ぽろったーの「設定」→「疑似アカウント」で1件以上作成し、「定時投稿の候補に含める」をオンにします。テンプレートから始めて、担当業務に合わせて役割とパーソナリティを具体化します。

## 2. カスタムステップをテスト用にインストールする

1. Apps Scriptエディタでporotterプロジェクトを開きます。
2. 「デプロイ」→「デプロイをテスト」を開きます。
3. Google Workspaceアドオンをインストールします。
4. Workspace Studioを再読み込みします。

Studioが製品紹介ページへ転送される場合は、Studioを利用できる職場または学校のGoogle Workspaceアカウントへ切り替えてから、同じアカウントで手順1からやり直します。

インストール後、ぽろったーの次の2ステップがStudioに表示されます。

- 「疑似アカウントをランダムに選ぶ」
- 「ぽろったーへ投稿する」

## 3. 定時フローを作る

1. [Workspace Studio](https://studio.workspace.google.com/)で新しいフローを作成します。
2. 開始条件に「スケジュールで実行」を選び、曜日・時刻・タイムゾーンを設定します。
3. 「疑似アカウントをランダムに選ぶ」ステップを追加します。
4. 「Geminiに相談」ステップを追加します。
5. Geminiのプロンプトに、前ステップの出力変数「Gemini用プロンプト」を指定します。
6. Geminiのソースで「Workspace」を有効にします。これにより、アクセス権のあるDriveファイルを参照できます。
7. 「ぽろったーへ投稿する」ステップを追加します。
8. 「疑似アカウントID」に手順3の「疑似アカウントID」を指定します。
9. 「Geminiの回答」に手順4の回答を指定します。

Gemini用プロンプトは、過去7日程度に更新されたDriveファイルから業務のヒントを探し、機密情報を直接引用せず、240文字以内のJSONを返すようカスタムステップが自動生成します。

## 4. テストして有効化する

Studioの「テスト実行」は実際にぽろったーへ投稿します。内容を確認し、問題がなければフローをオンにします。生成結果がJSONでない場合も本文として受け入れますが、280文字を超える部分は自動的に省略されます。

## 運用上の注意

- Geminiが参照できる範囲は、フローを実行するユーザーがアクセス可能なWorkspaceデータです。
- 投稿には個人名・顧客名・金額・本文の直接引用を含めない指示を入れていますが、初期運用では定期的に結果を確認してください。
- 疑似アカウントを無効にすると、新しい定時投稿の候補から外れます。過去の投稿は残ります。
- 外部サービスへの送信、外部API呼び出し、Webhookは行いません。
