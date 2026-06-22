const CONFIG_ = Object.freeze({
  APP_NAME: 'ぽろったー',
  APP_SLUG: 'porotter',
  SPREADSHEET_NAME: 'porotter Data',
  PROPERTY_SPREADSHEET_ID: 'POROTTER_SPREADSHEET_ID',
  PROPERTY_ALLOWED_EMAIL: 'POROTTER_ALLOWED_EMAIL',
  LEGACY_PROPERTY_SPREADSHEET_ID: ['MY', 'SNS_SPREADSHEET_ID'].join(''),
  LEGACY_PROPERTY_ALLOWED_EMAIL: ['MY', 'SNS_ALLOWED_EMAIL'].join(''),
  MAX_POST_LENGTH: 280,
  MAX_REPLY_LENGTH: 280,
  MAX_TAGS: 5,
  MAX_TAG_LENGTH: 24,
  MAX_PERSONA_NAME_LENGTH: 40,
  MAX_PERSONA_ROLE_LENGTH: 80,
  MAX_PERSONA_PROMPT_LENGTH: 1000,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 50,
  TRASH_RETENTION_DAYS: 30,
  STUDIO_REPLY_MIN_SCORE: 5.5,
  STUDIO_REPLY_COOLDOWN_HOURS: 20,
  STUDIO_REPLY_THEME_WINDOW_DAYS: 21,
  STUDIO_REPLY_MAX_POST_AGE_DAYS: 45,
  AI_REQUEST_STALE_HOURS: 48,
  AI_REQUEST_PROCESS_LIMIT: 5,
  AI_REQUEST_STATUS: Object.freeze({
    CREATING: 'CREATING',
    REQUESTED: 'REQUESTED',
    GENERATED: 'GENERATED',
    PUBLISHED: 'PUBLISHED',
    ERROR: 'ERROR'
  }),
  SHEETS: Object.freeze({
    POSTS: Object.freeze({
      name: 'Posts',
      headers: Object.freeze([
        'id', 'body', 'tags', 'createdAt', 'updatedAt',
        'favorite', 'deletedAt', 'authorEmail', 'authorType',
        'authorId', 'authorName', 'sourceLabel', 'sourceUrl'
      ])
    }),
    REPLIES: Object.freeze({
      name: 'Replies',
      headers: Object.freeze([
        'id', 'postId', 'body', 'createdAt', 'updatedAt',
        'deletedAt', 'authorEmail', 'parentReplyId', 'authorType',
        'authorId', 'authorName'
      ])
    }),
    SETTINGS: Object.freeze({
      name: 'Settings',
      headers: Object.freeze(['key', 'value', 'updatedAt'])
    }),
    PERSONAS: Object.freeze({
      name: 'Personas',
      headers: Object.freeze([
        'id', 'name', 'role', 'prompt', 'enabled',
        'createdAt', 'updatedAt', 'authorEmail'
      ])
    }),
    AI_REQUESTS: Object.freeze({
      name: 'AIRequests',
      headers: Object.freeze([
        'id', 'status', 'personaId', 'personaName', 'actionType',
        'targetSummary', 'actionContext', 'generationPrompt', 'generatedText',
        'resultType', 'resultPostId', 'resultReplyId', 'errorMessage',
        'createdAt', 'updatedAt', 'authorEmail'
      ])
    })
  })
});

function migrateLegacyProperties_() {
  const properties = PropertiesService.getScriptProperties();
  const mappings = [
    [CONFIG_.PROPERTY_SPREADSHEET_ID, CONFIG_.LEGACY_PROPERTY_SPREADSHEET_ID],
    [CONFIG_.PROPERTY_ALLOWED_EMAIL, CONFIG_.LEGACY_PROPERTY_ALLOWED_EMAIL]
  ];
  mappings.forEach(function (mapping) {
    if (properties.getProperty(mapping[0])) return;
    const legacyValue = properties.getProperty(mapping[1]);
    if (legacyValue) properties.setProperty(mapping[0], legacyValue);
  });
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function currentUserEmail_() {
  const email = normalizeEmail_(Session.getActiveUser().getEmail());
  if (!email) {
    throw new Error(
      'ログイン中のメールアドレスを確認できません。ウェブアプリを「ウェブアプリにアクセスしているユーザー」として実行してください。'
    );
  }
  return email;
}

function assertAuthorized_() {
  migrateLegacyProperties_();
  const allowedEmail = normalizeEmail_(
    PropertiesService.getScriptProperties().getProperty(CONFIG_.PROPERTY_ALLOWED_EMAIL)
  );
  if (!allowedEmail) {
    throw new Error('初期設定が完了していません。Apps Script エディタから setupPorotter を実行してください。');
  }

  const currentEmail = currentUserEmail_();
  if (currentEmail !== allowedEmail) {
    throw new Error('このアプリを利用する権限がありません。');
  }
  return currentEmail;
}

function withScriptLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function nowIso_() {
  return new Date().toISOString();
}

function makeId_() {
  return Utilities.getUuid();
}

function normalizeBody_(value, maxLength, label) {
  const body = String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim();
  if (!body) {
    throw new Error(label + 'を入力してください。');
  }
  if (Array.from(body).length > maxLength) {
    throw new Error(label + 'は' + maxLength + '文字以内で入力してください。');
  }
  return body;
}

function normalizeTags_(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[\s,、]+/);
  const seen = {};
  const tags = [];

  values.forEach(function (item) {
    const tag = String(item || '').replace(/^#+/, '').trim();
    if (!tag) return;
    if (Array.from(tag).length > CONFIG_.MAX_TAG_LENGTH) {
      throw new Error('タグは' + CONFIG_.MAX_TAG_LENGTH + '文字以内で入力してください。');
    }
    const key = tag.toLocaleLowerCase();
    if (!seen[key]) {
      seen[key] = true;
      tags.push(tag);
    }
  });

  if (tags.length > CONFIG_.MAX_TAGS) {
    throw new Error('タグは' + CONFIG_.MAX_TAGS + '個まで指定できます。');
  }
  return tags;
}

function parseTags_(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return String(value).split(',').filter(Boolean);
  }
}

function parseBoolean_(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

function clampInteger_(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function isValidDateInput_(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function normalizeWorkspaceUrl_(value) {
  const url = String(value || '').trim();
  return /^https:\/\/(?:drive|docs|mail|chat)\.google\.com\//i.test(url) ? url : '';
}

function normalizePersona_(payload) {
  const name = String(payload && payload.name || '').trim();
  const role = String(payload && payload.role || '').trim();
  const prompt = String(payload && payload.prompt || '').trim();
  if (!name || Array.from(name).length > CONFIG_.MAX_PERSONA_NAME_LENGTH) {
    throw new Error('疑似アカウント名は1〜' + CONFIG_.MAX_PERSONA_NAME_LENGTH + '文字で入力してください。');
  }
  if (!role || Array.from(role).length > CONFIG_.MAX_PERSONA_ROLE_LENGTH) {
    throw new Error('役割は1〜' + CONFIG_.MAX_PERSONA_ROLE_LENGTH + '文字で入力してください。');
  }
  if (!prompt || Array.from(prompt).length > CONFIG_.MAX_PERSONA_PROMPT_LENGTH) {
    throw new Error('パーソナリティは1〜' + CONFIG_.MAX_PERSONA_PROMPT_LENGTH + '文字で入力してください。');
  }
  return { name: name, role: role, prompt: prompt, enabled: payload.enabled !== false };
}
