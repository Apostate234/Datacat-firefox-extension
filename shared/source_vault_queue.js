(function initSourceVaultQueue(globalScope) {
  "use strict";

  const SCHEMA_VERSION = 1;
  const MAX_OUTSTANDING_ITEMS = 100;
  const MAX_TERMINAL_ITEMS = 200;
  const TERMINAL_STATES = new Set([
    "completed",
    "already_available",
    "failed",
    "cancelled",
  ]);

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeSourceKind(value) {
    const registry = globalScope && globalScope.SourceVaultSourceRegistry;
    if (registry && typeof registry.normalizeSourceId === "function") {
      const sourceId = registry.normalizeSourceId(value);
      if (sourceId) return sourceId;
    }
    const normalized = String(value || "").trim().toLowerCase();
    if (["janitor", "janitorai", "janny"].includes(normalized)) return "janitor";
    if (["sauce", "saucepan"].includes(normalized)) return "saucepan";
    return null;
  }

  function normalizeVisibility(value) {
    return String(value || "").trim().toLowerCase() === "mine" ? "mine" : "public";
  }

  function normalizeUuid(value) {
    const match = String(value || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return match ? match[0].toLowerCase() : null;
  }

  function compactText(value, maxLength) {
    const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    const limit = Math.max(20, Number(maxLength) || 200);
    return text.length > limit ? `${text.slice(0, limit - 3).trim()}...` : text;
  }

  function parseCharacterUrl(value) {
    let url;
    try {
      url = new URL(String(value || "").trim());
    } catch (_) {
      return { valid: false, error: "invalid_url", input: String(value || "") };
    }
    const registry = globalScope && globalScope.SourceVaultSourceRegistry;
    if (registry && typeof registry.resolveUrl === "function") {
      const resolved = registry.resolveUrl(url.toString());
      const sourceEntityId = resolved && (resolved.characterId || resolved.companionId);
      if (resolved && resolved.isCharacterPage && sourceEntityId) {
        return {
          valid: true,
          sourceKind: resolved.sourceKind,
          characterId: String(sourceEntityId),
          normalizedUrl: resolved.normalizedUrl || url.toString(),
        };
      }
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const characterId = normalizeUuid(url.pathname);
    if (host === "janitorai.com" && /\/(?:[a-z]{2}\/)?characters\//i.test(url.pathname) && characterId) {
      return {
        valid: true,
        sourceKind: "janitor",
        characterId,
        normalizedUrl: `https://janitorai.com/characters/${characterId}`,
      };
    }
    if (host === "saucepan.ai" && /^\/companion\//i.test(url.pathname) && characterId) {
      return {
        valid: true,
        sourceKind: "saucepan",
        characterId,
        normalizedUrl: `https://saucepan.ai/companion/${characterId}`,
      };
    }
    return { valid: false, error: "unsupported_character_url", input: url.toString() };
  }

  function buildItemKey(sourceKind, characterId) {
    const kind = normalizeSourceKind(sourceKind);
    const id = normalizeSourceEntityId(characterId, kind);
    return kind && id ? `${kind}:${id}` : null;
  }

  function normalizeSourceEntityId(value, sourceKind) {
    const uuid = normalizeUuid(value);
    if (uuid) return uuid;
    const kind = normalizeSourceKind(sourceKind);
    const text = String(value || "").trim().toLowerCase();
    return kind && /^[a-z0-9][a-z0-9._:@-]{0,199}$/i.test(text) ? text : null;
  }

  function buildRegisteredCharacterUrl(sourceKind, characterId) {
    const registry = globalScope && globalScope.SourceVaultSourceRegistry;
    const descriptor = registry && typeof registry.get === "function" ? registry.get(sourceKind) : null;
    const route = descriptor && Array.isArray(descriptor.routes)
      ? descriptor.routes.find((item) => item.type === "character")
      : null;
    return route && route.canonicalUrl
      ? route.canonicalUrl.replace("{id}", encodeURIComponent(characterId))
      : null;
  }

  function createQueueItem(input, options) {
    const root = input && typeof input === "object" ? input : { url: input };
    const opts = options && typeof options === "object" ? options : {};
    const parsed = parseCharacterUrl(root.normalizedUrl || root.url || root.characterUrl || "");
    const sourceKind = normalizeSourceKind(root.sourceKind) || (parsed.valid ? parsed.sourceKind : null);
    const characterId = normalizeSourceEntityId(
      root.characterId || root.companionId || (parsed.valid ? parsed.characterId : null),
      sourceKind,
    );
    const normalizedUrl = parsed.valid
      ? parsed.normalizedUrl
      : sourceKind === "janitor" && characterId
        ? `https://janitorai.com/characters/${characterId}`
        : sourceKind === "saucepan" && characterId
          ? `https://saucepan.ai/companion/${characterId}`
          : buildRegisteredCharacterUrl(sourceKind, characterId);
    if (!sourceKind || !characterId || !normalizedUrl) {
      return { valid: false, error: parsed.error || "queue_item_missing_source_identity", input: root };
    }
    const createdAt = root.enqueuedAt || opts.enqueuedAt || nowIso();
    const queueItemId = String(root.queueItemId || opts.queueItemId || `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
    return {
      valid: true,
      item: {
        queueItemId,
        key: buildItemKey(sourceKind, characterId),
        sourceKind,
        characterId,
        normalizedUrl,
        title: compactText(root.title || root.name || "", 140) || null,
        author: compactText(root.author || root.creatorName || root.creatorHandle || "", 100) || null,
        creatorId: normalizeUuid(root.creatorId),
        creatorHandle: compactText(root.creatorHandle || "", 100) || null,
        origin: String(root.origin || opts.origin || "manual"),
        visibility: normalizeVisibility(root.visibility || opts.visibility),
        requestedVisibility: normalizeVisibility(root.requestedVisibility || opts.requestedVisibility || root.visibility || opts.visibility),
        sourceVisibility: compactText(root.sourceVisibility || opts.sourceVisibility || "", 40).toLowerCase() || null,
        forceRetrieve: root.forceRetrieve === true || opts.forceRetrieve === true,
        localOnly: root.localOnly === true || opts.localOnly === true,
        state: "pending",
        phase: "queued",
        message: "Waiting in queue.",
        components: null,
        preflight: null,
        retrievalId: null,
        workerWindowId: null,
        workerTabId: null,
        attempt: 0,
        enqueuedAt: createdAt,
        startedAt: null,
        finishedAt: null,
        updatedAt: createdAt,
        viewUrl: null,
        resultCharacterId: null,
        warning: null,
        error: null,
      },
    };
  }

  function createInitialState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: 0,
      status: "idle",
      activeItemId: null,
      pauseAfterCurrent: false,
      blockedReason: null,
      connectionWait: null,
      workerWindowId: null,
      workerTabId: null,
      workerGeneration: 0,
      lastControlAction: null,
      lastRemovedKeys: [],
      items: [],
      updatedAt: nowIso(),
    };
  }

  function normalizeConnectionWait(value) {
    const root = value && typeof value === "object" ? value : null;
    if (!root) return null;
    const queueItemId = String(root.queueItemId || "").trim();
    const failureKind = String(root.failureKind || "").trim();
    const nextRetryAt = String(root.nextRetryAt || "").trim();
    if (!queueItemId || !failureKind || !Number.isFinite(Date.parse(nextRetryAt))) return null;
    return {
      queueItemId,
      failureKind,
      attempt: Math.max(1, Number(root.attempt) || 1),
      nextRetryAt,
      waitingSince: String(root.waitingSince || "").trim() || null,
    };
  }

  function normalizeItem(item) {
    const root = item && typeof item === "object" ? item : {};
    const created = createQueueItem(root, { queueItemId: root.queueItemId, enqueuedAt: root.enqueuedAt });
    if (!created.valid) return null;
    return {
      ...created.item,
      ...root,
      queueItemId: created.item.queueItemId,
      key: created.item.key,
      sourceKind: created.item.sourceKind,
      characterId: created.item.characterId,
      normalizedUrl: created.item.normalizedUrl,
      visibility: normalizeVisibility(root.visibility || created.item.visibility),
      state: String(root.state || "pending"),
      updatedAt: root.updatedAt || root.enqueuedAt || nowIso(),
    };
  }

  function normalizeState(value) {
    const root = value && typeof value === "object" ? value : {};
    const initial = createInitialState();
    const items = (Array.isArray(root.items) ? root.items : [])
      .map(normalizeItem)
      .filter(Boolean)
      // Successful outcomes are represented by the retrieved-character store.
      // Keeping a second queue copy creates stale pseudo-history after restarts.
      .filter((item) => !["completed", "already_available", "cancelled"].includes(item.state));
    return {
      ...initial,
      ...root,
      schemaVersion: SCHEMA_VERSION,
      revision: Math.max(0, Number(root.revision) || 0),
      status: String(root.status || initial.status),
      activeItemId: root.activeItemId ? String(root.activeItemId) : null,
      pauseAfterCurrent: root.pauseAfterCurrent === true,
      connectionWait: normalizeConnectionWait(root.connectionWait),
      lastControlAction: root.lastControlAction ? String(root.lastControlAction) : null,
      lastRemovedKeys: Array.isArray(root.lastRemovedKeys) ? root.lastRemovedKeys.filter(Boolean).map(String) : [],
      items,
    };
  }

  function isTerminalItem(item) {
    return TERMINAL_STATES.has(String(item && item.state || ""));
  }

  function getOutstandingItems(state) {
    return normalizeState(state).items.filter((item) => !isTerminalItem(item));
  }

  function getActiveItem(state) {
    const root = normalizeState(state);
    return root.items.find((item) => item.queueItemId === root.activeItemId) || null;
  }

  function touchState(state, patch) {
    const root = normalizeState(state);
    return {
      ...root,
      ...(patch || {}),
      revision: root.revision + 1,
      updatedAt: nowIso(),
    };
  }

  function trimTerminalItems(items) {
    const terminal = [];
    const outstanding = [];
    for (const item of items || []) {
      if (isTerminalItem(item)) terminal.push(item);
      else outstanding.push(item);
    }
    terminal.sort((a, b) => String(b.finishedAt || b.updatedAt || "").localeCompare(String(a.finishedAt || a.updatedAt || "")));
    return [
      ...outstanding,
      ...terminal.filter((item) => item.state === "failed").slice(0, MAX_TERMINAL_ITEMS),
    ];
  }

  function addItems(state, inputs, options) {
    const root = normalizeState(state);
    const opts = options && typeof options === "object" ? options : {};
    const outstanding = getOutstandingItems(root);
    const activeKeys = new Set(outstanding.map((item) => item.key).filter(Boolean));
    const capacity = Math.max(0, MAX_OUTSTANDING_ITEMS - outstanding.length);
    const added = [];
    const duplicates = [];
    const invalid = [];
    const overflow = [];
    for (const input of Array.isArray(inputs) ? inputs : [inputs]) {
      const created = createQueueItem(input, opts);
      if (!created.valid) {
        invalid.push({ input, error: created.error });
        continue;
      }
      if (activeKeys.has(created.item.key)) {
        duplicates.push(created.item);
        continue;
      }
      if (added.length >= capacity) {
        overflow.push(created.item);
        continue;
      }
      activeKeys.add(created.item.key);
      added.push(created.item);
    }
    const addedKeys = new Set(added.map((item) => item.key).filter(Boolean));
    const retainedItems = root.items.filter((item) => !(isTerminalItem(item) && addedKeys.has(item.key)));
    const next = added.length
      ? touchState(root, {
          items: trimTerminalItems([...retainedItems, ...added]),
          status: root.status === "idle" ? "running" : root.status,
          blockedReason: root.status === "idle" ? null : root.blockedReason,
          lastControlAction: null,
          lastRemovedKeys: [],
        })
      : root;
    return { state: next, added, duplicates, invalid, overflow, capacity };
  }

  function updateItem(state, queueItemId, patch) {
    const root = normalizeState(state);
    let changed = false;
    const items = root.items.map((item) => {
      if (item.queueItemId !== queueItemId) return item;
      changed = true;
      return { ...item, ...(patch || {}), updatedAt: nowIso() };
    });
    return changed ? touchState(root, { items: trimTerminalItems(items) }) : root;
  }

  function moveNext(state, queueItemId) {
    const root = normalizeState(state);
    const wanted = root.items.find((item) => item.queueItemId === queueItemId);
    if (!wanted || wanted.state !== "pending") return root;
    const items = root.items.filter((item) => item.queueItemId !== queueItemId);
    const activeIndex = root.activeItemId ? items.findIndex((item) => item.queueItemId === root.activeItemId) : -1;
    items.splice(activeIndex >= 0 ? activeIndex + 1 : 0, 0, wanted);
    return touchState(root, { items });
  }

  function removeItem(state, queueItemId) {
    const root = normalizeState(state);
    const item = root.items.find((candidate) => candidate.queueItemId === queueItemId);
    if (!item || item.queueItemId === root.activeItemId || item.state !== "pending") return root;
    return touchState(root, { items: root.items.filter((candidate) => candidate.queueItemId !== queueItemId) });
  }

  function clearFinished(state) {
    const root = normalizeState(state);
    return touchState(root, { items: root.items.filter((item) => !isTerminalItem(item)) });
  }

  function isTransientWorkerReason(value) {
    const reason = String(value || "").trim().toLowerCase();
    return (
      reason.includes("managed retrieval tab") ||
      reason.includes("managed retrieval window") ||
      reason.includes("extension update") ||
      reason.includes("extension reload") ||
      reason.includes("chrome restart") ||
      reason.includes("service worker")
    );
  }

  function reconcileInvariants(state, options) {
    const opts = options && typeof options === "object" ? options : {};
    let root = normalizeState(state);
    let active = getActiveItem(root);
    const outstanding = getOutstandingItems(root);

    // Terminal history must never keep a stale global block visible.
    if (!outstanding.length) {
      const alreadyIdle = (
        root.status === "idle" &&
        !root.activeItemId &&
        root.pauseAfterCurrent !== true &&
        !root.blockedReason
      );
      return {
        action: alreadyIdle ? "none" : "idle",
        changed: !alreadyIdle,
        state: alreadyIdle ? root : touchState(root, {
          status: "idle",
          activeItemId: null,
          pauseAfterCurrent: false,
          blockedReason: null,
          connectionWait: null,
        }),
      };
    }

    if (active && isTerminalItem(active)) active = null;
    const activeMissing = !!root.activeItemId && !active;
    const transientHold = isTransientWorkerReason(root.blockedReason);
    const shouldRecoverOrphans = opts.requeueOrphaned === true || transientHold;
    let changed = false;

    if (activeMissing) {
      root = touchState(root, { activeItemId: null });
      changed = true;
    }

    if (!active && shouldRecoverOrphans) {
      for (const item of root.items) {
        if (isTerminalItem(item) || item.state === "pending") continue;
        root = updateItem(root, item.queueItemId, {
          state: "pending",
          phase: "queued",
          message: "Resuming retrieval.",
          error: null,
          retrievalId: null,
          queueRunToken: null,
          workerWindowId: null,
          workerTabId: null,
        });
        changed = true;
      }
    }

    const pendingWork = getOutstandingItems(root).some((item) => item.state === "pending" || item.state === "interrupted");
    const durableHold = ["paused", "blocked", "waiting_connection"].includes(root.status);
    if (!active && pendingWork && (transientHold || opts.resume === true || !durableHold)) {
      if (root.status !== "running" || root.blockedReason || root.pauseAfterCurrent === true) {
        root = touchState(root, {
          status: "running",
          activeItemId: null,
          pauseAfterCurrent: false,
          blockedReason: null,
          connectionWait: null,
        });
        changed = true;
      }
    }

    return { action: changed ? "reconciled" : "none", changed, state: root };
  }

  function recoverAfterWorkerLoss(state, options) {
    const opts = options && typeof options === "object" ? options : {};
    const reason = compactText(opts.reason || "Managed retrieval tab was closed.", 240);
    const nowMs = Number.isFinite(Number(opts.nowMs)) ? Number(opts.nowMs) : Date.now();
    const now = new Date(nowMs).toISOString();
    const maxRecoveries = Math.max(1, Number(opts.maxRecoveries) || 3);
    const recoveryWindowMs = Math.max(1000, Number(opts.recoveryWindowMs) || 60000);
    let root = reconcileInvariants(state).state;
    let active = getActiveItem(root);
    const transientWorkerHold = ["paused", "blocked"].includes(root.status) && isTransientWorkerReason(root.blockedReason);

    if (transientWorkerHold) {
      for (const item of root.items) {
        if (item.state !== "interrupted") continue;
        root = updateItem(root, item.queueItemId, {
          state: "pending",
          phase: "queued",
          message: "Reopening managed retrieval tab.",
          error: null,
          queueRunToken: null,
          workerWindowId: null,
          workerTabId: null,
        });
      }
      active = getActiveItem(root);
    }

    const outstanding = getOutstandingItems(root);
    if (!active || isTerminalItem(active)) {
      const pendingWork = outstanding.some((item) => item.state === "pending" || item.state === "interrupted");
      const preserveHold = !transientWorkerHold && ["paused", "blocked", "waiting_connection"].includes(root.status) && pendingWork;
      return {
        action: preserveHold ? "hold" : pendingWork ? "retry" : "idle",
        queueItemId: null,
        state: touchState(root, {
          activeItemId: null,
          workerWindowId: null,
          workerTabId: null,
          status: preserveHold ? root.status : pendingWork ? "running" : "idle",
          blockedReason: preserveHold ? root.blockedReason : null,
        }),
      };
    }

    if (["paused", "blocked", "waiting_connection"].includes(root.status) && !transientWorkerHold) {
      return {
        action: "hold",
        queueItemId: active.queueItemId,
        state: touchState(root, { workerWindowId: null, workerTabId: null }),
      };
    }

    if (["preparing", "saving"].includes(active.state) && opts.retrySaving !== true) {
      return {
        action: "wait_for_save",
        queueItemId: active.queueItemId,
        state: touchState(root, {
          workerWindowId: null,
          workerTabId: null,
          status: root.status === "pausing" ? "pausing" : "running",
          blockedReason: null,
        }),
      };
    }

    const previousRecoveryAt = Date.parse(active.workerRecoveryAt || "") || 0;
    const previousCount = nowMs - previousRecoveryAt <= recoveryWindowMs ? Number(active.workerRecoveryCount || 0) : 0;
    const workerRecoveryCount = previousCount + 1;
    if (workerRecoveryCount > maxRecoveries) {
      let next = updateItem(root, active.queueItemId, {
        state: "failed",
        phase: "failed",
        message: reason || "Retrieval stopped after repeated managed-tab failures.",
        error: reason,
        failureKind: String(opts.failureKind || "worker_unavailable"),
        finishedAt: now,
        queueRunToken: null,
        workerRecoveryCount,
        workerRecoveryAt: now,
        workerWindowId: null,
        workerTabId: null,
      });
      const pendingWork = next.items.some((item) => item.queueItemId !== active.queueItemId && item.state === "pending");
      next = touchState(next, {
        activeItemId: null,
        workerWindowId: null,
        workerTabId: null,
        status: pendingWork ? "running" : "idle",
        pauseAfterCurrent: false,
        blockedReason: null,
      });
      return { action: pendingWork ? "failed_continue" : "failed", queueItemId: active.queueItemId, state: next };
    }

    let next = updateItem(root, active.queueItemId, {
      state: "pending",
      phase: "queued",
      message: "Reopening managed retrieval tab.",
      error: null,
      retrievalId: null,
      queueRunToken: null,
      workerRecoveryCount,
      workerRecoveryAt: now,
      lastFailureKind: opts.failureKind ? String(opts.failureKind) : null,
      lastFailure: reason,
      workerWindowId: null,
      workerTabId: null,
    });
    next = touchState(next, {
      activeItemId: null,
      workerWindowId: null,
      workerTabId: null,
      status: "running",
      blockedReason: null,
    });
    return { action: "retry", queueItemId: active.queueItemId, state: next };
  }

  function getPublicPhase(item) {
    const state = String(item && item.state || "pending");
    if (state === "pending") return "Waiting in queue";
    if (state === "checking" || state === "loading") return "Starting retrieval";
    if (state === "reading") return "Collecting source data";
    if (state === "action_required") return "Source action required";
    if (state === "preparing" || state === "saving") return "Processing result";
    if (state === "already_available") return "Already available";
    if (state === "completed") return "Done";
    if (state === "failed") return "Failed";
    if (state === "interrupted") return "Interrupted";
    return compactText(item && item.message, 80) || "Working";
  }

  function buildProjection(state) {
    const root = normalizeState(state);
    const active = getActiveItem(root);
    const outstanding = root.items.filter((item) => !isTerminalItem(item));
    const pending = root.items.filter((item) => item.state === "pending" || item.state === "interrupted");
    const finished = root.items.filter(isTerminalItem).sort((a, b) => String(b.finishedAt || b.updatedAt || "").localeCompare(String(a.finishedAt || a.updatedAt || "")));
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: root.revision,
      status: root.status,
      pauseAfterCurrent: root.pauseAfterCurrent,
      blockedReason: root.blockedReason || null,
      connectionWait: root.connectionWait ? { ...root.connectionWait } : null,
      activeItemId: root.activeItemId,
      activeItem: active ? { ...active, publicPhase: getPublicPhase(active) } : null,
      pending,
      finished,
      counts: {
        outstanding: outstanding.length,
        pending: pending.length,
        finished: finished.length,
        total: root.items.length,
      },
      worker: {
        windowId: root.workerWindowId || null,
        tabId: root.workerTabId || null,
        generation: Number(root.workerGeneration || 0),
      },
      control: {
        action: root.lastControlAction || null,
        removedKeys: Array.isArray(root.lastRemovedKeys) ? root.lastRemovedKeys.filter(Boolean) : [],
      },
      updatedAt: root.updatedAt || null,
    };
  }

  const api = {
    SCHEMA_VERSION,
    MAX_OUTSTANDING_ITEMS,
    TERMINAL_STATES,
    addItems,
    buildItemKey,
    buildProjection,
    clearFinished,
    createInitialState,
    createQueueItem,
    getActiveItem,
    getOutstandingItems,
    getPublicPhase,
    isTransientWorkerReason,
    isTerminalItem,
    moveNext,
    normalizeSourceKind,
    normalizeState,
    parseCharacterUrl,
    reconcileInvariants,
    recoverAfterWorkerLoss,
    removeItem,
    touchState,
    updateItem,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.SourceVaultQueue = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
