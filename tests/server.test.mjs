import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createAppsScriptHarness } from './helpers/apps-script-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createContext() {
  return createAppsScriptHarness(root).context;
}

test('setup, CRUD, replies, trash, search and export work as one flow', () => {
  const app = createContext();
  const setup = app.setupPorotter();
  assert.equal(setup.allowedEmail, 'owner@example.com');
  assert.equal(app.checkPorotterSetup().configured, true);

  const first = app.apiCreatePost({ body: '<script>alert(1)</script> 気づき', tags: ['学び', '#違和感'] });
  assert.equal(first.ok, true);
  assert.deepEqual(Array.from(first.data.tags), ['学び', '違和感']);

  const second = app.apiCreatePost({ body: '=SUM(A1:A2)', tags: ['アイデア'] });
  assert.equal(second.ok, true);

  let timeline = app.apiTimeline({ query: '気づき' });
  assert.equal(timeline.data.total, 1);
  assert.equal(timeline.data.posts[0].body, '<script>alert(1)</script> 気づき');

  const favorite = app.apiToggleFavorite(first.data.id);
  assert.equal(favorite.data.favorite, true);
  timeline = app.apiTimeline({ favoriteOnly: true });
  assert.equal(timeline.data.total, 1);

  const reply = app.apiCreateReply(first.data.id, { body: '翌日の追記' });
  assert.equal(reply.ok, true);
  let thread = app.apiThread(first.data.id);
  assert.equal(thread.data.replies.length, 1);
  assert.equal(thread.data.post.replyCount, 1);

  const updated = app.apiUpdatePost(first.data.id, { body: '更新した本文', tags: ['学び'] });
  assert.equal(updated.data.body, '更新した本文');

  assert.equal(app.apiDeletePost(first.data.id).ok, true);
  assert.equal(app.apiTrash().data.posts.length, 1);
  assert.equal(app.apiThread(first.data.id).ok, false);
  assert.equal(app.apiRestorePost(first.data.id).ok, true);
  assert.equal(app.apiThread(first.data.id).data.replies.length, 1);

  const jsonExport = app.apiExport('json');
  assert.equal(jsonExport.ok, true);
  assert.match(jsonExport.data.content, /更新した本文/);
  const csvExport = app.apiExport('csv');
  assert.match(csvExport.data.content, /"'=SUM\(A1:A2\)"/);
});

test('validation and authorization are enforced on the server', () => {
  const app = createContext();
  app.setupPorotter();

  assert.equal(app.apiCreatePost({ body: '   ', tags: [] }).ok, false);
  assert.equal(app.apiCreatePost({ body: 'x'.repeat(281), tags: [] }).ok, false);
  assert.equal(app.apiCreatePost({ body: 'valid', tags: ['1', '2', '3', '4', '5', '6'] }).ok, false);

  app.__setActiveEmail('intruder@example.com');
  const denied = app.apiTimeline({});
  assert.equal(denied.ok, false);
  assert.match(denied.error, /権限/);
});

test('existing reply rows are preserved when AI reply metadata columns are added', () => {
  const harness = createAppsScriptHarness(root);
  const app = harness.context;
  app.setupPorotter();
  const post = app.apiCreatePost({ body: '移行前の投稿', tags: [] }).data;
  const reply = app.apiCreateReply(post.id, { body: '移行前の返信' }).data;
  const replySheet = harness.spreadsheet.getSheetByName('Replies');
  replySheet.rows = replySheet.rows.map(row => row.slice(0, 7));

  app.setupPorotter();

  assert.deepEqual(Array.from(replySheet.rows[0]), Array.from(app.__definitions.REPLIES.headers));
  const thread = app.apiThread(post.id).data;
  assert.equal(thread.replies[0].id, reply.id);
  assert.equal(thread.replies[0].body, '移行前の返信');
  assert.equal(thread.replies[0].authorType, 'user');
  assert.equal(thread.replies[0].parentReplyId, '');
});

