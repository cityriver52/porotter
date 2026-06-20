const CONFIG_ = Object.freeze({
  APP_NAME: 'mySNS',
  SPREADSHEET_NAME: 'mySNS Data',
  PROPERTY_SPREADSHEET_ID: 'MYSNS_SPREADSHEET_ID',
  PROPERTY_ALLOWED_EMAIL: 'MYSNS_ALLOWED_EMAIL',
  MAX_POST_LENGTH: 280,
  MAX_REPLY_LENGTH: 280,
  MAX_TAGS: 5,
  MAX_TAG_LENGTH: 24,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 50,
  TRASH_RETENTION_DAYS: 30,
  SHEETS: Object.freeze({
    POSTS: Object.freeze({
      name: 'Posts',
      headers: Object.freeze([
        'id', 'body', 'tags', 'createdAt', 'updatedAt',
        'favorite', 'deletedAt', 'authorEmail'
      ])
    }),
    REPLIES: Object.freeze({
      name: 'Replies',
      headers: Object.freeze([
        'id', 'postId', 'body', 'createdAt', 'updatedAt',
        'deletedAt', 'authorEmail'
      ])
    }),
    SETTINGS: Object.freeze({
      name: 'Settings',
      headers: Object.freeze(['key', 'value', 'updatedAt'])
    })
  })
});

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
  const allowedEmail = normalizeEmail_(
    PropertiesService.getScriptProperties().getProperty(CONFIG_.PROPERTY_ALLOWED_EMAIL)
  );
  if (!allowedEmail) {
    throw new Error('初期設定が完了していません。Apps Script エディタから setupMySNS を実行してください。');
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
