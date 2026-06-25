/**
 * Public API functions called from the HTML client.
 * Every endpoint authenticates independently and returns a stable envelope.
 */
function apiSetupStatus() {
  try {
    migrateLegacyProperties_();
    const email = currentUserEmail_();
    const properties = PropertiesService.getScriptProperties();
    const owner = normalizeEmail_(properties.getProperty(CONFIG_.PROPERTY_ALLOWED_EMAIL));
    const spreadsheetId = properties.getProperty(CONFIG_.PROPERTY_SPREADSHEET_ID);
    return {
      ok: true,
      data: {
        configured: Boolean(owner && spreadsheetId),
        authorized: !owner || owner === email,
        email: email
      }
    };
  } catch (error) {
    return { ok: false, error: String(error && error.message || '初期設定の状態を確認できませんでした。') };
  }
}

function apiSetupPorotter() {
  try {
    const email = currentUserEmail_();
    const result = withScriptLock_(function () {
      return setupPorotterForEmail_(email);
    });
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: String(error && error.message || '初期設定に失敗しました。') };
  }
}

function apiBootstrap(filters) {
  return runApi_(function (email) {
    ensureSchema_(getSpreadsheet_());
    ensureDefaultSettings_(email);
    const snapshot = createReadSnapshot_();
    const aiRequests = recordsOwnedBy_(readRecords_(CONFIG_.SHEETS.AI_REQUESTS), email);
    return {
      timeline: buildTimeline_(filters || {}, snapshot),
      settings: publicSettings_(snapshot.settings, email),
      discovery: buildDiscovery_(snapshot),
      personas: listPersonas_(email, snapshot.personas),
      notifications: buildNotifications_(email, snapshot),
      aiAutomation: publicAiAutomationStatus_(buildAiAutomationStatus_(email, aiRequests)),
      sync: buildSyncState_(snapshot.settings, aiRequests)
    };
  });
}

function apiTimeline(filters) {
  return runApi_(function () {
    return buildTimeline_(filters || {});
  });
}

function apiSync(payload) {
  return runApi_(function (email) {
    const options = payload || {};
    ensureSchema_(getSpreadsheet_());
    ensureDefaultSettings_(email);

    let aiProcessResult = null;
    let aiProcessError = '';
    if (options.processAiResponses !== false) {
      try {
        aiProcessResult = processPorotterAiResponses();
      } catch (error) {
        aiProcessError = String(error && error.message || 'AI生成結果の確認に失敗しました。');
      }
    }

    const settings = readSettings_();
    const aiRequests = recordsOwnedBy_(readRecords_(CONFIG_.SHEETS.AI_REQUESTS), email);
    const sync = buildSyncState_(settings, aiRequests);
    const clientSync = normalizeClientSyncCursor_(options.sync || {});
    const contentChanged = cursorChanged_(clientSync.contentCursor, sync.contentCursor);
    const notificationsChanged = contentChanged || cursorChanged_(clientSync.notificationsCursor, sync.notificationsCursor);
    const aiChanged = cursorChanged_(clientSync.aiCursor, sync.aiCursor);
    let snapshot = null;
    const response = {
      changed: contentChanged || notificationsChanged || aiChanged,
      contentChanged: contentChanged,
      notificationsChanged: notificationsChanged,
      aiChanged: aiChanged,
      sync: sync,
      aiAutomation: publicAiAutomationStatus_(buildAiAutomationStatus_(email, aiRequests)),
      aiProcessResult: aiProcessResult,
      aiProcessError: aiProcessError
    };

    if (contentChanged && options.includeTimeline !== false) {
      snapshot = createReadSnapshot_();
      response.timeline = buildTimeline_(options.filters || {}, snapshot);
    }
    if (notificationsChanged || options.includeNotifications === true) {
      snapshot = snapshot || createNotificationSnapshot_();
      response.notifications = buildNotifications_(email, snapshot);
    }
    return response;
  });
}

