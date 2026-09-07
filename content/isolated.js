"use strict";

// content/isolated.js
// Isolated-world entry, loaded LAST in the content_scripts list. All shared
// state/helpers are already declared by the preceding content/ modules (single
// content-script realm). This file only wires side effects: the page-bridge
// window listener, the background message listener, and boot(). It contains no
// pageBridgeMain / Janitor / Saucepan API client bodies.

if (CONTENT_RUNTIME.started !== true) {
  CONTENT_RUNTIME.started = true;
  globalThis.__sourceVaultSidebarV2rContentScriptReady = true;

  installBridgeWindowListener();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    if (message.type === MessageTypes.SV_GET_STATE) {
      sendResponse({ ok: true, state: summarizeStateForPublish() });
      return false;
    }
    if (message.type === MessageTypes.SV_REFRESH_STATE) {
      refreshPageState({ forceAuth: message.forceAuth === true, forcePage: message.force === true }).then(
        () => sendResponse({ ok: true, state: summarizeStateForPublish() }),
        (error) => sendResponse({ ok: false, error: shortError(error) }),
      );
      return true;
    }
    if (message.type === MessageTypes.SV_START_RETRIEVAL) {
      startRetrievalFromCurrentPage(message.options || {}).then(
        () => sendResponse({ ok: true, state: summarizeStateForPublish() }),
        (error) => sendResponse({ ok: false, error: shortError(error) }),
      );
      return true;
    }
    if (message.type === MessageTypes.SV_RETRIEVE_CREATOR_PROFILE) {
      retrieveCreatorProfileFromCurrentPage(message.creator || message.payload || {}).then(
        (capture) => sendResponse({ ok: true, capture }),
        (error) => sendResponse({ ok: false, error: shortError(error), capture: null }),
      );
      return true;
    }
    if (message.type === MessageTypes.SV_GET_CAPTURE) {
      sendResponse({ ok: true, capture: latestCapture });
      return false;
    }
    if (message.type === MessageTypes.SV_CAPTURE_JANNY_PAGE) {
      try {
        sendResponse({
          ok: true,
          capture: buildJannyCaptureFromDocument(message.characterId),
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error: shortError(error),
          capture: {
            success: false,
            source: "janny_extension_tab",
            characterId: Core.normalizeUuid(message.characterId),
            characterUrl: message.characterId ? `https://jannyai.com/characters/${message.characterId}` : location.href,
            finalUrl: location.href,
            error: shortError(error),
          },
        });
      }
      return false;
    }
    if (message.type === MessageTypes.SV_JANNY_RECOVERY_JOB_UPDATED) {
      applyJannyRecoveryJobUpdate(message.job || null);
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}
