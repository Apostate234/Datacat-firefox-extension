"use strict";
// background/storage.js — datacat config / upload settings / storage stats / clear-all
// Extracted from background.js in Phase 2 (mechanical move; behavior unchanged).
// Loaded in MV3 service-worker global scope via importScripts from background/index.js.
// Depends (global scope) on: constants.js, chrome_adapters.js, tab_state.js (getTabUsageStorageArea), broadcasts.js

function normalizeUploadVisibility(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["mine", "private", "yours", "local"].includes(normalized)) return "mine";
  if (["public", "feed"].includes(normalized)) return "public";
  return DEFAULT_UPLOAD_VISIBILITY;
}

function normalizeJobTimeoutMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_JOB_TIMEOUT_MINUTES;
  return Math.max(
    MIN_JOB_TIMEOUT_MINUTES,
    Math.min(MAX_JOB_TIMEOUT_MINUTES, Math.round(parsed)),
  );
}

async function readJobTimeoutMs() {
  const settings = await readUploadSettings();
  return normalizeJobTimeoutMinutes(settings.jobTimeoutMinutes) * 60 * 1000;
}

async function getExtensionStorageStats() {
  const localAll = await storageAreaGet(chrome.storage.local, null).catch(() => ({}));
  const sessionArea = getTabUsageStorageArea();
  const sessionAll = sessionArea === chrome.storage.local ? {} : await storageAreaGet(sessionArea, null).catch(() => ({}));
  const localBytes = await storageAreaGetBytesInUse(chrome.storage.local, null);
  const sessionBytes = sessionArea === chrome.storage.local ? 0 : await storageAreaGetBytesInUse(sessionArea, null);
  const thumbnailBytes = await storageAreaGetBytesInUse(chrome.storage.local, THUMBNAIL_STORAGE_KEY);
  const thumbnailStore = localAll && localAll[THUMBNAIL_STORAGE_KEY] && typeof localAll[THUMBNAIL_STORAGE_KEY] === "object"
    ? localAll[THUMBNAIL_STORAGE_KEY]
    : {};
  const queueStore = SourceVaultQueue.normalizeState(localAll && localAll[RETRIEVAL_QUEUE_STORAGE_KEY]);
  const queueProjection = SourceVaultQueue.buildProjection(queueStore);
  return {
    localBytes,
    sessionBytes,
    totalBytes: (Number(localBytes) || 0) + (Number(sessionBytes) || 0),
    thumbnailBytes: Number(thumbnailBytes) || 0,
    localKeyCount: Object.keys(localAll || {}).length,
    sessionKeyCount: Object.keys(sessionAll || {}).length,
    thumbnailCount: Object.keys(thumbnailStore || {}).length,
    queueStatus: queueProjection.status,
    queueOutstandingCount: queueProjection.counts.outstanding,
    queueFinishedCount: queueProjection.counts.finished,
    managedLocalKeys: EXTENSION_LOCAL_STORAGE_KEYS.slice(),
    checkedAt: new Date().toISOString(),
  };
}

async function readDatacatConfig() {
  const result = await storageGet({ [DATACAT_CONFIG_STORAGE_KEY]: null });
  const stored =
    result[DATACAT_CONFIG_STORAGE_KEY] &&
    typeof result[DATACAT_CONFIG_STORAGE_KEY] === "object"
      ? result[DATACAT_CONFIG_STORAGE_KEY]
      : {};
  let origin;
  try {
    origin = normalizeDatacatOrigin(stored.origin || DEFAULT_DATACAT_ORIGIN);
  } catch (_) {
    origin = DEFAULT_DATACAT_ORIGIN;
  }
  return {
    origin,
    sessionToken: typeof stored.sessionToken === "string" && stored.sessionToken.trim()
      ? stored.sessionToken.trim()
      : null,
    user: stored.user && typeof stored.user === "object" ? stored.user : null,
    linkedAt: stored.linkedAt || null,
    lastCheckedAt: stored.lastCheckedAt || null,
    lastVerifiedAt: stored.lastVerifiedAt || null,
  };
}

async function readCompanionInstallations() {
  const result = await storageGet({ [COMPANION_INSTALLATIONS_STORAGE_KEY]: {} });
  const stored = result && result[COMPANION_INSTALLATIONS_STORAGE_KEY];
  return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
}

async function readCompanionInstallation(origin) {
  const normalizedOrigin = normalizeDatacatOrigin(origin || DEFAULT_DATACAT_ORIGIN);
  const installations = await readCompanionInstallations();
  const entry = installations[normalizedOrigin];
  return entry && typeof entry === "object" ? entry : null;
}

