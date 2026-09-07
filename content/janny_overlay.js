"use strict";

// content/janny_overlay.js
// Isolated-world Janny recovery overlay + job-update handling. Consumes shared
// globals (state, activeRetrievalId, recoveryOverlayRoot, lastJannyRecoveryJobStatus)
// and helpers declared in page_state.js / retrieval_orchestrator.js.

  function formatJannyRecoveryJobMessage(job) {
    const root = job && typeof job === "object" ? job : {};
    const status = String(root.status || "").trim();
    const seconds = Math.max(0, Number(root.remainingSeconds || Math.ceil(Number(root.remainingMs || 0) / 1000)) || 0);
    if (status === "waiting_user_action") {
      return `Action required: continue in the opened source page. Job ends in ${seconds}s.`;
    }
    if (status === "resuming") return "Source page ready. Continuing retrieval.";
    if (status === "timed_out") return "Retrieval exceeded the configured job timeout.";
    return "Source page status updated.";
  }

  function isRecoveryOverlayActive(job) {
    const status = String(job && job.status ? job.status : "").trim();
    return status === "waiting_user_action" || status === "resuming";
  }

  function removeRecoveryOverlay() {
    try {
      if (recoveryOverlayRoot && recoveryOverlayRoot.parentNode) recoveryOverlayRoot.remove();
    } catch (_) {}
    recoveryOverlayRoot = null;
  }

  function renderRecoveryOverlay(job) {
    if (!isRecoveryOverlayActive(job)) {
      removeRecoveryOverlay();
      return;
    }
    const root = job && typeof job === "object" ? job : {};
    const seconds = Math.max(0, Number(root.remainingSeconds || Math.ceil(Number(root.remainingMs || 0) / 1000)) || 0);
    const sourceLabel = "Source page";
    if (!recoveryOverlayRoot || !document.documentElement.contains(recoveryOverlayRoot)) {
      recoveryOverlayRoot = document.createElement("div");
      recoveryOverlayRoot.id = "source-vault-recovery-overlay";
      recoveryOverlayRoot.setAttribute("data-source-vault", "recovery-overlay");
      recoveryOverlayRoot.style.cssText = [
        "position:fixed",
        "top:14px",
        "right:14px",
        "z-index:2147483647",
        "width:min(310px,calc(100vw - 28px))",
        "box-sizing:border-box",
        "padding:12px 14px",
        "border:1px solid rgba(236,72,153,.55)",
        "border-radius:12px",
        "background:rgba(18,12,18,.94)",
        "color:#f8e7f0",
        "font:600 13px/1.35 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        "box-shadow:0 18px 40px rgba(0,0,0,.35)",
        "pointer-events:none",
      ].join(";");
      (document.body || document.documentElement).appendChild(recoveryOverlayRoot);
    }
    recoveryOverlayRoot.innerHTML = `
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#f472b6;margin-bottom:5px;">Pincat by Cressida</div>
      <div style="font-size:14px;color:#fff;margin-bottom:4px;">Source page action required</div>
      <div style="color:#d6c4cf;">Continue in the opened source page.</div>
      <div style="margin-top:7px;color:#f9a8d4;">Job ends in ${seconds}s · ${sourceLabel}</div>
    `;
  }

  function applyJannyRecoveryJobUpdate(job) {
    const root = job && typeof job === "object" ? job : {};
    if (!root.jobId) return;
    if (root.retrievalId && activeRetrievalId && root.retrievalId !== activeRetrievalId) return;
    renderRecoveryOverlay(root);
    if (!isRecoveryOverlayActive(root) && root.status === "completed") {
      removeRecoveryOverlay();
    }
    const status = String(root.status || "waiting_user_action").trim();
    const message = formatJannyRecoveryJobMessage(root);
    const componentStatus = status === "waiting_user_action" ? "waiting_user_action" : status;
    setRetrievalComponent("recovery", {
      status: componentStatus,
      passed: false,
      message,
    });
    if (lastJannyRecoveryJobStatus !== status) {
      lastJannyRecoveryJobStatus = status;
      appendRetrievalLog(status === "waiting_user_action" ? "janny_action_required" : "janny", message, {
        jobId: root.jobId,
        jannyTabId: root.jannyTabId || null,
        remainingMs: root.remainingMs || null,
      });
    }
    setRetrievalPatch({
      stage: status === "waiting_user_action" ? "janny_waiting" : status === "timed_out" ? "janny_skipped" : "janny_resuming",
      message,
      jannyRecoveryJob: Core.sanitizeForTransport(root),
    });
  }
