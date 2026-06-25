(() => {
  const now = Date.now();
  const iso = offsetDays => new Date(now - offsetDays * 86400000).toISOString();
  let posts = [
    { id: 'p1', body: '会議で出た小さな違和感。結論を急ぐより、問いを一度持ち帰る時間が必要なのかもしれない。', tags: ['違和感', 'あとで考える'], createdAt: iso(0.03), updatedAt: iso(0.03), favorite: true, deletedAt: '', replyCount: 2, authorType: 'user', authorName: '', sourceUrl: 'https://example.com/reference' },
    { id: 'p2', body: '制約が多い案件ほど、最初の言葉選びが設計そのものになる。', tags: ['学び', 'AIの視点'], createdAt: iso(1), updatedAt: iso(1), favorite: false, deletedAt: '', replyCount: 2, authorType: 'persona', authorId: 'persona-1', authorName: '横展開の連想家', sourceLabel: '最近更新されたプロジェクト資料', sourceUrl: '' },
    { id: 'p3', body: '「便利にする」と「考えなくてよくする」は似ているようで違う。ここはもう少し掘りたい。', tags: ['アイデア'], createdAt: iso(9), updatedAt: iso(8), favorite: false, deletedAt: '', replyCount: 1 },
    { id: 'p4', body: '午後の集中力は、タスクの難しさより切り替え回数に削られている気がする。', tags: ['気づき'], createdAt: iso(30), updatedAt: iso(30), favorite: true, deletedAt: '', replyCount: 0 }
  ];
  let replies = [
    { id: 'r1', postId: 'p1', parentReplyId: 'p1', body: '翌日読み返すと、違和感の正体は前提条件が共有されていないことだった。', createdAt: iso(0.02), updatedAt: iso(0.02), favorite: false, replyCount: 0, authorType: 'user', authorName: 'わたし' },
    { id: 'r2', postId: 'p1', parentReplyId: 'p1', body: '次回は最初に「今日は何を決めないか」も確認してみる。', createdAt: iso(0.01), updatedAt: iso(0.01), favorite: false, replyCount: 0, authorType: 'user', authorName: 'わたし' },
    { id: 'r3', postId: 'p3', parentReplyId: 'p3', body: '便利さの評価軸に、利用者の判断力が残るかを加える。', createdAt: iso(7), updatedAt: iso(7), favorite: false, replyCount: 0, authorType: 'user', authorName: 'わたし' },
    { id: 'r4', postId: 'p2', parentReplyId: 'p2', body: '最初の言葉を決める前に、誰の制約なのかを分けてみるのも良さそう。', createdAt: iso(0.9), updatedAt: iso(0.9), favorite: false, replyCount: 1, authorType: 'user', authorName: 'わたし' },
    { id: 'r5', postId: 'p2', parentReplyId: 'r4', body: '確かに、制約の持ち主を分けると「守る条件」と「交渉できる条件」が見えます。最初に二列で書き出すと設計の余白を残せそうです。', createdAt: iso(0.8), updatedAt: iso(0.8), favorite: false, replyCount: 0, authorType: 'persona', authorId: 'persona-1', authorName: '横展開の連想家' }
  ];
  let settings = { displayName: 'わたし', email: 'me@example.com', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/preview', theme: 'system', pageSize: 20, aiAutomationIntervalHours: 6, maxPostLength: 280, maxReplyLength: 280, maxTags: 5, maxPersonaNameLength: 40, maxPersonaRoleLength: 80, maxPersonaPromptLength: 1000 };
  let personas = [
    { id: 'persona-1', name: '横展開の連想家', role: '別業務への応用を考える人', prompt: 'ある業務で見つけた工夫、失敗、判断軸を、別の業務や手順に横展開して考えます。共通する構造を見つけ、連想ゲームのように応用先を短く示します。', enabled: true, avatarColor: 'teal', createdAt: iso(2), updatedAt: iso(2) }
  ];

  const uuid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const activePosts = () => posts.filter(post => !post.deletedAt);
  const entryById = id => posts.concat(replies).find(item => item.id === id);
  const syncState = () => {
    const contentCursor = posts.concat(replies)
      .flatMap(item => [item.createdAt, item.updatedAt, item.deletedAt])
      .filter(Boolean)
      .sort()
      .pop() || '';
    const aiCursor = (aiAutomation.recentRequests || [])
      .flatMap(item => [item.createdAt, item.updatedAt])
      .filter(Boolean)
      .sort()
      .pop() || '';
    return { contentCursor, notificationsCursor: contentCursor, aiCursor, generatedAt: new Date().toISOString() };
  };
  const timeline = filters => {
    const query = String(filters?.query || '').toLocaleLowerCase();
    const tag = String(filters?.tag || '').toLocaleLowerCase();
    let result = activePosts().filter(post => {
      if (query && !(post.body + post.tags.join(' ')).toLocaleLowerCase().includes(query)) return false;
      if (tag && !post.tags.some(item => item.toLocaleLowerCase() === tag)) return false;
      if (filters?.favoriteOnly && !post.favorite) return false;
      if (filters?.authorType === 'user' && post.authorType === 'persona') return false;
      if (filters?.replyState === 'with' && !post.replyCount) return false;
      if (filters?.replyState === 'without' && post.replyCount) return false;
      return true;
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const offset = Number(filters?.offset || 0);
    const pageSize = Number(filters?.pageSize || settings.pageSize);
    const tagCounts = {};
    activePosts().forEach(post => post.tags.forEach(item => { tagCounts[item] = (tagCounts[item] || 0) + 1; }));
    return { posts: result.slice(offset, offset + pageSize), total: result.length, offset, nextOffset: Math.min(result.length, offset + pageSize), hasMore: offset + pageSize < result.length, tags: Object.entries(tagCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) };
  };
  const discovery = () => ({ onThisDay: null, unanswered: activePosts().find(post => !post.replyCount) || null, random: activePosts()[Math.floor(Math.random() * activePosts().length)] || null });
  let notifications = {
    unreadCount: 1,
    readAt: iso(2),
    items: [{ id: 'r5', postId: 'p2', replyId: 'r5', authorName: '横展開の連想家', body: replies.find(reply => reply.id === 'r5').body, postBody: posts.find(post => post.id === 'p2').body, createdAt: replies.find(reply => reply.id === 'r5').createdAt, unread: true }]
  };
  let aiAutomation = {
    installed: true,
    requestCounts: { PUBLISHED: 1 },
    recentRequests: [{ id: 'ai-1', status: 'PUBLISHED', personaName: '横展開の連想家', actionType: '返信', targetSummary: 'ユーザーの返信に応答', errorMessage: '', createdAt: iso(0.8), updatedAt: iso(0.8) }]
  };

  const api = {
    apiSetupStatus: () => ({ configured: true, authorized: true, email: settings.email }),
    apiSetupPorotter: () => ({ allowedEmail: settings.email, message: '初期設定が完了しました。' }),
    apiBootstrap: filters => ({ timeline: timeline(filters), settings, discovery: discovery(), personas, notifications, aiAutomation, sync: syncState() }),
    apiTimeline: filters => timeline(filters),
    apiSync: payload => {
      const sync = syncState();
      const client = payload?.sync || {};
      const contentChanged = !client.contentCursor || sync.contentCursor > String(client.contentCursor || '');
      const notificationsChanged = contentChanged || !client.notificationsCursor || sync.notificationsCursor > String(client.notificationsCursor || '');
      const aiChanged = !client.aiCursor || sync.aiCursor > String(client.aiCursor || '');
      return {
        changed: contentChanged || notificationsChanged || aiChanged,
        contentChanged,
        notificationsChanged,
        aiChanged,
        sync,
        notifications: notificationsChanged || payload?.includeNotifications ? notifications : undefined,
        aiAutomation,
        timeline: contentChanged && payload?.includeTimeline !== false ? timeline(payload?.filters || {}) : undefined,
        aiProcessResult: { processedCount: 0, publishedCount: 0, errorCount: 0, results: [] },
        aiProcessError: ''
      };
    },
    apiCreatePost: payload => {
      const stamp = new Date().toISOString();
      const post = { id: uuid('p'), body: String(payload.body).trim(), tags: payload.tags || [], sourceUrl: payload.sourceUrl || '', createdAt: stamp, updatedAt: stamp, favorite: false, deletedAt: '', replyCount: 0, authorType: 'user', authorName: '' };
      if (!post.body) throw new Error('投稿を入力してください。');
      posts.push(post);
      return post;
    },
    apiUpdatePost: (id, payload) => {
      const post = posts.find(item => item.id === id);
      Object.assign(post, { body: payload.body, tags: payload.tags || [], sourceUrl: payload.sourceUrl || '', updatedAt: new Date().toISOString() });
      return post;
    },
    apiDeletePost: id => { const post = posts.find(item => item.id === id); post.deletedAt = new Date().toISOString(); return { id }; },
    apiToggleFavorite: id => { const entry = entryById(id); entry.favorite = !entry.favorite; return { id, favorite: entry.favorite }; },
    apiThread: id => {
      const selected = entryById(id);
      const rootId = selected.postId || selected.id;
      return { post: posts.find(item => item.id === rootId), replies: replies.filter(reply => reply.postId === rootId) };
    },
    apiCreateReply: (postId, payload) => {
      const stamp = new Date().toISOString();
      const parent = entryById(postId);
      const rootId = parent.postId || parent.id;
      const reply = { id: uuid('r'), postId: rootId, parentReplyId: parent.id, body: payload.body, createdAt: stamp, updatedAt: stamp, favorite: false, replyCount: 0, authorType: 'user', authorName: settings.displayName };
      replies.push(reply);
      posts.find(item => item.id === rootId).replyCount += 1;
      if (parent.postId) parent.replyCount = Number(parent.replyCount || 0) + 1;
      return reply;
    },
    apiUpdateReply: (id, payload) => { const reply = replies.find(item => item.id === id); reply.body = payload.body; reply.updatedAt = new Date().toISOString(); return reply; },
    apiDeleteReply: id => {
      const deleting = new Set([id]);
      let changed = true;
      while (changed) {
        changed = false;
        replies.forEach(reply => {
          if (!deleting.has(reply.id) && deleting.has(reply.parentReplyId)) {
            deleting.add(reply.id);
            changed = true;
          }
        });
      }
      const deletedReplies = replies.filter(item => deleting.has(item.id));
      replies = replies.filter(item => !deleting.has(item.id));
      const root = deletedReplies[0] && posts.find(item => item.id === deletedReplies[0].postId);
      if (root) root.replyCount = Math.max(0, root.replyCount - deletedReplies.length);
      return { id };
    },
    apiTrash: () => ({ posts: posts.filter(post => post.deletedAt), retentionDays: 30 }),
    apiRestorePost: id => { posts.find(item => item.id === id).deletedAt = ''; return { id }; },
    apiPermanentlyDeletePost: id => { posts = posts.filter(item => item.id !== id); replies = replies.filter(item => item.postId !== id); return { id }; },
    apiGetSettings: () => settings,
    apiSaveSettings: payload => { settings = { ...settings, ...payload }; return settings; },
    apiNotifications: () => notifications,
    apiMarkNotificationsRead: () => {
      notifications = { ...notifications, unreadCount: 0, items: notifications.items.map(item => ({ ...item, unread: false })) };
      return notifications;
    },
    apiGetAiAutomationStatus: () => aiAutomation,
    apiInstallAiAutomation: () => { aiAutomation = { ...aiAutomation, installed: true }; return aiAutomation; },
    apiUninstallAiAutomation: () => { aiAutomation = { ...aiAutomation, installed: false }; return aiAutomation; },
    apiRequestAiPost: personaId => {
      const persona = personas.find(item => item.id === personaId);
      const request = { id: uuid('ai'), status: 'REQUESTED', personaName: persona.name, actionType: '新規投稿', targetSummary: '新しい気づきを投稿', errorMessage: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      aiAutomation.recentRequests.unshift(request);
      return { created: true, requestId: request.id, status: request.status, personaName: persona.name, actionType: '新規投稿' };
    },
    apiProcessAiResponses: () => ({ processedCount: 0, publishedCount: 0, errorCount: 0 }),
    apiListPersonas: () => personas,
    apiSavePersona: (id, payload) => {
      const stamp = new Date().toISOString();
      if (id) {
        const persona = personas.find(item => item.id === id);
        Object.assign(persona, payload, { updatedAt: stamp });
        return persona;
      }
      const colors = ['violet', 'indigo', 'teal', 'green', 'amber', 'rose'];
      const persona = { id: uuid('persona'), ...payload, avatarColor: colors[Math.floor(Math.random() * colors.length)], createdAt: stamp, updatedAt: stamp };
      personas.push(persona);
      return persona;
    },
    apiTogglePersona: id => { const persona = personas.find(item => item.id === id); persona.enabled = !persona.enabled; return persona; },
    apiDeletePersona: id => { personas = personas.filter(item => item.id !== id); return { id }; },
    apiDiscovery: () => discovery()
  };

  let successHandler = () => {};
  let failureHandler = () => {};
  const runner = new Proxy({}, {
    get(_target, property) {
      if (property === 'withSuccessHandler') return handler => { successHandler = handler; return runner; };
      if (property === 'withFailureHandler') return handler => { failureHandler = handler; return runner; };
      if (property in api) return (...args) => {
        const onSuccess = successHandler;
        const onFailure = failureHandler;
        successHandler = () => {};
        failureHandler = () => {};
        setTimeout(() => {
          try { onSuccess({ ok: true, data: api[property](...args) }); }
          catch (error) { onFailure(error); }
        }, 90);
      };
      return undefined;
    }
  });
  window.google = { script: { run: runner } };
})();