async function writeCompanionInstallation(origin, patch) {
  const normalizedOrigin = normalizeDatacatOrigin(origin || DEFAULT_DATACAT_ORIGIN);
  const installations = await readCompanionInstallations();
  const previous = installations[normalizedOrigin] && typeof installations[normalizedOrigin] === "object"
    ? installations[normalizedOrigin]
    : {};
  const next = { ...previous, ...(patch || {}), origin: normalizedOrigin };
  installations[normalizedOrigin] = next;
  await storageSet({ [COMPANION_INSTALLATIONS_STORAGE_KEY]: installations });
  return next;
}

async function clearCompanionInstallationToken(origin) {
  const current = await readCompanionInstallation(origin);
  if (!current) return null;
  return writeCompanionInstallation(origin, {
    token: null,
    installationId: null,
    authorizedAt: null,
    expiresAt: null,
  });
}

async function readUploadSettings() {
  const result = await storageGet({ [UPLOAD_SETTINGS_STORAGE_KEY]: null });
  const stored =
    result[UPLOAD_SETTINGS_STORAGE_KEY] &&
    typeof result[UPLOAD_SETTINGS_STORAGE_KEY] === "object"
      ? result[UPLOAD_SETTINGS_STORAGE_KEY]
      : {};
  return {
    visibility: normalizeUploadVisibility(stored.visibility || DEFAULT_UPLOAD_VISIBILITY),
    jobTimeoutMinutes: normalizeJobTimeoutMinutes(stored.jobTimeoutMinutes),
    updatedAt: stored.updatedAt || null,
  };
}

function normalizeUploadVisibilityWindowId(windowId) {
  const normalized = Number(windowId);
  return Number.isInteger(normalized) && normalized >= 0 ? normalized : null;
}

function getWindowUploadVisibilityStorageArea() {
  return chrome.storage && chrome.storage.session ? chrome.storage.session : chrome.storage.local;
}

async function readWindowUploadVisibility(windowId) {
  const defaultSettings = await readUploadSettings();
  const normalizedWindowId = normalizeUploadVisibilityWindowId(windowId);
  if (normalizedWindowId == null) {
    return {
      ...defaultSettings,
      defaultVisibility: defaultSettings.visibility,
      windowId: null,
    };
  }
  const area = getWindowUploadVisibilityStorageArea();
  const result = await storageAreaGet(area, { [WINDOW_UPLOAD_VISIBILITY_STORAGE_KEY]: {} });
  const byWindow = result && result[WINDOW_UPLOAD_VISIBILITY_STORAGE_KEY] &&
      typeof result[WINDOW_UPLOAD_VISIBILITY_STORAGE_KEY] === "object"
    ? result[WINDOW_UPLOAD_VISIBILITY_STORAGE_KEY]
    : {};
  return {
    ...defaultSettings,
    visibility: normalizeUploadVisibility(byWindow[String(normalizedWindowId)] || defaultSettings.visibility),
    defaultVisibility: defaultSettings.visibility,
    windowId: normalizedWindowId,
  };
}

async function writeWindowUploadVisibility(windowId, visibility) {
  const normalizedWindowId = normalizeUploadVisibilityWindowId(windowId);
  if (normalizedWindowId == null) return writeUploadSettings({ visibility });
  const area = getWindowUploadVisibilityStorageArea();
  const result = await storageAreaGet(area, { [WINDOW_UPLOAD_VISIBILITY_STORAGE_KEY]: {} });
  const byWindow = result && result[WINDOW_UPLOAD_VISIBILITY_STORAGE_KEY] &&
      typeof result[WINDOW_UPLOAD_VISIBILITY_STORAGE_KEY] === "object"
    ? { ...result[WINDOW_UPLOAD_VISIBILITY_STORAGE_KEY] }
    : {};
  byWindow[String(normalizedWindowId)] = normalizeUploadVisibility(visibility);
  await storageAreaSet(area, { [WINDOW_UPLOAD_VISIBILITY_STORAGE_KEY]: byWindow });
  const settings = await readWindowUploadVisibility(normalizedWindowId);
  broadcast({
    type: MessageTypes.SV2_UPLOAD_SETTINGS_UPDATED,
    settings,
    windowId: normalizedWindowId,
    scope: "window",
  });
  return settings;
}

