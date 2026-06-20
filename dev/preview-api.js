(() => {
  const now = Date.now();
  const iso = offsetDays => new Date(now - offsetDays * 86400000).toISOString();
  let posts = [
    { id: 'p1', body: '会議で出た小さな違和感。結論を急ぐより、問いを一度持ち帰る時間が必要なのかもしれない。', tags: ['違和感', 'あとで考える'], createdAt: iso(0.03), updatedAt: iso(0.03), favorite: true, deletedAt: '', replyCount: 2, authorType: 'user', authorName: '' },
    { id: 'p2', body: '制約が多い案件ほど、最初の言葉選びが設計そのものになる。', tags: ['学び', 'AIの視点'], createdAt: iso(1), updatedAt: iso(1), favorite: false, deletedAt: '', replyCount: 0, authorType: 'persona', authorId: 'persona-1', authorName: '細部に気づく人', sourceLabel: '最近更新されたプロジェクト資料', sourceUrl: '' },
    { id: 'p3', body: '「便利にする」と「考えなくてよくする」は似ているようで違う。ここはもう少し掘りたい。', tags: ['アイデア'], createdAt: iso(9), updatedAt: iso(8), favorite: false, deletedAt: '', replyCount: 1 },
    { id: 'p4', body: '午後の集中力は、タスクの難しさより切り替え回数に削られている気がする。', tags: ['気づき'], createdAt: iso(30), updatedAt: iso(30), favorite: true, deletedAt: '', replyCount: 0 }
  ];
  let replies = [
    { id: 'r1', postId: 'p1', body: '翌日読み返すと、違和感の正体は前提条件が共有されていないことだった。', createdAt: iso(0.02), updatedAt: iso(0.02) },
    { id: 'r2', postId: 'p1', body: '次回は最初に「今日は何を決めないか」も確認してみる。', createdAt: iso(0.01), updatedAt: iso(0.01) },
    { id: 'r3', postId: 'p3', body: '便利さの評価軸に、利用者の判断力が残るかを加える。', createdAt: iso(7), updatedAt: iso(7) }
  ];
  let settings = { displayName: 'わたし', email: 'me@example.com', theme: 'system', pageSize: 20, maxPostLength: 280, maxReplyLength: 280, maxTags: 5, maxPersonaNameLength: 40, maxPersonaRoleLength: 80, maxPersonaPromptLength: 1000 };
  let personas = [
    { id: 'persona-1', name: '細部に気づく人', role: 'まじめで細やかなことによく気が付く人', prompt: '曖昧な表現や小さな抜けを丁寧に見つけます。', enabled: true, createdAt: iso(2), updatedAt: iso(2) }
  ];

  const uuid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const activePosts = () => posts.filter(post => !post.deletedAt);
  const timeline = filters => {
    const query = String(filters?.query || '').toLocaleLowerCase();
    const tag = String(filters?.tag || '').toLocaleLowerCase();
    let result = activePosts().filter(post => {
      if (query && !(post.body + post.tags.join(' ')).toLocaleLowerCase().includes(query)) return false;
      if (tag && !post.tags.some(item => item.toLocaleLowerCase() === tag)) return false;
      if (filters?.favoriteOnly && !post.favorite) return false;
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

  const api = {
    apiBootstrap: filters => ({ timeline: timeline(filters), settings, discovery: discovery(), personas }),
    apiTimeline: filters => timeline(filters),
    apiCreatePost: payload => {
      const stamp = new Date().toISOString();
      const post = { id: uuid('p'), body: String(payload.body).trim(), tags: payload.tags || [], createdAt: stamp, updatedAt: stamp, favorite: false, deletedAt: '', replyCount: 0, authorType: 'user', authorName: '' };
      if (!post.body) throw new Error('投稿を入力してください。');
      posts.push(post);
      return post;
    },
    apiUpdatePost: (id, payload) => {
      const post = posts.find(item => item.id === id);
      Object.assign(post, { body: payload.body, tags: payload.tags || [], updatedAt: new Date().toISOString() });
      return post;
    },
    apiDeletePost: id => { const post = posts.find(item => item.id === id); post.deletedAt = new Date().toISOString(); return { id }; },
    apiToggleFavorite: id => { const post = posts.find(item => item.id === id); post.favorite = !post.favorite; return { id, favorite: post.favorite }; },
    apiThread: id => ({ post: posts.find(item => item.id === id), replies: replies.filter(reply => reply.postId === id) }),
    apiCreateReply: (postId, payload) => {
      const stamp = new Date().toISOString();
      const reply = { id: uuid('r'), postId, body: payload.body, createdAt: stamp, updatedAt: stamp };
      replies.push(reply);
      posts.find(item => item.id === postId).replyCount += 1;
      return reply;
    },
    apiUpdateReply: (id, payload) => { const reply = replies.find(item => item.id === id); reply.body = payload.body; reply.updatedAt = new Date().toISOString(); return reply; },
    apiDeleteReply: id => {
      const reply = replies.find(item => item.id === id);
      if (reply) posts.find(item => item.id === reply.postId).replyCount = Math.max(0, posts.find(item => item.id === reply.postId).replyCount - 1);
      replies = replies.filter(item => item.id !== id);
      return { id };
    },
    apiTrash: () => ({ posts: posts.filter(post => post.deletedAt), retentionDays: 30 }),
    apiRestorePost: id => { posts.find(item => item.id === id).deletedAt = ''; return { id }; },
    apiPermanentlyDeletePost: id => { posts = posts.filter(item => item.id !== id); replies = replies.filter(item => item.postId !== id); return { id }; },
    apiGetSettings: () => settings,
    apiSaveSettings: payload => { settings = { ...settings, ...payload }; return settings; },
    apiListPersonas: () => personas,
    apiSavePersona: (id, payload) => {
      const stamp = new Date().toISOString();
      if (id) {
        const persona = personas.find(item => item.id === id);
        Object.assign(persona, payload, { updatedAt: stamp });
        return persona;
      }
      const persona = { id: uuid('persona'), ...payload, createdAt: stamp, updatedAt: stamp };
      personas.push(persona);
      return persona;
    },
    apiTogglePersona: id => { const persona = personas.find(item => item.id === id); persona.enabled = !persona.enabled; return persona; },
    apiDeletePersona: id => { personas = personas.filter(item => item.id !== id); return { id }; },
    apiDiscovery: () => discovery(),
    apiExport: format => ({ format, filename: `porotter-preview.${format}`, mimeType: format === 'json' ? 'application/json' : 'text/csv', content: format === 'json' ? JSON.stringify({ posts, replies, personas }, null, 2) : 'body\npreview' })
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
