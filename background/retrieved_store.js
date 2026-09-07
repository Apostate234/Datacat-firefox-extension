"use strict";
// background/retrieved_store.js — saved characters + upload lifecycle
// Extracted from background.js in Phase 2 (mechanical move; behavior unchanged).
// Loaded in MV3 service-worker global scope via importScripts from background/index.js.
// Depends (global scope) on: constants.js, storage.js, datacat_client.js, thumbnails.js, broadcasts.js

async function readRetrievedStore() {
  const result = await storageGet({ [RETRIEVED_STORAGE_KEY]: {} });
  const store = result[RETRIEVED_STORAGE_KEY];
  return store && typeof store === "object" && !Array.isArray(store) ? store : {};
}

async function migrateStoredExtractionPersonaAliases() {
  const cleanupVersion = await getExtractionPersonaCleanupVersion();
  if (cleanupVersion >= EXTRACTION_PERSONA_CONTENT_CLEANUP_VERSION) {
    return { migrated: false, updatedCount: 0, cleanupVersion };
  }
  const store = await readRetrievedStore();
  let updatedCount = 0;
  for (const [key, record] of Object.entries(store)) {
    if (!record || typeof record !== "object") continue;
    const cleaned = SourceVaultCore.scrubStoredRetrievedCharacterPersonaAliases(record);
    if (JSON.stringify(cleaned) === JSON.stringify(record)) continue;
    store[key] = cleaned;
    updatedCount += 1;
  }
  if (updatedCount) await storageSet({ [RETRIEVED_STORAGE_KEY]: store });
  const nextVersion = await markExtractionPersonaCleanupComplete();
  return { migrated: true, updatedCount, cleanupVersion: nextVersion };
}

function findRetrievedStoreEntry(store, characterId, sourceKind = null) {
  const root = store && typeof store === "object" ? store : {};
  const id = SourceVaultCore.normalizeUuid(characterId);
  if (!id) return null;
  if (root[id]) return { key: id, record: root[id] };
  const normalizedSource = typeof SourceVaultCore.normalizeSourceKind === "function"
    ? SourceVaultCore.normalizeSourceKind(sourceKind)
    : String(sourceKind || "").trim().toLowerCase();
  const canonicalKey = normalizedSource ? `${normalizedSource}:character:${id}` : null;
  if (canonicalKey && root[canonicalKey]) return { key: canonicalKey, record: root[canonicalKey] };
  for (const [key, record] of Object.entries(root)) {
    if (!record || SourceVaultCore.normalizeUuid(record.id) !== id) continue;
    const recordSource = SourceVaultCore.normalizeSourceKind(
      record.summary && record.summary.sourceKind || record.sourceKind,
    );
    if (normalizedSource && recordSource && recordSource !== normalizedSource) continue;
    return { key, record };
  }
  return null;
}

function buildRetrievedPrivateVaultViewUrl(record) {
  const sourceVisibility = getRetrievedSourceVisibility(record);
  if (sourceVisibility !== "private" && sourceVisibility !== "unlisted") return null;
  const id = SourceVaultCore.normalizeUuid(record && record.id);
  const sourceKind = SourceVaultCore.normalizeSourceKind(
    record && record.summary && record.summary.sourceKind || record && record.sourceKind,
  );
  if (!id || (sourceKind !== "janitor" && sourceKind !== "saucepan")) return null;
  const sourceSegment = sourceKind === "saucepan" ? "sauce" : "janitor";
  return `/characters/vault/${sourceSegment}/${encodeURIComponent(id)}`;
}

function listRetrievedCharactersFromStore(store) {
  return Object.values(store || {})
    .filter((item) => item && item.id && item.summary)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .map((item) => {
      const upload = item.upload && typeof item.upload === "object" ? item.upload : null;
      const privateVaultViewUrl = buildRetrievedPrivateVaultViewUrl(item);
      return {
        id: item.id,
        savedAt: item.savedAt || null,
        updatedAt: item.updatedAt || null,
        summary: item.summary,
        upload: upload && privateVaultViewUrl
          ? { ...upload, viewUrl: privateVaultViewUrl }
          : upload,
      };
    });
}


async function updateRetrievedUploadState(characterId, patch) {
  const id = SourceVaultCore.normalizeUuid(characterId);
  if (!id) return null;
  const store = await readRetrievedStore();
  const entry = findRetrievedStoreEntry(store, id);
  if (!entry) return null;
  const record = entry.record;
  record.upload = {
    ...(record.upload || {}),
    ...(patch || {}),
    updatedAt: new Date().toISOString(),
  };
  store[entry.key] = record;
  await storageSet({ [RETRIEVED_STORAGE_KEY]: store });
  broadcast({
    type: MessageTypes.SV2_UPLOAD_STATUS_UPDATED,
    characterId: id,
    upload: record.upload,
    list: listRetrievedCharactersFromStore(store),
    item: record,
  });
  handleRetrievalQueueUploadState(id, record).catch((error) => {
    console.warn("[SourceVaultV2] Queue upload state update failed:", normalizeError(error));
  });
  return record;
}


