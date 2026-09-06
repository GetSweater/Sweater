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

  // Helper: Resolve Universal Work Asset Data (Code, Images, PDFs, PPTs, Spreadsheets, Archives, Resumes)
  async function resolveAttachmentData(el, name, type, href) {
    const filename = (name || el.getAttribute("alt") || el.getAttribute("aria-label") || "attached_work_asset").trim();
    const cleanType = (type || filename.split('.').pop() || "").toLowerCase();

    const assetId = `asset_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    let assetType = "other";
    let purpose = "unknown";
    let relationship = "reference_for_current_task";
    let relevance = "important";
    let preserveOriginal = true;
    let extractionStatus = "extracted";
    let content = "";
    let originalData = href || el.getAttribute("src") || null;
    let metadata = {};

    // 1. Image Asset DOM Resolution (Screenshots, Brand Logos, UI References, Image-Gen References)
    const isImgEl = el.tagName === "IMG" || el.querySelector("img") || /png|jpg|jpeg|gif|webp|svg/i.test(cleanType) || el.getAttribute("src") || (el.className || "").toString().includes("image");
    if (isImgEl) {
      assetType = "image";
      purpose = /logo|brand/i.test(filename) ? "branding_asset" : /ref|style|prompt|gen/i.test(filename) ? "image-generation reference" : "visual_reference";
      relationship = "visual_reference";
      const imgSrc = el.getAttribute("src") || el.querySelector("img")?.getAttribute("src") || href || "";
      const altText = el.getAttribute("alt") || el.querySelector("img")?.getAttribute("alt") || "";
      originalData = imgSrc;
      metadata = { altText, dimensions: { width: el.clientWidth || 0, height: el.clientHeight || 0 } };
      extractionStatus = imgSrc ? (imgSrc.startsWith("data:") ? "durable_reference" : "session_only") : "metadata_only";

      const imgFormatted = `\n[IMAGE ASSET: ${filename}]\nSTATUS: ${extractionStatus}\nROLE: Visual reference context (${purpose})\nSRC/DATA: ${imgSrc.slice(0, 300)}${imgSrc.length > 300 ? "..." : ""}\nALT: ${altText || "None provided"}\n`;

      return {
        id: assetId,
        name: filename,
        type: assetType,
        mimeType: `image/${cleanType || "png"}`,
        source: imgSrc || href || "DOM",
        content: altText ? `Visual description/alt: ${altText}` : "",
        metadata,
        purpose,
        relationship,
        relevance,
        preserveOriginal: true,
        originalData,
        extractionStatus,
        status: "accessible",
        formatted: imgFormatted
      };
    }

    // 2. Pasted Text Block / Pasted Card DOM Resolution
    const isPastedBlock = /pasted|snippet|clipboard|text/i.test(filename) || (el.className || "").toString().includes("pasted") || el.getAttribute("data-testid")?.includes("pasted");
    if (isPastedBlock) {
      const fullPastedText = el.getAttribute("data-content") || el.getAttribute("data-text") || el.querySelector("pre, code, [class*='content']")?.innerText || "";
      if (fullPastedText.length > 10) {
        return {
          id: assetId,
          name: filename,
          type: "pasted_text",
          mimeType: "text/plain",
          source: "DOM",
          content: fullPastedText,
          metadata: { length: fullPastedText.length },
          purpose: "source_material",
          relationship: "input_to_edit",
          relevance: "critical",
          preserveOriginal: true,
          originalData: fullPastedText,
          extractionStatus: "extracted",
          status: "accessible",
          formatted: `\n[PASTED TEXT / SPECIFICATION BLOCK: ${filename}]\nSTATUS: accessible\nCONTENT:\n${fullPastedText}\n`
        };
      }
    }

    // 3. ZIP Archive Resolution (Task-Agnostic Project/Codebase Archive)
    const isZip = cleanType === "zip" || filename.endsWith(".zip");
    if (isZip && href) {
      try {
        const res = await fetch(href);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();

        if (typeof globalThis.JSZip !== "undefined") {
          const zip = await globalThis.JSZip.loadAsync(arrayBuffer);
          const fileIndex = [];
          const extractedFiles = [];

          const sourceExts = new Set(["js", "ts", "jsx", "tsx", "py", "java", "json", "md", "css", "html", "c", "cpp", "h", "cs", "go", "rs", "sql", "kt", "sh", "txt", "csv", "xml", "yaml", "yml"]);

          for (const relativePath of Object.keys(zip.files)) {
            const entry = zip.files[relativePath];
            if (entry.dir) continue;
            const ext = relativePath.split('.').pop()?.toLowerCase() || "";
            fileIndex.push({ path: relativePath, size: entry._data?.length || 0 });

            if (sourceExts.has(ext) && !relativePath.includes("node_modules") && !relativePath.includes(".git")) {
              try {
                const text = await entry.async("text");
                if (text && text.trim()) {
                  extractedFiles.push({ path: relativePath, content: text });
                }
              } catch (e) { }
            }
          }

          const indexList = fileIndex.slice(0, 50).map(f => `  - ${f.path} (${f.size} B)`).join("\n");
          const extractedBlocks = extractedFiles.slice(0, 15).map(f => `--- FILE: ${f.path} ---\n${f.content}`).join("\n\n");

          return {
            id: assetId,
            name: filename,
            type: "archive",
            mimeType: "application/zip",
            source: href,
            content: extractedBlocks,
            metadata: { fileCount: fileIndex.length, index: fileIndex },
            purpose: "codebase_implementation",
            relationship: "implementation_dependency",
            relevance: "critical",
            preserveOriginal: true,
            originalData: extractedFiles,
            extractionStatus: "extracted",
            status: "accessible",
            formatted: `\n[ATTACHMENT: ${filename} (ZIP Archive — ${fileIndex.length} files)]\nSTATUS: accessible\nARCHIVE INDEX:\n${indexList}\n\nRELEVANT PROJECT FILES:\n${extractedBlocks}\n`
          };
        }
      } catch (e) {
        return {
          id: assetId,
          name: filename,
          type: "archive",
          mimeType: "application/zip",
          source: href || "DOM",
          content: "",
          metadata: { reason: e.message },
          purpose: "codebase_implementation",
          relationship: "implementation_dependency",
          relevance: "important",
          preserveOriginal: true,
          originalData: href || null,
          extractionStatus: href ? "durable_reference" : "metadata_only",
          status: "preserved_original",
          formatted: `\n[ATTACHMENT: ${filename}]\nSTATUS: preserved_original\nREFERENCE: ${href || "DOM element"}\n`
        };
      }
    }

    // 4. Document / Presentation / Spreadsheet / Code File Resolution
    const candidateText = el.getAttribute("data-content") || el.getAttribute("data-text") || el.querySelector("pre, code")?.innerText || "";

    // Fix Rule 1 & Rule 21: If candidateText is empty and el.innerText equals the filename chip, do NOT use el.innerText as fake content!
    const rawDomText = (el.innerText || "").trim();
    let inlineContent = candidateText.trim();
    if (!inlineContent && rawDomText && rawDomText !== filename && rawDomText.length > filename.length + 10) {
      inlineContent = rawDomText;
    }

    if (/ppt|presentation/i.test(cleanType)) {
      assetType = "presentation";
      purpose = "presentation_reference";
      relationship = "presentation_reference";
    } else if (/xls|csv|sheet|table/i.test(cleanType)) {
      assetType = "spreadsheet";
      purpose = "data_source";
      relationship = "source_document";
    } else if (/pdf|doc|docx|txt|md|resume/i.test(cleanType)) {
      assetType = "document";
      purpose = /resume|cv/i.test(filename) ? "resume_source" : "source_document";
      relationship = "source_document";
    } else if (/js|ts|py|java|cpp|c|h|cs|go|rs|json|sql|html|css|php|kt/i.test(cleanType)) {
      assetType = "code";
      purpose = "implementation";
      relationship = "implementation_dependency";
    }

    if (inlineContent && inlineContent.length > 5 && inlineContent !== filename) {
      return {
        id: assetId,
        name: filename,
        type: assetType,
        mimeType: `text/${cleanType || "plain"}`,
        source: href || "DOM",
        content: inlineContent,
        metadata: { length: inlineContent.length },
        purpose,
        relationship,
        relevance,
        preserveOriginal: true,
        originalData: href || inlineContent,
        extractionStatus: "extracted",
        status: "accessible",
        formatted: `\n[ATTACHMENT: ${filename} (${assetType})]\nSTATUS: accessible\nCONTENT:\n${inlineContent}\n`
      };
    }

    // 5. Preservation of Original Asset Reference when Text Extraction is Inaccessible/Empty
    // Rule 4: If text extraction fails but original file/link exists, preserve the original asset!
    const fallbackStatus = href ? "durable_reference" : "session_only";
    return {
      id: assetId,
      name: filename,
      type: assetType,
      mimeType: `application/${cleanType || "octet-stream"}`,
      source: href || "DOM",
      content: "",
      metadata: { note: "Original asset reference preserved; text not extracted directly from DOM chip" },
      purpose,
      relationship,
      relevance,
      preserveOriginal: true,
      originalData: href || el.getAttribute("src") || null,
      extractionStatus: fallbackStatus,
      status: "preserved_original",
      formatted: `\n[ATTACHMENT: ${filename} (${assetType})]\nSTATUS: preserved_original\nREFERENCE: ${href || "DOM Element Preserved"}\n`
    };
  }

  // Helper: Extract Attached Files, Images, and Work Assets from Turn DOM (Async)
  async function extractAttachmentsFromTurn(container) {
    if (!container) return { text: "", attachments: [], workAssets: [] };
    const selectors = [
      'img[src]', '[data-testid*="image"]', '[class*="image"]', 'picture img',
      '[data-testid*="attachment"]', '[class*="attachment"]', '[class*="file-chip"]',
      '[class*="attached-file"]', '[aria-label*="attachment" i]', '[class*="file-preview"]',
      '[data-testid*="file-"]', '[class*="file-container"]', '[class*="document-card"]',
      '[class*="pasted"]', 'button[aria-label*="Pasted"]',
      'a[download]', 'a[href*=".zip"]', 'a[href*=".pdf"]', 'a[href*=".docx"]', 'a[href*=".java"]', 'a[href*=".py"]', 'a[href*=".json"]', 'a[href*=".xlsx"]', 'a[href*=".pptx"]'
    ];
    const resolvedAttachments = [];
    const resolvedWorkAssets = [];
    const seenNames = new Set();
    let formattedText = "";

    const elements = Array.from(container.querySelectorAll(selectors.join(",")));
    for (const el of elements) {
      try {
        // Skip tiny icon images or Sweater's own UI icons
        if (el.tagName === "IMG") {
          const src = el.getAttribute("src") || "";
          if (!src || src.includes("data:image/svg+xml") || (el.clientWidth > 0 && el.clientWidth < 20 && el.clientHeight < 20)) {
            continue;
          }
        }

        const href = el.getAttribute("href") || el.getAttribute("src") || el.querySelector("a[href]")?.getAttribute("href") || "";
        const name = (el.getAttribute("alt") || el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("download") || "").trim().split('\n')[0];
        const key = `${name}_${href}`;
        if (name && name.length > 1 && !seenNames.has(key)) {
          seenNames.add(key);
          const asset = await resolveAttachmentData(el, name, "", href);
          resolvedAttachments.push(asset);
          resolvedWorkAssets.push(asset);
          formattedText += asset.formatted;
        }
      } catch (e) { }
    }

    return { text: formattedText, attachments: resolvedAttachments, workAssets: resolvedWorkAssets };
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

    async extractMessages() {
      throw new Error("extractMessages() must be implemented by subclass");
    }

    async injectPrompt(text, capsule) {
      const el = this.detectInput();
      if (!el) return false;

      el.focus();
      await sleep(150);

      const promptText = text || (capsule && capsule.continuePrompt) || "";
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

    async extractMessages() {
      const msgs = [];
      const nodes = Array.from(document.querySelectorAll("[data-message-author-role]"));
      for (const el of nodes) {
        const role = el.getAttribute("data-message-author-role");
        let content = (el.querySelector(".markdown") || el.querySelector(".whitespace-pre-wrap") || el)?.innerText?.trim() || "";
        const attach = await extractAttachmentsFromTurn(el);
        if (attach.text) content += attach.text;
        if (content) msgs.push({ role: role === "assistant" ? "assistant" : "user", content, attachments: attach.attachments });
      }
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

    async extractMessages() {
      const primary = Array.from(document.querySelectorAll('[data-testid="user-message"], .font-claude-message'));
      if (primary.length) {
        const msgs = [];
        for (const el of primary) {
          let content = el.innerText.trim();
          const attach = await extractAttachmentsFromTurn(el.closest('[class*="turn"]') || el.parentElement);
          if (attach.text && (!attach.attachments[0]?.name || !content.includes(attach.attachments[0].name))) content += attach.text;
          if (content) {
            msgs.push({
              role: el.matches('[data-testid="user-message"]') ? "user" : "assistant",
              content,
              attachments: attach.attachments
            });
          }
        }
        if (msgs.length) return msgs;
      }

      const legacy = Array.from(document.querySelectorAll('[data-testid="human-turn"],[data-testid="ai-turn"],.human-turn,.ai-turn'));
      if (legacy.length) {
        const msgs = [];
        for (const t of legacy) {
          let content = t.innerText.trim();
          const attach = await extractAttachmentsFromTurn(t);
          if (attach.text) content += attach.text;
          if (content) {
            msgs.push({
              role: (t.getAttribute("data-testid") === "human-turn" || t.classList.contains("human-turn")) ? "user" : "assistant",
              content,
              attachments: attach.attachments
            });
          }
        }
        if (msgs.length) return msgs;
      }

      const turnContainers = Array.from(document.querySelectorAll('[data-test-render-count]'));
      if (turnContainers.length) {
        const msgs = [];
        for (const t of turnContainers) {
          let content = t.innerText.trim();
          if (!content) continue;
          const attach = await extractAttachmentsFromTurn(t);
          if (attach.text) content += attach.text;
          const isUser = !!t.querySelector('[data-testid="user-message"], [class*="human"], [class*="user"]');
          msgs.push({ role: isUser ? "user" : "assistant", content, attachments: attach.attachments });
        }
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

    getInputSelectors() {
      return [
        'rich-textarea [contenteditable="true"]',
        '.input-area [contenteditable="true"]',
        'div.textarea[contenteditable="true"]',
        ".ql-editor",
        '[contenteditable="true"]'
      ];
    }

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

    async extractMessages() {
      const el = document.querySelector("chat-history,.conversation-container");
      if (el) {
        const msgs = [];
        const turnNodes = Array.from(el.querySelectorAll(".query-content,.response-content"));
        for (const e of turnNodes) {
          let content = e.innerText.trim();
          const attach = await extractAttachmentsFromTurn(e);
          if (attach.text) content += attach.text;
          msgs.push({
            role: e.classList.contains("query-content") ? "user" : "assistant",
            content,
            attachments: attach.attachments
          });
        }
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

    async extractMessages() {
      const msgs = [];
      const nodes = Array.from(document.querySelectorAll(".message-bubble,[class*='message'],[class*='response']"));
      for (const el of nodes) {
        let text = el.innerText.trim();
        const attach = await extractAttachmentsFromTurn(el);
        if (attach.text) text += attach.text;
        if (text.length > 10) {
          const isUser = el.classList.contains("user") || el.getAttribute("data-role") === "user" || el.closest("[class*='user']");
          msgs.push({ role: isUser ? "user" : "assistant", content: text, attachments: attach.attachments });
        }
      }
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

    async extractMessages() {
      const msgs = [];
      const nodes = Array.from(document.querySelectorAll('[class*="Message_container"]'));
      for (const el of nodes) {
        const isUser = el.querySelector('[class*="Message_user"]');
        let text = el.innerText.trim();
        const attach = await extractAttachmentsFromTurn(el);
        if (attach.text) text += attach.text;
        if (text) {
          msgs.push({ role: isUser ? "user" : "assistant", content: text, attachments: attach.attachments });
        }
      }
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

    async extractMessages() {
      const msgs = [];
      const nodes = Array.from(document.querySelectorAll("[class*='message-and-actions'],[class*='msg-content']"));
      for (const el of nodes) {
        let content = el.innerText.trim();
        const attach = await extractAttachmentsFromTurn(el);
        if (attach.text) content += attach.text;
        if (content) {
          const isUser = el.closest("[class*='user']") || el.closest("[class*='human']");
          msgs.push({ role: isUser ? "user" : "assistant", content, attachments: attach.attachments });
        }
      }
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

    async extractMessages() {
      const msgs = [];
      const seen = new Set();
      const nodes = Array.from(document.querySelectorAll('[class*="message"],[class*="turn"],[class*="response"],[class*="query"]'));
      for (const el of nodes) {
        let text = el.innerText.trim();
        const attach = await extractAttachmentsFromTurn(el);
        if (attach.text) text += attach.text;
        if (text.length > 20 && !seen.has(text)) {
          seen.add(text);
          const cls = el.className.toLowerCase();
          const isUser = cls.includes("user") || cls.includes("human") || cls.includes("query");
          msgs.push({ role: isUser ? "user" : "assistant", content: text, attachments: attach.attachments });
        }
      }
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

    async extractMessages() {
      const msgs = [];
      const seen = new Set();
      const nodes = Array.from(document.querySelectorAll('[class*="message"],[class*="turn"],[class*="response"],[class*="query"]'));
      for (const el of nodes) {
        let text = el.innerText.trim();
        const attach = await extractAttachmentsFromTurn(el);
        if (attach.text) text += attach.text;
        if (text.length > 10 && !seen.has(text)) {
          seen.add(text);
          const cls = (el.className || "").toLowerCase();
          const isUser = cls.includes("user") || cls.includes("human") || cls.includes("query");
          msgs.push({ role: isUser ? "user" : "assistant", content: text, attachments: attach.attachments });
        }
      }
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
