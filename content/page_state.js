"use strict";

// content/page_state.js
// Isolated-world page/auth detection, navigation tracking, state shell, and
// SV_TAB_STATE publishing. Declares the shared `state` object and cross-module
// globals consumed by janny_overlay / retrieval_orchestrator / isolated.

// Shared globals use `var` (not const/let) so the isolated content bundle stays
// safe to re-inject into an already-injected tab (background re-injection path).
var MessageTypes = (globalThis.SourceVaultMessages && SourceVaultMessages.MessageTypes) || {};
var Core = globalThis.SourceVaultCore;
var SourceRegistry = globalThis.SourceVaultSourceRegistry;
var ROUTE_POLL_MS = 1000;
var CHARACTER_STATE_RETRY_LIMIT = 12;
var CHARACTER_STATE_RETRY_MS = 900;
var CONTENT_INSTANCE_ID = CONTENT_RUNTIME.contentInstanceId;
var INITIAL_SOURCE_PAGE = getCurrentSourcePage(location.href);

var state = CONTENT_RUNTIME.state || {
  instanceId: CONTENT_INSTANCE_ID,
  revision: 0,
  auth: { checking: true, loggedIn: false, tokenPresent: false, user: null, error: null },
  character: null,
  page: {
    url: location.href,
    sourceKind: INITIAL_SOURCE_PAGE.sourceKind || "unknown",
    sourceLabel: INITIAL_SOURCE_PAGE.sourceLabel || null,
    isJanitor: INITIAL_SOURCE_PAGE.isJanitor === true,
    isSaucepan: INITIAL_SOURCE_PAGE.isSaucepan === true,
    isCharacterPage: INITIAL_SOURCE_PAGE.isCharacterPage === true,
    isCreatorPage: INITIAL_SOURCE_PAGE.isCreatorPage === true,
    characterId: INITIAL_SOURCE_PAGE.characterId || null,
    companionId: INITIAL_SOURCE_PAGE.companionId || null,
    creatorId: INITIAL_SOURCE_PAGE.creatorId || null,
    creatorHandle: INITIAL_SOURCE_PAGE.creatorHandle || null,
    normalizedUrl: INITIAL_SOURCE_PAGE.normalizedUrl || null,
    pendingNavigation: true,
    navigationId: 0,
    contentInstanceId: CONTENT_INSTANCE_ID,
    navigationPhase: "loading",
  },
  retrieval: {
    running: false,
    stage: "idle",
    message: "",
    logs: [],
    summary: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  },
  overlayCollapsed: false,
  lastUpdatedAt: new Date().toISOString(),
};
CONTENT_RUNTIME.state = state;

