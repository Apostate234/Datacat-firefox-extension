"use strict";

// sources/saucepan/page_adapter.js
// Page-world Saucepan (saucepan.ai) adapter. Built by a factory registered on
// globalThis.SourceVaultPageSources.register("saucepan", factory). ctx supplies CoreInPage,
// sanitize, sendStatus, and the shared adapter api (ctx.api). Behavior is
// identical to the pre-split page_bridge Saucepan code path; only the enclosing
// scope changed.

(function initSourceVaultSaucepanAdapter() {
  const ns = globalThis.SourceVaultPageSources;
  if (!ns || typeof ns.register !== "function") throw new Error("source_runtime_missing");

  ns.register("saucepan", function createSaucepanAdapter(ctx) {
    const CoreInPage = ctx.CoreInPage;
    const sanitize = ctx.sanitize;
    const sendStatus = ctx.sendStatus;
    const api = ctx.api;
    const fetchWithTimeoutAndRetry = api.fetchWithTimeoutAndRetry;
    const fetchJsonEnvelope = api.fetchJsonEnvelope;
    const fetchTextEnvelope = api.fetchTextEnvelope;
    const hasHydratedPageCharacter = api.hasHydratedPageCharacter;
    const sleep = api.sleep;
    const FETCH_TIMEOUT_MS = api.FETCH_TIMEOUT_MS;
    const { getSaucepanAuthToken, getSaucepanPreferredGenerationConfig, buildSaucepanApiUrl, fetchSaucepanUsersMe, fetchSaucepanCompanion, getSaucepanCompanionRecord, fetchSaucepanCompanionDefinition, fetchSaucepanCompanionLorebooks, fetchSaucepanHiddenCheck, fetchSaucepanChatsByCompanion, fetchSaucepanUserByHandle, fetchSaucepanUserPage, fetchSaucepanUserCompanionsV2, fetchSaucepanUserLorebooksV2, fetchSaucepanUserPosts, fetchSaucepanCompanionsOfUser, fetchSaucepanCustomPageDefault, fetchSaucepanCustomPageInfo, fetchSaucepanCustomPageRender } = globalThis.SourceVaultSaucepanClient({ fetchWithTimeoutAndRetry, fetchJsonEnvelope, FETCH_TIMEOUT_MS });
    const { normalizeSaucepanText, normalizeSaucepanMultilineText, dedupeSaucepanStrings, parseSaucepanCompactNumber, makeAbsoluteSaucepanUrl, buildSaucepanStableSourceId, sauceEscapeHtml, saucepanNodeTag, walkSaucepanRoux, collectSaucepanRouxText, saucepanRouxToHtml, findSaucepanRouxNode, collectSaucepanRouxNodes, parseSaucepanCompanionStats, parseSaucepanGenericMaterialStats, getSaucepanRouxClassName, pickSaucepanRouxCardRoot, parseSaucepanCompanionCardFromRoux, parseSaucepanMaterialCardFromRoux, extractSaucepanCardsFromRoux, extractSaucepanCompanionItems, mapSaucepanCompanionCard, getLikelySaucepanStructuredRenderItems, mapSaucepanMaterialCard, extractSaucepanStructuredRenderCards, attachSaucepanMaterialPageMeta, pickSaucepanPreferredText, chooseRicherSaucepanMaterial, mergeSaucepanMaterials, mergeSaucepanCompanionCard, mergeSaucepanCompanionCardCollections, parseSaucepanCreatorDomFromHtml, buildSaucepanProfileStatsLabels, buildSaucepanCreatorCounts, buildSaucepanSourceMaterials, getSaucepanUserRecordFromEnvelope } = globalThis.SourceVaultSaucepanParser({ CoreInPage, sanitize });
    const saucepanPageStateCache = new Map();

    function cleanSaucepanCompanionTitle(value) {
      const text = String(value || "")
        .replace(/\s*[-|]\s*Saucepan\s*$/i, "")
        .trim();
      if (!text) return null;
      if (
        CoreInPage &&
        typeof CoreInPage.isGenericSourceCharacterTitle === "function" &&
        CoreInPage.isGenericSourceCharacterTitle("saucepan", text)
      ) {
        return null;
      }
      return text.length > 180 ? text.slice(0, 180).trim() : text;
    }

    function readSaucepanCompanionFromDocument(companionId) {
      const titleCandidates = [
        ["document_h1", cleanSaucepanCompanionTitle(document.querySelector("h1")?.textContent)],
        ["document_title", cleanSaucepanCompanionTitle(document.title)],
        ["document_og_title", cleanSaucepanCompanionTitle(document.querySelector('meta[property="og:title"]')?.content)],
        ["document_twitter_title", cleanSaucepanCompanionTitle(document.querySelector('meta[name="twitter:title"]')?.content)],
      ];
      const titleCandidate = titleCandidates.find((candidate) => candidate[1]);
      const title = titleCandidate ? titleCandidate[1] : null;
      const avatarUrl =
        document.querySelector('meta[property="og:image"]')?.content ||
        document.querySelector('meta[name="twitter:image"]')?.content ||
        null;
      let creatorHandle = null;
      let creatorName = null;
      try {
        const creatorAnchor = Array.from(document.querySelectorAll('a[href*="/u/"]')).find((anchor) => {
          const text = String(anchor.textContent || "").trim();
          return text && text.length < 120;
        });
        if (creatorAnchor) {
          const parsed = CoreInPage.parseSaucepanCreatorUrl(creatorAnchor.href);
          creatorHandle = parsed.handle || null;
          creatorName = String(creatorAnchor.textContent || "").replace(/^@+/, "").trim() || creatorHandle;
        }
      } catch (_) {}
      return {
        id: companionId || (CoreInPage.parseSaucepanCompanionUrl(location.href).companionId || null),
        companionId: companionId || (CoreInPage.parseSaucepanCompanionUrl(location.href).companionId || null),
        name: title || null,
        creatorHandle,
        creatorName,
        avatarUrl,
        profileImageAssetUrl: avatarUrl,
        sourceKind: "saucepan",
        source: titleCandidate ? titleCandidate[0] : "document_fallback",
      };
    }

    function mergeSaucepanCompanionPageState(documentCompanion, companionApiCharacter) {
      const documentRoot = documentCompanion && typeof documentCompanion === "object" ? documentCompanion : {};
      const apiRoot = companionApiCharacter && typeof companionApiCharacter === "object" ? companionApiCharacter : {};
      return sanitize({
        ...documentRoot,
        ...apiRoot,
        id: apiRoot.id || documentRoot.id || null,
        companionId: apiRoot.companionId || documentRoot.companionId || apiRoot.id || documentRoot.id || null,
        name: apiRoot.name || documentRoot.name || null,
        creatorId: apiRoot.creatorId || documentRoot.creatorId || null,
        creatorHandle: apiRoot.creatorHandle || documentRoot.creatorHandle || null,
        creatorName: apiRoot.creatorName || documentRoot.creatorName || apiRoot.creatorHandle || documentRoot.creatorHandle || null,
        avatarUrl: apiRoot.avatarUrl || documentRoot.avatarUrl || null,
        profileImageAssetUrl:
          apiRoot.profileImageAssetUrl ||
          documentRoot.profileImageAssetUrl ||
          apiRoot.avatarUrl ||
          documentRoot.avatarUrl ||
          null,
        sourceKind: "saucepan",
        source: companionApiCharacter ? "companion_api" : documentRoot.source || "document_fallback",
      });
    }

    async function readSaucepanCompanionPageState(payload, documentCompanion) {
      const companionId =
        CoreInPage.normalizeUuid(payload && (payload.companionId || payload.characterId)) ||
        CoreInPage.normalizeUuid(documentCompanion && (documentCompanion.companionId || documentCompanion.id)) ||
        CoreInPage.parseSaucepanCompanionUrl(location.href).companionId;
      if (!companionId) return documentCompanion || null;
      if (
        documentCompanion &&
        documentCompanion.name &&
        documentCompanion.creatorHandle &&
        CoreInPage &&
        typeof CoreInPage.isSettledSourceCharacterState === "function" &&
        CoreInPage.isSettledSourceCharacterState("saucepan", documentCompanion, { isCharacterPage: true, sourceKind: "saucepan" })
      ) {
        return documentCompanion;
      }
      const cached = saucepanPageStateCache.get(companionId);
      if (cached && Date.now() - cached.at < 120000) {
        return mergeSaucepanCompanionPageState(documentCompanion, cached.character);
      }
      const token = getSaucepanAuthToken();
      if (!token) return documentCompanion || { id: companionId, companionId, name: null, sourceKind: "saucepan", source: "url" };
      try {
        const envelope = await fetchSaucepanCompanion(token, companionId);
        const record = getSaucepanCompanionRecord(envelope);
        if (envelope.response && envelope.response.ok && record && (record.id || record.display_name || record.name)) {
          const image = CoreInPage.normalizeSaucepanImageRef(record.image || record.avatar || null);
          const character = sanitize({
            id: record.id || companionId,
            companionId: record.id || companionId,
            name: record.display_name || record.name || null,
            creatorId: record.author_id || record.creator_id || null,
            creatorHandle: record.author_handle || record.creator_handle || null,
            creatorName: record.author_name || record.author_handle || null,
            avatarUrl: image ? image.highresUrl || image.cardUrl || image.thumbnailUrl : null,
            profileImageAssetUrl: image ? image.highresUrl || image.cardUrl || image.thumbnailUrl : null,
            isPublic: record.is_public ?? record.isPublic ?? null,
            accessLevel: record.access_level || record.accessLevel || null,
            visibility: record.visibility || null,
            openDefinition: record.open_definition ?? record.openDefinition ?? null,
            sourceKind: "saucepan",
            source: "companion_api",
          });
          const mergedCharacter = mergeSaucepanCompanionPageState(documentCompanion, character);
          saucepanPageStateCache.set(companionId, { at: Date.now(), character: mergedCharacter });
          return mergedCharacter;
        }
      } catch (_) {}
      return documentCompanion || { id: companionId, companionId, name: null, sourceKind: "saucepan", source: "url" };
    }

    function normalizeSaucepanCompanionSummary(record, companionId, source) {
      const root = record && typeof record === "object" ? record : {};
      const id = CoreInPage.normalizeUuid(root.id || root.companion_id || companionId);
      const image = CoreInPage.normalizeSaucepanImageRef(root.image || root.avatar || null);
      return sanitize({
        id,
        companionId: id,
        name: root.display_name || root.name || null,
        displayName: root.display_name || root.name || null,
        creatorId: root.author_id || root.creator_id || null,
        creatorHandle: root.author_handle || root.creator_handle || null,
        creatorName: root.author_name || root.author_handle || null,
        sourcePostedAt: root.source_posted_at || root.sourcePostedAt || root.posted_at || root.postedAt || root.first_published_at || root.firstPublishedAt || root.published_at || root.publishedAt || null,
        updatedAt: root.updated_at || root.updatedAt || null,
        pageUrl: id ? `https://saucepan.ai/companion/${id}` : null,
        accessLevel: root.access_level || null,
        openDefinition: root.open_definition ?? null,
        lockedStartingMessage: root.locked_starting_message ?? null,
        providersProfile: root.providers_profile ?? null,
        providerAccess: root.providers_profile ?? null,
        definitionProtection: root.definition_protection ?? null,
        image,
        profileImageAssetUrl: image ? image.highresUrl || image.cardUrl || image.thumbnailUrl : null,
        portraits: Array.isArray(root.portraits) ? root.portraits : [],
        fullDescription: root.full_description || root.fullDescription || null,
        shortDescription: root.short_description || root.shortDescription || null,
        firstMessageText: root.first_message_text || null,
        startingScenarios: root.starting_scenarios || root.startingScenarios || [],
        stats: {
          chatCount: root.chat_count ?? null,
          interactionCount: root.interaction_count ?? null,
          favoriteCount: root.favorite_count ?? null,
          scenarioCount: root.scenario_count ?? null,
          lorebookCount: root.lorebook_count ?? null,
        },
        tokenCounts: {
          cardTokenCount: root.card_token_count ?? null,
          exampleDialogueTokenCount: root.example_dialogue_token_count ?? null,
          advancedPromptTokenCount: root.advanced_prompt_token_count ?? null,
          formattingInstructionsTokenCount: root.formatting_instructions_token_count ?? null,
        },
        tags: Array.isArray(root.tags) ? root.tags : [],
        fandomTags: Array.isArray(root.fandom_tags) ? root.fandom_tags : [],
        source,
        rawCompanion: root,
      });
    }

    function getSaucepanDefinitionState(companionRecord) {
      if (!companionRecord || typeof companionRecord !== "object") return "unknown";
      if (companionRecord.open_definition === true) return "open";
      if (companionRecord.open_definition === false) return "closed";
      return "unknown";
    }

    async function startSaucepanCoreRetrieval(payload, retrievalId) {
      const parsed = CoreInPage.parseSaucepanCompanionUrl((payload && payload.url) || location.href);
      const companionId = CoreInPage.normalizeUuid(payload && (payload.companionId || payload.characterId)) || parsed.companionId;
      if (!companionId) throw new Error("missing_saucepan_companion_id");
      sendStatus(retrievalId, "saucepan_auth", "Checking Saucepan login.");
      const token = getSaucepanAuthToken();
      if (!token) throw new Error("no_saucepan_token");
      const usersMe = await fetchSaucepanUsersMe(token);
      const rawUserJson = usersMe.response && usersMe.response.json ? usersMe.response.json : null;
      const userJson = rawUserJson && rawUserJson.data && typeof rawUserJson.data === "object" ? rawUserJson.data : rawUserJson;
      if (!usersMe.response || !usersMe.response.ok || !userJson || !userJson.id) {
        throw new Error(`saucepan_users_me_http_${usersMe.response ? usersMe.response.status : "unknown"}`);
      }

      sendStatus(retrievalId, "saucepan_companion", "Reading Saucepan companion API payload.", { companionId });
      const companionEnvelope = await fetchSaucepanCompanion(token, companionId);
      const companionRecord = getSaucepanCompanionRecord(companionEnvelope);
      if (!companionEnvelope.response || !companionEnvelope.response.ok || !companionRecord || !companionRecord.id) {
        return sanitize({
          success: false,
          source: "saucepan_core_extension",
          capturedAt: new Date().toISOString(),
          companionId,
          pageUrl: parsed.normalizedUrl || `https://saucepan.ai/companion/${companionId}`,
          companionApiStatus: companionEnvelope.response ? companionEnvelope.response.status : null,
          companionApiOk: false,
          error: `saucepan_companion_http_${companionEnvelope.response ? companionEnvelope.response.status : "unknown"}`,
          reads: { usersMe, companion: companionEnvelope },
        });
      }

      const definitionState = getSaucepanDefinitionState(companionRecord);
      let definitionEnvelope = null;
      if (definitionState === "open") {
        sendStatus(retrievalId, "saucepan_definition", "Reading open Saucepan definition API payload.", { companionId });
        definitionEnvelope = await fetchSaucepanCompanionDefinition(token, companionId);
      } else {
        definitionEnvelope = {
          skipped: true,
          reason: "open_definition_false",
          definition_state: definitionState,
        };
      }

      sendStatus(retrievalId, "saucepan_metadata", "Reading Saucepan hidden/check and chat metadata.", { companionId });
      const hiddenCheckEnvelope = await fetchSaucepanHiddenCheck(token, companionId).catch((error) => ({
        error: String(error && error.message ? error.message : error),
      }));
      const lorebooksEnvelope = await fetchSaucepanCompanionLorebooks(token, companionId).catch((error) => ({
        error: String(error && error.message ? error.message : error),
      }));
      const chatsByCompanionEnvelope = await fetchSaucepanChatsByCompanion(token, companionId).catch((error) => ({
        error: String(error && error.message ? error.message : error),
      }));
      const rawOpenDefinitionApi =
        definitionEnvelope && definitionEnvelope.response && definitionEnvelope.response.ok
          ? definitionEnvelope.response.json
          : null;
      const openDefinitionApi = CoreInPage.normalizeSaucepanOpenDefinitionPayload(rawOpenDefinitionApi) || rawOpenDefinitionApi;
      sendStatus(retrievalId, "saucepan_core_done", "Saucepan core capture finished.", {
        companionId,
        definitionState,
        companionStatus: companionEnvelope.response && companionEnvelope.response.status,
        definitionStatus: definitionEnvelope && definitionEnvelope.response && definitionEnvelope.response.status,
        lorebookStatus: lorebooksEnvelope.response && lorebooksEnvelope.response.status,
      });
      return sanitize({
        success: true,
        source: "saucepan_core_extension",
        capturedAt: new Date().toISOString(),
        companionId,
        pageUrl: parsed.normalizedUrl || `https://saucepan.ai/companion/${companionId}`,
        auth: {
          user: {
            id: userJson.id || null,
            handle: userJson.handle || null,
            displayName: userJson.display_name || userJson.name || null,
          },
          status: usersMe.response.status,
        },
        companionApiStatus: companionEnvelope.response.status,
        companionApiOk: companionEnvelope.response.ok === true,
        definitionApiStatus: definitionEnvelope && definitionEnvelope.response ? definitionEnvelope.response.status : null,
        definitionApiOk: definitionEnvelope && definitionEnvelope.response ? definitionEnvelope.response.ok === true : null,
        hiddenCheckStatus: hiddenCheckEnvelope.response ? hiddenCheckEnvelope.response.status : null,
        lorebooksStatus: lorebooksEnvelope.response ? lorebooksEnvelope.response.status : null,
        chatsByCompanionStatus: chatsByCompanionEnvelope.response ? chatsByCompanionEnvelope.response.status : null,
        definitionState,
        companion: normalizeSaucepanCompanionSummary(companionRecord, companionId, "companion_api"),
        definition: {
          selectedDefinition: openDefinitionApi,
          openDefinitionApi,
          hiddenDefinitionFallback: null,
        },
        hiddenCheck: hiddenCheckEnvelope.response ? hiddenCheckEnvelope.response.json : hiddenCheckEnvelope,
        lorebooks: lorebooksEnvelope.response ? lorebooksEnvelope.response.json : lorebooksEnvelope,
        chatsByCompanion: chatsByCompanionEnvelope.response ? chatsByCompanionEnvelope.response.json : chatsByCompanionEnvelope,
        reads: {
          usersMe,
          companion: companionEnvelope,
          companionDefinition: definitionEnvelope,
          hiddenCheck: hiddenCheckEnvelope,
          lorebooks: lorebooksEnvelope,
          chatsByCompanion: chatsByCompanionEnvelope,
          preferredGenerationConfig: getSaucepanPreferredGenerationConfig(),
        },
      });
    }

    async function retrieveSaucepanCreatorProfile(payload, retrievalId) {
      const parsed = CoreInPage.parseSaucepanCreatorUrl((payload && (payload.creatorHandle || payload.handle || payload.url)) || "");
      const creatorHandle = parsed.handle || String((payload && (payload.creatorHandle || payload.handle)) || "").replace(/^@+/, "").trim();
      if (!creatorHandle) throw new Error("missing_saucepan_creator_handle");
      sendStatus(retrievalId, "saucepan_creator_auth", "Checking Saucepan login for creator capture.");
      const token = getSaucepanAuthToken();
      if (!token) throw new Error("no_saucepan_token");

      sendStatus(retrievalId, "saucepan_creator", "Reading Saucepan creator user payload.", { creatorHandle });
      const userPageEnvelope = await fetchSaucepanUserPage(token, creatorHandle).catch((error) => ({
        error: String(error && error.message ? error.message : error),
      }));
      const userPageRecord = getSaucepanUserRecordFromEnvelope(userPageEnvelope);
      const userEnvelope = userPageRecord
        ? userPageEnvelope
        : await fetchSaucepanUserByHandle(token, creatorHandle);
      const userJson = userEnvelope.response && userEnvelope.response.json ? userEnvelope.response.json : null;
      const userRecord = getSaucepanUserRecordFromEnvelope(userEnvelope);
      if (!userEnvelope.response || !userEnvelope.response.ok || !userRecord || !userRecord.id) {
        return sanitize({
          success: false,
          source: "saucepan_creator_extension",
          capturedAt: new Date().toISOString(),
          creatorHandle,
          profileUrl: `https://saucepan.ai/u/${encodeURIComponent(creatorHandle)}`,
          status: userEnvelope.response ? userEnvelope.response.status : null,
          error: `saucepan_creator_user_http_${userEnvelope.response ? userEnvelope.response.status : "unknown"}`,
          reads: { user: userEnvelope, userPage: userPageEnvelope },
        });
      }

      const creatorUrl = `https://saucepan.ai/u/${encodeURIComponent(creatorHandle)}`;
      const companionsEnvelope = await fetchSaucepanUserCompanionsV2(token, creatorHandle).catch((error) => ({
        error: String(error && error.message ? error.message : error),
      }));
      const v2CompanionCards = attachSaucepanMaterialPageMeta(
        extractSaucepanCompanionItems(companionsEnvelope.response && companionsEnvelope.response.json)
          .map(mapSaucepanCompanionCard)
          .filter(Boolean),
        { sourcePage: 1, sourcePageSize: 50 },
      );
      const legacyCompanionsEnvelope = v2CompanionCards.length
        ? { skipped: true, reason: "user_companions_v2_available" }
        : await fetchSaucepanCompanionsOfUser(token, creatorHandle).catch((error) => ({
            error: String(error && error.message ? error.message : error),
          }));
      const legacyCompanionCards = extractSaucepanCompanionItems(legacyCompanionsEnvelope.response && legacyCompanionsEnvelope.response.json)
        .map(mapSaucepanCompanionCard)
        .filter(Boolean);
      const apiCompanionCards = mergeSaucepanCompanionCardCollections(v2CompanionCards, legacyCompanionCards);
      const userLorebooksEnvelope = await fetchSaucepanUserLorebooksV2(token, creatorHandle).catch((error) => ({
        error: String(error && error.message ? error.message : error),
      }));
      const apiLorebookCards = attachSaucepanMaterialPageMeta(
        extractSaucepanStructuredRenderCards(userLorebooksEnvelope.response && userLorebooksEnvelope.response.json, "lorebook"),
        { sourcePage: 1, sourcePageSize: 50 },
      );
      const postsEnvelope = await fetchSaucepanUserPosts(token, creatorHandle, 10, 0).catch((error) => ({
        error: String(error && error.message ? error.message : error),
      }));
      const apiPostCards = attachSaucepanMaterialPageMeta(
        extractSaucepanStructuredRenderCards(postsEnvelope.response && postsEnvelope.response.json, "post"),
        { sourcePage: 1, sourcePageSize: 10 },
      );
      const defaultEnvelope = await fetchSaucepanCustomPageDefault(token, userRecord.id).catch((error) => ({ error: String(error && error.message ? error.message : error) }));
      const defaultPage = defaultEnvelope.response && defaultEnvelope.response.json && defaultEnvelope.response.json.page
        ? defaultEnvelope.response.json.page
        : null;
      const pageName = String(defaultPage && defaultPage.name ? defaultPage.name : "").trim();
      const pageType = "home";
      const infoEnvelope = pageName
        ? await fetchSaucepanCustomPageInfo(token, creatorHandle, pageName, pageType).catch((error) => ({ error: String(error && error.message ? error.message : error) }))
        : { skipped: true, reason: "no_custom_page_name" };
      const infoPage = infoEnvelope.response && infoEnvelope.response.json && infoEnvelope.response.json.page
        ? infoEnvelope.response.json.page
        : null;
      const initialOptions = infoPage && infoPage.initial_options && typeof infoPage.initial_options === "object"
        ? infoPage.initial_options
        : infoPage && infoPage.page_options && typeof infoPage.page_options === "object"
          ? infoPage.page_options
          : {};
      const renderParams = {
        handle: creatorHandle,
        nsfw: "true",
        theme: "light",
        page_name: pageName,
        page_type: pageType,
        current_companion_page_number: 1,
        companion_sort_by: initialOptions.companion_sort_by || "posted_at",
        companion_page_size: 50,
        current_post_page_number: 1,
        post_sort_by: initialOptions.post_sort_by || "posted_at",
        post_page_size: initialOptions.post_page_size || 10,
        current_lorebook_page_number: 1,
        lorebook_sort_by: initialOptions.lorebook_sort_by || "posted_at",
        lorebook_page_size: initialOptions.lorebook_page_size || 10,
        current_collection_page_number: 1,
        collection_sort_by: initialOptions.collection_sort_by || "posted_at",
        collection_page_size: initialOptions.collection_page_size || 10,
      };
      const renderEnvelope = pageName
        ? await fetchSaucepanCustomPageRender(token, renderParams).catch((error) => ({ error: String(error && error.message ? error.message : error) }))
        : { skipped: true, reason: "no_custom_page_name" };
      const renderJson = renderEnvelope.response && renderEnvelope.response.json ? renderEnvelope.response.json : {};
      const rouxRoot = renderJson && renderJson.roux_html ? renderJson.roux_html : null;
      const liveCreatorPage = CoreInPage.parseSaucepanCreatorUrl(location.href || "");
      const liveProfilePageHtml =
        liveCreatorPage && liveCreatorPage.valid && String(liveCreatorPage.handle || "").toLowerCase() === String(creatorHandle || "").toLowerCase()
          ? document.documentElement && document.documentElement.outerHTML
            ? document.documentElement.outerHTML
            : ""
          : "";
      const profilePageEnvelope = liveProfilePageHtml
        ? { skipped: true, reason: "using_live_creator_dom" }
        : await fetchTextEnvelope("creator_profile_page", creatorUrl, token, null, {
            timeoutMs: 30000,
            backoffMs: [1000],
          }).catch((error) => ({ error: String(error && error.message ? error.message : error) }));
      const rawProfilePageHtml = liveProfilePageHtml || (
        profilePageEnvelope.response && typeof profilePageEnvelope.response.text === "string"
          ? profilePageEnvelope.response.text
          : ""
      );
      const domProfile = parseSaucepanCreatorDomFromHtml(rawProfilePageHtml);
      const domMaterials = domProfile && domProfile.dom_materials && typeof domProfile.dom_materials === "object"
        ? domProfile.dom_materials
        : {};

      let companionCards = mergeSaucepanCompanionCardCollections(
        attachSaucepanMaterialPageMeta(extractSaucepanStructuredRenderCards(renderJson, "companion"), {
          sourcePage: 1,
          sourcePageSize: renderParams.companion_page_size,
        }),
        attachSaucepanMaterialPageMeta(extractSaucepanCardsFromRoux(rouxRoot, "companion"), {
          sourcePage: 1,
          sourcePageSize: renderParams.companion_page_size,
        }),
        attachSaucepanMaterialPageMeta(Array.isArray(domMaterials.companions) ? domMaterials.companions : [], {
          sourcePage: 1,
          sourcePageSize: renderParams.companion_page_size,
        }),
        attachSaucepanMaterialPageMeta(apiCompanionCards, {
          sourcePage: 1,
          sourcePageSize: renderParams.companion_page_size,
        }),
      );
      const materialKey = (card) => String((card && (card.id || card.url)) || "").trim();
      let postCards = mergeSaucepanMaterials(
        apiPostCards,
        mergeSaucepanMaterials(
          attachSaucepanMaterialPageMeta(extractSaucepanStructuredRenderCards(renderJson, "post"), {
            sourcePage: 1,
            sourcePageSize: Number(renderParams.post_page_size) || null,
          }),
          mergeSaucepanMaterials(
            attachSaucepanMaterialPageMeta(Array.isArray(domMaterials.posts) ? domMaterials.posts : [], {
              sourcePage: 1,
              sourcePageSize: Number(renderParams.post_page_size) || null,
            }),
            attachSaucepanMaterialPageMeta(extractSaucepanCardsFromRoux(rouxRoot, "post"), {
              sourcePage: 1,
              sourcePageSize: Number(renderParams.post_page_size) || null,
            }),
            materialKey,
          ),
          materialKey,
        ),
        materialKey,
      );
      let lorebookCards = mergeSaucepanMaterials(
        apiLorebookCards,
        mergeSaucepanMaterials(
          attachSaucepanMaterialPageMeta(extractSaucepanStructuredRenderCards(renderJson, "lorebook"), {
            sourcePage: 1,
            sourcePageSize: Number(renderParams.lorebook_page_size) || null,
          }),
          mergeSaucepanMaterials(
            attachSaucepanMaterialPageMeta(Array.isArray(domMaterials.lorebooks) ? domMaterials.lorebooks : [], {
              sourcePage: 1,
              sourcePageSize: Number(renderParams.lorebook_page_size) || null,
            }),
            attachSaucepanMaterialPageMeta(extractSaucepanCardsFromRoux(rouxRoot, "lorebook"), {
              sourcePage: 1,
              sourcePageSize: Number(renderParams.lorebook_page_size) || null,
            }),
            materialKey,
          ),
          materialKey,
        ),
        materialKey,
      );
      let collectionCards = mergeSaucepanMaterials(
        attachSaucepanMaterialPageMeta(extractSaucepanStructuredRenderCards(renderJson, "collection"), {
          sourcePage: 1,
          sourcePageSize: Number(renderParams.collection_page_size) || null,
        }),
        mergeSaucepanMaterials(
          attachSaucepanMaterialPageMeta(Array.isArray(domMaterials.collections) ? domMaterials.collections : [], {
            sourcePage: 1,
            sourcePageSize: Number(renderParams.collection_page_size) || null,
          }),
          attachSaucepanMaterialPageMeta(extractSaucepanCardsFromRoux(rouxRoot, "collection"), {
            sourcePage: 1,
            sourcePageSize: Number(renderParams.collection_page_size) || null,
          }),
          (card) => String((card && (card.id || card.url)) || "").trim(),
        ),
        (card) => String((card && (card.id || card.url)) || "").trim(),
      );

      const countsSeed = buildSaucepanCreatorCounts({
        followerCount: userJson && userJson.follower_count,
        domProfile,
        companionCards,
        postCards,
        lorebookCards,
        collectionCards,
      });
      const maxCompanionPages = 10;
      const targetCompanionCount = Number.isFinite(Number(countsSeed.companions)) ? Number(countsSeed.companions) : null;
      const totalCompanionPages = targetCompanionCount
        ? Math.max(1, Math.ceil(targetCompanionCount / Number(renderParams.companion_page_size || 50)))
        : 1;
      let pagesFetched = 1;
      for (let pageNum = 2; pageNum <= Math.min(maxCompanionPages, totalCompanionPages); pageNum += 1) {
        sendStatus(retrievalId, "saucepan_creator_page", "Reading Saucepan creator companion page.", { page: pageNum });
        const pageEnvelope = await fetchSaucepanCustomPageRender(token, {
          ...renderParams,
          current_companion_page_number: pageNum,
        }).catch((error) => ({ error: String(error && error.message ? error.message : error) }));
        const pageJson = pageEnvelope.response && pageEnvelope.response.json ? pageEnvelope.response.json : {};
        pagesFetched = Math.max(pagesFetched, pageNum);
        const pageCards = mergeSaucepanCompanionCardCollections(
          attachSaucepanMaterialPageMeta(extractSaucepanStructuredRenderCards(pageJson, "companion"), {
            sourcePage: pageNum,
            sourcePageSize: renderParams.companion_page_size,
          }),
          attachSaucepanMaterialPageMeta(extractSaucepanCardsFromRoux(pageJson && pageJson.roux_html, "companion"), {
            sourcePage: pageNum,
            sourcePageSize: renderParams.companion_page_size,
          }),
        );
        companionCards = mergeSaucepanCompanionCardCollections(companionCards, pageCards);
        if (pageCards.length < Number(renderParams.companion_page_size || 50)) break;
      }

      const paginateGenericMaterials = async ({ kind, pageParam, pageSize, targetCount, cards, keyBuilder }) => {
        const effectivePageSize = Math.max(1, Number(pageSize) || 10);
        const desiredTotal = Number.isFinite(Number(targetCount)) ? Number(targetCount) : null;
        if (!desiredTotal || desiredTotal <= (Array.isArray(cards) ? cards.length : 0)) {
          return Array.isArray(cards) ? cards : [];
        }
        let mergedCards = Array.isArray(cards) ? cards.slice() : [];
        const totalPages = Math.max(1, Math.ceil(desiredTotal / effectivePageSize));
        for (let pageNum = 2; pageNum <= Math.min(totalPages, 10); pageNum += 1) {
          sendStatus(retrievalId, "saucepan_creator_page", "Reading Saucepan creator material page.", { material: kind, page: pageNum });
          const pageEnvelope = await fetchSaucepanCustomPageRender(token, {
            ...renderParams,
            [pageParam]: pageNum,
          }).catch((error) => ({ error: String(error && error.message ? error.message : error) }));
          const pageJson = pageEnvelope.response && pageEnvelope.response.json ? pageEnvelope.response.json : {};
          pagesFetched = Math.max(pagesFetched, pageNum);
          const pageCards = mergeSaucepanMaterials(
            attachSaucepanMaterialPageMeta(extractSaucepanStructuredRenderCards(pageJson, kind), {
              sourcePage: pageNum,
              sourcePageSize: effectivePageSize,
            }),
            attachSaucepanMaterialPageMeta(extractSaucepanCardsFromRoux(pageJson && pageJson.roux_html, kind), {
              sourcePage: pageNum,
              sourcePageSize: effectivePageSize,
            }),
            keyBuilder,
          );
          mergedCards = mergeSaucepanMaterials(pageCards, mergedCards, keyBuilder);
          if (pageCards.length < effectivePageSize) break;
        }
        return mergedCards;
      };
      postCards = await paginateGenericMaterials({
        kind: "post",
        pageParam: "current_post_page_number",
        pageSize: renderParams.post_page_size,
        targetCount: countsSeed.posts,
        cards: postCards,
        keyBuilder: (card) => String((card && (card.id || card.url)) || "").trim(),
      });
      lorebookCards = await paginateGenericMaterials({
        kind: "lorebook",
        pageParam: "current_lorebook_page_number",
        pageSize: renderParams.lorebook_page_size,
        targetCount: countsSeed.lorebooks,
        cards: lorebookCards,
        keyBuilder: (card) => String((card && (card.id || card.url)) || "").trim(),
      });
      collectionCards = await paginateGenericMaterials({
        kind: "collection",
        pageParam: "current_collection_page_number",
        pageSize: renderParams.collection_page_size,
        targetCount: countsSeed.collections,
        cards: collectionCards,
        keyBuilder: (card) => String((card && (card.id || card.url)) || "").trim(),
      });

      const avatar = CoreInPage.normalizeSaucepanImageRef(userRecord.avatar || null);
      const handleLabel = `@${String(userRecord.handle || creatorHandle || "").trim()}`;
      const avatarName = normalizeSaucepanText(domProfile && domProfile.avatar_name || "");
      const displayName =
        normalizeSaucepanText(userRecord.display_name || userRecord.name || avatarName || "") ||
        normalizeSaucepanText(userRecord.handle || creatorHandle) ||
        null;
      const headingTexts = Array.isArray(domProfile && domProfile.heading_texts) ? domProfile.heading_texts : [];
      const isGenericProfileHeading = (value) => /^(posts?|lorebooks?|collections?|companions?|broadcasts?|view posts)$/i.test(normalizeSaucepanText(value));
      const profileTitle = headingTexts.find((text) => {
        const normalized = normalizeSaucepanText(text);
        if (!normalized) return false;
        if (displayName && normalized.toLowerCase() === displayName.toLowerCase()) return false;
        if (normalized.toLowerCase() === handleLabel.toLowerCase()) return false;
        if (isGenericProfileHeading(normalized)) return false;
        return true;
      }) || null;
      const profileSubtitle = headingTexts.find((text) => {
        const normalized = normalizeSaucepanText(text);
        if (!normalized || !profileTitle) return false;
        if (normalized.toLowerCase() === profileTitle.toLowerCase()) return false;
        if (displayName && normalized.toLowerCase() === displayName.toLowerCase()) return false;
        if (normalized.toLowerCase() === handleLabel.toLowerCase()) return false;
        if (isGenericProfileHeading(normalized)) return false;
        return true;
      }) || null;
      const counts = buildSaucepanCreatorCounts({
        followerCount: userJson && userJson.follower_count,
        domProfile,
        companionCards,
        postCards,
        lorebookCards,
        collectionCards,
      });
      const sourceSections = {
        companions: { count: companionCards.length, items: companionCards.slice(0, 100) },
        posts: { count: postCards.length, items: postCards.slice(0, 100) },
        lorebooks: { count: lorebookCards.length, items: lorebookCards.slice(0, 100) },
        collections: { count: collectionCards.length, items: collectionCards.slice(0, 100) },
        dom_section_counts: domProfile && domProfile.section_counts ? domProfile.section_counts : {},
      };
      const sourceMaterials = buildSaucepanSourceMaterials(sourceSections);
      const profileHtml = (domProfile && domProfile.profile_html) || saucepanRouxToHtml(rouxRoot) || null;
      sendStatus(retrievalId, "saucepan_creator_done", "Saucepan creator capture finished.", {
        creatorHandle,
        creatorId: userRecord.id,
        companions: companionCards.length,
        posts: postCards.length,
        lorebooks: lorebookCards.length,
        collections: collectionCards.length,
      });
      return sanitize({
        success: true,
        source: "saucepan_creator_extension",
        capturedAt: new Date().toISOString(),
        creatorId: userRecord.id || null,
        creatorHandle: userRecord.handle || creatorHandle,
        profileUrl: creatorUrl,
        profile: {
          creatorId: userRecord.id || null,
          creatorHandle: userRecord.handle || creatorHandle,
          displayName: displayName || userRecord.handle || creatorHandle,
          profileUrl: creatorUrl,
          profileTitle,
          profileSubtitle,
          followerCount: counts.followers,
          veryNsfw: userRecord.very_nsfw ?? null,
          avatar,
          profileImageAssetUrl: avatar ? avatar.highresUrl || avatar.cardUrl || avatar.thumbnailUrl : null,
          description: userRecord.description || null,
          bioText: (domProfile && domProfile.bio_text) || userRecord.description || null,
          profileHtml,
          profileCss: domProfile && domProfile.profile_css ? domProfile.profile_css : null,
          profileRouxJson: rouxRoot || {},
          profileStatsLabels: buildSaucepanProfileStatsLabels(userJson, domProfile),
          counts,
          rawProfilePageHtml,
          rawProfile: userJson || {},
        },
        companions: companionCards,
        sourceSections,
        sourceMaterials,
        pagesFetched,
        raw: {
          raw_profile: userJson || {},
          raw_user_page: userPageEnvelope.response ? userPageEnvelope.response.json : {},
          raw_companions_of_user: legacyCompanionsEnvelope.response ? legacyCompanionsEnvelope.response.json : {},
          raw_user_companions_v2: companionsEnvelope.response ? companionsEnvelope.response.json : {},
          raw_user_lorebooks_v2: userLorebooksEnvelope.response ? userLorebooksEnvelope.response.json : {},
          raw_user_posts: postsEnvelope.response ? postsEnvelope.response.json : {},
          raw_custom_page_default: defaultEnvelope.response ? defaultEnvelope.response.json : {},
          raw_custom_page_info: infoEnvelope.response ? infoEnvelope.response.json : {},
          raw_custom_page_render: renderJson || {},
          raw_profile_page_html: rawProfilePageHtml || null,
        },
        reads: {
          user: userEnvelope,
          userPage: userPageEnvelope,
          companionsOfUser: legacyCompanionsEnvelope,
          userCompanionsV2: companionsEnvelope,
          userLorebooksV2: userLorebooksEnvelope,
          userPosts: postsEnvelope,
          customPageDefault: defaultEnvelope,
          customPageInfo: infoEnvelope,
          customPageRender: renderEnvelope,
          profilePage: profilePageEnvelope,
        },
      });
    }

    async function detectLocalAuth() {
      const token = getSaucepanAuthToken();
      return {
        loggedIn: !!token,
        tokenPresent: !!token,
        user: null,
        status: null,
        error: token ? null : "no_saucepan_token",
        source: "saucepan_local_session",
      };
    }

    async function detectAuth() {
        const token = getSaucepanAuthToken();
        if (!token) {
          return { loggedIn: false, tokenPresent: false, user: null, status: null, error: "no_saucepan_token" };
        }
        const envelope = await fetchSaucepanUsersMe(token);
        const rawData = envelope && envelope.response ? envelope.response.json : null;
        const data = rawData && rawData.data && typeof rawData.data === "object" ? rawData.data : rawData;
        const loggedIn = !!(envelope && envelope.response && envelope.response.ok && data && data.id);
        return {
          loggedIn,
          tokenPresent: true,
          status: envelope && envelope.response ? envelope.response.status : null,
          user: loggedIn
            ? {
                id: data.id || null,
                name: data.display_name || data.name || null,
                userName: data.handle || data.username || null,
                handle: data.handle || null,
              }
            : null,
          error: loggedIn ? null : `saucepan_users_me_http_${envelope && envelope.response ? envelope.response.status : "unknown"}`,
          source: "saucepan_users_me",
        };
    }

    async function readPageState(payload) {
        const shouldWait = !!(payload && payload.waitForHydration);
        const startedAt = Date.now();
        let latest = null;
        do {
          const documentCompanion = readSaucepanCompanionFromDocument(payload && (payload.companionId || payload.characterId));
          latest = { sourceKind: "saucepan", character: await readSaucepanCompanionPageState(payload, documentCompanion) };
          if (hasHydratedPageCharacter(latest) || !shouldWait) return { character: latest.character };
          await sleep(350);
        } while (Date.now() - startedAt < 5000);
        return { character: latest && latest.character ? latest.character : null };
    }

    return {
      detectAuth,
      detectLocalAuth,
      readPageState,
      retrieveCore: startSaucepanCoreRetrieval,
      retrieveCreatorProfile: retrieveSaucepanCreatorProfile,
    };
  });
})();
