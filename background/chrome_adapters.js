"use strict";
// background/chrome_adapters.js — thin chrome.* wrappers + small generic helpers
// Extracted from background.js in Phase 2 (mechanical move; behavior unchanged).
// Loaded in MV3 service-worker global scope via importScripts from background/index.js.
// Depends (global scope) on: shared/errors.js, constants.js

function normalizeError(error) {
  return SourceVaultErrors.normalizeError(error);
}

function getManifestVersion() {
  try {
    return chrome.runtime.getManifest().version || null;
  } catch (_) {
    return null;
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function compactText(value, maxLength) {
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  const limit = Number.isFinite(maxLength) ? maxLength : 400;
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 3)).trim()}...` : text;
}

function formatAgeLabel(ageMs) {
  const ms = Math.max(0, Number(ageMs) || 0);
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function getSupportedSourceRank(tab) {
  let url = null;
  try {
    url = new URL((tab && tab.url) || "");
  } catch (_) {
    return 0;
  }
  const resolved = globalThis.SourceVaultSourceRegistry && SourceVaultSourceRegistry.resolveUrl(url.href);
  if (!resolved) return 0;
  return resolved.isCharacterPage ? 3 : 2;
}

function getActiveTab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    callback(tabs && tabs.length ? tabs[0] : null);
  });
}

function getActiveTabAsync() {
  return new Promise((resolve) => getActiveTab(resolve));
}

function getContextTab(options, callback) {
  const root = options && typeof options === "object" ? options : {};
  const tabId = Number(root.tabId || 0);
  if (Number.isFinite(tabId) && tabId > 0) {
    tabsGet(tabId).then((tab) => callback(tab), () => callback(null));
    return;
  }
  const windowId = Number(root.windowId || 0);
  if (Number.isFinite(windowId) && windowId > 0) {
    chrome.tabs.query({ active: true, windowId }, (tabs) => {
      void chrome.runtime.lastError;
      callback(tabs && tabs.length ? tabs[0] : null);
    });
    return;
  }
  getActiveTab(callback);
}

function parseTabUrl(tab) {
  try {
    return new URL((tab && tab.url) || "");
  } catch (_) {
    return null;
  }
}

function getSourceFamilyFromUrl(value) {
  const raw = value instanceof URL ? value.href : String(value || "");
  const resolved = globalThis.SourceVaultSourceRegistry && SourceVaultSourceRegistry.resolveUrl(raw);
  return resolved && resolved.sourceKind ? resolved.sourceKind : null;
}

function executePageNavigation(tabId, url) {
  return new Promise((resolve, reject) => {
    if (!chrome.scripting || !chrome.scripting.executeScript) {
      reject(new Error("scripting_permission_missing"));
      return;
    }
    chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [url],
      func: (targetUrl) => {
        window.location.assign(targetUrl);
      },
    }, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || "page_navigation_failed"));
      else resolve();
    });
  });
}

function isMissingContentReceiverError(error) {
  return SourceVaultErrors.isMissingContentReceiverError(error);
}

function injectContentScriptIntoTab(tabId) {
  return new Promise((resolve, reject) => {
    if (!chrome.scripting || !chrome.scripting.executeScript) {
      reject(new Error("scripting_permission_missing"));
      return;
    }
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => globalThis.__pincatContentRuntimeV021 && globalThis.__pincatContentRuntimeV021.version || null,
    }, (probeResults) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || "content_script_probe_failed"));
        return;
      }
      const loadedVersion = Array.isArray(probeResults) && probeResults[0] && probeResults[0].result;
      if (loadedVersion === "0.21.0") {
        resolve();
        return;
      }
      const sourceNormalizerScripts = globalThis.SourceVaultSourceRegistry && typeof SourceVaultSourceRegistry.list === "function"
        ? SourceVaultSourceRegistry.list().map((descriptor) => descriptor.normalizer).filter(Boolean)
        : ["sources/janitor/normalizer.js", "sources/saucepan/normalizer.js"];
      chrome.scripting.executeScript({
        target: { tabId },
        files: [
          "shared/source_vault_core.js",
          "shared/source_vault_queue.js",
          "shared/storage_keys.js",
          "shared/errors.js",
          "shared/messages.js",
          "shared/contracts.js",
          "generated/source_registry.js",
          ...sourceNormalizerScripts,
          "content/runtime.js",
          "content/bridge_rpc.js",
          "content/page_state.js",
          "content/page_overlay.js",
          "sources/janitor/janny_capture.js",
          "content/janny_overlay.js",
          "content/retrieval_orchestrator.js",
          "content/isolated.js",
        ],
      }, () => {
        const injectionError = chrome.runtime.lastError;
        if (injectionError) reject(new Error(injectionError.message || "content_script_injection_failed"));
        else resolve();
      });
    });
  });
}

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || "storage_get_failed"));
      else resolve(result || {});
    });
  });
}

function storageSet(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(value, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || "storage_set_failed"));
      else resolve();
    });
  });
}

function storageAreaGet(area, keys) {
  return new Promise((resolve, reject) => {
    area.get(keys, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || "storage_area_get_failed"));
      else resolve(result || {});
    });
  });
}

function storageAreaClear(area) {
  return new Promise((resolve, reject) => {
    area.clear(() => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || "storage_area_clear_failed"));
      else resolve();
    });
  });
}

function storageAreaSet(area, value) {
  return new Promise((resolve, reject) => {
    area.set(value, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || "storage_area_set_failed"));
      else resolve();
    });
  });
}

function storageAreaRemove(area, keys) {
  return new Promise((resolve, reject) => {
    area.remove(keys, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || "storage_area_remove_failed"));
      else resolve();
    });
  });
}

function storageAreaGetBytesInUse(area, keys) {
  return new Promise((resolve) => {
    if (!area || typeof area.getBytesInUse !== "function") {
      resolve(null);
      return;
    }
    try {
      area.getBytesInUse(keys == null ? null : keys, (bytes) => {
        const err = chrome.runtime.lastError;
        resolve(err ? null : Number(bytes) || 0);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function tabsQuery(queryInfo) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo || {}, (tabs) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || "tabs_query_failed"));
      else resolve(Array.isArray(tabs) ? tabs : []);
    });
  });
}


function tabsCreate(createProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProperties || {}, (tab) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || "tabs_create_failed"));
      else resolve(tab || null);
    });
  });
}


function tabsUpdate(tabId, updateProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProperties || {}, (tab) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || "tabs_update_failed"));
      else resolve(tab || null);
    });
  });
}


function windowsUpdate(windowId, updateProperties) {
  return new Promise((resolve) => {
    if (!chrome.windows || !chrome.windows.update || windowId == null) {
      resolve(null);
      return;
    }
    chrome.windows.update(windowId, updateProperties || {}, (windowInfo) => {
      void chrome.runtime.lastError;
      resolve(windowInfo || null);
    });
  });
}

function windowsGetLastFocused(getInfo = {}) {
  return new Promise((resolve) => {
    if (!chrome.windows || !chrome.windows.getLastFocused) {
      resolve(null);
      return;
    }
    chrome.windows.getLastFocused(getInfo || {}, (windowInfo) => {
      void chrome.runtime.lastError;
      resolve(windowInfo || null);
    });
  });
}


function windowsCreate(createData) {
  return new Promise((resolve, reject) => {
    if (!chrome.windows || !chrome.windows.create) {
      reject(new Error("windows_api_unavailable"));
      return;
    }
    chrome.windows.create(createData || {}, (windowInfo) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || "window_create_failed"));
      else resolve(windowInfo || null);
    });
  });
}


function windowsRemove(windowId) {
  return new Promise((resolve) => {
    if (!chrome.windows || !chrome.windows.remove || windowId == null) {
      resolve(false);
      return;
    }
    chrome.windows.remove(windowId, () => {
      void chrome.runtime.lastError;
      resolve(true);
    });
  });
}


function tabsGet(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || "tabs_get_failed"));
      else resolve(tab || null);
    });
  });
}


function normalizeComparableTabUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    return url.toString();
  } catch (_) {
    return String(value || "").replace(/#.*$/, "");
  }
}


function tabAlreadyAtUrl(tab, url) {
  const wanted = normalizeComparableTabUrl(url);
  if (!wanted) return false;
  return [tab && tab.pendingUrl, tab && tab.url]
    .filter(Boolean)
    .some((candidate) => normalizeComparableTabUrl(candidate) === wanted);
}


async function getRequestedTab(options = {}) {
  if (options.syncActiveTab === true || options.useActiveTab === true) {
    const activeTab = await getActiveTabAsync();
    if (activeTab && activeTab.id) return activeTab;
  }
  const rawTabId = Number(options.tabId || options.activeTabId || 0);
  if (Number.isFinite(rawTabId) && rawTabId > 0) {
    const tab = await tabsGet(rawTabId).catch(() => null);
    if (tab && tab.id) return tab;
  }
  return null;
}


function tabsRemove(tabId) {
  return new Promise((resolve) => {
    if (!tabId) {
      resolve(false);
      return;
    }
    chrome.tabs.remove(tabId, () => {
      const err = chrome.runtime.lastError;
      resolve(!err);
    });
  });
}


function tabsSendMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || "tabs_send_message_failed"));
      else resolve(response || null);
    });
  });
}


function tabsSendMessageNoThrow(tabId, message) {
  if (!tabId) return;
  try {
    chrome.tabs.sendMessage(tabId, message, () => {
      void chrome.runtime.lastError;
    });
  } catch (_) {}
}


function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      tabsGet(tabId).then(resolve, () => resolve(null));
    }, Math.max(1000, timeoutMs || 10000));
    const cleanup = () => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
    };
    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo && changeInfo.status === "complete") {
        cleanup();
        resolve(tab || null);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    tabsGet(tabId).then((tab) => {
      if (tab && tab.status === "complete") {
        cleanup();
        resolve(tab);
      }
    }, () => {});
  });
}
