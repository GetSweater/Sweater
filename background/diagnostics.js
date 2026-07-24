// Sweater v2 — Structured API Diagnostics
(function (global) {
  "use strict";

  const Diagnostics = {
    diagnose: function (provider, error) {
      const status = error.status || 0;
      const message = error.message || "";
      const errorBodyText = error.body ? JSON.stringify(error.body).toLowerCase() : "";

      const diagnostic = {
        type: "unknown",
        message: message,
        suggestion: "Verify that your API key is correctly configured and the provider's services are currently operational. Check the browser console for details."
      };

      // 1. Detect Network Connection Issues
      if (message.includes("failed to fetch") || message.includes("network error") || message.includes("dns") || message.includes("timeout")) {
        diagnostic.type = "network";
        diagnostic.message = "Network connection failed.";
        diagnostic.suggestion = "Could not establish connection to the API servers. Please check your internet connection. If you are behind a corporate firewall, proxy, or VPN, ensure it is not blocking requests to the AI provider's endpoints.";
        return diagnostic;
      }

      // 2. Provider-Specific Diagnostic Rules
      if (provider === "gemini") {
        // Quota Limit
        if (status === 429 || message.includes("Quota exceeded") || message.includes("quota") || errorBodyText.includes("resource_exhausted")) {
          diagnostic.type = "quota";
          diagnostic.message = "Gemini API Quota Exceeded (Rate Limited).";
          diagnostic.suggestion = "Google AI Studio's Free Tier restricts Gemini Flash to 15 Requests Per Minute (RPM) and 1,500 Requests Per Day (RPD). To resolve this: 1) Wait a minute and try again; 2) Link a Google Cloud billing account in Google AI Studio to upgrade to the pay-as-you-go tier (which offers significantly higher limits); or 3) Switch to Groq (Free) in Settings.";
          return diagnostic;
        }

        // Region Restriction
        if (status === 403 || message.includes("Location not supported") || errorBodyText.includes("region") || errorBodyText.includes("location not supported") || errorBodyText.includes("country")) {
          diagnostic.type = "region";
          diagnostic.message = "Gemini API Regional Restriction.";
          diagnostic.suggestion = "Google AI Studio APIs have regional availability limitations (for example, certain regions in Europe face API restrictions on free accounts). To resolve this: 1) Use a VPN connected to a supported region (such as the United States); or 2) Switch to Groq (Free) or Claude in Settings.";
          return diagnostic;
        }

        // Invalid Key
        if (status === 400 || message.includes("API key not valid") || errorBodyText.includes("api_key_invalid") || errorBodyText.includes("key is invalid")) {
          diagnostic.type = "key";
          diagnostic.message = "Invalid Gemini API Key.";
          diagnostic.suggestion = "The Gemini API key entered is invalid. Please copy the key directly from Google AI Studio and re-paste it in Settings. NOTE: If this is a newly created key, it can take up to 5 minutes to propagate across Google's global servers.";
          return diagnostic;
        }

        // Model unsupported
        if (status === 404 || message.includes("not found") || errorBodyText.includes("model not supported") || errorBodyText.includes("not supported")) {
          diagnostic.type = "model_availability";
          diagnostic.message = "Gemini Model Unavailable.";
          diagnostic.suggestion = "The model specified is not supported by your API key. Make sure you are using a valid model identifier (e.g. gemini-2.0-flash or gemini-2.5-flash) and that your key is associated with a project that supports this model.";
          return diagnostic;
        }
      }

      // OpenAI-compatible providers (each uses its own key + endpoint)
      if (provider === "openai" || provider === "groq" || provider === "deepseek" || provider === "openrouter"
        || provider === "cerebras" || provider === "nvidia" || provider === "ollama" || provider === "lmstudio") {
        const labelMap = {
          openai: "OpenAI", groq: "Groq", deepseek: "DeepSeek", openrouter: "OpenRouter",
          cerebras: "Cerebras", nvidia: "NVIDIA NIM", ollama: "Ollama", lmstudio: "LM Studio"
        };
        const provLabel = labelMap[provider] || (provider.charAt(0).toUpperCase() + provider.slice(1));
        
        // Key invalid
        if (status === 401 || errorBodyText.includes("invalid api key") || errorBodyText.includes("invalid_api_key") || errorBodyText.includes("authentication failed")) {
          diagnostic.type = "key";
          diagnostic.message = `Invalid ${provLabel} API Key.`;
          diagnostic.suggestion = `The API key you entered is not recognized by ${provLabel}. Please check for trailing spaces, verify you copied the full key from your dashboard, and try re-saving.`;
          return diagnostic;
        }

        // Quota / Billing limit
        if (status === 429 || errorBodyText.includes("insufficient_quota") || errorBodyText.includes("quota exceeded") || errorBodyText.includes("rate limit") || errorBodyText.includes("resource_exhausted")) {
          if (errorBodyText.includes("credit") || errorBodyText.includes("billing") || errorBodyText.includes("quota")) {
            diagnostic.type = "billing";
            diagnostic.message = `${provLabel} Quota Exceeded (Insuffient Credit).`;
            diagnostic.suggestion = `Your ${provLabel} account lacks credits or billing has been suspended. Note that paid providers like OpenAI and Anthropic are pay-as-you-go and require a prepaid cash balance. Please go to the billing panel of your ${provLabel} dashboard and top up your credits.`;
          } else {
            diagnostic.type = "rate_limit";
            diagnostic.message = `${provLabel} API Rate Limit Reached.`;
            diagnostic.suggestion = `You have hit the rate limits (tokens per minute or requests per minute) for your current billing tier on ${provLabel}. Please wait a brief moment for the rate limit window to reset and try again.`;
          }
          return diagnostic;
        }
      }

      // Anthropic
      if (provider === "anthropic") {
        if (status === 401 || errorBodyText.includes("invalid api key") || errorBodyText.includes("authentication_error")) {
          diagnostic.type = "key";
          diagnostic.message = "Invalid Anthropic API Key.";
          diagnostic.suggestion = "The Anthropic API key entered is invalid. Please retrieve a new key from the Anthropic Console. Make sure you don't include leading or trailing spaces.";
          return diagnostic;
        }

        if (status === 429 || errorBodyText.includes("rate_limit_error") || errorBodyText.includes("quota")) {
          diagnostic.type = "billing";
          diagnostic.message = "Anthropic Quota Exceeded.";
          diagnostic.suggestion = "You have hit Anthropic's rate limits or run out of account credits. Make sure you have a funded billing profile in the Anthropic Console dashboard.";
          return diagnostic;
        }
      }

      // Generic Status Fallbacks
      if (status === 401 || status === 403) {
        diagnostic.type = "key";
        diagnostic.message = "Authentication or Permission Error.";
        diagnostic.suggestion = "The API key does not have permissions to access this model. Please check the permissions and billing status on your provider's console.";
      } else if (status === 429) {
        diagnostic.type = "rate_limit";
        diagnostic.message = "Rate Limit Exceeded.";
        diagnostic.suggestion = "Too many requests. Please wait a minute before making another request, or check if your provider account has billing issues.";
      } else if (status >= 500) {
        diagnostic.type = "server_error";
        diagnostic.message = "AI Provider Server Error.";
        diagnostic.suggestion = `The API provider servers returned an internal server error (HTTP ${status}). This is usually a temporary outage. Wait a moment and retry, or check the provider's status page.`;
      }

      return diagnostic;
    }
  };

  // Expose context
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Diagnostics;
  } else {
    global.Diagnostics = Diagnostics;
  }
})(typeof window !== "undefined" ? window : globalThis);
