/**
 * Queue bridge between porotter and standard Google Workspace Studio steps.
 * GAS prepares prompts and publishes completed responses; Studio only generates text.
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
    const automationInterval = normalizeAiAutomationIntervalHours_(settings);
    const selected = aiAutomationRequestDue_(requests, automationInterval)
      ? chooseAiAutomationActivity_(email, persona)
      : null;
    const activity = selected && selected.activity;
    if (!activity) {
      return {
        created: false,
        reason: '設定した頻度に達していません。',
        pendingCount: pendingAiRequestCount_(requests)
      };
    }
    return createPorotterAiRequest_(email, {
      persona: persona,
      activity: activity,
      actionType: selected.actionType
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
    const request = {
      id: makeId_(),
      status: CONFIG_.AI_REQUEST_STATUS.CREATING,
      personaId: persona.id,
      personaName: persona.name,
      actionType: String(requestOptions.actionType || (activity.type === 'post' ? '新規投稿' : '返信')),
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

function pendingAiRequestCount_(requests) {
  return (requests || []).filter(function (request) {
    return [CONFIG_.AI_REQUEST_STATUS.CREATING,
      CONFIG_.AI_REQUEST_STATUS.GENERATED].indexOf(String(request.status)) >= 0;
  }).length;
}

function aiAutomationRequestDue_(requests, intervalHours) {
  const intervalMs = aiIntervalHoursToMs_(intervalHours);
  if (!intervalMs) return false;
  const latest = (requests || [])
    .map(function (request) { return new Date(request.createdAt).getTime(); })
    .filter(Number.isFinite)
    .sort(function (a, b) { return b - a; })[0];
  return !latest || Date.now() - latest >= intervalMs;
}

function chooseAiAutomationActivity_(email, persona) {
  const replyActivity = chooseStudioActivity_(email, persona, { only: 'reply' });
  if (replyActivity) return { activity: replyActivity, actionType: '返信' };

  const postActivity = chooseStudioActivity_(email, persona, { only: 'post' });
  if (!postActivity) return null;
  postActivity.targetSummary = postActivity.targetSummary || '返信対象がないため新規投稿';
  postActivity.context = Object.assign({}, postActivity.context || {}, { fallbackFrom: 'reply' });
  return { activity: postActivity, actionType: '新規投稿' };
}

function processPorotterAiResponses() {
  return withScriptLock_(function () {
    const email = automationOwnerEmail_();
    ensureSchema_(getSpreadsheet_());
    const requests = recordsOwnedBy_(readRecords_(CONFIG_.SHEETS.AI_REQUESTS), email)
      .filter(function (request) {
        return String(request.status) === CONFIG_.AI_REQUEST_STATUS.GENERATED;
      })
      .sort(compareCreatedAscending_)
      .slice(0, CONFIG_.AI_REQUEST_PROCESS_LIMIT);
    const results = [];

    requests.forEach(function (request) {
      try {
        if (!String(request.generatedText || '').trim()) {
          throw new Error('Workspace Studioから生成結果が書き込まれていません。');
        }
        const published = publishGeneratedPorotter_(
          email,
          String(request.personaId || ''),
          String(request.actionContext || ''),
          String(request.generatedText || '')
        );
        patchRecord_(CONFIG_.SHEETS.AI_REQUESTS, request._row, {
          status: CONFIG_.AI_REQUEST_STATUS.PUBLISHED,
          resultType: published.entryType,
          resultPostId: published.postId,
          resultReplyId: published.replyId,
          errorMessage: '',
          updatedAt: nowIso_()
        });
        results.push({ requestId: String(request.id), status: CONFIG_.AI_REQUEST_STATUS.PUBLISHED });
      } catch (error) {
        const message = String(error && error.message || 'AI生成結果の公開に失敗しました。').slice(0, 500);
        patchRecord_(CONFIG_.SHEETS.AI_REQUESTS, request._row, {
          status: CONFIG_.AI_REQUEST_STATUS.ERROR,
          errorMessage: message,
          updatedAt: nowIso_()
        });
        results.push({ requestId: String(request.id), status: CONFIG_.AI_REQUEST_STATUS.ERROR, error: message });
      }
    });

    return {
      processedCount: results.length,
      publishedCount: results.filter(function (result) {
        return result.status === CONFIG_.AI_REQUEST_STATUS.PUBLISHED;
      }).length,
      errorCount: results.filter(function (result) {
        return result.status === CONFIG_.AI_REQUEST_STATUS.ERROR;
      }).length,
      results: results
    };
  });
}

function processPorterAiResponses() {
  return processPorotterAiResponses();
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

function uninstallPorotterAiAutomation() {
  const email = automationOwnerEmail_();
  const deletedCount = removePorotterAiTriggers_();
  return { installed: false, ownerEmail: email, deletedCount: deletedCount };
}

function checkPorotterAiAutomation() {
  const email = automationOwnerEmail_();
  return buildAiAutomationStatus_(email);
}

function buildAiAutomationStatus_(email) {
  ensureSchema_(getSpreadsheet_());
  const handlers = porotterAiTriggerHandlers_();
  const legacyHandlers = legacyPorotterAiTriggerHandlers_();
  const managedHandlers = managedPorotterAiTriggerHandlers_();
  const installedHandlers = ScriptApp.getProjectTriggers().map(function (trigger) {
    return trigger.getHandlerFunction();
  });
  const requests = recordsOwnedBy_(readRecords_(CONFIG_.SHEETS.AI_REQUESTS), email);
  const counts = requests
    .reduce(function (result, request) {
      const status = String(request.status || 'UNKNOWN');
      result[status] = (result[status] || 0) + 1;
      return result;
    }, {});
  const currentInstalled = handlers.every(function (handler) {
    return installedHandlers.indexOf(handler) >= 0;
  });
  const legacyInstalled = legacyHandlers.every(function (handler) {
    return installedHandlers.indexOf(handler) >= 0;
  });
  return {
    installed: currentInstalled || legacyInstalled,
    ownerEmail: email,
    triggerHandlers: installedHandlers.filter(function (handler) { return managedHandlers.indexOf(handler) >= 0; }),
    requestCounts: counts,
    recentRequests: requests.sort(compareCreatedDescending_).slice(0, 10).map(function (request) {
      return {
        id: String(request.id || ''),
        status: String(request.status || ''),
        personaName: String(request.personaName || ''),
        actionType: String(request.actionType || ''),
        targetSummary: String(request.targetSummary || ''),
        errorMessage: String(request.errorMessage || ''),
        createdAt: String(request.createdAt || ''),
        updatedAt: String(request.updatedAt || '')
      };
    }),
    spreadsheetUrl: getSpreadsheet_().getUrl(),
    queueSheetName: CONFIG_.SHEETS.AI_REQUESTS.name
  };
}

function automationOwnerEmail_() {
  migrateLegacyProperties_();
  const allowedEmail = normalizeEmail_(
    PropertiesService.getScriptProperties().getProperty(CONFIG_.PROPERTY_ALLOWED_EMAIL)
  );
  if (!allowedEmail) {
    throw new Error('初期設定が完了していません。setupPorotter を実行してください。');
  }
  const effectiveEmail = normalizeEmail_(Session.getEffectiveUser().getEmail());
  if (effectiveEmail && effectiveEmail !== allowedEmail) {
    throw new Error('ぽろったーの所有者アカウントで実行してください。');
  }
  return allowedEmail;
}

function expireStaleAiRequests_(email) {
  const cutoff = Date.now() - (CONFIG_.AI_REQUEST_STALE_HOURS * 60 * 60 * 1000);
  recordsOwnedBy_(readRecords_(CONFIG_.SHEETS.AI_REQUESTS), email).forEach(function (request) {
    const status = String(request.status || '');
    const createdAt = new Date(request.createdAt).getTime();
    if ([CONFIG_.AI_REQUEST_STATUS.CREATING, CONFIG_.AI_REQUEST_STATUS.REQUESTED].indexOf(status) >= 0 &&
        Number.isFinite(createdAt) && createdAt < cutoff) {
      patchRecord_(CONFIG_.SHEETS.AI_REQUESTS, request._row, {
        status: CONFIG_.AI_REQUEST_STATUS.ERROR,
        errorMessage: 'Workspace Studioで48時間以内に処理されなかったため終了しました。',
        updatedAt: nowIso_()
      });
    }
  });
}

function porotterAiTriggerHandlers_() {
  return ['preparePorotterAiRequest', 'processPorotterAiResponses'];
}

function legacyPorotterAiTriggerHandlers_() {
  return ['preparePorterAiRequest', 'processPorterAiResponses'];
}

function managedPorotterAiTriggerHandlers_() {
  return porotterAiTriggerHandlers_().concat(legacyPorotterAiTriggerHandlers_());
}

function removePorotterAiTriggers_() {
  const handlers = managedPorotterAiTriggerHandlers_();
  let deletedCount = 0;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(trigger);
      deletedCount += 1;
    }
  });
  return deletedCount;
}
