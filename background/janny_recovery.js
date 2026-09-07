"use strict";
// background/janny_recovery.js — Janny managed-tab capture + source-page continuation
// Extracted from background.js in Phase 2 (mechanical move; behavior unchanged).
// Loaded in MV3 service-worker global scope via importScripts from background/index.js.
// Depends (global scope) on: constants.js, chrome_adapters.js, broadcasts.js, tab_state.js, retrieved_store.js

const jannyRecoveryJobs = new Map();

async function captureJannyFromTab(tabId, characterId) {
  const managedRecord = await getExtensionTabUsageAsync(tabId);
  await injectContentScriptIntoTab(tabId);
  await sleep(150);
  const response = await tabsSendMessage(tabId, {
    type: MessageTypes.SV_CAPTURE_JANNY_PAGE,
    characterId,
  });
  if (response && response.capture) {
    return SourceVaultCore.sanitizeForTransport({
      ...response.capture,
      tabManaged: !!managedRecord,
      tabLaunchId: managedRecord ? managedRecord.launchId : null,
      tabRetrievalId: managedRecord ? managedRecord.retrievalId : null,
    });
  }
  if (response && response.ok === false) {
    return {
      success: false,
      source: "janny_extension_tab",
      characterId,
      characterUrl: `https://jannyai.com/characters/${characterId}`,
      error: response.error || "janny_tab_capture_failed",
      tabManaged: !!managedRecord,
      tabLaunchId: managedRecord ? managedRecord.launchId : null,
      tabRetrievalId: managedRecord ? managedRecord.retrievalId : null,
    };
  }
  return SourceVaultCore.sanitizeForTransport({
    ...(response && typeof response === "object" ? response : {}),
    success: false,
    source: "janny_extension_tab",
    characterId,
    characterUrl: `https://jannyai.com/characters/${characterId}`,
    error: response && response.error ? response.error : "empty_janny_tab_capture",
    tabManaged: !!managedRecord,
    tabLaunchId: managedRecord ? managedRecord.launchId : null,
    tabRetrievalId: managedRecord ? managedRecord.retrievalId : null,
  });
}


function shouldRetryJannyTabCapture(capture) {
  if (!capture || capture.success === true) return false;
  if (isTerminalJannyFailureCapture(capture)) return false;
  if (isJannyPageInterruption(capture)) return false;
  const error = String(capture.error || "").toLowerCase();
  return (
    capture.hasDetail === false ||
    error === "janny_detail_not_ready" ||
    error.includes("receiving end does not exist") ||
    error.includes("could not establish connection")
  );
}


function isJannyPageInterruption(capture) {
  if (!capture || capture.success === true) return false;
  const error = String(capture.error || "").toLowerCase();
  return capture.interruptionDetected === true || error === "source_page_action_required";
}


function isTerminalJannyFailureCapture(capture) {
  if (!capture || capture.success === true) return false;
  const error = String(capture.error || "").toLowerCase();
  return capture.notFound === true || error === "janny_character_not_found" || Number(capture.status) === 404;
}


function buildTerminalJannyFailureResult(capture, tab, characterId, characterUrl, fields = {}) {
  const root = capture && typeof capture === "object" ? capture : {};
  const error = String(root.error || fields.error || "janny_recovery_failed");
  return SourceVaultCore.sanitizeForTransport({
    ...root,
    ...fields,
    success: false,
    source: root.source || "janny_extension_tab",
    characterId,
    characterUrl,
    status: root.status || fields.status || (error === "janny_character_not_found" ? 404 : "failed"),
    finalUrl: root.finalUrl || (tab && tab.url) || characterUrl,
    tabId: tab && tab.id ? tab.id : root.tabId || null,
    error,
    userMessage: root.userMessage || fields.userMessage || "Janny recovery failed.",
  });
}


async function focusManagedSourceTab(tab) {
  if (!tab || !tab.id) return null;
  const focusedTab = await tabsUpdate(tab.id, { active: true }).catch(() => null);
  const windowId = focusedTab && focusedTab.windowId != null ? focusedTab.windowId : tab.windowId;
  if (windowId != null) await windowsUpdate(windowId, { focused: true });
  return focusedTab || tab;
}


