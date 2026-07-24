// Sweater v2 — Provider Adapters
(function (global) {
  "use strict";

  // Base Provider Class
  class BaseProvider {
    constructor(apiKey, model) {
      this.apiKey = apiKey;
      this.model = model;
    }

    // Default request timeout for provider API calls. There was previously no
    // timeout at all, so a slow/unresponsive provider would hang forever
    // instead of failing (and letting any retry logic kick in). Subclasses
    // may override this (e.g. NVIDIA NIM, which can be slower) to allow more
    // time before aborting.
    getTimeoutMs() {
      return 30000;
    }

    // Wraps fetch() with an AbortController tied to getTimeoutMs(), so a
    // hung request fails with a clear timeout error rather than hanging.
    async fetchWithTimeout(endpoint, options = {}) {
      const controller = new AbortController();
      const timeoutMs = this.getTimeoutMs();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(endpoint, { ...options, signal: controller.signal });
      } catch (e) {
        if (e && e.name === "AbortError") {
          const timeoutErr = new Error(`${this.name || "Provider"} request timed out after ${Math.round(timeoutMs / 1000)}s`);
          timeoutErr.status = 408;
          timeoutErr.provider = this.providerId || this.name;
          timeoutErr.isTimeout = true;
          throw timeoutErr;
        }
        throw e;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    async call(prompt, maxTokens, systemPrompt, temperature) {
      throw new Error("call() method must be implemented by subclass");
    }
  }

  // 1. Gemini Provider Adapter
  class GeminiProvider extends BaseProvider {
    constructor(apiKey, model) {
      super(apiKey, model);
      this.name = "Gemini";
      this.providerId = "gemini";
    }

    async call(prompt, maxTokens = 1000, systemPrompt = null, temperature = 0.7) {
      const modelName = this.model || "gemini-3.5-flash";
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${this.apiKey}`;

      const contents = [];
      if (systemPrompt) {
        contents.push({ role: "user", parts: [{ text: systemPrompt + "\n\n" + prompt }] });
      } else {
        contents.push({ role: "user", parts: [{ text: prompt }] });
      }

      const resp = await this.fetchWithTimeout(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: temperature
          }
        })
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        let errorJson = {};
        try { errorJson = JSON.parse(errorText); } catch (e) { }
        const msg = errorJson?.error?.message || `Gemini API error ${resp.status}`;

        // Throw custom error containing status and message for diagnostics
        const errObj = new Error(msg);
        errObj.status = resp.status;
        errObj.body = errorJson;
        errObj.provider = "gemini";
        throw errObj;
      }

      const data = await resp.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }
  }

  // 2. OpenAI Style Base (shared code for OpenAI, Groq, DeepSeek, OpenRouter)
  class OpenAISuperProvider extends BaseProvider {
    constructor(apiKey, model, endpoint, name, providerId) {
      super(apiKey, model);
      this.endpoint = endpoint;
      this.name = name;
      this.providerId = providerId || name.toLowerCase();
    }

    getHeaders() {
      return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`
      };
    }

    async call(prompt, maxTokens = 1000, systemPrompt = null, temperature = 0.7) {
      const messages = [];
      if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
      }
      messages.push({ role: "user", content: prompt });

      const resp = await this.fetchWithTimeout(this.endpoint, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: this.model,
          messages: messages,
          max_tokens: maxTokens,
          temperature: temperature
        })
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        let errorJson = {};
        try { errorJson = JSON.parse(errorText); } catch (e) { }
        const msg = errorJson?.error?.message || `${this.name} API error ${resp.status}`;

        const errObj = new Error(msg);
        errObj.status = resp.status;
        errObj.body = errorJson;
        errObj.provider = this.providerId;
        throw errObj;
      }

      const data = await resp.json();
      return data.choices?.[0]?.message?.content || "";
    }
  }

  // OpenAI Provider Adapter
  class OpenAIProvider extends OpenAISuperProvider {
    constructor(apiKey, model) {
      super(apiKey, model || "gpt-4o-mini", "https://api.openai.com/v1/chat/completions", "OpenAI", "openai");
    }
  }

  // Groq Provider Adapter
  class GroqProvider extends OpenAISuperProvider {
    constructor(apiKey, model) {
      super(apiKey, model || "openai/gpt-oss-120b", "https://api.groq.com/openai/v1/chat/completions", "Groq", "groq");
    }
  }

  // DeepSeek Provider Adapter
  class DeepSeekProvider extends OpenAISuperProvider {
    constructor(apiKey, model) {
      super(apiKey, model || "deepseek-v4-flash", "https://api.deepseek.com/v1/chat/completions", "DeepSeek", "deepseek");
    }
  }

  // OpenRouter Provider Adapter
  class OpenRouterProvider extends OpenAISuperProvider {
    constructor(apiKey, model) {
      super(apiKey, model || "openrouter/free", "https://openrouter.ai/api/v1/chat/completions", "OpenRouter", "openrouter");
    }

    getHeaders() {
      return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
        "HTTP-Referer": "https://github.com/sweater-ai/sweater",
        "X-Title": "Sweater Extension"
      };
    }
  }

  // NOTE: CerebrasProvider removed in the July 2026 provider audit. Cerebras's "free"
  // tier now requires adding a verified payment method for a one-time $5 credit that
  // expires after 30 days (PAYGO billing after that), and the models this extension
  // previously defaulted to (llama-3.3-70b, qwen-3-*) were already deprecated Feb 16,
  // 2026. See CHANGES.md for the full rationale.

  // NVIDIA NIM Provider Adapter
  class NvidiaProvider extends OpenAISuperProvider {
    constructor(apiKey, model) {
      super(apiKey, model || "openai/gpt-oss-120b", "https://integrate.api.nvidia.com/v1/chat/completions", "NVIDIA NIM", "nvidia");
    }

    getHeaders() {
      return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`
      };
    }

    // NVIDIA NIM responses can be slower than other providers, especially on
    // cold-started or larger models — allow more time before aborting.
    getTimeoutMs() {
      return 45000;
    }
  }

  // Ollama (local) Provider Adapter
  class OllamaProvider extends OpenAISuperProvider {
    constructor(apiKey, model) {
      super(apiKey || "ollama", model || "llama3.2", "http://localhost:11434/v1/chat/completions", "Ollama", "ollama");
    }

    getHeaders() {
      return { "Content-Type": "application/json" };
    }
  }

  // LM Studio (local) Provider Adapter
  class LMStudioProvider extends OpenAISuperProvider {
    constructor(apiKey, model) {
      super(apiKey || "lmstudio", model || "local-model", "http://localhost:1234/v1/chat/completions", "LM Studio", "lmstudio");
    }

    getHeaders() {
      return { "Content-Type": "application/json" };
    }
  }

  // 3. Anthropic Claude Provider Adapter
  class AnthropicProvider extends BaseProvider {
    constructor(apiKey, model) {
      super(apiKey, model);
      this.name = "Anthropic";
      this.providerId = "anthropic";
    }

    async call(prompt, maxTokens = 1000, systemPrompt = null, temperature = 0.7) {
      const endpoint = "https://api.anthropic.com/v1/messages";
      const modelName = this.model || "claude-sonnet-4-6";

      const body = {
        model: modelName,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
        temperature: temperature
      };

      if (systemPrompt) {
        body.system = systemPrompt;
      }

      const resp = await this.fetchWithTimeout(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify(body)
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        let errorJson = {};
        try { errorJson = JSON.parse(errorText); } catch (e) { }
        const msg = errorJson?.error?.message || `Anthropic API error ${resp.status}`;

        const errObj = new Error(msg);
        errObj.status = resp.status;
        errObj.body = errorJson;
        errObj.provider = "anthropic";
        throw errObj;
      }

      const data = await resp.json();
      return data.content?.[0]?.text || "";
    }
  }

  // 4. Provider Factory Map
  const ProviderFactory = {
    create: function (providerName, apiKey, modelName) {
      switch (providerName) {
        case "gemini":
          return new GeminiProvider(apiKey, modelName);
        case "groq":
          return new GroqProvider(apiKey, modelName);
        case "openai":
          return new OpenAIProvider(apiKey, modelName);
        case "anthropic":
          return new AnthropicProvider(apiKey, modelName);
        case "deepseek":
          return new DeepSeekProvider(apiKey, modelName);
        case "openrouter":
          return new OpenRouterProvider(apiKey, modelName);
        case "nvidia":
          return new NvidiaProvider(apiKey, modelName);
        case "ollama":
          return new OllamaProvider(apiKey, modelName);
        case "lmstudio":
          return new LMStudioProvider(apiKey, modelName);
        default:
          throw new Error(`Unsupported provider: ${providerName}`);
      }
    }
  };

  // Expose context
  const target = typeof window !== "undefined" ? window : globalThis;
  target.GeminiProvider = GeminiProvider;
  target.GroqProvider = GroqProvider;
  target.OpenAIProvider = OpenAIProvider;
  target.AnthropicProvider = AnthropicProvider;
  target.DeepSeekProvider = DeepSeekProvider;
  target.OpenRouterProvider = OpenRouterProvider;
  target.NvidiaProvider = NvidiaProvider;
  target.OllamaProvider = OllamaProvider;
  target.LMStudioProvider = LMStudioProvider;
  target.ProviderFactory = ProviderFactory;
})(typeof window !== "undefined" ? window : globalThis);
