"use strict";

// content/sources/janny.js
// Isolated-world Janny (jannyai.com) helpers: host check, source-page
// classification, and HTML -> capture builder. Loaded in the isolated content
// bundle (single realm) alongside page_state.js; consumes the shared Core and
// nowIso globals declared there and is used by janny_overlay.js (isJannyHost)
// and isolated.js (buildJannyCaptureFromDocument). Extracted from page_state.js
// in Phase 4 so jannyai.com HTML-capture logic lives under content/sources/.

  function isJannyHost() {
    try {
      const host = String(location.hostname || "").toLowerCase();
      return host === "jannyai.com" || host === "www.jannyai.com";
    } catch (_) {
      return false;
    }
  }

  function classifySourceInterruption(text) {
    if (Core && typeof Core.classifySourceInterruptionHtml === "function") {
      return Core.classifySourceInterruptionHtml(text);
    }
    const lower = String(text || "").toLowerCase();
    const blocked = (
      lower.includes("/cdn-cgi/challenge-platform") ||
      lower.includes("__cf_chl") ||
      (lower.includes("cloudflare") && lower.includes("ray id")) ||
      lower.includes("checking your browser") ||
      lower.includes("just a moment")
    );
    return { blocked, score: blocked ? 4 : 0, signals: blocked ? ["source_page_marker"] : [] };
  }

  function buildJannyCaptureFromDocument(expectedCharacterId) {
    const parsedUrl = Core.parseJannyCharacterUrl(location.href);
    const id = Core.normalizeUuid(expectedCharacterId) || parsedUrl.characterId;
    const characterUrl = id ? `https://jannyai.com/characters/${id}` : (parsedUrl.normalizedUrl || location.href);
    if (!id) {
      return Core.sanitizeForTransport({
        success: false,
        source: "janny_extension_tab",
        characterId: null,
        characterUrl,
        finalUrl: location.href,
        error: "invalid_character_id",
      });
    }
    const html = String(document.documentElement && document.documentElement.outerHTML ? document.documentElement.outerHTML : "");
    const detail = Core.parseJannyCharacterHtml(html, location.href);
    const matched = String(detail.characterId || "").toLowerCase() === id;
    const interruption = classifySourceInterruption(html);
    const notFound = Core.isJannyCharacterNotFoundHtml && Core.isJannyCharacterNotFoundHtml(html);
    if (!interruption.blocked && notFound) {
      return Core.sanitizeForTransport({
        success: false,
        source: "janny_extension_tab",
        characterId: id,
        characterUrl,
        status: 404,
        finalUrl: location.href,
        contentType: document.contentType || "text/html",
        interruptionDetected: false,
        interruptionScore: interruption.score || 0,
        interruptionSignals: interruption.signals || [],
        matchedCharacterId: matched,
        hasDetail: false,
        notFound: true,
        error: "janny_character_not_found",
        userMessage: "Janny recovery page was not found.",
        preview: html.slice(0, 600),
      });
    }
    if (matched && detail.hasDetail === true) {
      const tavernPayload = Core.buildJannyTavernPayload(detail);
      return Core.sanitizeForTransport({
        success: true,
        source: "janny_extension_tab",
        capturedAt: nowIso(),
        characterId: id,
        characterUrl,
        status: 200,
        finalUrl: location.href,
        contentType: document.contentType || "text/html",
        interruptionDetected: false,
        interruptionScore: interruption.score || 0,
        interruptionSignals: interruption.signals || [],
        character: {
          id: detail.characterId,
          name: detail.name,
          creatorId: detail.creatorId,
          creatorName: detail.creatorName,
          avatarUrl: detail.avatarUrl,
          totalToken: detail.totalToken,
          stats: detail.stats,
          isNsfw: detail.isNsfw,
        },
        detail,
        charaTavernJson: tavernPayload,
      });
    }
    if (interruption.blocked || !matched || detail.hasDetail !== true) {
      return Core.sanitizeForTransport({
        success: false,
        source: "janny_extension_tab",
        characterId: id,
        characterUrl,
        status: null,
        finalUrl: location.href,
        contentType: document.contentType || "text/html",
        interruptionDetected: interruption.blocked === true,
        interruptionScore: interruption.score || 0,
        interruptionSignals: interruption.signals || [],
        matchedCharacterId: matched,
        hasDetail: detail.hasDetail === true,
        error: interruption.blocked
          ? "source_page_action_required"
          : !matched
            ? "character_payload_not_matched"
            : "janny_detail_not_ready",
        preview: html.slice(0, 600),
      });
    }
    return Core.sanitizeForTransport({
      success: false,
      source: "janny_extension_tab",
      characterId: id,
      characterUrl,
      finalUrl: location.href,
      error: "janny_detail_not_ready",
    });
  }
