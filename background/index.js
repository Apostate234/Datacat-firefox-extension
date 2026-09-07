/* global SourceVaultCore, SourceVaultQueue */
"use strict";

// background/index.js — MV3 service-worker entry.
//
// Deterministic importScripts load order (shared vocabulary first, then background
// modules from leaf helpers up to the router). Every module attaches its functions
// and state to the shared service-worker global scope; nothing here uses ES modules,
// so cross-module calls resolve at message/lifecycle time after all scripts load.
//
//   ../shared/source_vault_core.js
//   ../shared/source_vault_queue.js
//   ../shared/storage_keys.js
//   ../shared/errors.js
//   ../shared/messages.js
//   ../shared/contracts.js
//   ../shared/policy.js   (pure gate/preflight decision helpers)
//   ../generated/source_registry.js (packaged source metadata)
//   constants.js          (MessageTypes/StorageKeys aliases + config constants)
//   chrome_adapters.js    (chrome.* wrappers + generic helpers)
//   broadcasts.js         (broadcast/debug + sidebar event revision)
//   storage.js            (datacat config / upload settings / storage stats)
//   source_accounts.js    (identity + approval gate)
//   extraction_personas.js (opaque per-install/source-account capture aliases)
//   thumbnails.js         (thumbnail cache pipeline)
//   datacat_client.js     (origin/session/preflight/announcements)
//   retrieved_store.js    (saved characters + upload lifecycle)
//   tab_state.js          (tabStates + nav epochs + content messaging)
//   creator_store.js      (creator cache + retrieval)
//   janny_recovery.js     (managed-tab capture + source-page continuation)
//   queue_worker.js       (retrieval queue persistence + orchestration)
//   router.js             (onMessage / onMessageExternal routing)
//
// index.js itself only registers lifecycle listeners + boot hydrate below.

importScripts(
  "../shared/source_vault_core.js",
  "../shared/source_vault_queue.js",
  "../shared/storage_keys.js",
  "../shared/errors.js",
  "../shared/messages.js",
  "../shared/contracts.js",
  "../shared/policy.js",
  "../generated/source_registry.js",
  "constants.js",
  "chrome_adapters.js",
  "broadcasts.js",
  "storage.js",
  "source_accounts.js",
  "extraction_personas.js",
  "thumbnails.js",
  "datacat_client.js",
  "retrieved_store.js",
  "tab_state.js",
  "creator_store.js",
  "janny_recovery.js",
  "queue_worker.js",
  "router.js"
);

chrome.runtime.onInstalled.addListener((details) => {
  if (details && details.reason !== "install") {
    resumeQueueAfterLifecycle("Extension updated or reloaded.").catch(() => {});
  }
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  resumeQueueAfterLifecycle("Chrome restarted.").catch(() => {});
});

if (chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm) return;
    if (alarm.name === RETRIEVAL_QUEUE_ALARM || alarm.name === RETRIEVAL_QUEUE_JOB_DEADLINE_ALARM) {
      reconcileManagedQueueWorker().then((state) => {
        broadcastRetrievalQueue(state);
        if (state.status === "running" && !state.activeItemId) scheduleRetrievalQueueRun(0);
      }).catch(() => {});
      return;
    }
    if (alarm.name === RETRIEVAL_QUEUE_IDLE_CLOSE_ALARM) {
      closeIdleRetrievalQueueWorker().catch(() => {});
      return;
    }
    if (alarm.name === RETRIEVAL_QUEUE_IDLE_CLOSE_RETRY_ALARM) {
      retryIdleRetrievalQueueCleanup().catch(() => {});
    }
  });
}

if (chrome.windows && chrome.windows.onRemoved) {
  chrome.windows.onRemoved.addListener((windowId) => {
    clearWindowUploadVisibility(windowId).catch(() => {});
    readRetrievalQueueState().then((state) => {
      if (Number(state.workerWindowId) !== Number(windowId)) return;
      recoverManagedQueueWorkerLoss({
        windowId,
        tabId: state.workerTabId,
        reason: "Managed retrieval window was closed.",
      }).catch(() => {});
    }).catch(() => {});
  });
}

