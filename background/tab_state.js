"use strict";
// background/tab_state.js — tabStates, nav epochs, content messaging, managed tab usage
// Extracted from background.js in Phase 2 (mechanical move; behavior unchanged).
// Loaded in MV3 service-worker global scope via importScripts from background/index.js.
// Depends (global scope) on: constants.js, chrome_adapters.js, broadcasts.js, storage.js, source_accounts.js

const tabStates = new Map();

const extensionTabUsage = new Map();

const forgottenExtensionTabUsage = new Set();

let tabUsageHydrationPromise = null;

const tabNavigationEpochs = new Map();

function getTabNavigationEpoch(tabId) {
  return Number(tabNavigationEpochs.get(tabId) || 0);
}

function advanceTabNavigationEpoch(tabId) {
  const next = getTabNavigationEpoch(tabId) + 1;
  tabNavigationEpochs.set(tabId, next);
  return next;
}

async function navigateActiveSourcePage(url, options = {}) {
  let targetUrl;
  try {
    targetUrl = new URL(String(url || ""));
  } catch (error) {
    debugBroadcast("navigate_active_source_page_invalid_url", {
      url,
      error: normalizeError(error),
    });
    throw error;
  }
  if (!/^https?:$/i.test(targetUrl.protocol)) {
    debugBroadcast("navigate_active_source_page_unsupported_protocol", {
      url: targetUrl.toString(),
      protocol: targetUrl.protocol,
    });
    throw new Error("navigation_url_not_supported");
  }
  debugBroadcast("navigate_active_source_page_start", { url: targetUrl.toString() });
  let tab = options.tabId ? await tabsGet(Number(options.tabId)).catch(() => null) : await getActiveTabAsync();
  if (!tab || !tab.id) {
    tab = await tabsCreate({ url: targetUrl.toString(), active: true });
    const result = { ok: true, tabId: tab && tab.id ? tab.id : null, url: targetUrl.toString(), method: "created_tab" };
    debugBroadcast("navigate_active_source_page_result", result);
    return result;
  }
  const activeUrl = parseTabUrl(tab);
  const sameSourceFamily = activeUrl && getSourceFamilyFromUrl(activeUrl) && getSourceFamilyFromUrl(activeUrl) === getSourceFamilyFromUrl(targetUrl);
  debugBroadcast("navigate_active_source_page_target_tab", {
    tabId: tab.id,
    activeUrl: activeUrl ? activeUrl.toString() : null,
    targetUrl: targetUrl.toString(),
    sameSourceFamily: sameSourceFamily === true,
  });
  if (sameSourceFamily) {
    try {
      await executePageNavigation(tab.id, targetUrl.toString());
      const result = { ok: true, tabId: tab.id, url: targetUrl.toString(), method: "page_context" };
      debugBroadcast("navigate_active_source_page_result", result);
      return result;
    } catch (error) {
      debugBroadcast("navigate_active_source_page_context_failed", {
        tabId: tab.id,
        url: targetUrl.toString(),
        error: normalizeError(error),
      });
    }
  }
  const updated = await tabsUpdate(tab.id, { url: targetUrl.toString(), active: true });
  const result = { ok: true, tabId: updated && updated.id ? updated.id : tab.id, url: targetUrl.toString(), method: "tabs_update" };
  debugBroadcast("navigate_active_source_page_result", result);
  return result;
}

async function buildNonSourceTabState(tab) {
  const tabUrl = parseTabUrl(tab);
  const config = await readDatacatConfig();
  const datacatOrigin = normalizeDatacatOrigin(config.origin || DEFAULT_DATACAT_ORIGIN);
  const isDatacatSite = !!(tabUrl && tabUrl.origin === datacatOrigin);
  return SourceVaultCore.sanitizeForTransport({
    revision: nextSidebarEventRevision(),
    auth: { loggedIn: false, checking: false },
    page: {
      isSupportedSite: false,
      isCharacterPage: false,
      isDatacatSite,
      unsupported: !isDatacatSite,
      sourceKind: null,
      sourceLabel: isDatacatSite ? "Datacat" : null,
      url: tabUrl ? tabUrl.toString() : (tab && tab.url) || null,
      navigationId: getTabNavigationEpoch(tab && tab.id),
      navigationPhase: "ready",
      pendingNavigation: false,
      hostname: tabUrl ? tabUrl.hostname : null,
      datacatOrigin,
      datacatSections: isDatacatSite ? buildDatacatSectionLinks(datacatOrigin) : [],
    },
    character: null,
    retrieval: null,
  });
}

