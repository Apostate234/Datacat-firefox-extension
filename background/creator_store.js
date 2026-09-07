"use strict";
// background/creator_store.js — creator cache + creator/character retrieval
// Extracted from background.js in Phase 2 (mechanical move; behavior unchanged).
// Loaded in MV3 service-worker global scope via importScripts from background/index.js.
// Depends (global scope) on: constants.js, storage.js, datacat_client.js, thumbnails.js, tab_state.js, source_accounts.js, broadcasts.js

async function readCreatorStore() {
  const result = await storageGet({ [CREATOR_STORAGE_KEY]: {} });
  const store = result[CREATOR_STORAGE_KEY];
  return store && typeof store === "object" && !Array.isArray(store) ? store : {};
}

function buildCreatorCacheKey(sourceKind, fields) {
  const source = normalizeAnnouncementSourceKind(sourceKind);
  const root = fields && typeof fields === "object" ? fields : {};
  const id = SourceVaultCore.normalizeUuid(root.creatorId || root.id || root.userId);
  const handle = String(root.creatorHandle || root.handle || root.userName || "").replace(/^@+/, "").trim().toLowerCase();
  if (source === "janitor" && id) return `${source}::${id}`;
  if (source === "saucepan" && handle) return `${source}::${handle}`;
  if (source && id) return `${source}::${id}`;
  return null;
}

function normalizeCreatorRequest(input) {
  const root = input && typeof input === "object" ? input : {};
  let sourceKind = normalizeAnnouncementSourceKind(root.sourceKind || root.source);
  let creatorId = SourceVaultCore.normalizeUuid(root.creatorId || root.id || root.userId);
  let creatorHandle = String(root.creatorHandle || root.handle || root.userName || "").replace(/^@+/, "").trim();
  let normalizedUrl = String(root.url || root.profileUrl || "").trim() || null;
  const janitorParsed = SourceVaultCore.parseJanitorCreatorUrl(normalizedUrl || "");
  if (janitorParsed.valid) {
    sourceKind = "janitor";
    creatorId = janitorParsed.creatorId || creatorId;
    normalizedUrl = janitorParsed.normalizedUrl;
  }
  const saucepanParsed = SourceVaultCore.parseSaucepanCreatorUrl(normalizedUrl || creatorHandle || "");
  if (!janitorParsed.valid && saucepanParsed.valid) {
    sourceKind = "saucepan";
    creatorHandle = saucepanParsed.handle || creatorHandle;
    normalizedUrl = saucepanParsed.normalizedUrl;
  }
  if (!sourceKind && creatorId) sourceKind = "janitor";
  if (!sourceKind && creatorHandle) sourceKind = "saucepan";
  if (sourceKind === "janitor") {
    if (!creatorId) throw new Error("creator_missing_janitor_id");
    normalizedUrl = normalizedUrl || `https://janitorai.com/profiles/${creatorId}`;
  } else if (sourceKind === "saucepan") {
    if (!creatorHandle) throw new Error("creator_missing_saucepan_handle");
    normalizedUrl = normalizedUrl || `https://saucepan.ai/u/${encodeURIComponent(creatorHandle)}`;
  } else {
    throw new Error("creator_missing_source");
  }
  return {
    sourceKind,
    creatorId: creatorId || null,
    creatorHandle: creatorHandle || null,
    creatorName: firstNonEmpty(root.creatorName, root.name, root.displayName),
    normalizedUrl,
    key: buildCreatorCacheKey(sourceKind, { creatorId, creatorHandle }),
  };
}


function slugifyJanitorCharacterText(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return text || null;
}


function normalizeSourceCharacterUrlCandidate(value, sourceKind) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const pathLike = raw.startsWith("/") ? raw : /^(?:characters|companion)\//i.test(raw) ? `/${raw}` : null;
  if (!/^https?:\/\//i.test(raw) && !pathLike) return null;
  const kind = normalizeAnnouncementSourceKind(sourceKind);
  const baseUrl = kind === "saucepan"
    ? "https://saucepan.ai"
    : (pathLike || raw).startsWith("/companion/")
      ? "https://saucepan.ai"
      : "https://janitorai.com";
  try {
    return new URL(pathLike || raw, baseUrl).toString();
  } catch (_) {
    return raw;
  }
}


