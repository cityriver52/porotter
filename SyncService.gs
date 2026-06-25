/**
 * Lightweight sync cursors used by the browser to avoid unnecessary full sheet reads.
 */
function buildSyncState_(settings, aiRequests) {
  return {
    contentCursor: String(settings && settings.contentUpdatedAt || ''),
    notificationsCursor: String(settings && settings.notificationsUpdatedAt || ''),
    aiCursor: latestAiRequestCursor_(aiRequests || []),
    generatedAt: nowIso_()
  };
}

function normalizeClientSyncCursor_(value) {
  return {
    contentCursor: String(value && value.contentCursor || ''),
    notificationsCursor: String(value && value.notificationsCursor || ''),
    aiCursor: String(value && value.aiCursor || '')
  };
}

function cursorChanged_(clientCursor, serverCursor) {
  const current = String(serverCursor || '');
  return !String(clientCursor || '') || Boolean(current && current > String(clientCursor || ''));
}

function latestAiRequestCursor_(requests) {
  return (requests || [])
    .map(function (request) { return String(request.updatedAt || request.createdAt || ''); })
    .filter(Boolean)
    .sort()
    .pop() || '';
}

function touchContentUpdated_(timestamp) {
  writeSettings_({ contentUpdatedAt: String(timestamp || nowIso_()) });
}

function touchNotificationsUpdated_(timestamp) {
  writeSettings_({ notificationsUpdatedAt: String(timestamp || nowIso_()) });
}

function touchContentAndNotificationsUpdated_(timestamp) {
  const stamp = String(timestamp || nowIso_());
  writeSettings_({ contentUpdatedAt: stamp, notificationsUpdatedAt: stamp });
}