function sendMessageToContentTab(tab, message, options, sendResponse) {
  const opts = options && typeof options === "object" ? options : {};
  if (!tab || !tab.id) {
    sendResponse({ ok: false, error: "no_active_tab" });
    return;
  }
  chrome.tabs.sendMessage(tab.id, message, (response) => {
    const err = chrome.runtime.lastError;
    if (!err) {
      sendResponse(response || { ok: true });
      return;
    }
    if (opts.injectOnMissing !== true || !isMissingContentReceiverError(err) || getSupportedSourceRank(tab) <= 0) {
      sendResponse({ ok: false, error: err.message || "content_unavailable" });
      return;
    }
    injectContentScriptIntoTab(tab.id)
      .then(() => {
        const retryMessage = opts.retryMessage && typeof opts.retryMessage === "object" ? opts.retryMessage : message;
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, retryMessage, (retryResponse) => {
            const retryErr = chrome.runtime.lastError;
            if (retryErr) {
              sendResponse({
                ok: false,
                error: retryErr.message || "content_unavailable_after_injection",
                injected: true,
              });
              return;
            }
            sendResponse({
              ...(retryResponse || { ok: true }),
              injected: true,
            });
          });
        }, 150);
      })
      .catch((injectError) => {
        sendResponse({
          ok: false,
          error: normalizeError(injectError),
          injected: false,
        });
      });
  });
}

function sendToActiveContent(message, sendResponse) {
  getActiveTab((tab) => {
    if (getSupportedSourceRank(tab) <= 0) {
      sendResponse({ ok: false, error: "active_tab_not_supported" });
      return;
    }
    sendMessageToContentTab(tab, message, { injectOnMissing: true }, sendResponse);
  });
}

function sendToActiveContentWithSourceAccountGate(message, sendResponse) {
  getActiveTab((tab) => {
    if (getSupportedSourceRank(tab) <= 0) {
      sendResponse({ ok: false, error: "active_tab_not_supported" });
      return;
    }
    sendMessageToContentTab(
      tab,
      { type: MessageTypes.SV_REFRESH_STATE, force: true, forceAuth: true },
      { injectOnMissing: true },
      (stateResponse) => {
        if (!stateResponse || stateResponse.ok === false || !stateResponse.state) {
          sendResponse({
            ok: false,
            error: stateResponse && stateResponse.error ? stateResponse.error : "content_state_unavailable",
          });
          return;
        }
        const state = SourceVaultCore.sanitizeForTransport(stateResponse.state || {});
        readSourceAccountApprovals().then(
          (approvals) => {
            const gate = getSourceAccountApprovalGate(state, approvals);
            if (!gate.allowed) {
              sendResponse({
                ok: false,
                error: gate.reason || "source_account_not_confirmed",
                accountApproval: gate,
              });
              return;
            }
            if (message && message.type === MessageTypes.SV_START_RETRIEVAL) {
              const page = state.page && typeof state.page === "object" ? state.page : {};
              const character = state.character && typeof state.character === "object" ? state.character : {};
              rememberExtensionTabUsage(tab, {
                role: "source_character_active",
                sourceKind: getStateSourceKind(state),
                characterId: SourceVaultCore.normalizeUuid(
                  character.id ||
                    character.characterId ||
                    character.companionId ||
                    page.characterId ||
                    page.companionId,
                ),
                currentUrl: tab.url || page.url || null,
                launchUrl: page.url || tab.url || null,
                createdByExtension: false,
                closableByExtension: false,
              });
            }
            sendMessageToContentTab(tab, message, { injectOnMissing: true }, sendResponse);
          },
          (error) => sendResponse({ ok: false, error: normalizeError(error) }),
        );
      },
    );
  });
}

