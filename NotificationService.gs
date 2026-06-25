/**
 * Notification query and read-state services.
 */

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
    const postId = String(reply.rootId || reply.postId || '');
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
      const post = postById[String(reply.rootId || reply.postId || '')];
      if (!post) return false;
      if (String(post.authorType || 'user') !== 'persona') return true;
      const participatedAt = firstUserReplyAt[String(post.id)];
      return Boolean(participatedAt && participatedAt < String(reply.createdAt));
    })
    .sort(compareCreatedDescending_)
    .slice(0, 100)
    .map(function (reply) {
      const rootPostId = String(reply.rootId || reply.postId || '');
      const post = postById[rootPostId];
      return {
        id: String(reply.id),
        postId: rootPostId,
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
  const timestamp = nowIso_();
  readByPost[normalizedPostId] = timestamp;
  writeSettings_({
    notificationsReadByPost: JSON.stringify(compactNotificationPostReadAt_(readByPost)),
    notificationsUpdatedAt: timestamp
  });
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
  const postReadAt = String(readByPost[String(reply.rootId || reply.postId || '')] || '');
  const readAt = [String(globalReadAt || ''), postReadAt]
    .filter(Boolean)
    .sort()
    .pop() || '';
  return !readAt || createdAt > readAt;
}

function createNotificationSnapshot_() {
  const entries = readRecords_(CONFIG_.SHEETS.ENTRIES);
  return {
    posts: entries.filter(function (entry) { return !entry.parentId; }),
    replies: entries.filter(function (entry) { return entry.parentId; }),
    settings: readSettings_()
  };
}
