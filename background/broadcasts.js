"use strict";
// background/broadcasts.js — runtime broadcast + debug helpers + sidebar event revision
// Extracted from background.js in Phase 2 (mechanical move; behavior unchanged).
// Loaded in MV3 service-worker global scope via importScripts from background/index.js.
// Depends (global scope) on: constants.js, shared/source_vault_core.js

let sidebarEventRevision = 0;

function nextSidebarEventRevision() {
  sidebarEventRevision += 1;
  return sidebarEventRevision;
}

function broadcast(message) {
  try {
    const maybePromise = chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
    });
    if (maybePromise && typeof maybePromise.catch === "function") {
      maybePromise.catch(() => {});
    }
  } catch (_) {}
}

function debugBroadcast(event, detail) {
  const entry = {
    at: new Date().toISOString(),
    source: "background",
    event,
    detail: SourceVaultCore && typeof SourceVaultCore.sanitizeForTransport === "function"
      ? SourceVaultCore.sanitizeForTransport(detail || {}, 0)
      : detail || {},
  };
  try {
    console.debug("[PincatDebug:background]", event, entry);
  } catch (_) {}
  broadcast({ type: MessageTypes.SV2_DEBUG_LOG, entry });
}

function summarizeStateForDebug(state) {
  const root = state && typeof state === "object" ? state : {};
  const page = root.page && typeof root.page === "object" ? root.page : {};
  const character = root.character && typeof root.character === "object" ? root.character : {};
  const retrieval = root.retrieval && typeof root.retrieval === "object" ? root.retrieval : {};
  return {
    url: page.normalizedUrl || page.url || null,
    sourceKind: getStateSourceKind(root) || null,
    pageType: page.isCreatorPage ? "creator" : page.isCharacterPage ? "character" : page.isDatacatSite ? "datacat" : "unknown",
    pendingNavigation: page.pendingNavigation === true,
    characterId: character.id || character.characterId || character.companionId || page.characterId || page.companionId || null,
    characterName: character.name || null,
    creatorId: character.creatorId || page.creatorId || null,
    creatorHandle: character.creatorHandle || page.creatorHandle || null,
    retrievalRunning: retrieval.running === true,
    retrievalStage: retrieval.stage || null,
  };
}