async function focusTabById(tabId) {
  if (!tabId) return null;
  const tab = await tabsGet(tabId).catch(() => null);
  if (!tab || !tab.id) return null;
  const focusedTab = await tabsUpdate(tab.id, { active: true }).catch(() => null);
  const windowId = focusedTab && focusedTab.windowId != null ? focusedTab.windowId : tab.windowId;
  if (windowId != null) await windowsUpdate(windowId, { focused: true });
  return focusedTab || tab;
}

function isExtensionManagedFocusUsage(usage) {
  return !!(usage && usage.createdByExtension === true && usage.closableByExtension === true);
}

async function getLastFocusedActiveTab() {
  const tabs = await tabsQuery({ active: true, lastFocusedWindow: true }).catch(() => []);
  return tabs[0] || null;
}

async function captureJannyReturnFocusTarget(ownerTabId, jannyTabId) {
  const activeTab = await getLastFocusedActiveTab();
  if (activeTab && activeTab.id && Number(activeTab.id) !== Number(jannyTabId)) {
    const usage = await getExtensionTabUsageAsync(activeTab.id).catch(() => null);
    if (!isExtensionManagedFocusUsage(usage)) {
      return { tabId: activeTab.id, windowId: activeTab.windowId || null };
    }
  }
  const ownerTab = ownerTabId ? await tabsGet(ownerTabId).catch(() => null) : null;
  if (!ownerTab || !ownerTab.id || Number(ownerTab.id) === Number(jannyTabId)) return null;
  const ownerUsage = await getExtensionTabUsageAsync(ownerTab.id).catch(() => null);
  if (isExtensionManagedFocusUsage(ownerUsage)) return null;
  return { tabId: ownerTab.id, windowId: ownerTab.windowId || null };
}

async function restoreJannyReturnFocus(job) {
  const targetTabId = Number(job && job.returnFocusTabId || 0);
  if (!targetTabId) return { restored: false, reason: "return_target_unavailable" };

  const lastFocusedWindow = await windowsGetLastFocused().catch(() => null);
  if (lastFocusedWindow && lastFocusedWindow.focused === false) {
    return { restored: false, reason: "chrome_not_focused" };
  }

  const currentTab = await getLastFocusedActiveTab();
  if (currentTab && currentTab.id) {
    const currentUsage = await getExtensionTabUsageAsync(currentTab.id).catch(() => null);
    const extensionStillOwnsFocus =
      Number(currentTab.id) === Number(job && job.jannyTabId) ||
      Number(currentTab.id) === Number(job && job.ownerTabId) ||
      isExtensionManagedFocusUsage(currentUsage);
    if (!extensionStillOwnsFocus && Number(currentTab.id) !== targetTabId) {
      return { restored: false, reason: "user_changed_focus" };
    }
  }

  const targetTab = await tabsGet(targetTabId).catch(() => null);
  if (!targetTab || !targetTab.id) return { restored: false, reason: "return_tab_closed" };
  const targetUsage = await getExtensionTabUsageAsync(targetTab.id).catch(() => null);
  if (isExtensionManagedFocusUsage(targetUsage)) return { restored: false, reason: "return_target_managed" };
  const focusedTab = await tabsUpdate(targetTab.id, { active: true }).catch(() => null);
  const windowId = focusedTab && focusedTab.windowId != null
    ? focusedTab.windowId
    : targetTab.windowId != null
      ? targetTab.windowId
      : job && job.returnFocusWindowId;
  if (windowId != null) await windowsUpdate(windowId, { focused: true });
  return { restored: true, tabId: targetTab.id, windowId };
}

async function closeManagedSourceTabAndRestoreFocus(job, reason) {
  if (job && job.createdJannyTab === true && job.jannyTabId) {
    await closeExtensionCreatedTab(job.jannyTabId, reason).catch(() => null);
  }
  return restoreJannyReturnFocus(job);
}


