"use strict";

(function initSaucepanParser(globalScope) {
  globalScope.SourceVaultSaucepanParser = function createSaucepanParser(context = {}) {
    const CoreInPage = context.CoreInPage;
    const sanitize = context.sanitize;
    function normalizeSaucepanText(value) {
      return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    }

    function normalizeSaucepanMultilineText(value) {
      return String(value == null ? "" : value)
        .replace(/\r/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    function dedupeSaucepanStrings(values) {
      const out = [];
      const seen = new Set();
      for (const value of Array.isArray(values) ? values : []) {
        const text = normalizeSaucepanText(value);
        if (!text) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(text);
      }
      return out;
    }

    function parseSaucepanCompactNumber(value) {
      const raw = normalizeSaucepanText(value);
      if (!raw) return null;
      const cleaned = raw.replace(/,/g, "");
      const match = cleaned.match(/^(-?\d+(?:\.\d+)?)([kKmM])?$/);
      if (!match) {
        const direct = Number.parseInt(cleaned, 10);
        return Number.isFinite(direct) ? direct : null;
      }
      const base = Number.parseFloat(match[1]);
      if (!Number.isFinite(base)) return null;
      const suffix = (match[2] || "").toLowerCase();
      if (suffix === "k") return Math.round(base * 1000);
      if (suffix === "m") return Math.round(base * 1000000);
      return Math.round(base);
    }

    function makeAbsoluteSaucepanUrl(href) {
      const raw = String(href || "").trim();
      if (!raw) return null;
      if (/^https?:\/\//i.test(raw)) return raw;
      return `https://saucepan.ai${raw.startsWith("/") ? "" : "/"}${raw}`;
    }

    function buildSaucepanStableSourceId({ id = null, url = null, title = null, kind = null } = {}) {
      const direct = normalizeSaucepanText(id);
      if (direct) return direct;
      const absoluteUrl = makeAbsoluteSaucepanUrl(url || "");
      if (absoluteUrl) return absoluteUrl;
      const pieces = [normalizeSaucepanText(kind), normalizeSaucepanText(title)].filter(Boolean);
      return pieces.length ? pieces.join(":") : null;
    }

    function sauceEscapeHtml(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function saucepanNodeTag(node) {
      return String(node && node.tag ? node.tag : "").toLowerCase();
    }

    function walkSaucepanRoux(node, visit, ancestors) {
      if (Array.isArray(node)) {
        for (const child of node) walkSaucepanRoux(child, visit, ancestors || []);
        return;
      }
      if (!node || typeof node !== "object") return;
      const prior = Array.isArray(ancestors) ? ancestors : [];
      visit(node, prior);
      for (const child of Array.isArray(node.children) ? node.children : []) {
        walkSaucepanRoux(child, visit, [...prior, node]);
      }
    }

    function collectSaucepanRouxText(node) {
      if (Array.isArray(node)) return node.map(collectSaucepanRouxText).filter(Boolean).join(" ");
      if (!node || typeof node !== "object") return "";
      const tag = saucepanNodeTag(node);
      let out = tag === "br" ? "\n" : "";
      if (typeof node.text === "string" && node.text) out += node.text;
      for (const child of Array.isArray(node.children) ? node.children : []) {
        const childText = collectSaucepanRouxText(child);
        if (!childText) continue;
        if (out && !out.endsWith("\n") && !childText.startsWith("\n")) out += " ";
        out += childText;
      }
      return out;
    }

    function saucepanRouxToHtml(node) {
      if (Array.isArray(node)) return node.map(saucepanRouxToHtml).join("");
      if (!node || typeof node !== "object") return "";
      const tag = saucepanNodeTag(node);
      const children = Array.isArray(node.children) ? node.children : [];
      if (tag === "root") return children.map(saucepanRouxToHtml).join("");
      if (!tag) return sauceEscapeHtml(node.text || "");
      const attrs = node.attributes && typeof node.attributes === "object"
        ? Object.entries(node.attributes)
            .filter(([, value]) => value != null && value !== "")
            .map(([key, value]) => ` ${key}="${sauceEscapeHtml(String(value))}"`)
            .join("")
        : "";
      const selfClosing = new Set(["img", "br", "input", "hr", "meta", "link"]);
      if (selfClosing.has(tag)) return `<${tag}${attrs}>`;
      const text = typeof node.text === "string" ? sauceEscapeHtml(node.text) : "";
      return `<${tag}${attrs}>${text}${children.map(saucepanRouxToHtml).join("")}</${tag}>`;
    }

    function findSaucepanRouxNode(node, predicate) {
      let found = null;
      walkSaucepanRoux(node, (current) => {
        if (!found && predicate(current)) found = current;
      });
      return found;
    }

    function collectSaucepanRouxNodes(node, predicate) {
      const results = [];
      walkSaucepanRoux(node, (current) => {
        if (predicate(current)) results.push(current);
      });
      return results;
    }

    function parseSaucepanCompanionStats(rawText) {
      const text = normalizeSaucepanText(rawText);
      const readLabel = (labels) => {
        for (const label of labels) {
          const match = text.match(new RegExp(`${label}\\s*:?\\s*([0-9.,]+(?:[kKmM])?)`, "i"));
          if (match && match[1]) return parseSaucepanCompactNumber(match[1]);
        }
        return null;
      };
      const scenarioMatch = text.match(/(\d+)\s+scenarios?\b/i);
      return {
        message_count: null,
        chat_count: readLabel(["CHATS?", "LOGS?"]),
        interaction_count: readLabel(["INTERACTIONS?", "MSGS?", "MESSAGES?"]),
        favorite_count: readLabel(["FAVORITES?", "REPORTS?"]),
        scenario_count: scenarioMatch ? Number.parseInt(scenarioMatch[1], 10) : null,
      };
    }

    function parseSaucepanGenericMaterialStats(rawText) {
      const text = normalizeSaucepanText(rawText);
      const readLabel = (labels) => {
        for (const label of labels) {
          const match = text.match(new RegExp(`${label}\\s*:?\\s*([0-9.,]+(?:[kKmM])?)`, "i"));
          if (match && match[1]) return parseSaucepanCompactNumber(match[1]);
        }
        return null;
      };
      const favoriteMatch = text.match(/add to favorites\s*\(([\d.,kKmM]+)\s+favorites?\)/i);
      return {
        priority: readLabel(["PRIORITY"]),
        file_count: readLabel(["FILES?"]),
        favorite_count: favoriteMatch ? parseSaucepanCompactNumber(favoriteMatch[1]) : readLabel(["FAVORITES?", "REPORTS?"]),
      };
    }

    function getSaucepanRouxClassName(node) {
      return normalizeSaucepanText(node && node.attributes && node.attributes.class);
    }

    function pickSaucepanRouxCardRoot(node, ancestors) {
      const candidates = [...(Array.isArray(ancestors) ? ancestors : [])].reverse().filter((entry) => {
        const cls = getSaucepanRouxClassName(entry);
        return /\b(card|member|item)\b/i.test(cls) || /\b(companion|post|collection|lorebook)\b/i.test(cls);
      });
      return candidates[0] || node;
    }

    function parseSaucepanCompanionCardFromRoux(rootNode, href) {
      const absoluteUrl = makeAbsoluteSaucepanUrl(href);
      const companionId = CoreInPage.normalizeUuid(absoluteUrl);
      if (!companionId) return null;
      const heading = findSaucepanRouxNode(rootNode, (node) => /^h[1-6]$/.test(saucepanNodeTag(node)));
      const paragraph = findSaucepanRouxNode(rootNode, (node) => saucepanNodeTag(node) === "p");
      const imgNode = findSaucepanRouxNode(rootNode, (node) => saucepanNodeTag(node) === "img");
      const rootText = normalizeSaucepanMultilineText(collectSaucepanRouxText(rootNode));
      const stats = parseSaucepanCompanionStats(rootText);
      return {
        companion_id: companionId,
        companion_url: absoluteUrl,
        name: normalizeSaucepanText(heading && collectSaucepanRouxText(heading)),
        description: normalizeSaucepanText(paragraph && collectSaucepanRouxText(paragraph)),
        image: CoreInPage.normalizeSaucepanImageRef(imgNode && imgNode.attributes && imgNode.attributes.src),
        access_badges: dedupeSaucepanStrings(
          collectSaucepanRouxNodes(rootNode, (node) => /badge/i.test(getSaucepanRouxClassName(node)))
            .map((node) => collectSaucepanRouxText(node))
            .concat(rootText.match(/\b(RESTRICTED|REVISED|CLASSIFIED)\b/gi) || []),
        ),
        tags: dedupeSaucepanStrings(
          collectSaucepanRouxNodes(rootNode, (node) => getSaucepanRouxClassName(node).toLowerCase().includes("tag"))
            .map((node) => collectSaucepanRouxText(node)),
        ),
        message_count: null,
        chat_count: stats.chat_count,
        interaction_count: stats.interaction_count,
        favorite_count: stats.favorite_count,
        scenario_count: stats.scenario_count,
        raw_data: {
          href: absoluteUrl,
          root_text: rootText,
          root_html: saucepanRouxToHtml(rootNode),
        },
      };
    }

    function parseSaucepanMaterialCardFromRoux(rootNode, href) {
      const absoluteUrl = makeAbsoluteSaucepanUrl(href);
      const heading = findSaucepanRouxNode(rootNode, (node) => /^h[1-6]$/.test(saucepanNodeTag(node)));
      const paragraph = findSaucepanRouxNode(rootNode, (node) => saucepanNodeTag(node) === "p");
      const imgNode = findSaucepanRouxNode(rootNode, (node) => saucepanNodeTag(node) === "img");
      const rootText = normalizeSaucepanMultilineText(collectSaucepanRouxText(rootNode));
      const stats = parseSaucepanGenericMaterialStats(rootText);
      return {
        id: CoreInPage.normalizeUuid(absoluteUrl),
        url: absoluteUrl,
        title: normalizeSaucepanText(heading && collectSaucepanRouxText(heading)),
        description: normalizeSaucepanText(paragraph && collectSaucepanRouxText(paragraph)),
        image: CoreInPage.normalizeSaucepanImageRef(imgNode && imgNode.attributes && imgNode.attributes.src),
        access_badges: dedupeSaucepanStrings(
          collectSaucepanRouxNodes(rootNode, (node) => /badge/i.test(getSaucepanRouxClassName(node)))
            .map((node) => collectSaucepanRouxText(node))
            .concat(rootText.match(/\b(RESTRICTED|REVISED|CLASSIFIED|UPDATED)\b/gi) || []),
        ),
        tags: dedupeSaucepanStrings(
          collectSaucepanRouxNodes(rootNode, (node) => getSaucepanRouxClassName(node).toLowerCase().includes("tag"))
            .map((node) => collectSaucepanRouxText(node)),
        ),
        priority: stats.priority,
        file_count: stats.file_count,
        favorite_count: stats.favorite_count,
        raw_text: rootText,
        raw_html: saucepanRouxToHtml(rootNode),
      };
    }

    function extractSaucepanCardsFromRoux(rouxRoot, kind) {
      const results = [];
      const seen = new Set();
      const matcher = kind === "companion"
        ? /\/companion\//
        : kind === "lorebook"
          ? /\/lorebook\//
          : kind === "collection"
            ? /\/collection\//
            : /\/p\//;
      walkSaucepanRoux(rouxRoot, (node, ancestors) => {
        if (saucepanNodeTag(node) !== "a") return;
        const href = String(node && node.attributes && node.attributes.href || "").trim();
        if (!href || !matcher.test(href)) return;
        const rootNode = pickSaucepanRouxCardRoot(node, ancestors);
        const parsed = kind === "companion"
          ? parseSaucepanCompanionCardFromRoux(rootNode, href)
          : parseSaucepanMaterialCardFromRoux(rootNode, href);
        const key = String((parsed && (parsed.companion_id || parsed.id || parsed.url)) || "").trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        results.push(parsed);
      });
      return results.filter(Boolean);
    }

    function extractSaucepanCompanionItems(payload) {
      const root = payload && typeof payload === "object" ? payload : {};
      const candidates = [
        root.companions,
        root.items,
        root.results,
        root.data && root.data.companions,
        root.data && root.data.items,
        root.data && root.data.results,
      ];
      const direct = candidates.find((item) => Array.isArray(item));
      if (direct) return direct;
      const found = Object.values(root).find((value) => {
        return Array.isArray(value) && value.some((entry) => entry && typeof entry === "object" && (entry.id || entry.companion_id));
      });
      return Array.isArray(found) ? found : [];
    }

    function mapSaucepanCompanionCard(item) {
      const root = item && typeof item === "object" ? item : {};
      const companionId = CoreInPage.normalizeUuid(root.id || root.companion_id || root.companionId || root.url || root.href);
      if (!companionId) return null;
      const image = CoreInPage.normalizeSaucepanImageRef(root.image || root.avatar || root.profile_image || root.image_id || null);
      return sanitize({
        companion_id: companionId,
        companion_url: makeAbsoluteSaucepanUrl(root.url || root.href || `/companion/${companionId}`),
        name: normalizeSaucepanText(root.name || root.title || root.chat_name || root.chatName || ""),
        description: normalizeSaucepanMultilineText(root.description || root.short_description || root.summary || ""),
        image,
        access_badges: dedupeSaucepanStrings(root.access_badges || root.badges || []),
        tags: dedupeSaucepanStrings(root.tags || root.custom_tags || []),
        message_count: null,
        chat_count: Number.isFinite(Number(root.chat_count)) ? Number(root.chat_count) : null,
        interaction_count: Number.isFinite(Number(root.interaction_count)) ? Number(root.interaction_count) : null,
        favorite_count: Number.isFinite(Number(root.favorite_count)) ? Number(root.favorite_count) : null,
        scenario_count: Number.isFinite(Number(root.scenario_count)) ? Number(root.scenario_count) : null,
        source_posted_at: root.source_posted_at || root.sourcePostedAt || root.posted_at || root.postedAt || root.first_published_at || root.firstPublishedAt || root.published_at || root.publishedAt || null,
        raw_data: { api_item: root },
      });
    }

    function getLikelySaucepanStructuredRenderItems(payload, kind) {
      if (!payload || typeof payload !== "object") return [];
      const keyCandidates = kind === "companion"
        ? ["companions", "companion_cards", "cards", "items", "results"]
        : kind === "post"
          ? ["posts", "broadcasts", "post_cards", "cards", "items", "results"]
          : kind === "lorebook"
            ? ["lorebooks", "archives", "lorebook_cards", "cards", "items", "results"]
            : ["collections", "groups", "collection_cards", "cards", "items", "results"];
      const containers = [
        payload,
        payload.data,
        payload.page,
        payload.render,
        payload.sections,
        payload.items_by_type,
        payload.content_by_type,
      ];
      for (const container of containers) {
        if (!container || typeof container !== "object") continue;
        for (const key of keyCandidates) {
          const value = container[key];
          if (Array.isArray(value) && value.length) return value;
        }
      }
      return [];
    }

    function mapSaucepanMaterialCard(item, kind) {
      const root = item && typeof item === "object" ? item : {};
      const pathPrefix = kind === "post" ? "/p/" : kind === "lorebook" ? "/lorebook/" : "/collection/";
      const fallbackId = root.id || root.post_id || root.postId || root.lorebook_id || root.lorebookId || root.collection_id || root.collectionId || "";
      const absoluteUrl = makeAbsoluteSaucepanUrl(root.url || root.href || root.path || (fallbackId ? `${pathPrefix}${fallbackId}` : ""));
      const itemId = CoreInPage.normalizeUuid(fallbackId || absoluteUrl);
      if (!itemId && !absoluteUrl) return null;
      return sanitize({
        id: itemId || null,
        url: absoluteUrl || null,
        title: normalizeSaucepanText(root.title || root.name || root.label || ""),
        description: normalizeSaucepanMultilineText(root.description || root.short_description || root.summary || root.body || root.blurb || ""),
        image: CoreInPage.normalizeSaucepanImageRef(root.image || root.avatar || root.profile_image || root.cover_image || root.image_id || null),
        tags: dedupeSaucepanStrings(root.tags || root.custom_tags || root.labels || []),
        access_badges: dedupeSaucepanStrings(root.access_badges || root.badges || []),
        priority: Number.isFinite(Number(root.priority)) ? Number(root.priority) : null,
        file_count: Number.isFinite(Number(root.file_count || root.fileCount)) ? Number(root.file_count || root.fileCount) : null,
        favorite_count: Number.isFinite(Number(root.favorite_count || root.favoriteCount || root.favorites)) ? Number(root.favorite_count || root.favoriteCount || root.favorites) : null,
        raw_text: normalizeSaucepanMultilineText(root.raw_text || root.body || root.description || ""),
        raw_html: typeof root.raw_html === "string" ? root.raw_html : null,
      });
    }

    function extractSaucepanStructuredRenderCards(payload, kind) {
      const items = getLikelySaucepanStructuredRenderItems(payload, kind);
      const seen = new Set();
      const results = [];
      for (const item of Array.isArray(items) ? items : []) {
        const mapped = kind === "companion" ? mapSaucepanCompanionCard(item) : mapSaucepanMaterialCard(item, kind);
        const key = String((mapped && (mapped.companion_id || mapped.id || mapped.url)) || "").trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        results.push(mapped);
      }
      return results;
    }

    function attachSaucepanMaterialPageMeta(cards, { sourcePage = 1, sourcePageSize = null } = {}) {
      return (Array.isArray(cards) ? cards : []).map((card) => ({
        ...card,
        source_page: Number.isFinite(Number(sourcePage)) ? Number(sourcePage) : 1,
        source_page_size: Number.isFinite(Number(sourcePageSize)) ? Number(sourcePageSize) : null,
      }));
    }

    function pickSaucepanPreferredText(existingValue, incomingValue) {
      const existing = normalizeSaucepanMultilineText(existingValue);
      const incoming = normalizeSaucepanMultilineText(incomingValue);
      if (!incoming) return existing || null;
      if (!existing) return incoming;
      return incoming.length > existing.length ? incoming : existing;
    }

    function chooseRicherSaucepanMaterial(a, b) {
      const score = (item) => (
        normalizeSaucepanText(item && (item.title || item.name)).length +
        normalizeSaucepanText(item && item.description).length +
        normalizeSaucepanMultilineText(item && (item.raw_text || (item.raw_data && item.raw_data.root_text))).length +
        (Array.isArray(item && item.tags) ? item.tags.length * 20 : 0) +
        (Array.isArray(item && item.access_badges) ? item.access_badges.length * 10 : 0)
      );
      return score(b) > score(a) ? b : a;
    }

    function mergeSaucepanMaterials(preferred, fallback, keyBuilder) {
      const merged = new Map();
      for (const item of Array.isArray(fallback) ? fallback : []) {
        const key = keyBuilder(item);
        if (key) merged.set(key, item);
      }
      for (const item of Array.isArray(preferred) ? preferred : []) {
        const key = keyBuilder(item);
        if (!key) continue;
        const existing = merged.get(key);
        merged.set(key, existing ? chooseRicherSaucepanMaterial(existing, item) : item);
      }
      return Array.from(merged.values());
    }

    function mergeSaucepanCompanionCard(existing, incoming) {
      const base = existing && typeof existing === "object" ? existing : {};
      const next = incoming && typeof incoming === "object" ? incoming : {};
      return sanitize({
        ...base,
        ...next,
        companion_id: String(next.companion_id || base.companion_id || "").trim() || null,
        companion_url: next.companion_url || base.companion_url || null,
        name: pickSaucepanPreferredText(base.name, next.name),
        description: pickSaucepanPreferredText(base.description, next.description),
        image: next.image || base.image || null,
        access_badges: dedupeSaucepanStrings([...(Array.isArray(base.access_badges) ? base.access_badges : []), ...(Array.isArray(next.access_badges) ? next.access_badges : [])]),
        tags: dedupeSaucepanStrings([...(Array.isArray(base.tags) ? base.tags : []), ...(Array.isArray(next.tags) ? next.tags : [])]),
        message_count: null,
        chat_count: Number.isFinite(Number(next.chat_count)) ? Number(next.chat_count) : Number.isFinite(Number(base.chat_count)) ? Number(base.chat_count) : null,
        interaction_count: Number.isFinite(Number(next.interaction_count)) ? Number(next.interaction_count) : Number.isFinite(Number(base.interaction_count)) ? Number(base.interaction_count) : null,
        favorite_count: Number.isFinite(Number(next.favorite_count)) ? Number(next.favorite_count) : Number.isFinite(Number(base.favorite_count)) ? Number(base.favorite_count) : null,
        scenario_count: Number.isFinite(Number(next.scenario_count)) ? Number(next.scenario_count) : Number.isFinite(Number(base.scenario_count)) ? Number(base.scenario_count) : null,
        source_posted_at: next.source_posted_at || next.sourcePostedAt || base.source_posted_at || base.sourcePostedAt || null,
        source_page: Number.isFinite(Number(next.source_page)) ? Number(next.source_page) : Number.isFinite(Number(base.source_page)) ? Number(base.source_page) : null,
        source_page_size: Number.isFinite(Number(next.source_page_size)) ? Number(next.source_page_size) : Number.isFinite(Number(base.source_page_size)) ? Number(base.source_page_size) : null,
        raw_data: {
          ...(base.raw_data && typeof base.raw_data === "object" ? base.raw_data : {}),
          ...(next.raw_data && typeof next.raw_data === "object" ? next.raw_data : {}),
        },
      });
    }

    function mergeSaucepanCompanionCardCollections(...collections) {
      const merged = new Map();
      for (const collection of collections) {
        for (const card of Array.isArray(collection) ? collection : []) {
          const key = String((card && (card.companion_id || card.companion_url)) || "").trim();
          if (!key) continue;
          const existing = merged.get(key);
          merged.set(key, existing ? mergeSaucepanCompanionCard(existing, card) : mergeSaucepanCompanionCard(null, card));
        }
      }
      return Array.from(merged.values());
    }

    function parseSaucepanCreatorDomFromHtml(html) {
      const rawHtml = String(html || "");
      if (!rawHtml.trim()) {
        return {
          profile_html: null,
          profile_css: null,
          bio_text: null,
          section_counts: {},
          profile_stats: [],
          heading_texts: [],
          dom_materials: { companions: [], posts: [], lorebooks: [], collections: [] },
        };
      }
      try {
        const doc = new DOMParser().parseFromString(rawHtml, "text/html");
        const normalize = normalizeSaucepanText;
        const normalizeMultiline = normalizeSaucepanMultilineText;
        const interestingLinkSelector = [
          'a[href*="/companion/"]',
          'a[href*="/collection/"]',
          'a[href*="/lorebook/"]',
          'a[href*="/p/"]',
        ].join(", ");
        const styleTexts = Array.from(doc.querySelectorAll("style"))
          .map((node) => String(node.textContent || "").trim())
          .filter(Boolean);
        const sectionCounts = {};
        Array.from(doc.querySelectorAll("h1, h2, h3")).forEach((el) => {
          const text = normalize(el.textContent || "");
          const match = text.match(/^(.*)\((\d+)\)\s*$/);
          if (!match) return;
          const label = normalize(match[1]).toLowerCase();
          const count = Number.parseInt(match[2], 10);
          if (label && Number.isFinite(count)) sectionCounts[label] = count;
        });
        const headingTexts = Array.from(doc.querySelectorAll("h1, h2, h3"))
          .map((el) => normalize(el.textContent || ""))
          .filter(Boolean)
          .slice(0, 60);
        const profileStats = Array.from(doc.querySelectorAll(".profile-stats *, .stats-line *, .followers-count, .profile-info *"))
          .map((el) => normalize(el.textContent || ""))
          .filter(Boolean)
          .slice(0, 100);
        const bioEl = doc.querySelector(".bio-content, .gothic-bio, .profile-description");
        const avatarImg = doc.querySelector('img[alt*="avatar" i]');
        const mainRoot = doc.querySelector("#mainProfile, .user-profile, [class*='user-profile'], main") || doc.body;
        const profileClone = mainRoot ? mainRoot.cloneNode(true) : null;
        if (profileClone) {
          const firstMaterial = profileClone.querySelector(interestingLinkSelector);
          if (firstMaterial) {
            let current = firstMaterial.closest("section, article, div, ul, ol") || firstMaterial;
            while (current && current.parentElement && current.parentElement !== profileClone) current = current.parentElement;
            if (current && current !== profileClone) {
              let sibling = current;
              while (sibling) {
                const next = sibling.nextElementSibling;
                sibling.remove();
                sibling = next;
              }
            }
          }
        }
        const getLines = (root) => normalizeMultiline(root && root.textContent || "")
          .split("\n")
          .map((line) => normalize(line))
          .filter(Boolean);
        const closestCardRoot = (anchor) => {
          let current = anchor;
          let fallback = anchor.parentElement || anchor;
          while (current && current !== doc.body) {
            const text = normalizeMultiline(current.textContent || "");
            const hasImage = !!current.querySelector("img");
            const hasHeading = !!current.querySelector("h1, h2, h3");
            const linkCount = current.querySelectorAll(interestingLinkSelector).length;
            if (text && text.length <= 1600 && linkCount <= 3 && (hasImage || hasHeading)) return current;
            fallback = current;
            current = current.parentElement;
          }
          return fallback;
        };
        const materialBuckets = { companions: [], posts: [], lorebooks: [], collections: [] };
        const seen = new Set();
        for (const anchor of Array.from(doc.querySelectorAll(interestingLinkSelector))) {
          const absoluteUrl = makeAbsoluteSaucepanUrl(anchor.getAttribute("href") || "");
          if (!absoluteUrl) continue;
          const type = absoluteUrl.includes("/companion/")
            ? "companion"
            : absoluteUrl.includes("/collection/")
              ? "collection"
              : absoluteUrl.includes("/lorebook/")
                ? "lorebook"
                : "post";
          const key = `${type}:${absoluteUrl}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const root = closestCardRoot(anchor);
          const imageEl = root ? root.querySelector("img") : null;
          const headings = root ? Array.from(root.querySelectorAll("h1, h2, h3")).map((el) => normalize(el.textContent || "")).filter(Boolean) : [];
          const sameHrefTexts = root
            ? Array.from(root.querySelectorAll("a"))
                .filter((candidate) => makeAbsoluteSaucepanUrl(candidate.getAttribute("href") || "") === absoluteUrl)
                .map((candidate) => normalize(candidate.textContent || ""))
                .filter(Boolean)
            : [];
          const title = dedupeSaucepanStrings([...sameHrefTexts, ...headings, normalize(anchor.textContent || "")])
            .filter((candidate) => !/^(companions?|posts?|lorebooks?|collections?|broadcasts?)$/i.test(candidate))
            .sort((a, b) => a.length - b.length)[0] || "";
          const lines = getLines(root);
          const description = lines.find((line) => {
            const lowered = line.toLowerCase();
            return line && line !== title && !/^@/.test(line) && !/^(companions?|posts?|lorebooks?|collections?|sort by|filter)$/i.test(lowered);
          }) || "";
          const favoriteLine = lines.find((line) => /add to favorites/i.test(line));
          const favoriteMatch = favoriteLine ? favoriteLine.match(/\(([\d.,kKmM]+)\s+favorites?\)/i) : null;
          const numericTokens = lines
            .filter((line) => /^\d+(?:\.\d+)?[kKmM]?$/.test(line))
            .map(parseSaucepanCompactNumber)
            .filter((value) => Number.isFinite(value));
          if (type === "companion") {
            materialBuckets.companions.push({
              companion_id: CoreInPage.normalizeUuid(absoluteUrl),
              companion_url: absoluteUrl,
              name: title,
              description,
              image: CoreInPage.normalizeSaucepanImageRef(imageEl ? imageEl.getAttribute("src") : null),
              access_badges: [],
              tags: [],
              message_count: null,
              chat_count: numericTokens[0] ?? null,
              interaction_count: numericTokens[2] ?? numericTokens[1] ?? null,
              favorite_count: favoriteMatch ? parseSaucepanCompactNumber(favoriteMatch[1]) : null,
              scenario_count: null,
              raw_data: {
                href: absoluteUrl,
                root_text: normalizeMultiline(root && root.textContent || ""),
                root_html: root ? root.outerHTML : "",
              },
            });
          } else {
            const item = {
              id: CoreInPage.normalizeUuid(absoluteUrl),
              url: absoluteUrl,
              title,
              description,
              image: CoreInPage.normalizeSaucepanImageRef(imageEl ? imageEl.getAttribute("src") : null),
              tags: [],
              access_badges: [],
              priority: numericTokens[1] ?? null,
              file_count: numericTokens[0] ?? null,
              favorite_count: favoriteMatch ? parseSaucepanCompactNumber(favoriteMatch[1]) : null,
              raw_text: normalizeMultiline(root && root.textContent || ""),
              raw_html: root ? root.outerHTML : "",
            };
            materialBuckets[type === "collection" ? "collections" : type === "lorebook" ? "lorebooks" : "posts"].push(item);
          }
        }
        return {
          profile_html: profileClone ? profileClone.outerHTML : null,
          profile_css: styleTexts.join("\n\n"),
          bio_html: bioEl ? bioEl.innerHTML : null,
          bio_text: bioEl ? normalizeMultiline(bioEl.textContent || "") : null,
          section_counts: sectionCounts,
          profile_stats: profileStats,
          avatar_alt: avatarImg ? normalize(avatarImg.getAttribute("alt") || "") : null,
          avatar_name: avatarImg ? normalize((String(avatarImg.getAttribute("alt") || "").match(/^(.+?)'s avatar$/i) || [])[1] || "") : null,
          heading_texts: headingTexts,
          dom_materials: materialBuckets,
        };
      } catch (error) {
        return {
          error: String(error && error.message ? error.message : error),
          profile_html: null,
          profile_css: null,
          bio_text: null,
          section_counts: {},
          profile_stats: [],
          heading_texts: [],
          dom_materials: { companions: [], posts: [], lorebooks: [], collections: [] },
        };
      }
    }

    function buildSaucepanProfileStatsLabels(userJson, domProfile) {
      const labels = {
        followers_label: "followers",
        companion_label: "companions",
      };
      const stats = Array.isArray(domProfile && domProfile.profile_stats) ? domProfile.profile_stats : [];
      const followersText = stats.find((line) => /\b(followers|following|observers)\b/i.test(line));
      if (followersText) labels.followers_display = followersText;
      const sectionCounts = domProfile && domProfile.section_counts && typeof domProfile.section_counts === "object" ? domProfile.section_counts : {};
      const companionLabel = Object.keys(sectionCounts).find((key) => /compan|thoughtcriminal/i.test(key));
      if (companionLabel) labels.companion_section_label = companionLabel;
      if (Array.isArray(userJson && userJson.user && userJson.user.shelf_badges)) labels.shelf_badges = userJson.user.shelf_badges;
      return labels;
    }

    function buildSaucepanCreatorCounts({ followerCount, domProfile, companionCards, postCards, lorebookCards, collectionCards }) {
      const sectionCounts = domProfile && domProfile.section_counts && typeof domProfile.section_counts === "object" ? domProfile.section_counts : {};
      const pickSectionCount = (pattern, fallback) => {
        const key = Object.keys(sectionCounts).find((label) => pattern.test(label));
        const value = key ? Number(sectionCounts[key]) : null;
        return Number.isFinite(value) ? value : fallback;
      };
      return {
        followers: Number.isFinite(Number(followerCount)) ? Number(followerCount) : null,
        companions: pickSectionCount(/compan|thoughtcriminal/, Array.isArray(companionCards) ? companionCards.length : 0),
        posts: pickSectionCount(/broadcast|post/, Array.isArray(postCards) ? postCards.length : 0),
        lorebooks: pickSectionCount(/archive|data|scripture|lorebook/, Array.isArray(lorebookCards) ? lorebookCards.length : 0),
        collections: pickSectionCount(/database|collection/, Array.isArray(collectionCards) ? collectionCards.length : 0),
      };
    }

    function buildSaucepanSourceMaterials(sourceSections) {
      const sections = sourceSections && typeof sourceSections === "object" ? sourceSections : {};
      const materials = [];
      for (const card of Array.isArray(sections.companions && sections.companions.items) ? sections.companions.items : []) {
        materials.push({
          source_type: "companion",
          source_id: card.companion_id,
          source_url: card.companion_url,
          name: card.name,
          description: card.description,
          image: card.image,
          access_badges: card.access_badges || [],
          tags: card.tags || [],
          message_count: null,
          chat_count: card.chat_count,
          interaction_count: card.interaction_count,
          favorite_count: card.favorite_count,
          scenario_count: card.scenario_count,
          priority: null,
          file_count: null,
          source_section: "companions",
          source_page: card.source_page,
          source_page_size: card.source_page_size,
          raw_data: card.raw_data,
        });
      }
      const pushGeneric = (kind, items) => {
        for (const card of Array.isArray(items) ? items : []) {
          materials.push({
            source_type: kind,
            source_id: buildSaucepanStableSourceId({ id: card.id, url: card.url, title: card.title, kind }),
            source_url: card.url,
            name: card.title,
            description: card.description,
            image: card.image,
            access_badges: card.access_badges || [],
            tags: card.tags || [],
            message_count: null,
            chat_count: null,
            interaction_count: null,
            favorite_count: card.favorite_count ?? null,
            scenario_count: null,
            priority: card.priority ?? null,
            file_count: card.file_count ?? null,
            source_section: `${kind}s`,
            source_page: card.source_page,
            source_page_size: card.source_page_size,
            raw_data: { raw_text: card.raw_text, raw_html: card.raw_html },
          });
        }
      };
      pushGeneric("post", sections.posts && sections.posts.items);
      pushGeneric("lorebook", sections.lorebooks && sections.lorebooks.items);
      pushGeneric("collection", sections.collections && sections.collections.items);
      return materials;
    }

    function getSaucepanUserRecordFromEnvelope(envelope) {
      const json = envelope && envelope.response && envelope.response.json ? envelope.response.json : null;
      const candidates = [
        json && typeof json.user === "object" ? json.user : null,
        json && json.data && typeof json.data.user === "object" ? json.data.user : null,
        json && json.data && typeof json.data === "object" ? json.data : null,
        json && typeof json === "object" ? json : null,
      ];
      return candidates.find((candidate) => candidate && typeof candidate === "object" && candidate.id) || null;
    }
    return { normalizeSaucepanText, normalizeSaucepanMultilineText, dedupeSaucepanStrings, parseSaucepanCompactNumber, makeAbsoluteSaucepanUrl, buildSaucepanStableSourceId, sauceEscapeHtml, saucepanNodeTag, walkSaucepanRoux, collectSaucepanRouxText, saucepanRouxToHtml, findSaucepanRouxNode, collectSaucepanRouxNodes, parseSaucepanCompanionStats, parseSaucepanGenericMaterialStats, getSaucepanRouxClassName, pickSaucepanRouxCardRoot, parseSaucepanCompanionCardFromRoux, parseSaucepanMaterialCardFromRoux, extractSaucepanCardsFromRoux, extractSaucepanCompanionItems, mapSaucepanCompanionCard, getLikelySaucepanStructuredRenderItems, mapSaucepanMaterialCard, extractSaucepanStructuredRenderCards, attachSaucepanMaterialPageMeta, pickSaucepanPreferredText, chooseRicherSaucepanMaterial, mergeSaucepanMaterials, mergeSaucepanCompanionCard, mergeSaucepanCompanionCardCollections, parseSaucepanCreatorDomFromHtml, buildSaucepanProfileStatsLabels, buildSaucepanCreatorCounts, buildSaucepanSourceMaterials, getSaucepanUserRecordFromEnvelope };
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