async function clearWindowUploadVisibility(windowId) {
  const normalizedWindowId = normalizeUploadVisibilityWindowId(windowId);
  if (normalizedWindowId == null) return false;
  const area = getWindowUploadVisibilityStorageArea();
  const result = await storageAreaGet(area, { [WINDOW_UPLOAD_VISIBILITY_STORAGE_KEY]: {} });
  const byWindow = result && result[WINDOW_UPLOAD_VISIBILITY_STORAGE_KEY] &&
      typeof result[WINDOW_UPLOAD_VISIBILITY_STORAGE_KEY] === "object"
    ? { ...result[WINDOW_UPLOAD_VISIBILITY_STORAGE_KEY] }
    : {};
  const key = String(normalizedWindowId);
  if (!Object.prototype.hasOwnProperty.call(byWindow, key)) return false;
  delete byWindow[key];
  await storageAreaSet(area, { [WINDOW_UPLOAD_VISIBILITY_STORAGE_KEY]: byWindow });
  return true;
}

async function writeUploadSettings(patch) {
  const previous = await readUploadSettings();
  const next = {
    ...previous,
    ...(patch || {}),
    visibility: normalizeUploadVisibility((patch && patch.visibility) || previous.visibility),
    jobTimeoutMinutes: normalizeJobTimeoutMinutes(
      patch && Object.prototype.hasOwnProperty.call(patch, "jobTimeoutMinutes")
        ? patch.jobTimeoutMinutes
        : previous.jobTimeoutMinutes,
    ),
    updatedAt: new Date().toISOString(),
  };
  await storageSet({ [UPLOAD_SETTINGS_STORAGE_KEY]: next });
  broadcast({ type: MessageTypes.SV2_UPLOAD_SETTINGS_UPDATED, settings: next });
  if (patch && Object.prototype.hasOwnProperty.call(patch, "jobTimeoutMinutes")) {
    scheduleRetrievalQueueJobDeadline().catch(() => {});
  }
  return next;
}

async function writeDatacatConfig(patch) {
  const previous = await readDatacatConfig();
  const next = {
    ...previous,
    ...(patch || {}),
  };
  next.origin = normalizeDatacatOrigin(next.origin || previous.origin || DEFAULT_DATACAT_ORIGIN);
  if (next.sessionToken != null) next.sessionToken = String(next.sessionToken).trim() || null;
  await storageSet({ [DATACAT_CONFIG_STORAGE_KEY]: next });
  return next;
}

async function clearAllExtensionStorage() {
  const queueBeforeClear = await readRetrievalQueueState().catch(() => null);
  await storageAreaClear(chrome.storage.local);
  const sessionArea = getTabUsageStorageArea();
  if (sessionArea && sessionArea !== chrome.storage.local) {
    await storageAreaClear(sessionArea).catch(() => {});
  }
  announcementCache.clear();
  jannyRecoveryJobs.clear();
  extensionTabUsage.clear();
  tabStates.clear();
  retrievalQueueState = SourceVaultQueue.createInitialState();
  if (chrome.alarms) {
    chrome.alarms.clear(RETRIEVAL_QUEUE_ALARM, () => void chrome.runtime.lastError);
    chrome.alarms.clear(RETRIEVAL_QUEUE_JOB_DEADLINE_ALARM, () => void chrome.runtime.lastError);
    chrome.alarms.clear(RETRIEVAL_QUEUE_IDLE_CLOSE_ALARM, () => void chrome.runtime.lastError);
  }
  if (queueBeforeClear && queueBeforeClear.workerWindowId) {
    await windowsRemove(queueBeforeClear.workerWindowId).catch(() => false);
  }
  const datacatState = await readDatacatState().catch(() => ({
    origin: DEFAULT_DATACAT_ORIGIN,
    connected: false,
    authenticated: false,
    canUpload: false,
    sessionReady: false,
    message: "Connect Datacat to save.",
  }));
  const uploadSettings = await readUploadSettings().catch(() => ({
    visibility: DEFAULT_UPLOAD_VISIBILITY,
    jobTimeoutMinutes: DEFAULT_JOB_TIMEOUT_MINUTES,
    updatedAt: null,
  }));
  broadcast({ type: MessageTypes.SV2_STORAGE_CLEARED });
  broadcast({ type: MessageTypes.SV_RETRIEVED_CHARACTERS_UPDATED, list: [], saved: null });
  broadcast({ type: MessageTypes.SV2_THUMBNAIL_CACHE_UPDATED, entries: {}, cleared: true });
  broadcast({ type: MessageTypes.SV2_SOURCE_ACCOUNT_APPROVALS_UPDATED, approvals: {} });
  broadcast({ type: MessageTypes.SV2_UPLOAD_SETTINGS_UPDATED, settings: uploadSettings });
  broadcast({ type: MessageTypes.SV2_DATACAT_STATE_UPDATED, state: datacatState });
  broadcastRetrievalQueue(retrievalQueueState);
  return getExtensionStorageStats();
}
