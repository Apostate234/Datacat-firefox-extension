"use strict";

(function registerSaucepanNormalizer() {
  const registry = globalThis.SourceVaultSourceRegistry;
  if (!registry || typeof registry.registerNormalizer !== "function") return;
  registry.registerNormalizer("saucepan", (input) => {
    const root = input && typeof input === "object" ? input : {};
    const Core = globalThis.SourceVaultCore || {};
    const compact = typeof Core.compactRetrievedCapture === "function" ? Core.compactRetrievedCapture(root) : root;
    const core = root.saucepanCore && typeof root.saucepanCore === "object" ? root.saucepanCore : {};
    const creator = root.saucepanCreator && typeof root.saucepanCreator === "object" ? root.saucepanCreator : null;
    const compactCore = compact.saucepanCore && typeof compact.saucepanCore === "object" ? compact.saucepanCore : core;
    const character = compactCore.companion || core.companion || null;
    const compactCreator = compact.saucepanCreator && typeof compact.saucepanCreator === "object" ? compact.saucepanCreator : creator;
    const sections = [];
    if (character && character.definition) sections.push({ type: "definition", value: character.definition });
    for (const scenario of character && Array.isArray(character.startingScenarios) ? character.startingScenarios : []) {
      sections.push({ type: "scenario", value: scenario });
    }
    if (compactCore.lorebooks) sections.push({ type: "lorebooks", value: compactCore.lorebooks });
    const assets = [];
    const addAsset = (role, url, sourceEntityId) => {
      const value = String(url || "").trim();
      if (!value || assets.some((asset) => asset.url === value)) return;
      assets.push({ role, url: value, sourceEntityId: sourceEntityId || null });
    };
    addAsset("character_profile", character && character.profileImageAssetUrl, root.characterId || root.companionId);
    for (const portrait of character && Array.isArray(character.portraits) ? character.portraits : []) {
      addAsset("character_portrait", portrait.profileImageAssetUrl || portrait.url || portrait.highresUrl, portrait.id);
    }
    addAsset("creator_profile", compactCreator && compactCreator.profileImageAssetUrl, compactCreator && (compactCreator.creatorId || compactCreator.creatorHandle));
    const creatorCharacters = compactCreator && compactCreator.sourceSections && compactCreator.sourceSections.companions;
    for (const item of creatorCharacters && Array.isArray(creatorCharacters.items) ? creatorCharacters.items : []) {
      addAsset("creator_character", item.profileImageAssetUrl || item.image, item.id);
    }
    return {
      character,
      creator: compactCreator,
      sections,
      assets,
      raw: root,
      provenance: [
        { stage: "core", success: core.success === true, source: core.source || null },
        { stage: "creator", success: !creator || creator.success === true || creator.skipped === true, source: creator && creator.source || null },
      ],
      completeness: root.components || null,
      warnings: [core.error, creator && creator.error].filter(Boolean),
    };
  });
})();
