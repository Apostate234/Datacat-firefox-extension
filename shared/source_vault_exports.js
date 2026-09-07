(function initSourceVaultExports(globalScope) {
  "use strict";

  const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const MAX_IMAGE_PIXELS = 24 * 1024 * 1024;
  const IMAGE_FETCH_TIMEOUT_MS = 15000;

  function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function firstPresent(values) {
    for (const value of Array.isArray(values) ? values : []) {
      if (value === null || value === undefined || value === "") continue;
      return value;
    }
    return null;
  }

  function cleanText(value, maxLength = 500000) {
    if (value === null || value === undefined) return "";
    const text = String(value).replace(/\r\n?/g, "\n").trim();
    return text.length > maxLength ? text.slice(0, maxLength) : text;
  }

  function stripHtml(value) {
    const core = globalScope && globalScope.SourceVaultCore;
    if (core && typeof core.stripTagsPreservingBreaks === "function") {
      return cleanText(core.stripTagsPreservingBreaks(value));
    }
    if (core && typeof core.stripTags === "function") return cleanText(core.stripTags(value));
    return cleanText(String(value || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n"));
  }

  const JANITOR_ATTRIBUTION_LINE_RE = /^(?:created\s+by\b.+?\s*)?(?:(?:\d{4}\s*)?(?:\u00a9|\(c\)|&copy;|&#169;|&#x0*a9;)\s*)?on\s+janitorai\.com"?$/i;
  const JANITOR_ATTRIBUTION_HTML_BLOCK_RE = /<\s*(p|div|span)[^>]*>\s*(?:created\s+by\b[^<\r\n]*?\s*)?(?:(?:\d{4}\s*)?(?:\u00a9|\(c\)|&copy;|&#169;|&#x0*a9;)\s*)?on\s+janitorai\.com"?\s*<\s*\/\s*\1\s*>/gi;
  const JANITOR_ATTRIBUTION_TRAILING_RE = /(?:\s|<br\s*\/?>)*(?:(?:created\s+by\b[^<\r\n]*?\s*)|(?:(?:\d{4}\s*)?(?:\u00a9|\(c\)|&copy;|&#169;|&#x0*a9;)\s*))on\s+janitorai\.com"?\s*$/i;
  const CREATOR_NOTES_ALLOWED_HTML_TAGS = new Set([
    "a", "b", "blockquote", "br", "code", "del", "details", "div", "em",
    "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "mark",
    "ol", "p", "pre", "s", "small", "span", "strong", "sub", "summary", "sup",
    "table", "tbody", "td", "th", "thead", "tr", "u", "ul",
  ]);
  const CREATOR_NOTES_VOID_HTML_TAGS = new Set(["br", "hr", "img"]);
  const CREATOR_NOTES_ALLOWED_STYLE_PROPS = new Set([
    "aspect-ratio", "background", "background-color", "border", "border-bottom",
    "border-color", "border-left", "border-radius", "border-right", "border-style",
    "border-top", "border-width", "box-shadow", "color", "display", "font-family",
    "font-size", "font-style", "font-weight", "height", "letter-spacing", "line-height",
    "margin", "margin-bottom", "margin-left", "margin-right", "margin-top", "max-height",
    "max-width", "min-height", "min-width", "object-fit", "object-position", "opacity",
    "padding", "padding-bottom", "padding-left", "padding-right", "padding-top",
    "text-align", "text-decoration", "text-decoration-color", "text-indent",
    "vertical-align", "white-space", "width",
  ]);

  function stripJanitorAttributionArtifact(value) {
    if (value == null) return "";
    const original = String(value);
    let changed = false;
    const withoutHtmlBlock = original.replace(JANITOR_ATTRIBUTION_HTML_BLOCK_RE, () => {
      changed = true;
      return "";
    });
    const withoutTrailing = withoutHtmlBlock.replace(JANITOR_ATTRIBUTION_TRAILING_RE, () => {
      changed = true;
      return "";
    });
    const filtered = withoutTrailing.split(/\r?\n/).filter((line) => {
      const lineText = String(line || "").replace(/<[^>]+>/g, "").trim();
      const shouldStrip = JANITOR_ATTRIBUTION_LINE_RE.test(lineText);
      if (shouldStrip) changed = true;
      return !shouldStrip;
    });
    if (!changed) return original;
    return filtered.join("\n")
      .replace(/<\s*(p|div|span)[^>]*>\s*<\s*\/\s*\1\s*>/gi, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizeJanitorExportText(value) {
    if (value == null) return "";
    return stripJanitorAttributionArtifact(String(value))
      .replace(/\r\n?/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
  }

  function decodeBasicHtmlEntities(value) {
    if (value == null) return "";
    return String(value)
      .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
        const code = Number.parseInt(hex, 16);
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
      })
      .replace(/&#(\d+);/g, (match, dec) => {
        const code = Number.parseInt(dec, 10);
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
      })
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&apos;/gi, "'");
  }

  function escapeHtmlAttrValue(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/\"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function getHtmlTagAttributes(tag) {
    const attrs = {};
    String(tag || "").replace(/\s([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g, (match, rawName, doubleQuoted, singleQuoted, bare) => {
      const name = String(rawName || "").trim().toLowerCase();
      if (name) attrs[name] = doubleQuoted ?? singleQuoted ?? bare ?? "";
      return "";
    });
    return attrs;
  }

  function normalizeSafeUrl(value, { allowRelative = false } = {}) {
    let url = decodeBasicHtmlEntities(value || "").trim();
    if (!url) return "";
    if (url.startsWith("//")) url = `https:${url}`;
    if (/^https?:\/\//i.test(url)) return url;
    if (allowRelative && /^\/(?!\/)/.test(url)) return url;
    return "";
  }

  function sanitizeStyleAttribute(style) {
    if (!style) return "";
    const safeParts = [];
    String(style).split(";").forEach((part) => {
      const idx = part.indexOf(":");
      if (idx <= 0) return;
      const prop = part.slice(0, idx).trim().toLowerCase();
      const value = part.slice(idx + 1).trim();
      if (!prop || !value || !CREATOR_NOTES_ALLOWED_STYLE_PROPS.has(prop)) return;
      if (/url\s*\(|expression\s*\(|javascript\s*:|vbscript\s*:|data\s*:/i.test(value)) return;
      if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value)) return;
      safeParts.push(`${prop}: ${value.slice(0, 240)}`);
    });
    return safeParts.join("; ");
  }

  function sanitizeDimensionAttr(value) {
    const raw = decodeBasicHtmlEntities(value || "").trim();
    if (!raw || raw.length > 32) return "";
    return /^(?:auto|\d{1,5}(?:\.\d{1,2})?(?:px|%|em|rem|vh|vw)?)$/i.test(raw) ? raw : "";
  }

  function pushSafeAttr(parts, name, value, maxLength = 1000) {
    const raw = value == null ? "" : decodeBasicHtmlEntities(value).trim();
    if (raw) parts.push(`${name}="${escapeHtmlAttrValue(raw.slice(0, maxLength))}"`);
  }

  function sanitizeCreatorNotesImgTag(tag) {
    const attrs = getHtmlTagAttributes(tag);
    const src = normalizeSafeUrl(attrs.src || "");
    if (!src) return "";
    const safeAttrs = [`src="${escapeHtmlAttrValue(src)}"`];
    pushSafeAttr(safeAttrs, "alt", attrs.alt || "", 500);
    pushSafeAttr(safeAttrs, "title", attrs.title || "", 500);
    const width = sanitizeDimensionAttr(attrs.width || "");
    const height = sanitizeDimensionAttr(attrs.height || "");
    const style = sanitizeStyleAttribute(attrs.style || "");
    if (width) safeAttrs.push(`width="${escapeHtmlAttrValue(width)}"`);
    if (height) safeAttrs.push(`height="${escapeHtmlAttrValue(height)}"`);
    if (style) safeAttrs.push(`style="${escapeHtmlAttrValue(style)}"`);
    return `<img ${safeAttrs.join(" ")}>`;
  }

  function sanitizeCreatorNotesHtmlTag(match, slash, rawName, rawAttrs) {
    const tagName = String(rawName || "").trim().toLowerCase();
    if (!CREATOR_NOTES_ALLOWED_HTML_TAGS.has(tagName)) return "";
    if (slash) return CREATOR_NOTES_VOID_HTML_TAGS.has(tagName) ? "" : `</${tagName}>`;
    if (tagName === "img") return sanitizeCreatorNotesImgTag(match);
    if (tagName === "br" || tagName === "hr") return `<${tagName}>`;
    const attrs = getHtmlTagAttributes(`<${tagName}${rawAttrs || ""}>`);
    const safeAttrs = [];
    const style = sanitizeStyleAttribute(attrs.style || "");
    if (style) safeAttrs.push(`style="${escapeHtmlAttrValue(style)}"`);
    pushSafeAttr(safeAttrs, "title", attrs.title || "", 500);
    if (attrs.align && /^(?:left|right|center|justify)$/i.test(String(attrs.align).trim())) {
      safeAttrs.push(`align="${escapeHtmlAttrValue(String(attrs.align).trim().toLowerCase())}"`);
    }
    if (tagName === "a") {
      const href = normalizeSafeUrl(attrs.href || "", { allowRelative: true });
      if (href) {
        safeAttrs.push(`href="${escapeHtmlAttrValue(href)}"`);
        safeAttrs.push('rel="noreferrer noopener"');
        if (/^https?:\/\//i.test(href)) safeAttrs.push('target="_blank"');
      }
    }
    if (tagName === "td" || tagName === "th") {
      const colspan = String(attrs.colspan || "").trim();
      const rowspan = String(attrs.rowspan || "").trim();
      if (/^\d{1,2}$/.test(colspan)) safeAttrs.push(`colspan="${colspan}"`);
      if (/^\d{1,2}$/.test(rowspan)) safeAttrs.push(`rowspan="${rowspan}"`);
    }
    return `<${tagName}${safeAttrs.length ? ` ${safeAttrs.join(" ")}` : ""}>`;
  }

  function normalizeJanitorCreatorNotesForExport(value) {
    if (value == null) return "";
    let html = String(value)
      .replace(/\r\n?/g, "\n")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<\s*(script|style|iframe|object|embed|svg|canvas|video|audio|form|button|input|select|textarea|link|meta|base)\b[^>]*>[\s\S]*?(?:<\s*\/\s*\1\s*>|$)/gi, "")
      .replace(/<\s*\/?\s*(script|style|iframe|object|embed|svg|canvas|video|audio|form|button|input|select|textarea|link|meta|base)\b[^>]*>/gi, "")
      .replace(/<\s*(\/?)\s*([a-z][a-z0-9:-]*)([^<>]*?)>/gi, sanitizeCreatorNotesHtmlTag)
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!/<\/?[a-z][a-z0-9:-]*[\s>/]/i.test(html)) {
      html = decodeBasicHtmlEntities(html)
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n[ \t]+/g, "\n")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    return normalizeJanitorExportText(html);
  }

  function normalizeTags(value) {
    const items = Array.isArray(value) ? value : value == null ? [] : [value];
    const seen = new Set();
    return items.map((item) => {
      if (typeof item === "string") return item.trim();
      const root = asObject(item);
      return String(firstPresent([root.name, root.label, root.title, root.value]) || "").trim();
    }).filter((item) => {
      const key = item.toLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function normalizeJanitorTags(regularTags, customTags) {
    const normalizeTagName = (tag) => {
      const tagName = typeof tag === "string" ? tag : asObject(tag).name || "";
      return String(tagName)
        .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
        .trim();
    };
    const regular = (Array.isArray(regularTags) ? regularTags : [])
      .map(normalizeTagName)
      .filter(Boolean);
    const custom = (Array.isArray(customTags) ? customTags : [])
      .map(normalizeTagName)
      .filter(Boolean)
      .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
    return normalizeTags([...regular, ...custom]);
  }

  function getImageUrl(value) {
    if (!value) return null;
    if (typeof value === "string") return value.trim() || null;
    const root = asObject(value);
    return firstPresent([
      root.highresUrl,
      root.highres_url,
      root.cardUrl,
      root.card_url,
      root.thumbnailUrl,
      root.thumbnail_url,
      root.imageUrl,
      root.image_url,
      root.url,
    ]);
  }

  function getRecordSourceKind(record) {
    const root = asObject(record);
    const summary = asObject(root.summary);
    const capture = asObject(root.capture);
    const normalized = String(firstPresent([summary.sourceKind, capture.sourceKind]) || "").trim().toLowerCase();
    return normalized === "sauce" || normalized === "saucepan" || capture.saucepanCore ? "saucepan" : "janitor";
  }

  function getCharacterImageUrl(record) {
    const root = asObject(record);
    const summary = asObject(root.summary);
    const capture = asObject(root.capture);
    if (getRecordSourceKind(record) === "saucepan") {
      const companion = asObject(asObject(capture.saucepanCore).companion);
      return firstPresent([
        summary.imageUrl,
        companion.profileImageAssetUrl,
        companion.avatarUrl,
        getImageUrl(companion.image),
      ]);
    }
    const character = asObject(asObject(capture.janitorCore).character);
    const janny = asObject(capture.janny);
    return firstPresent([
      summary.imageUrl,
      character.profileImageAssetUrl,
      character.avatarUrl,
      character.avatar,
      asObject(janny.detail).avatarUrl,
      asObject(janny.character).avatarUrl,
    ]);
  }

  function buildJanitorDescription(value) {
    return cleanText(value).replace(/^##\s*DESCRIPTION\s+START\s*##\s*/i, "").trim();
  }

  function getJanitorCardData(record) {
    const root = asObject(record);
    const summary = asObject(root.summary);
    const capture = asObject(root.capture);
    const core = asObject(capture.janitorCore);
    const character = asObject(core.character);
    const rawCharacter = asObject(firstPresent([character.rawCharacter, character.raw_character]));
    const sections = asObject(character.sections);
    const janny = asObject(capture.janny);
    const detail = asObject(janny.detail);
    const creator = asObject(capture.creator);
    const creatorProfile = asObject(creator.profile);
    const rawDescriptionHtml = firstPresent([
      asObject(character.descriptionHtmlFile).html,
      character.rawDescriptionHtml,
      sections.descriptionHtml,
    ]);
    const promptDefinition = firstPresent([
      sections.definitionText,
      sections.personality,
      detail.personalityText,
      asObject(summary.texts).personality,
    ]);
    const firstMessage = firstPresent([
      sections.firstMessage,
      detail.firstMessageText,
      core.extractedFirstMessage,
      asObject(summary.texts).firstMessage,
    ]);
    const firstMessages = Array.isArray(sections.firstMessages) ? sections.firstMessages : [];
    const alternateGreetings = firstMessages
      .map((item) => cleanText(asObject(item).message || item))
      .filter((item) => item && item !== cleanText(firstMessage));
    const characterId = firstPresent([root.id, summary.id, character.id, core.characterId, janny.characterId]);
    const creatorId = firstPresent([character.creatorId, summary.authorId, detail.creatorId, creator.creatorId, creatorProfile.creatorId]);
    const pageUrl = firstPresent([
      summary.pageUrl,
      core.pageUrl,
      characterId ? `https://janitorai.com/characters/${characterId}` : null,
    ]);
    const creatorUrl = firstPresent([
      creator.profileUrl,
      creatorProfile.profileUrl,
      creatorId ? `https://janitorai.com/profiles/${creatorId}` : null,
    ]);
    const chatName = firstPresent([
      character.chatName,
      character.chat_name,
      rawCharacter.chatName,
      rawCharacter.chat_name,
      detail.chatName,
      detail.chat_name,
    ]);
    const regularTags = [
      ...(Array.isArray(summary.tags) ? summary.tags : []),
      ...(Array.isArray(detail.tags) ? detail.tags : []),
      ...(Array.isArray(character.tags) ? character.tags : []),
      ...(Array.isArray(rawCharacter.tags) ? rawCharacter.tags : []),
    ];
    const customTags = [
      ...(Array.isArray(detail.customTags) ? detail.customTags : []),
      ...(Array.isArray(detail.custom_tags) ? detail.custom_tags : []),
      ...(Array.isArray(character.customTags) ? character.customTags : []),
      ...(Array.isArray(character.custom_tags) ? character.custom_tags : []),
      ...(Array.isArray(rawCharacter.customTags) ? rawCharacter.customTags : []),
      ...(Array.isArray(rawCharacter.custom_tags) ? rawCharacter.custom_tags : []),
    ];
    return {
      data: {
        name: cleanText(firstPresent([chatName, summary.title, character.name, rawCharacter.name, detail.name]) || "Unknown character", 255),
        description: buildJanitorDescription(promptDefinition),
        personality: "",
        scenario: cleanText(firstPresent([sections.scenario, detail.scenarioText, asObject(summary.texts).scenario])),
        first_mes: cleanText(firstMessage),
        mes_example: cleanText(firstPresent([sections.exampleDialogs, detail.exampleDialogsText, asObject(summary.texts).exampleDialogs])),
        creator_notes: normalizeJanitorCreatorNotesForExport(firstPresent([
          rawDescriptionHtml,
          asObject(summary.texts).description,
          detail.descriptionText,
        ])),
        system_prompt: "",
        post_history_instructions: "",
        alternate_greetings: alternateGreetings,
        character_book: null,
        tags: normalizeJanitorTags(regularTags, customTags),
        creator: creatorUrl || cleanText(firstPresent([summary.author, character.creatorName, detail.creatorName]), 255),
        character_version: cleanText(pageUrl, 1000),
        avatar: cleanText(getCharacterImageUrl(record), 2000),
      },
      metadata: {
        source_url: pageUrl || null,
        raw_description_html: rawDescriptionHtml || null,
        janitor_character_name: firstPresent([summary.title, character.name, detail.name]) || null,
        janitor_character_chatname: chatName || null,
        janitor_character_id: characterId || null,
        janitor_creator_id: creatorId || null,
        janitor_creator_name: firstPresent([summary.author, character.creatorName, detail.creatorName]) || null,
        janitor_is_nsfw: firstPresent([
          character.isNsfw,
          character.is_nsfw,
          rawCharacter.isNsfw,
          rawCharacter.is_nsfw,
          summary.isNsfw,
          detail.isNsfw,
        ]),
        janitor_is_public: firstPresent([
          character.isPublic,
          character.is_public,
          rawCharacter.isPublic,
          rawCharacter.is_public,
          summary.isPublic,
        ]),
        janitor_show_definitions: firstPresent([character.fullDefinitionRevealedByAuthor, character.full_definition_revealed_by_author]),
        janitor_allow_proxy: firstPresent([character.allowProxy, character.allow_proxy]),
      },
    };
  }

  function getSaucepanDefinitionSections(definition) {
    const root = asObject(definition);
    const payloads = [root, asObject(root.selectedDefinition), asObject(root.openDefinitionApi), asObject(root.hiddenDefinitionFallback)];
    const directFields = [
      ["card", ["card", "definitionCard", "definition_card", "companionCore", "companion_core"]],
      ["example_dialogue", ["example_dialogue", "exampleDialogue", "example_dialogues", "exampleDialogs"]],
      ["formatting_instructions", ["formatting_instructions", "formattingInstructions", "format_instructions"]],
      ["advanced_prompt", ["advanced_prompt", "advancedPrompt", "system_prompt", "systemPrompt"]],
    ];
    const titles = {
      card: "Companion Core",
      example_dialogue: "Example Dialogue",
      formatting_instructions: "Formatting Instructions",
      advanced_prompt: "Advanced Prompt",
    };
    const sections = [];
    const seen = new Set();
    function push(field, title, text) {
      const normalized = cleanText(text);
      if (!normalized) return;
      const key = `${field || ""}\n${normalized}`;
      if (seen.has(key)) return;
      seen.add(key);
      sections.push({ field: field || null, title: cleanText(title, 1000) || titles[field] || "Definition", text: normalized });
    }
    for (const payload of payloads) {
      for (const list of [payload.definitionSections, payload.decoded_sections, payload.decodedSections]) {
        if (!Array.isArray(list)) continue;
        for (const section of list) {
          const item = asObject(section);
          push(item.field, firstPresent([item.title, item.name]), firstPresent([item.text, item.content, item.value]));
        }
      }
      for (const [field, aliases] of directFields) {
        push(field, titles[field], firstPresent(aliases.map((alias) => payload[alias])));
      }
    }
    return sections;
  }

  function formatSaucepanSections(sections) {
    return (Array.isArray(sections) ? sections : [])
      .map((item) => `${item.title || item.field || "Definition"}\n\n${item.text || ""}`.trim())
      .filter(Boolean)
      .join("\n\n---\n\n");
  }

  function appendDefinitionSection(base, label, extra) {
    const normalizedBase = cleanText(base);
    const normalizedExtra = cleanText(extra);
    if (!normalizedExtra) return normalizedBase;
    if (!normalizedBase) return `## ${label}\n${normalizedExtra}`;
    if (normalizedBase.replace(/\s+/g, " ").toLowerCase().includes(normalizedExtra.replace(/\s+/g, " ").toLowerCase())) {
      return normalizedBase;
    }
    return `${normalizedBase}\n\n## ${label}\n${normalizedExtra}`;
  }

  function getSaucepanCardData(record) {
    const root = asObject(record);
    const summary = asObject(root.summary);
    const capture = asObject(root.capture);
    const core = asObject(capture.saucepanCore);
    const companion = asObject(core.companion);
    const definition = asObject(core.definition);
    const creator = asObject(capture.saucepanCreator);
    const creatorProfile = asObject(creator.profile);
    const sections = getSaucepanDefinitionSections(definition);
    const byField = (field) => formatSaucepanSections(sections.filter((item) => String(item.field || "").toLowerCase() === field));
    let description = byField("card") || formatSaucepanSections(sections.filter((item) => !String(item.field || "").includes("example")));
    const formatting = byField("formatting_instructions");
    const example = byField("example_dialogue");
    const advanced = byField("advanced_prompt");
    description = appendDefinitionSection(description, "RESPONSE FORMATTING INSTRUCTIONS", formatting);
    description = appendDefinitionSection(description, "EXAMPLE DIALOGUE", example);
    description = appendDefinitionSection(description, "ADVANCED PROMPT", advanced);
    const scenarios = Array.isArray(companion.startingScenarios)
      ? companion.startingScenarios
      : Array.isArray(definition.startingScenarios) ? definition.startingScenarios : [];
    const scenarioMessages = scenarios.map((item) => cleanText(firstPresent([
      asObject(item).message,
      asObject(item).first_message,
      asObject(item).firstMessage,
      asObject(item).text,
      typeof item === "string" ? item : null,
    ]))).filter(Boolean);
    const rawDescriptionHtml = firstPresent([
      asObject(companion.descriptionHtmlFile).html,
      companion.rawDescriptionHtml,
    ]);
    const characterId = firstPresent([root.id, summary.id, companion.id, core.companionId]);
    const pageUrl = firstPresent([
      summary.pageUrl,
      core.pageUrl,
      companion.pageUrl,
      characterId ? `https://saucepan.ai/companion/${characterId}` : null,
    ]);
    return {
      data: {
        name: cleanText(firstPresent([summary.title, companion.displayName, companion.name]) || "Unknown character", 255),
        description: cleanText(description),
        personality: "",
        scenario: "",
        first_mes: cleanText(firstPresent([companion.firstMessageText, scenarioMessages[0]])),
        mes_example: "",
        creator_notes: stripHtml(firstPresent([rawDescriptionHtml, companion.fullDescription, companion.shortDescription])),
        system_prompt: cleanText(advanced),
        post_history_instructions: "",
        alternate_greetings: scenarioMessages.slice(1),
        character_book: null,
        tags: normalizeTags([
          ...(Array.isArray(summary.tags) ? summary.tags : []),
          ...(Array.isArray(companion.tags) ? companion.tags : []),
          ...(Array.isArray(companion.fandomTags) ? companion.fandomTags : []),
        ]),
        creator: cleanText(firstPresent([
          creatorProfile.displayName,
          companion.creatorName,
          companion.creatorHandle,
          summary.author,
        ]), 255),
        character_version: "saucepan_import_v1",
        avatar: cleanText(getCharacterImageUrl(record), 2000),
      },
      metadata: {
        source_url: pageUrl || null,
        raw_description_html: rawDescriptionHtml || null,
        saucepan_character_id: characterId || null,
        saucepan_creator_id: firstPresent([creator.creatorId, creatorProfile.creatorId, companion.creatorId]) || null,
        saucepan_creator_handle: firstPresent([creator.creatorHandle, creatorProfile.creatorHandle, companion.creatorHandle]) || null,
        saucepan_definition_state: firstPresent([core.definitionState, asObject(definition.status).definitionState]) || null,
      },
    };
  }

  function buildCharacterCard(record) {
    const core = globalScope && globalScope.SourceVaultCore;
    const root = asObject(
      core && typeof core.scrubStoredRetrievedCharacterPersonaAliases === "function"
        ? core.scrubStoredRetrievedCharacterPersonaAliases(record)
        : record,
    );
    if (!root.id || !root.capture) throw new Error("local_character_record_invalid");
    const sourceKind = getRecordSourceKind(root);
    const built = sourceKind === "saucepan" ? getSaucepanCardData(root) : getJanitorCardData(root);
    const summary = asObject(root.summary);
    const capturedAt = Date.parse(summary.capturedAt || root.savedAt || "");
    const capturedUnix = Number.isFinite(capturedAt) ? Math.floor(capturedAt / 1000) : Math.floor(Date.now() / 1000);
    const card = {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        ...built.data,
      },
      metadata: {
        ...built.metadata,
        version: "1.0.0",
        created: capturedUnix,
        modified: capturedUnix,
        tool: {
          name: "Datacat.run",
          version: "0.45",
          url: "https://datacat.run",
        },
      },
    };
    const projector = globalScope && globalScope.CharacterCardPublicExport;
    if (!projector || typeof projector.projectPublicCharacterCard !== "function") {
      throw new Error("character_card_public_export_unavailable");
    }
    return projector.projectPublicCharacterCard(card);
  }

  function sanitizeFileName(value, fallback = "character") {
    const cleaned = String(value || "")
      .normalize("NFKC")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "")
      .slice(0, 120);
    return cleaned || fallback;
  }

  function utf8Bytes(value) {
    return new TextEncoder().encode(String(value == null ? "" : value));
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  }

  function readUint32(bytes, offset) {
    return (((bytes[offset] << 24) >>> 0) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  }

  function writeUint32(bytes, offset, value) {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function concatBytes(chunks) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }

  function createPngChunk(type, data) {
    const typeBytes = utf8Bytes(type);
    const body = data instanceof Uint8Array ? data : new Uint8Array(data || []);
    const chunk = new Uint8Array(12 + body.length);
    writeUint32(chunk, 0, body.length);
    chunk.set(typeBytes, 4);
    chunk.set(body, 8);
    writeUint32(chunk, 8 + body.length, crc32(concatBytes([typeBytes, body])));
    return chunk;
  }

  function createPngTextChunk(keyword, value) {
    return createPngChunk("tEXt", concatBytes([utf8Bytes(keyword), new Uint8Array([0]), utf8Bytes(value)]));
  }

  function hasPngSignature(bytes) {
    return bytes && bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
  }

  function getPngTextKeyword(chunk) {
    const length = readUint32(chunk, 0);
    const type = new TextDecoder("latin1").decode(chunk.subarray(4, 8));
    if (type !== "tEXt" && type !== "iTXt") return null;
    const data = chunk.subarray(8, 8 + length);
    const end = data.indexOf(0);
    return end < 0 ? null : new TextDecoder("latin1").decode(data.subarray(0, end)).toLowerCase();
  }

  function embedCharacterCardInPng(pngBytes, card) {
    const bytes = pngBytes instanceof Uint8Array ? pngBytes : new Uint8Array(pngBytes || []);
    if (!hasPngSignature(bytes)) throw new Error("character_image_not_png");
    const chunks = [];
    let offset = PNG_SIGNATURE.length;
    let foundIend = false;
    while (offset + 12 <= bytes.length) {
      const length = readUint32(bytes, offset);
      const end = offset + 12 + length;
      if (end > bytes.length) throw new Error("character_png_chunk_invalid");
      const chunk = bytes.slice(offset, end);
      const type = new TextDecoder("latin1").decode(chunk.subarray(4, 8));
      const keyword = getPngTextKeyword(chunk);
      if (type === "IEND") {
        const v2Json = JSON.stringify(card);
        chunks.push(createPngTextChunk("chara", bytesToBase64(utf8Bytes(v2Json))));
        chunks.push(chunk);
        foundIend = true;
        break;
      }
      if (!["chara", "ccv3", "character", "charactercard"].includes(keyword)) chunks.push(chunk);
      offset = end;
    }
    if (!foundIend) throw new Error("character_png_iend_missing");
    return concatBytes([PNG_SIGNATURE, ...chunks]);
  }

  async function convertBlobToPngBytes(blob) {
    const sourceBytes = new Uint8Array(await blob.arrayBuffer());
    if (hasPngSignature(sourceBytes)) return sourceBytes;
    if (typeof createImageBitmap !== "function") throw new Error("character_image_conversion_unavailable");
    const bitmap = await createImageBitmap(blob);
    let width = Math.max(1, Number(bitmap.width) || 1);
    let height = Math.max(1, Number(bitmap.height) || 1);
    const pixels = width * height;
    if (pixels > MAX_IMAGE_PIXELS) {
      const scale = Math.sqrt(MAX_IMAGE_PIXELS / pixels);
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }
    let outputBlob;
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("character_image_canvas_unavailable");
      context.drawImage(bitmap, 0, 0, width, height);
      outputBlob = await canvas.convertToBlob({ type: "image/png" });
    } else if (globalScope && globalScope.document) {
      const canvas = globalScope.document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("character_image_canvas_unavailable");
      context.drawImage(bitmap, 0, 0, width, height);
      outputBlob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("character_image_png_failed")), "image/png"));
    } else {
      throw new Error("character_image_canvas_unavailable");
    }
    if (typeof bitmap.close === "function") bitmap.close();
    return new Uint8Array(await outputBlob.arrayBuffer());
  }

  async function fetchImageAsPngBytes(imageUrl, fallbackDataUrl = null, fetchImpl = null) {
    const fetcher = fetchImpl || (globalScope && globalScope.fetch);
    if (typeof fetcher !== "function") throw new Error("character_image_fetch_unavailable");
    const candidates = [imageUrl, fallbackDataUrl].filter(Boolean);
    let lastError = null;
    for (const candidate of candidates) {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS) : null;
      try {
        const response = await fetcher(candidate, {
          method: "GET",
          credentials: "omit",
          cache: "force-cache",
          signal: controller ? controller.signal : undefined,
        });
        if (!response || !response.ok) throw new Error(`character_image_http_${response ? response.status : "unknown"}`);
        const blob = await response.blob();
        if (!String(blob.type || "").toLowerCase().startsWith("image/")) throw new Error("character_image_invalid_type");
        return await convertBlobToPngBytes(blob);
      } catch (error) {
        lastError = error;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    throw lastError || new Error("character_image_unavailable");
  }

  function writeZipUint16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function writeZipUint32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  function getDosDateTime(value) {
    const date = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();
    const year = Math.max(1980, date.getFullYear());
    return {
      time: ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((Math.floor(date.getSeconds() / 2)) & 31),
      date: (((year - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31),
    };
  }

  function buildStoredZip(files, modifiedAt = new Date()) {
    const normalized = (Array.isArray(files) ? files : []).map((file) => ({
      nameBytes: utf8Bytes(String(file && file.name || "file")),
      data: file && file.data instanceof Uint8Array ? file.data : utf8Bytes(file && file.data || ""),
    }));
    if (!normalized.length) throw new Error("download_zip_empty");
    if (normalized.length > 65535) throw new Error("download_zip_too_many_files");
    const stamp = getDosDateTime(modifiedAt);
    const localChunks = [];
    const centralChunks = [];
    let localOffset = 0;
    for (const file of normalized) {
      const checksum = crc32(file.data);
      const local = new Uint8Array(30 + file.nameBytes.length);
      const localView = new DataView(local.buffer);
      writeZipUint32(localView, 0, 0x04034b50);
      writeZipUint16(localView, 4, 20);
      writeZipUint16(localView, 6, 0x0800);
      writeZipUint16(localView, 8, 0);
      writeZipUint16(localView, 10, stamp.time);
      writeZipUint16(localView, 12, stamp.date);
      writeZipUint32(localView, 14, checksum);
      writeZipUint32(localView, 18, file.data.length);
      writeZipUint32(localView, 22, file.data.length);
      writeZipUint16(localView, 26, file.nameBytes.length);
      writeZipUint16(localView, 28, 0);
      local.set(file.nameBytes, 30);
      localChunks.push(local, file.data);

      const central = new Uint8Array(46 + file.nameBytes.length);
      const centralView = new DataView(central.buffer);
      writeZipUint32(centralView, 0, 0x02014b50);
      writeZipUint16(centralView, 4, 20);
      writeZipUint16(centralView, 6, 20);
      writeZipUint16(centralView, 8, 0x0800);
      writeZipUint16(centralView, 10, 0);
      writeZipUint16(centralView, 12, stamp.time);
      writeZipUint16(centralView, 14, stamp.date);
      writeZipUint32(centralView, 16, checksum);
      writeZipUint32(centralView, 20, file.data.length);
      writeZipUint32(centralView, 24, file.data.length);
      writeZipUint16(centralView, 28, file.nameBytes.length);
      writeZipUint16(centralView, 30, 0);
      writeZipUint16(centralView, 32, 0);
      writeZipUint16(centralView, 34, 0);
      writeZipUint16(centralView, 36, 0);
      writeZipUint32(centralView, 38, 0);
      writeZipUint32(centralView, 42, localOffset);
      central.set(file.nameBytes, 46);
      centralChunks.push(central);
      localOffset += local.length + file.data.length;
    }
    const centralOffset = localOffset;
    const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    writeZipUint32(endView, 0, 0x06054b50);
    writeZipUint16(endView, 4, 0);
    writeZipUint16(endView, 6, 0);
    writeZipUint16(endView, 8, normalized.length);
    writeZipUint16(endView, 10, normalized.length);
    writeZipUint32(endView, 12, centralSize);
    writeZipUint32(endView, 16, centralOffset);
    writeZipUint16(endView, 20, 0);
    return concatBytes([...localChunks, ...centralChunks, end]);
  }

  const api = Object.freeze({
    buildCharacterCard,
    buildStoredZip,
    cleanText,
    crc32,
    embedCharacterCardInPng,
    fetchImageAsPngBytes,
    getCharacterImageUrl,
    getRecordSourceKind,
    hasPngSignature,
    sanitizeFileName,
    utf8Bytes,
  });

  if (globalScope) globalScope.SourceVaultExports = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
