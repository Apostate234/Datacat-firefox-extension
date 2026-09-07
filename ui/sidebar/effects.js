"use strict";

/**
 * ui/sidebar/effects.js — intent wrappers around chrome.runtime.sendMessage.
 *
 * Phase 5 scaffolding: centralises the outbound message intents the sidebar
 * fires so views/index can express intent without hand-building message
 * envelopes. The legacy runtime (legacy_app.js) still owns most request/response
 * flows for now; these wrappers are the migration target for Phase 6+.
 *
 * All message-type lookups happen at call time (never at module load) so this
 * file has no top-level dependency on the shared message catalog.
 */
(function (globalScope) {
  function types() {
    return (globalScope && globalScope.SourceVaultMessages && globalScope.SourceVaultMessages.MessageTypes) || {};
  }

  function send(type, payload, callback) {
    if (!type) return;
    const runtime = globalScope && globalScope.chrome && globalScope.chrome.runtime;
    if (!runtime || typeof runtime.sendMessage !== "function") return;
    const message = Object.assign({ type }, payload || {});
    runtime.sendMessage(message, (response) => {
      void (runtime.lastError);
      if (typeof callback === "function") callback(response, runtime.lastError || null);
    });
  }

  const Effects = {
    send,
    getActiveTabState(options, cb) {
      send(types().SV_GET_ACTIVE_TAB_STATE, options || {}, cb);
    },
    startActiveRetrieval(payload, cb) {
      send(types().SV_START_ACTIVE_TAB_RETRIEVAL, payload || {}, cb);
    },
    retryUpload(payload, cb) {
      send(types().SV2_RETRY_UPLOAD, payload || {}, cb);
    },
    getDatacatState(payload, cb) {
      send(types().SV2_GET_DATACAT_STATE, payload || {}, cb);
    },
    openDatacatLogin(cb) {
      send(types().SV2_OPEN_DATACAT_LOGIN, {}, cb);
    },
    setUploadVisibility(visibility, cb) {
      send(types().SV2_SET_UPLOAD_VISIBILITY, { visibility }, cb);
    },
    queueCommand(type, fields, cb) {
      send(type, fields || {}, cb);
    },
    dismissAnnouncement(sourceKind, dismissKey, cb) {
      send(types().SV2_DISMISS_SOURCE_ANNOUNCEMENT, { sourceKind, dismissKey }, cb);
    },
    setSourceAccountApproval(payload, cb) {
      send(types().SV2_SET_SOURCE_ACCOUNT_APPROVAL, payload || {}, cb);
    },
  };

  if (globalScope) {
    globalScope.SourceVaultSidebarEffects = Effects;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Effects;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