function getActiveContentState(options, sendResponse) {
  const opts = options && typeof options === "object" ? options : {};
  getContextTab(opts, (tab) => {
    if (!tab || !tab.id) {
      sendResponse({ ok: false, error: "no_active_tab", tabId: null, state: null });
      return;
    }
    const managedUsage = getExtensionTabUsage(tab.id);
    if (managedUsage && isQueueManagedUsage(managedUsage)) {
      buildNonSourceTabState(tab).then((state) => {
        state.page = {
          ...(state.page || {}),
          isSupportedSite: false,
          isCharacterPage: false,
          isCreatorPage: false,
          unsupported: true,
          managedRetrievalWindow: true,
          sourceKind: null,
          sourceLabel: "Pincat worker",
        };
        sendResponse({
          ok: true,
          error: null,
          tabId: tab.id,
          url: tab.url || null,
          state,
          stateRevision: Number(state.revision || 0),
          navigationId: Number(state.page.navigationId || 0),
          stale: false,
          injected: false,
        });
      }, (error) => sendResponse({ ok: false, error: normalizeError(error), tabId: tab.id, state: null }));
      return;
    }
    if (getSupportedSourceRank(tab) <= 0) {
      buildNonSourceTabState(tab).then(
        (state) => sendResponse({
          ok: true,
          error: null,
          tabId: tab.id,
          url: tab.url || null,
          state,
          stateRevision: Number(state && state.revision || 0),
          navigationId: Number(state && state.page && state.page.navigationId || 0),
          stale: false,
          injected: false,
        }),
        (error) => sendResponse({
          ok: false,
          error: normalizeError(error),
          tabId: tab.id,
          url: tab.url || null,
          state: null,
          stale: false,
          injected: false,
        }),
      );
      return;
    }
    const message = opts.force === true
      ? { type: MessageTypes.SV_REFRESH_STATE, force: true, forceAuth: opts.forceAuth === true }
      : { type: MessageTypes.SV_GET_STATE };
    const retryMessage = { type: MessageTypes.SV_REFRESH_STATE, force: true, forceAuth: opts.forceAuth === true };
    sendMessageToContentTab(tab, message, {
      injectOnMissing: true,
      retryMessage,
    }, (response) => {
      const fallbackState = tabStates.get(tab.id) || null;
      if (!response || response.ok === false) {
        sendResponse({
          ok: false,
          error: response && response.error ? response.error : "content_unavailable",
          tabId: tab.id,
          url: tab.url || null,
          state: fallbackState,
          stateRevision: Number(fallbackState && fallbackState.revision || 0),
          navigationId: Number(fallbackState && fallbackState.page && fallbackState.page.navigationId || 0),
          stale: !!fallbackState,
          injected: response && response.injected === true,
        });
        return;
      }
      const state = response && response.state
        ? SourceVaultCore.sanitizeForTransport(response.state)
        : fallbackState;
      if (state) tabStates.set(tab.id, state);
      sendResponse({
        ok: !response || response.ok !== false,
        error: response && response.error ? response.error : null,
        tabId: tab.id,
        url: tab.url || null,
        state,
        stateRevision: Number(state && state.revision || 0),
        navigationId: Number(state && state.page && state.page.navigationId || 0),
        stale: false,
        injected: response && response.injected === true,
      });
    });
  });
}

async function getSyncedActiveSourceTab(url, options = {}, usage = {}) {
  const existing = await getRequestedTab(options);
  let tab = existing && existing.id ? existing : null;
  let created = false;
  if (tab && tab.id) {
    tab = tabAlreadyAtUrl(tab, url)
      ? await tabsUpdate(tab.id, { active: true }).catch(() => tab)
      : await tabsUpdate(tab.id, { url, active: true }).catch(() => tab);
  } else {
    tab = await tabsCreate({ url, active: true });
    created = true;
  }
  if (!tab || !tab.id) throw new Error("source_tab_unavailable");
  rememberExtensionTabUsage(tab, {
    ...usage,
    launchUrl: url || usage.launchUrl || null,
    currentUrl: tab.pendingUrl || tab.url || url || null,
    createdByExtension: created,
    closableByExtension: false,
  });
  return { tab, created, closeWhenDone: false, synced: true };
}


function buildExtensionTabLaunchId(role, primaryId, retrievalId) {
  const prefix = String(retrievalId || primaryId || role || "tab").replace(/[^a-z0-9_-]/gi, "").slice(0, 64) || "tab";
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}


