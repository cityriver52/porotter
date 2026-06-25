/**
 * Presentation mappers and shared collection helpers.
 */

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
  const aiAutomationIntervalHours = normalizeAiAutomationIntervalHours_(settings);
  return {
    displayName: String(settings.displayName || email.split('@')[0]),
    email: email,
    spreadsheetUrl: getSpreadsheet_().getUrl(),
    theme: ['system', 'light', 'dark'].indexOf(settings.theme) >= 0 ? settings.theme : 'system',
    pageSize: clampInteger_(settings.pageSize, CONFIG_.DEFAULT_PAGE_SIZE, 5, CONFIG_.MAX_PAGE_SIZE),
    aiAutomationIntervalHours: aiAutomationIntervalHours,
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
