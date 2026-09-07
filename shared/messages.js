"use strict";

(function initSourceVaultMessages(globalScope) {
  const MessageTypes = Object.freeze({
    // Requests / commands
    SV_GET_ACTIVE_TAB_STATE: "SV_GET_ACTIVE_TAB_STATE",
    SV_REFRESH_ACTIVE_TAB: "SV_REFRESH_ACTIVE_TAB",
    SV_START_ACTIVE_TAB_RETRIEVAL: "SV_START_ACTIVE_TAB_RETRIEVAL",
    SV_GET_ACTIVE_TAB_CAPTURE: "SV_GET_ACTIVE_TAB_CAPTURE",
    SV_GET_RETRIEVED_CHARACTERS: "SV_GET_RETRIEVED_CHARACTERS",
    SV_GET_RETRIEVED_CHARACTER: "SV_GET_RETRIEVED_CHARACTER",
    SV_SAVE_RETRIEVED_CHARACTER: "SV_SAVE_RETRIEVED_CHARACTER",
    SV_TAB_STATE: "SV_TAB_STATE",
    SV_GET_STATE: "SV_GET_STATE",
    SV_REFRESH_STATE: "SV_REFRESH_STATE",
    SV_START_RETRIEVAL: "SV_START_RETRIEVAL",
    SV_GET_CAPTURE: "SV_GET_CAPTURE",
    SV_RETRIEVE_CREATOR_PROFILE: "SV_RETRIEVE_CREATOR_PROFILE",
    SV_RETRIEVE_JANNY: "SV_RETRIEVE_JANNY",
    SV_CAPTURE_JANNY_PAGE: "SV_CAPTURE_JANNY_PAGE",
    SV_OPEN_JANNY_RECOVERY_TAB: "SV_OPEN_JANNY_RECOVERY_TAB",
    SV_SKIP_JANNY_RECOVERY_NOW: "SV_SKIP_JANNY_RECOVERY_NOW",
    SV2_NAVIGATE_ACTIVE_SOURCE_PAGE: "SV2_NAVIGATE_ACTIVE_SOURCE_PAGE",
    SV2_RUNTIME_PING: "SV2_RUNTIME_PING",
    SV2_OPEN_CREATOR_VIEW: "SV2_OPEN_CREATOR_VIEW",
    SV2_GET_CREATOR_RECORD: "SV2_GET_CREATOR_RECORD",
    SV2_RETRIEVE_CREATOR_CHARACTER: "SV2_RETRIEVE_CREATOR_CHARACTER",
    SV2_PREFLIGHT_CHARACTER: "SV2_PREFLIGHT_CHARACTER",
    SV2_GET_DATACAT_STATE: "SV2_GET_DATACAT_STATE",
    SV2_SET_DATACAT_ORIGIN: "SV2_SET_DATACAT_ORIGIN",
    SV2_OPEN_DATACAT_LOGIN: "SV2_OPEN_DATACAT_LOGIN",
    SV2_UNLINK_DATACAT: "SV2_UNLINK_DATACAT",
    SV2_GET_UPLOAD_SETTINGS: "SV2_GET_UPLOAD_SETTINGS",
    SV2_SET_UPLOAD_VISIBILITY: "SV2_SET_UPLOAD_VISIBILITY",
    SV2_SET_JOB_TIMEOUT: "SV2_SET_JOB_TIMEOUT",
    SV2_GET_SOURCE_ACCOUNT_APPROVALS: "SV2_GET_SOURCE_ACCOUNT_APPROVALS",
    SV2_SET_SOURCE_ACCOUNT_APPROVAL: "SV2_SET_SOURCE_ACCOUNT_APPROVAL",
    SV2_GET_SOURCE_ACCOUNT_SESSION_STATUS: "SV2_GET_SOURCE_ACCOUNT_SESSION_STATUS",
    SV2_GET_EXTRACTION_PERSONA_ALIAS: "SV2_GET_EXTRACTION_PERSONA_ALIAS",
    SV2_CACHE_THUMBNAILS: "SV2_CACHE_THUMBNAILS",
    SV2_GET_THUMBNAILS: "SV2_GET_THUMBNAILS",
    SV2_RETRY_UPLOAD: "SV2_RETRY_UPLOAD",
    SV2_QUEUE_GET_STATE: "SV2_QUEUE_GET_STATE",
    SV2_QUEUE_ADD_ITEMS: "SV2_QUEUE_ADD_ITEMS",
    SV2_QUEUE_START: "SV2_QUEUE_START",
    SV2_QUEUE_STOP: "SV2_QUEUE_STOP",
    SV2_QUEUE_PAUSE: "SV2_QUEUE_PAUSE",
    SV2_QUEUE_RESUME: "SV2_QUEUE_RESUME",
    SV2_QUEUE_MOVE_NEXT: "SV2_QUEUE_MOVE_NEXT",
    SV2_QUEUE_REMOVE_ITEM: "SV2_QUEUE_REMOVE_ITEM",
    SV2_QUEUE_RETRY_ITEM: "SV2_QUEUE_RETRY_ITEM",
    SV2_QUEUE_CLEAR_FINISHED: "SV2_QUEUE_CLEAR_FINISHED",
    SV2_QUEUE_CLEAR_ALL: "SV2_QUEUE_CLEAR_ALL",
    SV2_GET_SOURCE_ANNOUNCEMENTS: "SV2_GET_SOURCE_ANNOUNCEMENTS",
    SV2_GET_EXTENSION_VERSION_STATUS: "SV2_GET_EXTENSION_VERSION_STATUS",
    SV2_RECORD_COMPANION_ACTIVITY: "SV2_RECORD_COMPANION_ACTIVITY",
    SV2_DISMISS_SOURCE_ANNOUNCEMENT: "SV2_DISMISS_SOURCE_ANNOUNCEMENT",
    SV2_GET_STORAGE_STATS: "SV2_GET_STORAGE_STATS",
    SV2_CLEAR_ALL_EXTENSION_STORAGE: "SV2_CLEAR_ALL_EXTENSION_STORAGE",
    // Kept for Datacat bridge page compatibility (server still posts this type).
    SOURCE_VAULT_V2_DATACAT_SESSION: "SOURCE_VAULT_V2_DATACAT_SESSION",

    // Broadcasts
    SV_TAB_STATE_UPDATED: "SV_TAB_STATE_UPDATED",
    SV_ACTIVE_TAB_CHANGED: "SV_ACTIVE_TAB_CHANGED",
    SV_TAB_URL_CHANGED: "SV_TAB_URL_CHANGED",
    SV_RETRIEVED_CHARACTERS_UPDATED: "SV_RETRIEVED_CHARACTERS_UPDATED",
    SV_JANNY_RECOVERY_JOB_UPDATED: "SV_JANNY_RECOVERY_JOB_UPDATED",
    SV2_DATACAT_STATE_UPDATED: "SV2_DATACAT_STATE_UPDATED",
    SV2_UPLOAD_SETTINGS_UPDATED: "SV2_UPLOAD_SETTINGS_UPDATED",
    SV2_SOURCE_ACCOUNT_APPROVALS_UPDATED: "SV2_SOURCE_ACCOUNT_APPROVALS_UPDATED",
    SV2_THUMBNAIL_CACHE_UPDATED: "SV2_THUMBNAIL_CACHE_UPDATED",
    SV2_QUEUE_UPDATED: "SV2_QUEUE_UPDATED",
    SV2_UPLOAD_STATUS_UPDATED: "SV2_UPLOAD_STATUS_UPDATED",
    SV2_CREATOR_RECORD_UPDATED: "SV2_CREATOR_RECORD_UPDATED",
    SV2_CREATOR_LOAD_PHASE: "SV2_CREATOR_LOAD_PHASE",
    SV2_DEBUG_LOG: "SV2_DEBUG_LOG",
    SV2_STORAGE_CLEARED: "SV2_STORAGE_CLEARED",
  });

  const KNOWN_TYPES = new Set(Object.values(MessageTypes));

  function isKnownMessageType(type) {
    return KNOWN_TYPES.has(String(type || ""));
  }

  function assertMessageShape(type, message) {
    const root = message && typeof message === "object" ? message : null;
    if (!root) return { ok: false, error: "message_not_object" };
    const resolvedType = type || root.type;
    if (!isKnownMessageType(resolvedType)) {
      return { ok: false, error: "unknown_message_type" };
    }
    if (root.type && root.type !== resolvedType) {
      return { ok: false, error: "type_mismatch" };
    }

    switch (resolvedType) {
      case MessageTypes.SV_GET_RETRIEVED_CHARACTER:
      case MessageTypes.SV2_RETRY_UPLOAD:
        if (!String(root.characterId || "").trim()) {
          return { ok: false, error: "characterId_required" };
        }
        break;
      case MessageTypes.SV2_SET_DATACAT_ORIGIN:
        if (!String(root.origin || "").trim()) {
          return { ok: false, error: "origin_required" };
        }
        break;
      case MessageTypes.SV2_SET_UPLOAD_VISIBILITY: {
        const visibility = String(root.visibility || "").trim().toLowerCase();
        if (visibility !== "public" && visibility !== "mine") {
          return { ok: false, error: "visibility_invalid" };
        }
        if (root.windowId != null && (!Number.isInteger(Number(root.windowId)) || Number(root.windowId) < 0)) {
          return { ok: false, error: "windowId_invalid" };
        }
        break;
      }
      case MessageTypes.SV2_SET_JOB_TIMEOUT: {
        const minutes = Number(root.minutes);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30) {
          return { ok: false, error: "job_timeout_invalid" };
        }
        break;
      }
      case MessageTypes.SV2_GET_UPLOAD_SETTINGS:
        if (root.windowId != null && (!Number.isInteger(Number(root.windowId)) || Number(root.windowId) < 0)) {
          return { ok: false, error: "windowId_invalid" };
        }
        break;
      case MessageTypes.SV2_QUEUE_ADD_ITEMS:
        if (!Array.isArray(root.items) && !Array.isArray(root.urls)) {
          return { ok: false, error: "items_or_urls_required" };
        }
        break;
      case MessageTypes.SV_TAB_STATE:
        if (!root.state || typeof root.state !== "object") {
          return { ok: false, error: "state_required" };
        }
        break;
      case MessageTypes.SOURCE_VAULT_V2_DATACAT_SESSION:
        if (!String(root.sessionToken || root.token || "").trim() && !root.ok) {
          // Bridge may send ok:false; require token only when claiming success.
          if (root.ok !== false) return { ok: false, error: "sessionToken_required" };
        }
        if (!String(root.origin || "").trim()) return { ok: false, error: "origin_required" };
        if (!String(root.nonce || "").trim()) return { ok: false, error: "nonce_required" };
        break;
      default:
        break;
    }

    return { ok: true, type: resolvedType };
  }

  const api = Object.freeze({
    MessageTypes,
    isKnownMessageType,
    assertMessageShape,
  });

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.SourceVaultMessages = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
