"use strict";
// background/queue_worker.js — retrieval queue persistence + worker orchestration
// Extracted from background.js in Phase 2 (mechanical move; behavior unchanged).
// Loaded in MV3 service-worker global scope via importScripts from background/index.js.
// Depends (global scope) on: constants.js, chrome_adapters.js, broadcasts.js, tab_state.js, retrieved_store.js, datacat_client.js, shared/source_vault_queue.js

let retrievalQueueState = null;
let retrievalQueueMutation = Promise.resolve();
let retrievalQueueRunScheduled = false;
const managedQueueNavigationChecks = new Map();

function isQueueManagedUsage(usage) {
  const role = String(usage && usage.role || "");
  return role === "queue_worker" || role === "queue_janny";
}


async function normalizePersistedWorkerLossState(state) {
  let normalized = SourceVaultQueue.normalizeState(state);
  const reconciled = SourceVaultQueue.reconcileInvariants(normalized, {
    requeueOrphaned: SourceVaultQueue.isTransientWorkerReason(normalized.blockedReason),
  });
  let action = reconciled.action;
  let changed = reconciled.changed;
  normalized = reconciled.state;
  if (
    SourceVaultQueue.getActiveItem(normalized) &&
    ["paused", "blocked"].includes(normalized.status) &&
    SourceVaultQueue.isTransientWorkerReason(normalized.blockedReason)
  ) {
    const recovered = SourceVaultQueue.recoverAfterWorkerLoss(normalized, { reason: normalized.blockedReason });
    normalized = recovered.state;
    action = recovered.action;
    changed = true;
  }
  retrievalQueueState = SourceVaultQueue.normalizeState(normalized);
  if (!changed) return retrievalQueueState;
  await storageSet({ [RETRIEVAL_QUEUE_STORAGE_KEY]: retrievalQueueState });
  broadcastRetrievalQueue(retrievalQueueState);
  syncRetrievalQueueAlarms(retrievalQueueState);
  if (["retry", "failed_continue", "reconciled"].includes(action) && retrievalQueueState.status === "running") {
    scheduleRetrievalQueueRun(RETRIEVAL_QUEUE_WORKER_RECOVERY_DELAY_MS);
  }
  return retrievalQueueState;
}


function readRetrievalQueueState() {
  if (retrievalQueueState) return normalizePersistedWorkerLossState(retrievalQueueState);
  return storageGet({ [RETRIEVAL_QUEUE_STORAGE_KEY]: null }).then((result) => (
    normalizePersistedWorkerLossState(result[RETRIEVAL_QUEUE_STORAGE_KEY])
  ));
}


function buildRetrievalQueueProjection(state) {
  return SourceVaultCore.sanitizeForTransport(SourceVaultQueue.buildProjection(state));
}


function broadcastRetrievalQueue(state) {
  const projection = buildRetrievalQueueProjection(state || retrievalQueueState);
  broadcast({ type: MessageTypes.SV2_QUEUE_UPDATED, queue: projection, revision: projection.revision });
  return projection;
}


async function persistRetrievalQueueState(state, options = {}) {
  retrievalQueueState = SourceVaultQueue.normalizeState(state);
  await storageSet({ [RETRIEVAL_QUEUE_STORAGE_KEY]: retrievalQueueState });
  if (options.broadcast !== false) broadcastRetrievalQueue(retrievalQueueState);
  syncRetrievalQueueAlarms(retrievalQueueState);
  return retrievalQueueState;
}


function mutateRetrievalQueue(mutator) {
  const operation = retrievalQueueMutation.then(async () => {
    const current = await readRetrievalQueueState();
    const next = await mutator(SourceVaultQueue.normalizeState(current));
    if (!next || next === current) return current;
    return persistRetrievalQueueState(next);
  });
  retrievalQueueMutation = operation.catch(() => {});
  return operation;
}


function syncRetrievalQueueAlarms(state) {
  if (!chrome.alarms) return;
  const projection = SourceVaultQueue.buildProjection(state);
  const hasWork = projection.counts.outstanding > 0 || ["running", "pausing", "action_required", "blocked"].includes(projection.status);
  if (hasWork) {
    chrome.alarms.create(RETRIEVAL_QUEUE_ALARM, { periodInMinutes: RETRIEVAL_QUEUE_WATCHDOG_MINUTES });
    scheduleRetrievalQueueJobDeadline(state).catch(() => {});
    chrome.alarms.clear(RETRIEVAL_QUEUE_IDLE_CLOSE_ALARM, () => void chrome.runtime.lastError);
    chrome.alarms.clear(RETRIEVAL_QUEUE_IDLE_CLOSE_RETRY_ALARM, () => void chrome.runtime.lastError);
  } else {
    chrome.alarms.clear(RETRIEVAL_QUEUE_ALARM, () => void chrome.runtime.lastError);
    chrome.alarms.clear(RETRIEVAL_QUEUE_JOB_DEADLINE_ALARM, () => void chrome.runtime.lastError);
    if (projection.worker.windowId) {
      chrome.alarms.create(RETRIEVAL_QUEUE_IDLE_CLOSE_ALARM, { delayInMinutes: RETRIEVAL_QUEUE_IDLE_CLOSE_MINUTES });
    } else {
      chrome.alarms.clear(RETRIEVAL_QUEUE_IDLE_CLOSE_ALARM, () => void chrome.runtime.lastError);
      chrome.alarms.clear(RETRIEVAL_QUEUE_IDLE_CLOSE_RETRY_ALARM, () => void chrome.runtime.lastError);
    }
  }
}

function getQueueExecutingItem(state) {
  const queue = SourceVaultQueue.normalizeState(state);
  const active = SourceVaultQueue.getActiveItem(queue);
  if (active) return active;
  const waitingId = queue.connectionWait && queue.connectionWait.queueItemId;
  return waitingId ? getQueueItemById(queue, waitingId) : null;
}

async function scheduleRetrievalQueueJobDeadline(state = null) {
  if (!chrome.alarms) return null;
  const queue = SourceVaultQueue.normalizeState(state || await readRetrievalQueueState());
  const item = getQueueExecutingItem(queue);
  const startedAtMs = Date.parse(item && (item.startedAt || item.updatedAt) || "") || 0;
  if (!item || !startedAtMs || ["paused", "blocked"].includes(queue.status)) {
    chrome.alarms.clear(RETRIEVAL_QUEUE_JOB_DEADLINE_ALARM, () => void chrome.runtime.lastError);
    return null;
  }
  const timeoutMs = await readJobTimeoutMs();
  const deadlineAtMs = startedAtMs + timeoutMs;
  chrome.alarms.create(RETRIEVAL_QUEUE_JOB_DEADLINE_ALARM, {
    when: Math.max(Date.now() + 100, deadlineAtMs),
  });
  return deadlineAtMs;
}


function scheduleRetrievalQueueIdleCloseRetry() {
  if (!chrome.alarms) return;
  chrome.alarms.create(RETRIEVAL_QUEUE_IDLE_CLOSE_RETRY_ALARM, {
    delayInMinutes: RETRIEVAL_QUEUE_IDLE_CLOSE_RETRY_MINUTES,
  });
}


function scheduleRetrievalQueueRun(delayMs = 0) {
  if (retrievalQueueRunScheduled) return;
  retrievalQueueRunScheduled = true;
  setTimeout(() => {
    retrievalQueueRunScheduled = false;
    runRetrievalQueue().catch((error) => {
      console.warn("[SourceVaultV2] Queue runner failed:", normalizeError(error));
    });
  }, Math.max(0, Number(delayMs) || 0));
}


function getQueueItemById(state, queueItemId) {
  return (state && Array.isArray(state.items) ? state.items : []).find((item) => item.queueItemId === queueItemId) || null;
}


function isQueueRunCurrentState(state, item) {
  if (!state || !item || !item.queueItemId || !item.queueRunToken) return false;
  const active = SourceVaultQueue.getActiveItem(state);
  return !!active && active.queueItemId === item.queueItemId && active.queueRunToken === item.queueRunToken;
}


async function isQueueRunCurrent(item) {
  return isQueueRunCurrentState(await readRetrievalQueueState(), item);
}


function buildQueuePreflightBody(item) {
  return {
    sourceKind: item.sourceKind,
    characterId: item.characterId,
    creatorId: item.creatorId || null,
    creatorHandle: item.creatorHandle || null,
    visibility: item.visibility,
    requestedVisibility: item.requestedVisibility || item.visibility,
    sourceVisibility: item.sourceVisibility || null,
    forceRetrieve: item.forceRetrieve === true,
  };
}


function getExistingPreflightResult(preflight) {
  // Shared pure helper (shared/policy.js) so the "already on Datacat" rule
  // cannot drift between the background queue worker and the sidebar display.
  return SourceVaultPolicy.getExistingPreflightResult(preflight);
}


function getQueueStateRank(value) {
  const state = String(value || "pending");
  return {
    pending: 0,
    checking: 1,
    loading: 2,
    reading: 3,
    action_required: 3,
    preparing: 4,
    saving: 5,
    completed: 6,
    already_available: 6,
    interrupted: 6,
    failed: 6,
    cancelled: 6,
  }[state] ?? 0;
}