function buildManagedJannyCharacterUrl(characterUrl, launchId) {
  try {
    const url = new URL(characterUrl);
    url.hash = `datacat-companion=${encodeURIComponent(launchId || "")}`;
    return url.toString();
  } catch (_) {
    return characterUrl;
  }
}


function getTabUsageStorageArea() {
  return chrome.storage && chrome.storage.session ? chrome.storage.session : chrome.storage.local;
}


function persistTabUsageSnapshot() {
  const writeSnapshot = () => {
    try {
      const area = getTabUsageStorageArea();
      const snapshot = {};
      for (const [tabId, record] of extensionTabUsage.entries()) {
        snapshot[String(tabId)] = SourceVaultCore.sanitizeForTransport(record);
      }
      area.set({ [TAB_USAGE_STORAGE_KEY]: snapshot }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {}
  };
  hydrateTabUsageFromStorage().then(writeSnapshot, writeSnapshot);
}


function readTabUsageSnapshot() {
  return new Promise((resolve) => {
    try {
      const area = getTabUsageStorageArea();
      area.get({ [TAB_USAGE_STORAGE_KEY]: {} }, (result) => {
        void chrome.runtime.lastError;
        const stored = result && result[TAB_USAGE_STORAGE_KEY] && typeof result[TAB_USAGE_STORAGE_KEY] === "object"
          ? result[TAB_USAGE_STORAGE_KEY]
          : {};
        resolve(stored);
      });
    } catch (_) {
      resolve({});
    }
  });
}


function hydrateTabUsageFromStorage() {
  if (tabUsageHydrationPromise) return tabUsageHydrationPromise;
  tabUsageHydrationPromise = readTabUsageSnapshot().then((stored) => {
    for (const [tabId, record] of Object.entries(stored || {})) {
      const numericTabId = Number(tabId);
      if (
        !Number.isFinite(numericTabId) ||
        !record ||
        typeof record !== "object" ||
        forgottenExtensionTabUsage.has(numericTabId) ||
        extensionTabUsage.has(numericTabId)
      ) continue;
      extensionTabUsage.set(numericTabId, SourceVaultCore.sanitizeForTransport(record));
    }
  });
  return tabUsageHydrationPromise;
}


function rememberExtensionTabUsage(tab, meta) {
  if (!tab || !tab.id) return null;
  forgottenExtensionTabUsage.delete(Number(tab.id));
  const previous = extensionTabUsage.get(tab.id) || {};
  const now = new Date().toISOString();
  const createdByExtension = (meta && meta.createdByExtension === true) || previous.createdByExtension === true;
  const closableByExtension = createdByExtension && ((meta && meta.closableByExtension === true) || previous.closableByExtension === true);
  const record = SourceVaultCore.sanitizeForTransport({
    ...previous,
    tabId: tab.id,
    windowId: tab.windowId || null,
    role: meta && meta.role ? meta.role : previous.role || "extension_tab",
    sourceKind: meta && meta.sourceKind ? meta.sourceKind : previous.sourceKind || null,
    characterId: meta && meta.characterId ? meta.characterId : previous.characterId || null,
    creatorId: meta && meta.creatorId ? meta.creatorId : previous.creatorId || null,
    creatorKey: meta && meta.creatorKey ? meta.creatorKey : previous.creatorKey || null,
    queueItemId: meta && meta.queueItemId ? meta.queueItemId : previous.queueItemId || null,
    queueGeneration: meta && meta.queueGeneration != null ? meta.queueGeneration : previous.queueGeneration || null,
    retrievalId: meta && meta.retrievalId ? meta.retrievalId : previous.retrievalId || null,
    ownerTabId: meta && meta.ownerTabId ? meta.ownerTabId : previous.ownerTabId || null,
    launchId: meta && meta.launchId ? meta.launchId : previous.launchId || null,
    launchUrl: meta && meta.launchUrl ? meta.launchUrl : previous.launchUrl || null,
    currentUrl: (tab && tab.url) || (meta && meta.currentUrl) || previous.currentUrl || null,
    createdByExtension,
    closableByExtension,
    createdAt: previous.createdAt || now,
    updatedAt: now,
    managedBy: EXTENSION_VARIANT,
  });
  extensionTabUsage.set(tab.id, record);
  persistTabUsageSnapshot();
  return record;
}


function getExtensionTabUsage(tabId) {
  return tabId ? extensionTabUsage.get(tabId) || null : null;
}


async function getExtensionTabUsageAsync(tabId) {
  let record = getExtensionTabUsage(tabId);
  if (record) return record;
  await hydrateTabUsageFromStorage();
  record = getExtensionTabUsage(tabId);
  return record || null;
}


function forgetExtensionTabUsage(tabId) {
  if (tabId) {
    forgottenExtensionTabUsage.add(Number(tabId));
    extensionTabUsage.delete(tabId);
    persistTabUsageSnapshot();
  }
}


async function closeExtensionCreatedTab(tabId, reason) {
  const record = await getExtensionTabUsageAsync(tabId);
  if (!record || record.createdByExtension !== true || record.closableByExtension !== true) {
    return { ok: false, skipped: true, reason: "tab_not_extension_closable", tabId };
  }
  const closed = await tabsRemove(tabId);
  if (!closed) {
    return { ok: false, skipped: false, reason: "tab_close_failed", tabId };
  }
  forgetExtensionTabUsage(tabId);
  return { ok: true, closed: true, reason: reason || "extension_cleanup", tabId };
}


async function createManagedJannyCharacterTab(characterId, characterUrl, context = {}) {
  const launchId = buildExtensionTabLaunchId("janny_recovery", characterId, context.retrievalId);
  const launchUrl = buildManagedJannyCharacterUrl(characterUrl, launchId);
  const createProperties = { url: launchUrl, active: true };
  if (context.ownerTabId) {
    const ownerTab = await tabsGet(context.ownerTabId).catch(() => null);
    if (ownerTab && ownerTab.windowId != null) createProperties.windowId = ownerTab.windowId;
    if (ownerTab && ownerTab.id != null) createProperties.openerTabId = ownerTab.id;
  }
  let tab = null;
  try {
    tab = await tabsCreate(createProperties);
  } catch (error) {
    if (!createProperties.openerTabId && createProperties.windowId == null) throw error;
    tab = await tabsCreate({ url: launchUrl, active: true });
  }
  const ownerUsage = context.ownerTabId ? await getExtensionTabUsageAsync(context.ownerTabId) : null;
  const record = rememberExtensionTabUsage(tab, {
    role: ownerUsage && ownerUsage.role === "queue_worker" ? "queue_janny" : "janny_recovery",
    characterId,
    retrievalId: context.retrievalId || null,
    ownerTabId: context.ownerTabId || null,
    queueItemId: ownerUsage && ownerUsage.queueItemId ? ownerUsage.queueItemId : null,
    queueGeneration: ownerUsage && ownerUsage.queueGeneration != null ? ownerUsage.queueGeneration : null,
    launchId,
    launchUrl,
    createdByExtension: true,
    closableByExtension: true,
  });
  return { tab, created: true, managed: true, launchId, launchUrl, record };
}


async function sendContentMessageWithInjection(tabId, message, options = {}) {
  const attempts = Math.max(1, Number(options.attempts) || 3);
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await injectContentScriptIntoTab(tabId);
      await sleep(attempt === 0 ? 250 : 650);
      return await tabsSendMessage(tabId, message);
    } catch (error) {
      lastError = error;
      if (!isMissingContentReceiverError(error) && !String(error && error.message || "").includes("content_script_injection_failed")) break;
      await sleep(500 + attempt * 500);
    }
  }
  throw lastError || new Error("content_message_failed");
}


async function readSourceTabState(tabId, options = {}) {
  const stateResponse = await sendContentMessageWithInjection(tabId, {
    type: MessageTypes.SV_REFRESH_STATE,
    force: true,
    forceAuth: options.forceAuth !== false,
  });
  if (!stateResponse || stateResponse.ok === false || !stateResponse.state) {
    throw new Error(stateResponse && stateResponse.error ? stateResponse.error : "content_state_unavailable");
  }
  return SourceVaultCore.sanitizeForTransport(stateResponse.state || {});
}
