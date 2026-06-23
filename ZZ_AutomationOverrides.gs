/**
 * Override scheduling rules for AI automation.
 *
 * This file intentionally shadows the older definitions so the latest
 * scheduling behavior can be loaded without rewriting the legacy file.
 */

function preparePorotterAiRequest() {
  return withScriptLock_(function () {
    const email = automationOwnerEmail_();
    ensureSchema_(getSpreadsheet_());
    expireStaleAiRequests_(email);
    const personas = listPersonas_(email).filter(function (persona) { return persona.enabled; });
    if (!personas.length) {
      return {
        created: false,
        reason: '有効な疑似アカウントがありません。',
        pendingCount: 0
      };
    }

    const persona = personas[Math.floor(Math.random() * personas.length)];
    const requests = recordsOwnedBy_(readRecords_(CONFIG_.SHEETS.AI_REQUESTS), email);
    const settings = readSettings_();
    const replyInterval = normalizeAiIntervalHours_(
      settings.aiReplyIntervalHours,
      CONFIG_.DEFAULT_AI_REPLY_INTERVAL_HOURS
    );
    const postInterval = normalizeAiIntervalHours_(
      settings.aiPostIntervalHours,
      CONFIG_.DEFAULT_AI_POST_INTERVAL_HOURS
    );
    const replyDue = aiRequestDue_(requests, '霑比ｿ｡', replyInterval);
    const postDue = aiRequestDue_(requests, '譁ｰ隕乗兜遞ｿ', postInterval);
    let activity = null;
    let requestActionType = '';

    if (replyDue) {
      activity = chooseStudioActivity_(email, persona, { only: 'reply' });
      if (!activity) {
        activity = chooseStudioActivity_(email, persona, { only: 'post' });
        if (activity) {
          activity = Object.assign({}, activity, {
            targetSummary: '返信対象がないため新規投稿',
            context: Object.assign({}, activity.context, { fallbackFrom: 'reply' })
          });
          requestActionType = '霑比ｿ｡';
        }
      }
    }

    if (!activity && postDue) {
      activity = chooseStudioActivity_(email, persona, { only: 'post' });
    }

    if (!activity) {
      return {
        created: false,
        reason: '設定した頻度に達していないか、生成対象がありません。',
        pendingCount: pendingAiRequestCount_(requests)
      };
    }

    return createPorotterAiRequest_(email, {
      persona: persona,
      activity: activity,
      actionType: requestActionType
    });
  });
}

function preparePorterAiRequest() {
  return preparePorotterAiRequest();
}

function createPorotterAiRequest_(email, options) {
  const requestOptions = options || {};
  const requests = recordsOwnedBy_(readRecords_(CONFIG_.SHEETS.AI_REQUESTS), email);
  const pendingCount = pendingAiRequestCount_(requests);
  if (pendingCount) {
    return {
      created: false,
      reason: '処理待ちのAIリクエストがあります。',
      pendingCount: pendingCount
    };
  }

  const personas = listPersonas_(email).filter(function (persona) { return persona.enabled; });
  let persona = requestOptions.persona || null;
  if (requestOptions.personaId) {
    persona = personas.find(function (item) { return String(item.id) === String(requestOptions.personaId); }) || null;
  }
  if (!persona && !requestOptions.personaId && personas.length) {
    persona = personas[Math.floor(Math.random() * personas.length)];
  }
  if (!persona) {
    return { created: false, reason: '有効な疑似アカウントがありません。', pendingCount: 0 };
  }

  let activity = requestOptions.activity || null;
  if (!activity && requestOptions.activityType === 'post') {
    activity = chooseStudioActivity_(email, persona, { only: 'post' });
  }
  if (!activity) throw new Error('AI投稿または返信の生成対象を決められませんでした。');

  const timestamp = nowIso_();
  const requestActionType = String(requestOptions.actionType || (activity.type === 'post' ? '譁ｰ隕乗兜遞ｿ' : '霑比ｿ｡'));
  const request = {
    id: makeId_(),
    status: CONFIG_.AI_REQUEST_STATUS.CREATING,
    personaId: persona.id,
    personaName: persona.name,
    actionType: requestActionType,
    targetSummary: activity.targetSummary || '新しい気づきを投稿',
    actionContext: JSON.stringify(activity.context),
    generationPrompt: buildPersonaGenerationPrompt_(email, persona, activity),
    generatedText: '',
    resultType: '',
    resultPostId: '',
    resultReplyId: '',
    errorMessage: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    authorEmail: email
  };
  appendRecord_(CONFIG_.SHEETS.AI_REQUESTS, request);

  // Write REQUESTED separately so Studio sees a complete row when the watched status changes.
  const stored = findRecordById_(CONFIG_.SHEETS.AI_REQUESTS, request.id);
  patchRecord_(CONFIG_.SHEETS.AI_REQUESTS, stored._row, {
    status: CONFIG_.AI_REQUEST_STATUS.REQUESTED,
    updatedAt: nowIso_()
  });

  return {
    created: true,
    requestId: request.id,
    status: CONFIG_.AI_REQUEST_STATUS.REQUESTED,
    personaName: persona.name,
    actionType: request.actionType,
    targetSummary: request.targetSummary,
    spreadsheetUrl: getSpreadsheet_().getUrl(),
    queueSheetName: CONFIG_.SHEETS.AI_REQUESTS.name
  };
}

function installPorotterAiAutomation() {
  const email = automationOwnerEmail_();
  ensureSchema_(getSpreadsheet_());
  removePorotterAiTriggers_();

  ScriptApp.newTrigger('preparePorotterAiRequest')
    .timeBased()
    .everyMinutes(10)
    .create();
  ScriptApp.newTrigger('processPorotterAiResponses')
    .timeBased()
    .everyMinutes(10)
    .create();

  return {
    installed: true,
    ownerEmail: email,
    spreadsheetUrl: getSpreadsheet_().getUrl(),
    queueSheetName: CONFIG_.SHEETS.AI_REQUESTS.name,
    triggerHandlers: porotterAiTriggerHandlers_()
  };
}

function aiRequestDue_(requests, actionType, intervalHours) {
  const intervalMs = aiIntervalHoursToMs_(intervalHours);
  if (!intervalMs) return false;
  const latest = (requests || [])
    .filter(function (request) { return String(request.actionType) === actionType; })
    .map(function (request) { return new Date(request.createdAt).getTime(); })
    .filter(Number.isFinite)
    .sort(function (a, b) { return b - a; })[0];
  return !latest || Date.now() - latest >= intervalMs;
}