async function setQueueItemState(queueItemId, patch, queuePatch = {}, guard = {}) {
  return mutateRetrievalQueue((state) => {
    const item = getQueueItemById(state, queueItemId);
    if (!item) return state;
    if (guard.queueRunToken && (state.activeItemId !== queueItemId || item.queueRunToken !== guard.queueRunToken)) return state;
    if (SourceVaultQueue.isTerminalItem(item) && patch && !SourceVaultQueue.TERMINAL_STATES.has(String(patch.state || ""))) {
      return state;
    }
    const normalizedPatch = { ...(patch || {}) };
    if (
      normalizedPatch.state &&
      normalizedPatch.state !== "action_required" &&
      getQueueStateRank(normalizedPatch.state) < getQueueStateRank(item.state)
    ) {
      delete normalizedPatch.state;
      delete normalizedPatch.phase;
      delete normalizedPatch.message;
    }
    const next = SourceVaultQueue.updateItem(state, queueItemId, normalizedPatch);
    const normalizedQueuePatch = { ...(queuePatch || {}) };
    if (normalizedQueuePatch.status === "running" && state.pauseAfterCurrent === true) {
      normalizedQueuePatch.status = "pausing";
    }
    if (["paused", "blocked", "waiting_connection"].includes(state.status) && normalizedQueuePatch.status === "running") {
      delete normalizedQueuePatch.status;
    }
    return SourceVaultQueue.touchState(next, normalizedQueuePatch);
  });
}


async function finishQueueItem(queueItemId, terminalState, patch = {}, guard = {}) {
  const next = await mutateRetrievalQueue((state) => {
    const item = getQueueItemById(state, queueItemId);
    if (!item) return state;
    if (guard.queueRunToken && (state.activeItemId !== queueItemId || item.queueRunToken !== guard.queueRunToken)) return state;
    const finishedAt = new Date().toISOString();
    let updated = SourceVaultQueue.updateItem(state, queueItemId, {
      ...patch,
      state: terminalState,
      phase: terminalState,
      finishedAt,
      updatedAt: finishedAt,
    });
    const pending = updated.items.some((candidate) => candidate.state === "pending" || candidate.state === "interrupted");
    const shouldPause = updated.pauseAfterCurrent === true;
    updated = SourceVaultQueue.touchState(updated, {
      activeItemId: null,
      pauseAfterCurrent: false,
      blockedReason: null,
      connectionWait: null,
      status: shouldPause ? "paused" : pending ? "running" : "idle",
    });
    return updated;
  });
  if (next.status === "running") scheduleRetrievalQueueRun(RETRIEVAL_QUEUE_SETTLE_MS);
  return next;
}


function resetQueueItemForFreshStart(state, item, message = "Waiting to start.") {
  return SourceVaultQueue.updateItem(state, item.queueItemId, {
    state: "pending",
    phase: "queued",
    message,
    error: null,
    failureKind: null,
    retrievalId: null,
    queueRunToken: null,
    components: null,
    preflight: null,
    startedAt: null,
    workerWindowId: null,
    workerTabId: null,
    actionRequiredKind: null,
    actionRequiredUrl: null,
    actionReturnFocusTabId: null,
    actionReturnFocusWindowId: null,
    connectionRetryCount: 0,
    connectionRetryAt: null,
    connectionWaitingSince: null,
    lastConnectivityFailureKind: null,
  });
}


async function closeQueueExecutionResources(snapshot, reason) {
  const root = snapshot && typeof snapshot === "object" ? snapshot : {};
  const workerTabId = root.workerTabId || null;
  const activeItemId = root.activeItemId || null;
  const childMessage = String(reason || "").includes("cleared")
    ? "Queue cleared."
    : String(reason || "").includes("removed")
      ? "Retrieval removed from queue."
      : String(reason || "").includes("stopped")
        ? "Retrieval stopped."
        : "Retrieval restarting.";
  await closeQueueOwnedChildTabs(activeItemId, workerTabId, { message: childMessage, error: reason || "queue_execution_stopped" }).catch(() => {});
  if (!workerTabId) return;
  const usage = await getExtensionTabUsageAsync(workerTabId);
  if (!usage || usage.createdByExtension !== true || usage.closableByExtension !== true || usage.role !== "queue_worker") return;
  await closeExtensionCreatedTab(workerTabId, reason || "queue_execution_stopped").catch(() => {});
}


async function stopRetrievalQueue() {
  let executionSnapshot = null;
  const state = await mutateRetrievalQueue((current) => {
    executionSnapshot = {
      activeItemId: current.activeItemId,
      workerWindowId: current.workerWindowId,
      workerTabId: current.workerTabId,
    };
    let next = current;
    for (const item of SourceVaultQueue.getOutstandingItems(current)) {
      next = resetQueueItemForFreshStart(next, item);
    }
    const hasItems = SourceVaultQueue.getOutstandingItems(next).length > 0;
    return SourceVaultQueue.touchState(next, {
      status: hasItems ? "paused" : "idle",
      activeItemId: null,
      pauseAfterCurrent: false,
      blockedReason: null,
      connectionWait: null,
      workerWindowId: null,
      workerTabId: null,
      lastControlAction: "stop",
      lastRemovedKeys: [],
    });
  });
  await closeQueueExecutionResources(executionSnapshot, "queue_stopped_by_user");
  return state;
}


async function startRetrievalQueue() {
  const queued = await readRetrievalQueueState();
  const requiresDatacat = SourceVaultQueue.getOutstandingItems(queued)
    .some((item) => queueItemRequiresDatacatPreflight(item));
  if (requiresDatacat) {
    const datacat = await readDatacatState();
    if (!datacat || datacat.canUpload !== true) {
      return mutateRetrievalQueue((current) => {
        let next = current;
        for (const item of SourceVaultQueue.getOutstandingItems(current)) {
          if (item.state !== "pending") next = resetQueueItemForFreshStart(next, item, "Waiting in queue.");
        }
        return SourceVaultQueue.touchState(next, {
          status: datacat && datacat.sessionReady === true ? "waiting_connection" : "blocked",
          activeItemId: null,
          pauseAfterCurrent: false,
          blockedReason: datacat && datacat.sessionReady === true ? "datacat_unreachable" : "datacat_session_required",
        });
      });
    }
  }
  let executionSnapshot = null;
  const state = await mutateRetrievalQueue((current) => {
    executionSnapshot = {
      activeItemId: current.activeItemId,
      workerWindowId: current.workerWindowId,
      workerTabId: current.workerTabId,
    };
    let next = current;
    for (const item of SourceVaultQueue.getOutstandingItems(current)) {
      if (item.state === "pending") continue;
      next = resetQueueItemForFreshStart(next, item, "Waiting in queue.");
    }
    const hasItems = SourceVaultQueue.getOutstandingItems(next).length > 0;
    return SourceVaultQueue.touchState(next, {
      status: hasItems ? "running" : "idle",
      activeItemId: null,
      pauseAfterCurrent: false,
      blockedReason: null,
      connectionWait: null,
      workerWindowId: null,
      workerTabId: null,
      lastControlAction: "start",
      lastRemovedKeys: [],
    });
  });
  await closeQueueExecutionResources(executionSnapshot, "queue_restarted_by_user");
  if (state.status === "running") scheduleRetrievalQueueRun(0);
  return state;
}


async function clearRetrievalQueue() {
  let executionSnapshot = null;
  const state = await mutateRetrievalQueue((current) => {
    const protectedItemId = current.activeItemId
      || current.connectionWait && current.connectionWait.queueItemId
      || null;
    const protectedItem = protectedItemId
      ? current.items.find((item) => item.queueItemId === protectedItemId) || null
      : null;
    const retainedItems = protectedItem ? [protectedItem] : [];
    const removedKeys = current.items
      .filter((item) => !protectedItem || item.queueItemId !== protectedItem.queueItemId)
      .map((item) => item.key)
      .filter(Boolean);
    if (!protectedItem) {
      executionSnapshot = {
        activeItemId: current.activeItemId,
        workerWindowId: current.workerWindowId,
        workerTabId: current.workerTabId,
      };
    }
    return SourceVaultQueue.touchState(current, {
      status: protectedItem ? current.status : "idle",
      activeItemId: protectedItem ? current.activeItemId : null,
      pauseAfterCurrent: protectedItem ? current.pauseAfterCurrent : false,
      blockedReason: protectedItem ? current.blockedReason : null,
      connectionWait: protectedItem ? current.connectionWait : null,
      workerWindowId: protectedItem ? current.workerWindowId : null,
      workerTabId: protectedItem ? current.workerTabId : null,
      items: retainedItems,
      lastControlAction: "clear_all",
      lastRemovedKeys: removedKeys,
    });
  });
  if (executionSnapshot) await closeQueueExecutionResources(executionSnapshot, "queue_cleared_by_user");
  return state;
}