function apiCreatePost(payload) {
  return runLockedApi_(function (email) {
      const post = createPostRecord_({
        email: email,
        body: payload && payload.body,
        tags: payload && payload.tags,
        sourceUrl: validateReferenceUrl_(payload && payload.sourceUrl)
      });
      appendRecord_(CONFIG_.SHEETS.POSTS, post);
      touchContentUpdated_();
      return presentPost_(post, 0);
  });
}

function apiUpdatePost(postId, payload) {
  return runLockedApi_(function (email) {
      const post = ownedRecord_(CONFIG_.SHEETS.POSTS, postId, email);
      assertNotDeleted_(post);
      const patch = {
        body: normalizeBody_(payload && payload.body, CONFIG_.MAX_POST_LENGTH, '投稿'),
        tags: JSON.stringify(normalizeTags_(payload && payload.tags)),
        sourceUrl: validateReferenceUrl_(payload && payload.sourceUrl),
        updatedAt: nowIso_()
      };
      patchRecord_(CONFIG_.SHEETS.POSTS, post._row, patch);
      touchContentUpdated_(patch.updatedAt);
      return presentPost_(Object.assign({}, post, patch), activeReplyCount_(post.id));
  });
}

function apiDeletePost(postId) {
  return runLockedApi_(function (email) {
      const post = ownedRecord_(CONFIG_.SHEETS.POSTS, postId, email);
      assertNotDeleted_(post);
      const timestamp = nowIso_();
      patchRecord_(CONFIG_.SHEETS.POSTS, post._row, { deletedAt: timestamp });
      readRecords_(CONFIG_.SHEETS.REPLIES)
        .filter(function (reply) {
          return String(reply.postId) === String(postId) && !reply.deletedAt;
        })
        .forEach(function (reply) {
          patchRecord_(CONFIG_.SHEETS.REPLIES, reply._row, { deletedAt: timestamp });
        });
      touchContentUpdated_(timestamp);
      return { id: post.id, deletedAt: timestamp };
  });
}

function apiToggleFavorite(postId) {
  return runLockedApi_(function (email) {
      const post = ownedRecord_(CONFIG_.SHEETS.POSTS, postId, email);
      assertNotDeleted_(post);
      const favorite = !parseBoolean_(post.favorite);
      patchRecord_(CONFIG_.SHEETS.POSTS, post._row, { favorite: favorite });
      touchContentUpdated_();
      return { id: post.id, favorite: favorite };
  });
}

function apiThread(postId) {
  return runLockedApi_(function (email) {
    const post = ownedRecord_(CONFIG_.SHEETS.POSTS, postId, email);
    assertNotDeleted_(post);
    markNotificationPostRead_(post.id);
    const replies = recordsOwnedBy_(readRecords_(CONFIG_.SHEETS.REPLIES), email)
      .filter(function (reply) {
        return String(reply.postId) === String(postId) && !reply.deletedAt;
      })
      .sort(compareCreatedAscending_)
      .map(presentReply_);
    return { post: presentPost_(post, replies.length), replies: replies };
  });
}

function apiCreateReply(postId, payload) {
  return runLockedApi_(function (email) {
      const post = ownedRecord_(CONFIG_.SHEETS.POSTS, postId, email);
      assertNotDeleted_(post);
      const settings = readSettings_();
      const reply = createReplyRecord_({
        postId: post.id,
        email: email,
        body: payload && payload.body,
        authorType: 'user',
        authorId: email,
        authorName: String(settings.displayName || email.split('@')[0])
      });
      appendRecord_(CONFIG_.SHEETS.REPLIES, reply);
      touchContentUpdated_();
      return presentReply_(reply);
  });
}

