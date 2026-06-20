/**
 * Public API functions called from the HTML client.
 * Every endpoint authenticates independently and returns a stable envelope.
 */
function apiBootstrap(filters) {
  return runApi_(function (email) {
    ensureSchema_(getSpreadsheet_());
    ensureDefaultSettings_(email);
    return {
      timeline: buildTimeline_(filters || {}),
      settings: publicSettings_(readSettings_(), email),
      discovery: buildDiscovery_(),
      personas: listPersonas_(email)
    };
  });
}

function apiTimeline(filters) {
  return runApi_(function () {
    return buildTimeline_(filters || {});
  });
}

function apiCreatePost(payload) {
  return runApi_(function (email) {
    return withScriptLock_(function () {
      const timestamp = nowIso_();
      const post = {
        id: makeId_(),
        body: normalizeBody_(payload && payload.body, CONFIG_.MAX_POST_LENGTH, '投稿'),
        tags: JSON.stringify(normalizeTags_(payload && payload.tags)),
        createdAt: timestamp,
        updatedAt: timestamp,
        favorite: false,
        deletedAt: '',
        authorEmail: email,
        authorType: 'user',
        authorId: email,
        authorName: '',
        sourceLabel: '',
        sourceUrl: ''
      };
      appendRecord_(CONFIG_.SHEETS.POSTS, post);
      return presentPost_(post, 0);
    });
  });
}

function apiUpdatePost(postId, payload) {
  return runApi_(function (email) {
    return withScriptLock_(function () {
      const post = ownedRecord_(CONFIG_.SHEETS.POSTS, postId, email);
      assertNotDeleted_(post);
      const patch = {
        body: normalizeBody_(payload && payload.body, CONFIG_.MAX_POST_LENGTH, '投稿'),
        tags: JSON.stringify(normalizeTags_(payload && payload.tags)),
        updatedAt: nowIso_()
      };
      patchRecord_(CONFIG_.SHEETS.POSTS, post._row, patch);
      return presentPost_(Object.assign({}, post, patch), activeReplyCount_(post.id));
    });
  });
}