async function removeRetrievalQueueItem(queueItemId, queueKey) {
  let executionSnapshot = null;
  let removed = null;
  const state = await mutateRetrievalQueue((current) => {
    const item = current.items.find((candidate) => (
      (queueItemId && candidate.queueItemId === queueItemId) ||
      (queueKey && candidate.key === queueKey)
    ));
    if (!item) return current;
    removed = item;
    const wasActive = current.activeItemId === item.queueItemId;
    const wasConnectionWait = current.connectionWait && current.connectionWait.queueItemId === item.queueItemId;
    if (wasActive || wasConnectionWait) {
      executionSnapshot = {
        activeItemId: current.activeItemId,
        workerWindowId: current.workerWindowId,
        workerTabId: current.workerTabId,
      };
    }
    const items = current.items.filter((candidate) => candidate.queueItemId !== item.queueItemId);
    const hasOutstanding = items.some((candidate) => !SourceVaultQueue.isTerminalItem(candidate));
    const keepStopped = current.status === "paused";
    const nextStatus = !hasOutstanding
      ? "idle"
        : (wasActive || wasConnectionWait)
        ? (keepStopped ? "paused" : "running")
        : current.status;
    return SourceVaultQueue.touchState(current, {
      items,
      activeItemId: wasActive ? null : current.activeItemId,
      status: nextStatus,
      pauseAfterCurrent: wasActive || wasConnectionWait ? false : current.pauseAfterCurrent,
      blockedReason: wasActive || wasConnectionWait || !hasOutstanding ? null : current.blockedReason,
      connectionWait: wasActive || wasConnectionWait || !hasOutstanding ? null : current.connectionWait,
      workerWindowId: wasActive ? null : current.workerWindowId,
      workerTabId: wasActive ? null : current.workerTabId,
      lastControlAction: "remove_item",
      lastRemovedKeys: item.key ? [item.key] : [],
    });
  });
  if (executionSnapshot) await closeQueueExecutionResources(executionSnapshot, "queue_item_removed_by_user");
  if (removed && state.status === "running" && !state.activeItemId) scheduleRetrievalQueueRun(0);
  return { state, removed };
}


async function pauseRetrievalQueue(reason, options = {}) {
  const normalizedReason = compactText(reason || "Queue paused.", 240);
  return mutateRetrievalQueue((state) => {
    const active = SourceVaultQueue.getActiveItem(state);
    if (!active && !SourceVaultQueue.getOutstandingItems(state).length) {
      return SourceVaultQueue.reconcileInvariants(state).state;
    }
    let next = state;
    if (active && options.interruptActive === true) {
      next = SourceVaultQueue.updateItem(next, active.queueItemId, {
        state: "interrupted",
        phase: "interrupted",
        message: normalizedReason,
        error: normalizedReason,
        workerWindowId: null,
        workerTabId: null,
      });
    }
    return SourceVaultQueue.touchState(next, {
      status: options.blocked === true ? "blocked" : "paused",
      activeItemId: options.interruptActive === true ? null : next.activeItemId,
      pauseAfterCurrent: false,
      blockedReason: normalizedReason,
      connectionWait: null,
      workerWindowId: options.clearWorker === true ? null : next.workerWindowId,
      workerTabId: options.clearWorker === true ? null : next.workerTabId,
    });
  });
}


async function failQueueItem(queueItemId, error, options = {}) {
  const rawError = compactText(normalizeError(error), 240) || "unknown_error";
  const failureKind = String(options.failureKind || classifyQueueFailure(error));
  const message = compactText(options.publicMessage || getQueueFailureMessage(failureKind), 240);
  if (options.blockQueue === true) {
    const interruptedState = await setQueueItemState(queueItemId, {
      state: "interrupted",
      phase: "interrupted",
      message,
      error: rawError,
      failureKind,
    }, {}, { queueRunToken: options.queueRunToken || null });
    if (options.queueRunToken) {
      const interruptedItem = getQueueItemById(interruptedState, queueItemId);
      if (
        interruptedState.activeItemId !== queueItemId ||
        !interruptedItem ||
        interruptedItem.queueRunToken !== options.queueRunToken ||
        interruptedItem.state !== "interrupted"
      ) {
        return interruptedState;
      }
    }
    return pauseRetrievalQueue(message, { blocked: true, interruptActive: true, clearWorker: options.clearWorker === true });
  }
  return finishQueueItem(queueItemId, "failed", {
    message,
    error: rawError,
    failureKind,
  }, { queueRunToken: options.queueRunToken || null });
}


function classifyQueueFailure(error, context = {}) {
  const text = normalizeError(error).toLowerCase();
  const isDatacat = context.component === "datacat";
  if (text.includes("source_page_action_required")) return "source_page_action_required";
  if (text.includes("job_timeout")) return "job_timeout";
  if (isDatacat && (text.includes("no_token") || /(?:http[_ ]|status[_ ])401\b/.test(text))) {
    return "datacat_session_required";
  }
  if (
    text.includes("source_login_required") ||
    text.includes("not_logged_in") ||
    text.includes("no_saucepan_token") ||
    text.includes("no_token") ||
    /(?:http[_ ]|status[_ ])401\b/.test(text) ||
    /(?:saucepan_users_me|profile)_http_403\b/.test(text)
  ) return "source_login_required";
  if (
    text.includes("source_account_unknown") ||
    text.includes("source_account_rejected") ||
    text.includes("source_account_confirmation_required") ||
    text.includes("source_account_missing_identity")
  ) {
    return "source_account_approval";
  }
  if (text.includes("datacat_session_required") || text.includes("session_required")) return "datacat_session_required";
  if (/http[_ ]429\b/.test(text) || text.includes("rate limit")) return "rate_limited";
  if (/(?:http[_ ]|status[_ ])408\b/.test(text)) return isDatacat ? "datacat_unreachable" : "source_timeout";
  if (/(?:http[_ ]|status[_ ])500\b/.test(text)) {
    return isDatacat ? "datacat_processing_failed" : "source_unreachable";
  }
  if (/(?:http[_ ]|status[_ ])(?:502|503|504)\b/.test(text)) {
    return isDatacat ? "datacat_unreachable" : "source_unreachable";
  }
  if (
    text.includes("chrome-error://") ||
    text.includes("net::err_") ||
    text.includes("failed to fetch") ||
    text.includes("fetch failed") ||
    text.includes("networkerror") ||
    text.includes("network error") ||
    text.includes("name_not_resolved") ||
    text.includes("connection_refused") ||
    text.includes("internet_disconnected")
  ) return isDatacat ? "datacat_unreachable" : "source_unreachable";
  if (
    text.includes("source_character_page_not_ready") ||
    text.includes("timed out") ||
    text.includes("timeout") ||
    text.includes("content_state_unavailable")
  ) return isDatacat ? "datacat_unreachable" : "source_timeout";
  if (
    text.includes("character_tab_closed") ||
    text.includes("worker_window") ||
    text.includes("content_script_injection_failed") ||
    text.includes("receiving end does not exist")
  ) return "worker_unavailable";
  if (isDatacat && (text.includes("datacat") || text.includes("preflight"))) {
    return "datacat_processing_failed";
  }
  return "unknown_error";
}


function getQueueFailureMessage(failureKind) {
  return {
    source_login_required: "Source login is required in the managed retrieval window.",
    source_page_action_required: "Continue in the opened source page.",
    job_timeout: "Retrieval exceeded the configured job timeout.",
    source_account_approval: "Source account approval is required.",
    source_unreachable: "Source site could not be reached.",
    source_timeout: "Source site did not respond in time.",
    worker_unavailable: "Managed retrieval browser stopped unexpectedly.",
    datacat_session_required: "A Datacat link is required.",
    datacat_unreachable: "Datacat could not be reached.",
    datacat_processing_failed: "Datacat could not finish processing this retrieval.",
    rate_limited: "Retrieval is temporarily rate limited.",
    unknown_error: "Retrieval failed unexpectedly.",
  }[String(failureKind || "")] || "Retrieval failed unexpectedly.";
}


function isQueueBlockerFailureKind(failureKind) {
  return [
    "source_account_approval",
    "datacat_session_required",
  ].includes(failureKind);
}


function isConnectivityWaitFailureKind(failureKind) {
  return ["source_unreachable", "datacat_unreachable", "rate_limited"].includes(String(failureKind || ""));
}


function getConnectivityRetryDelayMs(failureKind, attempt) {
  const baseMs = String(failureKind || "") === "rate_limited"
    ? RETRIEVAL_QUEUE_RATE_LIMIT_RETRY_BASE_MS
    : RETRIEVAL_QUEUE_CONNECTIVITY_RETRY_BASE_MS;
  const exponent = Math.max(0, Math.min(8, (Number(attempt) || 1) - 1));
  return Math.min(RETRIEVAL_QUEUE_CONNECTIVITY_RETRY_MAX_MS, baseMs * (2 ** exponent));
}