function buildJanitorCharacterOpenUrl(characterId, slugOrName) {
  const id = SourceVaultCore.normalizeUuid(characterId);
  if (!id) return null;
  const slug = slugifyJanitorCharacterText(slugOrName);
  if (!slug) return `https://janitorai.com/characters/${id}`;
  const suffix = slug.startsWith("character-") ? slug : `character-${slug}`;
  return `https://janitorai.com/characters/${id}_${suffix}`;
}


function normalizeCreatorCharacterRequest(input) {
  const root = input && typeof input === "object" ? input : {};
  let sourceKind = normalizeAnnouncementSourceKind(root.sourceKind || root.source);
  let characterId = SourceVaultCore.normalizeUuid(root.characterId || root.companionId || root.id || root.sourceId);
  const rawUrl = firstNonEmpty(
    root.url,
    root.characterUrl,
    root.character_url,
    root.companionUrl,
    root.companion_url,
    root.profileUrl,
    root.profile_url,
    root.sourceUrl,
    root.source_url,
    root.path,
  );
  let normalizedUrl = normalizeSourceCharacterUrlCandidate(rawUrl, sourceKind);
  const janitorParsed = SourceVaultCore.parseJanitorCharacterUrl(normalizedUrl || "");
  if (janitorParsed.valid) {
    sourceKind = "janitor";
    characterId = janitorParsed.characterId || characterId;
    normalizedUrl = normalizedUrl || janitorParsed.normalizedUrl;
  }
  const saucepanParsed = SourceVaultCore.parseSaucepanCompanionUrl(normalizedUrl || "");
  if (!janitorParsed.valid && saucepanParsed.valid) {
    sourceKind = "saucepan";
    characterId = saucepanParsed.companionId || characterId;
    normalizedUrl = normalizedUrl || saucepanParsed.normalizedUrl;
  }
  if (!sourceKind && characterId) sourceKind = root.companionId || String(root.sourceType || "").toLowerCase() === "companion" ? "saucepan" : "janitor";
  if (sourceKind === "janitor") {
    if (!characterId) throw new Error("character_missing_janitor_id");
    normalizedUrl = normalizedUrl || buildJanitorCharacterOpenUrl(characterId, firstNonEmpty(root.slug, root.public_slug, root.slugified_name, root.slugifiedName, root.name, root.title));
  } else if (sourceKind === "saucepan") {
    if (!characterId) throw new Error("character_missing_saucepan_id");
    normalizedUrl = normalizedUrl || `https://saucepan.ai/companion/${characterId}`;
  } else {
    throw new Error("character_missing_source");
  }
  return { sourceKind, characterId, normalizedUrl };
}


function getCreatorRecordFreshness(record) {
  const capturedAt = Date.parse((record && (record.updatedAt || record.capturedAt)) || "");
  const ageMs = Number.isFinite(capturedAt) && capturedAt > 0 ? Date.now() - capturedAt : Number.POSITIVE_INFINITY;
  const fresh = ageMs <= CREATOR_CACHE_TTL_MS;
  return {
    fresh,
    ageMs: Number.isFinite(ageMs) ? ageMs : null,
    ageLabel: Number.isFinite(ageMs) ? formatAgeLabel(ageMs) : "unknown",
    ttlMs: CREATOR_CACHE_TTL_MS,
  };
}


function getSaucepanCreatorRecordCompleteness(record) {
  const capture = record && record.capture && typeof record.capture === "object" ? record.capture : {};
  const characterList = capture.characterList && typeof capture.characterList === "object" ? capture.characterList : {};
  const characters = Array.isArray(characterList.characters) ? characterList.characters : [];
  const sourceMaterials = Array.isArray(capture.sourceMaterials) ? capture.sourceMaterials : [];
  const companionMaterials = sourceMaterials.filter((item) => {
    const type = String((item && (item.sourceType || item.source_type)) || "").toLowerCase();
    return type === "companion" || !!(item && (item.companionId || item.companion_id));
  });
  const raw = capture.raw && typeof capture.raw === "object" ? capture.raw : {};
  const rawV2 = raw.raw_user_companions_v2 && typeof raw.raw_user_companions_v2 === "object"
    ? raw.raw_user_companions_v2
    : null;
  const v2Total = rawV2 && Number.isFinite(Number(rawV2.total_count)) ? Number(rawV2.total_count) : null;
  return {
    success: capture.success === true,
    characterCount: characters.length,
    companionMaterialCount: companionMaterials.length,
    v2Total,
    v2Checked: !!rawV2 && Number.isFinite(Number(rawV2.total_count)),
  };
}