function apiDeletePost(postId) {
  return runApi_(function (email) {
    return withScriptLock_(function () {
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
  });
}

function apiToggleFavorite(postId) {
  return runApi_(function (email) {
    return withScriptLock_(function () {
      const post = ownedRecord_(CONFIG_.SHEETS.POSTS, postId, email);
      assertNotDeleted_(post);
      const favorite = !parseBoolean_(post.favorite);
      patchRecord_(CONFIG_.SHEETS.POSTS, post._row, { favorite: favorite });
      return { id: post.id, favorite: favorite };
    });
  });
}

function apiThread(postId) {
  return runApi_(function (email) {
    const post = ownedRecord_(CONFIG_.SHEETS.POSTS, postId, email);
    assertNotDeleted_(post);
    const replies = readRecords_(CONFIG_.SHEETS.REPLIES)
      .filter(function (reply) {
        return String(reply.postId) === String(postId) && !reply.deletedAt && normalizeEmail_(reply.authorEmail) === email;
      })
      .sort(compareCreatedAscending_)
      .map(presentReply_);
    return { post: presentPost_(post, replies.length), replies: replies };
  });
}

function apiCreateReply(postId, payload) {
  return runApi_(function (email) {
    return withScriptLock_(function () {
      const post = ownedRecord_(CONFIG_.SHEETS.POSTS, postId, email);
      assertNotDeleted_(post);
      const timestamp = nowIso_();
      const reply = {
        id: makeId_(),
        postId: post.id,
        body: normalizeBody_(payload && payload.body, CONFIG_.MAX_REPLY_LENGTH, '返信'),
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: '',
        authorEmail: email
      };
      appendRecord_(CONFIG_.SHEETS.REPLIES, reply);
      return presentReply_(reply);
    });
  });
}

function apiUpdateReply(replyId, payload) {
  return runApi_(function (email) {
    return withScriptLock_(function () {
      const reply = ownedRecord_(CONFIG_.SHEETS.REPLIES, replyId, email);
      assertNotDeleted_(reply);
      const patch = {
        body: normalizeBody_(payload && payload.body, CONFIG_.MAX_REPLY_LENGTH, '返信'),
        updatedAt: nowIso_()
      };
      patchRecord_(CONFIG_.SHEETS.REPLIES, reply._row, patch);
      return presentReply_(Object.assign({}, reply, patch));
    });
  });
}

function apiDeleteReply(replyId) {
  return runApi_(function (email) {
    return withScriptLock_(function () {
      const reply = ownedRecord_(CONFIG_.SHEETS.REPLIES, replyId, email);
      assertNotDeleted_(reply);
      const timestamp = nowIso_();
      patchRecord_(CONFIG_.SHEETS.REPLIES, reply._row, { deletedAt: timestamp });
      return { id: reply.id, deletedAt: timestamp };
    });
  });
}

function apiTrash() {
  return runApi_(function (email) {
    const replyCounts = replyCountsByPost_(true);
    const posts = readRecords_(CONFIG_.SHEETS.POSTS)
      .filter(function (post) {
        return Boolean(post.deletedAt) && normalizeEmail_(post.authorEmail) === email;
      })
      .sort(compareDeletedDescending_)
      .map(function (post) {
        return presentPost_(post, replyCounts[String(post.id)] || 0);
      });
    return { posts: posts, retentionDays: CONFIG_.TRASH_RETENTION_DAYS };
  });
}

function apiRestorePost(postId) {
  return runApi_(function (email) {
    return withScriptLock_(function () {
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
  });
}

function apiPermanentlyDeletePost(postId) {
  return runApi_(function (email) {
    return withScriptLock_(function () {
      const post = ownedRecord_(CONFIG_.SHEETS.POSTS, postId, email);
      if (!post.deletedAt) throw new Error('ごみ箱にある投稿だけを完全に削除できます。');

      readRecords_(CONFIG_.SHEETS.REPLIES)
        .filter(function (reply) { return String(reply.postId) === String(postId); })
        .sort(function (a, b) { return b._row - a._row; })
        .forEach(function (reply) { deleteRecordRow_(CONFIG_.SHEETS.REPLIES, reply._row); });
      deleteRecordRow_(CONFIG_.SHEETS.POSTS, post._row);
      return { id: post.id };
    });
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
  return runApi_(function (email) {
    return withScriptLock_(function () {
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
        authorEmail: email
      }, normalized);
      appendRecord_(CONFIG_.SHEETS.PERSONAS, persona);
      return presentPersona_(persona);
    });
  });
}

function apiTogglePersona(personaId) {
  return runApi_(function (email) {
    return withScriptLock_(function () {
      const persona = ownedRecord_(CONFIG_.SHEETS.PERSONAS, personaId, email);
      const enabled = !parseBoolean_(persona.enabled);
      const updatedAt = nowIso_();
      patchRecord_(CONFIG_.SHEETS.PERSONAS, persona._row, { enabled: enabled, updatedAt: updatedAt });
      return presentPersona_(Object.assign({}, persona, { enabled: enabled, updatedAt: updatedAt }));
    });
  });
}

function apiDeletePersona(personaId) {
  return runApi_(function (email) {
    return withScriptLock_(function () {
      const persona = ownedRecord_(CONFIG_.SHEETS.PERSONAS, personaId, email);
      deleteRecordRow_(CONFIG_.SHEETS.PERSONAS, persona._row);
      return { id: String(persona.id) };
    });
  });
}

function apiSaveSettings(payload) {
  return runApi_(function (email) {
    return withScriptLock_(function () {
      const displayName = String(payload && payload.displayName || '').trim();
      if (!displayName || displayName.length > 40) {
        throw new Error('表示名は1〜40文字で入力してください。');
      }
      const theme = ['system', 'light', 'dark'].indexOf(payload && payload.theme) >= 0
        ? payload.theme
        : 'system';
      const pageSize = clampInteger_(payload && payload.pageSize, CONFIG_.DEFAULT_PAGE_SIZE, 5, CONFIG_.MAX_PAGE_SIZE);
      writeSetting_('displayName', displayName);
      writeSetting_('theme', theme);
      writeSetting_('pageSize', String(pageSize));
      return publicSettings_({ displayName: displayName, theme: theme, pageSize: String(pageSize) }, email);
    });
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
    const posts = readRecords_(CONFIG_.SHEETS.POSTS)
      .filter(function (post) { return normalizeEmail_(post.authorEmail) === email; })
      .map(function (post) { return exportRecord_(post); });
    const replies = readRecords_(CONFIG_.SHEETS.REPLIES)
      .filter(function (reply) { return normalizeEmail_(reply.authorEmail) === email; })
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

function buildTimeline_(rawFilters) {
  const filters = rawFilters || {};
  const email = currentUserEmail_();
  const activeReplies = readRecords_(CONFIG_.SHEETS.REPLIES).filter(function (reply) {
    return !reply.deletedAt && normalizeEmail_(reply.authorEmail) === email;
  });
  const replyCounts = activeReplies.reduce(function (counts, reply) {
    const key = String(reply.postId);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});

  let posts = readRecords_(CONFIG_.SHEETS.POSTS).filter(function (post) {
    return !post.deletedAt && normalizeEmail_(post.authorEmail) === email;
  });

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
    if (filters.replyState === 'with' && !(replyCounts[String(post.id)] > 0)) return false;
    if (filters.replyState === 'without' && replyCounts[String(post.id)] > 0) return false;
    if (startDate && createdDate < startDate) return false;
    if (endDate && createdDate > endDate) return false;
    return true;
  });

  posts.sort(compareCreatedDescending_);
  const total = posts.length;
  const offset = clampInteger_(filters.offset, 0, 0, Math.max(0, total));
  const settings = readSettings_();
  const configuredPageSize = clampInteger_(settings.pageSize, CONFIG_.DEFAULT_PAGE_SIZE, 5, CONFIG_.MAX_PAGE_SIZE);
  const pageSize = clampInteger_(filters.pageSize, configuredPageSize, 5, CONFIG_.MAX_PAGE_SIZE);
  const page = posts.slice(offset, offset + pageSize).map(function (post) {
    return presentPost_(post, replyCounts[String(post.id)] || 0);
  });

  const tagCounts = {};
  readRecords_(CONFIG_.SHEETS.POSTS)
    .filter(function (post) { return !post.deletedAt && normalizeEmail_(post.authorEmail) === email; })
    .forEach(function (post) {
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

function buildDiscovery_() {
  const email = currentUserEmail_();
  const posts = readRecords_(CONFIG_.SHEETS.POSTS)
    .filter(function (post) { return !post.deletedAt && normalizeEmail_(post.authorEmail) === email; });
  const counts = replyCountsByPost_(false);
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
    sourceUrl: normalizeDriveUrl_(record.sourceUrl)
  };
}

function presentReply_(record) {
  return {
    id: String(record.id),
    postId: String(record.postId),
    body: String(record.body || ''),
    createdAt: String(record.createdAt || ''),
    updatedAt: String(record.updatedAt || record.createdAt || '')
  };
}

function publicSettings_(settings, email) {
  return {
    displayName: String(settings.displayName || email.split('@')[0]),
    email: email,
    theme: ['system', 'light', 'dark'].indexOf(settings.theme) >= 0 ? settings.theme : 'system',
    pageSize: clampInteger_(settings.pageSize, CONFIG_.DEFAULT_PAGE_SIZE, 5, CONFIG_.MAX_PAGE_SIZE),
    maxPostLength: CONFIG_.MAX_POST_LENGTH,
    maxReplyLength: CONFIG_.MAX_REPLY_LENGTH,
    maxTags: CONFIG_.MAX_TAGS,
    maxPersonaNameLength: CONFIG_.MAX_PERSONA_NAME_LENGTH,
    maxPersonaRoleLength: CONFIG_.MAX_PERSONA_ROLE_LENGTH,
    maxPersonaPromptLength: CONFIG_.MAX_PERSONA_PROMPT_LENGTH
  };
}

function listPersonas_(email) {
  return readRecords_(CONFIG_.SHEETS.PERSONAS)
    .filter(function (persona) { return normalizeEmail_(persona.authorEmail) === normalizeEmail_(email); })
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
    createdAt: String(record.createdAt || ''),
    updatedAt: String(record.updatedAt || record.createdAt || '')
  };
}

function activeReplyCount_(postId) {
  return readRecords_(CONFIG_.SHEETS.REPLIES).filter(function (reply) {
    return String(reply.postId) === String(postId) && !reply.deletedAt;
  }).length;
}

function replyCountsByPost_(includeDeleted) {
  return readRecords_(CONFIG_.SHEETS.REPLIES).reduce(function (counts, reply) {
    if (!includeDeleted && reply.deletedAt) return counts;
    const key = String(reply.postId);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
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
