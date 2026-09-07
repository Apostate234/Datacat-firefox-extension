"use strict";

(function initJanitorHelpers(globalScope) {
  globalScope.SourceVaultJanitorHelpers = function createJanitorHelpers(context = {}) {
    const CoreInPage = context.CoreInPage;
    const sanitize = context.sanitize;
    const PERSONA_APPEARANCE = context.PERSONA_APPEARANCE;
    function compactMeta(parts) {
      return (Array.isArray(parts) ? parts : [])
        .filter((part) => part != null && String(part).trim() !== "")
        .map((part) => String(part).trim())
        .join(" \u00b7 ");
    }

    function getAuthToken() {
      for (const storage of [window.localStorage, window.sessionStorage]) {
        try {
          for (const key of Object.keys(storage)) {
            if (!key.includes("sb-") || !key.includes("-auth-token")) continue;
            try {
              const raw = storage.getItem(key);
              const parsed = raw ? JSON.parse(raw) : null;
              if (parsed && parsed.access_token) return parsed.access_token;
            } catch (_) {}
          }
        } catch (_) {}
      }
      const cookies = String(document.cookie || "").split(";").map((item) => item.trim());
      const tokenParts = {};
      for (const cookie of cookies) {
        if (!cookie.startsWith("sb-auth-auth-token")) continue;
        const eqIdx = cookie.indexOf("=");
        if (eqIdx > 0) tokenParts[cookie.substring(0, eqIdx)] = cookie.substring(eqIdx + 1);
      }
      let combined = "";
      if (tokenParts["sb-auth-auth-token.0"]) combined += tokenParts["sb-auth-auth-token.0"];
      if (tokenParts["sb-auth-auth-token.1"]) combined += tokenParts["sb-auth-auth-token.1"];
      if (tokenParts["sb-auth-auth-token"]) combined = tokenParts["sb-auth-auth-token"];
      if (!combined) return null;
      try {
        let raw = decodeURIComponent(combined);
        if (raw.startsWith("base64-")) raw = raw.slice(7);
        const parsed = JSON.parse(atob(raw));
        return parsed && parsed.access_token ? parsed.access_token : null;
      } catch (_) {
        try {
          const parsed = JSON.parse(decodeURIComponent(combined));
          return parsed && parsed.access_token ? parsed.access_token : null;
        } catch (_e) {
          return null;
        }
      }
    }

    function readLocalUserHint() {
      const storeState = readStoreState();
      const userState = storeState && storeState.state && storeState.state.user ? storeState.state.user : null;
      const profile = userState && userState.profile && typeof userState.profile === "object" ? userState.profile : null;
      if (profile) {
        return {
          id: profile.id || null,
          name: profile.name || null,
          userName: profile.user_name || profile.userName || null,
          source: storeState.method || "store_state",
        };
      }
      try {
        const label = String(
          document.querySelector('[aria-label*="profile" i]')?.textContent ||
            document.querySelector('[href*="/profiles/"]')?.textContent ||
            "",
        ).trim();
        if (label && label.length > 1 && label.length < 80) {
          return { id: null, name: null, userName: label, source: "dom_profile_hint" };
        }
      } catch (_) {}
      return null;
    }

    function parseJsonParseArgument(scriptText, marker) {
      const text = String(scriptText || "");
      const markerIndex = text.indexOf(marker);
      if (markerIndex < 0) return null;
      let argStart = markerIndex + marker.length;
      while (argStart < text.length && /\s/.test(text[argStart])) argStart += 1;
      const quote = text[argStart];
      if (quote !== '"' && quote !== "'") return null;
      let escaped = false;
      for (let i = argStart + 1; i < text.length; i += 1) {
        const ch = text[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === quote) {
          try {
            return JSON.parse(text.substring(argStart, i + 1));
          } catch (_) {
            return null;
          }
        }
      }
      return null;
    }

    function readStoreState() {
      try {
        const raw = window._storeState_;
        if (raw && typeof raw === "object") return { state: raw, method: "window._storeState_" };
        if (raw && typeof raw === "string") {
          try {
            return { state: JSON.parse(raw), method: "window._storeState_string" };
          } catch (_) {}
        }
      } catch (_) {}
      try {
        for (const key of Object.keys(window)) {
          const value = window[key];
          if (value && typeof value === "object" && value.user && value.user.config) {
            return { state: value, method: `window.${key}` };
          }
        }
      } catch (_) {}
      const scripts = Array.from(document.querySelectorAll("script"));
      for (const script of scripts) {
        const text = script.textContent || "";
        if (!text.includes("window._storeState_")) continue;
        const payload = parseJsonParseArgument(text, "window._storeState_ = JSON.parse(");
        if (!payload) continue;
        try {
          return { state: JSON.parse(payload), method: "script_store_state" };
        } catch (_) {}
      }
      return { state: null, method: null };
    }

    function readCharacterEnvelope(characterId) {
      const pick = (obj) => {
        if (!obj || typeof obj !== "object") return null;
        const picked = CoreInPage.pickJanitorCharacterStore(obj);
        if (picked) return picked;
        return null;
      };
      try {
        const mbxM = Array.isArray(window.mbxM) ? window.mbxM : null;
        if (mbxM) {
          for (let index = mbxM.length - 1; index >= 0 && index >= mbxM.length - 40; index -= 1) {
            const picked = pick(mbxM[index]);
            if (picked) return { envelope: { [picked.key]: picked.store }, method: "window.mbxM" };
          }
        }
      } catch (_) {}
      const storeState = readStoreState();
      const pickedFromStore = pick(storeState.state);
      if (pickedFromStore) {
        return { envelope: { [pickedFromStore.key]: pickedFromStore.store }, method: storeState.method };
      }
      const scripts = Array.from(document.querySelectorAll("script"));
      for (const script of scripts) {
        const text = script.textContent || "";
        if (!text.includes("window.mbxM.push(JSON.parse(")) continue;
        const payload = parseJsonParseArgument(text, "window.mbxM.push(JSON.parse(");
        if (!payload) continue;
        try {
          const parsed = JSON.parse(payload);
          const picked = pick(parsed);
          if (picked) return { envelope: { [picked.key]: picked.store }, method: "script_mbxM" };
        } catch (_) {}
      }
      return {
        envelope: null,
        method: null,
        fallbackCharacterId: characterId || (CoreInPage.parseJanitorCharacterUrl(location.href).characterId || null),
      };
    }

    function cleanDocumentCharacterTitle(value) {
      const text = String(value || "")
        .replace(/\s*[-|]\s*janitor(?:ai)?\s*$/i, "")
        .trim();
      if (!text) return null;
      if (/^(janitor|janitor ai|character profile|just a moment|not found|security verification)$/i.test(text)) {
        return null;
      }
      if (/^janitor(?:ai)?(?:\.com)?\s*[-|:–—]/i.test(text)) return null;
      if (/janitor\s*(?:ai)?\s*[-|:–—]\s*build,\s*share,\s*and\s*explore/i.test(text)) return null;
      if (/janitor\s*ai.*(?:chatbot|character ai|without filters|roleplay|home|search|build|share|explore)/i.test(text)) return null;
      if (/search for characters/i.test(text)) return null;
      return text.length > 160 ? text.slice(0, 160).trim() : text;
    }

    function readVisibleCharacterTitleFromBody() {
      try {
        const body = String(document.body && document.body.innerText ? document.body.innerText : "");
        const lines = body
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean);
        const blocked = new Set([
          "beta",
          "news",
          "help",
          "create a character",
          "character profile",
          "chats",
          "followers",
          "following",
          "my chats",
          "new chat",
          "comments",
          "reviews",
        ]);
        for (const line of lines.slice(0, 80)) {
          const cleaned = cleanDocumentCharacterTitle(line);
          if (!cleaned) continue;
          const lower = cleaned.toLowerCase();
          if (blocked.has(lower)) continue;
          if (/^@/.test(cleaned)) continue;
          if (/^by:$/i.test(cleaned) || /^by:\s*@/i.test(cleaned)) continue;
          if (/^[a-z]$/i.test(cleaned)) continue;
          if (/^\d+(?:\.\d+)?[km]?$/i.test(cleaned)) continue;
          if (/^(public|private|limited|anypov|male|female|non-binary)$/i.test(cleaned)) continue;
          return cleaned;
        }
      } catch (_) {}
      return null;
    }

    function documentContainsCharacterId(characterId) {
      const id = CoreInPage.normalizeUuid(characterId);
      if (!id) return true;
      const documentFields = [
        document.querySelector('link[rel="canonical"]')?.href,
        document.querySelector('meta[property="og:url"]')?.content,
        document.querySelector('meta[name="twitter:url"]')?.content,
      ];
      if (documentFields.some((value) => String(value || "").toLowerCase().includes(id))) return true;
      try {
        const bodyText = String(document.body && document.body.innerText ? document.body.innerText : "").toLowerCase();
        if (bodyText.includes(id)) return true;
      } catch (_) {}
      return false;
    }

    function readCharacterFromDocument(characterId) {
      if (characterId && !documentContainsCharacterId(characterId)) {
        return {
          id: characterId,
          name: null,
          creatorId: null,
          creatorName: null,
          avatarUrl: null,
          profileImageAssetUrl: null,
          source: "document_route_pending",
        };
      }
      const titleCandidates = [
        ["document_h1", cleanDocumentCharacterTitle(document.querySelector("h1")?.textContent)],
        ["document_h2", cleanDocumentCharacterTitle(document.querySelector("main h2, h2")?.textContent)],
        ["document_body", readVisibleCharacterTitleFromBody()],
        ["document_og_title", cleanDocumentCharacterTitle(document.querySelector('meta[property="og:title"]')?.content)],
        ["document_twitter_title", cleanDocumentCharacterTitle(document.querySelector('meta[name="twitter:title"]')?.content)],
        ["document_title", cleanDocumentCharacterTitle(document.title)],
      ];
      const titleCandidate = titleCandidates.find((candidate) => candidate[1]);
      const title = titleCandidate ? titleCandidate[1] : null;
      const avatarUrl =
        document.querySelector('meta[property="og:image"]')?.content ||
        document.querySelector('meta[name="twitter:image"]')?.content ||
        null;
      let creatorName = null;
      try {
        const body = String(document.body && document.body.innerText ? document.body.innerText : "");
        const match = body.match(/\bby:\s*\n?\s*@?([^\n\r]+)/i);
        if (match && match[1]) creatorName = match[1].trim().slice(0, 120);
      } catch (_) {}
      return {
        id: characterId || (CoreInPage.parseJanitorCharacterUrl(location.href).characterId || null),
        name: title || null,
        creatorId: null,
        creatorName,
        avatarUrl,
        profileImageAssetUrl: avatarUrl,
        source: titleCandidate ? titleCandidate[0] : "document_fallback",
      };
    }

    function mergeJanitorPageStateCharacter(primary, fallback, source) {
      const a = primary && typeof primary === "object" ? primary : {};
      const b = fallback && typeof fallback === "object" ? fallback : {};
      return sanitize({
        id: a.id || b.id || null,
        characterId: a.characterId || a.id || b.characterId || b.id || null,
        name: a.name || b.name || null,
        creatorId: a.creatorId || b.creatorId || null,
        creatorName: a.creatorName || b.creatorName || null,
        avatarUrl: a.avatarUrl || b.avatarUrl || null,
        profileImageAssetUrl: a.profileImageAssetUrl || a.avatarUrl || b.profileImageAssetUrl || b.avatarUrl || null,
        isPublic: a.isPublic ?? b.isPublic ?? null,
        accessLevel: a.accessLevel || b.accessLevel || null,
        visibility: a.visibility || b.visibility || null,
        openDefinition: a.openDefinition ?? b.openDefinition ?? null,
        sourceKind: "janitor",
        source: source || compactMeta([a.source, b.source]) || null,
      });
    }


    function firstPresent(values) {
      for (const value of values || []) {
        if (value == null) continue;
        if (typeof value === "string" && value.trim() === "") continue;
        return value;
      }
      return null;
    }

    function normalizeJanitorScriptMetadata(script, source) {
      const item = script && typeof script === "object" ? script : {};
      const id = CoreInPage.normalizeUuid(item.id || item.script_id || item.scriptId);
      return sanitize({
        id,
        title: firstPresent([item.title, item.name]),
        description: firstPresent([item.description, item.descriptionText]),
        type: firstPresent([item.type, item.script_type, item.scriptType]),
        source: source || item.source || null,
        pageUrl: id ? `https://janitorai.com/scripts/${id}` : null,
        apiPath: id ? `/hampter/script/${id}` : null,
        isPublic: item.is_public ?? item.isPublic ?? null,
        isCodePublic: item.is_code_public ?? item.isCodePublic ?? null,
        isCommentAllowed: item.is_comment_allowed ?? item.isCommentAllowed ?? null,
        scriptDetailAvailable: item.script_detail_available ?? item.scriptDetailAvailable ?? null,
        isLocked: item.is_locked ?? item.isLocked ?? item.locked ?? null,
        script: typeof item.script === "string" ? item.script : null,
        original_script: typeof item.original_script === "string" ? item.original_script : null,
        theme: item.theme || null,
        createdAt: item.created_at || item.createdAt || null,
        updatedAt: item.updated_at || item.updatedAt || null,
        userId: item.user_id || item.userId || null,
        userName: item.user_name || item.userName || null,
        messageCount: item.message_count ?? item.messageCount ?? null,
        engineVersion: item.engine_version ?? item.engineVersion ?? null,
        depth: item.depth ?? null,
        settings: item.settings ?? null,
        characters: Array.isArray(item.characters) ? item.characters.slice(0, 200) : [],
      });
    }

    function extractScriptMetadataFromCharacterPayload(payload, source) {
      const data = payload && typeof payload === "object" ? payload : {};
      const character = data.character && typeof data.character === "object" ? data.character : data;
      const scripts = Array.isArray(data.scripts)
        ? data.scripts
        : Array.isArray(character.scripts)
          ? character.scripts
          : [];
      return scripts.map((script) => normalizeJanitorScriptMetadata(script, source)).filter((script) => script && script.id);
    }

    function normalizeFirstMessages(value) {
      const list = Array.isArray(value) ? value : [];
      return list
        .map((item, index) => {
          if (typeof item === "string") {
            return { index, id: null, name: null, message: item };
          }
          const root = item && typeof item === "object" ? item : {};
          return {
            index,
            id: root.id || root.first_message_id || null,
            name: root.name || root.title || null,
            message: typeof root.message === "string"
              ? root.message
              : typeof root.first_message === "string"
                ? root.first_message
                : typeof root.content === "string"
                  ? root.content
                  : null,
          };
        })
        .filter((item) => item.message);
    }

    function summarizeJanitorApiCharacterPayload(payload, source) {
      const root = payload && typeof payload === "object" ? payload : {};
      const character = root.data && typeof root.data === "object"
        ? root.data
        : root.character && typeof root.character === "object"
          ? root.character
          : root;
      if (!character || typeof character !== "object") return null;
      const id = CoreInPage.normalizeUuid(character.id || character.character_id);
      if (!id && !character.name) return null;
      const firstMessages = normalizeFirstMessages(character.first_messages);
      const avatarUrl = CoreInPage.normalizeJanitorAssetUrl(
        character.avatar || character.avatar_url || character.avatarUrl || null,
      );
      return sanitize({
        found: true,
        storeKey: source || "character_api",
        source: source || "character_api",
        id,
        name: character.name || character.title || null,
        creatorId: CoreInPage.normalizeUuid(character.creator_id || character.creatorId),
        creatorName: character.creator_name || character.creatorName || null,
        createdAt: character.created_at || character.createdAt || null,
        updatedAt: character.updated_at || character.updatedAt || null,
        firstPublishedAt: character.first_published_at || character.firstPublishedAt || null,
        chatName: character.chat_name || character.chatName || null,
        avatarUrl,
        profileImageAssetUrl: avatarUrl,
        rawDescriptionHtml: typeof character.description === "string" ? character.description : null,
        sections: {
          descriptionHtml: typeof character.description === "string" ? character.description : null,
          personality: typeof character.personality === "string" ? character.personality : null,
          scenario: typeof character.scenario === "string" ? character.scenario : null,
          firstMessage: typeof character.first_message === "string" ? character.first_message : null,
          firstMessages,
          exampleDialogs: typeof character.example_dialogs === "string" ? character.example_dialogs : null,
        },
        stats: character.stats && typeof character.stats === "object" ? character.stats : null,
        tokenCounts: character.token_counts && typeof character.token_counts === "object" ? character.token_counts : null,
        tags: Array.isArray(character.tags) ? character.tags.slice(0, 60) : null,
        rawCharacter: character,
      });
    }

    function extractScriptMetadataFromDocumentLinks() {
      try {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        const out = [];
        for (const anchor of anchors) {
          const href = String(anchor.href || "").trim();
          const match = href.match(/\/(?:scripts?|lorebook)\/([0-9a-fA-F-]{36})(?:$|[/?#])/);
          if (!match) continue;
          out.push(
            normalizeJanitorScriptMetadata(
              {
                id: match[1],
                title: String(anchor.textContent || "").replace(/\s+/g, " ").trim() || null,
              },
              "document_link",
            ),
          );
        }
        return out;
      } catch (_) {
        return [];
      }
    }

    function mergeScriptMetadataLists(lists) {
      const out = [];
      const seen = new Set();
      for (const list of lists || []) {
        for (const script of Array.isArray(list) ? list : []) {
          if (!script || !script.id) continue;
          const key = String(script.id).toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(script);
        }
      }
      return out;
    }


    function buildCreatorCharactersApiUrl(creatorId, page) {
      const url = new URL("https://janitorai.com/hampter/characters");
      url.searchParams.set("page", String(Math.max(1, Number(page) || 1)));
      url.searchParams.set("mode", "all");
      url.searchParams.set("sort", "popular");
      url.searchParams.append("user_id[]", creatorId);
      return url.toString();
    }

    function slugifyJanitorCharacterText(value) {
      const text = String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-{2,}/g, "-");
      return text || null;
    }

    function buildJanitorCharacterSourceUrl(character) {
      const root = character && typeof character === "object" ? character : {};
      const direct = root.url || root.characterUrl || root.character_url || root.profileUrl || root.profile_url || root.sourceUrl || root.source_url;
      if (direct) {
        const raw = String(direct).trim();
        const pathLike = raw.startsWith("/") ? raw : /^characters\//i.test(raw) ? `/${raw}` : null;
        if (!/^https?:\/\//i.test(raw) && !pathLike) {
          // Fall through to id + slug construction below.
        } else {
          try {
            return new URL(pathLike || raw, "https://janitorai.com").toString();
          } catch (_) {
            return raw;
          }
        }
      }
      const path = root.path || root.pathname || root.slugPath || root.slug_path;
      if (path) {
        const raw = String(path).trim();
        const pathLike = raw.startsWith("/") ? raw : /^characters\//i.test(raw) ? `/${raw}` : null;
        if (pathLike) {
          try {
            return new URL(pathLike, "https://janitorai.com").toString();
          } catch (_) {}
        }
      }
      const id = CoreInPage.normalizeUuid(root.id || root.characterId || root.character_id);
      if (!id) return null;
      let slug = root.slug || root.public_slug || root.slugified_name || root.slugifiedName || null;
      slug = slugifyJanitorCharacterText(slug || root.name);
      if (!slug) return `https://janitorai.com/characters/${id}`;
      const suffix = slug.startsWith("character-") ? slug : `character-${slug}`;
      return `https://janitorai.com/characters/${id}_${suffix}`;
    }

    function compactCreatorApiCharacter(character) {
      const stats = character && typeof character.stats === "object" ? character.stats : {};
      const slug = character && (character.slug || character.public_slug || character.slugified_name || character.slugifiedName)
        ? String(character.slug || character.public_slug || character.slugified_name || character.slugifiedName)
        : null;
      return sanitize({
        id: CoreInPage.normalizeUuid(character && character.id),
        name: character && character.name ? String(character.name) : null,
        creatorId: CoreInPage.normalizeUuid(character && (character.creator_id || character.creatorId)),
        creatorName: character && (character.creator_name || character.creatorName) ? String(character.creator_name || character.creatorName) : null,
        slug,
        url: buildJanitorCharacterSourceUrl(character),
        avatar: character && character.avatar ? String(character.avatar) : null,
        profileImageAssetUrl: character && (character.profileImageAssetUrl || character.avatarUrl || character.avatar_url || character.avatar)
          ? String(character.profileImageAssetUrl || character.avatarUrl || character.avatar_url || character.avatar)
          : null,
        shortDescription: firstPresent([
          character && character.short_description,
          character && character.shortDescription,
          character && character.description_text,
          character && character.descriptionText,
          character && character.summary,
        ]),
        description: character && character.description ? String(character.description).slice(0, 1000) : null,
        isNsfw: character ? character.is_nsfw ?? character.isNsfw ?? null : null,
        isPublic: character ? character.is_public ?? character.isPublic ?? null : null,
        totalTokens: character ? character.total_tokens ?? character.totalToken ?? null : null,
        stats: {
          chatCount: stats.chat ?? stats.chatCount ?? null,
          messageCount: stats.message ?? stats.messageCount ?? null,
        },
        tags: Array.isArray(character && character.tags) ? character.tags.slice(0, 40) : null,
        createdAt: character && character.created_at ? character.created_at : null,
        firstPublishedAt: character && character.first_published_at ? character.first_published_at : null,
      });
    }


    function extractFirstBotMessage(chatData) {
      const messages = Array.isArray(chatData && chatData.chatMessages) ? chatData.chatMessages : [];
      const botMessages = messages.filter((message) => message && message.is_bot === true);
      return botMessages.length ? botMessages[botMessages.length - 1].message || null : null;
    }

    function buildChatPayload(storeState, characterId, chatId, chatData, persona) {
      const personaName = String(persona && persona.name || "").trim();
      if (!personaName) throw new Error("persona_name_missing");
      const userConfig = (storeState && storeState.user && storeState.user.config) || {};
      const profile = (storeState && storeState.user && storeState.user.profile) || {};
      const genSettings = userConfig.generation_settings || {};
      const messages =
        chatData && Array.isArray(chatData.chatMessages) && chatData.chatMessages.length
          ? chatData.chatMessages
          : [
              {
                chat_id: chatId,
                created_at: new Date().toISOString(),
                id: Math.floor(50000000000 + Math.random() * 40000000000),
                is_bot: true,
                is_main: true,
                message: "[Start your scenario...]",
              },
            ];
      return {
        chat: {
          character_id: characterId,
          id: Number(chatId) || chatId,
          summary: "",
          user_id: profile.id || "",
        },
        chatMessages: messages,
        clientPlatform: "web",
        forcedPromptGenerationCacheRefetch: {
          character: false,
          chat: false,
          profile: false,
          script: false,
        },
        generateMode: "NEW",
        generateType: "CHAT",
        profile: {
          id: profile.id || "",
          name: personaName,
          user_appearance: (persona && persona.appearance) || PERSONA_APPEARANCE,
          user_name: personaName,
        },
        userConfig: {
          allow_mobile_nsfw: userConfig.allow_mobile_nsfw || false,
          api: "openai",
          claudeApiKey: null,
          generation_settings: {
            context_length: genSettings.context_length || 16384,
            frequency_penalty: genSettings.frequency_penalty || 0,
            max_new_token: genSettings.max_new_token || 500,
            prefill_enabled: genSettings.prefill_enabled || false,
            prefill_text: genSettings.prefill_text || "",
            repetition_penalty: genSettings.repetition_penalty || 0,
            temperature: genSettings.temperature || 0.9,
            top_k: genSettings.top_k || 0,
            top_p: genSettings.top_p || 0,
          },
          llm_prompt: userConfig.llm_prompt || "",
          open_ai_jailbreak_prompt: userConfig.open_ai_jailbreak_prompt || "",
          open_ai_mode: "proxy",
          open_ai_reverse_proxy: "https://testproxy.com/v1",
          openAIKey: null,
          openAiModel: "test",
          reverseProxyKey: "testkey",
        },
      };
    }
    return { compactMeta, getAuthToken, readLocalUserHint, parseJsonParseArgument, readStoreState, readCharacterEnvelope, cleanDocumentCharacterTitle, readVisibleCharacterTitleFromBody, documentContainsCharacterId, readCharacterFromDocument, mergeJanitorPageStateCharacter, firstPresent, normalizeJanitorScriptMetadata, extractScriptMetadataFromCharacterPayload, normalizeFirstMessages, summarizeJanitorApiCharacterPayload, extractScriptMetadataFromDocumentLinks, mergeScriptMetadataLists, buildCreatorCharactersApiUrl, slugifyJanitorCharacterText, buildJanitorCharacterSourceUrl, compactCreatorApiCharacter, extractFirstBotMessage, buildChatPayload };
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
