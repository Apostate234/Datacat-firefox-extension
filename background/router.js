"use strict";
// background/router.js — onMessage / onMessageExternal request routing
// Extracted from background.js in Phase 2 (mechanical move; behavior unchanged).
// Loaded in MV3 service-worker global scope via importScripts from background/index.js.
// Depends (global scope) on: all background modules (registers chrome.runtime.onMessage / onMessageExternal)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const validation = SourceVaultMessages.assertMessageShape(message.type, message);
  if (!validation.ok) {
    sendResponse({ ok: false, error: validation.error });
    return false;
  }

  if (message.type === MessageTypes.SV2_RUNTIME_PING) {
    const manifest = chrome.runtime.getManifest();
    sendResponse({ ok: true, version: manifest && manifest.version || null });
    return false;
  }

  if (message.type === MessageTypes.SV_TAB_STATE) {
    const tabId = sender && sender.tab && sender.tab.id;
    if (tabId) {
      const state = SourceVaultCore.sanitizeForTransport(message.state || {});
      tabStates.set(tabId, state);
      debugBroadcast("tab_state_received", {
        tabId,
        state: summarizeStateForDebug(state),
      });
      const page = state.page && typeof state.page === "object" ? state.page : {};
      const character = state.character && typeof state.character === "object" ? state.character : {};
      const existingUsage = getExtensionTabUsage(tabId);
      rememberExtensionTabUsage(sender.tab, {
        role: existingUsage && existingUsage.role ? existingUsage.role : page.isCharacterPage ? "source_character_observed" : "source_site_observed",
        sourceKind: getStateSourceKind(state),
        characterId: SourceVaultCore.normalizeUuid(
          character.id ||
            character.characterId ||
            character.companionId ||
            page.characterId ||
            page.companionId,
        ),
        currentUrl: (sender.tab && sender.tab.url) || page.url || null,
        launchUrl: page.url || (sender.tab && sender.tab.url) || null,
        createdByExtension: false,
        closableByExtension: false,
      });
      if (existingUsage && isQueueManagedUsage(existingUsage)) {
        handleQueueTabState(tabId, state).catch((error) => {
          console.warn("[SourceVaultV2] Queue tab state update failed:", normalizeError(error));
        });
      } else {
        broadcast({
          type: MessageTypes.SV_TAB_STATE_UPDATED,
          tabId,
          windowId: sender && sender.tab ? sender.tab.windowId : null,
          state,
          stateRevision: Number(state.revision || 0),
          navigationId: Number(page.navigationId || 0),
          eventRevision: nextSidebarEventRevision(),
        });
      }
      const creatorPhase = getCreatorLoadPhaseFromState(state);
      if (creatorPhase) {
        broadcastCreatorLoadPhase(creatorPhase.request, creatorPhase.phase, creatorPhase.message);
      }
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === MessageTypes.SV_GET_ACTIVE_TAB_STATE) {
    getActiveContentState({
      force: message.force === true,
      forceAuth: message.forceAuth === true,
      tabId: message.tabId || null,
      windowId: message.windowId || null,
    }, sendResponse);
    return true;
  }

  if (message.type === MessageTypes.SV_REFRESH_ACTIVE_TAB) {
    if (message.tabId) {
      tabsGet(Number(message.tabId)).then((tab) => {
        sendMessageToContentTab(tab, {
          type: MessageTypes.SV_REFRESH_STATE,
          force: message.force === true,
          forceAuth: message.forceAuth === true,
        }, { injectOnMissing: true }, sendResponse);
      }, (error) => sendResponse({ ok: false, error: normalizeError(error) }));
      return true;
    }
    sendToActiveContent({
      type: MessageTypes.SV_REFRESH_STATE,
      force: message.force === true,
      forceAuth: message.forceAuth === true,
    }, sendResponse);
    return true;
  }

  if (message.type === MessageTypes.SV2_NAVIGATE_ACTIVE_SOURCE_PAGE) {
    debugBroadcast("navigate_active_source_page_message", { url: message.url || null });
    navigateActiveSourcePage(message.url, { tabId: message.tabId || null, windowId: message.windowId || null }).then(
      (result) => {
        debugBroadcast("navigate_active_source_page_message_ok", result);
        sendResponse(result);
      },
      (error) => {
        const normalized = normalizeError(error);
        debugBroadcast("navigate_active_source_page_message_error", {
          url: message.url || null,
          error: normalized,
        });
        sendResponse({ ok: false, error: normalized });
      },
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_QUEUE_GET_STATE) {
    readRetrievalQueueState().then(
      (state) => sendResponse({ ok: true, queue: buildRetrievalQueueProjection(state) }),
      (error) => sendResponse({ ok: false, error: normalizeError(error), queue: null }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_QUEUE_ADD_ITEMS) {
    addRetrievalQueueItems(message.items || message.urls || [], message.options || {}).then(
      (result) => sendResponse(result),
      (error) => sendResponse({ ok: false, error: normalizeError(error) }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_QUEUE_START) {
    startRetrievalQueue().then(
      (state) => sendResponse({ ok: true, queue: buildRetrievalQueueProjection(state) }),
      (error) => sendResponse({ ok: false, error: normalizeError(error) }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_QUEUE_STOP) {
    stopRetrievalQueue().then(
      (state) => sendResponse({ ok: true, queue: buildRetrievalQueueProjection(state) }),
      (error) => sendResponse({ ok: false, error: normalizeError(error) }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_QUEUE_PAUSE) {
    mutateRetrievalQueue((state) => {
      if (state.activeItemId) {
        return SourceVaultQueue.touchState(state, { status: "pausing", pauseAfterCurrent: true, blockedReason: null });
      }
      return SourceVaultQueue.touchState(state, { status: "paused", pauseAfterCurrent: false, blockedReason: null });
    }).then(
      (state) => sendResponse({ ok: true, queue: buildRetrievalQueueProjection(state) }),
      (error) => sendResponse({ ok: false, error: normalizeError(error) }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_QUEUE_RESUME) {
    mutateRetrievalQueue((state) => {
      let next = state;
      for (const item of state.items) {
        if (item.state === "interrupted") {
          next = SourceVaultQueue.updateItem(next, item.queueItemId, {
            state: "pending",
            phase: "queued",
            message: "Waiting in queue.",
            error: null,
            workerWindowId: null,
            workerTabId: null,
          });
        }
      }
      return SourceVaultQueue.touchState(next, {
        status: "running",
        activeItemId: null,
        pauseAfterCurrent: false,
        blockedReason: null,
      });
    }).then(
      (state) => {
        scheduleRetrievalQueueRun(0);
        sendResponse({ ok: true, queue: buildRetrievalQueueProjection(state) });
      },
      (error) => sendResponse({ ok: false, error: normalizeError(error) }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_QUEUE_MOVE_NEXT) {
    mutateRetrievalQueue((state) => SourceVaultQueue.moveNext(state, message.queueItemId)).then(
      (state) => sendResponse({ ok: true, queue: buildRetrievalQueueProjection(state) }),
      (error) => sendResponse({ ok: false, error: normalizeError(error) }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_QUEUE_REMOVE_ITEM) {
    removeRetrievalQueueItem(message.queueItemId || null, message.queueKey || null).then(
      (result) => sendResponse({
        ok: true,
        removed: result.removed ? SourceVaultCore.sanitizeForTransport(result.removed) : null,
        queue: buildRetrievalQueueProjection(result.state),
      }),
      (error) => sendResponse({ ok: false, error: normalizeError(error) }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_QUEUE_RETRY_ITEM) {
    readRetrievalQueueState().then(async (state) => {
      const item = getQueueItemById(state, message.queueItemId);
      if (!item) throw new Error("queue_item_not_found");
      return addRetrievalQueueItems([{ ...item, queueItemId: null, state: "pending", origin: "retry", forceRetrieve: true }], {
        visibility: item.visibility,
        forceRetrieve: true,
      });
    }).then(
      (result) => sendResponse(result),
      (error) => sendResponse({ ok: false, error: normalizeError(error) }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_QUEUE_CLEAR_FINISHED) {
    mutateRetrievalQueue((state) => SourceVaultQueue.clearFinished(state)).then(
      (state) => sendResponse({ ok: true, queue: buildRetrievalQueueProjection(state) }),
      (error) => sendResponse({ ok: false, error: normalizeError(error) }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_QUEUE_CLEAR_ALL) {
    clearRetrievalQueue().then(
      (state) => sendResponse({ ok: true, queue: buildRetrievalQueueProjection(state) }),
      (error) => sendResponse({ ok: false, error: normalizeError(error) }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV_START_ACTIVE_TAB_RETRIEVAL) {
    enqueueActiveCharacterTab(message).then(
      (result) => sendResponse(result),
      (error) => sendResponse({ ok: false, error: normalizeError(error), accountApproval: error && error.accountApproval || null }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV_GET_ACTIVE_TAB_CAPTURE) {
    sendToActiveContent({ type: MessageTypes.SV_GET_CAPTURE }, sendResponse);
    return true;
  }

  if (message.type === MessageTypes.SV_SAVE_RETRIEVED_CHARACTER) {
    (async () => {
      const senderTabId = sender && sender.tab && sender.tab.id ? sender.tab.id : null;
      const queueSaveContext = senderTabId ? await handleQueueSaveStarted(senderTabId, message) : null;
      const queueItemId = queueSaveContext && queueSaveContext.queueItemId || null;
      try {
        const record = await saveRetrievedCharacter(message.capture, message.uploadOptions || null);
        await handleQueueSaveFinished(queueSaveContext, record);
        sendResponse({ ok: true, item: record, queueItemId });
      } catch (error) {
        if (queueItemId) await failQueueItem(queueItemId, error, { queueRunToken: queueSaveContext.queueRunToken || null });
        sendResponse({ ok: false, error: normalizeError(error), queueItemId });
      }
    })();
    return true;
  }

  if (message.type === MessageTypes.SV_GET_RETRIEVED_CHARACTERS) {
    readRetrievedStore().then(
      (store) => sendResponse({ ok: true, list: listRetrievedCharactersFromStore(store) }),
      (error) => sendResponse({ ok: false, error: normalizeError(error), list: [] }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV_GET_RETRIEVED_CHARACTER) {
    readRetrievedStore().then(
      (store) => {
        const id = SourceVaultCore.normalizeUuid(message.characterId);
        const entry = id ? findRetrievedStoreEntry(store, id, message.sourceKind || null) : null;
        sendResponse({ ok: true, item: entry ? entry.record : null });
      },
      (error) => sendResponse({ ok: false, error: normalizeError(error), item: null }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_OPEN_CREATOR_VIEW) {
    getOrRetrieveCreatorRecord(message.creator || message, {
      force: message.force === true,
      syncActiveTab: message.syncActiveTab === true,
      activeTabId: message.activeTabId || message.tabId || null,
    }).then(
      (result) => sendResponse(result),
      (error) => sendResponse({
        ok: false,
        error: normalizeError(error),
        accountApproval: error && error.accountApproval ? error.accountApproval : null,
      }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_GET_CREATOR_RECORD) {
    (async () => {
      const store = await readCreatorStore();
      const request = normalizeCreatorRequest(message.creator || message);
      const record = request.key && store[request.key] ? store[request.key] : null;
      return { ok: true, record, freshness: getCreatorRecordFreshness(record) };
    })().then(
      (result) => sendResponse(result),
      (error) => sendResponse({ ok: false, error: normalizeError(error), record: null }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_RETRIEVE_CREATOR_CHARACTER) {
    startCharacterRetrievalFromCreator(message.character || message, {
      syncActiveTab: message.syncActiveTab === true,
      activeTabId: message.activeTabId || message.tabId || null,
      uploadOptions: message.uploadOptions || null,
    }).then(
      (result) => sendResponse(result),
      (error) => sendResponse({
        ok: false,
        error: normalizeError(error),
        accountApproval: error && error.accountApproval ? error.accountApproval : null,
      }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV_RETRIEVE_JANNY) {
    if (sender && sender.tab && sender.tab.id) {
      const state = tabStates.get(sender.tab.id) || {};
      const page = state.page && typeof state.page === "object" ? state.page : {};
      const character = state.character && typeof state.character === "object" ? state.character : {};
      const existingUsage = getExtensionTabUsage(sender.tab.id);
      rememberExtensionTabUsage(sender.tab, {
        role: existingUsage && existingUsage.role === "queue_worker" ? "queue_worker" : "source_character_active",
        sourceKind: getStateSourceKind(state) || "janitor",
        characterId: SourceVaultCore.normalizeUuid(
          message.characterId ||
            character.id ||
            character.characterId ||
            page.characterId,
        ),
        retrievalId: message.retrievalId || null,
        queueItemId: existingUsage && existingUsage.queueItemId ? existingUsage.queueItemId : null,
        queueGeneration: existingUsage && existingUsage.queueGeneration != null ? existingUsage.queueGeneration : null,
        currentUrl: sender.tab.url || page.url || null,
        launchUrl: page.url || sender.tab.url || null,
        createdByExtension: false,
        closableByExtension: false,
      });
    }
    retrieveJannyCharacter(message.characterId, {
      retrievalId: message.retrievalId || null,
      ownerTabId: sender && sender.tab && sender.tab.id ? sender.tab.id : null,
      jobStartedAt: message.jobStartedAt || null,
    }).then(
      (result) => sendResponse(result),
      (error) => sendResponse({ success: false, error: normalizeError(error) }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV_OPEN_JANNY_RECOVERY_TAB) {
    const job = resolveJannyRecoveryJob(message.jobId);
    if (!job || !job.jannyTabId) {
      sendResponse({ ok: false, error: "janny_recovery_job_not_found" });
      return false;
    }
    captureJannyReturnFocusTarget(job.ownerTabId, job.jannyTabId).then((target) => {
      if (target) {
        job.returnFocusTabId = target.tabId || null;
        job.returnFocusWindowId = target.windowId || null;
      }
      return focusTabById(job.jannyTabId);
    }).then(
      () => sendResponse({ ok: true, job: getJannyRecoveryJobSnapshot(job) }),
      (error) => sendResponse({ ok: false, error: normalizeError(error) }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV_SKIP_JANNY_RECOVERY_NOW) {
    const job = resolveJannyRecoveryJob(message.jobId);
    if (!job) {
      sendResponse({ ok: false, error: "janny_recovery_job_not_found" });
      return false;
    }
    job.skipRequested = true;
    notifyJannyRecoveryJob(job, {
      status: "timed_out",
      message: "Janny recovery skip requested.",
      lastError: "janny_recovery_skipped_by_user",
    });
    sendResponse({ ok: true, job: getJannyRecoveryJobSnapshot(job) });
    return false;
  }

  if (message.type === MessageTypes.SV2_GET_DATACAT_STATE) {
    readDatacatState().then(
      (state) => sendResponse({ ok: true, state }),
      (error) => sendResponse({ ok: false, error: normalizeError(error), state: null }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_GET_SOURCE_ACCOUNT_APPROVALS) {
    readSourceAccountApprovals().then(
      (approvals) => sendResponse({ ok: true, approvals }),
      (error) => sendResponse({ ok: false, error: normalizeError(error), approvals: {} }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_GET_SOURCE_ACCOUNT_SESSION_STATUS) {
    getSourceAccountSessionStatus(sendResponse);
    return true;
  }

  if (message.type === MessageTypes.SV2_GET_EXTRACTION_PERSONA_ALIAS) {
    resolveExtractionPersonaAlias(message).then(
      (result) => sendResponse({ ok: true, alias: result.alias, sourceKind: result.sourceKind }),
      (error) => sendResponse({ ok: false, error: normalizeError(error) }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_SET_SOURCE_ACCOUNT_APPROVAL) {
    writeSourceAccountApproval(message).then(
      (approval) => sendResponse({ ok: true, approval }),
      (error) => sendResponse({ ok: false, error: normalizeError(error) }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_SET_DATACAT_ORIGIN) {
    setDatacatOrigin(message.origin).then(
      (result) => sendResponse({ ok: true, state: result.state }),
      (error) => sendResponse({ ok: false, error: normalizeError(error) }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_OPEN_DATACAT_LOGIN) {
    readDatacatConfig()
      .then((config) => beginDatacatBridge(config.origin))
      .then(
      (bridge) => {
        const url = bridge.url;
        chrome.tabs.create({ url }, () => sendResponse({ ok: true, url }));
      },
      (error) => sendResponse({ ok: false, error: normalizeError(error) }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_UNLINK_DATACAT) {
    unlinkDatacat().then(
      (state) => sendResponse({ ok: true, state }),
      (error) => sendResponse({ ok: false, error: normalizeError(error) }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_RETRY_UPLOAD) {
    readRetrievedStore().then(
      (store) => {
        const id = SourceVaultCore.normalizeUuid(message.characterId);
        const entry = id ? findRetrievedStoreEntry(store, id, message.sourceKind || null) : null;
        const record = entry ? entry.record : null;
        if (!record) {
          sendResponse({ ok: false, error: "retrieved_character_not_found" });
          return;
        }
        uploadRetrievedCharacter(record, "manual", {
          ...(message.options && typeof message.options === "object" ? message.options : {}),
          forceRetrieve: message.forceRetrieve === true || (message.options && message.options.forceRetrieve === true),
          visibility:
            (message.options && message.options.visibility) ||
            (record.uploadOptions && record.uploadOptions.visibility) ||
            DEFAULT_UPLOAD_VISIBILITY,
        }).then(
          (result) => sendResponse({ ok: true, result }),
          (error) => sendResponse({ ok: false, error: normalizeError(error) }),
        );
      },
      (error) => sendResponse({ ok: false, error: normalizeError(error) }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_GET_UPLOAD_SETTINGS) {
    readWindowUploadVisibility(message.windowId).then(
      (settings) => sendResponse({ ok: true, settings }),
      (error) => sendResponse({ ok: false, error: normalizeError(error), settings: null }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_SET_UPLOAD_VISIBILITY) {
    writeWindowUploadVisibility(message.windowId, message.visibility).then(
      (settings) => sendResponse({ ok: true, settings }),
      (error) => sendResponse({ ok: false, error: normalizeError(error), settings: null }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_SET_JOB_TIMEOUT) {
    writeUploadSettings({ jobTimeoutMinutes: message.minutes }).then(
      (settings) => sendResponse({ ok: true, settings }),
      (error) => sendResponse({ ok: false, error: normalizeError(error), settings: null }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_CACHE_THUMBNAILS) {
    cacheThumbnailRefs(message.refs || message.ref || [], { force: message.force === true }).then(
      (result) => sendResponse(result),
      (error) => sendResponse({ ok: false, error: normalizeError(error), entries: {}, errors: {} }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_GET_THUMBNAILS) {
    (async () => {
      const refs = (Array.isArray(message.refs) ? message.refs : [message.ref]).map(normalizeThumbnailRef).filter(Boolean);
      const cache = await readThumbnailCache();
      const entries = {};
      for (const ref of refs) {
        if (cache[ref.cacheKey]) entries[ref.cacheKey] = cache[ref.cacheKey];
      }
      return { ok: true, entries };
    })().then(
      (result) => sendResponse(result),
      (error) => sendResponse({ ok: false, error: normalizeError(error), entries: {} }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_GET_STORAGE_STATS) {
    getExtensionStorageStats().then(
      (stats) => sendResponse({ ok: true, stats }),
      (error) => sendResponse({ ok: false, error: normalizeError(error), stats: null }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_CLEAR_ALL_EXTENSION_STORAGE) {
    clearAllExtensionStorage().then(
      (stats) => sendResponse({ ok: true, stats }),
      (error) => sendResponse({ ok: false, error: normalizeError(error), stats: null }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_PREFLIGHT_CHARACTER) {
    requestSourceVaultPreflight(message.body || message.character || {}).then(
      (result) => sendResponse(result),
      (error) => sendResponse({ ok: false, error: normalizeError(error), preflight: null }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_GET_SOURCE_ANNOUNCEMENTS) {
    getSourceAnnouncements(message.sourceKind, { force: message.force === true }).then(
      (result) => sendResponse(result),
      (error) => sendResponse({ ok: false, error: normalizeError(error), announcement: null, announcements: [] }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_GET_EXTENSION_VERSION_STATUS) {
    getExtensionVersionStatus({ force: message.force === true }).then(
      (status) => sendResponse({ ok: true, status }),
      (error) => sendResponse({ ok: false, error: normalizeError(error), status: null }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_RECORD_COMPANION_ACTIVITY) {
    recordCompanionActivity(message.activity || {}).then(
      (result) => sendResponse(result),
      () => sendResponse({ ok: true, skipped: true }),
    );
    return true;
  }

  if (message.type === MessageTypes.SV2_DISMISS_SOURCE_ANNOUNCEMENT) {
    dismissSourceAnnouncement(message.sourceKind, message.dismissKey).then(
      (result) => sendResponse(result),
      (error) => sendResponse({ ok: false, error: normalizeError(error) }),
    );
    return true;
  }

  return false;
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  if (message.type !== MessageTypes.SOURCE_VAULT_V2_DATACAT_SESSION) return false;

  (async () => {
    const validation = SourceVaultMessages.assertMessageShape(message.type, message);
    if (!validation.ok) throw new Error(validation.error);
    const bridge = await validateAndConsumeDatacatBridge(message, sender);
    const sessionToken = typeof message.sessionToken === "string" ? message.sessionToken.trim() : "";
    if (!sessionToken) throw new Error("missing_session_token");
    const config = await writeDatacatConfig({
      origin: bridge.origin,
      sessionToken,
      user: message.user && typeof message.user === "object" ? message.user : null,
      linkedAt: new Date().toISOString(),
      lastCheckedAt: null,
      lastVerifiedAt: null,
    });
    const state = await readDatacatState();
    broadcast({ type: MessageTypes.SV2_DATACAT_STATE_UPDATED, state });
    sendResponse({ ok: true, origin: config.origin, state });
  })().catch((error) => {
    sendResponse({ ok: false, error: normalizeError(error) });
  });
  return true;
});
