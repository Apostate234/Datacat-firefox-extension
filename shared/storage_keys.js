"use strict";

(function initSourceVaultStorageKeys(globalScope) {
  const StorageKeys = Object.freeze({
    RETRIEVED_CHARACTERS: "sourceVaultV2rRetrievedCharacters",
    CREATORS: "sourceVaultV2rCreators",
    DATACAT_CONFIG: "sourceVaultV2rDatacatConfig",
    COMPANION_INSTALLATIONS: "sourceVaultV2rCompanionInstallations",
    UPLOAD_SETTINGS: "sourceVaultV2rUploadSettings",
    WINDOW_UPLOAD_VISIBILITY: "sourceVaultV2rWindowUploadVisibility",
    DISMISSED_ANNOUNCEMENTS: "sourceVaultV2rDismissedAnnouncements",
    SOURCE_ACCOUNT_APPROVALS: "sourceVaultV2rSourceAccountApprovals",
    EXTRACTION_PERSONA_STATE: "sourceVaultV2rExtractionPersonaState",
    TAB_USAGE: "sourceVaultV2rTabUsage",
    THUMBNAIL_CACHE: "sourceVaultV2rThumbnailCache",
    RETRIEVAL_QUEUE: "sourceVaultV2rRetrievalQueue",
    UI_SKIN: "sv2rUiSkin",
    DEBUG_PANEL_VISIBLE: "sv2rDebugPanelVisible",
    PENDING_DATACAT_BRIDGE: "sourceVaultV2rPendingDatacatBridge",
  });

  const EXTENSION_LOCAL_STORAGE_KEYS = Object.freeze([
    StorageKeys.RETRIEVED_CHARACTERS,
    StorageKeys.CREATORS,
    StorageKeys.DATACAT_CONFIG,
    StorageKeys.COMPANION_INSTALLATIONS,
    StorageKeys.UPLOAD_SETTINGS,
    StorageKeys.DISMISSED_ANNOUNCEMENTS,
    StorageKeys.SOURCE_ACCOUNT_APPROVALS,
    StorageKeys.EXTRACTION_PERSONA_STATE,
    StorageKeys.THUMBNAIL_CACHE,
    StorageKeys.RETRIEVAL_QUEUE,
  ]);

  const api = Object.freeze({
    StorageKeys,
    EXTENSION_LOCAL_STORAGE_KEYS,
  });

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.SourceVaultStorageKeys = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
