// Sweater — Try More Models provider registry (Sweater AI fallback slots)
(function (global) {
  "use strict";

  const TRY_MODEL_PROVIDERS = {
    // NOTE: llama-3.3-70b-versatile, llama-3.1-8b-instant, qwen/qwen3-32b, and
    // meta-llama/llama-4-scout-17b-16e-instruct were all deprecated by Groq (announced
    // June 17, 2026). Catalog updated to Groq's currently-supported production/preview
    // models. See CHANGES.md.
    groq: {
      label: "Groq",
      keyUrl: "https://console.groq.com/keys",
      models: [
        { label: "GPT OSS 120B", id: "openai/gpt-oss-120b" },
        { label: "GPT OSS 20B", id: "openai/gpt-oss-20b" },
        { label: "Qwen3.6 27B", id: "qwen/qwen3.6-27b" }
      ]
    },
    openrouter: {
      label: "OpenRouter",
      keyUrl: "https://openrouter.ai/keys",
      models: [
        { label: "openrouter/free", id: "openrouter/free" },
        { label: "openai/gpt-oss-120b:free", id: "openai/gpt-oss-120b:free" },
        { label: "qwen/qwen3-coder:free", id: "qwen/qwen3-coder:free" },
        { label: "google/gemma-4-31b-it:free", id: "google/gemma-4-31b-it:free" }
      ]
    },
    // NOTE: Cerebras was removed July 2026 audit. As of the Cerebras Aug 17, 2026
    // Developer Tier changes, its "free" tier now requires adding a verified payment
    // method for a one-time $5 credit that expires after 30 days (PAYGO after that) —
    // it no longer qualifies as a no-card, ongoing free option. Its previously-used
    // models here (llama-3.3-70b, qwen-3-*) were also already deprecated Feb 16, 2026.
    // See CHANGES.md for details and replacement guidance.
    nvidia: {
      label: "NVIDIA NIM",
      keyUrl: "https://build.nvidia.com/settings/api-keys",
      models: [
        { label: "GPT OSS", id: "openai/gpt-oss-120b" },
        { label: "Nemotron 3 Super", id: "nvidia/nemotron-3-super-120b-a12b" }
      ]
    },
    ollama: {
      label: "Ollama",
      keyUrl: "https://ollama.com/",
      models: [
        { label: "Default (local)", id: "llama3.2" }
      ]
    },
    lmstudio: {
      label: "LM Studio",
      keyUrl: "https://lmstudio.ai/",
      models: [
        { label: "Default (local)", id: "local-model" }
      ]
    }
  };

  const DEFAULT_TRY_MODEL_SLOTS = [
    { provider: "groq", model: "openai/gpt-oss-120b", apiKey: "" },
    { provider: "openrouter", model: "openrouter/free", apiKey: "" },
    { provider: "", model: "", apiKey: "" }
  ];

  const TryModelsRegistry = {
    PROVIDERS: TRY_MODEL_PROVIDERS,

    providerIds: function () {
      return Object.keys(TRY_MODEL_PROVIDERS);
    },

    getProvider: function (providerId) {
      return TRY_MODEL_PROVIDERS[providerId] || null;
    },

    getModels: function (providerId) {
      const prov = TRY_MODEL_PROVIDERS[providerId];
      return prov ? prov.models : [];
    },

    getKeyUrl: function (providerId) {
      const prov = TRY_MODEL_PROVIDERS[providerId];
      return prov ? prov.keyUrl : "#";
    },

    getDefaultModel: function (providerId) {
      const models = this.getModels(providerId);
      return models.length ? models[0].id : "";
    },

    normalizeSlots: function (slots) {
      const normalized = Array.isArray(slots) ? slots.map(s => ({ ...s })) : [];
      while (normalized.length < 3) {
        normalized.push({ provider: "", model: "", apiKey: "" });
      }
      return normalized.slice(0, 3);
    },

    defaultSlots: function () {
      return DEFAULT_TRY_MODEL_SLOTS.map(s => ({ ...s }));
    },

    getConfiguredSlots: function (settings) {
      return this.normalizeSlots(settings?.tryModelSlots).filter(slot => {
        if (!slot.provider || !slot.model) return false;
        if (slot.provider === "ollama" || slot.provider === "lmstudio") return true;
        return !!slot.apiKey;
      });
    },

    toMiniSweaterProviders: function (settings) {
      // Use normalizeSlots indices so try_slot_N always maps to the same slot
      // in AIEngine._buildProviderChain (not a filtered/reindexed list).
      return this.normalizeSlots(settings?.tryModelSlots)
        .map((slot, i) => {
          if (!slot.provider || !slot.model) return null;
          const isLocal = slot.provider === "ollama" || slot.provider === "lmstudio";
          if (!isLocal && !slot.apiKey) return null;
          return {
            id: `try_slot_${i}`,
            provider: slot.provider,
            model: slot.model,
            apiKey: isLocal ? (slot.apiKey || "local") : slot.apiKey,
            label: `${TRY_MODEL_PROVIDERS[slot.provider]?.label || slot.provider} (${slot.model})`,
            enabled: true,
            isTryModel: true
          };
        })
        .filter(Boolean);
    }
  };

  global.TryModelsRegistry = TryModelsRegistry;
  globalThis.TryModelsRegistry = TryModelsRegistry;
})(typeof window !== "undefined" ? window : globalThis);