function isCreatorRecordUsable(record, request) {
  const sourceKind = normalizeAnnouncementSourceKind(
    (request && request.sourceKind) ||
      (record && record.sourceKind) ||
      (record && record.summary && record.summary.sourceKind),
  );
  const capture = record && record.capture && typeof record.capture === "object" ? record.capture : null;
  if (!capture || capture.success !== true) return false;
  if (sourceKind !== "saucepan") return true;
  const completeness = getSaucepanCreatorRecordCompleteness(record);
  if (completeness.characterCount > 0 || completeness.companionMaterialCount > 0) return true;
  if (completeness.v2Checked && completeness.v2Total === 0) return true;
  return false;
}


function getCreatorCaptureFailureMessage(capture) {
  const root = capture && typeof capture === "object" ? capture : {};
  return firstNonEmpty(
    root.userMessage,
    root.message,
    root.error,
    root.reason,
    root.status ? `HTTP ${root.status}` : null,
    "creator_capture_failed",
  );
}


function getCreatorProfileImageUrl(profile) {
  const image = profile && typeof profile.avatar === "object" ? profile.avatar : null;
  return firstNonEmpty(
    profile && profile.profileImageAssetUrl,
    profile && profile.avatarUrl,
    image && (image.highresUrl || image.cardUrl || image.thumbnailUrl || image.url),
    profile && typeof profile.avatar === "string" ? profile.avatar : null,
  ) || null;
}


function buildStoredCreatorRecord(sourceKind, capture, previous) {
  const normalizedSourceKind = normalizeAnnouncementSourceKind(sourceKind);
  const compactCapture = normalizedSourceKind === "saucepan"
    ? SourceVaultCore.compactSaucepanCreatorCapture(capture)
    : SourceVaultCore.compactJanitorCreatorCapture(capture);
  const profile = compactCapture && compactCapture.profile && typeof compactCapture.profile === "object" ? compactCapture.profile : {};
  const characterList = compactCapture && compactCapture.characterList && typeof compactCapture.characterList === "object" ? compactCapture.characterList : {};
  const creatorId = SourceVaultCore.normalizeUuid(firstNonEmpty(compactCapture.creatorId, profile.creatorId));
  const creatorHandle = firstNonEmpty(compactCapture.creatorHandle, profile.creatorHandle, profile.userName);
  const key = buildCreatorCacheKey(normalizedSourceKind, { creatorId, creatorHandle });
  if (!key) throw new Error("creator_record_missing_key");
  const name = firstNonEmpty(profile.displayName, profile.userName, compactCapture.creatorName, creatorHandle, creatorId);
  const description = compactText(firstNonEmpty(profile.aboutMeText, profile.bioText, profile.description), 280);
  const characters = Array.isArray(characterList.characters) ? characterList.characters : [];
  const capturedAt = compactCapture.capturedAt || (capture && capture.capturedAt) || new Date().toISOString();
  return {
    key,
    sourceKind: normalizedSourceKind,
    creatorId: creatorId || null,
    creatorHandle: creatorHandle || null,
    savedAt: previous && previous.savedAt ? previous.savedAt : capturedAt,
    capturedAt,
    updatedAt: new Date().toISOString(),
    summary: {
      sourceKind: normalizedSourceKind,
      creatorId: creatorId || null,
      creatorHandle: creatorHandle || null,
      name,
      profileUrl: firstNonEmpty(compactCapture.profileUrl, profile.profileUrl) || null,
      imageUrl: getCreatorProfileImageUrl(profile),
      description,
      characterTotal: characterList.total != null ? characterList.total : characters.length,
      charactersFetched: characters.length,
      pagesFetched: characterList.pagesFetched != null ? characterList.pagesFetched : null,
      truncated: characterList.truncated === true,
      capturedAt,
    },
    capture: compactCapture,
  };
}


