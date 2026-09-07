"use strict";

function ensureOverlay() {
    if (overlayRoot && document.documentElement.contains(overlayRoot)) return overlayRoot;
    overlayRoot = document.createElement("div");
    overlayRoot.id = "source-vault-sidebar-root";
    overlayRoot.setAttribute("data-source-vault", "root");
    overlayRoot.innerHTML = `
      <div class="sv-panel" data-role="panel">
        <div class="sv-header">
          <div>
            <div class="sv-kicker">Pincat</div>
            <div class="sv-title">Janitor save</div>
          </div>
          <button class="sv-icon-button" data-action="toggle" title="Collapse">-</button>
        </div>
        <div class="sv-body">
          <div class="sv-auth" data-role="auth"></div>
          <div class="sv-character" data-role="character"></div>
          <div class="sv-actions" data-role="actions"></div>
          <div class="sv-status" data-role="status"></div>
        </div>
      </div>
      <button class="sv-tab" data-action="toggle" title="Open Pincat">Pin</button>
    `;
    overlayRoot.addEventListener("click", (event) => {
      const target = event.target && event.target.closest("[data-action]");
      if (!target) return;
      const action = target.getAttribute("data-action");
      if (action === "toggle") {
        state.overlayCollapsed = !state.overlayCollapsed;
        setState({});
      }
      if (action === "retrieve") {
        startRetrievalFromCurrentPage();
      }
      if (action === "refresh") {
        refreshPageState({ forceAuth: true });
      }
    });
    (document.body || document.documentElement).appendChild(overlayRoot);
    return overlayRoot;
  }

  function renderOverlay() {
    return;
  }

  function removeLegacyOverlay() {
    try {
      const existing = document.getElementById("source-vault-sidebar-root");
      if (existing) existing.remove();
    } catch (_) {}
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => {
      if (ch === "&") return "&amp;";
      if (ch === "<") return "&lt;";
      if (ch === ">") return "&gt;";
      if (ch === '"') return "&quot;";
      return "&#39;";
    });
  }

  // --- page refresh + auth ---
