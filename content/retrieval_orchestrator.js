"use strict";

// content/retrieval_orchestrator.js
// Isolated-world retrieval pipelines: Janitor core + Janny recovery, Saucepan
// core, and creator-profile capture. Sends bridge requests to the page world
// and forwards sanitized save payloads to the background worker. Consumes shared
// globals/helpers declared in page_state.js and bridge_rpc.js.

  // --- retrieval option / component helpers ---
  function normalizeRetrievalOptions(options) {
    const root = options && typeof options === "object" ? options : {};
    const visibility = String(root.visibility || "public").trim().toLowerCase() === "mine" ? "mine" : "public";
    return {
      ...root,
      visibility,
      forceRetrieve: root.forceRetrieve === true,
      localOnly: root.localOnly === true,
      updateDatacat: root.updateDatacat === true,
      preflight: root.preflight && typeof root.preflight === "object" ? root.preflight : null,
    };
  }

  function shouldCaptureCreatorForRetrieval(options) {
    const root = normalizeRetrievalOptions(options);
    if (root.forceRetrieve === true) return true;
    return !(root.preflight && root.preflight.creator && root.preflight.creator.shouldCaptureCreator === false);
  }

  function getSourceAccountIdFromAuth(auth) {
    const root = auth && typeof auth === "object" ? auth : {};
    const user = root.user && typeof root.user === "object" ? root.user : {};
    const candidates = [
      user.id,
      user.userId,
      user.uuid,
      user.profileId,
      user.publicId,
      user.handle,
      user.userName,
      user.username,
      root.userId,
      root.username,
    ];
    for (const candidate of candidates) {
      const value = String(candidate || "").trim();
      if (value) return value;
    }
    return null;
  }

  async function resolveJanitorExtractionPersonaAlias(retrievalId) {
    let accountId = getSourceAccountIdFromAuth(state && state.auth);
    if (!accountId) {
      const detected = await sourceBridgeRequest(
        "janitor",
        "detectSession",
        {},
        30000,
        retrievalId,
      );
      accountId = getSourceAccountIdFromAuth(detected);
    }
    if (!accountId) throw new Error("source_account_identity_missing");
    const response = await chrome.runtime.sendMessage({
      type: MessageTypes.SV2_GET_EXTRACTION_PERSONA_ALIAS,
      sourceKind: "janitor",
      accountId,
    });
    const alias = Core.normalizeExtractionPersonaAlias(response && response.alias);
    if (!response || response.ok !== true || !alias) {
      throw new Error(response && response.error || "extraction_persona_alias_unavailable");
    }
    return alias;
  }

  function buildSkippedCreatorCapture(source, fields, options) {
    const preflightCreator = options && options.preflight && options.preflight.creator ? options.preflight.creator : {};
    return Core.sanitizeForTransport({
      success: false,
      skipped: true,
      source,
      reason: preflightCreator.reason || "creator_profile_recently_fresh",
      freshness: preflightCreator.freshness || null,
      ...(fields || {}),
    });
  }

  function buildPendingRetrievalComponents(sourceKind) {
    const isSaucepan = sourceKind === "saucepan";
    return {
      sourceKind: isSaucepan ? "saucepan" : "janitor",
      mode: "running",
      core: { key: "core", label: "Core", status: "pending", passed: false, required: isSaucepan, message: "Waiting" },
      ...(isSaucepan
        ? {}
        : {
            recovery: {
              key: "recovery",
              label: "Recovery",
              status: "pending",
              passed: false,
              required: false,
              message: "Waiting",
            },
          }),
      creator: { key: "creator", label: "Creator", status: "pending", passed: false, required: false, message: "Waiting" },
    };
  }

  function componentMessageFromCapture(capture, fallback) {
    const root = capture && typeof capture === "object" ? capture : {};
    if (root.actionRequired === true) return root.userMessage || root.message || "Manual action required";
    if (root.status) return `HTTP ${root.status}`;
    return root.userMessage || root.message || root.reason || root.error || fallback || "";
  }

  function captureNeedsManualAction(capture) {
    return !!(capture && typeof capture === "object" && capture.actionRequired === true);
  }

  function getRecoveryStatusFromCapture(capture) {
    const root = capture && typeof capture === "object" ? capture : {};
    if (captureNeedsManualAction(root)) return "action_required";
    if (root.timedOut === true || root.status === "timed_out") return "timed_out";
    if (root.skipped === true) return "skipped";
    return root.success === true ? "passed" : "failed";
  }

  function getRecoveryMessageFromCapture(capture, fallback) {
    const root = capture && typeof capture === "object" ? capture : {};
    if (root.status === "timed_out" || root.timedOut === true) {
      return root.userMessage || "Retrieval exceeded the configured job timeout.";
    }
    if (root.skipped === true) return root.userMessage || root.reason || "Janny recovery skipped.";
    if (root.success === true) return "Captured";
    return componentMessageFromCapture(root, fallback || "Recovery not captured");
  }

  function setRetrievalComponent(key, patch) {
    const current = state.retrieval.components && typeof state.retrieval.components === "object"
      ? state.retrieval.components
      : buildPendingRetrievalComponents(state.page && state.page.sourceKind === "saucepan" ? "saucepan" : "janitor");
    const currentComponent = current[key] && typeof current[key] === "object" ? current[key] : { key, label: key };
    state.retrieval.components = {
      ...current,
      [key]: {
        ...currentComponent,
        ...(patch || {}),
      },
    };
    setState({});
  }

  // --- retrieval pipelines ---
  async function startRetrievalFromCurrentPage(options) {
    const retrievalOptions = normalizeRetrievalOptions(options);
    const parsed = getCurrentSourcePage(location.href);
    if (!parsed.isCharacterPage) {
      setRetrievalPatch({ error: "Open a direct Janitor character page or Saucepan companion page first." });
      return;
    }
    if (parsed.sourceKind === "saucepan") {
      await startSaucepanRetrievalFromCurrentPage(parsed, retrievalOptions);
      return;
    }
    if (state.retrieval.running) return;
    const retrievalId = String(retrievalOptions.retrievalId || `sv-${Date.now()}-${parsed.characterId.slice(0, 8)}`);
    activeRetrievalId = retrievalId;
    lastJannyRecoveryJobStatus = null;
    latestCapture = null;
    state.retrieval = {
      retrievalId,
      queueItemId: retrievalOptions.queueItemId || null,
      queueManaged: retrievalOptions.queueManaged === true,
      running: true,
      stage: "start",
      message: "Starting retrieval...",
      logs: [],
      components: buildPendingRetrievalComponents("janitor"),
      summary: null,
      error: null,
      startedAt: retrievalOptions.jobStartedAt || nowIso(),
      finishedAt: null,
      jannyRecoveryJob: null,
    };
    setState({});
    appendRetrievalLog("start", "Starting Janitor core capture.", { characterId: parsed.characterId });
    try {
      const extractionPersonaAlias = await resolveJanitorExtractionPersonaAlias(retrievalId);
      let coreCapture = null;
      try {
        coreCapture = await sourceBridgeRequest(
          "janitor",
          "captureCharacter",
          {
            url: parsed.normalizedUrl,
            characterId: parsed.characterId,
            extractionPersonaAlias,
          },
          180000,
          retrievalId,
        );
        setRetrievalComponent("core", {
          status: coreCapture && coreCapture.success === true ? "passed" : "failed",
          passed: !!coreCapture && coreCapture.success === true,
          message: coreCapture && coreCapture.success === true
            ? "Captured"
            : componentMessageFromCapture(coreCapture, "Core capture failed"),
        });
      } catch (coreError) {
        coreCapture = {
          success: false,
          source: "janitor_core_extension",
          characterId: parsed.characterId,
          pageUrl: parsed.normalizedUrl,
          error: shortError(coreError),
        };
        setRetrievalComponent("core", {
          status: "failed",
          passed: false,
          message: shortError(coreError),
        });
        appendRetrievalLog("core", "Janitor core capture failed; trying Janny recovery.", { error: shortError(coreError) });
      }
      appendRetrievalLog("janny", "Starting Janny capture.", { characterId: parsed.characterId });
      let jannyCapture = null;
      try {
        jannyCapture = await chrome.runtime.sendMessage({
          type: MessageTypes.SV_RETRIEVE_JANNY,
          characterId: parsed.characterId,
          retrievalId,
          jobStartedAt: state.retrieval.startedAt,
        });
      } catch (jannyError) {
        jannyCapture = {
          success: false,
          source: "janny_extension_tab",
          characterId: parsed.characterId,
          characterUrl: `https://jannyai.com/characters/${parsed.characterId}`,
          error: shortError(jannyError),
        };
      }
      setRetrievalComponent("recovery", {
        status: getRecoveryStatusFromCapture(jannyCapture),
        passed: !!jannyCapture && jannyCapture.success === true,
        message: getRecoveryMessageFromCapture(jannyCapture, "Recovery not captured"),
      });
      if (captureNeedsManualAction(jannyCapture)) {
        appendRetrievalLog("janny_action_required", componentMessageFromCapture(jannyCapture, "Source page action required."), {
          tabId: jannyCapture.tabId || null,
          finalUrl: jannyCapture.finalUrl || jannyCapture.characterUrl || null,
          userAction: jannyCapture.userAction || null,
        });
        setRetrievalPatch({
          running: false,
          stage: "action_required",
          message: "Source page action required.",
          summary: "Continue in the opened source page, then click Retrieve again.",
          error: null,
          finishedAt: nowIso(),
        });
        return;
      }
      if (jannyCapture && jannyCapture.error === "job_timeout") {
        throw new Error("job_timeout");
      }
      if (jannyCapture && (jannyCapture.status === "timed_out" || jannyCapture.timedOut === true || jannyCapture.skipped === true)) {
        appendRetrievalLog("janny_skipped", getRecoveryMessageFromCapture(jannyCapture, "Janny recovery skipped."), {
          reason: jannyCapture.skipReason || jannyCapture.error || null,
          recoveryJobId: jannyCapture.recoveryJobId || null,
        });
      }
      const creatorId =
        Core.normalizeUuid(coreCapture && coreCapture.character && coreCapture.character.creatorId) ||
        Core.normalizeUuid(jannyCapture && jannyCapture.detail && jannyCapture.detail.creatorId) ||
        Core.normalizeUuid(jannyCapture && jannyCapture.character && jannyCapture.character.creatorId);
      const creatorName =
        (coreCapture && coreCapture.character && coreCapture.character.creatorName) ||
        (jannyCapture && jannyCapture.detail && jannyCapture.detail.creatorName) ||
        (jannyCapture && jannyCapture.character && jannyCapture.character.creatorName) ||
        null;
      let creatorCapture = null;
      if (creatorId && shouldCaptureCreatorForRetrieval(retrievalOptions)) {
        appendRetrievalLog("creator", "Starting creator profile capture.", { creatorId, creatorName });
        try {
          creatorCapture = await sourceBridgeRequest(
            "janitor",
            "captureCreator",
            { creatorId, creatorName },
            150000,
            retrievalId,
          );
          setRetrievalComponent("creator", {
            status: creatorCapture && creatorCapture.success === true ? "passed" : "failed",
            passed: !!creatorCapture && creatorCapture.success === true,
            message: creatorCapture && creatorCapture.success === true
              ? "Captured"
              : componentMessageFromCapture(creatorCapture, "Creator not captured"),
          });
        } catch (creatorError) {
          creatorCapture = {
            success: false,
            source: "janitor_creator_extension",
            creatorId,
            creatorName,
            error: shortError(creatorError),
          };
          setRetrievalComponent("creator", {
            status: "failed",
            passed: false,
            message: shortError(creatorError),
          });
          appendRetrievalLog("creator", "Creator profile capture failed.", { error: shortError(creatorError) });
        }
      } else if (creatorId) {
        creatorCapture = buildSkippedCreatorCapture("janitor_creator_extension", { creatorId, creatorName }, retrievalOptions);
        setRetrievalComponent("creator", {
          status: "skipped",
          passed: true,
          message: creatorCapture.reason || "Creator fresh",
        });
        appendRetrievalLog("creator", "Creator profile capture skipped; Datacat has a fresh creator profile.", {
          creatorId,
          freshness: retrievalOptions.preflight && retrievalOptions.preflight.creator
            ? retrievalOptions.preflight.creator.freshness
            : null,
        });
      } else {
        setRetrievalComponent("creator", {
          status: "skipped",
          passed: true,
          message: "No creator id",
        });
        appendRetrievalLog("creator", "Creator profile capture skipped; creator id was not available.");
      }
      const coreOk = !!coreCapture && coreCapture.success === true;
      const jannyOk = !!jannyCapture && jannyCapture.success === true;
      if (!coreOk && !jannyOk) {
        throw new Error(
          compactMeta([
            "Core and recovery both failed",
            componentMessageFromCapture(coreCapture, null),
            componentMessageFromCapture(jannyCapture, null),
          ]),
        );
      }
      const captureRoot = {
        schemaVersion: 1,
        source: "source-vault-sidebar",
        sourceKind: "janitor",
        capturedAt: nowIso(),
        characterId: parsed.characterId,
        components: state.retrieval.components || null,
        janitorCore: coreCapture,
        janny: jannyCapture,
        creator: creatorCapture,
      };
      captureRoot.envelope = SourceRegistry.buildCaptureEnvelope("janitor", captureRoot, {
        sourceEntityId: parsed.characterId,
        canonicalUrl: parsed.normalizedUrl,
        capturedAt: captureRoot.capturedAt,
        completeness: captureRoot.components,
      });
      latestCapture = Core.sanitizeForTransport(captureRoot);
      let saveResult = null;
      try {
        saveResult = await chrome.runtime.sendMessage({
          type: MessageTypes.SV_SAVE_RETRIEVED_CHARACTER,
          retrievalId,
          queueItemId: retrievalOptions.queueItemId || null,
          capture: latestCapture,
          uploadOptions: retrievalOptions,
        });
        if (saveResult && saveResult.ok) {
          appendRetrievalLog("saved", "Saved retrieved character locally.", {
            characterId: saveResult.item && saveResult.item.id,
          });
        } else {
          appendRetrievalLog("saved", "Local save failed.", {
            error: (saveResult && saveResult.error) || "storage_error",
          });
        }
      } catch (saveError) {
        appendRetrievalLog("saved", "Local save failed.", { error: shortError(saveError) });
      }
      const creatorSkipped = !!creatorCapture && creatorCapture.skipped === true;
      const creatorOk = !creatorId || creatorSkipped || (!!creatorCapture && creatorCapture.success === true);
      setRetrievalPatch({
        running: false,
        stage: "done",
        message: "Retrieval finished.",
        components: Core.buildCaptureComponentStatuses(latestCapture),
        summary: `Core ${coreOk ? "captured" : "failed"}; Janny ${jannyOk ? "captured" : "not captured"}; Creator ${creatorSkipped ? "fresh" : creatorOk ? "captured" : "not captured"}; local ${saveResult && saveResult.ok ? "saved" : "not saved"}.`,
        error: null,
        finishedAt: nowIso(),
        jannyRecoveryJob: null,
      });
    } catch (error) {
      setRetrievalPatch({
        running: false,
        stage: "failed",
        message: "Retrieval failed.",
        error: shortError(error),
        finishedAt: nowIso(),
        jannyRecoveryJob: null,
      });
      appendRetrievalLog("failed", "Retrieval failed.", { error: shortError(error) });
    }
  }

  async function retrieveCreatorProfileFromCurrentPage(payload) {
    const parsed = getCurrentSourcePage(location.href);
    const sourceKind =
      (payload && Core.normalizeSourceKind && Core.normalizeSourceKind(payload.sourceKind)) ||
      (Core.normalizeSourceKind && Core.normalizeSourceKind(parsed.sourceKind)) ||
      parsed.sourceKind;
    const retrievalId = `creator-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (sourceKind === "saucepan") {
      const requested = (payload && (payload.creatorHandle || payload.handle || payload.url)) || parsed.creatorHandle || parsed.normalizedUrl;
      const creatorHandle = Core.parseSaucepanCreatorUrl(requested || "").handle ||
        String((payload && (payload.creatorHandle || payload.handle)) || parsed.creatorHandle || "").replace(/^@+/, "").trim();
      if (!creatorHandle) throw new Error("missing_saucepan_creator_handle");
      return sourceBridgeRequest(
        "saucepan",
        "captureCreator",
        { creatorHandle },
        180000,
        retrievalId,
      );
    }
    const creatorId =
      Core.normalizeUuid(payload && payload.creatorId) ||
      Core.normalizeUuid(parsed.creatorId);
    if (!creatorId) throw new Error("missing_creator_id");
    return sourceBridgeRequest(
      "janitor",
      "captureCreator",
      {
        creatorId,
        creatorName: payload && payload.creatorName ? payload.creatorName : null,
      },
      120000,
      retrievalId,
    );
  }

  async function startSaucepanRetrievalFromCurrentPage(parsed, options) {
    const retrievalOptions = normalizeRetrievalOptions(options);
    if (state.retrieval.running) return;
    const companionId = parsed.companionId || parsed.characterId;
    const retrievalId = String(retrievalOptions.retrievalId || `sv-sp-${Date.now()}-${companionId.slice(0, 8)}`);
    activeRetrievalId = retrievalId;
    latestCapture = null;
    state.retrieval = {
      retrievalId,
      queueItemId: retrievalOptions.queueItemId || null,
      queueManaged: retrievalOptions.queueManaged === true,
      running: true,
      stage: "start",
      message: "Starting Saucepan retrieval...",
      logs: [],
      components: buildPendingRetrievalComponents("saucepan"),
      summary: null,
      error: null,
      startedAt: nowIso(),
      finishedAt: null,
    };
    setState({});
    appendRetrievalLog("start", "Starting Saucepan core capture.", { companionId });
    try {
      const coreCapture = await sourceBridgeRequest(
        "saucepan",
        "captureCharacter",
        { url: parsed.normalizedUrl, companionId },
        150000,
        retrievalId,
      );
      setRetrievalComponent("core", {
        status: coreCapture && coreCapture.success === true ? "passed" : "failed",
        passed: !!coreCapture && coreCapture.success === true,
        message: coreCapture && coreCapture.success === true
          ? "Captured"
          : componentMessageFromCapture(coreCapture, "Core capture failed"),
      });
      const creatorHandle =
        (coreCapture && coreCapture.companion && (coreCapture.companion.creatorHandle || coreCapture.companion.authorHandle)) ||
        (state.character && state.character.creatorHandle) ||
        null;
      let creatorCapture = null;
      if (creatorHandle && shouldCaptureCreatorForRetrieval(retrievalOptions)) {
        appendRetrievalLog("saucepan_creator", "Starting Saucepan creator profile capture.", { creatorHandle });
        try {
          creatorCapture = await sourceBridgeRequest(
            "saucepan",
            "captureCreator",
            { creatorHandle },
            150000,
            retrievalId,
          );
          setRetrievalComponent("creator", {
            status: creatorCapture && creatorCapture.success === true ? "passed" : "failed",
            passed: !!creatorCapture && creatorCapture.success === true,
            message: creatorCapture && creatorCapture.success === true
              ? "Captured"
              : componentMessageFromCapture(creatorCapture, "Creator not captured"),
          });
        } catch (creatorError) {
          creatorCapture = {
            success: false,
            source: "saucepan_creator_extension",
            creatorHandle,
            error: shortError(creatorError),
          };
          setRetrievalComponent("creator", {
            status: "failed",
            passed: false,
            message: shortError(creatorError),
          });
          appendRetrievalLog("saucepan_creator", "Saucepan creator profile capture failed.", { error: shortError(creatorError) });
        }
      } else if (creatorHandle) {
        creatorCapture = buildSkippedCreatorCapture("saucepan_creator_extension", { creatorHandle }, retrievalOptions);
        setRetrievalComponent("creator", {
          status: "skipped",
          passed: true,
          message: creatorCapture.reason || "Creator fresh",
        });
        appendRetrievalLog("saucepan_creator", "Saucepan creator profile capture skipped; Datacat has a fresh creator profile.", {
          creatorHandle,
          freshness: retrievalOptions.preflight && retrievalOptions.preflight.creator
            ? retrievalOptions.preflight.creator.freshness
            : null,
        });
      } else {
        setRetrievalComponent("creator", {
          status: "skipped",
          passed: true,
          message: "No creator handle",
        });
        appendRetrievalLog("saucepan_creator", "Saucepan creator profile capture skipped; creator handle was not available.");
      }
      const captureRoot = {
        schemaVersion: 1,
        source: "source-vault-sidebar",
        sourceKind: "saucepan",
        capturedAt: nowIso(),
        characterId: companionId,
        companionId,
        components: state.retrieval.components || null,
        saucepanCore: coreCapture,
        saucepanCreator: creatorCapture,
      };
      captureRoot.envelope = SourceRegistry.buildCaptureEnvelope("saucepan", captureRoot, {
        sourceEntityId: companionId,
        canonicalUrl: parsed.normalizedUrl,
        capturedAt: captureRoot.capturedAt,
        completeness: captureRoot.components,
      });
      latestCapture = Core.sanitizeForTransport(captureRoot);
      let saveResult = null;
      try {
        saveResult = await chrome.runtime.sendMessage({
          type: MessageTypes.SV_SAVE_RETRIEVED_CHARACTER,
          retrievalId,
          queueItemId: retrievalOptions.queueItemId || null,
          capture: latestCapture,
          uploadOptions: retrievalOptions,
        });
        if (saveResult && saveResult.ok) {
          appendRetrievalLog("saved", "Saved retrieved Saucepan companion locally.", {
            companionId: saveResult.item && saveResult.item.id,
          });
        } else {
          appendRetrievalLog("saved", "Local save failed.", {
            error: (saveResult && saveResult.error) || "storage_error",
          });
        }
      } catch (saveError) {
        appendRetrievalLog("saved", "Local save failed.", { error: shortError(saveError) });
      }
      const coreOk = !!coreCapture && coreCapture.success === true;
      const creatorSkipped = !!creatorCapture && creatorCapture.skipped === true;
      const creatorOk = !creatorHandle || creatorSkipped || (!!creatorCapture && creatorCapture.success === true);
      setRetrievalPatch({
        running: false,
        stage: "done",
        message: "Saucepan retrieval finished.",
        components: Core.buildCaptureComponentStatuses(latestCapture),
        summary: `Saucepan core ${coreOk ? "captured" : "failed"}; Creator ${creatorSkipped ? "fresh" : creatorOk ? "captured" : "not captured"}; local ${saveResult && saveResult.ok ? "saved" : "not saved"}.`,
        error: coreOk ? null : (coreCapture && coreCapture.error) || null,
        finishedAt: nowIso(),
      });
    } catch (error) {
      setRetrievalPatch({
        running: false,
        stage: "failed",
        message: "Saucepan retrieval failed.",
        error: shortError(error),
        finishedAt: nowIso(),
      });
      appendRetrievalLog("failed", "Saucepan retrieval failed.", { error: shortError(error) });
    }
  }
