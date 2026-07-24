// Sweater v2 — Background Service Worker
(function () {
  "use strict";

  // Load modular dependencies in worker context
  importScripts(
    "../shared/storage.js",
    "../shared/telemetry.js",
    "../shared/settings.js",
    "../shared/event_bus.js",
    "../shared/registry.js",
    "../shared/prompts.js",
    "../shared/state.js",
    "../shared/try_models.js",
    "../shared/plugins.js",
    "queue.js",
    "providers.js",
    "ai_engine.js",
    "classifier.js",
    "diagnostics.js"
  );

  const PROVIDER_METADATA = {
    gemini: { name: "Gemini", models: ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-3.1-flash-lite"], free: true },
    groq: { name: "Groq", models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.6-27b"], free: true },
    openai: { name: "OpenAI", models: ["gpt-4o-mini", "gpt-4o", "gpt-5.6-luna", "gpt-5.6-terra"], free: false },
    anthropic: { name: "Anthropic Claude", models: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-8"], free: false },
    deepseek: { name: "DeepSeek", models: ["deepseek-v4-flash", "deepseek-v4-pro"], free: false },
    openrouter: { name: "OpenRouter", models: ["openrouter/free", "openai/gpt-oss-120b:free", "qwen/qwen3-coder:free", "meta-llama/llama-3.3-70b-instruct:free"], free: true }
  };

  // ── STORAGE MANAGEMENT ──────────────────────────────────────────────────────

  // Initialize Settings on install
  chrome.runtime.onInstalled.addListener(() => {
    SettingsService.loadSettings();

    // Context Menu configuration
    const CONTEXT_MENU_URL_PATTERNS = [
      "https://chat.openai.com/*", "https://chatgpt.com/*",
      "https://claude.ai/*", "https://gemini.google.com/*",
      "https://grok.com/*", "https://x.com/*", "https://copilot.microsoft.com/*",
      "https://www.perplexity.ai/*", "https://poe.com/*", "https://chat.groq.com/*",
      "https://*.deepseek.com/*", "https://*.mistral.ai/*",
      "https://*.openrouter.ai/*", "https://*.qwen.ai/*"
    ];

    chrome.contextMenus.create({
      id: "sweater-knit-v2",
      title: "🧶 Knit this conversation",
      contexts: ["page"],
      documentUrlPatterns: CONTEXT_MENU_URL_PATTERNS
    });

    // Second top-level item — Chrome automatically nests 2+ items from the
    // same extension under a "Sweater" flyout submenu, matching the
    // requested context-menu behavior.
    chrome.contextMenus.create({
      id: "sweater-ask-mini-v2",
      title: "🐑 Ask Mini Sweater",
      contexts: ["page"],
      documentUrlPatterns: CONTEXT_MENU_URL_PATTERNS
    });
  });

  // Context Menu trigger
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "sweater-knit-v2" && tab) {
      chrome.tabs.sendMessage(tab.id, { action: "QUICK_KNIT" });
    }
    if (info.menuItemId === "sweater-ask-mini-v2" && tab) {
      chrome.tabs.sendMessage(tab.id, { action: "OPEN_MINI_SWEATER" });
    }
  });

  // ── MESSAGE ROUTER ──────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

    // 1. Settings Ops
    if (msg.action === "GET_SETTINGS") {
      SettingsService.loadSettings().then(settings => sendResponse({ settings }));
      return true;
    }

    if (msg.action === "SAVE_SETTINGS") {
      SettingsService.saveSettings(msg.settings).then(success => {
        EventBus.publish("settingsChanged", msg.settings);
        sendResponse({ success });
      });
      return true;
    }

    // 2. Providers info
    if (msg.action === "GET_PROVIDERS") {
      const list = Object.entries(PROVIDER_METADATA).map(([id, p]) => ({
        id, name: p.name, models: p.models, free: p.free
      }));
      sendResponse({ providers: list });
      return true;
    }

    // 3. Vault / Capsule Ops (with Versioning support)
    if (msg.action === "SAVE_CAPSULE") {
      chrome.storage.local.get(["sweaters"], (res) => {
        const sweaters = res.sweaters || [];
        const existingIdx = sweaters.findIndex(s => s.id === msg.capsule.id);

        let targetCapsule = msg.capsule;

        if (existingIdx > -1) {
          // Found existing capsule, append new version (object form preserves compressed flag)
          const existing = sweaters[existingIdx];
          targetCapsule = StateEngine.addVersion(existing, msg.capsule);
          // Sync parameters that may not be covered by addVersion
          targetCapsule.title = msg.capsule.title || targetCapsule.title;
          targetCapsule.tags = msg.capsule.tags || targetCapsule.tags;
          if (typeof msg.capsule.compressed === "boolean") {
            targetCapsule.compressed = msg.capsule.compressed;
          }
          if (msg.capsule.compressFormat) {
            targetCapsule.compressFormat = msg.capsule.compressFormat;
          }
          if (msg.capsule.contextLength != null) {
            targetCapsule.contextLength = msg.capsule.contextLength;
          }
          sweaters[existingIdx] = targetCapsule;
        } else {
          // Initialize fresh versions array
          targetCapsule.versions = [
            {
              version: 1,
              timestamp: new Date().toISOString(),
              continuePrompt: msg.capsule.continuePrompt,
              state: msg.capsule.state || null,
              compressFormat: msg.capsule.compressFormat || null,
              messageCount: msg.capsule.messageCount
            }
          ];
          sweaters.unshift(targetCapsule);
          if (sweaters.length > 100) sweaters.splice(100);
        }

        chrome.storage.local.set({ sweaters }, () => {
          EventBus.publish("capsuleSaved", targetCapsule);
          sendResponse({ success: true, count: sweaters.length, capsule: targetCapsule });
        });
      });
      return true;
    }

    if (msg.action === "GET_CAPSULES") {
      chrome.storage.local.get(["sweaters"], (res) => sendResponse({ capsules: res.sweaters || [] }));
      return true;
    }

    if (msg.action === "DELETE_CAPSULE") {
      chrome.storage.local.get(["sweaters"], (res) => {
        const sweaters = (res.sweaters || []).filter(s => s.id !== msg.id);
        chrome.storage.local.set({ sweaters }, () => {
          EventBus.publish("capsuleDeleted", { id: msg.id });
          sendResponse({ success: true });
        });
      });
      return true;
    }

    if (msg.action === "IMPORT_CAPSULES") {
      chrome.storage.local.get(["sweaters"], (res) => {
        const existing = res.sweaters || [];
        const merged = [...(msg.capsules || []), ...existing];
        const seen = new Set();
        const deduped = merged.filter(s => {
          if (seen.has(s.id)) return false;
          seen.add(s.id);
          return true;
        });
        chrome.storage.local.set({ sweaters: deduped.slice(0, 100) }, () => {
          EventBus.publish("capsulesImported", { count: deduped.length });
          sendResponse({ success: true, count: deduped.length });
        });
      });
      return true;
    }

    if (msg.action === "UPDATE_CAPSULE") {
      chrome.storage.local.get(["sweaters"], (res) => {
        const sweaters = (res.sweaters || []).map(s => s.id === msg.capsule.id ? msg.capsule : s);
        chrome.storage.local.set({ sweaters }, () => {
          sendResponse({ success: true });
        });
      });
      return true;
    }

    if (msg.action === "RESTORE_CAPSULE_VERSION") {
      chrome.storage.local.get(["sweaters"], (res) => {
        const sweaters = res.sweaters || [];
        const idx = sweaters.findIndex(s => s.id === msg.id);
        if (idx > -1) {
          const restored = StateEngine.restoreVersion(sweaters[idx], msg.version);
          sweaters[idx] = restored;
          chrome.storage.local.set({ sweaters }, () => {
            EventBus.publish("capsuleSaved", restored);
            sendResponse({ success: true, capsule: restored });
          });
        } else {
          sendResponse({ success: false, error: "Capsule not found" });
        }
      });
      return true;
    }

    // 4. Model Capabilities
    if (msg.action === "GET_CAPABILITIES") {
      ModelRegistry.getCapabilities(msg.provider, msg.model).then(caps => {
        sendResponse({ capabilities: caps });
      });
      return true;
    }

    if (msg.action === "DISCOVER_CAPABILITIES") {
      ModelRegistry.discoverCapabilities(msg.providerConfig).then(() => {
        sendResponse({ success: true });
      });
      return true;
    }

    // 5. Intelligent AI Engine execution (Routed through Queue)
    const QUEUED_AI_ACTIONS = [
      "AI_SUMMARIZE", "AI_TRANSLATE", "AI_INSIGHTS",
      "AI_SMART_TITLE", "AI_CHAT", "AI_COMPRESS",
      "AI_CLASSIFY", "AI_SMART_SAVE", "AI_PLUGIN"
    ];

    if (QUEUED_AI_ACTIONS.includes(msg.action)) {
      JobQueue.add(async () => {
        let prompt = msg.prompt;
        let systemPrompt = msg.system || null;
        let maxTokens = msg.maxTokens || 1000;
        let temperature = msg.temperature || 0.7;

        // Smart Save engine
        if (msg.action === "AI_SMART_SAVE") {
          prompt = PromptRegistry.SMART_SAVE_PROMPT.replace("{text}", msg.prompt);
          systemPrompt = "You are a state checkpoint builder. Output valid YAML matching the structure provided.";
          maxTokens = 1200;
        }

        // Universal Classifier engine
        if (msg.action === "AI_CLASSIFY") {
          return await Classifier.classify(msg.prompt);
        }

        // Dyn Compression engine
        if (msg.action === "AI_COMPRESS") {
          const category = msg.category || "General";
          prompt = PromptRegistry.getCompressionPrompt(category, msg.prompt);
          systemPrompt = "You are a state compression compressor. Output YAML context state matching structure guidelines.";
          maxTokens = 1500;
          const startTime = Date.now();
          const result = await AIEngine.execute(prompt, {
            systemPrompt,
            maxTokens,
            temperature,
            customProviderId: msg.customProviderId,
            useFallbackChain: true
          });
          const duration = Date.now() - startTime;
          if (globalThis.Telemetry) {
            await Telemetry.recordCompression("smart", duration, msg.prompt.length, result.length);
          }
          return result;
        }

        // Mapping standard action limits
        if (!msg.maxTokens) {
          maxTokens = {
            AI_SUMMARIZE: 800, AI_TRANSLATE: 3000, AI_INSIGHTS: 1200,
            AI_SMART_TITLE: 80, AI_CHAT: 1500
          }[msg.action] || maxTokens;
        }

        // Run execution
        return await AIEngine.execute(prompt, {
          systemPrompt,
          maxTokens,
          temperature,
          customProviderId: msg.customProviderId,
          useFallbackChain: msg.action !== "AI_PLUGIN"
        });
      }, msg.action)
        .then(result => {
          if (msg.action === "AI_COMPRESS") {
            const stateQuality = StateEngine.evaluateQuality(result);
            sendResponse({ result, quality: stateQuality });
          } else {
            sendResponse({ result });
          }
        })
        .catch(err => {
          sendResponse({
            error: err.message,
            diagnostic: err.diagnostic || { type: "unknown", message: err.message, suggestion: "An unexpected error occurred." }
          });
        });
      return true;
    }
  });

  // Keyboard commands listener
  chrome.commands.onCommand.addListener((command) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      if (command === "toggle-panel") chrome.tabs.sendMessage(tabs[0].id, { action: "TOGGLE_PANEL" });
      if (command === "quick-knit") chrome.tabs.sendMessage(tabs[0].id, { action: "QUICK_KNIT" });
      if (command === "hide-fab") chrome.tabs.sendMessage(tabs[0].id, { action: "HIDE_FAB" });
    });
  });

})();