test('timeline filters, pagination, settings and permanent deletion work', () => {
  const app = createContext();
  app.setupPorotter();

  const created = [];
  for (let index = 0; index < 7; index += 1) {
    created.push(app.apiCreatePost({
      body: `投稿 ${index}`,
      tags: index % 2 === 0 ? ['偶数'] : ['奇数']
    }).data);
  }
  app.apiCreateReply(created[0].id, { body: '返信あり' });

  const firstPage = app.apiTimeline({ pageSize: 5 });
  assert.equal(firstPage.data.posts.length, 5);
  assert.equal(firstPage.data.hasMore, true);
  const secondPage = app.apiTimeline({ pageSize: 5, offset: firstPage.data.nextOffset });
  assert.equal(secondPage.data.posts.length, 2);
  assert.equal(secondPage.data.hasMore, false);

  assert.equal(app.apiTimeline({ tag: '偶数' }).data.total, 4);
  assert.equal(app.apiTimeline({ replyState: 'with' }).data.total, 1);
  assert.equal(app.apiTimeline({ replyState: 'without' }).data.total, 6);

  const today = app.Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  assert.equal(app.apiTimeline({ startDate: today, endDate: today }).data.total, 7);
  assert.equal(app.apiTimeline({ startDate: '1990-01-01', endDate: '1990-01-02' }).data.total, 0);

  const settings = app.apiSaveSettings({ displayName: '考える人', theme: 'dark', pageSize: 30 });
  assert.equal(settings.data.displayName, '考える人');
  assert.equal(settings.data.theme, 'dark');
  assert.equal(settings.data.pageSize, 30);

  app.apiDeletePost(created[1].id);
  assert.equal(app.apiTrash().data.posts.length, 1);
  app.apiPermanentlyDeletePost(created[1].id);
  assert.equal(app.apiTrash().data.posts.length, 0);
  assert.equal(app.apiTimeline({}).data.total, 6);
});

test('the GAS queue and standard Workspace Studio handoff create attributed AI posts', () => {
  const app = createContext();
  const setup = app.setupPorotter();
  assert.match(setup.message, /ぽろったー/);

  const saved = app.apiSavePersona('', {
    name: '経理の見張り番',
    role: '財務経理担当',
    prompt: '数字と証跡の抜けに気づきます。',
    enabled: true
  });
  assert.equal(saved.ok, true);
  assert.equal(app.apiListPersonas().data.length, 1);

  const installed = app.installPorotterAiAutomation();
  assert.equal(installed.installed, true);
  assert.equal(installed.firstRequest.created, true);
  assert.deepEqual(Array.from(app.__getTriggers()).map(trigger => trigger.handlerFunction).sort(), [
    'preparePorotterAiRequest', 'processPorotterAiResponses'
  ]);
  app.installPorotterAiAutomation();
  assert.equal(app.__getTriggers().length, 2);

  const queued = app.findRecordById_(app.__definitions.AI_REQUESTS, installed.firstRequest.requestId);
  assert.equal(queued.status, 'REQUESTED');
  assert.equal(queued.personaId, saved.data.id);
  const generationPrompt = queued.generationPrompt;
  assert.match(generationPrompt, /過去7日/);
  assert.match(generationPrompt, /Google Drive/);
  assert.match(generationPrompt, /Gmail/);
  assert.match(generationPrompt, /Google Chat/);
  assert.match(generationPrompt, /フォローしていないスレッドへの返信を必ず無視/);
  assert.match(generationPrompt, /フォロー状態を確認できない返信も対象外/);

  app.patchRecord_(app.__definitions.AI_REQUESTS, queued._row, {
    status: 'GENERATED',
    generatedText: JSON.stringify({ body: '支払時期だけでなく、確認の締切も先に置くと手戻りを減らせそう。', tags: ['経理', 'AIの視点'], sourceLabel: '最近の連絡', sourceUrl: 'https://mail.google.com/mail/u/0/#inbox/example' })
  });
  const processed = app.processPorotterAiResponses();
  assert.equal(processed.publishedCount, 1);
  assert.equal(app.findRecordById_(app.__definitions.AI_REQUESTS, queued.id).status, 'PUBLISHED');
  const timeline = app.apiTimeline({});
  assert.equal(timeline.data.total, 1);
  assert.equal(timeline.data.posts[0].authorType, 'persona');
  assert.equal(timeline.data.posts[0].authorName, '経理の見張り番');
  assert.equal(timeline.data.posts[0].sourceUrl, 'https://mail.google.com/mail/u/0/#inbox/example');
  assert.equal(app.normalizeWorkspaceUrl_('https://chat.google.com/room/example'), 'https://chat.google.com/room/example');
  assert.equal(app.normalizeWorkspaceUrl_('https://evil.example/?next=https://mail.google.com/'), '');

  assert.equal(app.apiTogglePersona(saved.data.id).data.enabled, false);
  assert.equal(app.apiDeletePersona(saved.data.id).ok, true);
  assert.equal(app.apiListPersonas().data.length, 0);
});