function apiUpdateReply(replyId, payload) {
  return runLockedApi_(function (email) {
      const reply = ownedRecord_(CONFIG_.SHEETS.REPLIES, replyId, email);
      assertNotDeleted_(reply);
      const patch = {
        body: normalizeBody_(payload && payload.body, CONFIG_.MAX_REPLY_LENGTH, '返信'),
        updatedAt: nowIso_()
      };
      patchRecord_(CONFIG_.SHEETS.REPLIES, reply._row, patch);
      touchContentUpdated_(patch.updatedAt);
      return presentReply_(Object.assign({}, reply, patch));
  });
}

function apiDeleteReply(replyId) {
  return runLockedApi_(function (email) {
      const reply = ownedRecord_(CONFIG_.SHEETS.REPLIES, replyId, email);
      assertNotDeleted_(reply);
      const timestamp = nowIso_();
      patchRecord_(CONFIG_.SHEETS.REPLIES, reply._row, { deletedAt: timestamp });
      touchContentUpdated_(timestamp);
      return { id: reply.id, deletedAt: timestamp };
  });
}

function apiTrash() {
  return runApi_(function (email) {
    const replyCounts = replyCountsByPost_(true, null, email);
    const posts = recordsOwnedBy_(readRecords_(CONFIG_.SHEETS.POSTS), email)
      .filter(function (post) {
        return Boolean(post.deletedAt);
      })
      .sort(compareDeletedDescending_)
      .map(function (post) {
        return presentPost_(post, replyCounts[String(post.id)] || 0);
      });
    return { posts: posts, retentionDays: CONFIG_.TRASH_RETENTION_DAYS };
  });
}

function apiRestorePost(postId) {
  return runLockedApi_(function (email) {
      const post = ownedRecord_(CONFIG_.SHEETS.POSTS, postId, email);
      if (!post.deletedAt) throw new Error('この投稿は削除されていません。');
      const cascadeTimestamp = String(post.deletedAt);
      patchRecord_(CONFIG_.SHEETS.POSTS, post._row, { deletedAt: '' });
      readRecords_(CONFIG_.SHEETS.REPLIES)
        .filter(function (reply) {
          return String(reply.postId) === String(postId) && String(reply.deletedAt) === cascadeTimestamp;
        })
        .forEach(function (reply) {
          patchRecord_(CONFIG_.SHEETS.REPLIES, reply._row, { deletedAt: '' });
        });
      touchContentUpdated_();
      return { id: post.id };
  });
}

function apiPermanentlyDeletePost(postId) {
  return runLockedApi_(function (email) {
      const post = ownedRecord_(CONFIG_.SHEETS.POSTS, postId, email);
      if (!post.deletedAt) throw new Error('ごみ箱にある投稿だけを完全に削除できます。');

      readRecords_(CONFIG_.SHEETS.REPLIES)
        .filter(function (reply) { return String(reply.postId) === String(postId); })
        .sort(function (a, b) { return b._row - a._row; })
        .forEach(function (reply) { deleteRecordRow_(CONFIG_.SHEETS.REPLIES, reply._row); });
      deleteRecordRow_(CONFIG_.SHEETS.POSTS, post._row);
      touchContentUpdated_();
      return { id: post.id };
  });
}

function apiGetSettings() {
  return runApi_(function (email) {
    return publicSettings_(readSettings_(), email);
  });
}

function apiListPersonas() {
  return runApi_(function (email) {
    return listPersonas_(email);
  });
}

function apiSavePersona(personaId, payload) {
  return runLockedApi_(function (email) {
      const normalized = normalizePersona_(payload || {});
      const timestamp = nowIso_();
      if (personaId) {
        const persona = ownedRecord_(CONFIG_.SHEETS.PERSONAS, personaId, email);
        const patch = Object.assign({}, normalized, { updatedAt: timestamp });
        patchRecord_(CONFIG_.SHEETS.PERSONAS, persona._row, patch);
        return presentPersona_(Object.assign({}, persona, patch));
      }
      const persona = Object.assign({
        id: makeId_(),
        createdAt: timestamp,
        updatedAt: timestamp,
        authorEmail: email,
        avatarColor: randomPersonaAvatarColor_(recordsOwnedBy_(readRecords_(CONFIG_.SHEETS.PERSONAS), email))
      }, normalized);
      appendRecord_(CONFIG_.SHEETS.PERSONAS, persona);
      return presentPersona_(persona);
  });
}

