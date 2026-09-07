"use strict";
// background/datacat_client.js — Datacat origin/session/preflight/announcements
// Extracted from background.js in Phase 2 (mechanical move; behavior unchanged).
// Loaded in MV3 service-worker global scope via importScripts from background/index.js.
// Depends (global scope) on: constants.js, storage.js, broadcasts.js, chrome_adapters.js

const announcementCache = new Map();
const extensionVersionCache = new Map();
const extensionVersionRequests = new Map();

function parseExtensionVersion(value) {
  const text = String(value || "").trim();
  if (!/^\d+(?:\.\d+){0,3}$/.test(text)) return null;
  const parts = text.split(".").map((part) => Number.parseInt(part, 10));
  while (parts.length < 4) parts.push(0);
  return parts;
}

function compareExtensionVersions(left, right) {
  const leftParts = parseExtensionVersion(left);
  const rightParts = parseExtensionVersion(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < 4; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

function normalizeDatacatOrigin(value) {
  const raw = String(value || DEFAULT_DATACAT_ORIGIN).trim();
  const withProtocol = raw.includes("://") ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withProtocol);
  } catch (_) {
    throw new Error("invalid_datacat_url");
  }
  if (url.protocol !== "https:" || !/(^|\.)datacat\.run$/i.test(url.hostname)) {
    throw new Error("invalid_datacat_url");
  }
  return url.origin;
}

function buildDatacatBridgeUrl(origin, nonce) {
  const url = new URL(DATACAT_BRIDGE_PATH, origin);
  url.searchParams.set("extensionId", chrome.runtime.id);
  url.searchParams.set("sourceVault", "2");
  if (nonce) url.searchParams.set("nonce", nonce);
  return url.toString();
}

function getDatacatBridgeStorageArea() {
  return chrome.storage && chrome.storage.session ? chrome.storage.session : chrome.storage.local;
}

function createDatacatBridgeNonce() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function beginDatacatBridge(origin) {
  const expectedOrigin = normalizeDatacatOrigin(origin || DEFAULT_DATACAT_ORIGIN);
  const nonce = createDatacatBridgeNonce();
  const createdAt = Date.now();
  const pending = {
    nonce,
    expectedOrigin,
    createdAt,
    expiresAt: createdAt + DATACAT_BRIDGE_TTL_MS,
  };
  await storageAreaSet(getDatacatBridgeStorageArea(), { [DATACAT_BRIDGE_SESSION_KEY]: pending });
  return { pending, url: buildDatacatBridgeUrl(expectedOrigin, nonce) };
}

async function readPendingDatacatBridge() {
  const result = await storageAreaGet(getDatacatBridgeStorageArea(), { [DATACAT_BRIDGE_SESSION_KEY]: null });
  const pending = result && result[DATACAT_BRIDGE_SESSION_KEY];
  return pending && typeof pending === "object" ? pending : null;
}

async function clearPendingDatacatBridge() {
  await storageAreaRemove(getDatacatBridgeStorageArea(), DATACAT_BRIDGE_SESSION_KEY).catch(() => {});
}

async function validateAndConsumeDatacatBridge(message, sender) {
  const senderOriginRaw = sender && typeof sender.origin === "string" ? sender.origin.trim() : "";
  if (!senderOriginRaw) throw new Error("datacat_bridge_sender_origin_missing");
  const senderOrigin = normalizeDatacatOrigin(senderOriginRaw);
  const payloadOrigin = normalizeDatacatOrigin(message && message.origin);
  if (payloadOrigin !== senderOrigin) throw new Error("datacat_bridge_origin_mismatch");
  const config = await readDatacatConfig();
  if (normalizeDatacatOrigin(config.origin) !== senderOrigin) throw new Error("datacat_bridge_unconfigured_origin");
  const pending = await readPendingDatacatBridge();
  if (!pending) throw new Error("datacat_bridge_not_pending");
  if (Date.now() > Number(pending.expiresAt || 0)) {
    await clearPendingDatacatBridge();
    throw new Error("datacat_bridge_expired");
  }
  if (normalizeDatacatOrigin(pending.expectedOrigin) !== senderOrigin) throw new Error("datacat_bridge_target_mismatch");
  const nonce = String(message && message.nonce || "").trim();
  if (!nonce || nonce !== String(pending.nonce || "")) throw new Error("datacat_bridge_nonce_invalid");
  await clearPendingDatacatBridge();
  return { origin: senderOrigin };
}

