"use strict";

(function initSourceVaultSourceRegistry(globalScope) {
  const descriptors = [
  {
    "schemaVersion": 1,
    "id": "janitor",
    "displayName": "Janitor",
    "iconGlyph": "J",
    "defaultEnabled": true,
    "hosts": [
      "janitorai.com",
      "www.janitorai.com"
    ],
    "matches": [
      "https://janitorai.com/*",
      "https://www.janitorai.com/*"
    ],
    "pageAdapter": "sources/janitor/page_adapter.js",
    "pageScripts": [
      "sources/janitor/helpers.js",
      "sources/janitor/page_adapter.js"
    ],
    "normalizer": "sources/janitor/normalizer.js",
    "capabilities": {
      "character": true,
      "creator": true,
      "recovery": true,
      "assets": true,
      "rawHtml": true
    },
    "routes": [
      {
        "type": "character",
        "pattern": "^/(?:[a-z]{2}/)?characters/([0-9a-f-]{36})(?:_|/|$)",
        "idKey": "characterId",
        "canonicalUrl": "https://janitorai.com/characters/{id}"
      },
      {
        "type": "creator",
        "pattern": "^/(?:[a-z]{2}(?:-[a-z]{2})?/)?profiles/([0-9a-f-]{36})(?:_|/|$)",
        "idKey": "creatorId",
        "canonicalUrl": "https://janitorai.com/profiles/{id}"
      }
    ],
    "stages": [
      {
        "id": "core",
        "label": "Core",
        "required": false,
        "timeoutMs": 180000
      },
      {
        "id": "recovery",
        "label": "Recovery",
        "required": false,
        "timeoutMs": 45000,
        "mayRequireUserAction": true
      },
      {
        "id": "creator",
        "label": "Creator",
        "required": false,
        "timeoutMs": 150000
      }
    ]
  },
  {
    "schemaVersion": 1,
    "id": "saucepan",
    "displayName": "Saucepan",
    "iconGlyph": "P",
    "defaultEnabled": true,
    "hosts": [
      "saucepan.ai",
      "www.saucepan.ai"
    ],
    "matches": [
      "https://saucepan.ai/*",
      "https://www.saucepan.ai/*"
    ],
    "pageAdapter": "sources/saucepan/page_adapter.js",
    "pageScripts": [
      "sources/saucepan/client.js",
      "sources/saucepan/parser.js",
      "sources/saucepan/page_adapter.js"
    ],
    "normalizer": "sources/saucepan/normalizer.js",
    "capabilities": {
      "character": true,
      "creator": true,
      "recovery": false,
      "assets": true,
      "rawHtml": true
    },
    "routes": [
      {
        "type": "character",
        "pattern": "^/companion/([0-9a-f-]{36})(?:/|$)",
        "idKey": "companionId",
        "canonicalUrl": "https://saucepan.ai/companion/{id}"
      },
      {
        "type": "creator",
        "pattern": "^/u/([^/?#]+)(?:/|$)",
        "idKey": "creatorHandle",
        "canonicalUrl": "https://saucepan.ai/u/{id}"
      }
    ],
    "stages": [
      {
        "id": "core",
        "label": "Core",
        "required": true,
        "timeoutMs": 150000
      },
      {
        "id": "creator",
        "label": "Creator",
        "required": false,
        "timeoutMs": 150000
      }
    ]
  }
];
  const byId = new Map(descriptors.map((descriptor) => [descriptor.id, Object.freeze(descriptor)]));
  const normalizers = new Map();

  function list(options = {}) {
    return descriptors.filter((descriptor) => options.includeTest === true || descriptor.testOnly !== true).slice();
  }

  function get(sourceId) {
    return byId.get(String(sourceId || "").trim().toLowerCase()) || null;
  }

  function normalizeSourceId(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "sauce") return byId.has("saucepan") ? "saucepan" : null;
    if (normalized === "janitorai" || normalized === "janny") return byId.has("janitor") ? "janitor" : null;
    return byId.has(normalized) ? normalized : null;
  }

  function resolveUrl(value) {
    let url;
    try { url = new URL(String(value || "")); } catch (_) { return null; }
    const hostname = url.hostname.toLowerCase();
    for (const descriptor of descriptors) {
      if (!descriptor.hosts.includes(hostname)) continue;
      for (const route of descriptor.routes) {
        const match = url.pathname.match(new RegExp(route.pattern, "i"));
        if (!match) continue;
        const rawId = decodeURIComponent(match[1] || "").trim();
        const normalizedId = route.idKey === "creatorHandle" ? rawId.replace(/^@+/, "") : rawId.toLowerCase();
        return {
          sourceKind: descriptor.id,
          sourceLabel: descriptor.displayName,
          routeType: route.type,
          isCharacterPage: route.type === "character",
          isCreatorPage: route.type === "creator",
          characterId: route.type === "character" ? normalizedId : null,
          companionId: descriptor.id === "saucepan" && route.type === "character" ? normalizedId : null,
          creatorId: route.idKey === "creatorId" ? normalizedId : null,
          creatorHandle: route.idKey === "creatorHandle" ? normalizedId : null,
          normalizedUrl: route.canonicalUrl.replace("{id}", encodeURIComponent(normalizedId)),
          descriptor,
        };
      }
      return {
        sourceKind: descriptor.id,
        sourceLabel: descriptor.displayName,
        isCharacterPage: false,
        isCreatorPage: false,
        characterId: null, companionId: null, creatorId: null, creatorHandle: null,
        normalizedUrl: null, descriptor,
      };
    }
    return null;
  }

  function registerNormalizer(sourceId, normalizer) {
    const id = normalizeSourceId(sourceId);
    if (!id || typeof normalizer !== "function") throw new Error("source_normalizer_invalid");
    if (normalizers.has(id)) return normalizers.get(id);
    normalizers.set(id, normalizer);
    return normalizer;
  }

  function buildCaptureEnvelope(sourceId, input, metadata = {}) {
    const id = normalizeSourceId(sourceId);
    const descriptor = get(id);
    if (!descriptor) throw new Error("source_not_registered");
    const root = input && typeof input === "object" ? input : {};
    const normalize = normalizers.get(id);
    const normalized = normalize ? normalize(root, metadata) : { raw: root };
    const sourceEntityId = String(metadata.sourceEntityId || root.characterId || root.companionId || "").trim() || null;
    return {
      schemaVersion: 1,
      source: { id, adapterVersion: String(metadata.adapterVersion || "1") },
      entity: {
        type: String(metadata.entityType || "character"),
        sourceEntityId,
        canonicalUrl: metadata.canonicalUrl || root.pageUrl || null,
      },
      capturedAt: metadata.capturedAt || new Date().toISOString(),
      character: normalized.character || null,
      creator: normalized.creator || null,
      sections: Array.isArray(normalized.sections) ? normalized.sections : [],
      assets: Array.isArray(normalized.assets) ? normalized.assets : [],
      raw: normalized.raw === undefined ? root : normalized.raw,
      provenance: Array.isArray(normalized.provenance) ? normalized.provenance : [],
      completeness: normalized.completeness || metadata.completeness || null,
      warnings: Array.isArray(normalized.warnings) ? normalized.warnings : [],
    };
  }

  const api = { schemaVersion: 1, list, get, normalizeSourceId, resolveUrl, registerNormalizer, buildCaptureEnvelope };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.SourceVaultSourceRegistry = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