async function saveCreatorRecord(sourceKind, capture) {
  const store = await readCreatorStore();
  const record = buildStoredCreatorRecord(sourceKind, capture, null);
  const previous = store[record.key] || null;
  const next = buildStoredCreatorRecord(sourceKind, capture, previous);
  store[next.key] = next;
  await storageSet({ [CREATOR_STORAGE_KEY]: store });
  broadcast({ type: MessageTypes.SV2_CREATOR_RECORD_UPDATED, record: next, freshness: getCreatorRecordFreshness(next) });
  cacheThumbnailsFromRecord(next).catch((error) => {
    console.warn("[SourceVaultV2] Thumbnail cache update failed:", normalizeError(error));
  });
  return next;
}


function parseSourceCreatorTab(tab, sourceKind) {
  const url = (tab && tab.url) || "";
  if (sourceKind === "saucepan") {
    const parsed = SourceVaultCore.parseSaucepanCreatorUrl(url);
    return parsed.valid ? { sourceKind: "saucepan", creatorHandle: parsed.handle, normalizedUrl: parsed.normalizedUrl } : null;
  }
  const parsed = SourceVaultCore.parseJanitorCreatorUrl(url);
  return parsed.valid ? { sourceKind: "janitor", creatorId: parsed.creatorId, normalizedUrl: parsed.normalizedUrl } : null;
}


async function findSourceCreatorTab(request) {
  const sourceKind = normalizeAnnouncementSourceKind(request && request.sourceKind);
  const tabs = await tabsQuery({
    url: sourceKind === "saucepan"
      ? ["https://saucepan.ai/u/*", "https://www.saucepan.ai/u/*"]
      : ["https://janitorai.com/profiles/*", "https://www.janitorai.com/profiles/*"],
  });
  if (sourceKind === "saucepan") {
    const wanted = String(request.creatorHandle || "").toLowerCase();
    return tabs.find((tab) => {
      const parsed = parseSourceCreatorTab(tab, sourceKind);
      return parsed && String(parsed.creatorHandle || "").toLowerCase() === wanted;
    }) || null;
  }
  const wanted = String(request.creatorId || "").toLowerCase();
  return tabs.find((tab) => {
    const parsed = parseSourceCreatorTab(tab, sourceKind);
    return parsed && String(parsed.creatorId || "").toLowerCase() === wanted;
  }) || null;
}


async function getOrCreateSourceCreatorTab(request) {
  const existing = await findSourceCreatorTab(request);
  if (existing && existing.id) {
    rememberExtensionTabUsage(existing, {
      role: "source_creator_profile",
      sourceKind: request.sourceKind || null,
      creatorId: request.creatorId || null,
      creatorKey: request.key || request.creatorHandle || request.creatorId || null,
      launchUrl: request.normalizedUrl || existing.url || null,
      currentUrl: existing.url || null,
      createdByExtension: false,
      closableByExtension: false,
    });
    return { tab: existing, created: false };
  }
  const tab = await tabsCreate({ url: request.normalizedUrl, active: false });
  const launchId = buildExtensionTabLaunchId("source_creator_profile", request.key || request.creatorHandle || request.creatorId, null);
  rememberExtensionTabUsage(tab, {
    role: "source_creator_profile",
    sourceKind: request.sourceKind || null,
    creatorId: request.creatorId || null,
    creatorKey: request.key || request.creatorHandle || request.creatorId || null,
    launchId,
    launchUrl: request.normalizedUrl || null,
    currentUrl: tab && tab.url ? tab.url : request.normalizedUrl || null,
    createdByExtension: true,
    closableByExtension: true,
  });
  return { tab, created: true, launchId };
}


