/**
 * Google Workspace Studio custom steps for porotter.
 * These steps keep generation and storage inside Google Workspace.
 */

function onConfigPickPorotterPersona() {
  return studioPushCard_({
    sections: [{
      header: '疑似アカウントを選ぶ',
      widgets: [
        { textParagraph: { text: '有効な疑似アカウントから1件をランダムに選び、Gemini用のプロンプトを出力します。' } },
        { buttonList: { buttons: [studioSaveButton_()] } }
      ]
    }]
  });
}

function onExecutePickPorotterPersona() {
  const email = assertAuthorized_();
  const personas = listPersonas_(email).filter(function (persona) { return persona.enabled; });
  if (!personas.length) {
    throw new Error('有効な疑似アカウントがありません。ぽろったーの設定画面で作成してください。');
  }
  const persona = personas[Math.floor(Math.random() * personas.length)];
  return studioOutputVariables_({
    personaId: studioStringValue_(persona.id),
    personaName: studioStringValue_(persona.name),
    personaRole: studioStringValue_(persona.role),
    personaPrompt: studioStringValue_(persona.prompt),
    generationPrompt: studioStringValue_(buildPersonaGenerationPrompt_(persona))
  });
}

function onConfigPublishPorotterPost() {
  const variableSource = { workflowDataSource: { includeVariables: true } };
  return studioPushCard_({
    sections: [{
      header: 'ぽろったーへ投稿する',
      widgets: [
        {
          textInput: {
            name: 'personaId',
            label: '疑似アカウントID',
            hostAppDataSource: variableSource
          }
        },
        {
          textInput: {
            name: 'generatedText',
            label: 'Geminiの回答',
            type: 'MULTIPLE_LINE',
            hostAppDataSource: variableSource
          }
        },
        { buttonList: { buttons: [studioSaveButton_()] } }
      ]
    }]
  });
}

function onExecutePublishPorotterPost(event) {
  const email = assertAuthorized_();
  const personaId = studioInputString_(event, 'personaId');
  const generatedText = studioInputString_(event, 'generatedText');
  const personaRecord = ownedRecord_(CONFIG_.SHEETS.PERSONAS, personaId, email);
  if (!parseBoolean_(personaRecord.enabled)) {
    throw new Error('選ばれた疑似アカウントは現在無効です。');
  }
  const persona = presentPersona_(personaRecord);
  const generated = parseGeneratedPost_(generatedText);
  const timestamp = nowIso_();
  const post = {
    id: makeId_(),
    body: normalizeBody_(generated.body, CONFIG_.MAX_POST_LENGTH, '投稿'),
    tags: JSON.stringify(normalizeTags_(generated.tags)),
    createdAt: timestamp,
    updatedAt: timestamp,
    favorite: false,
    deletedAt: '',
    authorEmail: email,
    authorType: 'persona',
    authorId: persona.id,
    authorName: persona.name,
    sourceLabel: generated.sourceLabel,
    sourceUrl: generated.sourceUrl
  };
  appendRecord_(CONFIG_.SHEETS.POSTS, post);
  return studioOutputVariables_({
    postId: studioStringValue_(post.id),
    authorName: studioStringValue_(persona.name),
    body: studioStringValue_(post.body)
  });
}

function buildPersonaGenerationPrompt_(persona) {
  return [
    'あなたは非公開の仕事メモSNS「ぽろったー」に投稿します。',
    '疑似アカウント名: ' + persona.name,
    '役割: ' + persona.role,
    'パーソナリティ: ' + persona.prompt,
    '',
    'Google Workspace内の情報を参照し、Google Driveで過去7日程度に更新されたファイルから、',
    '仕事の改善・問い直し・次の一手につながるヒントを1つ選んでください。',
    '機密情報、個人名、顧客名、金額、ファイル本文を直接引用せず、抽象化して書いてください。',
    '本文は日本語240文字以内。断定しすぎず、この人物らしい視点と口調にしてください。',
    '該当する最近のファイルが見つからない場合は、一般的な業務の振り返りを投稿してください。',
    '',
    '次のJSONだけを返してください。コードブロックや説明は不要です。',
    '{"body":"投稿本文","tags":["タグ1","タグ2"],"sourceLabel":"参照テーマ（機密を含めない）","sourceUrl":""}'
  ].join('\n');
}

function parseGeneratedPost_(value) {
  let text = String(value || '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    parsed = { body: text, tags: ['AIの視点'], sourceLabel: '', sourceUrl: '' };
  }
  let body = String(parsed.body || parsed.post || '').trim();
  if (Array.from(body).length > CONFIG_.MAX_POST_LENGTH) {
    body = Array.from(body).slice(0, CONFIG_.MAX_POST_LENGTH - 1).join('') + '…';
  }
  const sourceUrl = normalizeDriveUrl_(parsed.sourceUrl);
  return {
    body: body,
    tags: Array.isArray(parsed.tags) ? parsed.tags : String(parsed.tags || '').split(/[,、\s]+/),
    sourceLabel: String(parsed.sourceLabel || '').trim().slice(0, 120),
    sourceUrl: sourceUrl
  };
}

function studioInputString_(event, id) {
  const inputs = event && event.workflow && event.workflow.actionInvocation && event.workflow.actionInvocation.inputs;
  const data = inputs && inputs[id];
  const value = data && data.stringValues && data.stringValues[0];
  if (value == null || String(value).trim() === '') throw new Error(id + ' が入力されていません。');
  return String(value);
}

function studioStringValue_(value) {
  return { stringValues: [String(value == null ? '' : value)] };
}

function studioOutputVariables_(variableDataMap) {
  const workflowAction = AddOnsResponseService.newReturnOutputVariablesAction()
    .setVariableDataMap(variableDataMap);
  const hostAppAction = AddOnsResponseService.newHostAppAction()
    .setWorkflowAction(workflowAction);
  return AddOnsResponseService.newRenderActionBuilder()
    .setHostAppAction(hostAppAction)
    .build();
}

function studioPushCard_(card) {
  return { action: { navigations: [{ push_card: card }] } };
}

function studioSaveButton_() {
  return {
    text: '保存',
    onClick: { hostAppAction: { workflowAction: { saveWorkflowAction: {} } } }
  };
}
