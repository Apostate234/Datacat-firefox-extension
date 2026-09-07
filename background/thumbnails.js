"use strict";
// background/thumbnails.js — thumbnail cache pipeline
// Extracted from background.js in Phase 2 (mechanical move; behavior unchanged).
// Loaded in MV3 service-worker global scope via importScripts from background/index.js.
// Depends (global scope) on: constants.js, chrome_adapters.js, broadcasts.js, source_accounts.js (normalizeAnnouncementSourceKind)

function hashThumbnailKey(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getThumbnailImageUrl(value) {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value !== "object") return null;
  return firstNonEmpty(
    value.thumbnailDataUrl,
    value.highresUrl,
    value.cardUrl,
    value.thumbnailUrl,
    value.highres_url,
    value.card_url,
    value.thumbnail_url,
    value.imageUrl,
    value.url,
  ) || null;
}

function buildThumbnailCacheKey(sourceKind, role, entityId, imageUrl) {
  const source = normalizeAnnouncementSourceKind(sourceKind) || "source";
  const normalizedRole = String(role || "image").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 48) || "image";
  const entity = String(entityId || "").trim().toLowerCase().slice(0, 96) || "unknown";
  const url = String(imageUrl || "").trim();
  if (!url || /^data:/i.test(url)) return null;
  return `${source}:${normalizedRole}:${entity}:${hashThumbnailKey(url)}`;
}

function normalizeThumbnailRef(ref) {
  const root = ref && typeof ref === "object" ? ref : {};
  const imageUrl = getThumbnailImageUrl(root.imageUrl || root.url || root.image || root.avatar || root.profileImageAssetUrl);
  const sourceKind = normalizeAnnouncementSourceKind(root.sourceKind || root.source) || "source";
  const role = String(root.role || "image").trim() || "image";
  const entityId = firstNonEmpty(root.entityId, root.characterId, root.companionId, root.creatorId, root.creatorHandle, root.id, imageUrl);
  const cacheKey = root.cacheKey || buildThumbnailCacheKey(sourceKind, role, entityId, imageUrl);
  if (!imageUrl || !cacheKey) return null;
  return { sourceKind, role, entityId, imageUrl, cacheKey };
}

async function readThumbnailCache() {
  const result = await storageGet({ [THUMBNAIL_STORAGE_KEY]: {} });
  const stored = result[THUMBNAIL_STORAGE_KEY];
  return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
}

function approximateObjectBytes(value) {
  try {
    return new Blob([JSON.stringify(value || {})]).size;
  } catch (_) {
    return String(JSON.stringify(value || {})).length;
  }
}

function pruneThumbnailCache(cache) {
  const entries = Object.entries(cache || {})
    .filter(([, entry]) => entry && typeof entry === "object" && entry.dataUrl)
    .sort((a, b) => String(b[1].updatedAt || b[1].lastUsedAt || "").localeCompare(String(a[1].updatedAt || a[1].lastUsedAt || "")));
  const next = {};
  let bytes = 0;
  for (const [key, entry] of entries) {
    if (Object.keys(next).length >= THUMBNAIL_MAX_ENTRIES) break;
    const entryBytes = approximateObjectBytes(entry);
    if (bytes + entryBytes > THUMBNAIL_MAX_TOTAL_BYTES) continue;
    next[key] = entry;
    bytes += entryBytes;
  }
  return next;
}

async function writeThumbnailCache(cache) {
  const pruned = pruneThumbnailCache(cache);
  await storageSet({ [THUMBNAIL_STORAGE_KEY]: pruned });
  return pruned;
}

function blobToDataUrl(blob) {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return `data:${blob.type || "image/webp"};base64,${btoa(binary)}`;
  });
}