async function waitForQueueConnectivity(item, error, options = {}) {
  const queueItemId = String(item && item.queueItemId || "");
  const failureKind = String(options.failureKind || classifyQueueFailure(error, options.context));
  const rawError = compactText(normalizeError(error), 240) || failureKind;
  const message = getQueueFailureMessage(failureKind);
  let executionSnapshot = null;
  let waiting = false;
  const state = await mutateRetrievalQueue((current) => {
    const active = SourceVaultQueue.getActiveItem(current);
    const stored = getQueueItemById(current, queueItemId);
    if (!active || !stored || active.queueItemId !== queueItemId) return current;
    if (options.queueRunToken && stored.queueRunToken !== options.queueRunToken) return current;
    const now = new Date();
    const previousRetryAtMs = Date.parse(stored.connectionRetryAt || "") || 0;
    const sameFailureKind = String(stored.lastConnectivityFailureKind || "") === failureKind;
    const retrySeriesIsFresh = now.getTime() - previousRetryAtMs <= RETRIEVAL_QUEUE_CONNECTIVITY_RETRY_MAX_MS;
    const attempt = sameFailureKind && retrySeriesIsFresh
      ? Math.max(0, Number(stored.connectionRetryCount) || 0) + 1
      : 1;
    const waitingSince = sameFailureKind && retrySeriesIsFresh && stored.connectionWaitingSince
      ? stored.connectionWaitingSince
      : now.toISOString();
    const nextRetryAt = new Date(now.getTime() + getConnectivityRetryDelayMs(failureKind, attempt)).toISOString();
    executionSnapshot = {
      activeItemId: current.activeItemId,
      workerWindowId: current.workerWindowId,
      workerTabId: current.workerTabId,
    };
    let next = SourceVaultQueue.updateItem(current, queueItemId, {
      state: "interrupted",
      phase: "waiting_connection",
      message,
      error: rawError,
      failureKind,
      queueRunToken: null,
      connectionRetryCount: attempt,
      connectionRetryAt: now.toISOString(),
      connectionWaitingSince: waitingSince,
      lastConnectivityFailureKind: failureKind,
      workerWindowId: null,
      workerTabId: null,
    });
    next = SourceVaultQueue.touchState(next, {
      status: "waiting_connection",
      activeItemId: null,
      pauseAfterCurrent: false,
      blockedReason: null,
      connectionWait: {
        queueItemId,
        failureKind,
        attempt,
        nextRetryAt,
        waitingSince,
      },
      workerWindowId: null,
      workerTabId: null,
    });
    waiting = true;
    return next;
  });
  if (waiting && executionSnapshot) {
    await closeQueueExecutionResources(executionSnapshot, "queue_waiting_for_connection");
  }
  return { action: waiting ? "waiting_connection" : "stale", state };
}


async function resumeQueueAfterConnectivityWait(options = {}) {
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  let resumed = false;
  const state = await mutateRetrievalQueue((current) => {
    if (current.status !== "waiting_connection" || !current.connectionWait) return current;
    const retryAtMs = Date.parse(current.connectionWait.nextRetryAt || "") || 0;
    if (options.force !== true && retryAtMs > nowMs) return current;
    const item = getQueueItemById(current, current.connectionWait.queueItemId);
    if (!item || SourceVaultQueue.isTerminalItem(item)) {
      return SourceVaultQueue.reconcileInvariants(SourceVaultQueue.touchState(current, { connectionWait: null })).state;
    }
    let next = SourceVaultQueue.updateItem(current, item.queueItemId, {
      state: "pending",
      phase: "queued",
      message: "Waiting in queue.",
      error: null,
      failureKind: null,
      retrievalId: null,
      queueRunToken: null,
      workerWindowId: null,
      workerTabId: null,
    });
    next = SourceVaultQueue.touchState(next, {
      status: "running",
      activeItemId: null,
      pauseAfterCurrent: false,
      blockedReason: null,
      connectionWait: null,
      workerWindowId: null,
      workerTabId: null,
    });
    resumed = true;
    return next;
  });
  if (resumed) scheduleRetrievalQueueRun(0);
  return { resumed, state };
}


async function handleQueueProcessFailure(item, error, context = {}) {
  const failureKind = classifyQueueFailure(error, context);
  const tab = context.tab && context.tab.id ? context.tab : null;
  if (failureKind === "source_login_required" && tab) {
    const usage = await getExtensionTabUsageAsync(tab.id);
    if (usage && isCurrentManagedQueueOwner(await readRetrievalQueueState(), usage, tab.id)) {
      await markManagedQueueSourceLoginRequired(tab.id, usage, tab.pendingUrl || tab.url || item.normalizedUrl);
      return { action: "source_login_required" };
    }
  }
  if (failureKind === "source_page_action_required" && tab) {
    const usage = await getExtensionTabUsageAsync(tab.id);
    if (usage && isCurrentManagedQueueOwner(await readRetrievalQueueState(), usage, tab.id)) {
      await markManagedQueueSourcePageActionRequired(tab.id, usage, tab.pendingUrl || tab.url || item.normalizedUrl);
      return { action: "source_page_action_required" };
    }
  }
  if (isConnectivityWaitFailureKind(failureKind)) {
    return waitForQueueConnectivity(item, error, {
      failureKind,
      queueRunToken: item && item.queueRunToken || null,
      context,
    });
  }
  if (["source_timeout", "worker_unavailable"].includes(failureKind)) {
    const state = await readRetrievalQueueState();
    const active = SourceVaultQueue.getActiveItem(state);
    if (active && active.queueItemId === item.queueItemId) {
      const usage = state.workerTabId ? await getExtensionTabUsageAsync(state.workerTabId) : null;
      const outcome = await recoverManagedQueueWorkerLoss({
        force: true,
        tabId: state.workerTabId,
        windowId: state.workerWindowId,
        reason: getQueueFailureMessage(failureKind),
        failureKind,
        retrySaving: true,
      });
      if (usage && usage.createdByExtension === true && usage.closableByExtension === true) {
        await closeExtensionCreatedTab(usage.tabId, "queue_failure_recovery").catch(() => {});
      }
      return outcome;
    }
  }
  return failQueueItem(item.queueItemId, error, {
    blockQueue: isQueueBlockerFailureKind(failureKind),
    clearWorker: failureKind === "worker_unavailable",
    queueRunToken: item.queueRunToken,
    failureKind,
  });
}


async function ensureRetrievalQueueWorker(item) {
  let state = await readRetrievalQueueState();
  let tab = state.workerTabId ? await tabsGet(state.workerTabId).catch(() => null) : null;
  let windowInfo = null;
  if (tab && state.workerWindowId && Number(tab.windowId) !== Number(state.workerWindowId)) tab = null;
  if (!tab) {
    windowInfo = await windowsCreate({
      url: item.normalizedUrl,
      focused: false,
      type: "normal",
    });
    tab = windowInfo && Array.isArray(windowInfo.tabs) ? windowInfo.tabs[0] : null;
    if (!tab || !tab.id) throw new Error("worker_window_tab_unavailable");
    state = await mutateRetrievalQueue((current) => SourceVaultQueue.touchState(current, {
      workerWindowId: windowInfo.id || tab.windowId || null,
      workerTabId: tab.id,
      workerGeneration: Number(current.workerGeneration || 0) + 1,
    }));
  } else {
    rememberExtensionTabUsage(tab, {
      role: "queue_worker",
      sourceKind: item.sourceKind,
      characterId: item.characterId,
      queueItemId: item.queueItemId,
      queueGeneration: Number(state.workerGeneration || 0),
      launchUrl: item.normalizedUrl,
      createdByExtension: true,
      closableByExtension: true,
    });
  }
  if (tab && !tabAlreadyAtUrl(tab, item.normalizedUrl)) {
    tab = await tabsUpdate(tab.id, { url: item.normalizedUrl, active: true });
  } else if (tab) {
    tab = await tabsUpdate(tab.id, { active: true }).catch(() => tab);
  }
  const generation = Number(state.workerGeneration || 0);
  rememberExtensionTabUsage(tab, {
    role: "queue_worker",
    sourceKind: item.sourceKind,
    characterId: item.characterId,
    queueItemId: item.queueItemId,
    queueGeneration: generation,
    launchId: buildExtensionTabLaunchId("queue_worker", item.characterId, item.retrievalId),
    launchUrl: item.normalizedUrl,
    currentUrl: tab.pendingUrl || tab.url || item.normalizedUrl,
    createdByExtension: true,
    closableByExtension: true,
  });
  const updatedQueue = await setQueueItemState(item.queueItemId, {
    state: "loading",
    phase: "loading",
    message: "Opening source page.",
    workerWindowId: tab.windowId || state.workerWindowId || null,
    workerTabId: tab.id,
  }, {
    workerWindowId: tab.windowId || state.workerWindowId || null,
    workerTabId: tab.id,
  }, { queueRunToken: item.queueRunToken || null });
  if (!isQueueRunCurrentState(updatedQueue, item)) throw new Error("queue_attempt_superseded");
  return tab;
}


function queueItemRequiresDatacatPreflight(item) {
  return !(item && item.localOnly === true);
}


