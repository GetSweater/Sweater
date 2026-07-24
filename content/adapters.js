// Sweater v2 — Site Adapters
(function (global) {
  "use strict";

  // Helper: Sleep
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Helper: Visibility Check
  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // Sweater's own shadow-DOM hosts. These must never be treated as "the page's
  // chat input" — findInputInShadow() below deliberately pierces shadow roots
  // to locate a site's real composer, and without this exclusion it can also
  // wander into Sweater's own UI (e.g. the #sw-chat-input panel or the Mini
  // Sweater #mini-input box) and mistake them for the underlying LLM's input.
  const SWEATER_OWNED_HOST_IDS = new Set([
    "sweater-shadow-host",            // main Sweater panel/FAB (contains #sw-chat-input)
    "sweater-mini-trigger",           // Mini Sweater selection trigger button
    "sweater-mini-widget-container",  // Mini Sweater widget (contains #mini-input)
  ]);

  function isSweaterOwnedHost(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName.toLowerCase() === "sweater-shadow-host") return true;
    return !!(el.id && SWEATER_OWNED_HOST_IDS.has(el.id));
  }

  // Helper: Shadow DOM Traversal to find inputs
  function findInputInShadow(node, selectors) {
    if (!node) return null;
    for (const s of selectors) {
      try {
        const found = node.querySelector(s);
        if (found && visible(found)) return found;
      } catch (e) { }
    }
    const children = node.querySelectorAll ? node.querySelectorAll('*') : [];
    for (const child of children) {
      // Never descend into Sweater's own shadow-DOM hosts — they are not the
      // page's chat input, even if one of their internal elements happens to
      // match a generic selector like "textarea" or "[contenteditable=true]".
      if (child.shadowRoot && !isSweaterOwnedHost(child)) {
        const found = findInputInShadow(child.shadowRoot, selectors);
        if (found) return found;
      }
    }
    return null;
  }

  // Helper: File Attachment Check
  function fileAttachConfirmed() {
    const selectors = [
      '[data-testid*="attachment"]', '[class*="attachment-chip"]', '[class*="file-chip"]',
      '[class*="attached-file"]', '[aria-label*="attachment" i]', '[class*="file-preview"]',
    ];
    for (const sel of selectors) {
      try {
        if (document.querySelector(sel)) return true;
      } catch (e) { }
    }
    return false;
  }

  // Helper: Safe Filename
  function safeFilename(title, fmt) {
    const base = (title || "sweater-knit").replace(/[^a-z0-9\-_]/gi, "-").toLowerCase();
    const suffix = fmt === "clean" ? "clean" : fmt === "transcript" ? "transcript" : "smart-memory";
    return `${base}-${suffix}.txt`;
  }

  // Helper: Build File for attachment
  function buildAttachmentFile(cap) {
    const fmt = cap.compressFormat || "smart";
    const date = new Date(cap.createdAt || Date.now()).toLocaleString();
    const header = `SWEATER — ${fmt === "clean" ? "Clean Chat" : fmt === "transcript" ? "Transcript" : "Smart Memory"}\nSource: ${cap.source || "AI"} · Knitted: ${date} · Messages: ${cap.messageCount || "?"}\n\n`;
    const body = cap.continuePrompt || "";
    const content = header + body + `\n\n[End of context — paste/attach into any AI to continue]\n`;
    const filename = safeFilename(cap.title, fmt);
    return new File([content], filename, { type: "text/plain" });
  }

  // Base Site Adapter
  class BaseSiteAdapter {
    constructor(name) {
      this.name = name;
    }

    detect() {
      throw new Error("detect() must be implemented by subclass");
    }

    getInputSelectors() {
      return [
        "#prompt-textarea",
        '.ProseMirror[contenteditable="true"]',
        'div[contenteditable="true"]',
        ".ql-editor", "textarea",
        '[contenteditable="true"]'
      ];
    }

    detectInput() {
      return findInputInShadow(document.body, this.getInputSelectors());
    }

    extractMessages() {
      throw new Error("extractMessages() must be implemented by subclass");
    }

    async injectPrompt(text, capsule) {
      const el = this.detectInput();
      if (!el) return false;

      // Ensure focused
      el.focus();
      await sleep(150);

      // Always inject compressed context as text so autofill/shortcuts work.
      // File attach + auto-download is not used here — export/download is explicit only.
      const promptText = text || (capsule && capsule.continuePrompt) || "";

      // Plain text injection
      if (el.tagName === "TEXTAREA") {
        return await this._injectReactTextarea(el, promptText);
      } else {
        return await this._injectContentEditable(el, promptText);
      }
    }

    async triggerSend() {
      const sendSelectors = [
        'button[data-testid="send-button"]',
        'button[aria-label="Send message"]',
        'button[aria-label="Send prompt"]',
        '[data-testid="fruitjuice-send-button"]',
        'button.send-btn',
        'button[type="submit"]',
        'button:has(svg[data-icon="send"])',
      ];
      for (const sel of sendSelectors) {
        try {
          const btn = document.querySelector(sel);
          if (btn && !btn.disabled && visible(btn)) {
            btn.click();
            return true;
          }
        } catch (e) { }
      }
      const inp = this.detectInput();
      if (inp) {
        inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
        return true;
      }
      return false;
    }

    // --- Private Injections Helpers ---

    async _injectReactTextarea(el, text) {
      try {
        const prototype = Object.getPrototypeOf(el);
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value") ||
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value") ||
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

        if (descriptor && descriptor.set) {
          descriptor.set.call(el, text);
        } else {
          el.value = text;
        }

        ["input", "change", "keyup"].forEach(type => {
          el.dispatchEvent(new Event(type, { bubbles: true }));
        });

        // Simulating space key press to trigger any reactive framework states
        el.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }));
        await sleep(150);
        return el.value?.trim()?.length > 0;
      } catch (e) {
        console.error("[SiteAdapter] React injection failed", e);
        return false;
      }
    }

    async _injectContentEditable(el, text) {
      try {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);

        const success = document.execCommand("selectAll", false, null);
        await sleep(50);
        const insertSuccess = document.execCommand("insertText", false, text);

        if (!insertSuccess || !el.innerText?.trim()) {
          el.textContent = text;
        }

        el.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: text
        }));

        await sleep(150);
        return el.innerText.trim().length > 0;
      } catch (e) {
        console.error("[SiteAdapter] ContentEditable injection failed", e);
        return false;
      }
    }

    async _wearAsFile(file, rawText) {
      // 1. Try to upload to inputs
      const fileInput = document.querySelector('input[type="file"]');
      if (fileInput) {
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          fileInput.files = dt.files;
          fileInput.dispatchEvent(new Event("change", { bubbles: true }));
          await sleep(400);
          if (fileAttachConfirmed()) return true;
        } catch (e) { }
      }

      // 2. Drag & Drop simulation
      const dropTarget = this.detectInput()?.closest("form, [class*='composer'], [class*='input']") || this.detectInput();
      if (dropTarget) {
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          for (const type of ["dragenter", "dragover", "drop"]) {
            dropTarget.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
          }
          await sleep(400);
          if (fileAttachConfirmed()) return true;
        } catch (e) { }
      }

      // 3. Try to paste file as ClipboardEvent
      try {
        const pasteSuccess = await new Promise((resolve) => {
          let resolved = false;
          const timer = setTimeout(() => { if (!resolved) { resolved = true; resolve(false); } }, 1000);
          (async () => {
            const inp = this.detectInput();
            if (!inp) return false;
            const dt = new DataTransfer();
            dt.items.add(file);
            inp.focus();
            await sleep(60);
            const pasteEvent = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
            inp.dispatchEvent(pasteEvent);
            await sleep(350);
            return fileAttachConfirmed();
          })().then(v => { if (!resolved) { resolved = true; clearTimeout(timer); resolve(v); } })
            .catch(() => { if (!resolved) { resolved = true; clearTimeout(timer); resolve(false); } });
        });
        if (pasteSuccess) return true;
      } catch (e) { }

      // 4. Fallback: copy text only (no automatic download — export is explicit)
      try {
        await navigator.clipboard.writeText(rawText);
      } catch (e) { }

      return "fallback";
    }
  }

  // 1. ChatGPT Adapter
  class ChatGPTAdapter extends BaseSiteAdapter {
    constructor() {
      super("ChatGPT");
    }

    detect() {
      const host = location.hostname;
      return host.includes("chatgpt.com") || host.includes("chat.openai.com");
    }

    extractMessages() {
      const msgs = [];
      document.querySelectorAll("[data-message-author-role]").forEach(el => {
        const role = el.getAttribute("data-message-author-role");
        const content = (el.querySelector(".markdown") || el.querySelector(".whitespace-pre-wrap") || el)?.innerText?.trim();
        if (content) msgs.push({ role: role === "assistant" ? "assistant" : "user", content });
      });
      return msgs;
    }
  }

  // 2. Claude Adapter
  class ClaudeAdapter extends BaseSiteAdapter {
    constructor() {
      super("Claude");
    }

    detect() {
      return location.hostname.includes("claude.ai");
    }

    extractMessages() {
      // Primary: current claude.ai markup — user turns carry data-testid="user-message",
      // assistant turns are rendered inside .font-claude-message. Query together to
      // preserve document order (conversation order).
      const primary = document.querySelectorAll('[data-testid="user-message"], .font-claude-message');
      if (primary.length) {
        const msgs = Array.from(primary)
          .map(el => ({
            role: el.matches('[data-testid="user-message"]') ? "user" : "assistant",
            content: el.innerText.trim()
          }))
          .filter(m => m.content);
        if (msgs.length) return msgs;
      }

      // Secondary: older claude.ai builds used these testids/classes.
      const legacy = document.querySelectorAll('[data-testid="human-turn"],[data-testid="ai-turn"],.human-turn,.ai-turn');
      if (legacy.length) {
        const msgs = Array.from(legacy)
          .map(t => ({
            role: (t.getAttribute("data-testid") === "human-turn" || t.classList.contains("human-turn")) ? "user" : "assistant",
            content: t.innerText.trim()
          }))
          .filter(m => m.content);
        if (msgs.length) return msgs;
      }

      // Tertiary: walk per-turn render containers and infer role from whether a
      // user-message node exists inside that turn. Guards against future class/testid renames.
      const turnContainers = document.querySelectorAll('[data-test-render-count]');
      if (turnContainers.length) {
        const msgs = [];
        turnContainers.forEach(t => {
          const content = t.innerText.trim();
          if (!content) return;
          const isUser = !!t.querySelector('[data-testid="user-message"], [class*="human"], [class*="user"]');
          msgs.push({ role: isUser ? "user" : "assistant", content });
        });
        if (msgs.length) return msgs;
      }

      return [];
    }
  }

  // 3. Gemini Adapter
  class GeminiAdapter extends BaseSiteAdapter {
    constructor() {
      super("Gemini");
    }

    detect() {
      return location.hostname.includes("gemini.google.com");
    }

    // Gemini's composer is a Quill-based rich-textarea, not a generic
    // contenteditable/textarea — prioritize its specific selectors first so
    // detectInput() (used by the FAB and the pending-injection autofill
    // route) reliably finds the real composer instead of an unrelated
    // contenteditable node on the page.
    getInputSelectors() {
      return [
        'rich-textarea [contenteditable="true"]',
        '.input-area [contenteditable="true"]',
        'div.textarea[contenteditable="true"]',
        ".ql-editor",
        '[contenteditable="true"]'
      ];
    }

    // Override with the same execCommand-based approach already proven to
    // work for Gemini's editor (used by the same-tab quick-wear flow), so
    // the cross-tab LLM-shortcut autofill (pending_injection) behaves
    // identically instead of falling back to the generic base-class
    // injector, which does not reliably fill Gemini's composer.
    async injectPrompt(text, capsule) {
      const promptText = text || (capsule && capsule.continuePrompt) || "";
      const el = this.detectInput();
      if (!el) return false;

      try {
        el.focus();
        await sleep(150);
        document.execCommand("selectAll", false, null);
        await sleep(50);
        const success = document.execCommand("insertText", false, promptText);

        if (!success || !el.innerText?.trim()) {
          el.textContent = promptText;
          const range = document.createRange();
          const sel = window.getSelection();
          range.selectNodeContents(el);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }

        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: promptText }));
        await sleep(200);
        return el.innerText?.trim().length > 0;
      } catch (e) {
        console.error("[GeminiAdapter] injection failed", e);
        return false;
      }
    }

    extractMessages() {
      const el = document.querySelector("chat-history,.conversation-container");
      if (el) {
        const msgs = [];
        el.querySelectorAll(".query-content,.response-content").forEach(e => {
          msgs.push({
            role: e.classList.contains("query-content") ? "user" : "assistant",
            content: e.innerText.trim()
          });
        });
        if (msgs.length) return msgs;
      }
      return [];
    }
  }

  // 4. Grok Adapter
  class GrokAdapter extends BaseSiteAdapter {
    constructor() {
      super("Grok");
    }

    detect() {
      return location.hostname.includes("grok.com") || (location.hostname.includes("x.com") && location.pathname.includes("grok"));
    }

    extractMessages() {
      const msgs = [];
      document.querySelectorAll(".message-bubble,[class*='message'],[class*='response']").forEach(el => {
        const text = el.innerText.trim();
        if (text.length > 10) {
          const isUser = el.classList.contains("user") || el.getAttribute("data-role") === "user" || el.closest("[class*='user']");
          msgs.push({ role: isUser ? "user" : "assistant", content: text });
        }
      });
      return msgs;
    }
  }

  // 5. OpenRouter Adapter
  class OpenRouterAdapter extends BaseSiteAdapter {
    constructor() {
      super("OpenRouter");
    }

    detect() {
      return location.hostname.includes("openrouter.ai");
    }

    extractMessages() {
      const msgs = [];
      document.querySelectorAll('[class*="Message_container"]').forEach(el => {
        const isUser = el.querySelector('[class*="Message_user"]');
        const text = el.innerText.trim();
        if (text) {
          msgs.push({ role: isUser ? "user" : "assistant", content: text });
        }
      });
      return msgs;
    }
  }

  // 6. DeepSeek Adapter
  class DeepSeekAdapter extends BaseSiteAdapter {
    constructor() {
      super("DeepSeek");
    }

    detect() {
      return location.hostname.includes("deepseek.com");
    }

    extractMessages() {
      const msgs = [];
      document.querySelectorAll("[class*='message-and-actions'],[class*='msg-content']").forEach(el => {
        const content = el.innerText.trim();
        if (content) {
          const isUser = el.closest("[class*='user']") || el.closest("[class*='human']");
          msgs.push({ role: isUser ? "user" : "assistant", content });
        }
      });
      return msgs;
    }
  }

  // 7. Generic / Universal Textarea Adapter
  class GenericTextareaAdapter extends BaseSiteAdapter {
    constructor() {
      super("AI Chat");
    }

    detect() {
      return true; // Match anything
    }

    extractMessages() {
      const msgs = [];
      const seen = new Set();
      document.querySelectorAll('[class*="message"],[class*="turn"],[class*="response"],[class*="query"]').forEach(el => {
        const text = el.innerText.trim();
        if (text.length > 20 && !seen.has(text)) {
          seen.add(text);
          const cls = el.className.toLowerCase();
          const isUser = cls.includes("user") || cls.includes("human") || cls.includes("query");
          msgs.push({ role: isUser ? "user" : "assistant", content: text });
        }
      });
      if (msgs.length === 0) {
        msgs.push({ role: "context", content: document.body.innerText.slice(0, 50000) });
      }
      return msgs;
    }
  }

  // Groq Adapter — uses BaseSiteAdapter inject/extract
  class GroqAdapter extends BaseSiteAdapter {
    constructor() {
      super("Groq");
    }

    detect() {
      const host = location.hostname;
      return host.includes("chat.groq.com") || host.includes("groq.com");
    }

    getInputSelectors() {
      return [
        'textarea[placeholder]',
        'textarea',
        '[contenteditable="true"]',
        "#prompt-textarea",
        '.ProseMirror[contenteditable="true"]'
      ];
    }

    extractMessages() {
      const msgs = [];
      const seen = new Set();
      document.querySelectorAll('[class*="message"],[class*="turn"],[class*="response"],[class*="query"]').forEach(el => {
        const text = el.innerText.trim();
        if (text.length > 10 && !seen.has(text)) {
          seen.add(text);
          const cls = (el.className || "").toLowerCase();
          const isUser = cls.includes("user") || cls.includes("human") || cls.includes("query");
          msgs.push({ role: isUser ? "user" : "assistant", content: text });
        }
      });
      return msgs;
    }
  }

  // Factory
  const SiteAdapterFactory = {
    adapters: [
      new ChatGPTAdapter(),
      new ClaudeAdapter(),
      new GeminiAdapter(),
      new GrokAdapter(),
      new GroqAdapter(),
      new OpenRouterAdapter(),
      new DeepSeekAdapter(),
      new GenericTextareaAdapter() // Default fallback must be last
    ],

    getAdapter: function () {
      return this.adapters.find(a => a.detect());
    }
  };

  // Expose context
  const target = typeof window !== "undefined" ? window : globalThis;
  target.BaseSiteAdapter = BaseSiteAdapter;
  target.SiteAdapterFactory = SiteAdapterFactory;
})(typeof window !== "undefined" ? window : globalThis);