function isExpectedSourceCharacterState(state, request) {
  const root = state && typeof state === "object" ? state : {};
  const page = root.page && typeof root.page === "object" ? root.page : {};
  const character = root.character && typeof root.character === "object" ? root.character : {};
  const expectedKind = normalizeAnnouncementSourceKind(request && request.sourceKind);
  const actualKind = normalizeAnnouncementSourceKind(page.sourceKind || character.sourceKind);
  if (!page.isCharacterPage) return false;
  if (expectedKind && actualKind && actualKind !== expectedKind) return false;
  const expectedId = SourceVaultCore.normalizeUuid(request && request.characterId);
  const actualId = SourceVaultCore.normalizeUuid(
    character.id ||
      character.characterId ||
      character.companionId ||
      page.characterId ||
      page.companionId,
  );
  if (expectedId && actualId && actualId !== expectedId) return false;
  if (expectedId && !actualId) return false;
  return SourceVaultCore.isSettledSourceCharacterState(expectedKind || actualKind, character, page);
}


function getSourceCharacterInterruption(state) {
  const root = state && typeof state === "object" ? state : {};
  const page = root.page && typeof root.page === "object" ? root.page : {};
  const interruption = page.sourceInterruption && typeof page.sourceInterruption === "object"
    ? page.sourceInterruption
    : null;
  if (page.interruptionDetected !== true && !(interruption && interruption.detected === true)) return null;
  return interruption || { detected: true, score: null, signals: [] };
}


async function waitForSourceCharacterReady(tabId, request, timeoutMs = 18000) {
  const deadline = Date.now() + Math.max(3000, Number(timeoutMs) || 18000);
  let lastError = null;
  let lastState = null;
  await sleep(1800);
  while (Date.now() < deadline) {
    try {
      const tab = await tabsGet(tabId);
      if (!tab || !tab.id) throw new Error("character_tab_closed");
      const state = await readSourceTabState(tabId, { forceAuth: false });
      lastState = state;
      const interruption = getSourceCharacterInterruption(state);
      if (interruption) {
        const error = new Error("source_page_action_required");
        error.state = state;
        error.sourceInterruption = interruption;
        throw error;
      }
      if (isExpectedSourceCharacterState(state, request)) return state;
    } catch (error) {
      if (normalizeError(error).toLowerCase().includes("source_page_action_required")) throw error;
      lastError = error;
    }
    await sleep(1000);
  }
  const error = new Error(lastError && lastError.message ? lastError.message : "source_character_page_not_ready");
  error.state = lastState;
  throw error;
}


async function assertSourceTabApproved(tab, sourceKind, existingState = null) {
  const state = existingState
    ? SourceVaultCore.sanitizeForTransport(existingState)
    : await readSourceTabState(tab.id, { forceAuth: true });
  const approvals = await readSourceAccountApprovals();
  const gate = getSourceAccountApprovalGate(state, approvals);
  if (!gate.allowed) {
    const error = new Error(gate.reason || "source_account_not_confirmed");
    error.accountApproval = gate;
    throw error;
  }
  if (sourceKind && normalizeAnnouncementSourceKind(state.page && state.page.sourceKind) !== sourceKind) {
    throw new Error("source_tab_kind_mismatch");
  }
  return state;
}


function broadcastCreatorLoadPhase(request, phase, message, options = {}) {
  const root = request && typeof request === "object" ? request : {};
  broadcast({
    type: MessageTypes.SV2_CREATOR_LOAD_PHASE,
    key: root.key || null,
    sourceKind: root.sourceKind || null,
    creatorId: root.creatorId || null,
    creatorHandle: root.creatorHandle || null,
    phase: options.clear === true ? null : phase || null,
    message: options.clear === true ? null : message || null,
    clear: options.clear === true,
  });
}


