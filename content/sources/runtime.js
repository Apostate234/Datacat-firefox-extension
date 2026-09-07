"use strict";

(function initSourceVaultPageSourceRuntime(globalScope) {
  const existing = globalScope.SourceVaultPageSources;
  if (existing && existing.__runtimeVersion === 1) return;
  const factories = new Map();

  const api = {
    __runtimeVersion: 1,
    register(sourceId, factory) {
      const id = String(sourceId || "").trim().toLowerCase();
      if (!id || typeof factory !== "function") throw new Error("source_factory_invalid");
      if (!factories.has(id)) factories.set(id, factory);
      return factories.get(id);
    },
    has(sourceId) {
      return factories.has(String(sourceId || "").trim().toLowerCase());
    },
    create(sourceId, context) {
      const id = String(sourceId || "").trim().toLowerCase();
      const factory = factories.get(id);
      if (!factory) throw new Error(`source_adapter_missing_${id || "unknown"}`);
      return factory(context || {});
    },
    list() {
      return Array.from(factories.keys());
    },
  };

  if (existing && typeof existing === "object") {
    for (const [sourceId, factory] of Object.entries(existing)) {
      if (typeof factory === "function") api.register(sourceId, factory);
    }
  }
  globalScope.SourceVaultPageSources = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