function buildAnnouncementDismissKey(origin, sourceKind, dismissKey) {
  return [
    normalizeDatacatOrigin(origin || DEFAULT_DATACAT_ORIGIN),
    String(dismissKey || "").trim(),
  ].join("::");
}

function buildAnnouncementClientDismissKey(announcement) {
  const root = announcement && typeof announcement === "object" ? announcement : {};
  const base = String(root.dismissKey || root.id || "").trim();
  if (!base) return "";
  return [
    base,
    String(root.updatedAt || root.updated_at || root.createdAt || root.created_at || "").trim(),
  ].filter(Boolean).join("@");
}

function buildDatacatSectionLinks(origin) {
  const base = normalizeDatacatOrigin(origin || DEFAULT_DATACAT_ORIGIN);
  return [
    { id: "fresh", glyph: "F", label: "Fresh", description: "New pins and activity", url: `${base}/fresh` },
    { id: "characters", glyph: "CH", label: "Characters", description: "Browse recently added characters", url: `${base}/characters/recent` },
    { id: "creators", glyph: "CR", label: "Creators", description: "Explore creators and their collections", url: `${base}/creators` },
    { id: "circles", glyph: "CI", label: "Circles", description: "Visit community circles", url: `${base}/circles` },
    { id: "tagverse", glyph: "#", label: "Tagverse", description: "Browse tags and themes", url: `${base}/tagverse` },
  ];
}

function buildDatacatHeaders(config, extraHeaders, companionToken = null) {
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "x-source-vault-extension": EXTENSION_VARIANT,
    ...(extraHeaders || {}),
  };
  if (config && config.sessionToken) headers["x-session-token"] = config.sessionToken;
  if (companionToken) headers[DATACAT_COMPANION_TOKEN_HEADER] = companionToken;
  return headers;
}

function isCompanionProtectedPath(path) {
  const pathname = String(path || "").split("?")[0];
  return pathname === DATACAT_PREFLIGHT_PATH ||
    pathname === DATACAT_COMPANION_ACTIVITY_PATH ||
    pathname === DATACAT_UPLOAD_PATH ||
    pathname.startsWith(`${DATACAT_UPLOAD_STATUS_PATH}/`);
}

