"use strict";

// sources/janitor/page_adapter.js
// Page-world Janitor (janitorai.com) adapter. Built by a factory registered on
// globalThis.SourceVaultPageSources.register("janitor", factory). ctx supplies CoreInPage,
// sanitize, sendStatus, and the shared adapter api (ctx.api). Behavior is
// identical to the pre-split page_bridge Janitor code path; only the enclosing
// scope changed.

(function initSourceVaultJanitorAdapter() {
  const ns = globalThis.SourceVaultPageSources;
  if (!ns || typeof ns.register !== "function") throw new Error("source_runtime_missing");

  ns.register("janitor", function createJanitorAdapter(ctx) {
    const CoreInPage = ctx.CoreInPage;
    const sanitize = ctx.sanitize;
    const sendStatus = ctx.sendStatus;
    const api = ctx.api;
    const fetchWithTimeoutAndRetry = api.fetchWithTimeoutAndRetry;
    const hasHydratedPageCharacter = api.hasHydratedPageCharacter;
    const sleep = api.sleep;
    const FETCH_TIMEOUT_MS = api.FETCH_TIMEOUT_MS;
    const APP_VERSION = "7.5.7";
    const PERSONA_APPEARANCE = "Saved page capture persona";
    const janitorPageStateCache = new Map();
    const { compactMeta, getAuthToken, readLocalUserHint, parseJsonParseArgument, readStoreState, readCharacterEnvelope, cleanDocumentCharacterTitle, readVisibleCharacterTitleFromBody, documentContainsCharacterId, readCharacterFromDocument, mergeJanitorPageStateCharacter, firstPresent, normalizeJanitorScriptMetadata, extractScriptMetadataFromCharacterPayload, normalizeFirstMessages, summarizeJanitorApiCharacterPayload, extractScriptMetadataFromDocumentLinks, mergeScriptMetadataLists, buildCreatorCharactersApiUrl, slugifyJanitorCharacterText, buildJanitorCharacterSourceUrl, compactCreatorApiCharacter, extractFirstBotMessage, buildChatPayload } = globalThis.SourceVaultJanitorHelpers({ CoreInPage, sanitize, PERSONA_APPEARANCE });

    async function readJanitorCharacterApiPageState(characterId) {
      const id = CoreInPage.normalizeUuid(characterId);
      if (!id) return null;
      const cached = janitorPageStateCache.get(id);
      if (cached && Date.now() - cached.at < 120000) return cached.character;
      const token = getAuthToken();
      if (!token) return null;
      try {
        const detail = await fetchJanitorCharacterDetail(token, id);
        const summary = detail && detail.data
          ? summarizeJanitorApiCharacterPayload(detail.data, "character_api_page_state")
          : null;
        if (detail && detail.ok && summary && summary.found) {
          const character = sanitize({
            id: summary.id || id,
            characterId: summary.id || id,
            name: summary.name || null,
            creatorId: summary.creatorId || null,
            creatorName: summary.creatorName || null,
            avatarUrl: summary.avatarUrl || null,
            profileImageAssetUrl: summary.profileImageAssetUrl || summary.avatarUrl || null,
            isPublic: summary.rawCharacter ? summary.rawCharacter.is_public ?? summary.rawCharacter.isPublic ?? null : null,
            accessLevel: summary.rawCharacter ? summary.rawCharacter.access_level || summary.rawCharacter.accessLevel || null : null,
            visibility: summary.rawCharacter ? summary.rawCharacter.visibility || null : null,
            openDefinition: summary.rawCharacter ? summary.rawCharacter.open_definition ?? summary.rawCharacter.openDefinition ?? null : null,
            sourceKind: "janitor",
            source: "character_api_page_state",
          });
          janitorPageStateCache.set(id, { at: Date.now(), character });
          return character;
        }
      } catch (_) {}
      janitorPageStateCache.set(id, { at: Date.now(), character: null });
      return null;
    }

    async function readJanitorPageStateOnce(payload) {
      const targetCharacterId = CoreInPage.normalizeUuid(payload && payload.characterId);
      const characterEnvelope = readCharacterEnvelope(payload && payload.characterId);
      const summary = characterEnvelope.envelope
        ? CoreInPage.summarizeJanitorCharacterStore(characterEnvelope.envelope)
        : null;
      const summaryCharacterId = CoreInPage.normalizeUuid(summary && summary.id);
      const summaryMatchesTarget = !targetCharacterId || (summaryCharacterId && summaryCharacterId === targetCharacterId);
      if (summary && summary.found && summaryMatchesTarget) {
        const storeCharacter = {
          id: summary.id || (payload && payload.characterId) || null,
          characterId: summary.id || (payload && payload.characterId) || null,
          name: summary.name || null,
          creatorId: summary.creatorId || null,
          creatorName: summary.creatorName || null,
          avatarUrl: summary.avatarUrl || null,
          profileImageAssetUrl: summary.profileImageAssetUrl || summary.avatarUrl || null,
          isPublic: summary.rawCharacter ? summary.rawCharacter.is_public ?? summary.rawCharacter.isPublic ?? null : null,
          accessLevel: summary.rawCharacter ? summary.rawCharacter.access_level || summary.rawCharacter.accessLevel || null : null,
          visibility: summary.rawCharacter ? summary.rawCharacter.visibility || null : null,
          sourceKind: "janitor",
          source: characterEnvelope.method,
        };
        if (storeCharacter.creatorId) return { character: storeCharacter };
        const apiCharacter = await readJanitorCharacterApiPageState(storeCharacter.id);
        return { character: apiCharacter ? mergeJanitorPageStateCharacter(storeCharacter, apiCharacter, "store_plus_character_api") : storeCharacter };
      }
      const apiCharacter = await readJanitorCharacterApiPageState(payload && payload.characterId);
      if (apiCharacter) return { character: apiCharacter };
      return {
        character: payload && payload.characterId
          ? { id: payload.characterId, characterId: payload.characterId, name: null, sourceKind: "janitor", source: characterEnvelope.method || "url" }
          : null,
      };
    }

    async function ensurePersona(token, personaName) {
      const headers = {
        accept: "application/json, text/plain, */*",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-app-version": APP_VERSION,
      };
      const listResponse = await fetchWithTimeoutAndRetry(
        "https://janitorai.com/hampter/personas/mine",
        { method: "GET", headers, credentials: "include" },
        { timeoutMs: FETCH_TIMEOUT_MS },
      );
      const listText = await listResponse.text();
      if (!listResponse.ok) throw new Error(`persona_list_http_${listResponse.status}`);
      let personas = [];
      try {
        personas = JSON.parse(listText);
      } catch (error) {
        throw new Error(`persona_list_parse_${error.message}`);
      }
      const existing = Array.isArray(personas)
        ? personas.find((persona) => String(persona && persona.name).trim().toLowerCase() === personaName)
        : null;
      if (existing && existing.id) return { created: false, persona: existing };
      const createResponse = await fetchWithTimeoutAndRetry(
        "https://janitorai.com/hampter/personas",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: personaName,
            appearance: PERSONA_APPEARANCE,
            pronouns: null,
            groupId: null,
            avatar: "",
          }),
          credentials: "include",
        },
        { timeoutMs: FETCH_TIMEOUT_MS },
      );
      const createText = await createResponse.text();
      if (!createResponse.ok) throw new Error(`persona_create_http_${createResponse.status}`);
      let persona = null;
      try {
        persona = JSON.parse(createText);
      } catch (error) {
        throw new Error(`persona_create_parse_${error.message}`);
      }
      return { created: true, persona };
    }

    async function createChat(token, characterId, personaId) {
      const response = await fetchWithTimeoutAndRetry(
        "https://janitorai.com/hampter/chats",
        {
          method: "POST",
          headers: {
            accept: "application/json, text/plain, */*",
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-app-version": APP_VERSION,
          },
          body: JSON.stringify({ character_id: characterId, persona_id: personaId }),
          credentials: "include",
        },
        { timeoutMs: FETCH_TIMEOUT_MS },
      );
      const text = await response.text();
      if (!response.ok) throw new Error(`create_chat_http_${response.status}`);
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new Error(`create_chat_parse_${error.message}`);
      }
    }

    async function fetchChat(token, chatId) {
      const response = await fetchWithTimeoutAndRetry(
        `https://janitorai.com/hampter/chats/${chatId}`,
        {
          method: "GET",
          headers: {
            accept: "application/json, text/plain, */*",
            authorization: `Bearer ${token}`,
            "x-app-version": APP_VERSION,
          },
          credentials: "include",
        },
        { timeoutMs: FETCH_TIMEOUT_MS },
      );
      const text = await response.text();
      if (!response.ok) throw new Error(`chat_fetch_http_${response.status}`);
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new Error(`chat_fetch_parse_${error.message}`);
      }
    }

    async function deleteChat(token, chatId) {
      if (!chatId) return { success: false, status: null, error: "missing_chat_id" };
      try {
        const response = await fetchWithTimeoutAndRetry(
          `https://janitorai.com/hampter/chats/${encodeURIComponent(String(chatId))}`,
          {
            method: "DELETE",
            headers: {
              accept: "application/json, text/plain, */*",
              authorization: `Bearer ${token}`,
              "x-app-version": APP_VERSION,
            },
            credentials: "include",
          },
          { timeoutMs: 15000, backoffMs: [1000] },
        );
        return { success: response.ok, status: response.status };
      } catch (error) {
        return {
          success: false,
          status: null,
          error: String(error && error.message ? error.message : error),
        };
      }
    }

    async function fetchFavorites(token, characterId) {
      try {
        const response = await fetchWithTimeoutAndRetry(
          `https://janitorai.com/hampter/favorites/character/${characterId}/count`,
          {
            method: "GET",
            headers: {
              accept: "application/json, text/plain, */*",
              authorization: `Bearer ${token}`,
              "x-app-version": APP_VERSION,
            },
            credentials: "include",
          },
          { timeoutMs: 8000, backoffMs: [1000] },
        );
        if (!response.ok) return { success: false, status: response.status };
        return { success: true, status: response.status, data: await response.json() };
      } catch (error) {
        return { success: false, error: String(error && error.message ? error.message : error) };
      }
    }

    async function fetchJanitorCharacterDetail(token, characterId) {
      const response = await fetchWithTimeoutAndRetry(
        `https://janitorai.com/hampter/characters/${characterId}`,
        {
          method: "GET",
          headers: {
            accept: "application/json, text/plain, */*",
            authorization: `Bearer ${token}`,
            "x-app-version": APP_VERSION,
          },
          credentials: "include",
        },
        { timeoutMs: FETCH_TIMEOUT_MS, backoffMs: [1000, 2000] },
      );
      const text = await response.text();
      let data = null;
      try {
        data = text.trim().startsWith("{") ? JSON.parse(text) : null;
      } catch (_) {}
      return {
        ok: response.ok,
        status: response.status,
        finalUrl: response.url || `https://janitorai.com/hampter/characters/${characterId}`,
        data,
        preview: data ? null : text.slice(0, 500),
      };
    }

    async function fetchJanitorScriptDetail(token, scriptId) {
      const response = await fetchWithTimeoutAndRetry(
        `https://janitorai.com/hampter/script/${scriptId}`,
        {
          method: "GET",
          headers: {
            accept: "application/json, text/plain, */*",
            authorization: `Bearer ${token}`,
            "x-app-version": APP_VERSION,
          },
          credentials: "include",
        },
        { timeoutMs: FETCH_TIMEOUT_MS, backoffMs: [1000, 2000] },
      );
      const text = await response.text();
      let data = null;
      try {
        data = text.trim().startsWith("{") ? JSON.parse(text) : null;
      } catch (_) {}
      return {
        ok: response.ok,
        status: response.status,
        finalUrl: response.url || `https://janitorai.com/hampter/script/${scriptId}`,
        data,
        preview: data ? null : text.slice(0, 500),
      };
    }

    function mergeScriptDetail(metadata, detailResult) {
      const data = detailResult && detailResult.data && typeof detailResult.data === "object" ? detailResult.data : {};
      return normalizeJanitorScriptMetadata(
        {
          ...metadata,
          ...data,
          id: metadata.id || data.id,
          type: firstPresent([metadata.type, data.type, data.script_type, data.scriptType]),
          title: firstPresent([metadata.title, data.title, data.name]),
          description: firstPresent([metadata.description, data.description]),
          is_public: metadata.isPublic ?? data.is_public ?? data.isPublic,
          is_code_public: metadata.isCodePublic ?? data.is_code_public ?? data.isCodePublic,
          is_comment_allowed: metadata.isCommentAllowed ?? data.is_comment_allowed ?? data.isCommentAllowed,
          is_locked: metadata.isLocked ?? data.is_locked ?? data.isLocked ?? data.locked,
          script: typeof data.script === "string" ? data.script : metadata.script,
          original_script: typeof data.original_script === "string" ? data.original_script : metadata.original_script,
          characters: Array.isArray(data.characters) ? data.characters : metadata.characters,
        },
        metadata.source,
      );
    }

    async function retrieveJanitorScripts(token, characterId, characterEnvelope, retrievalId, preloadedCharacterDetail) {
      sendStatus(retrievalId, "scripts", "Reading Janitor script/lorebook metadata.", { characterId });
      let characterDetail = preloadedCharacterDetail || null;
      let apiScripts = [];
      try {
        if (!characterDetail) characterDetail = await fetchJanitorCharacterDetail(token, characterId);
        if (characterDetail.data) {
          apiScripts = extractScriptMetadataFromCharacterPayload(characterDetail.data, "character_api");
        }
      } catch (error) {
        characterDetail = { ok: false, status: null, error: String(error && error.message ? error.message : error) };
      }
      const characterSummary = characterEnvelope && characterEnvelope.envelope
        ? CoreInPage.summarizeJanitorCharacterStore(characterEnvelope.envelope)
        : null;
      const storeScripts = characterSummary && characterSummary.rawCharacter
        ? extractScriptMetadataFromCharacterPayload(characterSummary.rawCharacter, "character_store")
        : [];
      const documentScripts = extractScriptMetadataFromDocumentLinks();
      const metadata = mergeScriptMetadataLists([apiScripts, storeScripts, documentScripts]);
      const items = [];
      for (const script of metadata) {
        sendStatus(retrievalId, "script_detail", `Reading script ${items.length + 1}/${metadata.length}.`, {
          scriptId: script.id,
          title: script.title,
        });
        try {
          const detail = await fetchJanitorScriptDetail(token, script.id);
          items.push({
            ...mergeScriptDetail(script, detail),
            scriptDetailStatus: detail.status,
            scriptDetailOk: detail.ok,
            scriptDetailUrl: detail.finalUrl,
            scriptDetailAvailable: detail.ok && !!detail.data,
            error: detail.ok ? null : `script_http_${detail.status}`,
          });
        } catch (error) {
          items.push({
            ...script,
            scriptDetailStatus: null,
            scriptDetailOk: false,
            scriptDetailAvailable: false,
            error: String(error && error.message ? error.message : error),
          });
        }
      }
      const lorebookCount = items.filter((item) => String(item.type || "").toLowerCase() === "lorebook").length;
      sendStatus(retrievalId, "scripts_done", "Script/lorebook capture finished.", {
        scripts: items.length,
        lorebooks: lorebookCount,
        characterStatus: characterDetail && characterDetail.status,
      });
      return sanitize({
        success: true,
        source: "janitor_scripts_extension",
        capturedAt: new Date().toISOString(),
        characterId,
        metadataSource: apiScripts.length ? "character_api" : storeScripts.length ? "character_store" : documentScripts.length ? "document_link" : null,
        characterStatus: characterDetail && characterDetail.status,
        characterOk: characterDetail ? characterDetail.ok === true : null,
        error: characterDetail && characterDetail.error ? characterDetail.error : null,
        items,
      });
    }

    async function fetchCreatorCharacters(token, creatorId, retrievalId) {
      const headers = {
        accept: "application/json, text/plain, */*",
        authorization: `Bearer ${token}`,
        "x-app-version": APP_VERSION,
      };
      const characters = [];
      let page = 1;
      let total = null;
      let pageSize = null;
      let pagesFetched = 0;
      let truncated = false;
      const maxPages = 25;
      while (page <= maxPages) {
        sendStatus(retrievalId, "creator_chars", `Reading creator characters page ${page}.`);
        const response = await fetchWithTimeoutAndRetry(
          buildCreatorCharactersApiUrl(creatorId, page),
          { method: "GET", headers, credentials: "include" },
          { timeoutMs: FETCH_TIMEOUT_MS, backoffMs: [1000, 2000] },
        );
        const text = await response.text();
        if (!response.ok) {
          return {
            success: false,
            sort: "popular",
            total,
            pageSize,
            pagesFetched,
            truncated,
            characters,
            error: `creator_characters_http_${response.status}`,
            preview: text.slice(0, 400),
          };
        }
        let data = null;
        try {
          data = JSON.parse(text);
        } catch (error) {
          return {
            success: false,
            sort: "popular",
            total,
            pageSize,
            pagesFetched,
            truncated,
            characters,
            error: `creator_characters_parse_${error.message}`,
            preview: text.slice(0, 400),
          };
        }
        const list = Array.isArray(data && data.data)
          ? data.data
          : Array.isArray(data)
            ? data
            : Array.isArray(data && data.characters)
              ? data.characters
              : [];
        pagesFetched += 1;
        if (data && data.total != null) total = Number.parseInt(String(data.total), 10) || total;
        if (data && data.size != null) pageSize = Number.parseInt(String(data.size), 10) || pageSize;
        for (const item of list) characters.push(compactCreatorApiCharacter(item));
        const effectivePageSize = pageSize || list.length;
        if (!list.length) break;
        if (total != null && characters.length >= total) break;
        if (effectivePageSize > 0 && total != null && page >= Math.ceil(total / effectivePageSize)) break;
        page += 1;
      }
      if (page > maxPages && total != null && characters.length < total) truncated = true;
      return {
        success: true,
        sort: "popular",
        total,
        pageSize,
        pagesFetched,
        truncated,
        characters,
      };
    }

    async function retrieveCreatorProfile(payload, retrievalId) {
      const creatorId = CoreInPage.normalizeUuid(payload && payload.creatorId);
      if (!creatorId) throw new Error("missing_creator_id");
      sendStatus(retrievalId, "creator", "Checking Janitor login for creator capture.");
      const token = getAuthToken();
      if (!token) throw new Error("not_logged_in");
      const profileUrl = `https://janitorai.com/profiles/${creatorId}`;

      sendStatus(retrievalId, "creator", "Reading creator profile page.", { creatorId });
      const profileResponse = await fetchWithTimeoutAndRetry(
        profileUrl,
        {
          method: "GET",
          headers: {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            authorization: `Bearer ${token}`,
            "x-app-version": APP_VERSION,
          },
          credentials: "include",
        },
        { timeoutMs: FETCH_TIMEOUT_MS, backoffMs: [1000, 2000] },
      );
      const html = await profileResponse.text();
      const profile = CoreInPage.parseJanitorCreatorProfileHtml(html, profileResponse.url || profileUrl, creatorId);
      if (!profile.userName && payload && payload.creatorName) profile.userName = String(payload.creatorName);

      const characterList = await fetchCreatorCharacters(token, creatorId, retrievalId);
      sendStatus(retrievalId, "creator_done", "Creator capture finished.", {
        creatorId,
        profileStatus: profileResponse.status,
        characters: Array.isArray(characterList.characters) ? characterList.characters.length : 0,
        total: characterList.total || null,
      });
      return sanitize({
        success: profileResponse.ok || characterList.success === true,
        source: "janitor_creator_extension",
        capturedAt: new Date().toISOString(),
        creatorId,
        creatorName: payload && payload.creatorName ? String(payload.creatorName) : null,
        profileUrl,
        profileStatus: profileResponse.status,
        profileFinalUrl: profileResponse.url || profileUrl,
        profile,
        characterList,
      });
    }

    async function generateAlpha(token, payload, userId) {
      const response = await fetchWithTimeoutAndRetry(
        "https://janitorai.com/generateAlpha",
        {
          method: "POST",
          headers: {
            accept: "text/event-stream",
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-app-version": APP_VERSION,
            "x-request-id": userId || "",
          },
          body: JSON.stringify(payload),
          credentials: "include",
        },
        { timeoutMs: FETCH_TIMEOUT_MS },
      );
      if (!response.ok) {
        return {
          success: false,
          status: response.status,
          statusText: response.statusText,
          rawResponse: await response.text().catch(() => ""),
        };
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let rawResponse = "";
      let chunkCount = 0;
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        chunkCount += 1;
        rawResponse += decoder.decode(result.value, { stream: true });
      }
      return {
        success: true,
        status: response.status,
        rawResponse,
        rawLength: rawResponse.length,
        chunkCount,
      };
    }

    async function startJanitorCoreRetrieval(payload, retrievalId) {
      const characterId =
        (payload && payload.characterId && CoreInPage.normalizeUuid(payload.characterId)) ||
        CoreInPage.parseJanitorCharacterUrl(location.href).characterId;
      if (!characterId) throw new Error("missing_character_id");
      const extractionPersonaAlias = CoreInPage.normalizeExtractionPersonaAlias(
        payload && payload.extractionPersonaAlias,
      );
      if (!extractionPersonaAlias) throw new Error("extraction_persona_alias_invalid");
      sendStatus(retrievalId, "auth", "Checking Janitor login.");
      const token = getAuthToken();
      if (!token) throw new Error("not_logged_in");
      const auth = await detectAuth();
      if (!auth.loggedIn) throw new Error(auth.error || "not_logged_in");

      sendStatus(retrievalId, "page", "Reading character page state.");
      const storeRead = readStoreState();
      const characterEnvelope = readCharacterEnvelope(characterId);
      const characterSummary = characterEnvelope.envelope
        ? CoreInPage.summarizeJanitorCharacterStore(characterEnvelope.envelope)
        : null;
      let characterDetail = null;
      let apiCharacterSummary = null;
      try {
        characterDetail = await fetchJanitorCharacterDetail(token, characterId);
        if (characterDetail && characterDetail.data) {
          apiCharacterSummary = summarizeJanitorApiCharacterPayload(characterDetail.data, "character_api");
        }
        sendStatus(retrievalId, "character_api", "Read Janitor character API payload.", {
          status: characterDetail && characterDetail.status,
          hasSections: !!(apiCharacterSummary && apiCharacterSummary.sections),
        });
      } catch (detailError) {
        characterDetail = { ok: false, status: null, error: String(detailError && detailError.message ? detailError.message : detailError) };
        sendStatus(retrievalId, "character_api", "Janitor character API payload read failed.", { error: characterDetail.error });
      }
      const documentCharacter = readCharacterFromDocument(characterId);
      const coreCharacter = apiCharacterSummary && apiCharacterSummary.found
        ? apiCharacterSummary
        : characterSummary && characterSummary.found
        ? characterSummary
        : documentCharacter && (documentCharacter.name || documentCharacter.creatorName || documentCharacter.avatarUrl)
          ? documentCharacter
          : null;
      const characterReadMethod = apiCharacterSummary && apiCharacterSummary.found
        ? "character_api"
        : characterEnvelope.method || (documentCharacter ? "document" : null);
      const favorites = await fetchFavorites(token, characterId);
      let scripts = null;
      try {
        scripts = await retrieveJanitorScripts(token, characterId, characterEnvelope, retrievalId, characterDetail);
      } catch (scriptError) {
        scripts = {
          success: false,
          source: "janitor_scripts_extension",
          capturedAt: new Date().toISOString(),
          characterId,
          error: String(scriptError && scriptError.message ? scriptError.message : scriptError),
          items: [],
        };
        sendStatus(retrievalId, "scripts", "Script/lorebook capture failed.", { error: scripts.error });
      }

      sendStatus(retrievalId, "persona", "Preparing local capture persona.");
      const personaResult = await ensurePersona(token, extractionPersonaAlias);
      if (!personaResult || !personaResult.persona || !personaResult.persona.id) {
        throw new Error("persona_missing");
      }

      sendStatus(retrievalId, "chat", "Creating temporary chat.");
      const chat = await createChat(token, characterId, personaResult.persona.id);
      const chatId = chat && chat.id;
      if (!chatId) throw new Error("chat_id_missing");

      let chatData = null;
      let firstMessage = null;
      let chatPayload = null;
      let generate = null;
      let chatDelete = null;
      try {
        sendStatus(retrievalId, "chat", "Reading temporary chat payload.");
        chatData = await fetchChat(token, chatId);
        firstMessage = extractFirstBotMessage(chatData);

        sendStatus(retrievalId, "payload", "Building Janitor generation payload.");
        chatPayload = buildChatPayload(
          storeRead.state,
          characterId,
          chatId,
          chatData,
          personaResult.persona,
        );

        sendStatus(retrievalId, "generate", "Requesting Janitor response.");
        generate = await generateAlpha(token, chatPayload, auth.user && auth.user.id);
      } finally {
        sendStatus(retrievalId, "chat_cleanup", "Deleting temporary chat.", { chatId });
        chatDelete = await deleteChat(token, chatId);
        sendStatus(retrievalId, "chat_cleanup", "Temporary chat cleanup finished.", {
          success: chatDelete && chatDelete.success,
          status: chatDelete && chatDelete.status,
          error: chatDelete && chatDelete.error,
        });
      }
      sendStatus(retrievalId, "core_done", "Janitor core capture finished.", {
        success: generate.success,
        rawLength: generate.rawLength || (generate.rawResponse ? generate.rawResponse.length : 0),
        chunkCount: generate.chunkCount || 0,
      });

      return sanitize({
        success: true,
        source: "janitor_core_extension",
        capturedAt: new Date().toISOString(),
        characterId,
        pageUrl: location.href,
        auth: { user: auth.user, status: auth.status },
        character: coreCharacter,
        characterApiStatus: characterDetail && characterDetail.status,
        characterApiOk: characterDetail ? characterDetail.ok === true : null,
        characterData: characterEnvelope.envelope,
        characterReadMethod,
        scripts,
        favoritesCount: favorites,
        persona: {
          id: personaResult.persona.id,
          name: personaResult.persona.name,
          created: personaResult.created === true,
        },
        chat: {
          id: chatId,
          url: `https://janitorai.com/chats/${chatId}`,
          characterName: chatData && chatData.character ? chatData.character.name : null,
          character: chatData && chatData.character
            ? {
                id: chatData.character.id || null,
                name: chatData.character.name || null,
                showdefinition: chatData.character.showdefinition ?? chatData.character.showDefinition ?? null,
                showDefinition: chatData.character.showDefinition ?? chatData.character.showdefinition ?? null,
                allow_proxy: chatData.character.allow_proxy ?? chatData.character.allowProxy ?? null,
                allowProxy: chatData.character.allowProxy ?? chatData.character.allow_proxy ?? null,
                is_image_nsfw: chatData.character.is_image_nsfw ?? chatData.character.isImageNsfw ?? null,
                isImageNsfw: chatData.character.isImageNsfw ?? chatData.character.is_image_nsfw ?? null,
              }
            : null,
          chatMessagesCount: Array.isArray(chatData && chatData.chatMessages) ? chatData.chatMessages.length : 0,
          delete: chatDelete,
        },
        extractedFirstMessage: firstMessage,
        chatPayload,
        generateAlpha: generate,
      });
    }

    async function detectLocalAuth() {
      const token = getAuthToken();
      const user = readLocalUserHint();
      return {
        loggedIn: !!token,
        tokenPresent: !!token,
        user,
        status: null,
        error: token ? null : "no_token",
        source: "local_session",
      };
    }

    async function detectAuth() {
      const token = getAuthToken();
      if (!token) {
        return { loggedIn: false, tokenPresent: false, user: null, status: null, error: "no_token" };
      }
      const response = await fetchWithTimeoutAndRetry(
        "https://janitorai.com/hampter/profiles/mine",
        {
          method: "GET",
          headers: {
            accept: "application/json, text/plain, */*",
            authorization: `Bearer ${token}`,
            "x-app-version": APP_VERSION,
          },
          credentials: "include",
        },
        { timeoutMs: 15000, backoffMs: [1000] },
      );
      const text = await response.text();
      let data = null;
      try {
        data = text.trim().startsWith("{") ? JSON.parse(text) : null;
      } catch (_) {}
      const loggedIn = !!(response.ok && data && data.id);
      return {
        loggedIn,
        tokenPresent: true,
        status: response.status,
        user: loggedIn
          ? {
              id: data.id || null,
              name: data.name || null,
              userName: data.user_name || null,
              proxyCount: data.config && Array.isArray(data.config.proxyConfigurations) ? data.config.proxyConfigurations.length : 0,
            }
          : null,
        error: loggedIn ? null : `profile_http_${response.status}`,
      };
    }

    async function readPageState(payload) {
      const shouldWait = !!(payload && payload.waitForHydration);
      const startedAt = Date.now();
      let latest = null;
      do {
        latest = await readJanitorPageStateOnce(payload || {});
        if (hasHydratedPageCharacter(latest) || !shouldWait) return latest;
        await sleep(350);
      } while (Date.now() - startedAt < 5000);
      return latest;
    }

    return {
      detectAuth,
      detectLocalAuth,
      readPageState,
      retrieveCore: startJanitorCoreRetrieval,
      retrieveCreatorProfile,
    };
  });
})();
