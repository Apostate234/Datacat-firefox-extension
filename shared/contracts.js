"use strict";

(function initSourceVaultContracts(globalScope) {
  /**
   * @typedef {object} ActiveTabState
   * @property {object} [page]
   * @property {object} [character]
   * @property {object} [auth]
   * @property {object} [retrieval]
   * @property {string} [sourceKind]
   */

  /**
   * @typedef {object} RetrievalStatus
   * @property {boolean} [running]
   * @property {string} [stage]
   * @property {string} [message]
   * @property {string} [error]
   */

  /**
   * @typedef {object} RetrievedCharacterSummary
   * @property {string} id
   * @property {string} [name]
   * @property {string} [sourceKind]
   * @property {object} [upload]
   * @property {string} [savedAt]
   */

  /**
   * @typedef {object} UploadStatus
   * @property {string} [status] pending|uploading|uploaded|failed|skipped
   * @property {string} [error]
   * @property {string} [uploadId]
   * @property {string} [updatedAt]
   */

  /**
   * @typedef {object} QueueProjection
   * @property {number} [revision]
   * @property {object|null} [activeItem]
   * @property {object[]} [pending]
   * @property {object[]} [finished]
   * @property {boolean} [paused]
   */

  /**
   * @typedef {object} DatacatState
   * @property {string} [origin]
   * @property {boolean} [connected]
   * @property {string} [username]
   * @property {string} [error]
   */

  /**
   * @typedef {object} SourceAccountApprovalGate
   * @property {boolean} allowed
   * @property {string} [reason]
   * @property {string} [sourceKind]
   * @property {string} [accountKey]
   * @property {string} [state]
   */

  function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function normalizeActiveTabState(value) {
    const root = asObject(value);
    return {
      page: asObject(root.page),
      character: asObject(root.character),
      auth: asObject(root.auth),
      retrieval: asObject(root.retrieval),
      sourceKind: root.sourceKind || root.page && root.page.sourceKind || null,
    };
  }

  function normalizeRetrievalStatus(value) {
    const root = asObject(value);
    return {
      running: root.running === true,
      stage: root.stage || null,
      message: root.message || null,
      error: root.error || null,
    };
  }

  function normalizeRetrievedCharacterSummary(value) {
    const root = asObject(value);
    const id = String(root.id || root.characterId || "").trim();
    return {
      id: id || null,
      name: root.name || null,
      sourceKind: root.sourceKind || null,
      upload: asObject(root.upload),
      savedAt: root.savedAt || root.updatedAt || null,
    };
  }

  function normalizeUploadStatus(value) {
    const root = asObject(value);
    return {
      status: root.status || null,
      error: root.error || null,
      uploadId: root.uploadId || root.id || null,
      updatedAt: root.updatedAt || null,
    };
  }

  function normalizeQueueProjection(value) {
    const root = asObject(value);
    return {
      revision: Number(root.revision || 0),
      activeItem: root.activeItem && typeof root.activeItem === "object" ? root.activeItem : null,
      pending: Array.isArray(root.pending) ? root.pending : [],
      finished: Array.isArray(root.finished) ? root.finished : [],
      paused: root.paused === true,
    };
  }

  function normalizeDatacatState(value) {
    const root = asObject(value);
    return {
      origin: root.origin || null,
      connected: root.connected === true || Boolean(root.sessionToken),
      username: root.username || root.userName || null,
      error: root.error || null,
    };
  }

  function normalizeSourceAccountApprovalGate(value) {
    const root = asObject(value);
    return {
      allowed: root.allowed === true,
      reason: root.reason || null,
      sourceKind: root.sourceKind || null,
      accountKey: root.accountKey || null,
      state: root.state || null,
    };
  }

  function normalizeCaptureEnvelope(value) {
    const root = asObject(value);
    const source = asObject(root.source);
    const entity = asObject(root.entity);
    return {
      schemaVersion: Number(root.schemaVersion || 0),
      source: {
        id: String(source.id || "").trim().toLowerCase() || null,
        adapterVersion: source.adapterVersion == null ? null : String(source.adapterVersion),
      },
      entity: {
        type: String(entity.type || "character"),
        sourceEntityId: entity.sourceEntityId == null ? null : String(entity.sourceEntityId),
        canonicalUrl: entity.canonicalUrl || null,
      },
      capturedAt: root.capturedAt || null,
      character: root.character && typeof root.character === "object" ? root.character : null,
      creator: root.creator && typeof root.creator === "object" ? root.creator : null,
      sections: Array.isArray(root.sections) ? root.sections : [],
      assets: Array.isArray(root.assets) ? root.assets : [],
      raw: root.raw === undefined ? null : root.raw,
      provenance: Array.isArray(root.provenance) ? root.provenance : [],
      completeness: root.completeness || null,
      warnings: Array.isArray(root.warnings) ? root.warnings : [],
    };
  }

  function validateCaptureEnvelope(value) {
    const envelope = normalizeCaptureEnvelope(value);
    if (envelope.schemaVersion !== 1) return { ok: false, error: "capture_envelope_schema_invalid" };
    if (!envelope.source.id) return { ok: false, error: "capture_envelope_source_required" };
    if (!envelope.entity.sourceEntityId) return { ok: false, error: "capture_envelope_entity_id_required" };
    if (!envelope.entity.canonicalUrl) return { ok: false, error: "capture_envelope_url_required" };
    return { ok: true, envelope };
  }

  const api = Object.freeze({
    normalizeActiveTabState,
    normalizeRetrievalStatus,
    normalizeRetrievedCharacterSummary,
    normalizeUploadStatus,
    normalizeQueueProjection,
    normalizeDatacatState,
    normalizeSourceAccountApprovalGate,
    normalizeCaptureEnvelope,
    validateCaptureEnvelope,
  });

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.SourceVaultContracts = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
