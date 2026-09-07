(function initSourceVaultCore(globalScope) {
  "use strict";

  const UUID_RE =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const STRICT_UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const JANNY_BASE = "https://jannyai.com";
  const JANNY_IMAGE_BASE = "https://image.jannyai.com";
  const SAUCEPAN_BASE = "https://saucepan.ai";
  const SAUCEPAN_CDN_BASE = `${SAUCEPAN_BASE}/cdn`;
  const SAUCEPAN_STALE_DEFINITION_CARD_PATTERN = /this tab is running an old version of the site/i;
  const SAUCEPAN_DEFINITION_FIELDS = Object.freeze([
    "card",
    "example_dialogue",
    "formatting_instructions",
    "advanced_prompt",
  ]);
  const LEGACY_EXTRACTION_PERSONA_ALIASES = Object.freeze([
    "sourcevaultcapture",
  ]);
  const UNSETTLED_SOURCE_CHARACTER_SOURCES = Object.freeze({
    janitor: new Set([
      "document_body",
      "document_fallback",
      "document_plus_character_api",
      "document_route_pending",
      "document_og_title",
      "document_title",
      "document_twitter_title",
      "url",
    ]),
    saucepan: new Set([
      "document_fallback",
      "document_og_title",
      "document_title",
      "document_twitter_title",
      "url",
    ]),
  });

  function normalizeSourceKind(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "sauce" || normalized === "saucepan") return "saucepan";
    if (normalized === "janitor" || normalized === "janitorai" || normalized === "janny") return "janitor";
    return null;
  }

  function normalizeExtractionPersonaAlias(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return /^[a-z][a-z0-9]{19}$/.test(normalized) ? normalized : null;
  }

  function buildExtractionPersonaReplacementCandidates(...groups) {
    const candidates = [];
    const seen = new Set();
    for (const group of groups) {
      const values = Array.isArray(group) ? group : [group];
      for (const value of values) {
        const normalized = String(value || "").trim();
        if (!normalized || normalized === "{{user}}") continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(normalized);
      }
    }
    return candidates.sort((left, right) => right.length - left.length);
  }

  function getExtractionPersonaReplacementCandidates(capture) {
    const root = capture && typeof capture === "object" ? capture : {};
    const sourceKind = normalizeSourceKind(root.sourceKind);
    if (sourceKind && sourceKind !== "janitor" && !root.janitorCore) return [];
    const core = root.janitorCore && typeof root.janitorCore === "object"
      ? root.janitorCore
      : root;
    const persona = core.persona && typeof core.persona === "object" ? core.persona : {};
    const activeAlias = normalizeExtractionPersonaAlias(
      persona.captureAlias || persona.extractionPersonaAlias || persona.name,
    );
    return buildExtractionPersonaReplacementCandidates(
      activeAlias,
      LEGACY_EXTRACTION_PERSONA_ALIASES,
    );
  }

  function replaceExtractionPersonaAliasesInText(value, candidates) {
    if (typeof value !== "string" || !value) return value;
    let output = value;
    for (const candidate of buildExtractionPersonaReplacementCandidates(candidates)) {
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      output = output.replace(new RegExp(escaped, "gi"), "{{user}}");
    }
    return output;
  }

  function replaceExtractionPersonaAliasesInValue(value, candidates, depth = 0) {
    if (typeof value === "string") return replaceExtractionPersonaAliasesInText(value, candidates);
    if (value == null || typeof value !== "object" || depth > 20) return value;
    if (Array.isArray(value)) {
      return value.map((item) => replaceExtractionPersonaAliasesInValue(item, candidates, depth + 1));
    }
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = replaceExtractionPersonaAliasesInValue(item, candidates, depth + 1);
    }
    return output;
  }

  function scrubJanitorCapturePersonaAliases(capture) {
    const root = capture && typeof capture === "object" ? capture : capture;
    if (!root || typeof root !== "object") return root;
    const candidates = getExtractionPersonaReplacementCandidates(root);
    if (!candidates.length) return root;
    const janitorCore = root.janitorCore && typeof root.janitorCore === "object"
      ? root.janitorCore
      : null;
    const preservedPersona = janitorCore && janitorCore.persona
      ? janitorCore.persona
      : !root.janitorCore && root.persona
        ? root.persona
        : null;
    const preservedAuth = janitorCore && janitorCore.auth
      ? janitorCore.auth
      : !root.janitorCore && root.auth
        ? root.auth
        : null;
    const cleaned = replaceExtractionPersonaAliasesInValue(root, candidates);
    const cleanedCore = cleaned && cleaned.janitorCore && typeof cleaned.janitorCore === "object"
      ? cleaned.janitorCore
      : cleaned;
    if (cleanedCore && preservedPersona) cleanedCore.persona = preservedPersona;
    if (cleanedCore && preservedAuth) cleanedCore.auth = preservedAuth;
    return cleaned;
  }

  function scrubStoredRetrievedCharacterPersonaAliases(record) {
    const root = record && typeof record === "object" ? record : record;
    if (!root || typeof root !== "object") return root;
    const capture = root.capture && typeof root.capture === "object" ? root.capture : {};
    const candidates = getExtractionPersonaReplacementCandidates(capture);
    if (!candidates.length) return root;
    const cleaned = replaceExtractionPersonaAliasesInValue(root, candidates);
    if (cleaned.capture) {
      cleaned.capture = scrubJanitorCapturePersonaAliases(capture);
    }
    return cleaned;
  }

  function normalizeGenericTitleText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function isGenericSourceCharacterTitle(sourceKind, value) {
    const kind = normalizeSourceKind(sourceKind);
    const text = normalizeGenericTitleText(value);
    if (!text) return true;
    const sharedGenericTitles = new Set([
      "chat",
      "chats",
      "create",
      "explore",
      "followers",
      "following",
      "home",
      "library",
      "login",
      "my chats",
      "notifications",
      "profile",
      "search",
      "settings",
      "sign in",
    ]);
    if (sharedGenericTitles.has(text)) return true;
    if (kind === "saucepan") {
      if ([
        "browse",
        "companion",
        "companions",
        "create companion",
        "discover",
        "for you",
        "just a moment",
        "my companions",
        "new companion",
        "not found",
        "saucepan",
        "saucepan ai",
        "security verification",
      ].includes(text)) {
        return true;
      }
      return /^saucepan(?:\.ai)?\b/.test(text) || /\bsecurity verification\b/.test(text);
    }
    if (kind === "janitor") {
      if ([
        "character profile",
        "create a character",
        "janitor",
        "janitor ai",
        "new chat",
      ].includes(text)) {
        return true;
      }
      return (
        /^janitor(?:ai)?(?:\.com)?\b/.test(text) ||
        /janitor\s*(?:ai)?\s*[-|:]\s*build,\s*share,\s*and\s*explore/.test(text) ||
        /search for characters/.test(text)
      );
    }
    return false;
  }

  function isUnsettledSourceCharacterSource(sourceKind, source) {
    const kind = normalizeSourceKind(sourceKind);
    const sources = kind ? UNSETTLED_SOURCE_CHARACTER_SOURCES[kind] : null;
    return !!(sources && sources.has(String(source || "").trim()));
  }

  function isSettledSourceCharacterState(sourceKind, character, page) {
    const pageRoot = page && typeof page === "object" ? page : {};
    if (pageRoot.isCharacterPage === false) return true;
    const root = character && typeof character === "object" ? character : null;
    const kind = normalizeSourceKind(sourceKind || pageRoot.sourceKind || (root && root.sourceKind));
    if (!root || !root.name || isGenericSourceCharacterTitle(kind, root.name)) return false;
    if (isUnsettledSourceCharacterSource(kind, root.source)) return false;
    return true;
  }

  function normalizeUuid(value) {
    const match = String(value || "").match(UUID_RE);
    return match ? match[0].toLowerCase() : null;
  }

  function parseJanitorCharacterUrl(rawUrl) {
    const raw = String(rawUrl || "").trim();
    if (!raw) {
      return { valid: false, characterId: null, normalizedUrl: null };
    }
    let parsed = null;
    try {
      parsed = new URL(raw);
    } catch (_) {
      return { valid: false, characterId: null, normalizedUrl: null };
    }
    const host = String(parsed.hostname || "").toLowerCase();
    if (parsed.protocol !== "https:" || (host !== "janitorai.com" && host !== "www.janitorai.com")) {
      return { valid: false, characterId: null, normalizedUrl: null };
    }
    const match = String(parsed.pathname || "").match(
      /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?characters\/([a-f0-9-]{36})(?:[_/].*)?\/?$/i,
    );
    const characterId = match ? normalizeUuid(match[1]) : null;
    return {
      valid: !!characterId,
      characterId,
      normalizedUrl: characterId ? `https://janitorai.com/characters/${characterId}` : null,
    };
  }

  function parseJanitorCreatorUrl(rawUrl) {
    const raw = String(rawUrl || "").trim();
    if (!raw) return { valid: false, creatorId: null, normalizedUrl: null };
    let parsed = null;
    try {
      parsed = new URL(raw);
    } catch (_) {
      return { valid: false, creatorId: null, normalizedUrl: null };
    }
    const host = String(parsed.hostname || "").toLowerCase();
    if (parsed.protocol !== "https:" || (host !== "janitorai.com" && host !== "www.janitorai.com")) {
      return { valid: false, creatorId: null, normalizedUrl: null };
    }
    const match = String(parsed.pathname || "").match(
      /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?profiles\/([a-f0-9-]{36})(?:[_/].*)?\/?$/i,
    );
    const creatorId = match ? normalizeUuid(match[1]) : null;
    return {
      valid: !!creatorId,
      creatorId,
      normalizedUrl: creatorId ? `https://janitorai.com/profiles/${creatorId}` : null,
    };
  }

  function parseJannyCharacterUrl(rawUrl) {
    const raw = String(rawUrl || "").trim();
    if (!raw) return { valid: false, characterId: null, normalizedUrl: null };
    let parsed = null;
    try {
      parsed = new URL(raw, JANNY_BASE);
    } catch (_) {
      return { valid: false, characterId: null, normalizedUrl: null };
    }
    const host = String(parsed.hostname || "").toLowerCase();
    if (parsed.protocol !== "https:" || (host !== "jannyai.com" && host !== "www.jannyai.com")) {
      return { valid: false, characterId: null, normalizedUrl: null };
    }
    const match = String(parsed.pathname || "").match(
      /^\/characters\/([a-f0-9-]{36})(?:[_/].*)?\/?$/i,
    );
    const characterId = match ? normalizeUuid(match[1]) : null;
    return {
      valid: !!characterId,
      characterId,
      normalizedUrl: characterId ? `${JANNY_BASE}/characters/${characterId}` : null,
    };
  }

  function parseSaucepanCompanionUrl(rawUrl) {
    const raw = String(rawUrl || "").trim();
    if (!raw) return { valid: false, companionId: null, characterId: null, normalizedUrl: null };
    let parsed = null;
    try {
      parsed = new URL(raw, SAUCEPAN_BASE);
    } catch (_) {
      return { valid: false, companionId: null, characterId: null, normalizedUrl: null };
    }
    const host = String(parsed.hostname || "").toLowerCase();
    if (parsed.protocol !== "https:" || (host !== "saucepan.ai" && host !== "www.saucepan.ai")) {
      return { valid: false, companionId: null, characterId: null, normalizedUrl: null };
    }
    const match = String(parsed.pathname || "").match(/^\/companion\/([a-f0-9-]{36})(?:[_/].*)?\/?$/i);
    const companionId = match ? normalizeUuid(match[1]) : null;
    return {
      valid: !!companionId,
      companionId,
      characterId: companionId,
      normalizedUrl: companionId ? `${SAUCEPAN_BASE}/companion/${companionId}` : null,
    };
  }

  function parseSaucepanCreatorUrl(rawUrl) {
    const raw = String(rawUrl || "").trim();
    if (!raw) return { valid: false, handle: null, normalizedUrl: null };
    let parsed = null;
    if (!/^https?:\/\//i.test(raw) && !raw.startsWith("/u/")) {
      const handle = raw.replace(/^@+/, "").trim();
      return { valid: !!handle, handle: handle || null, normalizedUrl: handle ? `${SAUCEPAN_BASE}/u/${encodeURIComponent(handle)}` : null };
    }
    try {
      parsed = new URL(raw, SAUCEPAN_BASE);
    } catch (_) {
      return { valid: false, handle: null, normalizedUrl: null };
    }
    const host = String(parsed.hostname || "").toLowerCase();
    if (parsed.protocol !== "https:" || (host !== "saucepan.ai" && host !== "www.saucepan.ai")) {
      return { valid: false, handle: null, normalizedUrl: null };
    }
    const match = String(parsed.pathname || "").match(/^\/u\/([^/?#]+)/i);
    const handle = match && match[1] ? decodeURIComponent(match[1]).replace(/^@+/, "").trim() : null;
    return {
      valid: !!handle,
      handle,
      normalizedUrl: handle ? `${SAUCEPAN_BASE}/u/${encodeURIComponent(handle)}` : null,
    };
  }

  function parseIntSafe(value, fallback) {
    if (value == null || value === "") return fallback;
    const n = Number.parseInt(String(value), 10);
    return Number.isFinite(n) ? n : fallback;
  }

  function decodeHtmlEntities(input) {
    if (input == null) return "";
    const named = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: "\"",
      apos: "'",
      nbsp: " ",
    };
    return String(input).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, token) => {
      const lower = String(token || "").toLowerCase();
      if (Object.prototype.hasOwnProperty.call(named, lower)) return named[lower];
      if (lower.startsWith("#x")) {
        const code = Number.parseInt(lower.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : full;
      }
      if (lower.startsWith("#")) {
        const code = Number.parseInt(lower.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : full;
      }
      return full;
    });
  }

  function decodeAstroValue(value) {
    if (Array.isArray(value)) {
      if (value.length === 2 && Number.isInteger(value[0])) {
        const type = value[0];
        const payload = value[1];
        if (type === 0) return decodeAstroValue(payload);
        if (type === 1) {
          if (!Array.isArray(payload)) return [];
          return payload.map((item) => decodeAstroValue(item));
        }
        return decodeAstroValue(payload);
      }
      return value.map((item) => decodeAstroValue(item));
    }
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, item] of Object.entries(value)) out[key] = decodeAstroValue(item);
      return out;
    }
    return value;
  }

  function stripTags(input) {
    if (input == null) return "";
    return decodeHtmlEntities(
      String(input)
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  function stripTagsPreservingBreaks(input) {
    if (input == null) return "";
    return decodeHtmlEntities(
      String(input)
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/[ \t\r\f\v]+/g, " ")
        .replace(/\n[ \t]+/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    );
  }

  function parseCompactNumber(value) {
    const text = String(value == null ? "" : value).trim().toLowerCase().replace(/,/g, "");
    if (!text) return null;
    const match = text.match(/^([0-9]+(?:\.[0-9]+)?)([km])?$/i);
    if (!match) return parseIntSafe(text, null);
    const n = Number.parseFloat(match[1]);
    if (!Number.isFinite(n)) return null;
    const suffix = match[2] || "";
    const multiplier = suffix === "m" ? 1000000 : suffix === "k" ? 1000 : 1;
    return Math.round(n * multiplier);
  }

  function parseTimestamp(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function normalizeJannyAvatarUrl(value) {
    if (!value) return null;
    const v = String(value).trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    if (v.startsWith("/")) return new URL(v, JANNY_BASE).toString();
    return `${JANNY_IMAGE_BASE}/bot-avatars/${encodeURI(v)}`;
  }

  function normalizeJanitorAssetUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("/bot-avatars/") || raw.startsWith("/avatars/")) {
      return `https://ella.janitorai.com${raw}`;
    }
    if (!raw.includes("/")) {
      return `https://ella.janitorai.com/bot-avatars/${encodeURIComponent(raw)}`;
    }
    try {
      return new URL(raw, "https://janitorai.com").href;
    } catch (_) {
      return raw;
    }
  }

  function isJanitorCreatorAvatarUrl(value) {
    return /janitorai\.com\/avatars\//i.test(String(value || ""));
  }

  function isJanitorBotAvatarUrl(value) {
    return /janitorai\.com\/bot-avatars\//i.test(String(value || ""));
  }

  function pickJanitorCreatorAvatarUrl(profile, sourceHtml, ogImage) {
    const root = profile && typeof profile === "object" ? profile : {};
    const directCandidates = [
      root.profileImageAssetUrl,
      root.profile_image_asset_url,
      root.profileImageUrl,
      root.profile_image_url,
      root.avatarUrl,
      root.avatar_url,
      root.profileImage,
      root.profile_image,
      root.imageUrl,
      root.image_url,
      root.userAvatar,
      root.user_avatar,
      root.avatar,
      ogImage,
    ]
      .map(normalizeJanitorAssetUrl)
      .filter(Boolean);
    const htmlAvatarCandidates = Array.from(
      String(sourceHtml || "").matchAll(/https:\/\/[^"'<>\s)]+\/avatars\/[^"'<>\s)]+/gi),
    )
      .map((match) => normalizeJanitorAssetUrl(decodeHtmlEntities(match[0])))
      .filter(Boolean);
    const candidates = [...directCandidates, ...htmlAvatarCandidates];
    return (
      candidates.find(isJanitorCreatorAvatarUrl) ||
      candidates.find((candidate) => !isJanitorBotAvatarUrl(candidate)) ||
      candidates[0] ||
      null
    );
  }

  function normalizeSaucepanImageRef(value) {
    const raw = value && typeof value === "object" ? value : {};
    if (typeof value === "string") {
      const id = value.trim();
      if (!id) return null;
      if (/^https?:\/\//i.test(id)) {
        return { id: null, cardUrl: id, highresUrl: id, thumbnailUrl: id, raw: id };
      }
      return {
        id,
        cardUrl: `${SAUCEPAN_CDN_BASE}/${encodeURIComponent(id)}/card`,
        highresUrl: `${SAUCEPAN_CDN_BASE}/${encodeURIComponent(id)}/highres`,
        thumbnailUrl: `${SAUCEPAN_CDN_BASE}/${encodeURIComponent(id)}/thumbnail`,
        raw: id,
      };
    }
    const id = String(raw.id || raw.image_id || raw.imageId || "").trim();
    if (id) {
      return {
        id,
        cardUrl: raw.card_url || raw.cardUrl || `${SAUCEPAN_CDN_BASE}/${encodeURIComponent(id)}/card`,
        highresUrl: raw.highres_url || raw.highresUrl || `${SAUCEPAN_CDN_BASE}/${encodeURIComponent(id)}/highres`,
        thumbnailUrl: raw.thumbnail_url || raw.thumbnailUrl || `${SAUCEPAN_CDN_BASE}/${encodeURIComponent(id)}/thumbnail`,
        raw: value,
      };
    }
    const direct = firstPresent([raw.highres_url, raw.highresUrl, raw.card_url, raw.cardUrl, raw.thumbnail_url, raw.thumbnailUrl, raw.url]);
    if (direct) return { id: null, cardUrl: direct, highresUrl: direct, thumbnailUrl: direct, raw: value };
    return null;
  }

  function getSaucepanImageAssetUrl(value) {
    const ref = normalizeSaucepanImageRef(value);
    return ref ? firstPresent([ref.highresUrl, ref.cardUrl, ref.thumbnailUrl]) : null;
  }

  function rotateLeft32(value, bits) {
    return ((value << bits) | (value >>> (32 - bits))) >>> 0;
  }

  function getUtf8Bytes(value) {
    const text = String(value || "");
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
    const encoded = unescape(encodeURIComponent(text));
    const bytes = new Array(encoded.length);
    for (let i = 0; i < encoded.length; i += 1) bytes[i] = encoded.charCodeAt(i);
    return bytes;
  }

  function computeSaucepanFragmentProof(mask, order, text) {
    const bytes = getUtf8Bytes(text);
    let hash = (2166136261 ^ rotateLeft32(mask, 7) ^ rotateLeft32(order, 13)) >>> 0;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function decodeSaucepanFragmentContent(content) {
    if (!content || typeof content !== "object" || Array.isArray(content) || !Array.isArray(content.fragments)) return null;
    const mask = Number(content.mask);
    if (!Number.isFinite(mask)) return null;
    const normalizedMask = mask >>> 0;
    const validFragments = content.fragments
      .filter((fragment) => fragment && typeof fragment === "object" && !Array.isArray(fragment))
      .map((fragment) => {
        const key = Number(fragment.key);
        const proof = Number(fragment.proof);
        const text = typeof fragment.text === "string" ? fragment.text : null;
        if (!Number.isFinite(key) || !Number.isFinite(proof) || text === null) return null;
        const order = (key ^ normalizedMask) >>> 0;
        if (computeSaucepanFragmentProof(normalizedMask, order, text) !== (proof >>> 0)) return null;
        return { order, text };
      })
      .filter(Boolean)
      .sort((a, b) => a.order - b.order);
    if (!validFragments.length) return null;
    return compactText(validFragments.map((fragment) => fragment.text).join(""), 500000);
  }

  function compactSaucepanScenarioText(value) {
    const decoded = decodeSaucepanFragmentContent(value);
    const candidate = typeof decoded === "string"
      ? decoded
      : typeof value === "string"
        ? value
        : null;
    if (!candidate) return null;
    const text = compactText(candidate, 500000);
    if (!text || /\[object(?:\s+|\s*\/\s*)object\]/i.test(text)) return null;
    return text;
  }

  function firstSaucepanScenarioText(values) {
    for (const value of Array.isArray(values) ? values : []) {
      const text = compactSaucepanScenarioText(value);
      if (text) return text;
    }
    return null;
  }

  function isSaucepanStaleDefinitionCard(value) {
    return SAUCEPAN_STALE_DEFINITION_CARD_PATTERN.test(String(value || ""));
  }

  function getSaucepanDefinitionFieldForTitle(title) {
    const normalized = String(title || "").trim().toLowerCase();
    if (!normalized) return null;
    if (/companion\s+core|character\s+core|\bcore\b|\bcard\b|\bdefinition\b/.test(normalized)) return "card";
    if (/example|dialogue|dialog/.test(normalized)) return "example_dialogue";
    if (/formatting|format|response\s+instruction/.test(normalized)) return "formatting_instructions";
    if (/advanced|system\s+prompt|prompt/.test(normalized)) return "advanced_prompt";
    return null;
  }

  function appendSaucepanDefinitionField(fields, key, text) {
    if (!SAUCEPAN_DEFINITION_FIELDS.includes(key)) return;
    const normalizedText = compactText(text, 500000);
    if (!normalizedText) return;
    fields[key] = fields[key] ? `${fields[key]}\n\n${normalizedText}` : normalizedText;
  }

  function decodeSaucepanDefinitionSections(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.sections)) {
      return { fields: {}, decodedSections: [] };
    }
    const fields = {};
    const decodedSections = [];
    payload.sections.forEach((section) => {
      if (!section || typeof section !== "object" || Array.isArray(section)) return;
      const title = compactText(section.title, 1000) || "Definition";
      const decodedText = decodeSaucepanFragmentContent(section.content) || compactText(section.content, 500000);
      if (!decodedText) return;
      const key = getSaucepanDefinitionFieldForTitle(title);
      if (key) appendSaucepanDefinitionField(fields, key, decodedText);
      decodedSections.push({ title, field: key, text: decodedText });
    });
    return { fields, decodedSections };
  }

  function normalizeSaucepanOpenDefinitionPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const normalized = { ...payload };
    const { fields, decodedSections } = decodeSaucepanDefinitionSections(payload);
    SAUCEPAN_DEFINITION_FIELDS.forEach((field) => {
      if (isSaucepanStaleDefinitionCard(normalized[field])) delete normalized[field];
      if (fields[field]) normalized[field] = fields[field];
    });
    if (decodedSections.length) {
      normalized.decoded_sections = decodedSections;
      normalized.section_decode = {
        format: "saucepan_fragments_v1",
        decoded_section_count: decodedSections.length,
        decoded_fields: Object.keys(fields).sort(),
      };
    }
    if (isSaucepanStaleDefinitionCard(payload.card)) {
      normalized.legacy_card_invalid_reason = "saucepan_stale_tab_sentinel";
    }
    return normalized;
  }

  function decodeSaucepanPublicFullDescription(record) {
    const root = record && typeof record === "object" ? record : {};
    return compactText(
      firstPresent([
        root.full_description,
        root.fullDescription,
        decodeSaucepanFragmentContent(root.full_description_fragments || root.fullDescriptionFragments),
      ]),
      500000,
    );
  }

  function decodeSaucepanStartingScenarioFragments(value) {
    const scenarios = Array.isArray(value) ? value : [];
    return scenarios
      .map((scenario, index) => {
        if (!scenario || typeof scenario !== "object") return null;
        const title = compactText(firstPresent([scenario.title, scenario.name, scenario.label]), 4000) || `Scenario ${index + 1}`;
        const message = compactText(
          firstPresent([
            decodeSaucepanFragmentContent(scenario.message),
            scenario.message,
            scenario.first_message,
            scenario.firstMessage,
            scenario.text,
            scenario.combined,
          ]),
          500000,
        );
        if (!message) return null;
        return {
          index,
          id: scenario.id || scenario.scenario_id || scenario.scenarioId || null,
          title,
          message,
        };
      })
      .filter(Boolean);
  }

  function slugForFileName(value, fallback) {
    const text = String(value || fallback || "asset")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return text || "asset";
  }

  function buildRawDescriptionHtmlFile(prefix, id, html) {
    const rawHtml = compactText(html, 500000);
    if (!rawHtml) return null;
    return {
      fileName: `${slugForFileName(prefix, "description")}-${slugForFileName(id, "unknown")}-description.html`,
      mimeType: "text/html",
      html: rawHtml,
    };
  }

  function pickRawDescriptionHtml(value) {
    const root = value && typeof value === "object" ? value : {};
    return firstPresent([
      root.rawDescriptionHtml,
      root.descriptionRawHtml,
      root.raw_description_html,
      root.descriptionHtml,
      root.description_html,
      root.aboutMeHtml,
      root.about_me,
      root.description,
    ]);
  }

  function extractCharacterIdFromJannyPath(value) {
    const parsed = parseJannyCharacterUrl(value);
    if (parsed.valid) return parsed.characterId;
    return normalizeUuid(value);
  }

  function classifySourceInterruptionHtml(text) {
    const html = String(text || "");
    const lower = html.toLowerCase();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? decodeHtmlEntities(titleMatch[1]).trim().toLowerCase() : "";
    const signals = [];
    let score = 0;
    const add = (name, value) => {
      if (!value) return;
      signals.push(name);
      score += value;
    };
    add("title_wait", title.includes("just a moment") ? 4 : 0);
    add("title_action", /verify|checking|security/.test(title) && /human|browser|connection|site/.test(title) ? 3 : 0);
    add("platform_asset", lower.includes("/cdn-cgi/challenge-platform") ? 2 : 0);
    add("page_state_marker", lower.includes("__cf_chl") ? 3 : 0);
    add("provider_reference", lower.includes("cloudflare") && lower.includes("ray id") ? 3 : 0);
    add("browser_check", lower.includes("checking your browser") || lower.includes("checking if the site connection is secure") ? 3 : 0);
    add("human_check", lower.includes("verify you are human") || lower.includes("verify that you are human") ? 3 : 0);
    add("gate_form", /<form[^>]+(?:challenge-platform|cdn-cgi)/i.test(html) ? 4 : 0);
    add("gate_frame", /<iframe[^>]+(?:challenge-platform|challenges\.cloudflare\.com)/i.test(html) ? 2 : 0);
    return {
      blocked: score >= 4,
      score,
      signals,
    };
  }

  function isJannyCharacterNotFoundHtml(text) {
    const html = String(text || "");
    const lower = decodeHtmlEntities(html)
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (!lower) return false;
    return (
      lower.includes("oops! page not found") ||
      lower.includes("oops page not found") ||
      lower.includes("the page or character you are looking for does not exist") ||
      lower.includes("we will update missing characters after a while")
    );
  }

  function hasSourceInterruptionHtml(text) {
    return classifySourceInterruptionHtml(text).blocked;
  }

  function extractJannyCharacterButtonsProps(html) {
    const text = String(html || "");
    const match =
      text.match(/<astro-island[^>]*component-export=["']CharacterButtons["'][^>]*props="([^"]*)"[^>]*>/i) ||
      text.match(/<astro-island[^>]*props='([^']*)'[^>]*component-export=["']CharacterButtons["'][^>]*>/i);
    if (!match) return null;
    try {
      const propsRaw = decodeHtmlEntities(match[1]);
      return decodeAstroValue(JSON.parse(propsRaw));
    } catch (_) {
      return null;
    }
  }

  function extractLdJson(html) {
    const scripts = [];
    const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match = null;
    while ((match = re.exec(String(html || ""))) !== null) {
      const raw = String(match[1] || "").trim();
      if (!raw) continue;
      try {
        scripts.push(JSON.parse(raw));
      } catch (_) {}
    }
    return scripts;
  }

  function parseJannyCharacterHtml(html, fallbackCharacterUrl) {
    const source = String(html || "");
    const props = extractJannyCharacterButtonsProps(source);
    const character = props && props.character ? props.character : {};
    const stats = character && character.stats ? character.stats : {};
    const canonicalUrl =
      (source.match(/<link rel=["']canonical["'] href=["']([^"']+)["']/i) || [null, null])[1] ||
      fallbackCharacterUrl ||
      null;
    const characterId =
      normalizeUuid(character && character.id ? String(character.id) : null) ||
      extractCharacterIdFromJannyPath(canonicalUrl || fallbackCharacterUrl || "");
    const creatorUrlRaw = (source.match(/href=["']((?:https:\/\/jannyai\.com)?\/creators\/[^"']+)["']/i) || [null, null])[1];
    const creatorUrl = creatorUrlRaw ? new URL(creatorUrlRaw, JANNY_BASE).toString() : null;
    const renderedCreatorId = creatorUrl ? normalizeUuid(creatorUrl) : null;
    const creatorNameFromHtml = (
      source.match(/Creator:\s*<a[^>]*>\s*@?([^<\s]+)/i) ||
      source.match(/<a[^>]+href=["'](?:https:\/\/jannyai\.com)?\/creators\/[^"']+["'][^>]*>\s*@?([^<]+?)\s*<\/a>/i) ||
      [null, null]
    )[1];
    const h1Name = stripTags((source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [null, ""])[1]);
    const ogImage = (source.match(/property=["']og:image["'] content=["']([^"']+)["']/i) || [null, null])[1];
    const renderedAvatar = (
      source.match(/<img[^>]+src=["']([^"']+)["'][^>]+alt=["']Avatar of [^"']+["'][^>]*>/i) ||
      source.match(/<img[^>]+alt=["']Avatar of [^"']+["'][^>]+src=["']([^"']+)["'][^>]*>/i) ||
      [null, null]
    )[1];
    const avatarUrl = normalizeJannyAvatarUrl(props && props.imageUrl ? props.imageUrl : character.avatar || ogImage || renderedAvatar);
    const markdownMatch = source.match(/<div[^>]+class=["'][^"']*\bmarkdown\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<div>\s*<ul/i);
    const renderedDescriptionText = markdownMatch ? stripTagsPreservingBreaks(markdownMatch[1]) : null;
    const renderedTags = [];
    const tagRe = /<a[^>]+href=["'][^"']*tag_id=[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi;
    let tagMatch = null;
    while ((tagMatch = tagRe.exec(source)) !== null) {
      const tag = stripTags(tagMatch[1]).replace(/^[^A-Za-z0-9]+/, "").trim();
      if (tag) renderedTags.push(tag);
    }
    const renderedIsNsfw = />\s*[^<]*NSFW\s*</i.test(source) ? true : null;
    const chatCountRendered = parseCompactNumber((source.match(/>\s*(?:\u{1f5e3}\ufe0f?|&#x1f5e3;|&#128483;)?\s*([0-9][0-9.,]*[km]?)\s*<\/[^>]+>\s*<[^>]+>\s*(?:\u{1f4ac}|&#x1f4ac;|&#128172;)/iu) || [null, null])[1]);
    const messageCountRendered = parseCompactNumber((source.match(/>\s*(?:\u{1f4ac}|&#x1f4ac;|&#128172;)?\s*([0-9][0-9.,]*[km]?)\s*<\/[^>]+>/iu) || [null, null])[1]);
    const ldJsonList = extractLdJson(source);
    const ldPrimary = ldJsonList.find((item) => item && item["@type"] === "NewsArticle") || ldJsonList[0] || null;
    const renderedHasDetail = !!(!props && characterId && h1Name && renderedDescriptionText);

    return {
      hasDetail: !!props || renderedHasDetail,
      characterId: characterId || null,
      canonicalUrl: canonicalUrl || null,
      characterUrl: fallbackCharacterUrl || canonicalUrl || null,
      name: character && character.name ? String(character.name) : h1Name || null,
      creatorId: normalizeUuid(character && character.creatorId ? String(character.creatorId) : null) || renderedCreatorId,
      creatorName: (character && character.creatorName) || creatorNameFromHtml || null,
      creatorUrl,
      avatarUrl,
      isNsfw: typeof character.isNsfw === "boolean" ? character.isNsfw : renderedIsNsfw,
      isLowQuality: typeof character.isLowQuality === "boolean" ? character.isLowQuality : null,
      permanentToken: parseIntSafe(character.permanentToken, null),
      totalToken: character && character.totalToken != null ? parseIntSafe(character.totalToken, null) : null,
      chatCount: parseIntSafe(stats.chatCount, chatCountRendered),
      messageCount: parseIntSafe(stats.messageCount, messageCountRendered),
      viewCount: parseIntSafe(stats.viewCount, null),
      downloadCount: parseIntSafe(stats.downloadCount, null),
      bookmarkCount: parseIntSafe(stats.bookmarkCount, null),
      descriptionText: character && character.description ? String(character.description) : renderedDescriptionText,
      personalityText: character && character.personality ? String(character.personality) : null,
      scenarioText: character && character.scenario ? String(character.scenario) : null,
      firstMessageText: character && character.firstMessage ? String(character.firstMessage) : null,
      exampleDialogsText: character && character.exampleDialogs ? String(character.exampleDialogs) : null,
      tags: Array.isArray(character.tags) ? character.tags : renderedTags.length ? renderedTags.slice(0, 40) : null,
      tagIds: Array.isArray(character.tagIds) ? character.tagIds : null,
      createdAtSource: parseTimestamp(character.createdAt || (ldPrimary && ldPrimary.datePublished)),
      stats: stats && typeof stats === "object" ? stats : null,
      rawCharacterProps: character && Object.keys(character).length ? character : null,
      rawLdJson: ldPrimary,
    };
  }

  function extractJsonParseStringArg(input, marker) {
    const html = String(input || "");
    const start = html.indexOf(marker);
    if (start < 0) return null;
    let i = start + marker.length;
    const buf = [];
    while (i < html.length) {
      const ch = html[i];
      if (ch === "\\") {
        if (i + 1 < html.length) {
          buf.push(ch, html[i + 1]);
          i += 2;
          continue;
        }
      }
      if (ch === '"') break;
      buf.push(ch);
      i += 1;
    }
    return buf.length ? buf.join("") : null;
  }

  function decodeJsString(raw) {
    try {
      return JSON.parse(`"${raw}"`);
    } catch (_) {
      return null;
    }
  }

  function findFirstJanitorCreatorProfileObject(obj, creatorId) {
    if (!obj || typeof obj !== "object") return null;
    const wantId = creatorId ? String(creatorId).toLowerCase() : null;
    const stack = [obj];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== "object") continue;
      if (seen.has(cur)) continue;
      seen.add(cur);
      if (Array.isArray(cur)) {
        for (const item of cur) stack.push(item);
        continue;
      }
      if (cur.profile && typeof cur.profile === "object") {
        const profile = cur.profile;
        const id = typeof profile.id === "string" ? profile.id.toLowerCase() : null;
        const userName = typeof profile.user_name === "string" ? profile.user_name.trim() : "";
        if (userName && (!wantId || id === wantId)) return profile;
      }
      const id = typeof cur.id === "string" ? cur.id.toLowerCase() : null;
      const userName = typeof cur.user_name === "string" ? cur.user_name.trim() : "";
      const aboutText = typeof cur.about_me === "string" ? stripTags(cur.about_me) : "";
      if (userName && (aboutText || cur.avatar || cur.is_verified != null || cur.style || cur.followers_count != null)) {
        if (!wantId || id === wantId) return cur;
      }
      for (const item of Object.values(cur)) stack.push(item);
    }
    return null;
  }

  function parseNextDataFromHtml(html) {
    const match = String(html || "").match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    const text = match && match[1] ? match[1].trim() : "";
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  function parseJanitorCreatorProfileHtml(html, fallbackCreatorUrl, fallbackCreatorId) {
    const source = String(html || "");
    const parsedUrl = parseJanitorCreatorUrl(fallbackCreatorUrl || "");
    const creatorId = normalizeUuid(fallbackCreatorId) || parsedUrl.creatorId;
    const candidates = [];
    const marker = 'window.mbxM.push(JSON.parse("';
    let cursor = 0;
    while (cursor < source.length) {
      const idx = source.indexOf(marker, cursor);
      if (idx < 0) break;
      const raw = extractJsonParseStringArg(source.slice(idx), marker);
      if (raw) {
        const decoded = decodeJsString(raw);
        if (decoded) {
          try {
            const parsed = JSON.parse(decoded);
            const profile = findFirstJanitorCreatorProfileObject(parsed, creatorId);
            if (profile) candidates.push({ source: "mbxM", profile });
          } catch (_) {}
        }
      }
      cursor = idx + marker.length;
    }
    const nextData = parseNextDataFromHtml(source);
    if (nextData) {
      const profile = findFirstJanitorCreatorProfileObject(nextData, creatorId);
      if (profile) candidates.push({ source: "next_data", profile });
    }
    const picked = candidates[0] || null;
    const profile = picked ? picked.profile : {};
    const ogTitle = (source.match(/property=["']og:title["'] content=["']([^"']+)["']/i) || [null, null])[1];
    const ogDescription = (source.match(/property=["']og:description["'] content=["']([^"']+)["']/i) || [null, null])[1];
    const ogImage = (source.match(/property=["']og:image["'] content=["']([^"']+)["']/i) || [null, null])[1];
    const rawAbout = typeof profile.about_me === "string" ? profile.about_me : null;
    const userName =
      profile.user_name ||
      (ogTitle ? String(ogTitle).replace(/\s*-\s*janitor.*$/i, "").trim() : null) ||
      null;
    const profileImageAssetUrl = pickJanitorCreatorAvatarUrl(profile, source, ogImage);
    return {
      hasProfile: !!picked,
      source: picked ? picked.source : null,
      creatorId: normalizeUuid(profile.id || creatorId),
      profileUrl: parsedUrl.normalizedUrl || fallbackCreatorUrl || null,
      userName: userName || null,
      displayName: profile.name || profile.display_name || userName || null,
      avatarUrl: profileImageAssetUrl,
      profileImageAssetUrl,
      aboutMeHtml: rawAbout,
      rawDescriptionHtml: rawAbout,
      aboutMeText: rawAbout ? stripTags(rawAbout) : ogDescription ? stripTags(ogDescription) : null,
      followersCount: parseIntSafe(profile.followers_count || profile.follower_count, null),
      isVerified: typeof profile.is_verified === "boolean" ? profile.is_verified : null,
      badges: Array.isArray(profile.badges) ? profile.badges.slice(0, 40) : null,
      style: profile.style && typeof profile.style === "object" ? profile.style : null,
    };
  }

  function compactJanitorCreatorCharacter(char) {
    const stats = char && typeof char.stats === "object" ? char.stats : {};
    const profileImageAssetUrl = normalizeJanitorAssetUrl(
      firstPresent([
        char && char.profileImageAssetUrl,
        char && char.avatarUrl,
        char && char.avatar_url,
        char && char.avatar,
      ]),
    );
    const compacted = sanitizeForTransport({
      id: normalizeUuid(char && char.id),
      name: char && char.name ? String(char.name) : null,
      creatorId: normalizeUuid(char && (char.creator_id || char.creatorId)),
      creatorName: char && (char.creator_name || char.creatorName) ? String(char.creator_name || char.creatorName) : null,
      slug: firstPresent([
        char && char.slug,
        char && char.public_slug,
        char && char.slugified_name,
        char && char.slugifiedName,
      ]),
      url: firstPresent([
        char && char.url,
        char && char.characterUrl,
        char && char.character_url,
        char && char.profileUrl,
        char && char.profile_url,
        char && char.sourceUrl,
        char && char.source_url,
        char && char.path,
      ]),
      avatar: profileImageAssetUrl,
      profileImageAssetUrl,
      description: compactText(char && char.description, 1000),
      isNsfw: char && (char.is_nsfw ?? char.isNsfw),
      isPublic: char && (char.is_public ?? char.isPublic),
      totalTokens: parseIntSafe(char && (char.total_tokens || char.totalToken || char.total_tokens_count), null),
      stats: {
        chatCount: parseIntSafe(stats.chat ?? stats.chatCount, null),
        messageCount: parseIntSafe(stats.message ?? stats.messageCount, null),
      },
      tags: normalizeTags(char && char.tags),
      createdAt: parseTimestamp(char && char.created_at),
      firstPublishedAt: parseTimestamp(char && char.first_published_at),
    });
    return compacted;
  }

  function compactJanitorCreatorCapture(creator) {
    const root = creator && typeof creator === "object" ? creator : {};
    const profile = root.profile && typeof root.profile === "object" ? root.profile : null;
    const characterList = root.characterList && typeof root.characterList === "object" ? root.characterList : null;
    const profileImageAssetUrl = normalizeJanitorAssetUrl(
      firstPresent([profile && profile.profileImageAssetUrl, profile && profile.avatarUrl, profile && profile.avatar]),
    );
    const rawDescriptionHtml = profile ? pickRawDescriptionHtml(profile) : null;
    return sanitizeForTransport({
      success: root.success === true,
      skipped: root.skipped === true,
      reason: root.reason || null,
      freshness: root.freshness || null,
      source: root.source || "janitor_creator_extension",
      capturedAt: root.capturedAt || null,
      creatorId: root.creatorId || (profile && profile.creatorId) || null,
      profileUrl: root.profileUrl || (profile && profile.profileUrl) || null,
      profileStatus: root.profileStatus || null,
      profileFinalUrl: root.profileFinalUrl || null,
      profile: profile
        ? {
            hasProfile: profile.hasProfile === true,
            source: profile.source || null,
            creatorId: profile.creatorId || null,
            profileUrl: profile.profileUrl || null,
            userName: profile.userName || null,
            displayName: profile.displayName || null,
            avatarUrl: profileImageAssetUrl,
            profileImageAssetUrl,
            aboutMeHtml: compactText(profile.aboutMeHtml, 12000),
            rawDescriptionHtml: compactText(rawDescriptionHtml, 500000),
            descriptionHtmlFile: buildRawDescriptionHtmlFile("janitor-creator", profile.creatorId || root.creatorId, rawDescriptionHtml),
            aboutMeText: compactText(profile.aboutMeText, 8000),
            followersCount: profile.followersCount ?? null,
            isVerified: profile.isVerified ?? null,
            badges: Array.isArray(profile.badges) ? profile.badges.slice(0, 40) : null,
          }
        : null,
      characterList: characterList
        ? {
            success: characterList.success === true,
            sort: characterList.sort || null,
            total: parseIntSafe(characterList.total, null),
            pagesFetched: parseIntSafe(characterList.pagesFetched, 0),
            pageSize: parseIntSafe(characterList.pageSize, null),
            truncated: characterList.truncated === true,
            error: characterList.error || null,
            characters: Array.isArray(characterList.characters)
              ? characterList.characters.slice(0, 500).map(compactJanitorCreatorCharacter)
              : [],
          }
        : null,
    });
  }

  function skipLorebookJsWhitespace(text, state) {
    while (state.index < text.length) {
      const ch = text[state.index];
      const next = text[state.index + 1];
      if (/\s/.test(ch)) {
        state.index += 1;
        continue;
      }
      if (ch === "/" && next === "/") {
        state.index += 2;
        while (state.index < text.length && !/[\r\n]/.test(text[state.index])) state.index += 1;
        continue;
      }
      if (ch === "/" && next === "*") {
        state.index += 2;
        while (state.index + 1 < text.length && !(text[state.index] === "*" && text[state.index + 1] === "/")) state.index += 1;
        state.index = Math.min(text.length, state.index + 2);
        continue;
      }
      break;
    }
  }

  function parseLorebookJsStringLiteral(text, state) {
    const quote = text[state.index];
    let value = "";
    state.index += 1;
    while (state.index < text.length) {
      const ch = text[state.index];
      if (ch === quote) {
        state.index += 1;
        return value;
      }
      if (quote === "`" && ch === "$" && text[state.index + 1] === "{") {
        throw new Error("Template interpolation is not supported in lorebook source.");
      }
      if (ch !== "\\") {
        value += ch;
        state.index += 1;
        continue;
      }
      state.index += 1;
      if (state.index >= text.length) break;
      const esc = text[state.index];
      state.index += 1;
      if (esc === "\n" || esc === "\r") {
        if (esc === "\r" && text[state.index] === "\n") state.index += 1;
        continue;
      }
      if (esc === "n") value += "\n";
      else if (esc === "r") value += "\r";
      else if (esc === "t") value += "\t";
      else if (esc === "b") value += "\b";
      else if (esc === "f") value += "\f";
      else if (esc === "v") value += "\v";
      else if (esc === "0") value += "\0";
      else if (esc === "x") {
        const hex = text.slice(state.index, state.index + 2);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new Error("Invalid hex escape in lorebook source.");
        value += String.fromCharCode(parseInt(hex, 16));
        state.index += 2;
      } else if (esc === "u") {
        if (text[state.index] === "{") {
          const end = text.indexOf("}", state.index + 1);
          if (end === -1) throw new Error("Invalid unicode escape in lorebook source.");
          const hex = text.slice(state.index + 1, end);
          if (!/^[0-9a-fA-F]+$/.test(hex)) throw new Error("Invalid unicode escape in lorebook source.");
          value += String.fromCodePoint(parseInt(hex, 16));
          state.index = end + 1;
        } else {
          const hex = text.slice(state.index, state.index + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error("Invalid unicode escape in lorebook source.");
          value += String.fromCharCode(parseInt(hex, 16));
          state.index += 4;
        }
      } else {
        value += esc;
      }
    }
    throw new Error("Unterminated string in lorebook source.");
  }

  function parseLorebookJsIdentifier(text, state) {
    skipLorebookJsWhitespace(text, state);
    const match = text.slice(state.index).match(/^[$A-Z_a-z][$\w]*/);
    if (!match) return "";
    state.index += match[0].length;
    return match[0];
  }

  function parseLorebookJsNumber(text, state) {
    const match = text.slice(state.index).match(/^-?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/);
    if (!match) throw new Error("Invalid number in lorebook source.");
    state.index += match[0].length;
    const raw = match[0];
    return /^-?0[xX]/.test(raw) ? Number.parseInt(raw, 16) : Number(raw);
  }

  function parseLorebookJsArrayLiteral(text, state) {
    const values = [];
    state.index += 1;
    skipLorebookJsWhitespace(text, state);
    while (state.index < text.length && text[state.index] !== "]") {
      if (text[state.index] === ",") {
        values.push(null);
        state.index += 1;
        skipLorebookJsWhitespace(text, state);
        continue;
      }
      values.push(parseLorebookJsLiteralValue(text, state));
      skipLorebookJsWhitespace(text, state);
      if (text[state.index] === ",") {
        state.index += 1;
        skipLorebookJsWhitespace(text, state);
        continue;
      }
      if (text[state.index] !== "]") throw new Error("Expected comma in lorebook array.");
    }
    if (text[state.index] !== "]") throw new Error("Unterminated lorebook array.");
    state.index += 1;
    return values;
  }

  function parseLorebookJsObjectLiteral(text, state) {
    const value = {};
    state.index += 1;
    skipLorebookJsWhitespace(text, state);
    while (state.index < text.length && text[state.index] !== "}") {
      const ch = text[state.index];
      let key = "";
      if (ch === "\"" || ch === "'" || ch === "`") key = parseLorebookJsStringLiteral(text, state);
      else if (ch === "-" || /\d/.test(ch)) key = String(parseLorebookJsNumber(text, state));
      else key = parseLorebookJsIdentifier(text, state);
      if (!key) throw new Error("Invalid object key in lorebook source.");
      skipLorebookJsWhitespace(text, state);
      if (text[state.index] !== ":") throw new Error("Expected colon in lorebook object.");
      state.index += 1;
      value[key] = parseLorebookJsLiteralValue(text, state);
      skipLorebookJsWhitespace(text, state);
      if (text[state.index] === ",") {
        state.index += 1;
        skipLorebookJsWhitespace(text, state);
        continue;
      }
      if (text[state.index] !== "}") throw new Error("Expected comma in lorebook object.");
    }
    if (text[state.index] !== "}") throw new Error("Unterminated lorebook object.");
    state.index += 1;
    return value;
  }

  function parseLorebookJsLiteralValue(text, state) {
    skipLorebookJsWhitespace(text, state);
    const ch = text[state.index];
    if (ch === "[") return parseLorebookJsArrayLiteral(text, state);
    if (ch === "{") return parseLorebookJsObjectLiteral(text, state);
    if (ch === "\"" || ch === "'" || ch === "`") return parseLorebookJsStringLiteral(text, state);
    if (ch === "-" || /\d/.test(ch)) return parseLorebookJsNumber(text, state);
    const ident = parseLorebookJsIdentifier(text, state);
    if (ident === "true") return true;
    if (ident === "false") return false;
    if (ident === "null" || ident === "undefined" || ident === "NaN") return null;
    throw new Error(`Unsupported value "${ident || ch}" in lorebook source.`);
  }

  function parseLorebookJsLiteral(text) {
    const source = String(text || "");
    const state = { index: 0 };
    const value = parseLorebookJsLiteralValue(source, state);
    skipLorebookJsWhitespace(source, state);
    if (state.index < source.length && source[state.index] === ";") {
      state.index += 1;
      skipLorebookJsWhitespace(source, state);
    }
    if (state.index < source.length) throw new Error("Unexpected extra content after lorebook literal.");
    return value;
  }

  function sliceBalancedLorebookArrayLiteral(text, startIndex) {
    let depth = 0;
    let quote = "";
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    for (let i = startIndex; i < text.length; i += 1) {
      const ch = text[i];
      const next = text[i + 1];
      if (lineComment) {
        if (ch === "\n" || ch === "\r") lineComment = false;
        continue;
      }
      if (blockComment) {
        if (ch === "*" && next === "/") {
          blockComment = false;
          i += 1;
        }
        continue;
      }
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === quote) quote = "";
        continue;
      }
      if (ch === "/" && next === "/") {
        lineComment = true;
        i += 1;
        continue;
      }
      if (ch === "/" && next === "*") {
        blockComment = true;
        i += 1;
        continue;
      }
      if (ch === "\"" || ch === "'" || ch === "`") {
        quote = ch;
        continue;
      }
      if (ch === "[") {
        depth += 1;
        continue;
      }
      if (ch === "]") {
        depth -= 1;
        if (depth === 0) return text.slice(startIndex, i + 1);
      }
    }
    return "";
  }

  function extractLorebookEntriesFromSourceScript(sourceText) {
    const text = String(sourceText || "").trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.loreEntries)) return parsed.loreEntries;
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.lore_entries)) return parsed.lore_entries;
      if (parsed && typeof parsed === "object" && parsed.entries && typeof parsed.entries === "object") return parsed.entries;
      return parsed;
    } catch (_) {}

    const assignmentMatch = /(?:(?:const|let|var)\s+)?loreEntries\s*=/i.exec(text);
    const startSearchAt = assignmentMatch ? assignmentMatch.index + assignmentMatch[0].length : 0;
    let arrayStart = text.indexOf("[", startSearchAt);
    if (arrayStart === -1 && !assignmentMatch) arrayStart = text.indexOf("[");
    if (arrayStart === -1) return null;
    const arrayLiteral = sliceBalancedLorebookArrayLiteral(text, arrayStart);
    if (!arrayLiteral) return null;
    const parsed = parseLorebookJsLiteral(arrayLiteral);
    return Array.isArray(parsed) ? parsed : null;
  }

  function normalizeLorebookStringArray(value) {
    if (Array.isArray(value)) return value.map((item) => String(item == null ? "" : item).trim()).filter(Boolean);
    if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
    return [];
  }

  function compactLorebookEntry(rawEntry, index) {
    const entry = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
    let keys = normalizeLorebookStringArray(entry.key ?? entry.keys ?? entry.keysRaw ?? entry.keys_raw);
    if (keys.length === 0) keys = normalizeLorebookStringArray(entry.keywords);
    const filters = entry.filters && typeof entry.filters === "object" ? entry.filters : {};
    const secondaryKeys = normalizeLorebookStringArray(filters.notWith ?? filters.not_with ?? entry.notWith ?? entry.not_with);
    const contentParts = [];
    if (entry.personality) contentParts.push(String(entry.personality));
    if (entry.scenario) contentParts.push(String(entry.scenario));
    const content = firstPresent([entry.content, contentParts.length ? contentParts.join("\n") : null]);
    return sanitizeForTransport({
      index,
      name: compactText(entry.name, 300),
      category: compactText(entry.category, 300),
      comment: compactText(entry.comment, 500),
      keys: keys.slice(0, 50),
      secondaryKeys: secondaryKeys.slice(0, 50),
      contentPreview: compactText(content, 3000),
      personalityPreview: compactText(entry.personality, 2000),
      scenarioPreview: compactText(entry.scenario, 2000),
      constant: entry.constant ?? null,
      enabled: entry.enabled ?? null,
      disabled: entry.disabled ?? null,
      probability: entry.probability ?? null,
      priority: firstPresent([entry.priority, entry.insertion_order, entry.insertionOrder]),
      filters: filters && Object.keys(filters).length ? filters : null,
      rawFieldCount: rawEntry && typeof rawEntry === "object" ? Object.keys(rawEntry).length : 0,
    });
  }

  function compactLorebookEntryIndex(sourceText) {
    const text = String(sourceText || "").trim();
    if (!text) return null;
    try {
      const extracted = extractLorebookEntriesFromSourceScript(text);
      if (!extracted) {
        return { parsed: false, entryCount: 0, truncated: false, error: "loreEntries array not found", items: [] };
      }
      const entries = Array.isArray(extracted)
        ? extracted
        : extracted && typeof extracted === "object"
          ? Object.values(extracted)
          : [];
      const items = entries.slice(0, 500).map(compactLorebookEntry);
      return sanitizeForTransport({
        parsed: true,
        entryCount: entries.length,
        truncated: entries.length > items.length,
        items,
      });
    } catch (error) {
      return {
        parsed: false,
        entryCount: 0,
        truncated: false,
        error: String(error && error.message ? error.message : error),
        items: [],
      };
    }
  }

  function getJanitorScriptType(script) {
    return String(script && (script.type || script.script_type || script.scriptType) || "")
      .trim()
      .toLowerCase();
  }

  function compactJanitorScriptItem(script) {
    const item = script && typeof script === "object" ? script : {};
    const sourceText = firstPresent([item.scriptText, item.script, item.sourceText]);
    const originalScriptText = firstPresent([item.originalScriptText, item.original_script]);
    const type = firstPresent([item.type, item.script_type, item.scriptType]);
    const lorebookEntries =
      String(type || "").trim().toLowerCase() === "lorebook"
        ? compactLorebookEntryIndex(firstPresent([sourceText, originalScriptText]))
        : null;
    return sanitizeForTransport({
      id: normalizeUuid(item.id || item.script_id || item.scriptId),
      title: compactText(firstPresent([item.title, item.name]), 500),
      description: compactText(firstPresent([item.descriptionText, item.description]), 8000),
      type,
      source: item.source || null,
      pageUrl: item.pageUrl || item.url || null,
      apiPath: item.apiPath || item.api_path || null,
      isPublic: item.isPublic ?? item.is_public ?? null,
      isCodePublic: item.isCodePublic ?? item.is_code_public ?? null,
      isCommentAllowed: item.isCommentAllowed ?? item.is_comment_allowed ?? null,
      scriptDetailAvailable: item.scriptDetailAvailable ?? item.script_detail_available ?? null,
      scriptDetailOk: item.scriptDetailOk ?? item.script_detail_ok ?? null,
      scriptDetailStatus: item.scriptDetailStatus ?? item.script_detail_status ?? null,
      scriptDetailUrl: item.scriptDetailUrl || item.script_detail_url || null,
      isLocked: item.isLocked ?? item.is_locked ?? item.locked ?? null,
      hasScriptContent: !!(sourceText && String(sourceText).trim()),
      scriptText: compactText(sourceText, 500000),
      originalScriptText: compactText(originalScriptText, 500000),
      lorebookEntries,
      theme: item.theme || null,
      createdAt: parseTimestamp(item.createdAt || item.created_at) || item.createdAt || item.created_at || null,
      updatedAt: parseTimestamp(item.updatedAt || item.updated_at) || item.updatedAt || item.updated_at || null,
      userId: item.userId || item.user_id || null,
      userName: item.userName || item.user_name || null,
      messageCount: parseIntSafe(item.messageCount ?? item.message_count, null),
      engineVersion: item.engineVersion ?? item.engine_version ?? null,
      depth: item.depth ?? null,
      settings: item.settings ?? null,
      characters: Array.isArray(item.characters) ? item.characters.slice(0, 200) : [],
    });
  }

  function compactJanitorScriptsCapture(scriptsCapture) {
    const root = scriptsCapture && typeof scriptsCapture === "object" ? scriptsCapture : {};
    const rawItems = Array.isArray(root.items)
      ? root.items
      : Array.isArray(root.scripts)
        ? root.scripts
        : [];
    const items = rawItems.slice(0, 250).map(compactJanitorScriptItem);
    const lorebookCount = items.filter((item) => getJanitorScriptType(item) === "lorebook").length;
    return sanitizeForTransport({
      success: root.success === true,
      source: root.source || "janitor_scripts_extension",
      capturedAt: root.capturedAt || null,
      characterId: root.characterId || null,
      metadataSource: root.metadataSource || null,
      characterStatus: root.characterStatus || null,
      characterOk: root.characterOk ?? null,
      scriptCount: items.length,
      lorebookCount,
      otherScriptCount: Math.max(0, items.length - lorebookCount),
      truncated: rawItems.length > items.length,
      error: root.error || null,
      items,
    });
  }

  function buildJannyTavernPayload(detail) {
    return {
      name: detail && detail.name ? detail.name : "",
      description: detail && detail.personalityText ? detail.personalityText : "",
      personality: detail && detail.descriptionText ? detail.descriptionText : "",
      scenario: detail && detail.scenarioText ? detail.scenarioText : "",
      first_mes: detail && detail.firstMessageText ? detail.firstMessageText : "",
      mes_example: detail && detail.exampleDialogsText ? detail.exampleDialogsText : "",
      metadata: {
        version: 1,
        created: Date.now(),
        modified: Date.now(),
        tool: {
          name: "Pincat by Cressida",
          version: "0.1.0",
          url: JANNY_BASE,
        },
      },
    };
  }

  function pickJanitorCharacterStore(data) {
    if (!data || typeof data !== "object") return null;
    const directKey = Object.keys(data).find((key) => String(key || "").includes("characterStore"));
    if (directKey && data[directKey] && typeof data[directKey] === "object") {
      return { key: directKey, store: data[directKey] };
    }
    if (data.characterStore && typeof data.characterStore === "object") {
      return { key: "characterStore", store: data.characterStore };
    }
    return null;
  }

  function summarizeJanitorCharacterStore(storeEnvelope) {
    const picked = pickJanitorCharacterStore(storeEnvelope);
    const store = picked ? picked.store : null;
    const character = store && store.character && typeof store.character === "object" ? store.character : null;
    if (!character) {
      return {
        found: false,
        storeKey: picked ? picked.key : null,
        error: store && store.sR && store.sR.error ? store.sR.error : null,
      };
    }
    const profileImageAssetUrl = normalizeJanitorAssetUrl(
      firstPresent([character.profileImageAssetUrl, character.avatarUrl, character.avatar_url, character.avatar]),
    );
    const rawDescriptionHtml = pickRawDescriptionHtml(character);
    const characterId = normalizeUuid(character.id || character.character_id);
    return {
      found: true,
      storeKey: picked.key,
      id: characterId,
      name: character.name || character.title || null,
      creatorId: normalizeUuid(character.creator_id || character.creatorId || null),
      creatorName: character.creator_name || character.creatorName || null,
      avatarUrl: profileImageAssetUrl,
      profileImageAssetUrl,
      rawDescriptionHtml: compactText(rawDescriptionHtml, 500000),
      descriptionHtmlFile: buildRawDescriptionHtmlFile("janitor-character", characterId, rawDescriptionHtml),
      rawCharacter: character,
    };
  }

  function compactText(value, maxLength) {
    if (value == null) return null;
    const text = String(value);
    const limit = Math.max(200, Number(maxLength) || 8000);
    return text.length > limit ? `${text.slice(0, limit)}... [truncated]` : text;
  }

  function stripJanitorCapturedWatermark(value) {
    if (!value || typeof value !== "string") return "";
    return value
      .split(/\r?\n/)
      .filter((line) => {
        const text = line.trim();
        return !(/^created/i.test(text) && /janitorai\.com"?$/i.test(text));
      })
      .join("\n")
      .trim();
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function extractJanitorTagContent(value, tagName) {
    if (!value || !tagName) return "";
    const variants = [];
    const trimmed = String(tagName).trim();
    variants.push(trimmed);
    const collapsed = trimmed.replace(/\s+/g, " ");
    if (collapsed !== trimmed) variants.push(collapsed);
    if (trimmed.includes(" ")) variants.push(trimmed.replace(/\s+/g, "_"));
    for (const name of variants) {
      const escaped = escapeRegExp(name);
      const fullMatch = String(value).match(new RegExp(`<${escaped}(?:\\s[^>]*)?\\s*>([\\s\\S]*?)<\\/${escaped}\\s*>`, "i"));
      if (fullMatch && fullMatch[1] != null) return fullMatch[1].trim();
      const openMatch = new RegExp(`<${escaped}(?:\\s[^>]*)?\\s*>`, "i").exec(String(value));
      const closeMatch = new RegExp(`<\\/${escaped}\\s*>`, "i").exec(String(value));
      if (openMatch && closeMatch && closeMatch.index > openMatch.index) {
        return String(value).slice(openMatch.index + openMatch[0].length, closeMatch.index).trim();
      }
    }
    return "";
  }

  function parseJanitorGenerateAlphaRawPayload(rawResponse) {
    const text = String(rawResponse || "").trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (_) {}
    const dataLines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s*/, ""))
      .filter((line) => line && line !== "[DONE]");
    for (const line of dataLines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.messages)) return parsed;
      } catch (_) {}
    }
    return null;
  }

  function compactJanitorGenerateAlphaCapturedPrompt(generateAlpha) {
    const root = generateAlpha && typeof generateAlpha === "object" ? generateAlpha : {};
    const payload = parseJanitorGenerateAlphaRawPayload(root.rawResponse);
    if (!payload || !Array.isArray(payload.messages)) return null;
    const messages = payload.messages.slice(0, 100).map((message, index) => {
      const item = message && typeof message === "object" ? message : {};
      const content = compactText(item.content, 500000);
      return {
        index,
        role: item.role || null,
        contentLength: item.content == null ? 0 : String(item.content).length,
        content,
      };
    });
    const systemPrompt = messages
      .filter((message) => String(message.role || "").toLowerCase() === "system")
      .map((message) => message.content)
      .filter(Boolean)
      .join("\n\n");
    return sanitizeForTransport({
      responseFormat: "json_payload",
      model: payload.model || null,
      maxTokens: payload.max_tokens ?? payload.maxTokens ?? null,
      temperature: payload.temperature ?? null,
      stream: payload.stream ?? null,
      messageCount: Array.isArray(payload.messages) ? payload.messages.length : null,
      storedMessageCount: messages.length,
      truncated: Array.isArray(payload.messages) ? payload.messages.length > messages.length : false,
      systemPrompt: compactText(systemPrompt, 500000),
      messages,
    });
  }

  function extractJanitorDefinitionFromCapturedPrompt(capturedPrompt) {
    const root = capturedPrompt && typeof capturedPrompt === "object" ? capturedPrompt : {};
    const messages = Array.isArray(root.messages) ? root.messages : [];
    const systemPrompt = firstPresent([
      root.systemPrompt,
      messages
        .filter((message) => String(message && message.role || "").toLowerCase() === "system")
        .map((message) => message && message.content)
        .filter(Boolean)
        .join("\n\n"),
    ]);
    if (!systemPrompt) return null;

    const content = String(systemPrompt).replace(/^\s*\[System note:[\s\S]*?\]\s*/, "");
    const botPersonaMatch = content.match(/<(?!UserPersona\b)([^>]*?Persona)>([\s\S]*?)<\/\1>/i);
    const scenarioMatch = content.match(/<Scenario>([\s\S]*?)<\/Scenario>/i);
    const userPersonaMatch = content.match(/<UserPersona>([\s\S]*?)<\/UserPersona>/i);
    const exampleDialogsMatch = content.match(/<example_dialogs>([\s\S]*?)<\/example_dialogs>/i);
    const trailingPersonaCloseMatch = content.match(/<\/(?!UserPersona\b)([^>]*?Persona)>\s*$/i);

    let charBlock = "";
    let scenario = "";
    let userPersona = "";
    let exampleDialogs = "";
    let charName = "";
    let format = "unknown";

    if (botPersonaMatch) {
      const nameMatch = String(botPersonaMatch[1] || "").match(/^(.+?)(?:'s\s*)?Persona$/i);
      if (nameMatch) charName = nameMatch[1].trim();
    }
    if (!charName && trailingPersonaCloseMatch) {
      const fallbackNameMatch = String(trailingPersonaCloseMatch[1] || "").match(/^(.+?)(?:'s\s*)?Persona$/i);
      if (fallbackNameMatch) charName = fallbackNameMatch[1].trim();
    }

    if (botPersonaMatch && scenarioMatch) {
      format = "old_format";
      charBlock = String(botPersonaMatch[2] || "").trim();
      scenario = String(scenarioMatch[1] || "").trim();
    } else if (botPersonaMatch) {
      format = "hybrid_format";
      charBlock = String(botPersonaMatch[2] || "").trim();
      const personaEndIndex = content.indexOf(botPersonaMatch[0]) + botPersonaMatch[0].length;
      const afterPersona = content.slice(personaEndIndex);
      const beforeUserPersona = afterPersona.match(/^([\s\S]*?)(?:<UserPersona>|<example_dialogs>|$)/i);
      if (beforeUserPersona && beforeUserPersona[1].trim()) {
        charBlock = `${charBlock}\n${beforeUserPersona[1].trim()}`.trim();
      }
    } else {
      format = "new_format";
      const beforeUserPersona = content.match(/^([\s\S]*?)(?:<UserPersona>|<example_dialogs>|$)/i);
      if (beforeUserPersona) charBlock = String(beforeUserPersona[1] || "").trim();
      if (!charBlock) {
        const afterUserPersona = content.match(
          /<\/UserPersona>\s*([\s\S]*?)(?:<\/(?!UserPersona\b)[^>]*?Persona>\s*$|<example_dialogs>|$)/i,
        );
        if (afterUserPersona && afterUserPersona[1].trim()) {
          charBlock = afterUserPersona[1].trim();
          format = trailingPersonaCloseMatch ? "closing_tag_only_format" : "new_format_after_userpersona";
        }
      }
    }

    if (userPersonaMatch) userPersona = String(userPersonaMatch[1] || "").trim();
    if (exampleDialogsMatch) exampleDialogs = String(exampleDialogsMatch[1] || "").trim();
    if (!exampleDialogs) exampleDialogs = extractJanitorTagContent(systemPrompt, "example_dialogs");

    const assistantMessage = messages.find((message) => String(message && message.role || "").toLowerCase() === "assistant");
    const firstMessage = assistantMessage && assistantMessage.content ? assistantMessage.content : "";
    if (!charBlock && !scenario && !firstMessage && !exampleDialogs) return null;

    return sanitizeForTransport({
      method: "method2_system_prompt",
      format,
      charName: stripJanitorCapturedWatermark(charName),
      charBlock: compactText(stripJanitorCapturedWatermark(charBlock), 500000),
      scenario: compactText(stripJanitorCapturedWatermark(scenario), 500000),
      firstMessage: compactText(stripJanitorCapturedWatermark(firstMessage), 500000),
      exampleDialogs: compactText(stripJanitorCapturedWatermark(exampleDialogs), 500000),
      userPersona: compactText(userPersona, 500000),
      rawSystemPromptLength: String(systemPrompt).length,
    });
  }

  function firstPresent(values) {
    for (const value of values) {
      if (value == null) continue;
      if (typeof value === "string" && value.trim() === "") continue;
      return value;
    }
    return null;
  }

  const SAUCEPAN_COMPONENT_TOKEN_COUNT_FIELDS = [
    ["cardTokenCount", "card_token_count"],
    ["exampleDialogueTokenCount", "example_dialogue_token_count"],
    ["advancedPromptTokenCount", "advanced_prompt_token_count"],
    ["formattingInstructionsTokenCount", "formatting_instructions_token_count"],
  ];

  function deriveSaucepanComponentTotalTokens(source) {
    if (!source || typeof source !== "object" || Array.isArray(source)) return null;
    let total = 0;
    let hasComponentCount = false;
    for (const aliases of SAUCEPAN_COMPONENT_TOKEN_COUNT_FIELDS) {
      const count = parseIntSafe(firstPresent(aliases.map((key) => source[key])), null);
      if (!Number.isFinite(count)) continue;
      total += count;
      hasComponentCount = true;
    }
    return hasComponentCount ? total : null;
  }

  function normalizeTags(tags) {
    if (!Array.isArray(tags)) return [];
    return tags
      .map((tag) => {
        if (typeof tag === "string") return tag.trim();
        if (tag && typeof tag === "object") {
          return String(tag.name || tag.label || tag.title || tag.id || "").trim();
        }
        return "";
      })
      .filter(Boolean)
      .slice(0, 40);
  }

  function normalizeBooleanFlag(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
    if (typeof value === "string") {
      const text = value.trim().toLowerCase();
      if (["true", "1", "yes", "y"].includes(text)) return true;
      if (["false", "0", "no", "n"].includes(text)) return false;
    }
    return null;
  }

  function readJanitorDefinitionFlags(character, janitorCore) {
    const root = character && typeof character === "object" ? character : {};
    const core = janitorCore && typeof janitorCore === "object" ? janitorCore : {};
    const rawCharacter = root.rawCharacter && typeof root.rawCharacter === "object" ? root.rawCharacter : {};
    const chat = core.chat && typeof core.chat === "object" ? core.chat : {};
    const chatCharacter = chat.character && typeof chat.character === "object" ? chat.character : {};
    const fullDefinitionRevealedByAuthor = normalizeBooleanFlag(firstPresent([
      root.fullDefinitionRevealedByAuthor,
      root.full_definition_revealed_by_author,
      root.showdefinition,
      root.showDefinition,
      rawCharacter.fullDefinitionRevealedByAuthor,
      rawCharacter.full_definition_revealed_by_author,
      rawCharacter.showdefinition,
      rawCharacter.showDefinition,
      chatCharacter.showdefinition,
      chatCharacter.showDefinition,
    ]));
    const allowProxy = normalizeBooleanFlag(firstPresent([
      root.allowProxy,
      root.allow_proxy,
      rawCharacter.allowProxy,
      rawCharacter.allow_proxy,
      chatCharacter.allowProxy,
      chatCharacter.allow_proxy,
    ]));
    return {
      fullDefinitionRevealedByAuthor,
      allowProxy,
      definitionHidden: fullDefinitionRevealedByAuthor === null ? null : fullDefinitionRevealedByAuthor === false,
    };
  }

  function buildJanitorRetrievalCompleteness(flags, hiddenDefinition) {
    const definitionHidden = flags && flags.definitionHidden;
    const allowProxy = flags ? flags.allowProxy : null;
    const hiddenDefinitionCaptured = !!(hiddenDefinition && hiddenDefinition.charBlock);
    if (definitionHidden === true && allowProxy === false) {
      return {
        state: "partial_hidden_definition_proxy_not_allowed",
        partial: true,
        reason: "hidden_definition_proxy_not_allowed",
        message: "Definition is hidden and proxy is not allowed; retrieval is partial.",
      };
    }
    if (definitionHidden === true && !hiddenDefinitionCaptured) {
      return {
        state: "partial_hidden_definition_not_captured",
        partial: true,
        reason: "hidden_definition_not_captured",
        message: "Definition is hidden and no system-prompt definition was captured.",
      };
    }
    if (definitionHidden === true) {
      return {
        state: "hidden_definition_captured",
        partial: false,
        reason: null,
        message: "Definition is hidden, but the proxy capture produced the core definition.",
      };
    }
    if (definitionHidden === false) {
      return {
        state: "open_definition",
        partial: false,
        reason: null,
        message: "Definition is revealed by the author.",
      };
    }
    return {
      state: "unknown_definition_visibility",
      partial: false,
      reason: null,
      message: "Definition visibility was not present in the captured payload.",
    };
  }

  function collectSourceQualityObjects(value) {
    const root = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const objects = [];
    const seen = new Set();
    const add = (candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || seen.has(candidate)) return;
      seen.add(candidate);
      objects.push(candidate);
    };
    add(root);
    for (const key of [
      "character",
      "companion",
      "rawCharacter",
      "rawCompanion",
      "rawData",
      "raw_data",
      "apiItem",
      "api_item",
      "definition",
      "status",
      "sourceQuality",
      "source_quality",
      "retrievalCompleteness",
      "retrieval_completeness",
    ]) {
      add(root[key]);
    }
    for (const candidate of [...objects]) {
      add(candidate.rawData);
      add(candidate.raw_data);
      add(candidate.apiItem);
      add(candidate.api_item);
      add(candidate.status);
      add(candidate.sourceQuality);
      add(candidate.source_quality);
      add(candidate.retrievalCompleteness);
      add(candidate.retrieval_completeness);
    }
    return objects;
  }

  function firstSourceQualityValue(objects, keys) {
    for (const object of objects) {
      const value = firstPresent(keys.map((key) => object[key]));
      if (value !== null) return value;
    }
    return null;
  }

  function buildSourceQualityResult(state, options = {}) {
    const normalizedState = state === "degraded" || state === "complete" ? state : "unknown";
    return {
      state: normalizedState,
      degraded: normalizedState === "degraded",
      recovered: options.recovered === true,
      definitionUnavailable: normalizedState === "degraded",
      reason: options.reason || null,
    };
  }

  function deriveCharacterSourceQuality(value, sourceKind = null) {
    const objects = collectSourceQualityObjects(value);
    const normalizedSourceKind = normalizeSourceKind(firstPresent([
      sourceKind,
      firstSourceQualityValue(objects, ["sourceKind", "source_kind"]),
    ]));
    const explicitQuality = objects.find((object) => (
      Object.prototype.hasOwnProperty.call(object, "degraded") ||
      Object.prototype.hasOwnProperty.call(object, "definitionUnavailable") ||
      Object.prototype.hasOwnProperty.call(object, "recovered")
    ));
    if (explicitQuality) {
      const explicitState = String(explicitQuality.state || "").trim().toLowerCase();
      if (explicitQuality.degraded === true || explicitQuality.definitionUnavailable === true || explicitState === "degraded") {
        return buildSourceQualityResult("degraded", { reason: explicitQuality.reason || "definition_unavailable" });
      }
      if (explicitState === "complete" || explicitQuality.degraded === false) {
        return buildSourceQualityResult("complete", { recovered: explicitQuality.recovered === true });
      }
    }
    const completeness = objects.find((object) => (
      Object.prototype.hasOwnProperty.call(object, "partial") ||
      Object.prototype.hasOwnProperty.call(object, "state") && (
        String(object.state || "").includes("definition") ||
        String(object.state || "").startsWith("degraded")
      )
    ));
    const completenessState = String(completeness && completeness.state || "").trim().toLowerCase();
    if ((completeness && completeness.partial === true) || completenessState.startsWith("partial_") || completenessState.startsWith("degraded")) {
      return buildSourceQualityResult("degraded", {
        reason: completeness && completeness.reason || "definition_unavailable",
      });
    }
    if (completenessState === "hidden_definition_captured") {
      return buildSourceQualityResult("complete", { recovered: true });
    }
    if (completenessState === "open_definition") {
      return buildSourceQualityResult("complete");
    }

    if (normalizedSourceKind === "saucepan") {
      const definitionState = String(firstSourceQualityValue(objects, ["definitionState", "definition_state"]) || "")
        .trim()
        .toLowerCase();
      const openDefinition = normalizeBooleanFlag(firstSourceQualityValue(objects, [
        "openDefinition",
        "open_definition",
        "definitionOpen",
        "definition_open",
      ]));
      const hiddenDefinition = normalizeBooleanFlag(firstSourceQualityValue(objects, [
        "isHidden",
        "is_hidden",
        "definitionHidden",
        "definition_hidden",
      ]));
      if (["closed", "hidden", "private", "unavailable"].includes(definitionState) || openDefinition === false || hiddenDefinition === true) {
        return buildSourceQualityResult("degraded", { reason: "definition_unavailable" });
      }
      if (["open", "public", "available"].includes(definitionState) || openDefinition === true || hiddenDefinition === false) {
        return buildSourceQualityResult("complete");
      }
      return buildSourceQualityResult("unknown");
    }

    if (normalizedSourceKind === "janitor") {
      const hiddenDefinitionCaptured = normalizeBooleanFlag(firstSourceQualityValue(objects, [
        "hiddenDefinitionCaptured",
        "hidden_definition_captured",
      ]));
      const definitionHidden = normalizeBooleanFlag(firstSourceQualityValue(objects, [
        "definitionHidden",
        "definition_hidden",
      ]));
      const revealedByAuthor = normalizeBooleanFlag(firstSourceQualityValue(objects, [
        "fullDefinitionRevealedByAuthor",
        "full_definition_revealed_by_author",
        "showdefinition",
        "showDefinition",
      ]));
      const hidden = definitionHidden === true || revealedByAuthor === false;
      if (hidden && hiddenDefinitionCaptured === true) {
        return buildSourceQualityResult("complete", { recovered: true });
      }
      if (hidden) {
        return buildSourceQualityResult("degraded", { reason: "definition_unavailable" });
      }
      if (definitionHidden === false || revealedByAuthor === true) {
        return buildSourceQualityResult("complete");
      }
    }

    return buildSourceQualityResult("unknown");
  }

  function deriveRetrievedSourceQuality(capture) {
    const root = capture && typeof capture === "object" ? capture : {};
    const sourceKind = normalizeSourceKind(root.sourceKind || (root.saucepanCore ? "saucepan" : "janitor"));
    if (sourceKind === "saucepan") {
      return deriveCharacterSourceQuality(root.saucepanCore || root, "saucepan");
    }
    const janitorCore = root.janitorCore && typeof root.janitorCore === "object" ? root.janitorCore : {};
    const generateAlpha = janitorCore.generateAlpha && typeof janitorCore.generateAlpha === "object"
      ? janitorCore.generateAlpha
      : {};
    const capturedPrompt = compactJanitorGenerateAlphaCapturedPrompt(generateAlpha);
    const hiddenDefinition = extractJanitorDefinitionFromCapturedPrompt(capturedPrompt);
    const flags = readJanitorDefinitionFlags(janitorCore.character, janitorCore);
    const retrievalCompleteness = buildJanitorRetrievalCompleteness(flags, hiddenDefinition);
    return deriveCharacterSourceQuality({
      ...(janitorCore.character && typeof janitorCore.character === "object" ? janitorCore.character : {}),
      retrievalCompleteness,
      hiddenDefinitionCaptured: !!(hiddenDefinition && hiddenDefinition.charBlock),
    }, "janitor");
  }

  function compactJanitorCoreCharacter(character, hiddenDefinition, definitionFlags, retrievalCompleteness) {
    const root = character && typeof character === "object" ? character : {};
    const rawCharacter = root.rawCharacter && typeof root.rawCharacter === "object" ? root.rawCharacter : {};
    const id = normalizeUuid(firstPresent([root.id, rawCharacter.id, rawCharacter.character_id]));
    const profileImageAssetUrl = normalizeJanitorAssetUrl(
      firstPresent([
        root.profileImageAssetUrl,
        root.avatarUrl,
        root.avatar_url,
        root.avatar,
        rawCharacter.profileImageAssetUrl,
        rawCharacter.avatarUrl,
        rawCharacter.avatar_url,
        rawCharacter.avatar,
      ]),
    );
    const rawDescriptionHtml = pickRawDescriptionHtml(root) || pickRawDescriptionHtml(rawCharacter);
    const sections = root.sections && typeof root.sections === "object" ? root.sections : {};
    const sectionDescriptionHtml = pickRawDescriptionHtml(sections);
    const finalRawDescriptionHtml = rawDescriptionHtml || sectionDescriptionHtml;
    const hidden = hiddenDefinition && typeof hiddenDefinition === "object" ? hiddenDefinition : {};
    const flags = definitionFlags && typeof definitionFlags === "object"
      ? definitionFlags
      : readJanitorDefinitionFlags(root, null);
    const completeness = retrievalCompleteness && typeof retrievalCompleteness === "object"
      ? retrievalCompleteness
      : buildJanitorRetrievalCompleteness(flags, hiddenDefinition);
    const mergedDefinitionText = firstPresent([
      sections.definitionText,
      sections.definition_text,
      sections.personality,
      rawCharacter.personality,
      root.personality,
      hidden.charBlock,
    ]);
    const mergedScenario = firstPresent([sections.scenario, rawCharacter.scenario, root.scenario, hidden.scenario]);
    const mergedFirstMessage = firstPresent([
      sections.firstMessage,
      sections.first_message,
      rawCharacter.first_message,
      rawCharacter.firstMessage,
      root.first_message,
      root.firstMessage,
      hidden.firstMessage,
    ]);
    const mergedExampleDialogs = firstPresent([
      sections.exampleDialogs,
      sections.example_dialogs,
      rawCharacter.example_dialogs,
      rawCharacter.exampleDialogs,
      root.example_dialogs,
      root.exampleDialogs,
      hidden.exampleDialogs,
    ]);
    const hasSections =
      Object.keys(sections).length ||
      mergedDefinitionText ||
      mergedScenario ||
      mergedFirstMessage ||
      mergedExampleDialogs;
    return sanitizeForTransport({
      ...root,
      id,
      avatarUrl: profileImageAssetUrl,
      profileImageAssetUrl,
      fullDefinitionRevealedByAuthor: flags.fullDefinitionRevealedByAuthor,
      full_definition_revealed_by_author: flags.fullDefinitionRevealedByAuthor,
      allowProxy: flags.allowProxy,
      allow_proxy: flags.allowProxy,
      definitionHidden: flags.definitionHidden,
      hiddenDefinitionCaptured: !!(hiddenDefinition && hiddenDefinition.charBlock),
      hiddenDefinitionMethod: hidden.method || null,
      hiddenDefinitionFormat: hidden.format || null,
      retrievalCompleteness: completeness,
      rawDescriptionHtml: compactText(finalRawDescriptionHtml, 500000),
      descriptionHtmlFile: buildRawDescriptionHtmlFile("janitor-character", id || root.characterId, finalRawDescriptionHtml),
      sections: hasSections
        ? {
            descriptionHtml: compactText(sections.descriptionHtml || sections.description_html, 500000),
            definitionText: compactText(mergedDefinitionText, 500000),
            personality: compactText(mergedDefinitionText, 500000),
            scenario: compactText(mergedScenario, 500000),
            firstMessage: compactText(mergedFirstMessage, 500000),
            firstMessages: Array.isArray(sections.firstMessages || sections.first_messages)
              ? (sections.firstMessages || sections.first_messages).slice(0, 50).map((item, index) => {
                  const rootItem = item && typeof item === "object" ? item : { message: item };
                  return {
                    index: rootItem.index ?? index,
                    id: rootItem.id || null,
                    name: rootItem.name || null,
                    message: compactText(rootItem.message, 500000),
                  };
                })
              : [],
            exampleDialogs: compactText(mergedExampleDialogs, 500000),
            hiddenDefinitionMerged: !!(hiddenDefinition && hiddenDefinition.charBlock),
          }
        : null,
    });
  }

  function compactSaucepanDefinitionPayload(definition) {
    const root = normalizeSaucepanOpenDefinitionPayload(definition) || (definition && typeof definition === "object" ? definition : {});
    const out = {};
    for (const [key, value] of Object.entries(root)) {
      out[key] = typeof value === "string" ? compactText(value, 500000) : value;
    }
    const definitionSections = buildSaucepanDefinitionSectionList(root);
    if (definitionSections.length) out.definitionSections = definitionSections;
    return Object.keys(out).length ? sanitizeForTransport(out) : null;
  }

  function getSaucepanDefinitionSectionTitle(field) {
    if (field === "card") return "Companion Core";
    if (field === "example_dialogue") return "Example Dialogue";
    if (field === "formatting_instructions") return "Formatting Instructions";
    if (field === "advanced_prompt") return "Advanced Prompt";
    return "Definition";
  }

  function buildSaucepanDefinitionSectionList(definition) {
    const root = normalizeSaucepanOpenDefinitionPayload(definition) || (definition && typeof definition === "object" ? definition : {});
    if (!root || typeof root !== "object" || Array.isArray(root)) return [];
    const sections = [];
    const seenFields = new Set();
    const decodedSections = Array.isArray(root.decoded_sections) ? root.decoded_sections : [];
    decodedSections.forEach((section, index) => {
      const item = section && typeof section === "object" ? section : {};
      const text = compactText(item.text, 500000);
      if (!text) return;
      const field = item.field || null;
      if (field) seenFields.add(field);
      sections.push({
        index,
        title: compactText(item.title, 1000) || getSaucepanDefinitionSectionTitle(field),
        field,
        source: "decoded_sections",
        text,
      });
    });
    SAUCEPAN_DEFINITION_FIELDS.forEach((field) => {
      if (seenFields.has(field)) return;
      const text = compactText(root[field], 500000);
      if (!text || isSaucepanStaleDefinitionCard(text)) return;
      sections.push({
        index: sections.length,
        title: getSaucepanDefinitionSectionTitle(field),
        field,
        source: "open_definition_field",
        text,
      });
    });
    return sections;
  }

  function compactSaucepanScenarioList(value) {
    const list = decodeSaucepanStartingScenarioFragments(value).length
      ? decodeSaucepanStartingScenarioFragments(value)
      : Array.isArray(value) ? value : [];
    return list.slice(0, 50).map((item, index) => {
      const root = item && typeof item === "object" ? item : { message: item };
      return {
        index,
        id: root.id || root.scenario_id || root.scenarioId || null,
        title: root.title || root.name || root.label || `Scenario ${index + 1}`,
        message: firstSaucepanScenarioText([
          root.message,
          root.first_message,
          root.firstMessage,
          root.text,
          root.combined,
        ]),
      };
    }).filter((item) => item.message);
  }

  function compactSaucepanLorebookList(value) {
    const root = value && typeof value === "object" ? value : {};
    const list = Array.isArray(value)
      ? value
      : Array.isArray(root.lorebooks)
        ? root.lorebooks
        : Array.isArray(root.items)
          ? root.items
          : [];
    return sanitizeForTransport({
      count: parseIntSafe(firstPresent([root.lorebook_count, root.lorebookCount, root.total_count, list.length]), list.length),
      chapterCount: parseIntSafe(firstPresent([root.chapter_count, root.chapterCount]), null),
      totalWordCount: parseIntSafe(firstPresent([root.total_word_count, root.totalWordCount]), null),
      items: list.slice(0, 100).map((item) => {
        const entry = item && typeof item === "object" ? item : {};
        const id = normalizeUuid(firstPresent([entry.id, entry.lorebook_id, entry.lorebookId]));
        const image = normalizeSaucepanImageRef(firstPresent([entry.image, entry.image_id, entry.imageId, entry.avatar]));
        return {
          id,
          title: firstPresent([entry.name, entry.title]),
          ownerId: firstPresent([entry.owner_id, entry.ownerId]),
          ownerHandle: firstPresent([entry.owner_handle, entry.ownerHandle]),
          url: id ? `${SAUCEPAN_BASE}/lorebook/${id}` : null,
          accessLevel: firstPresent([entry.access_level, entry.accessLevel]),
          description: compactText(firstPresent([entry.short_description, entry.shortDescription, entry.description]), 12000),
          profileImageAssetUrl: getSaucepanImageAssetUrl(image),
          image,
          tags: normalizeTags(firstPresent([entry.tags, entry.fandom_tags, entry.fandomTags])),
          chapterCount: parseIntSafe(firstPresent([entry.chapter_count, entry.chapterCount]), null),
          totalWordCount: parseIntSafe(firstPresent([entry.total_word_count, entry.totalWordCount]), null),
          favoriteCount: parseIntSafe(firstPresent([entry.favorite_count, entry.favoriteCount]), null),
          definitionProtection: firstPresent([entry.definition_protection, entry.definitionProtection]),
          rawData: entry,
        };
      }),
      rawData: root,
    });
  }

  function compactSaucepanCompanion(companion) {
    const root = companion && typeof companion === "object" ? companion : {};
    const raw = root.rawCompanion && typeof root.rawCompanion === "object" ? root.rawCompanion : root;
    const id = normalizeUuid(firstPresent([root.id, root.companionId, raw.id, raw.companion_id, raw.companionId]));
    const image = normalizeSaucepanImageRef(firstPresent([root.image, root.avatar, raw.image, raw.avatar]));
    const decodedStartingScenarios = decodeSaucepanStartingScenarioFragments(firstPresent([
      root.starting_scenarios_fragments,
      root.startingScenariosFragments,
      raw.starting_scenarios_fragments,
      raw.startingScenariosFragments,
    ]));
    const explicitStartingScenarios = [
      root.startingScenarios,
      root.starting_scenarios,
      raw.starting_scenarios,
      raw.startingScenarios,
    ].find((candidate) => Array.isArray(candidate) && candidate.length > 0);
    const startingScenarios = compactSaucepanScenarioList(
      explicitStartingScenarios || decodedStartingScenarios,
    );
    const fullDescription = decodeSaucepanPublicFullDescription(raw) || decodeSaucepanPublicFullDescription(root);
    const tokenSource = [
      root.tokenCounts,
      root.token_counts,
      raw.tokenCounts,
      raw.token_counts,
    ].find((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate)) || {};
    const rawDescriptionHtml = compactText(firstPresent([
      root.rawDescriptionHtml,
      root.raw_description_html,
      root.descriptionHtml,
      root.description_html,
      fullDescription,
    ]), 500000);
    const portraits = Array.isArray(firstPresent([root.portraits, raw.portraits]))
      ? firstPresent([root.portraits, raw.portraits]).slice(0, 40).map((portrait) => {
          const item = portrait && typeof portrait === "object" ? portrait : {};
          return {
            name: item.name || null,
            description: compactText(item.description, 4000),
            image: normalizeSaucepanImageRef(item.image || item.avatar || null),
            verySus: item.very_sus ?? item.verySus ?? null,
          };
        })
      : [];
    const tokenCounts = {
      cardTokenCount: parseIntSafe(firstPresent([root.cardTokenCount, root.card_token_count, tokenSource.cardTokenCount, tokenSource.card_token_count, raw.card_token_count]), null),
      exampleDialogueTokenCount: parseIntSafe(firstPresent([root.exampleDialogueTokenCount, root.example_dialogue_token_count, tokenSource.exampleDialogueTokenCount, tokenSource.example_dialogue_token_count, raw.example_dialogue_token_count]), null),
      advancedPromptTokenCount: parseIntSafe(firstPresent([root.advancedPromptTokenCount, root.advanced_prompt_token_count, tokenSource.advancedPromptTokenCount, tokenSource.advanced_prompt_token_count, raw.advanced_prompt_token_count]), null),
      formattingInstructionsTokenCount: parseIntSafe(firstPresent([root.formattingInstructionsTokenCount, root.formatting_instructions_token_count, tokenSource.formattingInstructionsTokenCount, tokenSource.formatting_instructions_token_count, raw.formatting_instructions_token_count]), null),
    };
    const totalTokens = parseIntSafe(firstPresent([
      root.totalTokens,
      root.totalToken,
      root.total_tokens,
      root.total_token,
      tokenSource.totalTokens,
      tokenSource.totalToken,
      tokenSource.total_tokens,
      tokenSource.total_token,
      raw.total_tokens,
      raw.total_token,
    ]), null) ?? deriveSaucepanComponentTotalTokens(tokenCounts);
    if (Number.isFinite(totalTokens)) {
      tokenCounts.total_tokens = totalTokens;
      tokenCounts.totalTokens = totalTokens;
    }
    return sanitizeForTransport({
      id,
      name: firstPresent([root.name, root.displayName, root.display_name, raw.display_name, raw.name]),
      displayName: firstPresent([root.displayName, root.display_name, raw.display_name, raw.name]),
      creatorId: firstPresent([root.creatorId, root.authorId, root.author_id, raw.author_id, raw.creator_id]),
      creatorHandle: firstPresent([root.creatorHandle, root.authorHandle, root.author_handle, raw.author_handle]),
      creatorName: firstPresent([root.creatorName, root.authorName, root.author_name, raw.author_name, raw.author_handle]),
      sourcePostedAt: firstPresent([
        root.sourcePostedAt,
        root.source_posted_at,
        root.postedAt,
        root.posted_at,
        root.firstPublishedAt,
        root.first_published_at,
        root.publishedAt,
        root.published_at,
        raw.source_posted_at,
        raw.posted_at,
        raw.first_published_at,
        raw.published_at,
      ]),
      updatedAt: firstPresent([root.updatedAt, root.updated_at, raw.updated_at, raw.updatedAt]),
      pageUrl: firstPresent([root.pageUrl, root.companionUrl, id ? `${SAUCEPAN_BASE}/companion/${id}` : null]),
      accessLevel: firstPresent([root.accessLevel, root.access_level, raw.access_level]),
      openDefinition: firstPresent([root.openDefinition, root.open_definition, raw.open_definition]),
      lockedStartingMessage: firstPresent([root.lockedStartingMessage, root.locked_starting_message, raw.locked_starting_message]),
      providersProfile: firstPresent([root.providersProfile, root.providers_profile, raw.providers_profile]),
      providerAccess: firstPresent([root.providerAccess, root.providersProfile, root.providers_profile, raw.providers_profile]),
      definitionProtection: firstPresent([root.definitionProtection, root.definition_protection, raw.definition_protection]),
      profileImageAssetUrl: getSaucepanImageAssetUrl(image),
      image,
      portraits,
      fullDescription,
      rawDescriptionHtml,
      descriptionHtmlFile: buildRawDescriptionHtmlFile("saucepan-companion", id, rawDescriptionHtml),
      shortDescription: compactText(firstPresent([root.shortDescription, root.short_description, raw.short_description, raw.shortDescription]), 12000),
      firstMessageText: compactText(firstPresent([root.firstMessageText, root.first_message_text, raw.first_message_text, startingScenarios[0] && startingScenarios[0].message]), 500000),
      startingScenarios,
      stats: {
        chatCount: parseIntSafe(firstPresent([root.chatCount, root.chat_count, raw.chat_count]), null),
        interactionCount: parseIntSafe(firstPresent([root.interactionCount, root.interaction_count, raw.interaction_count]), null),
        favoriteCount: parseIntSafe(firstPresent([root.favoriteCount, root.favorite_count, raw.favorite_count]), null),
        scenarioCount: parseIntSafe(firstPresent([root.scenarioCount, root.scenario_count, raw.scenario_count]), null),
        lorebookCount: parseIntSafe(firstPresent([root.lorebookCount, root.lorebook_count, raw.lorebook_count]), null),
      },
      tokenCounts,
      tags: normalizeTags(firstPresent([root.tags, raw.tags])),
      fandomTags: normalizeTags(firstPresent([root.fandomTags, root.fandom_tags, raw.fandom_tags])),
      rawCompanion: raw,
    });
  }

  function compactSaucepanSourceMaterialItem(item) {
    const root = item && typeof item === "object" ? item : {};
    const id = normalizeUuid(firstPresent([root.companion_id, root.companionId, root.source_id, root.sourceId, root.id]));
    const image = normalizeSaucepanImageRef(firstPresent([root.image, root.avatar, root.profile_image, root.profileImage]));
    return sanitizeForTransport({
      id,
      sourceId: firstPresent([root.source_id, root.sourceId, id]),
      sourceType: firstPresent([root.source_type, root.sourceType, id ? "companion" : null]),
      title: firstPresent([root.name, root.title, root.label]),
      description: compactText(firstPresent([root.description, root.short_description, root.summary]), 8000),
      url: firstPresent([root.companion_url, root.companionUrl, root.source_url, root.sourceUrl, root.url]),
      profileImageAssetUrl: getSaucepanImageAssetUrl(image),
      image,
      tags: normalizeTags(root.tags),
      stats: {
        chatCount: parseIntSafe(firstPresent([root.chat_count, root.chatCount]), null),
        messageCount: parseIntSafe(firstPresent([root.message_count, root.messageCount]), null),
        interactionCount: parseIntSafe(firstPresent([root.interaction_count, root.interactionCount]), null),
        favoriteCount: parseIntSafe(firstPresent([root.favorite_count, root.favoriteCount]), null),
      },
      sourcePage: parseIntSafe(firstPresent([root.source_page, root.sourcePage]), null),
      sourcePostedAt: firstPresent([
        root.source_posted_at,
        root.sourcePostedAt,
        root.posted_at,
        root.postedAt,
        root.first_published_at,
        root.firstPublishedAt,
        root.published_at,
        root.publishedAt,
      ]),
      rawData: root.raw_data || root.rawData || null,
    });
  }

  function compactSaucepanCoreCapture(core) {
    const root = core && typeof core === "object" ? core : {};
    const companion = root.companion && typeof root.companion === "object" ? root.companion : null;
    const definition = root.definition && typeof root.definition === "object" ? root.definition : {};
    const companionSummary = companion ? compactSaucepanCompanion(companion) : null;
    const selectedDefinition = compactSaucepanDefinitionPayload(definition.selectedDefinition);
    const openDefinitionApi = compactSaucepanDefinitionPayload(definition.openDefinitionApi);
    const hiddenCheck = root.hiddenCheck && typeof root.hiddenCheck === "object" ? root.hiddenCheck : null;
    return sanitizeForTransport({
      success: root.success === true,
      source: root.source || "saucepan_core_extension",
      capturedAt: root.capturedAt || null,
      companionId: root.companionId || (companion && companion.id) || null,
      pageUrl: root.pageUrl || null,
      auth: root.auth || null,
      companionApiStatus: root.companionApiStatus || null,
      companionApiOk: root.companionApiOk ?? null,
      definitionApiStatus: root.definitionApiStatus || null,
      definitionApiOk: root.definitionApiOk ?? null,
      hiddenCheckStatus: root.hiddenCheckStatus || null,
      lorebooksStatus: root.lorebooksStatus || null,
      chatsByCompanionStatus: root.chatsByCompanionStatus || null,
      definitionState: root.definitionState || null,
      companion: companionSummary,
      definition: {
        status: {
          definitionState: root.definitionState || null,
          openDefinition: companionSummary ? companionSummary.openDefinition : null,
          lockedStartingMessage: companionSummary ? companionSummary.lockedStartingMessage : null,
          hiddenCheckIsHidden: hiddenCheck && typeof hiddenCheck.is_hidden === "boolean" ? hiddenCheck.is_hidden : null,
          providersProfile: companionSummary ? companionSummary.providersProfile : null,
          providerAccess: companionSummary ? companionSummary.providerAccess : null,
          definitionProtection: companionSummary ? companionSummary.definitionProtection : null,
        },
        selectedDefinition,
        openDefinitionApi,
        definitionSections: selectedDefinition && Array.isArray(selectedDefinition.definitionSections)
          ? selectedDefinition.definitionSections
          : openDefinitionApi && Array.isArray(openDefinitionApi.definitionSections)
            ? openDefinitionApi.definitionSections
            : [],
        startingScenarios: companionSummary && Array.isArray(companionSummary.startingScenarios)
          ? companionSummary.startingScenarios
          : [],
        hiddenDefinitionFallback: definition.hiddenDefinitionFallback || null,
      },
      hiddenCheck: root.hiddenCheck || null,
      chatsByCompanion: root.chatsByCompanion || null,
      lorebooks: root.lorebooks ? compactSaucepanLorebookList(root.lorebooks) : null,
      reads: root.reads || null,
    });
  }

  function compactSaucepanCreatorCapture(creator) {
    const root = creator && typeof creator === "object" ? creator : {};
    const profile = root.profile && typeof root.profile === "object" ? root.profile : {};
    const sourceSections = root.sourceSections && typeof root.sourceSections === "object" ? root.sourceSections : {};
    const sourceMaterials = Array.isArray(root.sourceMaterials) ? root.sourceMaterials : [];
    const companions = Array.isArray(root.companions)
      ? root.companions
      : Array.isArray(sourceSections.companions && sourceSections.companions.items)
        ? sourceSections.companions.items
        : [];
    const image = normalizeSaucepanImageRef(firstPresent([profile.avatar, profile.image, root.avatar]));
    const profileHtml = firstPresent([profile.profileHtml, profile.profile_html, root.profileHtml, root.profile_html]);
    const rawProfilePageHtml = firstPresent([
      profile.rawProfilePageHtml,
      profile.raw_profile_page_html,
      root.rawProfilePageHtml,
      root.raw_profile_page_html,
      root.raw && root.raw.raw_profile_page_html,
    ]);
    const creatorKey = firstPresent([profile.creatorHandle, root.creatorHandle, profile.creatorId, root.creatorId]);
    return sanitizeForTransport({
      success: root.success === true,
      skipped: root.skipped === true,
      reason: root.reason || null,
      freshness: root.freshness || null,
      source: root.source || "saucepan_creator_extension",
      capturedAt: root.capturedAt || null,
      creatorId: firstPresent([root.creatorId, profile.creatorId, profile.creator_id, root.creator_id]),
      creatorHandle: firstPresent([root.creatorHandle, profile.creatorHandle, profile.creator_handle, root.creator_handle]),
      profileUrl: firstPresent([root.profileUrl, profile.profileUrl, profile.profile_url]),
      profile: {
        creatorId: firstPresent([profile.creatorId, profile.creator_id, root.creatorId]),
        creatorHandle: firstPresent([profile.creatorHandle, profile.creator_handle, root.creatorHandle]),
        displayName: firstPresent([profile.displayName, profile.display_name, profile.name, root.displayName]),
        userName: firstPresent([profile.creatorHandle, profile.creator_handle, root.creatorHandle]),
        profileUrl: firstPresent([profile.profileUrl, profile.profile_url, root.profileUrl]),
        profileTitle: firstPresent([profile.profileTitle, profile.profile_title]),
        profileSubtitle: firstPresent([profile.profileSubtitle, profile.profile_subtitle]),
        followerCount: parseIntSafe(firstPresent([profile.followerCount, profile.follower_count, root.followerCount]), null),
        followersCount: parseIntSafe(firstPresent([profile.followerCount, profile.follower_count, root.followerCount]), null),
        veryNsfw: profile.very_nsfw ?? profile.veryNsfw ?? null,
        profileImageAssetUrl: getSaucepanImageAssetUrl(image),
        avatar: image,
        description: compactText(profile.description, 12000),
        bioText: compactText(firstPresent([profile.bioText, profile.bio_text]), 12000),
        aboutMeText: compactText(firstPresent([profile.bioText, profile.bio_text, profile.description]), 12000),
        profileHtml: compactText(profileHtml, 500000),
        descriptionHtmlFile: buildRawDescriptionHtmlFile(
          "saucepan-creator",
          creatorKey,
          profileHtml,
        ),
        rawProfilePageHtmlFile: buildRawDescriptionHtmlFile("saucepan-creator-page", creatorKey, rawProfilePageHtml),
        profileCss: compactText(firstPresent([profile.profileCss, profile.profile_css]), 500000),
        profileRouxJson: profile.profileRouxJson || profile.profile_roux_json || null,
        profileStatsLabels: profile.profileStatsLabels || profile.profile_stats_labels || null,
        counts: profile.counts || root.counts || null,
        rawProfile: profile.rawProfile || profile.raw_profile || root.rawProfile || null,
      },
      characterList: {
        total: parseIntSafe(firstPresent([sourceSections.companions && sourceSections.companions.count, companions.length]), companions.length),
        pagesFetched: parseIntSafe(root.pagesFetched, 1),
        truncated: companions.length > 100,
        characters: companions.slice(0, 100).map(compactSaucepanSourceMaterialItem),
      },
      sourceMaterials: sourceMaterials.slice(0, 300).map(compactSaucepanSourceMaterialItem),
      sourceSections,
      raw: root.raw || null,
    });
  }

  function summarizeComponentFailure(root) {
    const value = root && typeof root === "object" ? root : {};
    const userMessage = firstPresent([value.userMessage, value.message]);
    if (userMessage) return String(userMessage).slice(0, 180);
    const status = firstPresent([value.status, value.characterApiStatus, value.companionApiStatus, value.definitionApiStatus]);
    const statusText = firstPresent([value.statusText, value.errorCode, value.error]);
    if (status && statusText) return `HTTP ${status}: ${String(statusText).slice(0, 140)}`;
    if (status) return `HTTP ${status}`;
    if (statusText) return String(statusText).slice(0, 160);
    if (value.interruptionDetected === true) return "source page action required";
    if (value.matchedCharacterId === false) return "character payload mismatch";
    if (value.hasDetail === false) return "detail payload missing";
    return "";
  }

  function buildComponentStatus(key, label, root, options) {
    const value = root && typeof root === "object" ? root : null;
    const opts = options && typeof options === "object" ? options : {};
    const required = opts.required === true;
    if (opts.pending === true) {
      return { key, label, status: "pending", passed: false, required, message: opts.message || "Pending" };
    }
    if (value && (value.status === "waiting_user_action" || value.status === "resuming")) {
      return {
        key,
        label,
        status: value.status,
        passed: false,
        required,
        message: summarizeComponentFailure(value) || (value.status === "resuming" ? "Continuing retrieval" : "Waiting for user action"),
      };
    }
    if (value && (value.timedOut === true || value.status === "timed_out")) {
      return {
        key,
        label,
        status: "timed_out",
        passed: false,
        required,
        message: summarizeComponentFailure(value) || "Timed out",
      };
    }
    if (value && value.actionRequired === true) {
      return {
        key,
        label,
        status: "action_required",
        passed: false,
        required,
        message: summarizeComponentFailure(value) || "Manual action required",
      };
    }
    if (value && value.skipped === true) {
      return {
        key,
        label,
        status: "skipped",
        passed: !required,
        required,
        message: value.reason || opts.skippedMessage || "Skipped",
      };
    }
    if (value && value.success === true) {
      return {
        key,
        label,
        status: "passed",
        passed: true,
        required,
        message: opts.successMessage || "Captured",
      };
    }
    if (value) {
      return {
        key,
        label,
        status: "failed",
        passed: false,
        required,
        message: summarizeComponentFailure(value) || opts.failureMessage || "Not captured",
      };
    }
    return {
      key,
      label,
      status: required ? "failed" : "skipped",
      passed: !required,
      required,
      message: opts.missingMessage || (required ? "Not captured" : "Not needed"),
    };
  }

  function buildCaptureComponentStatuses(capture) {
    const root = capture && typeof capture === "object" ? capture : {};
    const sourceKind = root.sourceKind || (root.saucepanCore ? "saucepan" : "janitor");
    if (sourceKind === "saucepan") {
      const core = buildComponentStatus("core", "Core", root.saucepanCore, {
        required: true,
        successMessage: "Saucepan core captured",
      });
      const creator = buildComponentStatus("creator", "Creator", root.saucepanCreator, {
        required: false,
        successMessage: "Creator captured",
        skippedMessage: "Creator refresh skipped",
      });
      return {
        sourceKind,
        mode: core.status === "passed" ? "core" : "failed",
        core,
        creator,
      };
    }

    const core = buildComponentStatus("core", "Core", root.janitorCore, {
      required: false,
      successMessage: "Janitor core captured",
    });
    const recovery = buildComponentStatus("recovery", "Recovery", root.janny, {
      required: false,
      successMessage: "Janny recovery captured",
      failureMessage: "Recovery not captured",
    });
    const creator = buildComponentStatus("creator", "Creator", root.creator, {
      required: false,
      successMessage: "Creator captured",
      skippedMessage: "Creator refresh skipped",
    });
    const corePassed = core.status === "passed";
    const recoveryPassed = recovery.status === "passed";
    return {
      sourceKind: "janitor",
      mode: corePassed && recoveryPassed
        ? "core_plus_recovery"
        : recoveryPassed
          ? "recovery_only"
          : corePassed
            ? "core_only"
            : "failed",
      core,
      recovery,
      creator,
    };
  }

  function summarizeRetrievedCapture(capture) {
    const root = capture && typeof capture === "object" ? capture : {};
    const janitorCore = root.janitorCore && typeof root.janitorCore === "object" ? root.janitorCore : {};
    const saucepanCore = root.saucepanCore && typeof root.saucepanCore === "object" ? root.saucepanCore : {};
    const saucepanCompanion = saucepanCore.companion && typeof saucepanCore.companion === "object" ? saucepanCore.companion : {};
    const saucepanCreator = root.saucepanCreator && typeof root.saucepanCreator === "object" ? root.saucepanCreator : {};
    const saucepanCreatorProfile = saucepanCreator.profile && typeof saucepanCreator.profile === "object" ? saucepanCreator.profile : {};
    const saucepanCreatorList =
      saucepanCreator.characterList && typeof saucepanCreator.characterList === "object" ? saucepanCreator.characterList : {};
    const janny = root.janny && typeof root.janny === "object" ? root.janny : {};
    const jannyDetail = janny.detail && typeof janny.detail === "object" ? janny.detail : {};
    const jannyCharacter = janny.character && typeof janny.character === "object" ? janny.character : {};
    const janitorCharacter = janitorCore.character && typeof janitorCore.character === "object" ? janitorCore.character : {};
    const janitorRawCharacter = janitorCharacter.rawCharacter && typeof janitorCharacter.rawCharacter === "object"
      ? janitorCharacter.rawCharacter
      : {};
    const creator = root.creator && typeof root.creator === "object" ? root.creator : {};
    const creatorProfile = creator.profile && typeof creator.profile === "object" ? creator.profile : {};
    const creatorList = creator.characterList && typeof creator.characterList === "object" ? creator.characterList : {};
    const scriptCapture = janitorCore.scripts && typeof janitorCore.scripts === "object" ? janitorCore.scripts : {};
    const scriptItems = Array.isArray(scriptCapture.items) ? scriptCapture.items : [];
    const lorebookCount = scriptItems.filter((item) => getJanitorScriptType(item) === "lorebook").length;
    const components = buildCaptureComponentStatuses(root);
    const recoveryStats =
      (jannyDetail.stats && typeof jannyDetail.stats === "object" ? jannyDetail.stats : null) ||
      (jannyCharacter.stats && typeof jannyCharacter.stats === "object" ? jannyCharacter.stats : null) ||
      {};
    const coreStats =
      (janitorCharacter.stats && typeof janitorCharacter.stats === "object" ? janitorCharacter.stats : null) ||
      (janitorRawCharacter.stats && typeof janitorRawCharacter.stats === "object" ? janitorRawCharacter.stats : null) ||
      {};
    const favoritesResponse = janitorCore.favoritesCount && typeof janitorCore.favoritesCount === "object"
      ? janitorCore.favoritesCount
      : {};
    const favoritesData = favoritesResponse.data && typeof favoritesResponse.data === "object"
      ? favoritesResponse.data
      : favoritesResponse;
    const characterId = normalizeUuid(
      firstPresent([
        root.characterId,
        root.companionId,
        saucepanCore.companionId,
        saucepanCompanion.id,
        janitorCore.characterId,
        janny.characterId,
        jannyDetail.characterId,
        jannyCharacter.id,
        janitorCharacter.id,
      ]),
    );
    const sourceKind = root.sourceKind || (saucepanCore.success === true || root.saucepanCore ? "saucepan" : "janitor");
    const sourceQuality = deriveRetrievedSourceQuality(root);
    const stats = {
      chatCount: parseIntSafe(firstPresent(sourceKind === "janitor"
        ? [coreStats.chat, coreStats.chatCount, janitorCharacter.chatCount, jannyDetail.chatCount, recoveryStats.chatCount]
        : [saucepanCompanion.stats && saucepanCompanion.stats.chatCount]), null),
      messageCount: parseIntSafe(firstPresent(sourceKind === "janitor"
        ? [coreStats.message, coreStats.messageCount, janitorCharacter.messageCount, jannyDetail.messageCount, recoveryStats.messageCount]
        : []), null),
      viewCount: parseIntSafe(firstPresent([jannyDetail.viewCount, recoveryStats.viewCount]), null),
      downloadCount: parseIntSafe(firstPresent([jannyDetail.downloadCount, recoveryStats.downloadCount]), null),
      bookmarkCount: parseIntSafe(firstPresent(sourceKind === "janitor"
        ? [favoritesData.favoritesCount, favoritesResponse.favoritesCount, jannyDetail.bookmarkCount, recoveryStats.bookmarkCount]
        : [saucepanCompanion.stats && saucepanCompanion.stats.favoriteCount]), null),
      interactionCount: parseIntSafe(saucepanCompanion.stats && saucepanCompanion.stats.interactionCount, null),
    };
    return {
      id: characterId,
      sourceKind,
      title: firstPresent([saucepanCompanion.displayName, saucepanCompanion.name, jannyDetail.name, jannyCharacter.name, janitorCharacter.name, "Unknown character"]),
      author: firstPresent([
        saucepanCreatorProfile.displayName,
        saucepanCompanion.creatorName,
        saucepanCompanion.creatorHandle,
        jannyDetail.creatorName,
        jannyCharacter.creatorName,
        janitorCharacter.creatorName,
      ]),
      authorId: firstPresent([
        saucepanCreator.creatorHandle,
        saucepanCreatorProfile.creatorHandle,
        saucepanCompanion.creatorHandle,
        saucepanCompanion.creatorId,
        jannyDetail.creatorId,
        jannyCharacter.creatorId,
        janitorCharacter.creatorId,
      ]),
      capturedAt: parseTimestamp(root.capturedAt) || new Date().toISOString(),
      pageUrl: firstPresent([
        saucepanCore.pageUrl,
        saucepanCompanion.pageUrl,
        janitorCore.pageUrl,
        root.pageUrl,
        sourceKind === "saucepan" && characterId ? `${SAUCEPAN_BASE}/companion/${characterId}` : null,
        characterId ? `https://janitorai.com/characters/${characterId}` : null,
      ]),
      jannyUrl: firstPresent([janny.characterUrl, jannyDetail.characterUrl, jannyDetail.canonicalUrl]),
      coreCaptured: sourceKind === "saucepan" ? saucepanCore.success === true : janitorCore.success === true,
      saucepanCaptured: saucepanCore.success === true,
      jannyCaptured: janny.success === true,
      sourceQuality,
      components,
      componentMode: components.mode,
      totalToken: parseIntSafe(firstPresent([
        jannyDetail.totalToken,
        jannyCharacter.totalToken,
        saucepanCompanion.tokenCounts && saucepanCompanion.tokenCounts.total_tokens,
        saucepanCompanion.tokenCounts && saucepanCompanion.tokenCounts.totalTokens,
        saucepanCompanion.tokenCounts && saucepanCompanion.tokenCounts.total,
      ]), null) ?? deriveSaucepanComponentTotalTokens(saucepanCompanion.tokenCounts),
      permanentToken: parseIntSafe(firstPresent([
        jannyDetail.permanentToken,
        saucepanCompanion.tokenCounts && saucepanCompanion.tokenCounts.permanent_tokens,
        saucepanCompanion.tokenCounts && saucepanCompanion.tokenCounts.permanentTokens,
        saucepanCompanion.tokenCounts && saucepanCompanion.tokenCounts.permanent,
      ]), null),
      isNsfw: sourceKind === "janitor"
        ? firstPresent([
            janitorCharacter.isNsfw,
            janitorCharacter.is_nsfw,
            janitorRawCharacter.isNsfw,
            janitorRawCharacter.is_nsfw,
            jannyDetail.isNsfw,
            jannyCharacter.isNsfw,
          ])
        : saucepanCompanion.isNsfw,
      tags: normalizeTags(firstPresent([
        saucepanCompanion.tags,
        janitorCharacter.tags,
        janitorRawCharacter.tags,
        jannyDetail.tags,
      ])),
      stats,
      texts: {
        description: compactText(firstPresent([saucepanCompanion.fullDescription, jannyDetail.descriptionText]), 8000),
        personality: compactText(jannyDetail.personalityText, 8000),
        scenario: compactText(jannyDetail.scenarioText, 8000),
        firstMessage: compactText(firstPresent([saucepanCompanion.firstMessageText, jannyDetail.firstMessageText, janitorCore.extractedFirstMessage]), 8000),
        exampleDialogs: compactText(jannyDetail.exampleDialogsText, 12000),
      },
      creator: {
        captured: sourceKind === "saucepan" ? saucepanCreator.success === true : creator.success === true,
        id: firstPresent([saucepanCreator.creatorId, saucepanCreatorProfile.creatorId, creator.creatorId, creatorProfile.creatorId, jannyDetail.creatorId, janitorCharacter.creatorId]),
        handle: firstPresent([saucepanCreator.creatorHandle, saucepanCreatorProfile.creatorHandle]),
        name: firstPresent([saucepanCreatorProfile.displayName, creatorProfile.userName, creatorProfile.displayName, jannyDetail.creatorName, janitorCharacter.creatorName]),
        profileUrl: firstPresent([saucepanCreator.profileUrl, saucepanCreatorProfile.profileUrl, creator.profileUrl, creatorProfile.profileUrl]),
        followersCount: parseIntSafe(firstPresent([saucepanCreatorProfile.followersCount, creatorProfile.followersCount]), null),
        isVerified: creatorProfile.isVerified,
        aboutMeText: compactText(firstPresent([saucepanCreatorProfile.aboutMeText, creatorProfile.aboutMeText]), 8000),
        characterTotal: parseIntSafe(firstPresent([saucepanCreatorList.total, creatorList.total]), null),
        charactersFetched: Array.isArray(saucepanCreatorList.characters)
          ? saucepanCreatorList.characters.length
          : Array.isArray(creatorList.characters) ? creatorList.characters.length : 0,
        pagesFetched: parseIntSafe(firstPresent([saucepanCreatorList.pagesFetched, creatorList.pagesFetched]), 0),
      },
      scripts: {
        captured: scriptCapture.success === true,
        count: parseIntSafe(firstPresent([scriptCapture.scriptCount, scriptItems.length]), 0),
        lorebookCount: parseIntSafe(firstPresent([scriptCapture.lorebookCount, lorebookCount]), 0),
        otherScriptCount: parseIntSafe(
          firstPresent([scriptCapture.otherScriptCount, Math.max(0, scriptItems.length - lorebookCount)]),
          0,
        ),
      },
    };
  }

  function compactRetrievedCapture(capture) {
    const root = capture && typeof capture === "object" ? capture : {};
    const janitorCore = root.janitorCore && typeof root.janitorCore === "object" ? root.janitorCore : {};
    const saucepanCore = root.saucepanCore && typeof root.saucepanCore === "object" ? root.saucepanCore : null;
    const saucepanCreator = root.saucepanCreator && typeof root.saucepanCreator === "object" ? root.saucepanCreator : null;
    const generateAlpha = janitorCore.generateAlpha && typeof janitorCore.generateAlpha === "object" ? janitorCore.generateAlpha : {};
    const janny = root.janny && typeof root.janny === "object" ? root.janny : {};
    const jannyDetail = janny.detail && typeof janny.detail === "object" ? janny.detail : null;
    const creator = root.creator && typeof root.creator === "object" ? root.creator : null;
    const scriptsCapture = janitorCore.scripts && typeof janitorCore.scripts === "object" ? janitorCore.scripts : null;
    const capturedPrompt = compactJanitorGenerateAlphaCapturedPrompt(generateAlpha);
    const hiddenDefinition = extractJanitorDefinitionFromCapturedPrompt(capturedPrompt);
    const definitionFlags = readJanitorDefinitionFlags(janitorCore.character, janitorCore);
    const retrievalCompleteness = buildJanitorRetrievalCompleteness(definitionFlags, hiddenDefinition);
    const compacted = sanitizeForTransport({
      schemaVersion: root.schemaVersion || 1,
      source: root.source || "source-vault-sidebar",
      sourceKind: root.sourceKind || (saucepanCore ? "saucepan" : "janitor"),
      components: buildCaptureComponentStatuses(root),
      capturedAt: root.capturedAt || null,
      characterId: root.characterId || null,
      companionId: root.companionId || (saucepanCore && saucepanCore.companionId) || null,
      janitorCore: {
        success: janitorCore.success === true,
        source: janitorCore.source || null,
        capturedAt: janitorCore.capturedAt || null,
        characterId: janitorCore.characterId || null,
        pageUrl: janitorCore.pageUrl || null,
        auth: janitorCore.auth || null,
        character: janitorCore.character
          ? compactJanitorCoreCharacter(janitorCore.character, hiddenDefinition, definitionFlags, retrievalCompleteness)
          : null,
        characterApiStatus: janitorCore.characterApiStatus || null,
        characterApiOk: janitorCore.characterApiOk ?? null,
        characterReadMethod: janitorCore.characterReadMethod || null,
        scripts: scriptsCapture ? compactJanitorScriptsCapture(scriptsCapture) : null,
        favoritesCount: janitorCore.favoritesCount || null,
        persona: janitorCore.persona || null,
        chat: janitorCore.chat || null,
        extractedFirstMessage: compactText(janitorCore.extractedFirstMessage, 8000),
        generateAlpha: {
          success: generateAlpha.success === true,
          status: generateAlpha.status || null,
          statusText: generateAlpha.statusText || null,
          rawLength: generateAlpha.rawLength || (generateAlpha.rawResponse ? String(generateAlpha.rawResponse).length : null),
          chunkCount: generateAlpha.chunkCount || null,
          rawResponse: compactText(generateAlpha.rawResponse, 500000),
          capturedPrompt,
          hiddenDefinition: hiddenDefinition
            ? {
                method: hiddenDefinition.method || null,
                format: hiddenDefinition.format || null,
                charBlockLength: hiddenDefinition.charBlock ? String(hiddenDefinition.charBlock).length : 0,
                scenarioLength: hiddenDefinition.scenario ? String(hiddenDefinition.scenario).length : 0,
                firstMessageLength: hiddenDefinition.firstMessage ? String(hiddenDefinition.firstMessage).length : 0,
                exampleDialogsLength: hiddenDefinition.exampleDialogs ? String(hiddenDefinition.exampleDialogs).length : 0,
                rawSystemPromptLength: hiddenDefinition.rawSystemPromptLength || null,
              }
            : null,
        },
      },
      janny: {
        success: janny.success === true,
        source: janny.source || null,
        capturedAt: janny.capturedAt || null,
        characterId: janny.characterId || null,
        characterUrl: janny.characterUrl || null,
        status: janny.status || null,
        finalUrl: janny.finalUrl || null,
        contentType: janny.contentType || null,
        error: janny.error || null,
        userMessage: janny.userMessage || null,
        notFound: janny.notFound === true,
        timedOut: janny.timedOut === true,
        skipped: janny.skipped === true,
        skipReason: janny.skipReason || null,
        recoveryJobId: janny.recoveryJobId || null,
        interruptionDetected: janny.interruptionDetected === true,
        interruptionScore: janny.interruptionScore || 0,
        interruptionSignals: Array.isArray(janny.interruptionSignals) ? janny.interruptionSignals.slice(0, 20) : [],
        matchedCharacterId: janny.matchedCharacterId ?? null,
        hasDetail: janny.hasDetail ?? null,
        character: janny.character || null,
        detail: jannyDetail
          ? {
              hasDetail: jannyDetail.hasDetail === true,
              characterId: jannyDetail.characterId || null,
              canonicalUrl: jannyDetail.canonicalUrl || null,
              characterUrl: jannyDetail.characterUrl || null,
              name: jannyDetail.name || null,
              creatorId: jannyDetail.creatorId || null,
              creatorName: jannyDetail.creatorName || null,
              creatorUrl: jannyDetail.creatorUrl || null,
              avatarUrl: jannyDetail.avatarUrl || null,
              isNsfw: jannyDetail.isNsfw,
              isLowQuality: jannyDetail.isLowQuality,
              permanentToken: jannyDetail.permanentToken,
              totalToken: jannyDetail.totalToken,
              chatCount: jannyDetail.chatCount,
              messageCount: jannyDetail.messageCount,
              viewCount: jannyDetail.viewCount,
              downloadCount: jannyDetail.downloadCount,
              bookmarkCount: jannyDetail.bookmarkCount,
              descriptionText: compactText(jannyDetail.descriptionText, 8000),
              personalityText: compactText(jannyDetail.personalityText, 8000),
              scenarioText: compactText(jannyDetail.scenarioText, 8000),
              firstMessageText: compactText(jannyDetail.firstMessageText, 8000),
              exampleDialogsText: compactText(jannyDetail.exampleDialogsText, 12000),
              tags: jannyDetail.tags || null,
              tagIds: jannyDetail.tagIds || null,
              createdAtSource: jannyDetail.createdAtSource || null,
              stats: jannyDetail.stats || null,
            }
          : null,
      },
      creator: creator ? compactJanitorCreatorCapture(creator) : null,
      saucepanCore: saucepanCore ? compactSaucepanCoreCapture(saucepanCore) : null,
      saucepanCreator: saucepanCreator ? compactSaucepanCreatorCapture(saucepanCreator) : null,
    });
    return scrubJanitorCapturePersonaAliases(compacted);
  }

  function buildStoredRetrievedCharacter(capture, previous) {
    const candidates = getExtractionPersonaReplacementCandidates(capture);
    const summary = replaceExtractionPersonaAliasesInValue(
      summarizeRetrievedCapture(capture),
      candidates,
    );
    if (!summary.id) return null;
    const savedAt =
      previous && previous.savedAt
        ? parseTimestamp(previous.savedAt) || previous.savedAt
        : summary.capturedAt || new Date().toISOString();
    return {
      id: summary.id,
      savedAt,
      updatedAt: new Date().toISOString(),
      summary,
      capture: compactRetrievedCapture(capture),
    };
  }

  function sanitizeForTransport(value, depth) {
    const maxDepth = Number.isFinite(depth) ? depth : 0;
    if (value == null) return value;
    if (maxDepth > 12) return "[depth-limit]";
    if (typeof value === "string") return value.length > 500000 ? `${value.slice(0, 500000)}... [truncated]` : value;
    if (typeof value !== "object") return value;
    if (Array.isArray(value)) {
      return value.slice(0, 2000).map((item) => sanitizeForTransport(item, maxDepth + 1));
    }
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const keyLower = String(key || "").toLowerCase();
      const isSafeTokenCountKey =
        keyLower === "totaltoken" ||
        keyLower === "totaltokens" ||
        keyLower === "total_tokens" ||
        keyLower === "permanenttoken" ||
        keyLower === "permanent_token";
      const shouldRedact =
        !isSafeTokenCountKey &&
        (
        keyLower.includes("access_token") ||
          keyLower === "token" ||
          keyLower.endsWith("token") ||
          keyLower.includes("authorization") ||
          keyLower.includes("cookie") ||
          keyLower.includes("apikey") ||
          keyLower.includes("api_key") ||
          keyLower.includes("proxykey") ||
          keyLower.includes("secret")
        );
      if (shouldRedact) {
        out[key] = "[redacted]";
        continue;
      }
      out[key] = sanitizeForTransport(item, maxDepth + 1);
    }
    return out;
  }

  const api = {
    STRICT_UUID_RE,
    UUID_RE,
    buildStoredRetrievedCharacter,
    buildExtractionPersonaReplacementCandidates,
    buildCaptureComponentStatuses,
    buildJannyTavernPayload,
    compactJanitorCoreCharacter,
    compactJanitorCreatorCapture,
    compactSaucepanCoreCapture,
    compactSaucepanCreatorCapture,
    deriveCharacterSourceQuality,
    deriveRetrievedSourceQuality,
    decodeSaucepanFragmentContent,
    decodeSaucepanStartingScenarioFragments,
    compactLorebookEntryIndex,
    compactJanitorScriptsCapture,
    compactRetrievedCapture,
    decodeAstroValue,
    decodeHtmlEntities,
    extractJannyCharacterButtonsProps,
    normalizeJannyAvatarUrl,
    normalizeJanitorAssetUrl,
    normalizeSourceKind,
    normalizeExtractionPersonaAlias,
    normalizeSaucepanOpenDefinitionPayload,
    normalizeSaucepanImageRef,
    normalizeUuid,
    parseJanitorCharacterUrl,
    parseJanitorCreatorProfileHtml,
    parseJanitorCreatorUrl,
    parseJannyCharacterHtml,
    parseJannyCharacterUrl,
    parseSaucepanCompanionUrl,
    parseSaucepanCreatorUrl,
    pickJanitorCharacterStore,
    sanitizeForTransport,
    getExtractionPersonaReplacementCandidates,
    replaceExtractionPersonaAliasesInText,
    replaceExtractionPersonaAliasesInValue,
    scrubJanitorCapturePersonaAliases,
    scrubStoredRetrievedCharacterPersonaAliases,
    getJanitorScriptType,
    hasSourceInterruptionHtml,
    classifySourceInterruptionHtml,
    isJannyCharacterNotFoundHtml,
    isGenericSourceCharacterTitle,
    isSettledSourceCharacterState,
    isUnsettledSourceCharacterSource,
    stripTags,
    summarizeJanitorCharacterStore,
    summarizeRetrievedCapture,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  globalScope.SourceVaultCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