function createCompanionInstallationKey() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function rawFetchDatacatJson(config, path, init, companionToken = null) {
  const origin = normalizeDatacatOrigin(config && config.origin);
  const requestInit = { ...(init || {}) };
  const timeoutMs = Math.max(
    1000,
    Number(requestInit.timeoutMs) || DATACAT_FETCH_TIMEOUT_MS,
  );
  delete requestInit.timeoutMs;
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(`${origin}${path}`, {
      ...requestInit,
      credentials: "omit",
      headers: buildDatacatHeaders(config, requestInit.headers || null, companionToken),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (_) {
        json = { success: false, error: text.slice(0, 500) };
      }
    }
    return { response, json: json || {} };
  } catch (error) {
    if (timedOut) throw new Error("datacat_request_timeout");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function ensureCompanionInstallation(config, options = {}) {
  const origin = normalizeDatacatOrigin(config && config.origin);
  const ownerUuid = SourceVaultCore.normalizeUuid(config?.user?.uuid || config?.user?.id);
  if (!config?.sessionToken || !ownerUuid) throw new Error("datacat_session_required");
  const existing = await readCompanionInstallation(origin);
  if (
    options.force !== true &&
    existing?.token &&
    existing?.ownerUuid === ownerUuid &&
    existing?.extensionId === chrome.runtime.id
  ) {
    return existing;
  }
  const installationKey = String(existing?.installationKey || createCompanionInstallationKey());
  const body = {
    clientKey: DATACAT_COMPANION_CLIENT_KEY,
    installationKey,
    extensionId: chrome.runtime.id,
    extensionVariant: EXTENSION_VARIANT,
    extensionVersion: getManifestVersion(),
  };
  const { response, json } = await rawFetchDatacatJson(config, DATACAT_COMPANION_CONNECT_PATH, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!response.ok || !json?.success || !json?.installation?.token) {
    throw buildDatacatResponseError(response, json);
  }
  return writeCompanionInstallation(origin, {
    installationKey,
    installationId: json.installation.id || null,
    token: json.installation.token,
    scopes: Array.isArray(json.installation.scopes) ? json.installation.scopes : [],
    ownerUuid,
    extensionId: chrome.runtime.id,
    extensionVariant: EXTENSION_VARIANT,
    extensionVersion: getManifestVersion(),
    authorizedAt: new Date().toISOString(),
    expiresAt: json.installation.expiresAt || null,
  });
}

async function fetchDatacatJson(config, path, init) {
  if (!isCompanionProtectedPath(path)) return rawFetchDatacatJson(config, path, init);
  let installation = await ensureCompanionInstallation(config);
  let result = await rawFetchDatacatJson(config, path, init, installation.token);
  const code = String(result.json?.code || "").trim();
  if (
    result.response.status === 401 &&
    ["COMPANION_INSTALLATION_REQUIRED", "COMPANION_INSTALLATION_INVALID"].includes(code)
  ) {
    await clearCompanionInstallationToken(config.origin);
    installation = await ensureCompanionInstallation(config, { force: true });
    result = await rawFetchDatacatJson(config, path, init, installation.token);
  }
  return result;
}

async function recordCompanionActivity(activity = {}) {
  const state = await readDatacatState();
  if (!state.canUpload) return { ok: true, skipped: true };
  const config = await readDatacatConfig();
  const body = {
    kind: String(activity.kind || "").trim().toLowerCase(),
    name: String(activity.name || "").trim().toLowerCase(),
    surface: String(activity.surface || "").trim().toLowerCase() || null,
    sourceKind: SourceVaultCore.normalizeSourceKind(activity.sourceKind) || null,
    extensionVariant: EXTENSION_VARIANT,
    extensionVersion: getManifestVersion(),
  };
  const { response, json } = await fetchDatacatJson(config, DATACAT_COMPANION_ACTIVITY_PATH, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!response.ok || !json || json.success === false) {
    throw buildDatacatResponseError(response, json);
  }
  return { ok: true, accepted: json.accepted === true };
}

async function readDismissedAnnouncements() {
  const result = await storageGet({ [ANNOUNCEMENT_DISMISS_STORAGE_KEY]: {} });
  const stored = result[ANNOUNCEMENT_DISMISS_STORAGE_KEY];
  return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
}

async function dismissSourceAnnouncement(sourceKind, dismissKey) {
  const normalizedSourceKind = normalizeAnnouncementSourceKind(sourceKind);
  const key = String(dismissKey || "").trim();
  if (!normalizedSourceKind || !key) return { ok: true, skipped: true };
  const config = await readDatacatConfig();
  const dismissed = await readDismissedAnnouncements();
  dismissed[buildAnnouncementDismissKey(config.origin, normalizedSourceKind, key)] = new Date().toISOString();
  await storageSet({ [ANNOUNCEMENT_DISMISS_STORAGE_KEY]: dismissed });
  return { ok: true };
}

async function getSourceAnnouncements(sourceKind, options = {}) {
  const normalizedSourceKind = normalizeAnnouncementSourceKind(sourceKind);
  if (!normalizedSourceKind) return { ok: true, announcement: null, announcements: [] };
  const config = await readDatacatConfig();
  const origin = normalizeDatacatOrigin(config.origin || DEFAULT_DATACAT_ORIGIN);
  const cacheKey = `${origin}:${normalizedSourceKind}`;
  const cached = announcementCache.get(cacheKey);
  const now = Date.now();
  let announcements = null;
  if (!options.force && cached && now - cached.cachedAt < ANNOUNCEMENT_CACHE_TTL_MS) {
    announcements = cached.announcements;
  } else {
    const path = `${DATACAT_ANNOUNCEMENTS_PATH}?sourceKind=${encodeURIComponent(normalizedSourceKind)}&extensionVersion=${encodeURIComponent(getManifestVersion() || "")}`;
    const { response, json } = await fetchDatacatJson(config, path, { method: "GET" });
    if (!response.ok || !json || json.success === false) {
      throw buildDatacatResponseError(response, json);
    }
    announcements = Array.isArray(json.announcements) ? json.announcements : [];
    announcementCache.set(cacheKey, { cachedAt: now, announcements });
  }
  const dismissed = await readDismissedAnnouncements();
  const normalizedAnnouncements = announcements.map((announcement) => ({
    ...(announcement || {}),
    clientDismissKey: buildAnnouncementClientDismissKey(announcement),
  }));
  const visible = normalizedAnnouncements.filter((announcement) => {
    const key = String(announcement.clientDismissKey || announcement.dismissKey || announcement.id || "").trim();
    if (!key) return true;
    return !dismissed[buildAnnouncementDismissKey(origin, normalizedSourceKind, key)];
  });
  return {
    ok: true,
    sourceKind: normalizedSourceKind,
    announcement: visible[0] || null,
    announcements: visible,
  };
}

async function getExtensionVersionStatus() {
  const config = await readDatacatConfig();
  const currentVersion = String(getManifestVersion() || "").trim();
  return {
    ok: true,
    origin: normalizeDatacatOrigin(config.origin || DEFAULT_DATACAT_ORIGIN),
    variant: EXTENSION_VARIANT,
    compatible: true,
    currentVersion,
    latestVersion: currentVersion,
    updateAvailable: false,
    downloadUrl: null,
    checkedAt: new Date().toISOString(),
  };
}

function buildDatacatResponseError(response, json) {
  const body = json && typeof json === "object" ? json : {};
  const parts = [
    response && response.status ? `HTTP ${response.status}` : null,
    body.error,
    body.message,
    body.code,
    body.requestId ? `request ${body.requestId}` : null,
  ]
    .map((part) => (part == null ? "" : String(part).trim()))
    .filter(Boolean);
  const seen = new Set();
  const message = parts
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" · ");
  const error = new Error(message || "Datacat request failed");
  error.status = response && response.status ? response.status : null;
  error.requestId = body.requestId || null;
  error.serverError = body.error || body.message || body.code || null;
  return error;
}

function isRegisteredDatacatUser(user) {
  if (!user || typeof user !== "object") return false;
  const userType = String(user.userType || user.user_type || "").trim().toLowerCase();
  if (user.isAnonymous === true || user.is_anonymous === true || userType === "anonymous") return false;
  return (
    user.isRegistered === true ||
    user.is_registered === true ||
    userType === "registered" ||
    userType === "authenticated" ||
    String(user.role || "").trim().toLowerCase() === "admin"
  );
}

function getDatacatResponseCode(json) {
  return String(json && typeof json === "object" ? json.code || "" : "")
    .trim()
    .toUpperCase();
}

function isConfirmedInvalidDatacatSession(response, json) {
  const code = getDatacatResponseCode(json);
  return response && response.status === 401 && [
    "DATACAT_SESSION_INVALID",
    "DATACAT_SESSION_REVOKED",
  ].includes(code);
}

async function readDatacatState() {
  const config = await readDatacatConfig();
  const hasStoredLink = !!config.sessionToken;
  const hasLinkHistory = !!(config.linkedAt || config.user);
  const base = {
    ok: true,
    origin: config.origin,
    configured: true,
    checkedAt: new Date().toISOString(),
    linkedAt: config.linkedAt || null,
    lastVerifiedAt: config.lastVerifiedAt || null,
    linked: hasStoredLink,
    linkStatus: hasStoredLink ? "checking" : hasLinkHistory ? "relink_required" : "unlinked",
    requiresRelink: !hasStoredLink && hasLinkHistory,
    authenticated: false,
    connected: false,
    registered: false,
    anonymous: false,
    canUpload: false,
    sessionReady: hasStoredLink,
    user: config.user || null,
    message: hasStoredLink
      ? "Checking Datacat link"
      : hasLinkHistory
        ? "Datacat link needs to be renewed."
        : "Datacat is not linked yet.",
  };
  if (!hasStoredLink) return base;

  try {
    const { response, json } = await fetchDatacatJson(config, DATACAT_LINKAGE_SESSION_PATH, {
      method: "POST",
      timeoutMs: DATACAT_STATE_FETCH_TIMEOUT_MS,
      body: JSON.stringify({
        action: "verify",
        sessionToken: config.sessionToken,
      }),
    });
    if (isConfirmedInvalidDatacatSession(response, json)) {
      const nextConfig = await writeDatacatConfig({
        lastCheckedAt: base.checkedAt,
        sessionToken: null,
      });
      return {
        ...base,
        origin: nextConfig.origin,
        linked: false,
        linkStatus: "relink_required",
        requiresRelink: true,
        sessionReady: false,
        user: nextConfig.user || null,
        message: "Datacat confirmed that this link is no longer valid.",
        status: response.status,
        code: getDatacatResponseCode(json),
      };
    }
    if (!response.ok || !json || json.success !== true) {
      throw buildDatacatResponseError(response, json);
    }
    const user = json.session && typeof json.session === "object" ? json.session.user : null;
    const userUuid = user && SourceVaultCore.normalizeUuid(user.uuid || user.id);
    const connected = !!userUuid;
    if (!connected) throw new Error("invalid_datacat_link_verification_response");
    const registered = connected && isRegisteredDatacatUser(user);
    const nextConfig = await writeDatacatConfig({
      user,
      lastCheckedAt: base.checkedAt,
      lastVerifiedAt: base.checkedAt,
      sessionToken: config.sessionToken,
    });
    return {
      ...base,
      origin: nextConfig.origin,
      linked: true,
      linkStatus: "linked",
      requiresRelink: false,
      lastVerifiedAt: nextConfig.lastVerifiedAt || null,
      sessionReady: !!nextConfig.sessionToken,
      authenticated: true,
      connected: true,
      registered,
      anonymous: !registered,
      canUpload: true,
      user,
      message: registered
        ? "Datacat account linked"
        : "Anonymous Datacat account linked",
      status: response.status,
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      linked: true,
      linkStatus: "unreachable",
      requiresRelink: false,
      error: normalizeError(error),
      message: "Datacat could not verify the link. The existing credential was kept.",
    };
  }
}

async function unlinkDatacat() {
  const previous = await readDatacatConfig();
  await writeDatacatConfig({
    sessionToken: null,
    user: null,
    linkedAt: null,
    lastCheckedAt: null,
    lastVerifiedAt: null,
  });
  await clearCompanionInstallationToken(previous.origin).catch(() => null);
  await clearPendingDatacatBridge().catch(() => null);
  const state = await readDatacatState();
  broadcast({ type: MessageTypes.SV2_DATACAT_STATE_UPDATED, state });
  return state;
}

async function setDatacatOrigin(origin) {
  const normalizedOrigin = normalizeDatacatOrigin(origin || DEFAULT_DATACAT_ORIGIN);
  const previous = await readDatacatConfig();
  const resetSession = previous.origin !== normalizedOrigin;
  const config = await writeDatacatConfig({
    origin: normalizedOrigin,
    sessionToken: resetSession ? null : previous.sessionToken,
    user: resetSession ? null : previous.user,
    linkedAt: resetSession ? null : previous.linkedAt,
    lastCheckedAt: resetSession ? null : previous.lastCheckedAt,
    lastVerifiedAt: resetSession ? null : previous.lastVerifiedAt,
  });
  const state = await readDatacatState();
  broadcast({ type: MessageTypes.SV2_DATACAT_STATE_UPDATED, state });
  return { config, state };
}

async function requestSourceVaultPreflight(body) {
  const datacatState = await readDatacatState();
  if (!datacatState.canUpload) {
    return {
      ok: false,
      state: datacatState,
      error: datacatState.ok === false
        ? `datacat_unreachable:${normalizeError(datacatState.error || "connection_failed")}`
        : "datacat_session_required",
      preflight: null,
    };
  }
  const config = await readDatacatConfig();
  const { response, json } = await fetchDatacatJson(config, DATACAT_PREFLIGHT_PATH, {
    method: "POST",
    body: JSON.stringify({
      ...(body || {}),
      visibility: normalizeUploadVisibility((body && body.visibility) || DEFAULT_UPLOAD_VISIBILITY),
      requestedVisibility: normalizeUploadVisibility((body && (body.requestedVisibility || body.visibility)) || DEFAULT_UPLOAD_VISIBILITY),
      forceRetrieve: (body && body.forceRetrieve) === true,
    }),
  });
  if (!response.ok || !json || json.success === false) {
    throw buildDatacatResponseError(response, json);
  }
  return { ok: true, state: datacatState, preflight: json };
}
