"use strict";

/* ui/sidebar/render.js — top-level render scheduler (renders from the live UI state).
 * Extracted from the monolithic sidebar.js in Phase 5 (source-vault v2 refactor).
 * Behaviour is byte-for-byte identical to the pre-split code; only the enclosing
 * file changed. All sidebar UI scripts share one global (window) scope, so these
 * relocated declarations remain mutually visible at call time.
 */

function render(state) {
  handleActivePageTransition(state);
  currentState = state || null;
  renderDatacatPanel();
  renderExtensionUpdateBanner();
  renderSourceSessionLine();
  renderUploadOptionsPanel();
  if (authPanel) authPanel.innerHTML = "";
  renderCurrentPageCard();
  renderLatestSavedPanel();
  renderPreflightStatus();
  renderRetrievalActivityPanel();
  renderCurrentDetailsPanel();
  maybeRequestSourceAnnouncement({ force: announcementState.lastRequestedAt === 0 });
  renderAnnouncementPanel();
  renderRetrievedPanel();
  maybeRequestPreflight();
  requestVisibleThumbnailsSoon();
  maybeAutoOpenCurrentCreatorView();
  maybeAutoOpenCurrentCharacterDetail();
}


// Alias used by the store-migration path: a single top-level render entry point.
function renderAll(state) {
  render(state);
}
if (typeof globalThis !== "undefined") {
  globalThis.SourceVaultSidebarRender = { render, renderAll };
}