function buildUploadIdempotencyKey(record) {
  const sourceKind = record && record.summary && record.summary.sourceKind
    ? record.summary.sourceKind
    : "unknown";
  return [
    EXTENSION_VARIANT,
    sourceKind,
    record && record.id ? record.id : "unknown",
    record && (record.updatedAt || record.savedAt) ? (record.updatedAt || record.savedAt) : "unsaved",
  ].join(":");
}

function normalizeRetrievedSourceVisibility(value) {
  if (value === false) return "private";
  if (value === true) return "public";
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  if (["private", "owner", "mine", "only_me", "only-me"].includes(normalized)) return "private";
  if (["unlisted", "link_only", "link-only"].includes(normalized)) return "unlisted";
  if (["public", "published", "listed"].includes(normalized)) return "public";
  return "unknown";
}

function getRetrievedSourceVisibility(record) {
  const root = record && typeof record === "object" ? record : {};
  const capture = root.capture && typeof root.capture === "object" ? root.capture : {};
  const summary = root.summary && typeof root.summary === "object" ? root.summary : {};
  const janitorCharacter = capture.janitorCore && capture.janitorCore.character || {};
  const janitorRaw = janitorCharacter.rawCharacter || {};
  const saucepanCompanion = capture.saucepanCore && capture.saucepanCore.companion || {};
  const saucepanRaw = saucepanCompanion.rawCompanion || {};
  const candidates = [
    summary.sourceVisibility,
    summary.source_visibility,
    janitorCharacter.visibility,
    janitorCharacter.accessLevel,
    janitorCharacter.access_level,
    janitorCharacter.isPublic,
    janitorCharacter.is_public,
    janitorRaw.visibility,
    janitorRaw.access_level,
    janitorRaw.is_public,
    saucepanCompanion.visibility,
    saucepanCompanion.accessLevel,
    saucepanCompanion.access_level,
    saucepanCompanion.isPublic,
    saucepanCompanion.is_public,
    saucepanRaw.visibility,
    saucepanRaw.access_level,
    saucepanRaw.is_public,
  ];
  let resolved = "unknown";
  for (const value of candidates) {
    const normalized = normalizeRetrievedSourceVisibility(value);
    if (normalized === "private") return "private";
    if (normalized === "unlisted") resolved = "unlisted";
    else if (normalized === "public" && resolved === "unknown") resolved = "public";
  }
  return resolved;
}


function normalizeUploadOptions(options, record) {
  const storedOptions = record && record.uploadOptions && typeof record.uploadOptions === "object"
    ? record.uploadOptions
    : {};
  const safeStoredOptions = { ...storedOptions };
  const safeOptions = options && typeof options === "object" ? { ...options } : {};
  delete safeStoredOptions.updateDatacat;
  delete safeStoredOptions.update_datacat;
  delete safeOptions.updateDatacat;
  delete safeOptions.update_datacat;
  const hasLocalOnlyOption = !!(options && typeof options === "object" && Object.prototype.hasOwnProperty.call(options, "localOnly"));
  const requestedVisibility = normalizeUploadVisibility(
    (options && (options.requestedVisibility || options.visibility)) ||
      storedOptions.requestedVisibility ||
      storedOptions.visibility ||
      DEFAULT_UPLOAD_VISIBILITY,
  );
  const sourceVisibility = getRetrievedSourceVisibility(record);
  const forcedPrivate = sourceVisibility === "private" || sourceVisibility === "unlisted";
  const preflight =
    (options && options.preflight && typeof options.preflight === "object" ? options.preflight : null) ||
    (storedOptions.preflight && typeof storedOptions.preflight === "object" ? storedOptions.preflight : null);
  const requestedLocalOnly = hasLocalOnlyOption ? options.localOnly === true : storedOptions.localOnly === true;
  const privateNeedsOwnerUpload = forcedPrivate && preflight?.existing?.exists === true && preflight.existing.ownerVisible !== true;
  return {
    ...safeStoredOptions,
    ...safeOptions,
    visibility: forcedPrivate ? "mine" : requestedVisibility,
    requestedVisibility,
    sourceVisibility,
    visibilityForcedPrivate: forcedPrivate,
    forceRetrieve: (options && options.forceRetrieve) === true || storedOptions.forceRetrieve === true,
    localOnly: requestedLocalOnly && !privateNeedsOwnerUpload,
    preflight,
  };
}


