/**
 * Timeline and discovery query services.
 */

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