function getCreatorLoadPhaseFromState(state) {
  const root = state && typeof state === "object" ? state : {};
  const page = root.page && typeof root.page === "object" ? root.page : {};
  const retrieval = root.retrieval && typeof root.retrieval === "object" ? root.retrieval : {};
  if (page.isCreatorPage !== true) return null;
  const stage = String(retrieval.stage || "").trim().toLowerCase();
  const creatorStages = new Set([
    "creator",
    "creator_chars",
    "creator_done",
    "saucepan_creator_auth",
    "saucepan_creator",
    "saucepan_creator_page",
    "saucepan_creator_done",
  ]);
  if (!creatorStages.has(stage)) return null;
  const sourceKind = normalizeAnnouncementSourceKind(page.sourceKind);
  const request = normalizeCreatorRequest({
    sourceKind,
    creatorId: page.creatorId || null,
    creatorHandle: page.creatorHandle || null,
    url: page.normalizedUrl || page.url || null,
  });
  if (!request.key) return null;
  let phase = "profile";
  let message = sourceKind === "saucepan" ? "Reading Saucepan creator profile..." : "Reading Janitor creator profile...";
  if (stage.endsWith("_auth") || /checking .*login/i.test(String(retrieval.message || ""))) {
    phase = "account";
    message = sourceKind === "saucepan" ? "Checking Saucepan account..." : "Checking Janitor account...";
  } else if (stage === "creator_chars") {
    phase = "characters";
    message = "Loading creator characters...";
  } else if (stage === "saucepan_creator_page") {
    const logs = Array.isArray(retrieval.logs) ? retrieval.logs : [];
    const latest = logs.length ? logs[logs.length - 1] : null;
    phase = latest && latest.details && latest.details.material ? "materials" : "characters";
    message = phase === "materials" ? "Loading creator materials..." : "Loading creator characters...";
  } else if (stage.endsWith("_done")) {
    phase = "finishing";
    message = "Preparing creator view...";
  }
  return { request, phase, message };
}


const creatorRecordRequestsInFlight = new Map();

function joinCreatorRecordRequest(requestKey, factory) {
  const existingRequest = creatorRecordRequestsInFlight.get(requestKey);
  if (existingRequest) return existingRequest;
  const pendingRequest = Promise.resolve().then(factory);
  creatorRecordRequestsInFlight.set(requestKey, pendingRequest);
  pendingRequest.then(
    () => {
      if (creatorRecordRequestsInFlight.get(requestKey) === pendingRequest) {
        creatorRecordRequestsInFlight.delete(requestKey);
      }
    },
    () => {
      if (creatorRecordRequestsInFlight.get(requestKey) === pendingRequest) {
        creatorRecordRequestsInFlight.delete(requestKey);
      }
    },
  );
  return pendingRequest;
}

async function getOrRetrieveCreatorRecord(input, options = {}) {
  const request = normalizeCreatorRequest(input);
  if (!request.key) throw new Error("creator_missing_cache_key");
  return joinCreatorRecordRequest(request.key, () => retrieveCreatorRecord(request, options));
}

async function retrieveCreatorRecord(request, options = {}) {
  broadcastCreatorLoadPhase(request, "cache", "Checking saved creator details...");
  try {
  const syncedTab = options.syncActiveTab === true
    ? await getSyncedActiveSourceTab(request.normalizedUrl, options, {
        role: "source_creator_profile",
        sourceKind: request.sourceKind || null,
        creatorId: request.creatorId || null,
        creatorKey: request.key || request.creatorHandle || request.creatorId || null,
      })
    : null;
  const store = await readCreatorStore();
  const cached = store[request.key] || null;
  const cachedFreshness = getCreatorRecordFreshness(cached);
  const cachedUsable = cached ? isCreatorRecordUsable(cached, request) : false;
  if (cached && options.force !== true && cachedFreshness.fresh && cachedUsable) {
    return { ok: true, record: cached, cached: true, freshness: cachedFreshness };
  }
  if (cached && options.force !== true && cachedFreshness.fresh && !cachedUsable) {
    debugBroadcast("creator_cache_bypassed", {
      key: request.key,
      sourceKind: request.sourceKind,
      reason: "fresh_record_incomplete",
      saucepan: request.sourceKind === "saucepan" ? getSaucepanCreatorRecordCompleteness(cached) : null,
    });
  }
  broadcastCreatorLoadPhase(request, "page", "Opening creator page...");
  const { tab, created, closeWhenDone } = syncedTab || await getOrCreateSourceCreatorTab(request);
  if (!tab || !tab.id) throw new Error("creator_tab_unavailable");
  try {
    broadcastCreatorLoadPhase(request, "page", "Waiting for the creator page...");
    await waitForTabComplete(tab.id, 20000);
    broadcastCreatorLoadPhase(request, "account", `Checking ${request.sourceKind === "saucepan" ? "Saucepan" : "Janitor"} account...`);
    await assertSourceTabApproved(tab, request.sourceKind);
    broadcastCreatorLoadPhase(request, "profile", `Reading ${request.sourceKind === "saucepan" ? "Saucepan" : "Janitor"} creator profile...`);
    const response = await sendContentMessageWithInjection(tab.id, {
      type: MessageTypes.SV_RETRIEVE_CREATOR_PROFILE,
      creator: request,
    }, { attempts: 4 });
    if (!response || response.ok === false || !response.capture) {
      throw new Error(response && response.error ? response.error : "creator_capture_failed");
    }
    if (response.capture.success !== true) {
      throw new Error(getCreatorCaptureFailureMessage(response.capture));
    }
    const candidateRecord = buildStoredCreatorRecord(request.sourceKind, response.capture, cached);
    if (!isCreatorRecordUsable(candidateRecord, request)) {
      debugBroadcast("creator_capture_incomplete", {
        key: request.key,
        sourceKind: request.sourceKind,
        saucepan: request.sourceKind === "saucepan" ? getSaucepanCreatorRecordCompleteness(candidateRecord) : null,
      });
      throw new Error("creator_capture_incomplete");
    }
    broadcastCreatorLoadPhase(request, "finishing", "Preparing creator view...");
    const record = await saveCreatorRecord(request.sourceKind, response.capture);
    return { ok: true, record, cached: false, freshness: getCreatorRecordFreshness(record) };
  } finally {
    if (created && closeWhenDone !== false && tab.id) void closeExtensionCreatedTab(tab.id, "creator_profile_capture_finished");
  }
  } finally {
    broadcastCreatorLoadPhase(request, null, null, { clear: true });
  }
}


