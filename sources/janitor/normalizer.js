"use strict";

(function registerJanitorNormalizer() {
  const registry = globalThis.SourceVaultSourceRegistry;
  if (!registry || typeof registry.registerNormalizer !== "function") return;
  registry.registerNormalizer("janitor", (input) => {
    const root = input && typeof input === "object" ? input : {};
    const Core = globalThis.SourceVaultCore || {};
    const compact = typeof Core.compactRetrievedCapture === "function" ? Core.compactRetrievedCapture(root) : root;
    const core = root.janitorCore && typeof root.janitorCore === "object" ? root.janitorCore : {};
    const recovery = root.janny && typeof root.janny === "object" ? root.janny : {};
    const creator = root.creator && typeof root.creator === "object" ? root.creator : null;
    const compactCore = compact.janitorCore && typeof compact.janitorCore === "object" ? compact.janitorCore : {};
    const character = compactCore.character || core.character || recovery.detail || recovery.character || null;
    const compactCreator = compact.creator && typeof compact.creator === "object" ? compact.creator : creator;
    const scripts = compactCore.scripts && typeof compactCore.scripts === "object"
      ? compactCore.scripts
      : core.scripts && typeof core.scripts === "object"
        ? core.scripts
        : {};
    const sections = [];
    const definition = character && (character.sections || {
      rawDescriptionHtml: character.rawDescriptionHtml || character.descriptionHtml || null,
      personality: character.personality || null,
      scenario: character.scenario || null,
      firstMessage: character.firstMessage || character.firstMessageText || null,
      exampleDialogs: character.exampleDialogs || character.exampleDialogsText || null,
    });
    if (definition && Object.values(definition).some((value) => value != null && value !== "")) {
      sections.push({ type: "definition", value: definition });
    }
    if (scripts.lorebook || scripts.lorebooks) {
      sections.push({ type: "lorebooks", value: scripts.lorebook || scripts.lorebooks });
    }
    if (scripts.items) sections.push({ type: "scripts", value: scripts.items });
    if (recovery.detail) sections.push({ type: "recovery", value: recovery.detail });
    const assets = [];
    const addAsset = (role, url, sourceEntityId) => {
      const value = String(url || "").trim();
      if (!value || assets.some((asset) => asset.url === value)) return;
      assets.push({ role, url: value, sourceEntityId: sourceEntityId || null });
    };
    addAsset("character_profile", character && (character.profileImageAssetUrl || character.avatarUrl), root.characterId);
    addAsset("creator_profile", compactCreator && (compactCreator.profileImageAssetUrl || compactCreator.avatarUrl), compactCreator && compactCreator.creatorId);
    for (const item of compactCreator && Array.isArray(compactCreator.characters) ? compactCreator.characters : []) {
      addAsset("creator_character", item.profileImageAssetUrl || item.avatarUrl || item.avatar, item.id);
    }
    return {
      character,
      creator: compactCreator,
      sections,
      assets,
      raw: root,
      provenance: [
        { stage: "core", success: core.success === true, source: core.source || null },
        { stage: "recovery", success: recovery.success === true, source: recovery.source || null },
        { stage: "creator", success: !creator || creator.success === true || creator.skipped === true, source: creator && creator.source || null },
      ],
      completeness: root.components || null,
      warnings: [core.error, recovery.error, creator && creator.error].filter(Boolean),
    };
  });
})();