function apiTogglePersona(personaId) {
  return runLockedApi_(function (email) {
      const persona = ownedRecord_(CONFIG_.SHEETS.PERSONAS, personaId, email);
      const enabled = !parseBoolean_(persona.enabled);
      const updatedAt = nowIso_();
      patchRecord_(CONFIG_.SHEETS.PERSONAS, persona._row, { enabled: enabled, updatedAt: updatedAt });
      return presentPersona_(Object.assign({}, persona, { enabled: enabled, updatedAt: updatedAt }));
  });
}

function apiDeletePersona(personaId) {
  return runLockedApi_(function (email) {
      const persona = ownedRecord_(CONFIG_.SHEETS.PERSONAS, personaId, email);
      deleteRecordRow_(CONFIG_.SHEETS.PERSONAS, persona._row);
      return { id: String(persona.id) };
  });
}

function apiSaveSettings(payload) {
  return runLockedApi_(function (email) {
      const displayName = String(payload && payload.displayName || '').trim();
      if (!displayName || displayName.length > 40) {
        throw new Error('表示名は1〜40文字で入力してください。');
      }
      const theme = ['system', 'light', 'dark'].indexOf(payload && payload.theme) >= 0
        ? payload.theme
        : 'system';
      const pageSize = clampInteger_(payload && payload.pageSize, CONFIG_.DEFAULT_PAGE_SIZE, 5, CONFIG_.MAX_PAGE_SIZE);
      const aiAutomationIntervalHours = normalizeAiIntervalHours_(
        payload && payload.aiAutomationIntervalHours,
        CONFIG_.DEFAULT_AI_AUTOMATION_INTERVAL_HOURS
      );
      const updates = {
        displayName: displayName,
        theme: theme,
        pageSize: String(pageSize),
        aiAutomationIntervalHours: String(aiAutomationIntervalHours)
      };
      writeSettings_(updates);
      return publicSettings_(Object.assign({}, readSettings_(), updates), email);
  });
}

function apiNotifications() {
  return runApi_(function (email) {
    return buildNotifications_(email, createNotificationSnapshot_());
  });
}

function apiMarkNotificationsRead() {
  return runLockedApi_(function (email) {
    const timestamp = nowIso_();
    writeSettings_({ notificationsReadAt: timestamp, notificationsUpdatedAt: timestamp });
    return buildNotifications_(email, createNotificationSnapshot_());
  });
}

function apiGetAiAutomationStatus() {
  return runApi_(function (email) {
    return publicAiAutomationStatus_(buildAiAutomationStatus_(email));
  });
}

function apiInstallAiAutomation() {
  return runApi_(function () {
    return installPorotterAiAutomation();
  });
}

function apiUninstallAiAutomation() {
  return runApi_(function () {
    return uninstallPorotterAiAutomation();
  });
}

function apiRequestAiPost(personaId) {
  return runLockedApi_(function (email) {
    ensureSchema_(getSpreadsheet_());
    expireStaleAiRequests_(email);
    return createPorotterAiRequest_(email, { activityType: 'post', personaId: personaId, manual: true });
  });
}

function apiProcessAiResponses() {
  return runApi_(function () {
    return processPorotterAiResponses();
  });
}

function apiDiscovery() {
  return runApi_(function () {
    return buildDiscovery_();
  });
}

function runApi_(callback) {
  try {
    const email = assertAuthorized_();
    return { ok: true, data: callback(email) };
  } catch (error) {
    console.error('porotter API error: ' + String(error && error.name || 'Error'));
    return { ok: false, error: String(error && error.message || '処理に失敗しました。') };
  }
}

function runLockedApi_(callback) {
  return runApi_(function (email) {
    return withScriptLock_(function () {
      return callback(email);
    });
  });
}