async function startCharacterRetrievalFromCreator(input, options = {}) {
  const request = normalizeCreatorCharacterRequest(input);
  const syncedTab = options.syncActiveTab === true
    ? await getSyncedActiveSourceTab(request.normalizedUrl, options, {
        role: "source_character_from_creator",
        sourceKind: request.sourceKind || null,
        characterId: request.characterId || null,
      })
    : null;
  const tab = syncedTab && syncedTab.tab ? syncedTab.tab : await tabsCreate({ url: request.normalizedUrl, active: true });
  if (!tab || !tab.id) throw new Error("character_tab_unavailable");
  const launchId = buildExtensionTabLaunchId("source_character_from_creator", request.characterId || request.normalizedUrl, null);
  rememberExtensionTabUsage(tab, {
    role: "source_character_from_creator",
    sourceKind: request.sourceKind || null,
    characterId: request.characterId || null,
    creatorId: request.creatorId || null,
    creatorKey: request.creatorKey || request.creatorHandle || request.creatorId || null,
    launchId,
    launchUrl: request.normalizedUrl || null,
    currentUrl: tab.pendingUrl || tab.url || request.normalizedUrl || null,
    createdByExtension: !syncedTab,
    closableByExtension: false,
  });
  await waitForTabComplete(tab.id, 25000);
  const readyState = await waitForSourceCharacterReady(tab.id, request, 20000);
  rememberExtensionTabUsage(tab, {
    role: "source_character_from_creator",
    sourceKind: request.sourceKind || null,
    characterId: request.characterId || null,
    creatorId: request.creatorId || null,
    creatorKey: request.creatorKey || request.creatorHandle || request.creatorId || null,
    launchId,
    launchUrl: request.normalizedUrl || null,
    currentUrl: tab.pendingUrl || tab.url || request.normalizedUrl || null,
    createdByExtension: !syncedTab,
    closableByExtension: false,
  });
  await assertSourceTabApproved(tab, request.sourceKind, readyState);
  await sleep(500);
  const uploadOptions = normalizeUploadOptions(options.uploadOptions || options.options || null, null);
  const response = await sendContentMessageWithInjection(tab.id, {
    type: MessageTypes.SV_START_RETRIEVAL,
    options: uploadOptions,
  }, { attempts: 4 });
  if (!response || response.ok === false) {
    const error = new Error(response && response.error ? response.error : "character_retrieval_start_failed");
    if (response && response.accountApproval) error.accountApproval = response.accountApproval;
    throw error;
  }
  return { ok: true, tabId: tab.id, url: request.normalizedUrl, state: response.state || null };
}
