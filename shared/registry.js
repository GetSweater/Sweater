// Sweater v2 — Dynamic Model Capability Registry (Unified)
(function (global) {
  "use strict";

  const FALLBACK_REGISTRY = {
    gemini: {
      "gemini-3.5-flash": { vision: true, streaming: true, json: true, thinking: true, longContext: true, tools: true },
      "gemini-2.5-flash": { vision: true, streaming: true, json: true, thinking: true, longContext: true, tools: true },
      "gemini-3.1-flash-lite": { vision: true, streaming: true, json: true, thinking: false, longContext: true, tools: true }
    },
    // NOTE: llama-3.3-70b-versatile and llama-3.1-8b-instant were deprecated by Groq
    // (announced June 17, 2026) and removed from this registry accordingly.
    groq: {
      "openai/gpt-oss-120b": { vision: false, streaming: true, json: true, thinking: true, longContext: true, tools: true },
      "openai/gpt-oss-20b": { vision: false, streaming: true, json: true, thinking: true, longContext: true, tools: true },
      "qwen/qwen3.6-27b": { vision: true, streaming: true, json: true, thinking: true, longContext: true, tools: true }
    },
    openai: {
      "gpt-5.6-luna": { vision: true, streaming: true, json: true, thinking: true, longContext: true, tools: true },
      "gpt-5.6-terra": { vision: true, streaming: true, json: true, thinking: true, longContext: true, tools: true },
      "gpt-4o-mini": { vision: true, streaming: true, json: true, thinking: false, longContext: true, tools: true },
      "gpt-4o": { vision: true, streaming: true, json: true, thinking: false, longContext: true, tools: true }
    },
    anthropic: {
      "claude-sonnet-4-6": { vision: true, streaming: true, json: true, thinking: false, longContext: true, tools: true },
      "claude-haiku-4-5-20251001": { vision: true, streaming: true, json: true, thinking: false, longContext: true, tools: true },
      "claude-opus-4-8": { vision: true, streaming: true, json: true, thinking: false, longContext: true, tools: true }
    },
    deepseek: {
      "deepseek-v4-flash": { vision: false, streaming: true, json: true, thinking: true, longContext: true, tools: true },
      "deepseek-v4-pro": { vision: false, streaming: true, json: true, thinking: true, longContext: true, tools: true }
    }
  };

  const DEFAULT_CAPS = { vision: false, streaming: true, json: false, thinking: false, longContext: false, tools: false };

  const ModelRegistry = {
    getCapabilities: async function (provider, model) {
      // Compatibility fallback: if only providerId is passed (e.g. "prov_gemini")
      if (typeof provider === "string" && !model) {
        const id = provider;
        if (id.startsWith("prov_")) {
          const prov = id.replace("prov_", "");
          try {
            const settings = await globalThis.SettingsService.loadSettings();
            const pConfig = settings.providers.find(p => p.id === id);
            if (pConfig) {
              return await this.getCapabilities(pConfig.provider, pConfig.model);
            }
          } catch (e) {}
          if (FALLBACK_REGISTRY[prov]) {
            return Object.values(FALLBACK_REGISTRY[prov])[0];
          }
        }
        return DEFAULT_CAPS;
      }

      if (!provider || !model) return DEFAULT_CAPS;

      // 1. Try checking cache
      const cached = await this._getCachedCapabilities(provider, model);
      if (cached) return cached;

      // 2. Try looking up in the fallback registry
      if (FALLBACK_REGISTRY[provider] && FALLBACK_REGISTRY[provider][model]) {
        return FALLBACK_REGISTRY[provider][model];
      }

      // 3. Fallback to basic heuristics based on name patterns
      const modelLower = model.toLowerCase();
      const caps = { ...DEFAULT_CAPS };

      if (modelLower.includes("vision") || modelLower.includes("gpt-4o") || modelLower.includes("claude-3-5-sonnet")) {
        caps.vision = true;
      }
      if (modelLower.includes("flash") || modelLower.includes("llama") || modelLower.includes("claude") || modelLower.includes("gpt")) {
        caps.streaming = true;
        caps.json = true;
      }
      if (modelLower.includes("reason") || modelLower.includes("o1") || modelLower.includes("o3") || modelLower.includes("thinking") || modelLower.includes("deepseek-r")) {
        caps.thinking = true;
      }
      if (modelLower.includes("pro") || modelLower.includes("long") || modelLower.includes("128k") || modelLower.includes("200k") || modelLower.includes("gemini")) {
        caps.longContext = true;
      }
      if (modelLower.includes("tool") || modelLower.includes("function") || modelLower.includes("gpt") || modelLower.includes("claude")) {
        caps.tools = true;
      }

      return caps;
    },

    discoverCapabilities: async function (providerConfig) {
      const { provider, apiKey } = providerConfig;
      if (!apiKey) return;

      try {
        let models = [];
        if (provider === "openrouter") {
          const resp = await fetch("https://openrouter.ai/api/v1/models");
          if (resp.ok) {
            const data = await resp.json();
            models = data.data || [];
          }
        } else if (provider === "openai") {
          const resp = await fetch("https://api.openai.com/v1/models", {
            headers: { "Authorization": `Bearer ${apiKey}` }
          });
          if (resp.ok) {
            const data = await resp.json();
            models = data.data || [];
          }
        }

        if (models.length > 0) {
          const discovered = {};
          models.forEach((m) => {
            const mId = m.id;
            const modelLower = mId.toLowerCase();
            const caps = {
              vision: modelLower.includes("vision") || modelLower.includes("vl") || modelLower.includes("gpt-4o"),
              streaming: true,
              json: true,
              thinking: modelLower.includes("reason") || modelLower.includes("o1") || modelLower.includes("o3") || modelLower.includes("thinking"),
              longContext: modelLower.includes("128k") || modelLower.includes("200k") || modelLower.includes("32k") || modelLower.includes("gemini") || modelLower.includes("claude"),
              tools: true
            };
            discovered[mId] = caps;
          });

          await this._cacheCapabilities(provider, discovered);
          console.log(`[ModelRegistry] Discovered ${Object.keys(discovered).length} models for ${provider}`);
        }
      } catch (err) {
        console.error(`[ModelRegistry] Discovery failed for ${provider}:`, err);
      }
    },

    _getCachedCapabilities: function (provider, model) {
      return new Promise((resolve) => {
        chrome.storage.local.get([`caps_${provider}`], (res) => {
          const cache = res[`caps_${provider}`] || {};
          resolve(cache[model] || null);
        });
      });
    },

    _cacheCapabilities: function (provider, mapping) {
      return new Promise((resolve) => {
        chrome.storage.local.get([`caps_${provider}`], (res) => {
          const existing = res[`caps_${provider}`] || {};
          const merged = { ...existing, ...mapping };
          chrome.storage.local.set({ [`caps_${provider}`]: merged }, resolve);
        });
      });
    }
  };

  // Expose context
  if (typeof module !== "undefined" && module.exports) {
    module.exports = ModelRegistry;
  } else {
    global.ModelRegistry = ModelRegistry;
    globalThis.ModelRegistry = ModelRegistry;
  }
})(typeof window !== "undefined" ? window : globalThis);
