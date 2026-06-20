/**
 * Domain record factories and collection helpers.
 * These functions keep storage-shaped records consistent across the web app
 * and Google Workspace Studio entry points.
 */
function createPostRecord_(options) {
  const timestamp = options.timestamp || nowIso_();
  const authorType = String(options.authorType || 'user');
  return {
    id: options.id || makeId_(),
    body: normalizeBody_(options.body, CONFIG_.MAX_POST_LENGTH, '投稿'),
    tags: JSON.stringify(normalizeTags_(options.tags)),
    createdAt: timestamp,
    updatedAt: timestamp,
    favorite: false,
    deletedAt: '',
    authorEmail: normalizeEmail_(options.email),
    authorType: authorType,
    authorId: String(options.authorId || options.email || ''),
    authorName: String(options.authorName || ''),
    sourceLabel: String(options.sourceLabel || ''),
    sourceUrl: normalizeDriveUrl_(options.sourceUrl)
  };
}

function createReplyRecord_(postId, email, body) {
  const timestamp = nowIso_();
  return {
    id: makeId_(),
    postId: String(postId),
    body: normalizeBody_(body, CONFIG_.MAX_REPLY_LENGTH, '返信'),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: '',
    authorEmail: normalizeEmail_(email)
  };
}

function recordsOwnedBy_(records, email) {
  const owner = normalizeEmail_(email);
  return records.filter(function (record) {
    return normalizeEmail_(record.authorEmail) === owner;
  });
}

function countRepliesByPost_(records, includeDeleted) {
  return records.reduce(function (counts, reply) {
    if (!includeDeleted && reply.deletedAt) return counts;
    const key = String(reply.postId);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}