async function fetchAndResizeThumbnail(imageUrl) {
  const url = String(imageUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("thumbnail_url_not_fetchable");
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap !== "function") {
    throw new Error("thumbnail_canvas_unavailable");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), THUMBNAIL_FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      credentials: "omit",
      cache: "force-cache",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response || !response.ok) throw new Error(`thumbnail_fetch_http_${response ? response.status : "unknown"}`);
  const length = Number(response.headers && response.headers.get("content-length")) || 0;
  if (length > 8 * 1024 * 1024) throw new Error("thumbnail_source_too_large");
  const blob = await response.blob();
  if (!String(blob.type || "").toLowerCase().startsWith("image/")) throw new Error("thumbnail_source_not_image");
  const bitmap = await createImageBitmap(blob);
  const width = Math.max(1, Number(bitmap.width) || THUMBNAIL_SIZE_PX);
  const height = Math.max(1, Number(bitmap.height) || THUMBNAIL_SIZE_PX);
  const scale = Math.min(1, THUMBNAIL_SIZE_PX / width, THUMBNAIL_SIZE_PX / height);
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("thumbnail_canvas_context_unavailable");
  context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  if (typeof bitmap.close === "function") bitmap.close();
  let outputBlob = await canvas.convertToBlob({ type: "image/webp", quality: 0.72 });
  if (!outputBlob || outputBlob.size > THUMBNAIL_MAX_DATA_URL_BYTES) {
    outputBlob = await canvas.convertToBlob({ type: "image/webp", quality: 0.58 });
  }
  const dataUrl = await blobToDataUrl(outputBlob);
  if (dataUrl.length > THUMBNAIL_MAX_DATA_URL_BYTES) throw new Error("thumbnail_data_url_too_large");
  return {
    dataUrl,
    width: targetWidth,
    height: targetHeight,
    mimeType: outputBlob.type || "image/webp",
    byteLength: dataUrl.length,
  };
}

async function cacheThumbnailRefs(refs, options = {}) {
  const normalizedRefs = (Array.isArray(refs) ? refs : [refs])
    .map(normalizeThumbnailRef)
    .filter(Boolean)
    .slice(0, THUMBNAIL_REF_BATCH_LIMIT);
  if (!normalizedRefs.length) return { ok: true, entries: {}, errors: {} };
  let cache = await readThumbnailCache();
  const entries = {};
  const errors = {};
  let changed = false;
  const refsToFetch = [];
  for (const ref of normalizedRefs) {
    const existing = cache[ref.cacheKey];
    if (existing && existing.dataUrl && options.force !== true) {
      entries[ref.cacheKey] = existing;
      continue;
    }
    refsToFetch.push(ref);
  }
  async function processRef(ref) {
    try {
      const resized = await fetchAndResizeThumbnail(ref.imageUrl);
      const entry = {
        cacheKey: ref.cacheKey,
        sourceKind: ref.sourceKind,
        role: ref.role,
        entityId: ref.entityId || null,
        sourceUrl: ref.imageUrl,
        dataUrl: resized.dataUrl,
        width: resized.width,
        height: resized.height,
        mimeType: resized.mimeType,
        byteLength: resized.byteLength,
        updatedAt: new Date().toISOString(),
      };
      cache[ref.cacheKey] = entry;
      entries[ref.cacheKey] = entry;
      changed = true;
    } catch (error) {
      errors[ref.cacheKey] = normalizeError(error);
    }
  }
  for (let i = 0; i < refsToFetch.length; i += 4) {
    await Promise.all(refsToFetch.slice(i, i + 4).map(processRef));
  }
  if (changed) {
    cache = await writeThumbnailCache(cache);
    const updatedEntries = {};
    for (const key of Object.keys(entries)) {
      if (cache[key]) updatedEntries[key] = cache[key];
    }
    broadcast({ type: MessageTypes.SV2_THUMBNAIL_CACHE_UPDATED, entries: updatedEntries });
  }
  return { ok: true, entries, errors };
}

function pushThumbnailRef(refs, sourceKind, role, entityId, imageUrl) {
  const normalized = normalizeThumbnailRef({ sourceKind, role, entityId, imageUrl });
  if (!normalized) return;
  if (refs.some((ref) => ref.cacheKey === normalized.cacheKey)) return;
  refs.push(normalized);
}


function getCharacterThumbnailEntityId(character, fallback) {
  const root = character && typeof character === "object" ? character : {};
  return firstNonEmpty(root.id, root.characterId, root.character_id, root.companionId, root.companion_id, root.sourceId, root.source_id, fallback);
}


function collectThumbnailRefsFromCharacterList(sourceKind, characters, refs) {
  for (const character of Array.isArray(characters) ? characters : []) {
    const root = character && typeof character === "object" ? character : {};
    const entityId = getCharacterThumbnailEntityId(root, null);
    const imageUrl = getThumbnailImageUrl(root.profileImageAssetUrl || root.avatarUrl || root.avatar || root.image);
    pushThumbnailRef(refs, sourceKind, "character_profile", entityId, imageUrl);
  }
}


