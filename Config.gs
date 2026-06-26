const CONFIG_ = Object.freeze({
  APP_NAME: 'ぽろったー',
  APP_SLUG: 'porotter',
  SPREADSHEET_NAME: 'porotter Data',
  PROPERTY_SPREADSHEET_ID: 'POROTTER_SPREADSHEET_ID',
  PROPERTY_ALLOWED_EMAIL: 'POROTTER_ALLOWED_EMAIL',
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
  AI_REQUEST_STALE_HOURS: 48,
  AI_REQUEST_PROCESS_LIMIT: 5,
  AI_REQUEST_DUE_GRACE_SECONDS: 90,
  DEFAULT_AI_AUTOMATION_INTERVAL_HOURS: 6,
  AI_WORK_HOURS_START_MINUTE: 8 * 60 + 45,
  AI_WORK_HOURS_END_MINUTE: 17 * 60 + 15,
  AI_INTERVAL_MINUTES: Object.freeze([0, 10, 20, 30, 40, 50, 60, 120, 180, 360, 720, 1200, 1440, 2880, 4320, 10080]),
  AI_INTERVAL_HOURS: Object.freeze([0, 10 / 60, 20 / 60, 30 / 60, 40 / 60, 50 / 60, 1, 2, 3, 6, 12, 20, 24, 48, 72, 168]),
  PERSONA_AVATAR_COLORS: Object.freeze(['violet', 'indigo', 'teal', 'green', 'amber', 'rose']),
  AI_REQUEST_STATUS: Object.freeze({
    CREATING: 'CREATING',
    REQUESTED: 'REQUESTED',
    GENERATED: 'GENERATED',
    PUBLISHED: 'PUBLISHED',
    ERROR: 'ERROR'
  }),
  SHEETS: Object.freeze({
    ENTRIES: Object.freeze({
      name: 'Entries',
      headers: Object.freeze([
        'id', 'body', 'tags', 'createdAt', 'updatedAt',
        'favorite', 'deletedAt', 'authorEmail', 'authorType',
        'authorId', 'authorName', 'sourceLabel', 'sourceUrl',
        'parentId', 'rootId', 'aiReplyDisabled'
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
        'createdAt', 'updatedAt', 'authorEmail', 'avatarColor'
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

function normalizeAiIntervalHours_(value, fallback) {
  const minutes = aiIntervalHoursToMinutes_(value);
  if (CONFIG_.AI_INTERVAL_MINUTES.indexOf(minutes) >= 0) {
    return aiIntervalMinutesToHours_(minutes);
  }
  const fallbackMinutes = aiIntervalHoursToMinutes_(fallback);
  if (CONFIG_.AI_INTERVAL_MINUTES.indexOf(fallbackMinutes) >= 0) {
    return aiIntervalMinutesToHours_(fallbackMinutes);
  }
  return 0;
}

function normalizeAiAutomationIntervalHours_(settings) {
  return normalizeAiWorkHoursAutomationIntervalHours_(settings);
}

function normalizeAiWorkHoursAutomationIntervalHours_(settings) {
  const source = settings && settings.aiWorkHoursIntervalHours !== undefined
    ? settings.aiWorkHoursIntervalHours
    : CONFIG_.DEFAULT_AI_AUTOMATION_INTERVAL_HOURS;
  return normalizeAiIntervalHours_(source, CONFIG_.DEFAULT_AI_AUTOMATION_INTERVAL_HOURS);
}

function normalizeAiOffHoursAutomationIntervalHours_(settings) {
  const source = settings && settings.aiOffHoursIntervalHours !== undefined
    ? settings.aiOffHoursIntervalHours
    : CONFIG_.DEFAULT_AI_AUTOMATION_INTERVAL_HOURS;
  return normalizeAiIntervalHours_(source, CONFIG_.DEFAULT_AI_AUTOMATION_INTERVAL_HOURS);
}

function currentAiAutomationIntervalHours_(settings, date) {
  return isAiWorkHours_(date || new Date())
    ? normalizeAiWorkHoursAutomationIntervalHours_(settings)
    : normalizeAiOffHoursAutomationIntervalHours_(settings);
}

function isAiWorkHours_(date) {
  const time = Utilities.formatDate(date || new Date(), Session.getScriptTimeZone(), 'HH:mm');
  const parts = String(time).split(':').map(Number);
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return false;
  const minutes = parts[0] * 60 + parts[1];
  return minutes >= CONFIG_.AI_WORK_HOURS_START_MINUTE && minutes <= CONFIG_.AI_WORK_HOURS_END_MINUTE;
}

function aiIntervalHoursToMinutes_(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 60);
}

function aiIntervalMinutesToHours_(minutes) {
  return Number(minutes) / 60;
}

function aiIntervalHoursToMs_(value) {
  return aiIntervalHoursToMinutes_(value) * 60 * 1000;
}

function isValidDateInput_(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function normalizeReferenceUrl_(value) {
  const url = String(value || '').trim();
  return /^https:\/\/[^\s<>]+$/i.test(url) ? url : '';
}

function validateReferenceUrl_(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  const normalized = normalizeReferenceUrl_(url);
  if (!normalized) throw new Error('参考リンクは https:// から始まるURLを入力してください。');
  return normalized;
}

function normalizePersonaAvatarColor_(value, personaId) {
  const color = String(value || '').trim();
  if (CONFIG_.PERSONA_AVATAR_COLORS.indexOf(color) >= 0) return color;
  const seed = Array.from(String(personaId || '')).reduce(function (total, character) {
    return ((total * 31) + character.codePointAt(0)) >>> 0;
  }, 0);
  return CONFIG_.PERSONA_AVATAR_COLORS[seed % CONFIG_.PERSONA_AVATAR_COLORS.length];
}

function randomPersonaAvatarColor_(existingRecords) {
  const used = (existingRecords || []).map(function (record) {
    return normalizePersonaAvatarColor_(record.avatarColor, record.id);
  });
  const available = CONFIG_.PERSONA_AVATAR_COLORS.filter(function (color) {
    return used.indexOf(color) < 0;
  });
  const candidates = available.length ? available : CONFIG_.PERSONA_AVATAR_COLORS;
  return candidates[Math.floor(Math.random() * candidates.length)];
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
