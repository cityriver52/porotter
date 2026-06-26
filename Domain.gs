/**
 * Domain record factories and collection helpers.
 * These functions keep storage-shaped records consistent across the web app
 * and Google Workspace Studio entry points.
 */
function createEntryRecord_(options) {
  const timestamp = options.timestamp || nowIso_();
  const authorType = String(options.authorType || 'user');
  const parentId = String(options.parentId || '');
  const id = options.id || makeId_();
  const maxBodyLength = parentId ? CONFIG_.MAX_REPLY_LENGTH : CONFIG_.MAX_POST_LENGTH;
  return {
    id: id,
    body: normalizeBody_(options.body, maxBodyLength, parentId ? '返信' : '投稿'),
    tags: JSON.stringify(normalizeTags_(options.tags)),
    createdAt: timestamp,
    updatedAt: timestamp,
    favorite: parseBoolean_(options.favorite),
    deletedAt: '',
    authorEmail: normalizeEmail_(options.email),
    authorType: authorType,
    authorId: String(options.authorId || options.email || ''),
    authorName: String(options.authorName || ''),
    sourceLabel: String(options.sourceLabel || ''),
    sourceUrl: normalizeReferenceUrl_(options.sourceUrl),
    parentId: parentId,
    rootId: String(options.rootId || (parentId ? '' : id)),
    aiReplyDisabled: parseBoolean_(options.aiReplyDisabled)
  };
}

function createPostRecord_(options) {
  return createEntryRecord_(Object.assign({}, options || {}, { parentId: '', rootId: '' }));
}

function createReplyRecord_(options) {
  return createEntryRecord_(Object.assign({}, options || {}, {
    tags: [],
    sourceLabel: '',
    sourceUrl: '',
    parentId: String(options.parentReplyId || options.parentId || options.postId || ''),
    rootId: String(options.rootId || options.postId || '')
  }));
}

function recordsOwnedBy_(records, email) {
  const owner = normalizeEmail_(email);
  return records.filter(function (record) {
    return normalizeEmail_(record.authorEmail) === owner;
  });
}

function countRepliesByPost_(records, includeDeleted) {
  return records.reduce(function (counts, entry) {
    if (!includeDeleted && entry.deletedAt) return counts;
    if (!entry.parentId) return counts;
    const rootKey = String(entry.rootId || entry.parentId);
    const parentKey = String(entry.parentId || '');
    counts[rootKey] = (counts[rootKey] || 0) + 1;
    if (parentKey && parentKey !== rootKey) {
      counts[parentKey] = (counts[parentKey] || 0) + 1;
    }
    return counts;
  }, {});
}