test('designed serendipity chooses unfinished thoughts instead of replying by chance', () => {
  const app = createContext();
  app.setupPorotter();
  const persona = app.apiSavePersona('', {
    name: '問いを深める人',
    role: '対話役',
    prompt: '前提を確かめ、次の一歩につながる問いを返します。',
    enabled: true
  }).data;
  const first = app.apiCreatePost({ body: 'この手順の本当の目的は何だろう？', tags: ['問い'] }).data;
  const second = app.apiCreatePost({ body: '会議前に資料を共有した。', tags: ['記録'] }).data;
  const third = app.apiCreatePost({ body: '引き継ぎで迷った点を、次回はどう改善できるだろう。', tags: ['引き継ぎ'] }).data;
  app.apiCreatePost({ body: '引き継ぎの説明順を少し変えた。', tags: ['引き継ぎ'] });

  const replyActivity = app.chooseStudioActivity_('owner@example.com', persona);
  assert.equal(replyActivity.type, 'reply-choice');
  assert.ok(replyActivity.context.candidatePostIds.includes(first.id));
  assert.ok(replyActivity.context.candidatePostIds.includes(third.id));
  assert.ok(!replyActivity.context.candidatePostIds.includes(second.id));
  assert.match(app.buildPersonaGenerationPrompt_(persona, replyActivity), /最も有意義に議論/);
  assert.match(app.buildPersonaGenerationPrompt_(persona, replyActivity), /最近繰り返されたテーマ/);
  assert.match(app.buildPersonaGenerationPrompt_(persona, replyActivity), /Google Chat/);

  const published = app.publishGeneratedPorotter_('owner@example.com', persona.id, replyActivity.context, JSON.stringify({
    targetPostId: first.id,
    body: '手順を守ることと目的を満たすことを分けてみると、残すべき工程が見えそうです。次回は「この工程がないと誰が困るか」から確かめてはどうでしょう。'
  }));
  assert.equal(published.entryType, 'reply');
  assert.equal(published.postId, first.id);
  assert.ok(published.replyId);
  const thread = app.apiThread(first.id).data;
  assert.equal(thread.replies.length, 1);
  assert.equal(thread.replies[0].authorType, 'persona');
  assert.equal(thread.replies[0].authorName, persona.name);
  assert.equal(thread.replies[0].parentReplyId, '');
  assert.equal(app.chooseStudioActivity_('owner@example.com', persona).type, 'post');
  assert.throws(() => app.publishGeneratedPorotter_(
    'owner@example.com', persona.id, replyActivity.context,
    JSON.stringify({ targetPostId: first.id, body: '重複返信' })
  ), /すでにAIが返信/);
});

test('Workspace Studio prioritizes unanswered user replies to AI posts and does not answer twice', () => {
  const app = createContext();
  app.setupPorotter();
  const persona = app.apiSavePersona('', {
    name: '現場の伴走者',
    role: '実務改善',
    prompt: '小さく試せる具体策を返します。',
    enabled: true
  }).data;
  const aiPostResult = app.publishGeneratedPorotter_('owner@example.com', persona.id, { type: 'post' }, JSON.stringify({
    body: '引き継ぎ資料は、情報量より最初の10分で迷わない順番が大切かもしれない。',
    tags: ['引き継ぎ']
  }));
  const aiPostId = aiPostResult.postId;
  const userReply = app.apiCreateReply(aiPostId, { body: '最初に何を確認すれば迷いにくいでしょう？' }).data;

  const priorityActivity = app.chooseStudioActivity_('owner@example.com', persona);
  assert.equal(priorityActivity.type, 'reply-to-user');
  assert.equal(priorityActivity.context.postId, aiPostId);
  assert.equal(priorityActivity.context.parentReplyId, userReply.id);
  const priorityPrompt = app.buildPersonaGenerationPrompt_(persona, priorityActivity);
  assert.match(priorityPrompt, /ユーザーから届いた返信/);
  assert.match(priorityPrompt, /Gmail/);
  assert.match(priorityPrompt, /フォロー状態を確認できない返信も対象外/);

  app.publishGeneratedPorotter_('owner@example.com', persona.id, priorityActivity.context, JSON.stringify({
    body: 'まず「今日中に自分で進めること」と「誰かに聞くこと」を分ける案内があると、最初の10分で立ち止まりにくくなります。'
  }));

  const thread = app.apiThread(aiPostId).data;
  assert.equal(thread.replies.length, 2);
  assert.equal(thread.replies[1].authorType, 'persona');
  assert.equal(thread.replies[1].parentReplyId, userReply.id);
  assert.equal(app.chooseStudioActivity_('owner@example.com', persona).type, 'post');

  assert.throws(() => app.publishGeneratedPorotter_(
    'owner@example.com', persona.id, priorityActivity.context, JSON.stringify({ body: '重複返信' })
  ), /すでにAIが返信/);
});