function resolveExistingDatacatQueuePolicy(item, existing, localRecord) {
  const root = item && typeof item === "object" ? item : {};
  if (!existing) {
    if (localRecord && root.forceRetrieve !== true && root.localOnly !== true) {
      return { finishWithoutRetrieval: false, uploadLocalRecord: true, localOnly: false, decision: "upload_local_to_datacat" };
    }
    return {
      finishWithoutRetrieval: false,
      uploadLocalRecord: false,
      localOnly: root.localOnly === true,
      decision: root.localOnly === true ? "local_only_requested" : "create_datacat",
    };
  }
  if (existing.ownerVisible === false) {
    if (localRecord && root.forceRetrieve !== true) {
      return {
        finishWithoutRetrieval: false,
        uploadLocalRecord: true,
        localOnly: false,
        decision: "upload_owner_copy_existing_datacat",
      };
    }
    return {
      finishWithoutRetrieval: false,
      uploadLocalRecord: false,
      localOnly: false,
      decision: "capture_owner_copy_existing_datacat",
    };
  }
  if (localRecord && root.forceRetrieve !== true) {
    return { finishWithoutRetrieval: true, uploadLocalRecord: false, localOnly: true, decision: "already_local_and_datacat" };
  }
  return { finishWithoutRetrieval: false, uploadLocalRecord: false, localOnly: true, decision: "capture_local_existing_datacat" };
}


async function getQueueLocalRecord(item) {
  const store = await readRetrievedStore();
  const entry = findRetrievedStoreEntry(store, item && item.characterId, item && item.sourceKind);
  return entry ? entry.record : null;
}


function isDatacatLinkRequiredError(error) {
  const value = normalizeError(error).toLowerCase();
  return value === "datacat_session_required" || value.includes("datacat_session_required");
}


async function blockQueueForDatacatLink(item) {
  return mutateRetrievalQueue((state) => {
    if (!isQueueRunCurrentState(state, item)) return state;
    const current = getQueueItemById(state, item.queueItemId);
    if (!current) return state;
    let next = resetQueueItemForFreshStart(state, current, "Link Datacat to continue.");
    next = SourceVaultQueue.touchState(next, {
      status: "blocked",
      activeItemId: null,
      pauseAfterCurrent: false,
      blockedReason: "datacat_session_required",
      connectionWait: null,
    });
    return next;
  });
}


async function processQueueItem(item) {
  let workerTab = null;
  try {
    let preflightResult = { ok: true, preflight: null };
    if (queueItemRequiresDatacatPreflight(item)) {
      try {
        preflightResult = await requestSourceVaultPreflight(buildQueuePreflightBody(item));
        if (!preflightResult.ok) throw new Error(preflightResult.error || "datacat_session_required");
      } catch (error) {
        if (isDatacatLinkRequiredError(error)) {
          await blockQueueForDatacatLink(item);
          return;
        }
        await handleQueueProcessFailure(item, error, { component: "datacat" });
        return;
      }
    }
    if (!await isQueueRunCurrent(item)) return;
    const preflight = preflightResult.preflight || null;
    const existing = getExistingPreflightResult(preflight);
    const localRecord = await getQueueLocalRecord(item);
    const writePolicy = resolveExistingDatacatQueuePolicy(item, existing, localRecord);
    const checkedQueue = await setQueueItemState(item.queueItemId, {
      preflight,
      localOnly: writePolicy.localOnly,
      datacatWriteDecision: writePolicy.decision,
      state: "checking",
      phase: "checking",
      message: "Checking character.",
    }, {}, { queueRunToken: item.queueRunToken });
    if (!isQueueRunCurrentState(checkedQueue, item)) return;
    if (writePolicy.finishWithoutRetrieval) {
      await finishQueueItem(item.queueItemId, "already_available", {
        message: "Already available locally and on Datacat.",
        viewUrl: existing.viewUrl || null,
        title: item.title || existing.title || null,
      }, { queueRunToken: item.queueRunToken });
      return;
    }
    if (writePolicy.uploadLocalRecord && localRecord) {
      await setQueueItemState(item.queueItemId, {
        state: "saving",
        phase: "saving",
        message: "Saving character.",
        resultCharacterId: localRecord.id,
      }, {}, { queueRunToken: item.queueRunToken });
      await uploadRetrievedCharacter(localRecord, "queue_existing_local", {
        visibility: item.visibility,
        requestedVisibility: item.requestedVisibility || item.visibility,
        forceRetrieve: false,
        localOnly: false,
        preflight,
      });
      return;
    }

    const tab = await ensureRetrievalQueueWorker(item);
    workerTab = tab;
    await waitForTabComplete(tab.id, RETRIEVAL_QUEUE_PAGE_READY_MS);
    if (!await isQueueRunCurrent(item)) return;
    let readyState;
    try {
      readyState = await waitForSourceCharacterReady(tab.id, item, RETRIEVAL_QUEUE_PAGE_READY_MS);
    } catch (firstError) {
      if (!await isQueueRunCurrent(item)) return;
      if (classifyQueueFailure(firstError) === "source_page_action_required") throw firstError;
      await tabsUpdate(tab.id, { url: item.normalizedUrl, active: true });
      await waitForTabComplete(tab.id, RETRIEVAL_QUEUE_PAGE_READY_MS);
      if (!await isQueueRunCurrent(item)) return;
      readyState = await waitForSourceCharacterReady(tab.id, item, RETRIEVAL_QUEUE_PAGE_READY_MS).catch(() => {
        throw firstError;
      });
    }
    if (!await isQueueRunCurrent(item)) return;
    await assertSourceTabApproved(tab, item.sourceKind, readyState);
    if (!await isQueueRunCurrent(item)) return;
    const retrievalId = `queue-${item.queueItemId}-${Date.now().toString(36)}`;
    rememberExtensionTabUsage(tab, {
      role: "queue_worker",
      sourceKind: item.sourceKind,
      characterId: item.characterId,
      queueItemId: item.queueItemId,
      queueGeneration: Number((await readRetrievalQueueState()).workerGeneration || 0),
      retrievalId,
      launchUrl: item.normalizedUrl,
      createdByExtension: true,
      closableByExtension: true,
    });
    const readingQueue = await setQueueItemState(item.queueItemId, {
      state: "reading",
      phase: "reading",
      message: "Reading source.",
      retrievalId,
      attempt: Number(item.attempt || 0) + 1,
    }, {}, { queueRunToken: item.queueRunToken });
    if (!isQueueRunCurrentState(readingQueue, item)) return;
    const response = await sendContentMessageWithInjection(tab.id, {
      type: MessageTypes.SV_START_RETRIEVAL,
      options: normalizeUploadOptions({
        visibility: item.visibility,
        forceRetrieve: item.forceRetrieve === true,
        localOnly: writePolicy.localOnly,
        preflight,
        retrievalId,
        queueItemId: item.queueItemId,
        queueManaged: true,
        jobStartedAt: item.startedAt || null,
      }, null),
    }, { attempts: 4 });
    if (!response || response.ok === false) throw new Error(response && response.error ? response.error : "queue_retrieval_start_failed");
    const latest = await readRetrievalQueueState();
    const active = SourceVaultQueue.getActiveItem(latest);
    if (isQueueRunCurrentState(latest, item) && active && response.state) {
      const retrieval = response.state.retrieval && typeof response.state.retrieval === "object" ? response.state.retrieval : {};
      if (retrieval.error || retrieval.stage === "failed") {
        const retrievalError = retrieval.error || "Retrieval failed.";
        await handleQueueProcessFailure(item, retrievalError, { tab });
      }
    }
  } catch (error) {
    if (normalizeError(error) === "queue_attempt_superseded" || !await isQueueRunCurrent(item)) return;
    await handleQueueProcessFailure(item, error, { tab: workerTab });
  }
}