chrome.action.onClicked.addListener((tab) => {
  if (chrome.sidePanel && chrome.sidePanel.open && tab && tab.id) {
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const usage = getExtensionTabUsage(tabId);
  tabStates.delete(tabId);
  tabNavigationEpochs.delete(tabId);
  forgetExtensionTabUsage(tabId);
  if (usage && usage.role === "queue_worker") {
    readRetrievalQueueState().then((state) => {
      if (Number(state.workerTabId) !== Number(tabId)) return;
      recoverManagedQueueWorkerLoss({
        tabId,
        windowId: usage.windowId || state.workerWindowId,
        reason: "Managed retrieval tab was closed.",
      }).catch(() => {});
    }).catch(() => {});
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  const tabId = activeInfo && activeInfo.tabId ? activeInfo.tabId : null;
  const usage = getExtensionTabUsage(tabId);
  if (usage && isQueueManagedUsage(usage)) return;
  tabsGet(tabId).then(
    (tab) => {
      const eventRevision = nextSidebarEventRevision();
      const url = (tab && (tab.pendingUrl || tab.url)) || null;
      const navigationEpoch = getTabNavigationEpoch(tabId);
      debugBroadcast("active_tab_changed", { tabId, url, eventRevision, navigationEpoch });
      broadcast({ type: MessageTypes.SV_ACTIVE_TAB_CHANGED, tabId, windowId: tab && tab.windowId, url, eventRevision, navigationEpoch });
    },
    () => {
      const eventRevision = nextSidebarEventRevision();
      debugBroadcast("active_tab_changed", { tabId, url: null, eventRevision, navigationEpoch: getTabNavigationEpoch(tabId) });
      broadcast({
        type: MessageTypes.SV_ACTIVE_TAB_CHANGED,
        tabId,
        windowId: activeInfo && activeInfo.windowId,
        url: null,
        eventRevision,
        navigationEpoch: getTabNavigationEpoch(tabId),
      });
    },
  );
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo && (changeInfo.url || changeInfo.status === "loading" || changeInfo.status === "complete")) {
    const currentUrl = changeInfo.url || (tab && (tab.pendingUrl || tab.url)) || null;
    const navigationEpoch = changeInfo.url || changeInfo.status === "loading"
      ? advanceTabNavigationEpoch(tabId)
      : getTabNavigationEpoch(tabId);
    const eventRevision = nextSidebarEventRevision();
    const usage = getExtensionTabUsage(tabId);
    if (usage) {
      extensionTabUsage.set(tabId, SourceVaultCore.sanitizeForTransport({
        ...usage,
        currentUrl: currentUrl || usage.currentUrl || null,
        lastTabStatus: changeInfo.status || usage.lastTabStatus || null,
        updatedAt: new Date().toISOString(),
      }));
      persistTabUsageSnapshot();
    }
    if (usage && usage.role === "queue_worker") {
      handleManagedQueueTabNavigation(tabId, currentUrl, changeInfo).catch((error) => {
        debugBroadcast("queue_worker_navigation_reconcile_failed", {
          tabId,
          url: currentUrl,
          error: normalizeError(error),
        });
      });
    }
    debugBroadcast("tab_url_changed", {
      tabId,
      url: currentUrl,
      status: changeInfo.status || null,
      eventRevision,
      navigationEpoch,
    });
    if (!usage || !isQueueManagedUsage(usage)) {
      broadcast({
        type: MessageTypes.SV_TAB_URL_CHANGED,
        tabId,
        windowId: tab && tab.windowId,
        url: currentUrl,
        status: changeInfo.status || null,
        eventRevision,
        navigationEpoch,
      });
    }
  }
});

migrateStoredExtractionPersonaAliases().catch(() => {}).then(() => hydrateTabUsageFromStorage()).catch(() => {}).then(() => resumeQueueAfterLifecycle("Extension service worker started.")).then(() => reconcileManagedQueueWorker()).then((state) => {
  syncRetrievalQueueAlarms(state);
  broadcastRetrievalQueue(state);
}).catch(() => {});
