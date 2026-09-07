"use strict";

/* ui/sidebar/views/account_gate.js — account_gate view render + helpers.
 * Extracted from the monolithic sidebar.js in Phase 5 (source-vault v2 refactor).
 * Behaviour is byte-for-byte identical to the pre-split code; only the enclosing
 * file changed. All sidebar UI scripts share one global (window) scope, so these
 * relocated declarations remain mutually visible at call time.
 */

function renderAccountGatePanel() {
  if (!accountGatePanel) return;
  const gate = getCurrentSourceAccountGate();
  applySourceAccountGateVisualState(gate);
  if (!gate.required || !gate.account) {
    // Account discovery briefly clears during source-tab reloads. Keep an
    // already-open, account-bound review dialog under explicit user control so
    // that a background refresh cannot dismiss the action the user just took.
    accountGatePanel.hidden = true;
    accountGatePanel.innerHTML = "";
    return;
  }
  const sourceLabel = getSourceLabel(gate.sourceKind);
  const accountLabel = gate.account.label || gate.account.id || "detected account";
  if (gate.allowed) {
    closeSourceAccountReviewDialog();
    accountGatePanel.hidden = true;
    accountGatePanel.innerHTML = "";
    return;
  }
  const rejected = gate.reason === "source_account_rejected";
  accountGatePanel.hidden = false;
  accountGatePanel.className = `account-gate-panel ${rejected ? "is-danger" : "is-warning"}`;
  accountGatePanel.innerHTML = `
    <div class="account-gate-copy">
      <div class="account-gate-title">${
        rejected
          ? `${escapeHtml(accountLabel)} is not approved for ${escapeHtml(sourceLabel)} retrievals`
          : `Account confirmation required`
      }</div>
      ${
        sourceAccountApprovalsLoading || sourceAccountApprovalsError
          ? `<div class="account-gate-meta">${
              sourceAccountApprovalsLoading
                ? "Checking saved decision..."
                : `Could not read saved decision: ${escapeHtml(sourceAccountApprovalsError)}`
            }</div>`
          : ""
      }
      <div class="account-gate-text">
        ${
          rejected
            ? `Sign in with a different account or review the saved decision.`
            : `Confirm ${escapeHtml(accountLabel)} before retrieving.`
        }
      </div>
    </div>
    <div class="account-gate-actions">
      ${
        rejected
          ? `
            <button class="account-gate-relogin" data-action="source-relogin">Open ${escapeHtml(sourceLabel)} login</button>
            <button class="account-gate-manage" data-action="manage-source-accounts">Manage accounts</button>
          `
          : `<button class="account-gate-confirm" data-action="review-source-account">Review account</button>`
      }
    </div>
  `;
  if (!rejected && !sourceAccountApprovalsLoading && !sourceAccountApprovalsError) {
    maybeAutoOpenSourceAccountReview(gate);
  }
}

function openSourceAccountReviewDialog(gate = getCurrentSourceAccountGate()) {
  if (!sourceAccountReviewDialog || !gate || !gate.account || gate.allowed || gate.reason === "source_account_rejected") return;
  const sourceLabel = getSourceLabel(gate.sourceKind);
  const accountLabel = gate.account.label || gate.account.id || "detected account";
  sourceAccountReviewDecision = {
    key: gate.account.key || `${gate.sourceKind}:${gate.account.id || accountLabel}`,
    sourceKind: gate.sourceKind,
    account: { ...gate.account },
  };
  if (sourceAccountReviewTitle) sourceAccountReviewTitle.textContent = `Use ${accountLabel} for retrieval?`;
  if (sourceAccountReviewText) {
    sourceAccountReviewText.textContent = gate.sourceKind === "janitor"
      ? "Pincat will use this signed-in Janitor account only for captures you start. A full capture can read same-site character data, create or reuse a Pincat capture persona, create a temporary chat, request one response, and delete that chat. Janitor session tokens stay in the page and are not stored or sent to Datacat."
      : "Pincat will use this signed-in source account only for captures you start. It reads same-site character data needed for the selected capture. Source session tokens stay in the page and are not stored or sent to Datacat.";
  }
  if (!sourceAccountReviewDialog.open) sourceAccountReviewDialog.showModal();
  if (sourceAccountReviewApprove) sourceAccountReviewApprove.focus();
}

function closeSourceAccountReviewDialog() {
  sourceAccountReviewDecision = null;
  if (sourceAccountReviewDialog && sourceAccountReviewDialog.open) sourceAccountReviewDialog.close("cancel");
}

function maybeAutoOpenSourceAccountReview(gate) {
  const key = gate && gate.account && (gate.account.key || `${gate.sourceKind}:${gate.account.id || gate.account.label || "unknown"}`);
  if (!key || promptedSourceAccountReviewKeys.has(key)) return;
  promptedSourceAccountReviewKeys.add(key);
  setTimeout(() => {
    const currentGate = getCurrentSourceAccountGate();
    const currentKey = currentGate && currentGate.account && (currentGate.account.key || `${currentGate.sourceKind}:${currentGate.account.id || currentGate.account.label || "unknown"}`);
    if (currentKey === key) openSourceAccountReviewDialog(currentGate);
  }, 0);
}

function openSourceAccountSettings() {
  chrome.tabs.create({ url: chrome.runtime.getURL("settings.html#connections") });
}

function applySourceAccountGateVisualState(gate) {
  const blocked = !!(gate && gate.required && !gate.allowed && gate.account);
  const rejected = blocked && gate.reason === "source_account_rejected";
  if (currentPageView) {
    currentPageView.classList.toggle("is-source-gated", blocked);
    currentPageView.classList.toggle("is-source-gate-rejected", rejected);
  }
  if (characterPanel) characterPanel.setAttribute("aria-disabled", blocked ? "true" : "false");
}

function renderSourceAccountBlockStatus(gate) {
  if (!gate || !gate.required || gate.allowed || !gate.account) return "";
  return `<div class="source-account-block-status">${
    gate.reason === "source_account_rejected"
      ? "re-login with an approved session"
      : "account confirmation required"
  }</div>`;
}