async function runRetrievalQueue() {
  let claimed = null;
  await mutateRetrievalQueue((state) => {
    if (state.status !== "running" || state.activeItemId) return state;
    const nextItem = state.items.find((item) => item.state === "pending");
    if (!nextItem) return SourceVaultQueue.touchState(state, { status: "idle", blockedReason: null });
    const queueRunToken = `run-${nextItem.queueItemId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = nextItem.startedAt || new Date().toISOString();
    claimed = { ...nextItem, queueRunToken, startedAt };
    let next = SourceVaultQueue.updateItem(state, nextItem.queueItemId, {
      state: "checking",
      phase: "checking",
      message: "Checking character.",
      error: null,
      queueRunToken,
      startedAt,
    });
    next = SourceVaultQueue.touchState(next, { activeItemId: nextItem.queueItemId, blockedReason: null });
    return next;
  });
  if (claimed) await processQueueItem(claimed);
}


async function addRetrievalQueueItems(inputs, options = {}) {
  const requiresDatacat = !(options && options.localOnly === true) &&
    (Array.isArray(inputs) ? inputs : []).some((item) => !(item && item.localOnly === true));
  if (requiresDatacat) {
    const state = await readDatacatState();
    if (!state || state.sessionReady !== true || state.canUpload !== true) {
      throw new Error("datacat_session_required");
    }
  }
  let result = null;
  await mutateRetrievalQueue((state) => {
    result = SourceVaultQueue.addItems(state, inputs, options);
    return result.state;
  });
  if (result && result.added.length) scheduleRetrievalQueueRun(0);
  return {
    ok: true,
    queue: buildRetrievalQueueProjection(await readRetrievalQueueState()),
    added: result ? result.added : [],
    duplicates: result ? result.duplicates : [],
    invalid: result ? result.invalid : [],
    overflow: result ? result.overflow : [],
  };
}


async function enqueueActiveCharacterTab(message) {
  const requestedTabId = Number(message && message.tabId || 0);
  const tab = requestedTabId ? await tabsGet(requestedTabId).catch(() => null) : await getActiveTabAsync();
  if (!tab || !tab.id || getSupportedSourceRank(tab) < 3) throw new Error("active_tab_not_supported");
  const state = await readSourceTabState(tab.id, { forceAuth: true });
  const page = state && state.page && typeof state.page === "object" ? state.page : {};
  const character = state && state.character && typeof state.character === "object" ? state.character : {};
  const sourceKind = getStateSourceKind(state);
  const characterId = SourceVaultCore.normalizeUuid(character.id || character.characterId || character.companionId || page.characterId || page.companionId);
  if (!sourceKind || !characterId || !page.isCharacterPage) throw new Error("source_character_page_not_ready");
  const options = normalizeUploadOptions(message && message.options || null, null);
  return addRetrievalQueueItems([{
    sourceKind,
    characterId,
    url: page.normalizedUrl || tab.url,
    title: character.name || null,
    author: character.creatorName || character.creatorHandle || null,
    creatorId: character.creatorId || page.creatorId || null,
    creatorHandle: character.creatorHandle || page.creatorHandle || null,
    origin: "manual",
    visibility: options.visibility,
    requestedVisibility: options.requestedVisibility,
    sourceVisibility: options.sourceVisibility,
    forceRetrieve: options.forceRetrieve,
    localOnly: options.localOnly,
  }], options);
}


async function handleQueueTabState(tabId, state) {
  const usage = await getExtensionTabUsageAsync(tabId);
  if (!usage || usage.role !== "queue_worker" || !usage.queueItemId) return;
  const queue = await readRetrievalQueueState();
  if (["paused", "blocked"].includes(queue.status) && queue.activeItemId !== usage.queueItemId) return;
  const retrieval = state && state.retrieval && typeof state.retrieval === "object" ? state.retrieval : {};
  const components = retrieval.components || null;
  if (retrieval.running === true) {
    const actionRequired = retrieval.stage === "janny_waiting" || retrieval.stage === "waiting_user_action";
    await setQueueItemState(usage.queueItemId, {
      state: actionRequired ? "action_required" : "reading",
      phase: actionRequired ? "action_required" : "reading",
      message: actionRequired ? "Continue in the opened source page." : "Reading source.",
      components,
    }, { status: actionRequired ? "action_required" : "running" });
    return;
  }
  if (retrieval.error || retrieval.stage === "failed") {
    const retrievalError = retrieval.error || "Retrieval failed.";
    const active = SourceVaultQueue.getActiveItem(queue);
    if (!active || active.queueItemId !== usage.queueItemId) return;
    const tab = await tabsGet(tabId).catch(() => null);
    await handleQueueProcessFailure(active, retrievalError, { tab });
  }
}


async function handleQueueSaveStarted(tabId, message) {
  const usage = await getExtensionTabUsageAsync(tabId);
  if (!usage || usage.role !== "queue_worker" || !usage.queueItemId) return null;
  const queue = await readRetrievalQueueState();
  const active = SourceVaultQueue.getActiveItem(queue);
  if (
    !active ||
    active.queueItemId !== usage.queueItemId ||
    !["running", "pausing", "action_required"].includes(queue.status)
  ) return null;
  const updated = await setQueueItemState(usage.queueItemId, {
    state: "preparing",
    phase: "preparing",
    message: "Preparing character.",
    components: message && message.capture && message.capture.components ? message.capture.components : null,
  }, { status: "running" }, { queueRunToken: active.queueRunToken || null });
  if (!isQueueRunCurrentState(updated, active)) return null;
  return { queueItemId: usage.queueItemId, queueRunToken: active.queueRunToken || null };
}


async function handleQueueSaveFinished(context, record) {
  const queueItemId = context && context.queueItemId || null;
  const queueRunToken = context && context.queueRunToken || null;
  if (!queueItemId || !record) return;
  const queue = await readRetrievalQueueState();
  const active = SourceVaultQueue.getActiveItem(queue);
  if (!active || !isQueueRunCurrentState(queue, { queueItemId, queueRunToken })) return;
  if (record.upload && record.upload.localOnly === true) {
    const existing = getExistingPreflightResult(active.preflight);
    await finishQueueItem(queueItemId, "completed", {
      message: "Character saved.",
      resultCharacterId: record.id,
      viewUrl: existing && existing.viewUrl || null,
      components: record.summary && record.summary.components || null,
    }, { queueRunToken });
    return;
  }
  await setQueueItemState(queueItemId, {
    state: "saving",
    phase: "saving",
    message: "Saving character.",
    resultCharacterId: record.id,
    components: record.summary && record.summary.components || null,
  }, {}, { queueRunToken });
}


async function retryQueueUpload(queueItem, record) {
  await sleep(5000);
  const state = await readRetrievalQueueState();
  const active = SourceVaultQueue.getActiveItem(state);
  if (!active || active.queueItemId !== queueItem.queueItemId || state.status === "paused") return;
  uploadRetrievedCharacter(record, "queue_retry", record.uploadOptions || null).catch(() => {});
}


async function handleRetrievalQueueUploadState(characterId, record) {
  const state = await readRetrievalQueueState();
  const item = SourceVaultQueue.getActiveItem(state);
  const normalizedId = SourceVaultCore.normalizeUuid(characterId);
  if (!item || !normalizedId || item.characterId !== normalizedId) return;
  const upload = record && record.upload && typeof record.upload === "object" ? record.upload : {};
  const status = String(upload.status || "");
  if (["pending", "checking_datacat", "uploading"].includes(status)) {
    await setQueueItemState(item.queueItemId, { state: "saving", phase: "saving", message: "Saving character." });
    return;
  }
  if (status === "uploaded" || status === "local_saved") {
    await finishQueueItem(item.queueItemId, "completed", {
      message: "Character retrieved.",
      resultCharacterId: characterId,
      viewUrl: upload.viewUrl || null,
      components: upload.components || item.components || null,
      error: null,
    });
    return;
  }
  if (status === "session_required") {
    await handleQueueProcessFailure(item, new Error("datacat_session_required"), { component: "datacat" });
    return;
  }
  if (status === "failed") {
    if (Number(item.uploadRetryCount || 0) < 1) {
      await setQueueItemState(item.queueItemId, {
        state: "saving",
        phase: "saving",
        message: "Retrying save.",
        uploadRetryCount: 1,
      });
      retryQueueUpload(item, record).catch(() => {});
    } else {
      await handleQueueProcessFailure(item, upload.error || "Datacat save failed.", { component: "datacat" });
    }
  }
}


async function closeIdleRetrievalQueueWorker(options = {}) {
  const state = await readRetrievalQueueState();
  const projection = SourceVaultQueue.buildProjection(state);
  if (projection.counts.outstanding || state.activeItemId || state.status !== "idle") return false;
  const workerTabId = state.workerTabId;
  if (!workerTabId) return false;
  const usage = await getExtensionTabUsageAsync(workerTabId);
  if (!usage || usage.createdByExtension !== true || usage.closableByExtension !== true || usage.role !== "queue_worker") {
    if (options.scheduleRetry !== false) scheduleRetrievalQueueIdleCloseRetry();
    return false;
  }
  let claimed = false;
  await mutateRetrievalQueue((current) => {
    const currentProjection = SourceVaultQueue.buildProjection(current);
    if (
      currentProjection.counts.outstanding ||
      current.activeItemId ||
      current.status !== "idle" ||
      Number(current.workerTabId) !== Number(workerTabId)
    ) return current;
    claimed = true;
    return SourceVaultQueue.touchState(current, { workerWindowId: null, workerTabId: null });
  });
  if (!claimed) return false;
  const result = await closeExtensionCreatedTab(workerTabId, "queue_idle_cleanup");
  if (result && result.ok === true) return true;
  if (options.scheduleRetry !== false) scheduleRetrievalQueueIdleCloseRetry();
  return false;
}


async function retryIdleRetrievalQueueCleanup() {
  if (await closeIdleRetrievalQueueWorker({ scheduleRetry: false })) return true;
  const state = await readRetrievalQueueState();
  return (await closeOrphanedManagedQueueTabs(state)) > 0;
}


async function closeQueueOwnedChildTabs(queueItemId, ownerTabId, options = {}) {
  if (!queueItemId && !ownerTabId) return;
  for (const job of jannyRecoveryJobs.values()) {
    if (!job || Number(job.ownerTabId) !== Number(ownerTabId)) continue;
    job.skipRequested = true;
    notifyJannyRecoveryJob(job, {
      status: "interrupted",
      message: options.message || "Managed retrieval tab is reopening.",
      lastError: options.error || "queue_worker_reopening",
    });
  }
  const childTabIds = [];
  for (const [tabId, usage] of extensionTabUsage.entries()) {
    if (!usage || usage.role !== "queue_janny") continue;
    if (queueItemId && usage.queueItemId !== queueItemId) continue;
    if (usage.createdByExtension !== true || usage.closableByExtension !== true) continue;
    childTabIds.push(tabId);
  }
  await Promise.all(childTabIds.map((tabId) => closeExtensionCreatedTab(tabId, "queue_worker_reopening")));
}


async function recoverManagedQueueWorkerLoss(details = {}) {
  let outcome = null;
  await mutateRetrievalQueue((state) => {
    const matchesTab = details.tabId && Number(state.workerTabId) === Number(details.tabId);
    const matchesWindow = details.windowId && Number(state.workerWindowId) === Number(details.windowId);
    const transientBlock = ["paused", "blocked"].includes(state.status) && SourceVaultQueue.isTransientWorkerReason(state.blockedReason);
    if (!details.force && !matchesTab && !matchesWindow && !transientBlock) return state;
    outcome = SourceVaultQueue.recoverAfterWorkerLoss(state, {
      reason: details.reason || "Managed retrieval tab was closed.",
      failureKind: details.failureKind || null,
      retrySaving: details.retrySaving === true,
    });
    return outcome.state;
  });
  if (!outcome) return null;
  debugBroadcast("queue_worker_loss_reconciled", {
    action: outcome.action,
    queueItemId: outcome.queueItemId || null,
    tabId: details.tabId || null,
    windowId: details.windowId || null,
  });
  if (["retry", "failed", "failed_continue"].includes(outcome.action)) {
    await closeQueueOwnedChildTabs(outcome.queueItemId, details.tabId || null);
  }
  if (["retry", "failed_continue"].includes(outcome.action)) {
    scheduleRetrievalQueueRun(RETRIEVAL_QUEUE_WORKER_RECOVERY_DELAY_MS);
  }
  return outcome;
}


function isCurrentManagedQueueOwner(state, usage, tabId) {
  const active = SourceVaultQueue.getActiveItem(state);
  if (!active || SourceVaultQueue.isTerminalItem(active)) return false;
  if (!usage || usage.role !== "queue_worker") return false;
  if (Number(state.workerTabId) !== Number(tabId)) return false;
  if (String(state.activeItemId || "") !== String(usage.queueItemId || "")) return false;
  if (String(active.queueItemId || "") !== String(usage.queueItemId || "")) return false;
  if (
    usage.queueGeneration != null &&
    Number(usage.queueGeneration) !== Number(state.workerGeneration || 0)
  ) return false;
  return true;
}


async function markManagedQueueSourceLoginRequired(tabId, usage, currentUrl) {
  const source = SourceVaultSourceRegistry.get(usage.sourceKind);
  const label = source && source.displayName ? source.displayName : "source site";
  return mutateRetrievalQueue((state) => {
    if (!isCurrentManagedQueueOwner(state, usage, tabId)) return state;
    const active = SourceVaultQueue.getActiveItem(state);
    if (
      state.status === "action_required" &&
      active && active.state === "action_required" &&
      active.actionRequiredKind === "source_login" &&
      active.actionRequiredUrl === currentUrl
    ) return state;
    let next = SourceVaultQueue.updateItem(state, active.queueItemId, {
      state: "action_required",
      phase: "action_required",
      message: `Sign in to ${label} in the managed retrieval window.`,
      actionRequiredKind: "source_login",
      actionRequiredUrl: currentUrl || null,
      queueRunToken: null,
      error: null,
    });
    next = SourceVaultQueue.touchState(next, {
      status: "action_required",
      blockedReason: null,
    });
    return next;
  });
}


async function markManagedQueueSourcePageActionRequired(tabId, usage, currentUrl) {
  const returnFocus = await captureJannyReturnFocusTarget(null, tabId).catch(() => null);
  let marked = false;
  const state = await mutateRetrievalQueue((current) => {
    if (!isCurrentManagedQueueOwner(current, usage, tabId)) return current;
    const active = SourceVaultQueue.getActiveItem(current);
    if (
      current.status === "action_required" &&
      active && active.state === "action_required" &&
      active.actionRequiredKind === "source_page_action" &&
      active.actionRequiredUrl === currentUrl
    ) return current;
    let next = SourceVaultQueue.updateItem(current, active.queueItemId, {
      state: "action_required",
      phase: "action_required",
      message: "Continue in the opened source page.",
      actionRequiredKind: "source_page_action",
      actionRequiredUrl: currentUrl || null,
      actionReturnFocusTabId: returnFocus && returnFocus.tabId || null,
      actionReturnFocusWindowId: returnFocus && returnFocus.windowId || null,
      queueRunToken: null,
      error: null,
      failureKind: null,
    });
    next = SourceVaultQueue.touchState(next, {
      status: "action_required",
      blockedReason: null,
    });
    marked = true;
    return next;
  });
  if (marked) {
    const tab = await tabsGet(tabId).catch(() => null);
    if (tab) await focusManagedSourceTab(tab).catch(() => null);
  }
  return state;
}


async function resumeManagedQueueAfterSourceAction(tabId, usage, actionKind, options = {}) {
  let resumed = false;
  let returnFocus = null;
  const state = await mutateRetrievalQueue((current) => {
    if (!isCurrentManagedQueueOwner(current, usage, tabId)) return current;
    const active = SourceVaultQueue.getActiveItem(current);
    if (!active || (active.actionRequiredKind !== actionKind && options.force !== true)) return current;
    returnFocus = {
      returnFocusTabId: active.actionReturnFocusTabId || null,
      returnFocusWindowId: active.actionReturnFocusWindowId || null,
      jannyTabId: tabId,
      ownerTabId: tabId,
    };
    let next = SourceVaultQueue.updateItem(current, active.queueItemId, {
      state: "pending",
      phase: "queued",
      message: "Resuming retrieval.",
      actionRequiredKind: null,
      actionRequiredUrl: null,
      actionReturnFocusTabId: null,
      actionReturnFocusWindowId: null,
      queueRunToken: null,
      retrievalId: null,
      error: null,
    });
    next = SourceVaultQueue.touchState(next, {
      status: "running",
      activeItemId: null,
      blockedReason: null,
    });
    resumed = true;
    return next;
  });
  if (resumed && options.restoreFocus === true && returnFocus) {
    await restoreJannyReturnFocus(returnFocus).catch(() => null);
  }
  if (resumed && state.status === "running") scheduleRetrievalQueueRun(RETRIEVAL_QUEUE_WORKER_RECOVERY_DELAY_MS);
  return resumed;
}


async function resumeManagedQueueAfterSourceLogin(tabId, usage, options = {}) {
  return resumeManagedQueueAfterSourceAction(tabId, usage, "source_login", options);
}


async function resumeManagedQueueAfterSourcePageAction(tabId, usage, options = {}) {
  return resumeManagedQueueAfterSourceAction(tabId, usage, "source_page_action", {
    ...options,
    restoreFocus: options.restoreFocus !== false,
  });
}


async function handleManagedQueueTabNavigation(tabId, currentUrl, changeInfo = {}) {
  const key = `${tabId}:${String(currentUrl || "")}:${String(changeInfo.status || "")}`;
  if (managedQueueNavigationChecks.has(key)) return managedQueueNavigationChecks.get(key);
  const operation = (async () => {
    const usage = await getExtensionTabUsageAsync(tabId);
    if (!usage || usage.role !== "queue_worker") return { action: "ignored" };
    const state = await readRetrievalQueueState();
    if (!isCurrentManagedQueueOwner(state, usage, tabId)) {
      if (Number(state.workerTabId) !== Number(tabId)) forgetExtensionTabUsage(tabId);
      return { action: "stale" };
    }
    const expected = SourceVaultQueue.parseCharacterUrl(usage.launchUrl || "");
    const actual = SourceVaultQueue.parseCharacterUrl(currentUrl || "");
    const expectedMatch = (
      expected.valid && actual.valid &&
      expected.sourceKind === actual.sourceKind &&
      expected.characterId === actual.characterId
    );
    if (expectedMatch) {
      const active = SourceVaultQueue.getActiveItem(state);
      if (active && active.actionRequiredKind === "source_page_action") {
        if (changeInfo.status === "complete") {
          const readyState = await waitForSourceCharacterReady(
            tabId,
            active,
            Math.min(RETRIEVAL_QUEUE_PAGE_READY_MS, 15000),
          ).catch(() => null);
          if (readyState && !getSourceCharacterInterruption(readyState)) {
            const resumed = await resumeManagedQueueAfterSourcePageAction(tabId, usage);
            return { action: resumed ? "resumed" : "awaiting_source_page" };
          }
        }
        return { action: "awaiting_source_page" };
      }
      if (active && active.actionRequiredKind === "source_login") {
        if (changeInfo.status === "complete") {
          const sourceState = await readSourceTabState(tabId, { forceAuth: true }).catch(() => null);
          if (sourceState && sourceState.auth && sourceState.auth.loggedIn === true) {
            const resumed = await resumeManagedQueueAfterSourceLogin(tabId, usage);
            return { action: resumed ? "resumed" : "awaiting_source_login" };
          }
        }
        return { action: "awaiting_source_login" };
      }
      return { action: "assigned" };
    }
    const resolved = SourceVaultSourceRegistry.resolveUrl(currentUrl || "");
    if (resolved && resolved.sourceKind === usage.sourceKind) {
      if (changeInfo.status === "complete") {
        const sourceState = await readSourceTabState(tabId, { forceAuth: true }).catch(() => null);
        if (sourceState && sourceState.auth && sourceState.auth.loggedIn === true) {
          const resumed = await resumeManagedQueueAfterSourceLogin(tabId, usage, { force: true });
          if (resumed) return { action: "resumed" };
        }
      }
      await markManagedQueueSourceLoginRequired(tabId, usage, currentUrl);
      return { action: "source_login_required" };
    }
    const browserNetworkError = /^chrome-error:/i.test(String(currentUrl || ""));
    const outcome = await recoverManagedQueueWorkerLoss({
      tabId,
      windowId: usage.windowId || state.workerWindowId,
      reason: browserNetworkError ? "Source site could not be reached." : "Managed retrieval tab left its assigned source.",
      failureKind: browserNetworkError ? "source_unreachable" : "worker_unavailable",
    });
    if (usage.createdByExtension === true && usage.closableByExtension === true) {
      await closeExtensionCreatedTab(tabId, "queue_worker_replaced").catch(() => {});
    }
    return { action: outcome ? outcome.action : "stale" };
  })().finally(() => managedQueueNavigationChecks.delete(key));
  managedQueueNavigationChecks.set(key, operation);
  return operation;
}


function getQueueItemStallTimeoutMs(_item, settings = null) {
  const root = settings && typeof settings === "object" ? settings : {};
  return normalizeJobTimeoutMinutes(root.jobTimeoutMinutes) * 60 * 1000;
}


async function recoverStalledQueueItem(state) {
  const queue = SourceVaultQueue.normalizeState(state);
  const item = getQueueExecutingItem(queue);
  if (!item || ["paused", "blocked"].includes(queue.status)) return null;
  const settings = await readUploadSettings();
  const timeoutMs = getQueueItemStallTimeoutMs(item, settings);
  const startedAtMs = Date.parse(item.startedAt || item.updatedAt || "") || Date.now();
  if (Date.now() - startedAtMs < timeoutMs) return null;
  const returnFocus = {
    returnFocusTabId: item.actionReturnFocusTabId || null,
    returnFocusWindowId: item.actionReturnFocusWindowId || null,
    jannyTabId: queue.workerTabId || null,
    ownerTabId: queue.workerTabId || null,
  };
  const usage = queue.workerTabId ? await getExtensionTabUsageAsync(queue.workerTabId) : null;
  const timedOutState = await failQueueItem(item.queueItemId, "job_timeout", {
    failureKind: "job_timeout",
    publicMessage: getQueueFailureMessage("job_timeout"),
    queueRunToken: item.queueRunToken || null,
  });
  const timedOutItem = getQueueItemById(timedOutState, item.queueItemId);
  if (
    !timedOutItem ||
    timedOutItem.state !== "failed" ||
    timedOutItem.failureKind !== "job_timeout"
  ) {
    return null;
  }
  const failedState = await mutateRetrievalQueue((current) => {
    const next = SourceVaultQueue.updateItem(current, item.queueItemId, {
      actionRequiredKind: null,
      actionRequiredUrl: null,
      actionReturnFocusTabId: null,
      actionReturnFocusWindowId: null,
    });
    return SourceVaultQueue.touchState(next, {
      workerWindowId: Number(current.workerWindowId) === Number(queue.workerWindowId) ? null : current.workerWindowId,
      workerTabId: Number(current.workerTabId) === Number(queue.workerTabId) ? null : current.workerTabId,
    });
  });
  await closeQueueOwnedChildTabs(item.queueItemId, queue.workerTabId, {
    message: getQueueFailureMessage("job_timeout"),
    error: "job_timeout",
  }).catch(() => {});
  if (usage && usage.createdByExtension === true && usage.closableByExtension === true) {
    await closeExtensionCreatedTab(usage.tabId, "queue_job_timeout").catch(() => {});
  }
  await restoreJannyReturnFocus(returnFocus).catch(() => null);
  const action = failedState.status === "running" ? "failed_continue" : "failed";
  debugBroadcast("queue_stall_recovered", {
    queueItemId: item.queueItemId,
    state: item.state,
    failureKind: "job_timeout",
    timeoutMs,
    action,
  });
  return { action, queueItemId: item.queueItemId, state: failedState };
}


async function closeOrphanedManagedQueueTabs(state) {
  await hydrateTabUsageFromStorage();
  const queue = SourceVaultQueue.normalizeState(state);
  const active = SourceVaultQueue.getActiveItem(queue);
  const tasks = [];
  for (const [tabId, usage] of extensionTabUsage.entries()) {
    if (!usage || !isQueueManagedUsage(usage)) continue;
    if (usage.createdByExtension !== true || usage.closableByExtension !== true) continue;
    const ownsActiveWorker = usage.role === "queue_worker" && isCurrentManagedQueueOwner(queue, usage, tabId);
    const ownsActiveChild = (
      usage.role === "queue_janny" && active &&
      String(usage.queueItemId || "") === String(active.queueItemId || "") &&
      Number(usage.ownerTabId || 0) === Number(queue.workerTabId || 0)
    );
    if (ownsActiveWorker || ownsActiveChild) continue;
    tasks.push(closeExtensionCreatedTab(tabId, "orphaned_queue_tab_cleanup").catch(() => null));
  }
  const results = await Promise.all(tasks);
  return results.filter((result) => result && result.ok === true).length;
}


async function reconcileManagedQueueWorker(options = {}) {
  let state = await readRetrievalQueueState();
  const projection = SourceVaultQueue.buildProjection(state);
  if (!projection.counts.outstanding) {
    await closeOrphanedManagedQueueTabs(state);
    return state;
  }
  const stalled = await recoverStalledQueueItem(state);
  if (stalled) return readRetrievalQueueState();
  if (state.status === "waiting_connection") {
    const connectivity = await resumeQueueAfterConnectivityWait();
    state = connectivity.state;
    if (!connectivity.resumed) {
      await closeOrphanedManagedQueueTabs(state);
      return state;
    }
  }
  if (state.workerTabId) {
    const tab = await tabsGet(state.workerTabId).catch(() => null);
    if (!tab) {
      await recoverManagedQueueWorkerLoss({
        tabId: state.workerTabId,
        windowId: state.workerWindowId,
        reason: "Managed retrieval tab was unavailable.",
      });
      return readRetrievalQueueState();
    }
    const usage = await getExtensionTabUsageAsync(state.workerTabId);
    const active = SourceVaultQueue.getActiveItem(state);
    if (active && (!usage || usage.role !== "queue_worker")) {
      rememberExtensionTabUsage(tab, {
        role: "queue_worker",
        sourceKind: active.sourceKind,
        characterId: active.characterId,
        queueItemId: active.queueItemId,
        queueGeneration: Number(state.workerGeneration || 0),
        launchUrl: active.normalizedUrl,
        createdByExtension: true,
        closableByExtension: true,
      });
    }
    await handleManagedQueueTabNavigation(state.workerTabId, tab.pendingUrl || tab.url || null, { status: tab.status || null });
    state = await readRetrievalQueueState();
  }
  if (["paused", "blocked"].includes(state.status) && SourceVaultQueue.isTransientWorkerReason(state.blockedReason)) {
    await recoverManagedQueueWorkerLoss({ reason: state.blockedReason });
    return readRetrievalQueueState();
  }
  if (state.status === "running" && !state.activeItemId) scheduleRetrievalQueueRun(0);
  await closeOrphanedManagedQueueTabs(state);
  return state;
}


async function resumeQueueAfterLifecycle(reason) {
  let outcome = null;
  let staleWorkerTabId = null;
  const state = await mutateRetrievalQueue((current) => {
    const durableHold = ["paused", "blocked", "waiting_connection"].includes(current.status);
    const reconciled = SourceVaultQueue.reconcileInvariants(current, {
      requeueOrphaned: !current.activeItemId && current.status !== "waiting_connection",
      resume: !durableHold || SourceVaultQueue.isTransientWorkerReason(current.blockedReason),
    });
    const normalized = reconciled.state;
    const active = SourceVaultQueue.getActiveItem(normalized);
    if (!active) return normalized;
    staleWorkerTabId = normalized.workerTabId || null;
    outcome = SourceVaultQueue.recoverAfterWorkerLoss(normalized, {
      reason: reason || "Extension service worker restarted.",
      retrySaving: true,
    });
    return outcome.state;
  });
  if (state.status === "waiting_connection") {
    return (await resumeQueueAfterConnectivityWait()).state;
  }
  if (outcome && ["retry", "failed", "failed_continue"].includes(outcome.action)) {
    await closeQueueOwnedChildTabs(outcome.queueItemId, staleWorkerTabId);
    if (staleWorkerTabId) {
      const usage = await getExtensionTabUsageAsync(staleWorkerTabId);
      if (usage && usage.createdByExtension === true && usage.closableByExtension === true) {
        await closeExtensionCreatedTab(staleWorkerTabId, "queue_lifecycle_recovery").catch(() => {});
      }
    }
  }
  await closeOrphanedManagedQueueTabs(state);
  if ((outcome && ["retry", "failed_continue"].includes(outcome.action)) || (state.status === "running" && !state.activeItemId)) {
    scheduleRetrievalQueueRun(RETRIEVAL_QUEUE_WORKER_RECOVERY_DELAY_MS);
  }
  return state;
}