function buildJannyRecoveryJob(input) {
  const root = input && typeof input === "object" ? input : {};
  const startedAtMs = Date.now();
  const expiresAtMs = Math.max(
    startedAtMs,
    Date.parse(root.expiresAt || "") || startedAtMs,
  );
  const waitMs = Math.max(0, expiresAtMs - startedAtMs);
  const job = {
    jobId: root.jobId || `janny-${startedAtMs}-${Math.random().toString(16).slice(2)}`,
    retrievalId: root.retrievalId || null,
    characterId: root.characterId || null,
    ownerTabId: root.ownerTabId || null,
    jannyTabId: root.jannyTabId || null,
    createdJannyTab: root.createdJannyTab === true,
    tabManaged: root.tabManaged === true,
    tabLaunchId: root.tabLaunchId || null,
    tabLaunchUrl: root.tabLaunchUrl || null,
    status: root.status || "waiting_user_action",
    startedAt: new Date(startedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    waitMs,
    remainingMs: waitMs,
    lastError: root.lastError || null,
    finalUrl: root.finalUrl || null,
    returnFocusTabId: root.returnFocusTabId || null,
    returnFocusWindowId: root.returnFocusWindowId || null,
    skipRequested: false,
  };
  jannyRecoveryJobs.set(job.jobId, job);
  return job;
}


function getJannyRecoveryJobSnapshot(job, patch) {
  const root = job && typeof job === "object" ? job : {};
  const merged = { ...root, ...(patch || {}) };
  const expiresAtMs = Date.parse(merged.expiresAt || "") || 0;
  const remainingMs = expiresAtMs ? Math.max(0, expiresAtMs - Date.now()) : 0;
  return SourceVaultCore.sanitizeForTransport({
    ...merged,
    remainingMs,
    remainingSeconds: Math.ceil(remainingMs / 1000),
  });
}


function notifyJannyRecoveryJob(job, patch) {
  if (!job || !job.jobId) return null;
  Object.assign(job, patch || {});
  if (jannyRecoveryJobs.has(job.jobId)) jannyRecoveryJobs.set(job.jobId, job);
  const snapshot = getJannyRecoveryJobSnapshot(job);
  broadcast({ type: MessageTypes.SV_JANNY_RECOVERY_JOB_UPDATED, job: snapshot });
  tabsSendMessageNoThrow(job.ownerTabId, { type: MessageTypes.SV_JANNY_RECOVERY_JOB_UPDATED, job: snapshot });
  tabsSendMessageNoThrow(job.jannyTabId, { type: MessageTypes.SV_JANNY_RECOVERY_JOB_UPDATED, job: snapshot });
  return snapshot;
}


function notifyJannyCaptureProgress(input, patch) {
  const root = input && typeof input === "object" ? input : {};
  if (!root.ownerTabId) return null;
  const snapshot = SourceVaultCore.sanitizeForTransport({
    jobId: root.jobId || `janny-capture-${root.retrievalId || root.characterId || Date.now()}`,
    retrievalId: root.retrievalId || null,
    characterId: root.characterId || null,
    ownerTabId: root.ownerTabId || null,
    jannyTabId: root.jannyTabId || null,
    createdJannyTab: root.createdJannyTab === true,
    tabManaged: root.tabManaged === true,
    tabLaunchId: root.tabLaunchId || null,
    tabLaunchUrl: root.tabLaunchUrl || null,
    status: "pending",
    message: "Reading Janny page.",
    ...(patch || {}),
  });
  tabsSendMessageNoThrow(root.ownerTabId, { type: MessageTypes.SV_JANNY_RECOVERY_JOB_UPDATED, job: snapshot });
  return snapshot;
}


function resolveJannyRecoveryJob(jobId) {
  const key = String(jobId || "").trim();
  if (key && jannyRecoveryJobs.has(key)) return jannyRecoveryJobs.get(key);
  let newest = null;
  for (const job of jannyRecoveryJobs.values()) {
    if (!newest || Date.parse(job.startedAt || "") > Date.parse(newest.startedAt || "")) newest = job;
  }
  return newest;
}


async function settlePotentialSourceInterruption(tab, characterId, characterUrl, initialCapture, jobDeadlineAtMs) {
  let capture = initialCapture || null;
  let interruptionCount = isJannyPageInterruption(capture) ? 1 : 0;
  const settleDeadline = Math.min(
    Number(jobDeadlineAtMs) || Number.MAX_SAFE_INTEGER,
    Date.now() + SOURCE_PAGE_SETTLE_MS,
  );
  while (Date.now() < settleDeadline) {
    await sleep(Math.min(JANNY_TAB_CAPTURE_RETRY_MS, Math.max(0, settleDeadline - Date.now())));
    try {
      capture = await captureJannyFromTab(tab.id, characterId);
    } catch (captureError) {
      capture = {
        success: false,
        source: "janny_extension_tab",
        characterId,
        characterUrl,
        error: normalizeError(captureError),
      };
    }
    if (capture && capture.success === true) {
      return { persistentInterruption: false, capture };
    }
    if (isJannyPageInterruption(capture)) {
      interruptionCount += 1;
      if (interruptionCount >= SOURCE_PAGE_CONFIRMATION_COUNT) {
        return { persistentInterruption: true, capture };
      }
      continue;
    }
    if (shouldRetryJannyTabCapture(capture)) continue;
    return { persistentInterruption: false, capture };
  }
  return {
    persistentInterruption:
      interruptionCount >= SOURCE_PAGE_CONFIRMATION_COUNT &&
      isJannyPageInterruption(capture),
    capture,
  };
}


async function retrieveJannyCharacter(characterId, options) {
  const opts = options && typeof options === "object" ? options : {};
  const id = SourceVaultCore.normalizeUuid(characterId);
  if (!id) {
    return { success: false, error: "invalid_character_id", characterId: null };
  }
  const timeoutMs = await readJobTimeoutMs().catch(() => DEFAULT_JOB_TIMEOUT_MINUTES * 60 * 1000);
  const jobStartedAtMs = Date.parse(opts.jobStartedAt || "") || Date.now();
  const jobDeadlineAtMs = jobStartedAtMs + timeoutMs;
  if (Date.now() >= jobDeadlineAtMs) {
    return {
      success: false,
      status: "timed_out",
      timedOut: true,
      error: "job_timeout",
      userMessage: "Retrieval exceeded the configured job timeout.",
      characterId: id,
    };
  }
  const characterUrl = `https://jannyai.com/characters/${id}`;
  let tab = null;
  let created = false;
  let tabLaunchId = null;
  let tabLaunchUrl = null;
  let lastCapture = null;
  try {
    const tabResult = await createManagedJannyCharacterTab(id, characterUrl, {
      retrievalId: opts.retrievalId || null,
      ownerTabId: opts.ownerTabId || null,
    });
    tab = tabResult.tab;
    created = tabResult.created === true;
    tabLaunchId = tabResult.launchId || null;
    tabLaunchUrl = tabResult.launchUrl || null;
    if (!tab || !tab.id) throw new Error("janny_tab_unavailable");
    await waitForTabComplete(tab.id, Math.max(1000, Math.min(15000, jobDeadlineAtMs - Date.now())));
    notifyJannyCaptureProgress({
      retrievalId: opts.retrievalId || null,
      characterId: id,
      ownerTabId: opts.ownerTabId || null,
      jannyTabId: tab.id,
      createdJannyTab: created,
      tabManaged: true,
      tabLaunchId,
      tabLaunchUrl,
    });
    do {
      try {
        lastCapture = await captureJannyFromTab(tab.id, id);
      } catch (captureError) {
        lastCapture = {
          success: false,
          source: "janny_extension_tab",
          characterId: id,
          characterUrl,
          error: normalizeError(captureError),
        };
      }
      if (lastCapture && lastCapture.success === true) {
        if (created) {
          void closeExtensionCreatedTab(tab.id, "janny_capture_finished");
        }
        return SourceVaultCore.sanitizeForTransport({
          ...lastCapture,
          source: lastCapture.source || "janny_extension_tab",
          tabId: tab.id,
          tabCreated: created,
          tabManaged: true,
          tabLaunchId,
          tabLaunchUrl,
        });
      }
      if (isJannyPageInterruption(lastCapture)) {
        const interruptionSettle = await settlePotentialSourceInterruption(
          tab,
          id,
          characterUrl,
          lastCapture,
          jobDeadlineAtMs,
        );
        lastCapture = interruptionSettle.capture || lastCapture;
        if (lastCapture && lastCapture.success === true) {
          if (created) {
            void closeExtensionCreatedTab(tab.id, "janny_capture_finished");
          }
          return SourceVaultCore.sanitizeForTransport({
            ...lastCapture,
            source: lastCapture.source || "janny_extension_tab",
            tabId: tab.id,
            tabCreated: created,
            tabManaged: true,
            tabLaunchId,
            tabLaunchUrl,
          });
        }
        if (!interruptionSettle.persistentInterruption) {
          if (shouldRetryJannyTabCapture(lastCapture)) {
            await sleep(JANNY_TAB_CAPTURE_RETRY_MS);
            continue;
          }
          break;
        }
        const returnFocusTarget = await captureJannyReturnFocusTarget(opts.ownerTabId || null, tab.id);
        const job = buildJannyRecoveryJob({
          retrievalId: opts.retrievalId || null,
          characterId: id,
          ownerTabId: opts.ownerTabId || null,
          jannyTabId: tab.id,
          createdJannyTab: created,
          tabManaged: true,
          tabLaunchId,
          tabLaunchUrl,
          finalUrl: (lastCapture && lastCapture.finalUrl) || (tab && tab.url) || characterUrl,
          lastError: (lastCapture && lastCapture.error) || "source_page_action_required",
          returnFocusTabId: returnFocusTarget && returnFocusTarget.tabId || null,
          returnFocusWindowId: returnFocusTarget && returnFocusTarget.windowId || null,
          expiresAt: new Date(jobDeadlineAtMs).toISOString(),
        });
        notifyJannyRecoveryJob(job, {
          status: "waiting_user_action",
          message: "Action required: continue in the opened source page.",
        });
        await focusManagedSourceTab(tab);
        let redirectedAfterInterruption = false;
        while (Date.now() < jobDeadlineAtMs) {
          await sleep(Math.min(JANNY_TAB_CAPTURE_RETRY_MS, Math.max(0, jobDeadlineAtMs - Date.now())));
          if (job.skipRequested === true) break;
          try {
            lastCapture = await captureJannyFromTab(tab.id, id);
          } catch (captureError) {
            lastCapture = {
              success: false,
              source: "janny_extension_tab",
              characterId: id,
              characterUrl,
              error: normalizeError(captureError),
            };
          }
          if (lastCapture && lastCapture.success === true) {
            notifyJannyRecoveryJob(job, {
              status: "completed",
              finalUrl: lastCapture.finalUrl || (tab && tab.url) || characterUrl,
              lastError: null,
              message: "Janny recovery captured. Continuing retrieval.",
            });
            await closeManagedSourceTabAndRestoreFocus(job, "janny_capture_finished");
            jannyRecoveryJobs.delete(job.jobId);
            return SourceVaultCore.sanitizeForTransport({
              ...lastCapture,
              source: lastCapture.source || "janny_extension_tab",
              tabId: tab.id,
              tabCreated: created,
              tabManaged: true,
              tabLaunchId,
              tabLaunchUrl,
              recoveryJobId: job.jobId,
            });
          }
          if (isTerminalJannyFailureCapture(lastCapture)) {
            notifyJannyRecoveryJob(job, {
              status: "failed",
              finalUrl: (lastCapture && lastCapture.finalUrl) || (tab && tab.url) || characterUrl,
              lastError: (lastCapture && lastCapture.error) || "janny_recovery_failed",
              message: (lastCapture && lastCapture.userMessage) || "Janny recovery failed.",
            });
            await closeManagedSourceTabAndRestoreFocus(job, "janny_capture_terminal_failure");
            jannyRecoveryJobs.delete(job.jobId);
            return buildTerminalJannyFailureResult(lastCapture, tab, id, characterUrl, {
              recoveryJobId: job.jobId,
              tabManaged: true,
              tabLaunchId,
              tabLaunchUrl,
            });
          }
          if (
            !redirectedAfterInterruption &&
            lastCapture &&
            lastCapture.matchedCharacterId === false &&
            !isJannyPageInterruption(lastCapture)
          ) {
            redirectedAfterInterruption = true;
            await tabsUpdate(tab.id, { url: characterUrl }).catch(() => null);
          }
          notifyJannyRecoveryJob(job, {
            status: "waiting_user_action",
            finalUrl: (lastCapture && lastCapture.finalUrl) || (tab && tab.url) || characterUrl,
            lastError: (lastCapture && lastCapture.error) || null,
            message: "Action required: continue in the opened source page.",
          });
        }
        const skippedByUser = job.skipRequested === true;
        notifyJannyRecoveryJob(job, {
          status: "timed_out",
          message: skippedByUser
            ? "Janny recovery skipped by user."
            : "Retrieval exceeded the configured job timeout.",
          finalUrl: (lastCapture && lastCapture.finalUrl) || (tab && tab.url) || characterUrl,
          lastError: skippedByUser ? "janny_recovery_skipped_by_user" : "job_timeout",
        });
        await closeManagedSourceTabAndRestoreFocus(job, "janny_capture_timed_out");
        jannyRecoveryJobs.delete(job.jobId);
        return SourceVaultCore.sanitizeForTransport({
          ...(lastCapture || {}),
          success: false,
          source: (lastCapture && lastCapture.source) || "janny_extension_tab",
          status: "timed_out",
          timedOut: !skippedByUser,
          skipped: true,
          skipReason: skippedByUser ? "user_skipped_janny_recovery" : "job_timeout",
          userMessage: skippedByUser
            ? "Janny recovery skipped by user."
            : "Retrieval exceeded the configured job timeout.",
          characterId: id,
          characterUrl,
          finalUrl: (lastCapture && lastCapture.finalUrl) || (tab && tab.url) || characterUrl,
          tabId: tab.id,
          tabCreated: created,
          tabManaged: true,
          tabLaunchId,
          tabLaunchUrl,
          interruptionDetected: true,
          recoveryJobId: job.jobId,
          error: skippedByUser ? "janny_recovery_skipped_by_user" : "job_timeout",
        });
      }
      if (!shouldRetryJannyTabCapture(lastCapture)) break;
      await sleep(JANNY_TAB_CAPTURE_RETRY_MS);
    } while (Date.now() < jobDeadlineAtMs);
    return SourceVaultCore.sanitizeForTransport({
      ...(lastCapture || {}),
      success: false,
      source: (lastCapture && lastCapture.source) || "janny_extension_tab",
      characterId: id,
      characterUrl,
      finalUrl: (lastCapture && lastCapture.finalUrl) || (tab && tab.url) || characterUrl,
      tabId: tab.id,
      tabCreated: created,
      tabManaged: true,
      tabLaunchId,
      tabLaunchUrl,
      status: Date.now() >= jobDeadlineAtMs ? "timed_out" : (lastCapture && lastCapture.status) || "failed",
      timedOut: Date.now() >= jobDeadlineAtMs,
      userMessage: Date.now() >= jobDeadlineAtMs
        ? "Retrieval exceeded the configured job timeout."
        : lastCapture && lastCapture.userMessage || null,
      error: Date.now() >= jobDeadlineAtMs
        ? "job_timeout"
        : (lastCapture && lastCapture.error) || "janny_tab_capture_failed",
    });
  } catch (error) {
    const timedOut = Date.now() >= jobDeadlineAtMs;
    return {
      success: false,
      source: "janny_extension_tab",
      characterId: id,
      characterUrl,
      status: timedOut ? "timed_out" : "failed",
      timedOut,
      userMessage: timedOut ? "Retrieval exceeded the configured job timeout." : null,
      error: timedOut ? "job_timeout" : normalizeError(error),
    };
  }
}
