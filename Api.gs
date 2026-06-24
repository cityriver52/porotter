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
    return {
      timeline: buildTimeline_(filters || {}, snapshot),
      settings: publicSettings_(snapshot.settings, email),
      discovery: buildDiscovery_(snapshot),
      personas: listPersonas_(email, snapshot.personas),
      notifications: buildNotifications_(email, snapshot),
      aiAutomation: publicAiAutomationStatus_(buildAiAutomationStatus_(email))
    };
  });
}

function apiTimeline(filters) {
  return runApi_(function () {
    return buildTimeline_(filters || {});
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
      return { id: post.id, deletedAt: timestamp };
  });
}

function apiToggleFavorite(postId) {
  return runLockedApi_(function (email) {
      const post = ownedRecord_(CONFIG_.SHEETS.POSTS, postId, email);
      assertNotDeleted_(post);
      const favorite = !parseBoolean_(post.favorite);
      patchRecord_(CONFIG_.SHEETS.POSTS, post._row, { favorite: favorite });
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
      return presentReply_(Object.assign({}, reply, patch));
  });
}

function apiDeleteReply(replyId) {
  return runLockedApi_(function (email) {
      const reply = ownedRecord_(CONFIG_.SHEETS.REPLIES, replyId, email);
      assertNotDeleted_(reply);
      const timestamp = nowIso_();
      patchRecord_(CONFIG_.SHEETS.REPLIES, reply._row, { deletedAt: timestamp });
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
      const aiPostIntervalHours = normalizeAiIntervalHours_(
        payload && payload.aiPostIntervalHours,
        CONFIG_.DEFAULT_AI_POST_INTERVAL_HOURS
      );
      const aiReplyIntervalHours = normalizeAiIntervalHours_(
        payload && payload.aiReplyIntervalHours,
        CONFIG_.DEFAULT_AI_REPLY_INTERVAL_HOURS
      );
      const updates = {
        displayName: displayName,
        theme: theme,
        pageSize: String(pageSize),
        aiPostIntervalHours: String(aiPostIntervalHours),
        aiReplyIntervalHours: String(aiReplyIntervalHours)
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
    writeSettings_({ notificationsReadAt: nowIso_() });
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

function apiExport(format) {
  return runApi_(function (email) {
    const normalizedFormat = String(format || 'json').toLowerCase();
    const posts = recordsOwnedBy_(readRecords_(CONFIG_.SHEETS.POSTS), email)
      .map(function (post) { return exportRecord_(post); });
    const replies = recordsOwnedBy_(readRecords_(CONFIG_.SHEETS.REPLIES), email)
      .map(function (reply) { return exportRecord_(reply); });

    if (normalizedFormat === 'csv') {
      return {
        format: 'csv',
        filename: 'porotter-posts-' + localDateKey_() + '.csv',
        mimeType: 'text/csv;charset=utf-8',
        content: recordsToCsv_(posts, CONFIG_.SHEETS.POSTS.headers)
      };
    }
    return {
      format: 'json',
      filename: 'porotter-backup-' + localDateKey_() + '.json',
      mimeType: 'application/json;charset=utf-8',
      content: JSON.stringify({ exportedAt: nowIso_(), posts: posts, replies: replies }, null, 2)
    };
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

function createReadSnapshot_() {
  return {
    posts: readRecords_(CONFIG_.SHEETS.POSTS),
    replies: readRecords_(CONFIG_.SHEETS.REPLIES),
    settings: readSettings_(),
    personas: readRecords_(CONFIG_.SHEETS.PERSONAS)
  };
}

function buildTimeline_(rawFilters, snapshot) {
  const filters = rawFilters || {};
  const email = currentUserEmail_();
  const allReplies = snapshot && snapshot.replies || readRecords_(CONFIG_.SHEETS.REPLIES);
  const allPosts = snapshot && snapshot.posts || readRecords_(CONFIG_.SHEETS.POSTS);
  const activeReplies = recordsOwnedBy_(allReplies, email).filter(function (reply) {
    return !reply.deletedAt;
  });
  const replyCounts = countRepliesByPost_(activeReplies, true);

  const activePosts = recordsOwnedBy_(allPosts, email).filter(function (post) {
    return !post.deletedAt;
  });
  let posts = activePosts.slice();

  const query = String(filters.query || '').trim().toLocaleLowerCase();
  const tag = String(filters.tag || '').replace(/^#/, '').trim().toLocaleLowerCase();
  const startDate = isValidDateInput_(filters.startDate) ? String(filters.startDate) : '';
  const endDate = isValidDateInput_(filters.endDate) ? String(filters.endDate) : '';

  posts = posts.filter(function (post) {
    const tags = parseTags_(post.tags);
    const searchable = (String(post.body) + ' ' + tags.join(' ') + ' ' + String(post.authorName || '')).toLocaleLowerCase();
    const createdDate = localDateKey_(post.createdAt);
    if (query && searchable.indexOf(query) < 0) return false;
    if (tag && !tags.some(function (item) { return item.toLocaleLowerCase() === tag; })) return false;
    if (parseBoolean_(filters.favoriteOnly) && !parseBoolean_(post.favorite)) return false;
    if (filters.authorType === 'user' && String(post.authorType || 'user') === 'persona') return false;
    if (filters.replyState === 'with' && !(replyCounts[String(post.id)] > 0)) return false;
    if (filters.replyState === 'without' && replyCounts[String(post.id)] > 0) return false;
    if (startDate && createdDate < startDate) return false;
    if (endDate && createdDate > endDate) return false;
    return true;
  });

  posts.sort(compareCreatedDescending_);
  const total = posts.length;
  const offset = clampInteger_(filters.offset, 0, 0, Math.max(0, total));
  const settings = snapshot && snapshot.settings || readSettings_();
  const configuredPageSize = clampInteger_(settings.pageSize, CONFIG_.DEFAULT_PAGE_SIZE, 5, CONFIG_.MAX_PAGE_SIZE);
  const pageSize = clampInteger_(filters.pageSize, configuredPageSize, 5, CONFIG_.MAX_PAGE_SIZE);
  const page = posts.slice(offset, offset + pageSize).map(function (post) {
    return presentPost_(post, replyCounts[String(post.id)] || 0);
  });

  const tagCounts = {};
  activePosts.forEach(function (post) {
      parseTags_(post.tags).forEach(function (item) {
        tagCounts[item] = (tagCounts[item] || 0) + 1;
      });
    });

  return {
    posts: page,
    total: total,
    offset: offset,
    nextOffset: offset + page.length,
    hasMore: offset + page.length < total,
    tags: Object.keys(tagCounts)
      .map(function (name) { return { name: name, count: tagCounts[name] }; })
      .sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name, 'ja'); })
  };
}

function buildDiscovery_(snapshot) {
  const email = currentUserEmail_();
  const allPosts = snapshot && snapshot.posts || readRecords_(CONFIG_.SHEETS.POSTS);
  const posts = recordsOwnedBy_(allPosts, email)
    .filter(function (post) { return !post.deletedAt; });
  const counts = replyCountsByPost_(false, snapshot && snapshot.replies, email);
  const todayMonthDay = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM-dd');
  const currentYear = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy');
  const onThisDay = posts.filter(function (post) {
    const date = new Date(post.createdAt);
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'MM-dd') === todayMonthDay &&
      Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy') !== currentYear;
  }).sort(compareCreatedDescending_)[0];

  const unansweredCutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const unanswered = posts
    .filter(function (post) {
      return !counts[String(post.id)] && new Date(post.createdAt).getTime() < unansweredCutoff;
    })
    .sort(compareCreatedAscending_)[0];
  const random = posts.length ? posts[Math.floor(Math.random() * posts.length)] : null;

  return {
    onThisDay: onThisDay ? presentPost_(onThisDay, counts[String(onThisDay.id)] || 0) : null,
    unanswered: unanswered ? presentPost_(unanswered, 0) : null,
    random: random ? presentPost_(random, counts[String(random.id)] || 0) : null
  };
}

function buildNotifications_(email, snapshot) {
  const source = snapshot || createReadSnapshot_();
  const posts = recordsOwnedBy_(source.posts || [], email).filter(function (post) { return !post.deletedAt; });
  const replies = recordsOwnedBy_(source.replies || [], email).filter(function (reply) { return !reply.deletedAt; });
  const postById = posts.reduce(function (result, post) {
    result[String(post.id)] = post;
    return result;
  }, {});
  const firstUserReplyAt = replies.reduce(function (result, reply) {
    if (String(reply.authorType || 'user') === 'persona') return result;
    const postId = String(reply.postId);
    if (!result[postId] || String(reply.createdAt) < result[postId]) {
      result[postId] = String(reply.createdAt);
    }
    return result;
  }, {});
  const settings = source.settings || readSettings_();
  const readAt = String(settings.notificationsReadAt || '');
  const readByPost = parseNotificationPostReadAt_(settings.notificationsReadByPost);
  const items = replies
    .filter(function (reply) {
      if (String(reply.authorType || 'user') !== 'persona') return false;
      const post = postById[String(reply.postId)];
      if (!post) return false;
      if (String(post.authorType || 'user') !== 'persona') return true;
      const participatedAt = firstUserReplyAt[String(post.id)];
      return Boolean(participatedAt && participatedAt < String(reply.createdAt));
    })
    .sort(compareCreatedDescending_)
    .slice(0, 100)
    .map(function (reply) {
      const post = postById[String(reply.postId)];
      return {
        id: String(reply.id),
        postId: String(reply.postId),
        replyId: String(reply.id),
        authorName: String(reply.authorName || 'AIアカウント'),
        body: String(reply.body || ''),
        postBody: String(post && post.body || ''),
        createdAt: String(reply.createdAt || ''),
        unread: isNotificationUnread_(reply, readAt, readByPost)
      };
    });
  return {
    items: items,
    unreadCount: items.filter(function (item) { return item.unread; }).length,
    readAt: readAt
  };
}

function markNotificationPostRead_(postId) {
  const normalizedPostId = String(postId || '');
  if (!normalizedPostId) return;
  const settings = readSettings_();
  const readByPost = parseNotificationPostReadAt_(settings.notificationsReadByPost);
  readByPost[normalizedPostId] = nowIso_();
  writeSettings_({ notificationsReadByPost: JSON.stringify(compactNotificationPostReadAt_(readByPost)) });
}

function parseNotificationPostReadAt_(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.keys(parsed).reduce(function (result, postId) {
      const readAt = String(parsed[postId] || '');
      if (readAt) result[String(postId)] = readAt;
      return result;
    }, {});
  } catch (error) {
    return {};
  }
}

function compactNotificationPostReadAt_(readByPost) {
  return Object.keys(readByPost || {})
    .map(function (postId) {
      return { postId: String(postId), readAt: String(readByPost[postId] || '') };
    })
    .filter(function (item) { return item.postId && item.readAt; })
    .sort(function (a, b) { return String(b.readAt).localeCompare(String(a.readAt)); })
    .slice(0, 200)
    .reduce(function (result, item) {
      result[item.postId] = item.readAt;
      return result;
    }, {});
}

function isNotificationUnread_(reply, globalReadAt, readByPost) {
  const createdAt = String(reply.createdAt || '');
  const postReadAt = String(readByPost[String(reply.postId)] || '');
  const readAt = [String(globalReadAt || ''), postReadAt]
    .filter(Boolean)
    .sort()
    .pop() || '';
  return !readAt || createdAt > readAt;
}

function createNotificationSnapshot_() {
  return {
    posts: readRecords_(CONFIG_.SHEETS.POSTS),
    replies: readRecords_(CONFIG_.SHEETS.REPLIES),
    settings: readSettings_()
  };
}

function publicAiAutomationStatus_(status) {
  return {
    installed: Boolean(status && status.installed),
    requestCounts: Object.assign({}, status && status.requestCounts || {}),
    recentRequests: (status && status.recentRequests || []).map(function (request) {
      return Object.assign({}, request);
    })
  };
}

function ownedRecord_(definition, id, email) {
  const record = findRecordById_(definition, id);
  if (normalizeEmail_(record.authorEmail) !== normalizeEmail_(email)) {
    throw new Error('このデータを操作する権限がありません。');
  }
  return record;
}

function assertNotDeleted_(record) {
  if (record.deletedAt) throw new Error('このデータはごみ箱にあります。');
}

function presentPost_(record, replyCount) {
  return {
    id: String(record.id),
    body: String(record.body || ''),
    tags: parseTags_(record.tags),
    createdAt: String(record.createdAt || ''),
    updatedAt: String(record.updatedAt || record.createdAt || ''),
    favorite: parseBoolean_(record.favorite),
    deletedAt: String(record.deletedAt || ''),
    replyCount: Number(replyCount || 0),
    authorType: String(record.authorType || 'user'),
    authorId: String(record.authorId || ''),
    authorName: String(record.authorName || ''),
    sourceLabel: String(record.sourceLabel || ''),
    sourceUrl: normalizeReferenceUrl_(record.sourceUrl)
  };
}

function presentReply_(record) {
  return {
    id: String(record.id),
    postId: String(record.postId),
    parentReplyId: String(record.parentReplyId || ''),
    body: String(record.body || ''),
    createdAt: String(record.createdAt || ''),
    updatedAt: String(record.updatedAt || record.createdAt || ''),
    authorType: String(record.authorType || 'user'),
    authorId: String(record.authorId || ''),
    authorName: String(record.authorName || '')
  };
}

function publicSettings_(settings, email) {
  return {
    displayName: String(settings.displayName || email.split('@')[0]),
    email: email,
    theme: ['system', 'light', 'dark'].indexOf(settings.theme) >= 0 ? settings.theme : 'system',
    pageSize: clampInteger_(settings.pageSize, CONFIG_.DEFAULT_PAGE_SIZE, 5, CONFIG_.MAX_PAGE_SIZE),
    aiPostIntervalHours: normalizeAiIntervalHours_(settings.aiPostIntervalHours, CONFIG_.DEFAULT_AI_POST_INTERVAL_HOURS),
    aiReplyIntervalHours: normalizeAiIntervalHours_(settings.aiReplyIntervalHours, CONFIG_.DEFAULT_AI_REPLY_INTERVAL_HOURS),
    maxPostLength: CONFIG_.MAX_POST_LENGTH,
    maxReplyLength: CONFIG_.MAX_REPLY_LENGTH,
    maxTags: CONFIG_.MAX_TAGS,
    maxPersonaNameLength: CONFIG_.MAX_PERSONA_NAME_LENGTH,
    maxPersonaRoleLength: CONFIG_.MAX_PERSONA_ROLE_LENGTH,
    maxPersonaPromptLength: CONFIG_.MAX_PERSONA_PROMPT_LENGTH
  };
}

function listPersonas_(email, records) {
  return recordsOwnedBy_(records || readRecords_(CONFIG_.SHEETS.PERSONAS), email)
    .sort(function (a, b) {
      return Number(parseBoolean_(b.enabled)) - Number(parseBoolean_(a.enabled)) ||
        String(a.name).localeCompare(String(b.name), 'ja');
    })
    .map(presentPersona_);
}

function presentPersona_(record) {
  return {
    id: String(record.id || ''),
    name: String(record.name || ''),
    role: String(record.role || ''),
    prompt: String(record.prompt || ''),
    enabled: parseBoolean_(record.enabled),
    avatarColor: normalizePersonaAvatarColor_(record.avatarColor, record.id),
    createdAt: String(record.createdAt || ''),
    updatedAt: String(record.updatedAt || record.createdAt || '')
  };
}

function activeReplyCount_(postId) {
  return readRecords_(CONFIG_.SHEETS.REPLIES).filter(function (reply) {
    return String(reply.postId) === String(postId) && !reply.deletedAt;
  }).length;
}

function replyCountsByPost_(includeDeleted, records, email) {
  const replies = records || readRecords_(CONFIG_.SHEETS.REPLIES);
  return countRepliesByPost_(email ? recordsOwnedBy_(replies, email) : replies, includeDeleted);
}

function compareCreatedDescending_(a, b) {
  return String(b.createdAt).localeCompare(String(a.createdAt));
}

function compareCreatedAscending_(a, b) {
  return String(a.createdAt).localeCompare(String(b.createdAt));
}

function compareDeletedDescending_(a, b) {
  return String(b.deletedAt).localeCompare(String(a.deletedAt));
}

function localDateKey_(value) {
  const date = value ? new Date(value) : new Date();
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function exportRecord_(record) {
  const copy = {};
  Object.keys(record).forEach(function (key) {
    if (key !== '_row') copy[key] = record[key];
  });
  if (copy.tags) copy.tags = parseTags_(copy.tags);
  return copy;
}

function recordsToCsv_(records, headers) {
  const safeCell = function (value) {
    let text = Array.isArray(value) ? value.join(' ') : String(value == null ? '' : value);
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const lines = [headers.map(safeCell).join(',')];
  records.forEach(function (record) {
    lines.push(headers.map(function (header) { return safeCell(record[header]); }).join(','));
  });
  return '\uFEFF' + lines.join('\r\n');
}