async function pollUploadStatus(characterId, uploadId, attempt) {
  const id = SourceVaultCore.normalizeUuid(characterId);
  const normalizedUploadId = SourceVaultCore.normalizeUuid(uploadId);
  const nextAttempt = Number.isFinite(attempt) ? attempt : 0;
  if (!id || !normalizedUploadId || nextAttempt > 6) return;
  try {
    const config = await readDatacatConfig();
    const { response, json } = await fetchDatacatJson(config, `${DATACAT_UPLOAD_STATUS_PATH}/${normalizedUploadId}/status`, {
      method: "GET",
    });
    if (response.ok && json && json.success !== false) {
      await updateRetrievedUploadState(id, {
        status: json.persistence && json.persistence.status === "saved" ? "uploaded" : "uploading",
        uploadId: normalizedUploadId,
        datacatCharacterId: json.characterId || null,
        viewUrl: json.viewUrl || null,
        persistenceStatus: json.persistence && json.persistence.status ? json.persistence.status : null,
        mirrorStatus: json.downstream && json.downstream.mediaMirror ? json.downstream.mediaMirror : null,
        scoringStatus: json.downstream && json.downstream.scoring ? json.downstream.scoring : null,
        scoringReason: json.downstream && json.downstream.scoringReason ? json.downstream.scoringReason : null,
        creatorStatus: json.downstream && json.downstream.creator ? json.downstream.creator : null,
        components: json.components || null,
        visibility: json.visibility || null,
        message: "Datacat status updated.",
        error: json.persistence && json.persistence.error ? json.persistence.error : null,
      });
      const downstream = json.downstream || {};
      const stillPending = ["queued", "pending", "captured", null, undefined].includes(downstream.mediaMirror) ||
        ["queued", "pending", null, undefined].includes(downstream.scoring) ||
        ["queued", "pending", "captured", null, undefined].includes(downstream.creator);
      if (stillPending && nextAttempt < 6) {
        setTimeout(() => pollUploadStatus(id, normalizedUploadId, nextAttempt + 1), 15000);
      }
    }
  } catch (error) {
    if (nextAttempt < 2) {
      setTimeout(() => pollUploadStatus(id, normalizedUploadId, nextAttempt + 1), 15000);
    }
  }
}


async function uploadRetrievedCharacter(record, reason, options) {
  if (!record || !record.id) throw new Error("upload_missing_record");
  const uploadOptions = normalizeUploadOptions(options, record);
  await updateRetrievedUploadState(record.id, {
    status: "checking_datacat",
    reason: reason || "auto",
    visibility: uploadOptions.visibility,
    forceRetrieve: uploadOptions.forceRetrieve,
    message: "Checking Datacat session...",
  });
  const datacatState = await readDatacatState();
  if (!datacatState.canUpload) {
    await updateRetrievedUploadState(record.id, {
      status: "session_required",
      reason: reason || "auto",
      origin: datacatState.origin,
      visibility: uploadOptions.visibility,
      forceRetrieve: uploadOptions.forceRetrieve,
      message: datacatState.message || "Connect Datacat to save.",
      error: null,
    });
    return { skipped: true, reason: "datacat_session_required", state: datacatState };
  }

  const config = await readDatacatConfig();
  await updateRetrievedUploadState(record.id, {
    status: "uploading",
    origin: config.origin,
    visibility: uploadOptions.visibility,
    forceRetrieve: uploadOptions.forceRetrieve,
    message: "Saving to Datacat...",
    error: null,
  });
  try {
    const body = {
      idempotencyKey: buildUploadIdempotencyKey(record),
      extensionVariant: EXTENSION_VARIANT,
      extensionVersion: getManifestVersion(),
      uploadMode: "extension",
      forceRetrieve: uploadOptions.forceRetrieve,
      visibility: uploadOptions.visibility,
      requestedVisibility: uploadOptions.requestedVisibility,
      sourceVisibility: uploadOptions.sourceVisibility,
      reason: reason || "auto",
      sourceKind: record.summary && record.summary.sourceKind,
      savedAt: record.savedAt || null,
      updatedAt: record.updatedAt || null,
      components: record.summary && record.summary.components ? record.summary.components : null,
      summary: record.summary || null,
      capture: record.capture || null,
      preflight: uploadOptions.preflight || null,
    };
    const { response, json } = await fetchDatacatJson(config, DATACAT_UPLOAD_PATH, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!response.ok || !json || json.success === false) {
      throw buildDatacatResponseError(response, json);
    }
    await updateRetrievedUploadState(record.id, {
      status: "uploaded",
      origin: config.origin,
      uploadId: json.uploadId || null,
      datacatCharacterId: json.characterId || null,
      viewUrl: json.viewUrl || null,
      uploadMode: json.uploadMode || "extension",
      forceRetrieve: json.forceRetrieve === true,
      uploader: json.uploader || null,
      visibility: json.visibility || {
        requested: uploadOptions.requestedVisibility,
        effective: uploadOptions.visibility === "public" ? "public" : "private",
        source: uploadOptions.sourceVisibility,
        forcedPrivate: uploadOptions.visibilityForcedPrivate === true,
      },
      persistenceStatus: json.persistence && json.persistence.status ? json.persistence.status : "saved",
      mirrorStatus: json.downstream && json.downstream.mediaMirror ? json.downstream.mediaMirror : "queued",
      scoringStatus: json.downstream && json.downstream.scoring ? json.downstream.scoring : "queued",
      scoringReason: json.downstream && json.downstream.scoringReason ? json.downstream.scoringReason : null,
      creatorStatus: json.downstream && json.downstream.creator ? json.downstream.creator : "captured",
      creatorReason: json.downstream && json.downstream.creatorReason ? json.downstream.creatorReason : null,
      creatorFreshness: json.downstream && json.downstream.creatorFreshness ? json.downstream.creatorFreshness : null,
      components: json.components || (record.summary && record.summary.components) || null,
      uploadedAt: new Date().toISOString(),
      message: "Saved to Datacat.",
      error: null,
    });
    if (json.uploadId) {
      setTimeout(() => pollUploadStatus(record.id, json.uploadId, 0), 5000);
    }
    return json;
  } catch (error) {
    await updateRetrievedUploadState(record.id, {
      status: "failed",
      origin: config.origin,
      message: "Datacat save failed.",
      error: normalizeError(error),
    });
    throw error;
  }
}