function collectThumbnailRefsFromCreatorRecord(record) {
  const root = record && typeof record === "object" ? record : {};
  const sourceKind = normalizeAnnouncementSourceKind(root.sourceKind || (root.summary && root.summary.sourceKind)) || "source";
  const refs = [];
  const summary = root.summary && typeof root.summary === "object" ? root.summary : {};
  const capture = root.capture && typeof root.capture === "object" ? root.capture : {};
  const profile = capture.profile && typeof capture.profile === "object" ? capture.profile : {};
  pushThumbnailRef(
    refs,
    sourceKind,
    "creator_profile",
    firstNonEmpty(summary.creatorId, summary.creatorHandle, root.creatorId, root.creatorHandle, profile.creatorId, profile.creatorHandle),
    firstNonEmpty(summary.imageUrl, profile.profileImageAssetUrl, profile.avatarUrl, getThumbnailImageUrl(profile.avatar)),
  );
  const characterList = capture.characterList && typeof capture.characterList === "object" ? capture.characterList : {};
  collectThumbnailRefsFromCharacterList(sourceKind, characterList.characters, refs);
  collectThumbnailRefsFromCharacterList(sourceKind, capture.companions, refs);
  const sourceSections = capture.sourceSections && typeof capture.sourceSections === "object" ? capture.sourceSections : {};
  const sourceCompanions = sourceSections.companions && typeof sourceSections.companions === "object"
    ? sourceSections.companions.items
    : null;
  collectThumbnailRefsFromCharacterList(sourceKind, sourceCompanions, refs);
  return refs;
}


function collectThumbnailRefsFromRetrievedRecord(record) {
  const root = record && typeof record === "object" ? record : {};
  const summary = root.summary && typeof root.summary === "object" ? root.summary : {};
  const capture = root.capture && typeof root.capture === "object" ? root.capture : {};
  const sourceKind = normalizeAnnouncementSourceKind(summary.sourceKind || capture.sourceKind || (capture.saucepanCore ? "saucepan" : "janitor")) || "source";
  const refs = [];
  pushThumbnailRef(refs, sourceKind, "character_profile", summary.id || root.id, summary.imageUrl);
  const janitorCore = capture.janitorCore && typeof capture.janitorCore === "object" ? capture.janitorCore : {};
  const janitorCharacter = janitorCore.character && typeof janitorCore.character === "object" ? janitorCore.character : {};
  pushThumbnailRef(
    refs,
    "janitor",
    "character_profile",
    summary.id || root.id || janitorCharacter.id || janitorCharacter.characterId,
    firstNonEmpty(janitorCharacter.profileImageAssetUrl, janitorCharacter.avatarUrl, janitorCharacter.avatar),
  );
  const saucepanCore = capture.saucepanCore && typeof capture.saucepanCore === "object" ? capture.saucepanCore : {};
  const saucepanCompanion = saucepanCore.companion && typeof saucepanCore.companion === "object" ? saucepanCore.companion : {};
  pushThumbnailRef(
    refs,
    "saucepan",
    "character_profile",
    summary.id || root.id || saucepanCompanion.id || saucepanCompanion.companionId,
    firstNonEmpty(saucepanCompanion.profileImageAssetUrl, saucepanCompanion.avatarUrl, getThumbnailImageUrl(saucepanCompanion.image)),
  );
  const creator = sourceKind === "saucepan"
    ? capture.saucepanCreator && typeof capture.saucepanCreator === "object" ? capture.saucepanCreator : null
    : capture.creator && typeof capture.creator === "object" ? capture.creator : null;
  if (creator) {
    const creatorProfile = creator.profile && typeof creator.profile === "object" ? creator.profile : {};
    pushThumbnailRef(
      refs,
      sourceKind,
      "creator_profile",
      firstNonEmpty(creator.creatorId, creator.creatorHandle, creatorProfile.creatorId, creatorProfile.creatorHandle, creatorProfile.userName),
      firstNonEmpty(creatorProfile.profileImageAssetUrl, creatorProfile.avatarUrl, getThumbnailImageUrl(creatorProfile.avatar)),
    );
    const characterList = creator.characterList && typeof creator.characterList === "object" ? creator.characterList : {};
    collectThumbnailRefsFromCharacterList(sourceKind, characterList.characters, refs);
  }
  return refs;
}


function cacheThumbnailsFromRecord(record) {
  const capture = record && record.capture && typeof record.capture === "object" ? record.capture : {};
  const isRetrievedRecord = !!(record && record.id && (capture.janitorCore || capture.saucepanCore || capture.janny));
  const refs = (isRetrievedRecord
    ? collectThumbnailRefsFromRetrievedRecord(record)
    : collectThumbnailRefsFromCreatorRecord(record)
  ).slice(0, THUMBNAIL_REF_BATCH_LIMIT);
  if (!refs.length) return Promise.resolve({ ok: true, entries: {}, errors: {} });
  return cacheThumbnailRefs(refs);
}