var overlayRoot = null;
var activeNavigation = null;
var navigationSequence = 0;
var pageRefreshSequence = 0;
var latestCapture = null;
var characterNameRetryCount = 0;
var activeRetrievalId = null;
var lastJannyRecoveryJobStatus = null;
var recoveryOverlayRoot = null;
var networkAuthIdentityRefresh = null;
var lastNetworkAuthIdentityCheckAt = 0;

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function compactMeta(parts) {
  return (Array.isArray(parts) ? parts : [])
    .filter((part) => part != null && String(part).trim() !== "")
    .map((part) => String(part).trim())
    .join(" · ");
}

  // --- url / page parsing + navigation tracking ---
  function getCurrentSourcePage(rawUrl) {
    const url = rawUrl || location.href;
    if (SourceRegistry && typeof SourceRegistry.resolveUrl === "function") {
      const registered = SourceRegistry.resolveUrl(url);
      if (registered && (registered.isCharacterPage || registered.isCreatorPage)) {
        return {
          ...registered,
          isJanitor: registered.sourceKind === "janitor",
          isSaucepan: registered.sourceKind === "saucepan",
        };
      }
    }
    const janitor = Core.parseJanitorCharacterUrl(url);
    if (janitor.valid) {
      return {
        sourceKind: "janitor",
        sourceLabel: "Janitor",
        characterId: janitor.characterId,
        normalizedUrl: janitor.normalizedUrl,
        isJanitor: true,
        isSaucepan: false,
        isCharacterPage: true,
        isCreatorPage: false,
      };
    }
    const janitorCreator = Core.parseJanitorCreatorUrl(url);
    if (janitorCreator.valid) {
      return {
        sourceKind: "janitor",
        sourceLabel: "Janitor",
        characterId: null,
        companionId: null,
        creatorId: janitorCreator.creatorId,
        creatorHandle: null,
        normalizedUrl: janitorCreator.normalizedUrl,
        isJanitor: true,
        isSaucepan: false,
        isCharacterPage: false,
        isCreatorPage: true,
      };
    }
    const saucepan = Core.parseSaucepanCompanionUrl(url);
    if (saucepan.valid) {
      return {
        sourceKind: "saucepan",
        sourceLabel: "Saucepan",
        characterId: saucepan.companionId,
        companionId: saucepan.companionId,
        normalizedUrl: saucepan.normalizedUrl,
        isJanitor: false,
        isSaucepan: true,
        isCharacterPage: true,
        isCreatorPage: false,
      };
    }
    const saucepanCreator = Core.parseSaucepanCreatorUrl(url);
    if (saucepanCreator.valid) {
      return {
        sourceKind: "saucepan",
        sourceLabel: "Saucepan",
        characterId: null,
        companionId: null,
        creatorId: null,
        creatorHandle: saucepanCreator.handle,
        normalizedUrl: saucepanCreator.normalizedUrl,
        isJanitor: false,
        isSaucepan: true,
        isCharacterPage: false,
        isCreatorPage: true,
      };
    }
    let host = "";
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch (_) {}
    return {
      sourceKind: host.includes("saucepan.ai") ? "saucepan" : host.includes("janitorai.com") ? "janitor" : "unknown",
      sourceLabel: host.includes("saucepan.ai") ? "Saucepan" : host.includes("janitorai.com") ? "Janitor" : "Source",
      characterId: null,
      companionId: null,
      creatorId: null,
      creatorHandle: null,
      normalizedUrl: null,
      isJanitor: host.includes("janitorai.com"),
      isSaucepan: host.includes("saucepan.ai"),
      isCharacterPage: false,
      isCreatorPage: false,
    };
  }

  function cleanCreatorPageTitle(value, sourceKind) {
    let text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return null;
    const kind = Core.normalizeSourceKind ? Core.normalizeSourceKind(sourceKind) : sourceKind;
    if (kind === "janitor") {
      text = text.replace(/\s*[-|]\s*janitor(?:ai)?\s*$/i, "").trim();
      if (/^(janitor|janitor ai|creator profile|profile|just a moment|security verification)$/i.test(text)) return null;
      if (/^janitor(?:ai)?(?:\.com)?\b/i.test(text)) return null;
    } else if (kind === "saucepan") {
      text = text.replace(/\s*[-|]\s*saucepan\s*$/i, "").trim();
      if (/^(saucepan|saucepan ai|creator profile|profile|just a moment|security verification)$/i.test(text)) return null;
      if (/^saucepan(?:\.ai)?\b/i.test(text)) return null;
    }
    return text.length > 120 ? text.slice(0, 120).trim() : text;
  }

  function readMetaContent(selector) {
    try {
      return document.querySelector(selector)?.content || null;
    } catch (_) {
      return null;
    }
  }

  function documentMatchesCreatorTarget(parsed) {
    const sourceKind = Core.normalizeSourceKind ? Core.normalizeSourceKind(parsed && parsed.sourceKind) : parsed && parsed.sourceKind;
    const id = Core.normalizeUuid && parsed ? Core.normalizeUuid(parsed.creatorId) : null;
    const handle = String((parsed && parsed.creatorHandle) || "").replace(/^@+/, "").trim().toLowerCase();
    if (!id && !handle) return true;
    const fields = [
      document.querySelector('link[rel="canonical"]')?.href,
      readMetaContent('meta[property="og:url"]'),
      readMetaContent('meta[name="twitter:url"]'),
    ].map((value) => String(value || "").toLowerCase());
    if (id && fields.some((value) => value.includes(id))) return true;
    if (handle && fields.some((value) => value.includes(`/${handle}`) || value.includes(encodeURIComponent(handle)))) return true;
    try {
      const body = String(document.body && document.body.innerText ? document.body.innerText : "").toLowerCase();
      if (id && body.includes(id)) return true;
      if (handle && (body.includes(`@${handle}`) || (sourceKind === "saucepan" && body.includes(handle)))) return true;
    } catch (_) {}
    return false;
  }

  function readCreatorPageHint(parsed) {
    if (!parsed || !parsed.isCreatorPage || !documentMatchesCreatorTarget(parsed)) return null;
    const titleCandidates = [
      document.querySelector("main h1, h1")?.textContent,
      document.querySelector("main h2, h2")?.textContent,
      readMetaContent('meta[property="og:title"]'),
      readMetaContent('meta[name="twitter:title"]'),
      document.title,
    ];
    const name = titleCandidates
      .map((value) => cleanCreatorPageTitle(value, parsed.sourceKind))
      .find(Boolean) || null;
    const avatarUrl =
      readMetaContent('meta[property="og:image"]') ||
      readMetaContent('meta[name="twitter:image"]') ||
      null;
    if (!name && !avatarUrl) return null;
    return {
      creatorName: name,
      creatorHandle: parsed.creatorHandle || null,
      creatorId: parsed.creatorId || null,
      creatorAvatarUrl: avatarUrl,
      profileImageAssetUrl: avatarUrl,
      source: "creator_page_hint",
    };
  }

  function normalizeNavigationUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""), location.href);
      url.hash = "";
      return `${url.origin}${url.pathname}${url.search}`.toLowerCase();
    } catch (_) {
      return String(rawUrl || "").replace(/#.*$/, "").toLowerCase();
    }
  }

  function getNavigationPageType(parsed) {
    if (parsed && parsed.isCharacterPage) return "character";
    if (parsed && parsed.isCreatorPage) return "creator";
    if (parsed && (parsed.isJanitor || parsed.isSaucepan)) return "source";
    return "unknown";
  }

  function getNavigationEntityId(parsed) {
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.isCharacterPage) return parsed.characterId || parsed.companionId || null;
    if (parsed.isCreatorPage) return parsed.creatorId || parsed.creatorHandle || null;
    return null;
  }

  function buildNavigationTarget(rawUrl) {
    const url = rawUrl || location.href;
    const parsed = getCurrentSourcePage(url);
    const pageType = getNavigationPageType(parsed);
    const entityId = getNavigationEntityId(parsed);
    const normalizedUrl = normalizeNavigationUrl(parsed.normalizedUrl || url);
    const key = [
      parsed.sourceKind || "unknown",
      pageType,
      entityId || normalizedUrl || "unknown",
    ].join(":");
    return { url, parsed, pageType, entityId, normalizedUrl, key };
  }

  function buildPagePatchFromTarget(target, options) {
    const parsed = target && target.parsed ? target.parsed : getCurrentSourcePage(target && target.url);
    const creatorHint = options && options.creatorHint && typeof options.creatorHint === "object" ? options.creatorHint : {};
    const sourceInterruption = options && options.sourceInterruption && typeof options.sourceInterruption === "object"
      ? options.sourceInterruption
      : null;
    return {
      url: target && target.url ? target.url : location.href,
      sourceKind: parsed.sourceKind,
      sourceLabel: parsed.sourceLabel,
      isJanitor: parsed.isJanitor,
      isSaucepan: parsed.isSaucepan,
      isCharacterPage: parsed.isCharacterPage,
      isCreatorPage: parsed.isCreatorPage === true,
      characterId: parsed.characterId || null,
      companionId: parsed.companionId || null,
      creatorId: parsed.creatorId || null,
      creatorHandle: parsed.creatorHandle || creatorHint.creatorHandle || null,
      creatorName: creatorHint.creatorName || null,
      creatorAvatarUrl: creatorHint.creatorAvatarUrl || creatorHint.profileImageAssetUrl || null,
      profileImageAssetUrl: creatorHint.profileImageAssetUrl || creatorHint.creatorAvatarUrl || null,
      normalizedUrl: parsed.normalizedUrl || null,
      pendingNavigation: !!(options && options.pendingNavigation),
      navigationKey: target && target.key ? target.key : null,
      navigationId:
        options && Number.isFinite(options.navigationId)
          ? options.navigationId
          : activeNavigation && Number.isFinite(activeNavigation.sequence)
            ? activeNavigation.sequence
            : navigationSequence,
      contentInstanceId: CONTENT_INSTANCE_ID,
      navigationPhase: options && options.pendingNavigation ? "loading" : "ready",
      pageHintSource: creatorHint.source || null,
      interruptionDetected: sourceInterruption && sourceInterruption.detected === true,
      sourceInterruption: sourceInterruption && sourceInterruption.detected === true ? sourceInterruption : null,
    };
  }

  function readCurrentSourceInterruption(parsed) {
    if (!parsed || parsed.sourceKind !== "janitor" || !parsed.isCharacterPage) return null;
    if (!Core || typeof Core.classifySourceInterruptionHtml !== "function") return null;
    try {
      const classification = Core.classifySourceInterruptionHtml(document.documentElement.outerHTML);
      if (!classification || classification.blocked !== true) return null;
      return {
        detected: true,
        score: Number(classification.score || 0),
        signals: Array.isArray(classification.signals) ? classification.signals.slice(0, 12) : [],
      };
    } catch (_) {
      return null;
    }
  }

  function buildPendingCharacterFromTarget(target) {
    const parsed = target && target.parsed ? target.parsed : {};
    if (!parsed.isCharacterPage) return null;
    return {
      id: parsed.characterId,
      characterId: parsed.characterId,
      companionId: parsed.companionId || null,
      name: null,
      sourceKind: parsed.sourceKind,
      source: "route_pending",
    };
  }

  function isNavigationCurrent(target, sequence) {
    if (!activeNavigation || activeNavigation.sequence !== sequence) return false;
    if (!target || activeNavigation.key !== target.key) return false;
    return buildNavigationTarget(location.href).key === target.key;
  }

  function isPageRefreshCurrent(target, navigationId, refreshId) {
    return !!(
      isNavigationCurrent(target, navigationId) &&
      activeNavigation &&
      activeNavigation.refreshId === refreshId
    );
  }

  function beginNavigationTarget(target, reason) {
    navigationSequence += 1;
    activeNavigation = {
      sequence: navigationSequence,
      key: target.key,
      url: target.url,
      refreshId: null,
      reason: reason || "navigation",
      startedAt: nowIso(),
    };
    characterNameRetryCount = 0;
    if (state.retrieval && state.retrieval.running !== true) {
      state.retrieval = {
        running: false,
        stage: "idle",
        message: "",
        logs: [],
        summary: null,
        error: null,
        startedAt: null,
        finishedAt: null,
      };
    }
    setState({
      page: buildPagePatchFromTarget(target, { pendingNavigation: true, navigationId: navigationSequence }),
      character: buildPendingCharacterFromTarget(target),
    });
    return navigationSequence;
  }

  function setState(patch) {
    Object.assign(state, patch || {});
    state.revision += 1;
    state.lastUpdatedAt = nowIso();
    publishState();
  }

  function setRetrievalPatch(patch) {
    state.retrieval = { ...state.retrieval, ...(patch || {}) };
    setState({});
  }

  function appendRetrievalLog(stage, message, details) {
    const entry = {
      at: nowIso(),
      stage: String(stage || "status"),
      message: String(message || ""),
      details: details ? Core.sanitizeForTransport(details) : null,
    };
    state.retrieval.logs = [...state.retrieval.logs, entry].slice(-80);
    state.retrieval.stage = entry.stage;
    state.retrieval.message = entry.message;
    setState({});
  }

  // --- character thumbnails ---
  function getThumbnailImageUrl(value) {
    if (!value) return null;
    if (typeof value === "string") return value.trim() || null;
    if (typeof value !== "object") return null;
    return (
      value.highresUrl ||
      value.cardUrl ||
      value.thumbnailUrl ||
      value.highres_url ||
      value.card_url ||
      value.thumbnail_url ||
      value.imageUrl ||
      value.url ||
      null
    );
  }

  function getCharacterThumbnailSource(character) {
    const root = character && typeof character === "object" ? character : {};
    return getThumbnailImageUrl(root.profileImageAssetUrl || root.avatarUrl || root.imageUrl || root.avatar || root.image);
  }

  function applyCharacterThumbnail(character, entry) {
    if (!character || !entry || !entry.dataUrl) return;
    const current = state.character && typeof state.character === "object" ? state.character : null;
    const currentId = current && (current.id || current.characterId || current.companionId);
    const characterId = character.id || character.characterId || character.companionId;
    const currentImageUrl = current ? getCharacterThumbnailSource(current) : null;
    const characterImageUrl = getCharacterThumbnailSource(character);
    if (currentId && characterId && currentId !== characterId) return;
    if (currentImageUrl && characterImageUrl && currentImageUrl !== characterImageUrl) return;
    setState({
      character: {
        ...(current || character),
        thumbnailDataUrl: entry.dataUrl,
        thumbnailCacheKey: entry.cacheKey || null,
      },
    });
  }

  function requestCharacterThumbnail(character, parsed) {
    const root = character && typeof character === "object" ? character : {};
    const imageUrl = getCharacterThumbnailSource(root);
    if (!imageUrl || /^data:/i.test(imageUrl)) return;
    const sourceKind = root.sourceKind || (parsed && parsed.sourceKind) || "source";
    const entityId =
      root.id ||
      root.characterId ||
      root.companionId ||
      (parsed && (parsed.characterId || parsed.companionId)) ||
      null;
    chrome.runtime.sendMessage({
      type: MessageTypes.SV2_CACHE_THUMBNAILS,
      refs: [{
        sourceKind,
        role: "character_profile",
        entityId,
        imageUrl,
      }],
    }, (response) => {
      void chrome.runtime.lastError;
      if (!response || !response.entries) return;
      const entry = Object.values(response.entries).find((item) => item && item.dataUrl);
      if (entry) applyCharacterThumbnail(root, entry);
    });
  }

  // --- character-state retry + publish ---
  function shouldRetryCharacterState(parsed, character) {
    if (!parsed || !parsed.isCharacterPage) return false;
    if (Core && typeof Core.isSettledSourceCharacterState === "function") {
      return !Core.isSettledSourceCharacterState(parsed.sourceKind, character, parsed);
    }
    if (!character || !character.name) return true;
    return [
      "document_body",
      "document_fallback",
      "document_og_title",
      "document_title",
      "document_twitter_title",
      "url",
    ].includes(character.source);
  }

  function summarizeStateForPublish() {
    return Core.sanitizeForTransport({
      instanceId: state.instanceId,
      revision: state.revision,
      auth: state.auth,
      character: state.character,
      page: state.page,
      retrieval: state.retrieval,
      overlayCollapsed: state.overlayCollapsed,
      lastUpdatedAt: state.lastUpdatedAt,
    });
  }

  function publishState() {
    try {
      const maybePromise = chrome.runtime.sendMessage({
        type: MessageTypes.SV_TAB_STATE,
        state: summarizeStateForPublish(),
      }, () => {
        void chrome.runtime.lastError;
      });
      if (maybePromise && typeof maybePromise.catch === "function") {
        maybePromise.catch(() => {});
      }
    } catch (_) {}
  }

  async function refreshPageState(options) {
    const opts = options && typeof options === "object" ? options : {};
    const target = opts.target && opts.target.key ? opts.target : buildNavigationTarget(location.href);
    const parsed = target.parsed;
    const forcePage = !!(options && options.forcePage);
    const navigationChanged =
      opts.navigationChanged === true ||
      !activeNavigation ||
      activeNavigation.key !== target.key;
    const sequence = navigationChanged || opts.publishPending === true
      ? beginNavigationTarget(target, opts.reason || "refresh")
      : activeNavigation.sequence;
    if (!navigationChanged && activeNavigation) activeNavigation.url = target.url;
    const refreshId = ++pageRefreshSequence;
    if (activeNavigation && activeNavigation.sequence === sequence) {
      activeNavigation.refreshId = refreshId;
    }

    if (!parsed.isCharacterPage) {
      if (!isPageRefreshCurrent(target, sequence, refreshId)) return;
      let creatorHint = null;
      if (parsed.isCreatorPage) {
        const startedAt = Date.now();
        do {
          creatorHint = readCreatorPageHint(parsed);
          if (creatorHint) break;
          await sleep(250);
        } while (Date.now() - startedAt < 1500 && isPageRefreshCurrent(target, sequence, refreshId));
        if (!isPageRefreshCurrent(target, sequence, refreshId)) return;
      }
      setState({
        page: buildPagePatchFromTarget(target, { pendingNavigation: false, creatorHint, navigationId: sequence }),
        character: null,
      });
      if (options && options.forceAuth) {
        await refreshAuthState({ network: true });
      }
      return;
    }

    const sourceInterruption = readCurrentSourceInterruption(parsed);
    if (sourceInterruption) {
      if (!isPageRefreshCurrent(target, sequence, refreshId)) return;
      setState({
        page: buildPagePatchFromTarget(target, {
          pendingNavigation: false,
          navigationId: sequence,
          sourceInterruption,
        }),
        character: buildPendingCharacterFromTarget(target),
      });
      return;
    }

    let publishedCharacter = null;
    try {
      const pageResult = await sourceBridgeRequest(
        parsed.sourceKind,
        "readPageState",
        {
          url: target.url,
          sourceKind: parsed.sourceKind,
          characterId: parsed.characterId || null,
          companionId: parsed.companionId || null,
          forceRefresh: forcePage,
          waitForHydration: forcePage || navigationChanged || shouldRetryCharacterState(parsed, state.character),
        },
        forcePage ? 22000 : 15000,
      );
      if (!isPageRefreshCurrent(target, sequence, refreshId)) return;
      if (pageResult && pageResult.character) {
        publishedCharacter = {
          id: pageResult.character.id || parsed.characterId,
          characterId: pageResult.character.id || parsed.characterId,
          companionId: pageResult.character.companionId || parsed.companionId || null,
          name: pageResult.character.name || null,
          creatorId: pageResult.character.creatorId || null,
          creatorHandle: pageResult.character.creatorHandle || null,
          creatorName: pageResult.character.creatorName || null,
          avatarUrl: pageResult.character.avatarUrl || null,
          profileImageAssetUrl: pageResult.character.profileImageAssetUrl || pageResult.character.avatarUrl || null,
          sourceKind: pageResult.character.sourceKind || parsed.sourceKind,
          source: pageResult.character.source || null,
          isPublic: pageResult.character.isPublic ?? pageResult.character.is_public ?? null,
          accessLevel: pageResult.character.accessLevel || pageResult.character.access_level || null,
          visibility: pageResult.character.visibility || null,
          openDefinition: pageResult.character.openDefinition ?? pageResult.character.open_definition ?? null,
        };
        setState({
          page: buildPagePatchFromTarget(target, { pendingNavigation: false, navigationId: sequence }),
          character: publishedCharacter,
        });
        requestCharacterThumbnail(publishedCharacter, parsed);
      } else {
        setState({ page: buildPagePatchFromTarget(target, { pendingNavigation: false, navigationId: sequence }) });
      }
    } catch (_) {
      if (isPageRefreshCurrent(target, sequence, refreshId)) {
        setState({ page: buildPagePatchFromTarget(target, { pendingNavigation: false, navigationId: sequence }) });
      }
    }

    if (!isPageRefreshCurrent(target, sequence, refreshId)) return;

    if (options && options.forceAuth) {
      await refreshAuthState({ network: true });
    }

    if (
      shouldRetryCharacterState(parsed, publishedCharacter || state.character) &&
      characterNameRetryCount < CHARACTER_STATE_RETRY_LIMIT
    ) {
      characterNameRetryCount += 1;
      setTimeout(() => {
        if (isNavigationCurrent(target, sequence)) {
          refreshPageState({ forceAuth: false, forcePage: false, target, reason: "retry" });
        }
      }, CHARACTER_STATE_RETRY_MS);
    }
  }

  function hasSourceAccountIdentity(user) {
    const root = user && typeof user === "object" ? user : {};
    return [
      root.id,
      root.userId,
      root.uuid,
      root.profileId,
      root.publicId,
      root.handle,
      root.userName,
      root.username,
      root.name,
    ].some((value) => value != null && String(value).trim());
  }

  function applyAuthResult(auth, options = {}) {
    const root = auth && typeof auth === "object" ? auth : {};
    setState({
      auth: {
        checking: options.checking === true,
        loggedIn: !!root.loggedIn,
        tokenPresent: !!root.tokenPresent,
        user: root.user || null,
        status: root.status || null,
        error: root.error || null,
      },
    });
  }

  async function refreshNetworkAuthIdentity(fallbackAuth) {
    if (networkAuthIdentityRefresh) return networkAuthIdentityRefresh;
    lastNetworkAuthIdentityCheckAt = Date.now();
    setState({ auth: { ...state.auth, checking: true, error: null } });
    networkAuthIdentityRefresh = (async () => {
      try {
        const auth = await sourceBridgeRequest(getCurrentSourcePage(location.href).sourceKind, "detectSession", {}, 20000);
        if (fallbackAuth && fallbackAuth.loggedIn === true && (!auth || auth.loggedIn !== true)) {
          applyAuthResult({
            ...fallbackAuth,
            status: auth && auth.status != null ? auth.status : null,
            error: auth && auth.error ? auth.error : "source_account_identity_unavailable",
          });
          return fallbackAuth;
        }
        applyAuthResult(auth);
        return auth;
      } catch (error) {
        const fallback = fallbackAuth && fallbackAuth.loggedIn === true ? fallbackAuth : null;
        if (fallback) {
          applyAuthResult({
            ...fallback,
            error: shortError(error),
          });
          return fallback;
        }
        applyAuthResult({
          loggedIn: false,
          tokenPresent: false,
          user: null,
          error: shortError(error),
        });
        return null;
      } finally {
        networkAuthIdentityRefresh = null;
      }
    })();
    return networkAuthIdentityRefresh;
  }

  async function refreshAuthState(options) {
    const opts = options && typeof options === "object" ? options : {};
    const useNetwork = opts.network === true;
    if (useNetwork) return refreshNetworkAuthIdentity(opts.fallbackAuth || null);
    setState({ auth: { ...state.auth, checking: state.auth.checking === true, error: null } });
    try {
      const auth = await sourceBridgeRequest(getCurrentSourcePage(location.href).sourceKind, "detectLocalSession", {}, 20000);
      const needsIdentity = auth && auth.loggedIn === true && !hasSourceAccountIdentity(auth.user);
      applyAuthResult(auth, { checking: needsIdentity });
      if (needsIdentity) await refreshNetworkAuthIdentity(auth);
    } catch (error) {
      applyAuthResult({
        loggedIn: false,
        tokenPresent: false,
        user: null,
        error: shortError(error),
      });
    }
  }

  // --- route watchers + boot ---
  function installRouteWatchers() {
    let lastLocalAuthCheckAt = 0;
    const refreshLocalAuthIfDue = (options = {}) => {
      if (state.auth && state.auth.checking) return;
      const now = Date.now();
      if (state.auth && state.auth.loggedIn) {
        if (hasSourceAccountIdentity(state.auth.user)) return;
        if (options.allowNetworkIdentity !== true) return;
        if (now - lastNetworkAuthIdentityCheckAt < 5000) return;
        refreshAuthState({ network: true, fallbackAuth: state.auth });
        return;
      }
      if (now - lastLocalAuthCheckAt < 5000) return;
      lastLocalAuthCheckAt = now;
      refreshAuthState({ network: false });
    };
    const observeCurrentUrl = (reason) => {
      const target = buildNavigationTarget(location.href);
      const targetChanged = !activeNavigation || activeNavigation.key !== target.key;
      const urlChanged = !activeNavigation || activeNavigation.url !== target.url;
      if (!targetChanged && !urlChanged) return;
      refreshPageState({
        forceAuth: false,
        forcePage: false,
        target,
        navigationChanged: targetChanged,
        publishPending: targetChanged,
        reason: reason || "url_change",
      });
    };
    const notifyRoute = () => {
      observeCurrentUrl("history");
    };
    const wrapHistory = (methodName) => {
      const original = history[methodName];
      if (typeof original !== "function") return;
      history[methodName] = function wrappedHistoryMethod() {
        const result = original.apply(this, arguments);
        notifyRoute();
        return result;
      };
    };
    wrapHistory("pushState");
    wrapHistory("replaceState");
    window.addEventListener("popstate", notifyRoute);
    window.addEventListener("focus", () => refreshLocalAuthIfDue({ allowNetworkIdentity: true }));
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshLocalAuthIfDue({ allowNetworkIdentity: true });
    });
    setInterval(() => {
      observeCurrentUrl("poll");
      refreshLocalAuthIfDue();
    }, ROUTE_POLL_MS);
  }

  function boot() {
    removeLegacyOverlay();
    if (isJannyHost()) return;
    ensureBridgeReady()
      .then(() => Promise.all([refreshAuthState({ network: false }), refreshPageState({ forceAuth: false })]))
      .catch(() => {
        refreshPageState({ forceAuth: false });
        setState({
          auth: {
            checking: false,
            loggedIn: false,
            tokenPresent: false,
            user: null,
            error: "bridge_init_failed",
          },
        });
      });
    installRouteWatchers();
  }