async function saveRetrievedCharacter(capture, uploadOptionsInput) {
  const store = await readRetrievedStore();
  const summary = SourceVaultCore.summarizeRetrievedCapture(capture || {});
  if (!summary || !summary.id) throw new Error("retrieved_character_missing_id");
  const record = SourceVaultCore.buildStoredRetrievedCharacter(capture, store[summary.id]);
  if (!record) throw new Error("retrieved_character_record_failed");
  const uploadOptions = normalizeUploadOptions(uploadOptionsInput, record);
  record.uploadOptions = {
    visibility: uploadOptions.visibility,
    requestedVisibility: uploadOptions.requestedVisibility,
    sourceVisibility: uploadOptions.sourceVisibility,
    visibilityForcedPrivate: uploadOptions.visibilityForcedPrivate === true,
    forceRetrieve: uploadOptions.forceRetrieve,
    localOnly: uploadOptions.localOnly === true,
    preflight: uploadOptions.preflight || null,
  };
  const existingPreflight = SourceVaultPolicy.getExistingPreflightResult(uploadOptions.preflight);
  record.upload = {
    ...(store[summary.id] && store[summary.id].upload ? store[summary.id].upload : {}),
    status: uploadOptions.localOnly ? "local_saved" : "pending",
    reason: uploadOptions.localOnly ? "local_only" : "auto",
    visibility: uploadOptions.visibility,
    forceRetrieve: uploadOptions.forceRetrieve,
    localOnly: uploadOptions.localOnly === true,
    viewUrl: uploadOptions.localOnly && existingPreflight
      ? existingPreflight.viewUrl || null
      : (store[summary.id] && store[summary.id].upload && store[summary.id].upload.viewUrl || null),
    message: uploadOptions.localOnly ? "Saved locally." : "Queued for Datacat save.",
    updatedAt: new Date().toISOString(),
  };
  store[record.id] = record;
  await storageSet({ [RETRIEVED_STORAGE_KEY]: store });
  broadcast({
    type: MessageTypes.SV_RETRIEVED_CHARACTERS_UPDATED,
    list: listRetrievedCharactersFromStore(store),
    saved: { id: record.id, summary: record.summary, upload: record.upload },
  });
  cacheThumbnailsFromRecord(record).catch((error) => {
    console.warn("[SourceVaultV2] Thumbnail cache update failed:", normalizeError(error));
  });
  if (!uploadOptions.localOnly) {
    uploadRetrievedCharacter(record, "auto", uploadOptions).catch((error) => {
      console.warn("[SourceVaultV2] Datacat upload failed:", normalizeError(error));
    });
  }
  return record;
}
