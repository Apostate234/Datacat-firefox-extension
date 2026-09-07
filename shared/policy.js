"use strict";
// shared/policy.js — pure business-policy decision helpers (Phase 6).
//
// These functions hold the *decisions* that used to be duplicated between the
// background service worker and the sidebar UI: the source-account approval
// gate and the Datacat preflight block. They take already-normalized primitive
// inputs and return plain, ready-to-render result objects. They must stay pure
// (no chrome.*, no DOM, no network), so both realms and the Node test runner
// can share the exact same rules.
//
// Loaded in three ways:
//   - background service worker: importScripts("../shared/policy.js")
//   - sidebar: <script src="shared/policy.js">
//   - tests: require("../shared/policy.js")

(function initSourceVaultPolicy(globalScope) {
  // Canonical approval states (mirror background/constants.js so the shared
  // helper is the single source of truth for the normalized vocabulary).
  const SOURCE_ACCOUNT_APPROVAL_CONFIRMED = "confirmed_dedicated";
  const SOURCE_ACCOUNT_APPROVAL_REJECTED = "rejected";

  function normalizeGateSourceKind(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "sauce" || normalized === "saucepan") return "saucepan";
    if (normalized === "janitor" || normalized === "janitorai" || normalized === "janny") return "janitor";
    return null;
  }

  function normalizeApprovalState(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (["confirmed", "confirm", "confirmed_new", "confirmed_dedicated", "dedicated"].includes(normalized)) {
      return SOURCE_ACCOUNT_APPROVAL_CONFIRMED;
    }
    if (["rejected", "blocked", "not_confirmed", "not_dedicated", "remove"].includes(normalized)) {
      return SOURCE_ACCOUNT_APPROVAL_REJECTED;
    }
    return null;
  }

  function buildGateResult(fields) {
    const required = fields.required === true;
    const allowed = fields.allowed === true;
    const reason = fields.reason || null;
    return {
      required,
      allowed,
      reason,
      sourceKind: fields.sourceKind || null,
      // Ready-to-render flags for the sidebar (so it renders, never re-decides).
      canPin: allowed,
      blockReason: allowed ? null : reason,
      accountGate: required && !allowed,
    };
  }

  // evaluateAccountGate — the source-account approval decision.
  //
  // input: {
  //   sourceKind,       // raw or normalized source kind (janitor/saucepan/...)
  //   loggedIn,         // boolean: source-site session detected
  //   hasIdentity,      // boolean: a source account identity could be derived
  //   approvalState,    // stored approval state for the identity (raw or normalized)
  // }
  // returns: { required, allowed, reason, sourceKind, canPin, blockReason, accountGate }
  function evaluateAccountGate(input) {
    const root = input && typeof input === "object" ? input : {};
    const sourceKind = normalizeGateSourceKind(root.sourceKind);
    if (!sourceKind) {
      return buildGateResult({ required: false, allowed: true, reason: null, sourceKind: null });
    }
    if (root.loggedIn !== true) {
      return buildGateResult({ required: true, allowed: false, reason: "source_login_required", sourceKind });
    }
    if (root.hasIdentity !== true) {
      return buildGateResult({ required: true, allowed: false, reason: "source_account_unknown", sourceKind });
    }
    const approvalState = normalizeApprovalState(root.approvalState);
    if (approvalState === SOURCE_ACCOUNT_APPROVAL_CONFIRMED) {
      return buildGateResult({ required: true, allowed: true, reason: null, sourceKind });
    }
    if (approvalState === SOURCE_ACCOUNT_APPROVAL_REJECTED) {
      return buildGateResult({ required: true, allowed: false, reason: "source_account_rejected", sourceKind });
    }
    return buildGateResult({ required: true, allowed: false, reason: "source_account_confirmation_required", sourceKind });
  }

  // getExistingPreflightResult — normalize a Datacat preflight into an
  // "already on Datacat" descriptor (or null). Pure; shared by background queue
  // worker and sidebar display so the "exists" rule cannot drift.
  function getExistingPreflightResult(preflight) {
    const root = preflight && typeof preflight === "object" ? preflight : {};
    const existing = root.existing && typeof root.existing === "object" ? root.existing : {};
    if (existing.exists !== true) return null;
    return {
      viewUrl: root.actions && root.actions.viewUrl ? root.actions.viewUrl : existing.viewUrl || null,
      title: existing.title || null,
      ownerVisible: existing.ownerVisible === true
        ? true
        : existing.ownerVisible === false
          ? false
          : null,
    };
  }

  // evaluatePreflightBlock — should pinning be blocked pending the Datacat
  // preflight? Pure decision over the settled inputs; the sidebar keeps its own
  // request-staleness bookkeeping but must defer the actual block/allow rule to
  // this helper so it matches background behavior.
  //
  // input: {
  //   connected,   // boolean: Datacat session ready
  //   loading,     // boolean: a preflight request is in flight for this character
  //   error,       // truthy: last preflight failed
  //   preflight,   // resolved preflight result object (or null)
  // }
  // returns: { blocked, reason, canPin }
  function evaluatePreflightBlock(input) {
    const root = input && typeof input === "object" ? input : {};
    if (root.connected !== true) {
      return { blocked: true, reason: "datacat_not_connected", canPin: false };
    }
    if (root.loading === true) {
      return { blocked: true, reason: "preflight_pending", canPin: false };
    }
    if (root.error) {
      return { blocked: true, reason: "preflight_failed", canPin: false };
    }
    const preflight = root.preflight;
    const succeeded = !!(preflight && preflight.success !== false);
    if (!succeeded) {
      return { blocked: true, reason: "preflight_pending", canPin: false };
    }
    return { blocked: false, reason: null, canPin: true };
  }

  // resolveCharacterPrimaryAction — one primary CTA for every settled
  // local/Datacat state. Existing Datacat records are never replaced here:
  // retrieval either creates the missing local copy, creates the current
  // account's missing Datacat copy, or opens the already-available record.
  function resolveCharacterPrimaryAction(input) {
    const root = input && typeof input === "object" ? input : {};
    const hasLocal = root.hasLocal === true;
    const datacatExists = root.datacatExists === true;
    const datacatOwned = datacatExists && root.datacatOwned === true;
    if (hasLocal && datacatOwned) {
      return {
        action: "view-existing-datacat",
        label: "View on Datacat",
        kind: "view",
      };
    }
    if (hasLocal) {
      return {
        action: "pin-local-existing",
        label: root.uploadFailed === true ? "Retry Datacat upload" : "Pin to Datacat",
        kind: root.uploadFailed === true ? "retry_upload" : "upload",
      };
    }
    return {
      action: datacatOwned ? "save-local-existing" : "start-current-retrieval",
      label: "Pin It!",
      kind: "retrieve",
    };
  }

  const api = Object.freeze({
    SOURCE_ACCOUNT_APPROVAL_CONFIRMED,
    SOURCE_ACCOUNT_APPROVAL_REJECTED,
    normalizeGateSourceKind,
    normalizeApprovalState,
    evaluateAccountGate,
    evaluatePreflightBlock,
    getExistingPreflightResult,
    resolveCharacterPrimaryAction,
  });

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.SourceVaultPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
