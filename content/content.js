// Sweater v14 — Content Orchestrator
(function () {
  "use strict";

  // ── TRUSTED TYPES COMPATIBILITY ──────────────────────────────────────────
  // Some sites (notably chatgpt.com) enforce a CSP with
  // `require-trusted-types-for 'script'`, which makes the browser reject any
  // plain-string assignment to .innerHTML (and similar sinks) — this is what
  // silently breaks Sweater's UI there while it keeps working elsewhere.
  // Registering a pass-through policy named "default" restores normal
  // behavior for all existing string-based innerHTML usage without needing
  // to touch each call site. This is inert (and harmless) on every other
  // site that doesn't enforce Trusted Types.
  try {
    if (window.trustedTypes && window.trustedTypes.createPolicy && !window.trustedTypes.defaultPolicy) {
      window.trustedTypes.createPolicy("default", {
        createHTML: (s) => s,
        createScript: (s) => s,
        createScriptURL: (s) => s,
      });
    }
  } catch (e) {
    // A "default" policy may already exist (created by the page itself, in
    // which case our HTML already flows through it automatically) or the
    // site's `trusted-types` directive may not allow the name "default" —
    // either way, this must never block the rest of Sweater from loading.
  }

  let fab = null;
  let panel = null;
  let stickyBtn = null;
  let panelOpen = false;
  let lastTrigger = "sticky";
  let currentTags = [];
  let settings = {};
  let activeAITool = null;

  // ── ISOLATED SHADOW DOM ROOT ─────────────────────────────────────────────
  // All Sweater UI (FAB, sticky button, panel, modals, toasts) lives inside
  // this Shadow DOM so that: (1) other extensions' page-level CSS/JS can't
  // hide, restyle, or otherwise interfere with our UI, and (2) our styles
  // never leak out and affect the host page or other extensions' UI.
  let swHost = null;
  let swRoot = null;
  let swRootReadyPromise = null;

  function getRoot() { return swRoot; }

  async function ensureShadowRoot() {
    if (swRootReadyPromise) return swRootReadyPromise;
    swRootReadyPromise = (async () => {
      swHost = document.createElement("sweater-shadow-host");
      swHost.id = "sweater-shadow-host";
      swHost.style.cssText = "all:initial; position:fixed; top:0; left:0; z-index:2147483647;";
      (document.documentElement || document.body).appendChild(swHost);

      swRoot = swHost.attachShadow({ mode: "open" });

      const styleEl = document.createElement("style");
      try {
        const cssUrl = chrome.runtime.getURL("content/inject.css");
        const res = await fetch(cssUrl);
        styleEl.textContent = await res.text();
      } catch (e) {
        // Fallback: reference the stylesheet directly if fetch is unavailable
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = chrome.runtime.getURL("content/inject.css");
        swRoot.appendChild(link);
      }
      swRoot.appendChild(styleEl);
      return swRoot;
    })();
    return swRootReadyPromise;
  }

  const LLM_TARGETS = {
    chatgpt: "https://chatgpt.com/",
    claude: "https://claude.ai/new",
    groq: "https://chat.groq.com/",
    gemini: "https://gemini.google.com/app",
    perplexity: "https://www.perplexity.ai/",
  };

  const INPUT_SELECTORS = [
    "#prompt-textarea",
    '.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"]',
    ".ql-editor", "textarea",
    '[contenteditable="true"]',
  ];

  function findInput() {
    for (const s of INPUT_SELECTORS) {
      const el = document.querySelector(s);
      if (el && visible(el)) return el;
    }
    return null;
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // ── INIT ──────────────────────────────────────────────────────────────────
  async function init() {
    settings = await SettingsService.loadSettings();
    await ensureShadowRoot();
    createFAB();
    createStickyBtn();
    checkPendingInjection();
  }

  // ── FAB & STICKY BUTTONS ──────────────────────────────────────────────────
  function createFAB() {
    if (fab) return;
    fab = document.createElement("div");
    fab.id = "sweater-fab";
    fab.dataset.hidden = "1";
    fab.innerHTML = `
      <svg class="sw-fab-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="sw-fab-label">Sweater</span>`;
    fab.title = "Sweater — Knit & Wear AI context (Alt+C)";
    fab.addEventListener("click", e => { e.stopPropagation(); lastTrigger = "fab"; togglePanel(); });
    getRoot().appendChild(fab);
    positionFAB();
    window.addEventListener("scroll", positionFAB, { passive: true });
    window.addEventListener("resize", positionFAB, { passive: true });
  }

  function positionFAB() {
    if (!fab) return;
    if (fab.dataset.hidden === "1") { fab.style.display = "none"; return; }
    const adapter = SiteAdapterFactory.getAdapter();
    const inp = adapter ? adapter.detectInput() : null;
    const isMobile = window.innerWidth < 768;
    if (!inp || isMobile) { fab.style.display = "none"; return; }
    fab.style.display = "flex";
    const r = inp.getBoundingClientRect();
    fab.style.cssText += `position:fixed;right:${window.innerWidth - r.right + 12}px;bottom:${window.innerHeight - r.bottom + 12}px;z-index:2147483640;`;
  }

  function createStickyBtn() {
    if (stickyBtn) return;
    stickyBtn = document.createElement("div");
    stickyBtn.id = "sweater-sticky";
    stickyBtn.innerHTML = `
      <svg class="sw-sticky-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="sw-sticky-label"></span>`;
    stickyBtn.title = "Sweater — Knit & Wear AI context";
    stickyBtn.addEventListener("click", e => { e.stopPropagation(); lastTrigger = "sticky"; togglePanel(); });
    getRoot().appendChild(stickyBtn);
  }

  // ── SIDE PANEL ────────────────────────────────────────────────────────────
  function togglePanel() { panelOpen ? closePanel() : openPanel(); }

  async function openPanel() {
    closePanel();
    panelOpen = true;
    if (fab) fab.classList.add("sw-active");
    if (stickyBtn) stickyBtn.classList.add("sw-active");

    panel = document.createElement("div");
    panel.id = "sweater-panel";
    panel.innerHTML = `
      <div class="sw-header">
        <div class="sw-brand">
          <span class="sw-brand-icon">🧶</span>
          <span class="sw-brand-name">Sweater</span>
          <span class="sw-brand-ver">v14</span>
        </div>
        <button class="sw-close" id="sw-close">&times;</button>
      </div>
      <div class="sw-tabs">
        <button class="sw-tab sw-tab-active" data-tab="knit">Knit</button>
        <button class="sw-tab" data-tab="wardrobe">Wardrobe</button>
        <button class="sw-tab" data-tab="wear">Wear</button>
        <button class="sw-tab" data-tab="settings">Settings</button>
      </div>
      <div class="sw-body" id="sw-body"></div>`;

    getRoot().appendChild(panel);
    positionPanel();

    panel.querySelector("#sw-close").onclick = closePanel;
    panel.querySelectorAll(".sw-tab").forEach(t => {
      t.onclick = () => switchTab(t.dataset.tab);
    });

    setTimeout(() => document.addEventListener("click", outsideClick), 120);
    await renderTab("knit");
  }

  function closePanel() {
    if (panel && panel.parentNode) { panel.parentNode.removeChild(panel); panel = null; }
    if (fab) fab.classList.remove("sw-active");
    if (stickyBtn) stickyBtn.classList.remove("sw-active");
    panelOpen = false;
    document.removeEventListener("click", outsideClick);
  }

  function outsideClick(e) {
    const path = typeof e.composedPath === "function" ? e.composedPath() : [e.target];
    const clickedFab = !!(fab && path.includes(fab));
    const clickedSticky = !!(stickyBtn && path.includes(stickyBtn));
    const clickedPanel = !!(panel && path.includes(panel));
    const clickedModal = path.some(el => el.classList && el.classList.contains && el.classList.contains("sw-compress-modal"));
    if (panel && !clickedPanel && !clickedFab && !clickedSticky && !clickedModal) closePanel();
  }

  function positionPanel() {
    if (!panel) return;
    const isMobile = window.innerWidth < 768;
    if (lastTrigger === "sticky" || isMobile) {
      const sr = stickyBtn ? stickyBtn.getBoundingClientRect() : null;
      const panelH = Math.min(560, window.innerHeight - 32);
      const rightOffset = sr ? (window.innerWidth - sr.left + 6) : 16;
      const top = sr ? Math.min(Math.max(sr.top + sr.height / 2 - panelH / 2, 12), window.innerHeight - panelH - 12) : 12;

      panel.style.cssText += `position:fixed; right:${rightOffset}px; top:${top}px; max-height:${panelH}px; z-index:2147483645;`;
      panel.classList.add("sw-panel-side");
    } else {
      const fr = fab.getBoundingClientRect();
      panel.style.cssText += `position:fixed; bottom:${window.innerHeight - fr.top + 8}px; right:${window.innerWidth - fr.right - 10}px; z-index:2147483645;`;
      panel.classList.add("sw-panel-bottom");
    }
  }

  function switchTab(name) {
    if (!panel) return;
    panel.querySelectorAll(".sw-tab").forEach(t => t.classList.toggle("sw-tab-active", t.dataset.tab === name));
    renderTab(name);
  }

  // ── KNIT TAB ──────────────────────────────────────────────────────────────
  async function renderTab(tab) {
    const body = panel.querySelector("#sw-body");
    if (!body) return;

    if (tab === "settings") { await renderSettingsTab(body); return; }
    if (tab === "wardrobe") { await renderWardrobeTab(body); return; }
    if (tab === "wear") { await renderWearTab(body); return; }

    const adapter = SiteAdapterFactory.getAdapter();
    const activeSlot = settings.providers.find(p => p.id === settings.activeProviderId);
    const hasKey = activeSlot && !!activeSlot.apiKey;

    body.innerHTML = `
      <div class="sw-section" id="sw-knit-zone">
        <p class="sw-desc">Weaves the full thread into a sweater context file you can wear anywhere.</p>
        <button class="sw-btn-primary" id="sw-knit-btn">🧶 Knit Conversation</button>
      </div>
      
      <div class="sw-result sw-hidden" id="sw-result">
        <div class="sw-result-meta" id="sw-result-meta"></div>

        <!-- Quality score checklist -->
        <div class="sw-result-meta" id="sw-quality-score-card" style="margin-top: 5px; background: rgba(108,99,255,0.06); border: 1px solid rgba(108,99,255,0.22); color: var(--sw-text); font-family: var(--sw-mono); font-size: 10px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span>Context Quality Score:</span>
            <strong id="sw-quality-badge" style="color:var(--sw-accent-lt)">100%</strong>
          </div>
          <div id="sw-quality-missing" style="font-size: 9px; color: var(--sw-text3); margin-top: 3px;"></div>
        </div>

        <div style="font-size:10.5px; color:var(--sw-text2); margin-top:6px; display:flex; align-items:center; gap:6px;">
          <span>Detected Domain:</span>
          <strong id="sw-detected-category" style="color:var(--sw-green)">Detecting...</strong>
        </div>

        <input class="sw-input" id="sw-title-input" placeholder="Name your sweater..." style="margin-top:6px" />
        <input class="sw-input" id="sw-tag-input" placeholder="Add tag → Enter" style="margin-top:6px" />
        <div id="sw-tags-display" class="sw-tags-row"></div>

        <!-- Smart Save preferences -->
        <label class="sw-toggle-row" style="margin-top:4px;">
          <input type="checkbox" id="sw-smart-save-toggle" checked />
          <span>Enable Smart Save Checkpoint (extract state)</span>
        </label>

        <!-- Compression CTA -->
        <div id="sw-compress-cta" class="sw-compress-cta sw-hidden" style="margin-top:6px">
          <span class="sw-compress-cta-icon" id="sw-compress-icon">⟁</span>
          <div class="sw-compress-cta-body">
            <div class="sw-compress-cta-title" id="sw-compress-title">Compress for fewer tokens</div>
            <div class="sw-compress-cta-sub" id="sw-compress-sub">Large conversation detected — tap to shrink</div>
          </div>
          <span class="sw-compress-cta-badge" id="sw-compress-badge">COMPRESS</span>
        </div>

        <!-- AI Tools -->
        <div class="sw-ai-tools" style="margin-top:8px">
          <div class="sw-ai-tools-label">AI Tools <span class="sw-ai-lock" id="sw-ai-lock-hint"></span></div>
          <div class="sw-ai-tools-grid">
            <button class="sw-ai-btn" id="sw-btn-ai-summarize">Summary</button>
            <button class="sw-ai-btn" id="sw-btn-ai-insights">Insights</button>
            <button class="sw-ai-btn" id="sw-btn-ai-translate">Translate</button>
            <button class="sw-ai-btn" id="sw-btn-ai-chat">Ask AI</button>
          </div>
          <div id="sw-ai-output" class="sw-ai-output sw-hidden"></div>
          <div id="sw-translate-opts" class="sw-translate-opts sw-hidden">
            <select id="sw-translate-lang" class="sw-input-sm">
              <option value="Spanish">Spanish</option><option value="French">French</option>
              <option value="German">German</option><option value="Hindi">Hindi</option>
              <option value="Japanese">Japanese</option><option value="Chinese (Simplified)">Chinese</option>
            </select>
            <button class="sw-btn-sm" id="sw-btn-do-translate">Go</button>
          </div>
          <div id="sw-chat-box" class="sw-ai-chat sw-hidden">
            <input class="sw-input-sm" id="sw-chat-input" placeholder="Ask about this conversation..." />
            <button class="sw-btn-sm" id="sw-btn-do-chat">Ask</button>
            <div id="sw-chat-result" class="sw-chat-result"></div>
          </div>
        </div>

        <div class="sw-row" style="margin-top:8px">
          <button class="sw-btn-secondary" id="sw-btn-copy">Copy Prompt</button>
          <button class="sw-btn-primary" id="sw-btn-save">Save Sweater</button>
        </div>

        <div class="sw-llm-shortcuts-row" id="sw-llm-shortcuts-row" style="margin-top:8px">
          <span class="sw-llm-shortcuts-label">Save &amp; open in</span>
          <div class="sw-llm-shortcuts-btns">
            <button class="sw-llm-btn" data-llm="chatgpt">GPT</button>
            <button class="sw-llm-btn" data-llm="claude">Claude</button>
            <button class="sw-llm-btn" data-llm="groq">Groq</button>
            <button class="sw-llm-btn" data-llm="gemini">Gemini</button>
            <button class="sw-llm-btn" data-llm="perplexity">Perplx</button>
          </div>
        </div>

        <button class="sw-btn-ghost" id="sw-btn-reset" style="margin-top:8px">← Start over</button>
      </div>`;

    body.querySelector("#sw-knit-btn").onclick = () => doKnit();
  }

  // --- Compression option selections ---
  function showCompressModal(body, capsule) {
    const modal = document.createElement("div");
    modal.className = "sw-compress-modal";
    modal.innerHTML = `
      <div class="sw-cmodal-box">
        <div class="sw-cmodal-title">&#x27C1; Compress Conversation</div>
        <div class="sw-cmodal-sub">Choose a compaction mode to save context tokens</div>
        <div class="sw-cmodal-opts">
          <button class="sw-cmodal-opt" id="sw-copt-md">
            <div class="sw-cmodal-opt-title">Clean Chat (~25% smaller)</div>
            <div class="sw-cmodal-opt-desc">Removes pleasantries, greetings, AI padding. Retains raw conversation logs.</div>
          </button>
          <button class="sw-cmodal-opt" id="sw-copt-txt">
            <div class="sw-cmodal-opt-title">Transcript (~65% smaller)</div>
            <div class="sw-cmodal-opt-desc">Converts chat into structured chronological notes.</div>
          </button>
          <button class="sw-cmodal-opt" id="sw-copt-inline">
            <div class="sw-cmodal-opt-title">Smart Memory (~85% smaller)</div>
            <div class="sw-cmodal-opt-desc">AI runs intent state check-pointing (goals, stack, tasks) directly.</div>
          </button>
        </div>
        <button class="sw-cmodal-cancel" id="sw-copt-cancel">Cancel</button>
      </div>`;

    if (panel) panel.appendChild(modal);
    else getRoot().appendChild(modal);

    modal.addEventListener("click", e => e.stopPropagation());

    modal.querySelector("#sw-copt-cancel").onclick = () => modal.remove();
    modal.querySelector("#sw-copt-md").onclick = () => { modal.remove(); applyInlineCompress(body, capsule, "clean"); };
    modal.querySelector("#sw-copt-txt").onclick = () => { modal.remove(); applyInlineCompress(body, capsule, "transcript"); };
    modal.querySelector("#sw-copt-inline").onclick = () => { modal.remove(); doInlineCompress(body, capsule); };
  }

  function syncCompressedToCapsule(body, capsule, compressed, format) {
    window._swCompressApplied = true;
    window._swIsCodeKnit = false;
    window._swCompressFormat = format;
    window._swCompressedText = compressed;

    capsule.compressed = true;
    capsule.compressFormat = format;
    capsule.continuePrompt = compressed;
    capsule.contextLength = compressed.length;
    window._swCapsule = capsule;

    const meta = body?.querySelector("#sw-result-meta");
    if (meta) meta.innerHTML = `✓ <strong>${capsule.messageCount}</strong> messages · ${fmt(capsule.contextLength)}`;

    chrome.runtime.sendMessage({ action: "SAVE_CAPSULE", capsule }, () => {
      showToast("Compressed output saved to Wardrobe", "success");
    });
  }

  function applyInlineCompress(body, capsule, format) {
    const raw = capsule.continuePrompt;
    const compressed = (format === "clean") ? buildCleanChat(raw) : buildTranscript(raw, capsule.messages);

    syncCompressedToCapsule(body, capsule, compressed, format);

    if (body && body.isConnected) {
      updateCompressCTA(body);
    }
    showToast(format === "clean" ? "Compressed — Clean Chat applied" : "Compressed — Transcript applied", "success");
  }

  function doInlineCompress(body, capsule) {
    const cta = body.querySelector("#sw-compress-cta");
    const title = body.querySelector("#sw-compress-title");
    const sub = body.querySelector("#sw-compress-sub");

    const activeSlot = settings.providers.find(p => p.id === settings.activeProviderId);
    const hasTryModels = TryModelsRegistry.getConfiguredSlots(settings).length > 0;
    const canUseAi = (activeSlot && activeSlot.apiKey && activeSlot.provider !== "gemini") || hasTryModels;
    if (canUseAi) {
      title.textContent = "Building Smart Memory...";
      sub.textContent = "AI extracting goals, stack and pending tasks";
      cta.style.pointerEvents = "none";

      const raw = capsule.continuePrompt;
      chrome.runtime.sendMessage({
        action: "AI_COMPRESS",
        prompt: raw,
        category: window._swCategory || "General"
      }, res => {
        if (chrome.runtime.lastError) {
          console.warn("Sweater AI_COMPRESS error:", chrome.runtime.lastError.message);
        }
        cta.style.pointerEvents = "auto";
        let compressed;
        if (res?.result && res.result.length > 50) {
          compressed = res.result;
        } else {
          compressed = buildSmartMemoryLocal(capsule.messages || [], capsule.continuePrompt);
        }
        syncCompressedToCapsule(body, capsule, compressed, "smart");

        // Quality score refresh
        const quality = res?.quality || StateEngine.evaluateQuality(window._swCompressedText);
        if (quality) {
          const qBadge = body.querySelector("#sw-quality-badge");
          if (qBadge) qBadge.textContent = `${quality.score}%`;
          const qMissing = body.querySelector("#sw-quality-missing");
          if (qMissing) {
            qMissing.textContent = quality.missing.length > 0
              ? `Missing: ${quality.missing.join(", ")}`
              : "Context Complete! ✓";
          }
        }

        if (body.isConnected) {
          updateCompressCTA(body);
        }
        showToast("Smart Memory applied — ready for Wardrobe, Wear & Shortcuts", "success");
      });
    } else {
      const compressed = buildSmartMemoryLocal(capsule.messages || [], capsule.continuePrompt);
      syncCompressedToCapsule(body, capsule, compressed, "smart");

      const quality = StateEngine.evaluateQuality(window._swCompressedText);
      if (quality) {
        const qBadge = body.querySelector("#sw-quality-badge");
        if (qBadge) qBadge.textContent = `${quality.score}%`;
        const qMissing = body.querySelector("#sw-quality-missing");
        if (qMissing) {
          qMissing.textContent = quality.missing.length > 0
            ? `Missing: ${quality.missing.join(", ")}`
            : "Context Complete! ✓";
        }
      }

      updateCompressCTA(body);
      showToast("Smart Memory applied — ready for Wardrobe, Wear & Shortcuts", "success");
    }
  }

  function updateCompressCTA(body) {
    const cta = body.querySelector("#sw-compress-cta");
    const icon = body.querySelector("#sw-compress-icon");
    const title = body.querySelector("#sw-compress-title");
    const sub = body.querySelector("#sw-compress-sub");
    const badge = body.querySelector("#sw-compress-badge");

    if (window._swCompressApplied) {
      cta.classList.add("compressed");
      icon.textContent = "✓";
      const fmtLabel = window._swCompressFormat === "clean" ? "Clean Chat"
        : window._swCompressFormat === "transcript" ? "Transcript"
          : "Smart Memory";
      title.textContent = `Compressed — ${fmtLabel}`;
      sub.textContent = "Ready for Wardrobe, Wear & Shortcuts";
      badge.textContent = "DONE";
    } else {
      cta.classList.remove("compressed");
      icon.textContent = "⟁";
      title.textContent = "Compress for fewer tokens";
      sub.textContent = "Large conversation detected — tap to shrink";
      badge.textContent = "COMPRESS";
    }
  }

  // --- Capture Execution ---
  async function doKnit() {
    const body = panel.querySelector("#sw-body");
    const btn = body.querySelector("#sw-knit-btn");
    btn.innerHTML = `<span class="sw-spinner"></span> Knitting...`;
    btn.disabled = true;

    const adapter = SiteAdapterFactory.getAdapter();
    if (!adapter) { showError(body, "Not a supported conversation platform"); return; }

    try {
      const messages = adapter.extractMessages();
      const validMessages = messages.filter(m => m.content && m.content.trim().length > 0);

      if (validMessages.length === 0) {
        showError(body, "No conversation transcripts discovered on this page.");
        return;
      }

      // Build basic capsule prompt
      const capsule = buildCapsule(validMessages, adapter.name);

      window._swCapsule = capsule;
      window._swTags = [];
      window._swCompressApplied = false;
      window._swCompressedText = null;
      window._swCompressFormat = null;

      // Update panel results layout
      body.querySelector("#sw-knit-zone").classList.add("sw-hidden");
      body.querySelector("#sw-result").classList.remove("sw-hidden");
      body.querySelector("#sw-result-meta").innerHTML = `✓ <strong>${capsule.messageCount}</strong> messages · ${fmt(capsule.contextLength)}`;

      const titleInput = body.querySelector("#sw-title-input");
      titleInput.value = capsule.title;

      // Domain intelligence classification triggers
      chrome.runtime.sendMessage({
        action: "AI_CLASSIFY",
        prompt: capsule.continuePrompt
      }, (res) => {
        window._swCategory = res?.result || "General";
        const detCat = body.querySelector("#sw-detected-category");
        if (detCat) detCat.textContent = window._swCategory;

        // Context Quality Score evaluator
        const quality = StateEngine.evaluateQuality(capsule.continuePrompt);
        const qBadge = body.querySelector("#sw-quality-badge");
        if (qBadge) qBadge.textContent = `${quality.score}%`;
        const qMissing = body.querySelector("#sw-quality-missing");
        if (qMissing) {
          qMissing.textContent = quality.missing.length > 0
            ? `Missing: ${quality.missing.join(", ")}`
            : "Context Complete! ✓";
        }
      });

      // Show compression option if prompt is long
      const cta = body.querySelector("#sw-compress-cta");
      if (capsule.contextLength > 3000) {
        cta.classList.remove("sw-hidden");
        updateCompressCTA(body);
        cta.onclick = () => showCompressModal(body, capsule);
      } else {
        cta.classList.add("sw-hidden");
      }

      setupTags(body);
      setupAITools(body, capsule);

      // Save / Copy bindings
      body.querySelector("#sw-btn-copy").onclick = async () => {
        const text = (window._swCompressApplied && window._swCompressedText) ? window._swCompressedText : capsule.continuePrompt;
        await navigator.clipboard.writeText(text);
        showToast("Copied to clipboard!", "success");
      };

      body.querySelector("#sw-btn-save").onclick = () => saveCapsule(body, capsule);

      // LLM shortcuts mapping
      body.querySelectorAll("#sw-llm-shortcuts-row button").forEach(shBtn => {
        shBtn.onclick = async () => {
          await saveCapsule(body, capsule);
          const prompt = (window._swCompressApplied && window._swCompressedText) ? window._swCompressedText : capsule.continuePrompt;
          await navigator.clipboard.writeText(prompt);

          chrome.storage.local.set({
            pending_injection: {
              llm: shBtn.dataset.llm,
              prompt: prompt,
              capsule: capsule,
              timestamp: Date.now()
            }
          }, () => {
            window.open(LLM_TARGETS[shBtn.dataset.llm], "_blank");
            closePanel();
          });
        };
      });

      body.querySelector("#sw-btn-reset").onclick = () => renderTab("knit");

    } catch (e) {
      showError(body, "Knit operation failed: " + e.message);
    }
  }

  async function saveCapsule(body, capsule) {
    if (!capsule || !window._swCapsule) return;

    capsule.title = body.querySelector("#sw-title-input").value || capsule.title;
    capsule.tags = [...(window._swTags || [])];

    // Smart Save
    const smartSaveEnabled = body.querySelector("#sw-smart-save-toggle")?.checked;
    if (smartSaveEnabled && !window._swCompressApplied) {
      body.querySelector("#sw-btn-save").innerHTML = `<span class="sw-spinner"></span> Smart Saving...`;

      const activeSlot = settings.providers.find(p => p.id === settings.activeProviderId);
      if (activeSlot && activeSlot.apiKey) {
        const response = await new Promise(resolve => {
          chrome.runtime.sendMessage({
            action: "AI_SMART_SAVE",
            prompt: capsule.continuePrompt
          }, resolve);
        });

        if (response && response.result) {
          const stateObj = StateEngine.parseYamlState(response.result);
          capsule.continuePrompt = StateEngine.compileStatePrompt(stateObj, capsule.source, window._swCategory || "General");
          capsule.state = response.result;
          capsule.contextLength = capsule.continuePrompt.length;
        }
      } else {
        const local = buildSmartSaveLocal(capsule.messages);
        capsule.continuePrompt = StateEngine.compileStatePrompt(local, capsule.source, window._swCategory || "General");
        capsule.state = `goal: ${local.goal}\nnext_task: ${local.next_task}`;
        capsule.contextLength = capsule.continuePrompt.length;
      }
    }

    if (window._swCompressApplied) {
      capsule.compressed = true;
      capsule.compressFormat = window._swCompressFormat || (window._swIsCodeKnit ? "clean" : "smart");
      if (window._swCompressedText) {
        capsule.continuePrompt = window._swCompressedText;
        capsule.contextLength = window._swCompressedText.length;
      }
    } else {
      capsule.compressed = false;
      capsule.compressFormat = null;
    }

    chrome.runtime.sendMessage({ action: "SAVE_CAPSULE", capsule }, () => {
      showToast("Sweater saved successfully!", "success");
      closePanel();
    });
  }

  // Local state heuristics
  function buildSmartSaveLocal(messages) {
    const text = messages.map(m => m.content).join("\n");
    const stack = [];
    const matchedTech = text.match(/\b(React|Vue|Next\.js|Node|Python|Postgres|Tailwind|Supabase|OpenAI|DeepSeek|Llama)\b/gi) || [];
    matchedTech.forEach(t => { if (!stack.includes(t)) stack.push(t); });

    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    let goal = "Active Project Tasks";
    let nextTask = "Continue coding features";

    for (const line of lines) {
      if (/\b(goal|build|create|implement|fixing)\b/i.test(line)) goal = line.slice(0, 100);
      if (/\b(next step|next task|todo|to-do)\b/i.test(line)) nextTask = line.slice(0, 100);
    }

    return {
      goal, stack, facts: ["Extracted locally"], completed: ["Recent progress"], pending: ["Pending next items"], context: "Local backup checkpoint", next_task: nextTask
    };
  }

  // ── COMPRESSION ALGORITHMS (ported from reference) ──────────────────────

  // Preserve code blocks intact, compress surrounding prose
  function compressMarkdown(text, stripFiller = false) {
    const tokens = [];
    const regex = /(```[\s\S]*?```|`[^`\n]+`)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        tokens.push({ type: "text", content: text.slice(lastIndex, match.index) });
      }
      tokens.push({ type: "code", content: match[0] });
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
      tokens.push({ type: "text", content: text.slice(lastIndex) });
    }

    return tokens.map(token =>
      token.type === "code" ? token.content : compressTextSegment(token.content, stripFiller)
    ).join("");
  }

  function compressTextSegment(text, stripFiller) {
    const leadingWS = text.match(/^\s*/)[0];
    const trailingWS = text.match(/\s*$/)[0];
    const trimmed = text.trim();
    if (trimmed === "") return "";

    let res = trimmed
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map(line => line.replace(/[ \t]+/g, " ").trim())
      .filter((line, i, arr) => {
        if (line !== "") return true;
        return i > 0 && arr[i - 1] !== "" && arr.slice(i + 1).some(l => l !== "");
      })
      .join("\n");

    if (stripFiller) {
      res = res.replace(/\b(please|kindly|certainly|of course|sure|absolutely|great|wonderful|indeed|definitely)\b/gi, "")
        .replace(/[ \t]+/g, " ");
    }

    const normLead = leadingWS.includes("\n") ? "\n" : (leadingWS.length ? " " : "");
    const normTrail = trailingWS.includes("\n") ? "\n" : (trailingWS.length ? " " : "");
    return normLead + res + normTrail;
  }

  // 📄 Clean Chat: full dialogue, filler stripped, no whitespace waste (20–40%)
  function buildCleanChat(text) {
    const stripped = text
      .replace(/^(Hey|Hi|Hello)[,!]?\s+/gim, "")
      .replace(/^(Absolutely[!,]?|Sure[!,]?|Of course[!,]?|Great[!,]?|Certainly[!,]?|Perfect[!,]?)\s+/gim, "")
      .replace(/I'?d be (happy|glad|delighted) to (help|assist)[^.]*\.\s*/gi, "")
      .replace(/(Let me know if (you|there's|I can)[^.]*\.|Feel free to ask[^.]*\.|Is there anything else[^?]*\?)\s*/gi, "")
      .replace(/\b(Thank you[^.]*\.|Thanks[^.!]*[.!])\s*/gi, "")
      .replace(/^(That'?s correct[.!]|Exactly[.!]|You'?re right[.!]|Noted[.!])\s*/gim, "");

    return compressMarkdown(stripped, false)
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+$/gm, "")
      .trim();
  }

  // 📝 Transcript: structured chronological notes, no truncation (60–85%)
  function buildTranscript(text, messages) {
    const sourceLines = messages && messages.length > 0
      ? messages.map(m => `${m.role === "user" ? "User" : "AI"}: ${m.content}`).join("\n")
      : text;

    const lines = sourceLines.split("\n").map(l => l.trim()).filter(Boolean);
    const discussion = [], decisions = [], pending = [], topics = new Set();

    lines.forEach(line => {
      if (/^(Sure[,!]?|Absolutely[,!]?|Of course[,!]?|Great[,!]?|Yes[,!]?|Thank you[.!])$/i.test(line)) return;

      const topicMatch = line.match(/\b(about|regarding|on the topic of|discussing)\s+([a-z][\w\s]{3,30})/i);
      if (topicMatch) topics.add(topicMatch[2].trim().toLowerCase());

      if (/\b(decided|will use|we('ll| will) use|selected|chosen|going with|use .+ for|confirmed|agreed)\b/i.test(line)) {
        const clean = line.replace(/^(User:|AI:|Human:|Assistant:)\s*/i, "").trim();
        if (clean.length > 8) decisions.push(clean);
      } else if (/\b(need to|TODO|still need|not yet|haven'?t|pending|open question|next step|remaining|to do)\b/i.test(line) || /\?$/.test(line.trim())) {
        const clean = line.replace(/^(User:|AI:|Human:|Assistant:)\s*/i, "").trim();
        if (clean.length > 8 && !clean.startsWith("#")) pending.push(clean);
      } else if (/^(User:|Human:|AI:|Assistant:)/i.test(line)) {
        let clean = line.replace(/^(User:|AI:|Human:|Assistant:)\s*/i, "").trim();
        if (clean.length > 10) discussion.push(clean);
      }
    });

    const dedup = arr => [...new Set(arr)];
    let out = "";
    if (topics.size) out += `## Topics\n${[...topics].map(t => `- ${t}`).join("\n")}\n\n`;
    if (discussion.length) out += `## Discussion\n${dedup(discussion).map(l => `- ${l}`).join("\n")}\n\n`;
    if (decisions.length) out += `## Decisions\n${dedup(decisions).map(l => `- ${l}`).join("\n")}\n\n`;
    if (pending.length) out += `## Pending\n${dedup(pending).map(l => `- ${l}`).join("\n")}\n\n`;
    return out.trim() || buildCleanChat(text);
  }

  // 🧠 Smart Memory AI prompt template
  function buildSmartMemoryPrompt(raw) {
    return `You are a Smart Memory extractor. Given the AI conversation below, produce a compact YAML-style project memory. Use ONLY these sections (omit empty ones):

version: "1.0"
goal: (what the user is building/solving — 1-2 sentences)
stack:
  - (tech/tools/services)
facts:
  - (any confirmed facts, preferences, constraints, user context)
completed:
  - (done items, implemented features, resolved issues)
pending:
  - (open tasks, unresolved questions, next steps)
decisions:
  - (key choices made)
context: (any other must-know info — 1-2 sentences max)
key_code: |
  (only truly critical code snippets — omit if none)

Rules:
- Output ONLY the YAML structure, no preamble or explanation
- Include ALL facts and decisions — do not truncate
- Maximum compression while preserving every data point
- Use plain English values, not jargon

Conversation:
${raw.slice(0, 12000)}`;
  }

  // 🧠 Smart Memory local fallback — no API needed
  function buildSmartMemoryLocal(messages, fallbackText) {
    const text = fallbackText || "";
    const lines = Array.isArray(messages) && messages.length > 0
      ? messages.map(m => `${m.role === "user" ? "User" : "AI"}: ${m.content}`).join("\n").split("\n").map(l => l.trim()).filter(Boolean)
      : text.split("\n").map(l => l.trim()).filter(Boolean);

    const goals = [], stack = [], completed = [], pending = [], constraints = [], facts = [], decisions = [];

    lines.forEach(line => {
      const clean = line.replace(/^(User:|Human:|AI:|Assistant:)\s*/i, "").trim();
      if (!clean || clean.length < 8) return;

      if (/\b(build|create|make|develop|want to|goal|objective|trying to|working on)\b/i.test(clean) && !/^(AI:|Assistant:)/i.test(line)) {
        goals.push(clean.slice(0, 120));
      }

      const techMatches = clean.match(/\b(React Native?|React|Vue|Angular|Node\.?js|Python|Django|Rails|Next\.?js|Tailwind|Postgres|MySQL|MongoDB|Firebase|Supabase|Vercel|AWS|Docker|Prisma|GraphQL|Razorpay|Stripe|OpenAI|Anthropic|TypeScript|JavaScript|Swift|Kotlin|Flutter|FastAPI|Express|Redis)\b/gi) || [];
      techMatches.forEach(m => { if (!stack.includes(m)) stack.push(m); });

      if (/\b(decided|will use|we'll use|selected|chosen|going with|confirmed|agreed)\b/i.test(clean)) {
        decisions.push(clean.slice(0, 120));
      }

      if (/\b(done|completed|finished|implemented|added|built|deployed|fixed|resolved|working now)\b/i.test(clean)) {
        completed.push(clean.slice(0, 120));
      }

      if (/\b(need to|TODO|still need|not yet|pending|haven't|next step|remaining|want to add)\b/i.test(clean)) {
        pending.push(clean.slice(0, 120));
      }

      if (/\b(deploy on|must use|only|constraint|limit|budget|deadline|requirement|cannot|won't|always|never)\b/i.test(clean)) {
        constraints.push(clean.slice(0, 120));
      }

      if (/\b(I am|I'm|I use|I prefer|I have|my|we are|we're|our|the user|the project|it's|it is|there are|there is)\b/i.test(clean) && clean.length > 15) {
        facts.push(clean.slice(0, 120));
      }
    });

    const dedup = arr => [...new Set(arr)];
    const ver = `version:"1.0"`;
    let out = `${ver}\n`;
    if (goals.length) out += `goal:\n${dedup(goals.slice(0, 3)).map(l => `  - ${l}`).join("\n")}\n`;
    if (stack.length) out += `stack:\n${dedup(stack).map(l => `  - ${l}`).join("\n")}\n`;
    if (facts.length) out += `facts:\n${dedup(facts.slice(0, 8)).map(l => `  - ${l}`).join("\n")}\n`;
    if (decisions.length) out += `decisions:\n${dedup(decisions).map(l => `  - ${l}`).join("\n")}\n`;
    if (completed.length) out += `completed:\n${dedup(completed).map(l => `  - ${l}`).join("\n")}\n`;
    if (pending.length) out += `pending:\n${dedup(pending).map(l => `  - ${l}`).join("\n")}\n`;
    if (constraints.length) out += `constraints:\n${dedup(constraints.slice(0, 6)).map(l => `  - ${l}`).join("\n")}\n`;
    return out.trim() || `version:"1.0"\ngoal:\n  - Conversation context preserved locally\ncontext: Smart Memory fallback — configure an API key for AI extraction\n`;
  }

  // --- AI Tools inside Side Panel ---
  function setupAITools(body, capsule) {
    const aiOut = body.querySelector("#sw-ai-output");
    const transOpts = body.querySelector("#sw-translate-opts");
    const chatBox = body.querySelector("#sw-chat-box");

    body.querySelector("#sw-btn-ai-summarize").onclick = () => {
      aiOut.classList.remove("sw-hidden");
      aiOut.textContent = "Summarizing...";
      aiOut.classList.add("loading");
      chrome.runtime.sendMessage({ action: "AI_SUMMARIZE", prompt: capsule.continuePrompt }, (res) => {
        aiOut.classList.remove("loading");
        handleAIResponse(res, aiOut);
      });
    };

    body.querySelector("#sw-btn-ai-insights").onclick = () => {
      aiOut.classList.remove("sw-hidden");
      aiOut.textContent = "Extracting Insights...";
      aiOut.classList.add("loading");
      chrome.runtime.sendMessage({ action: "AI_INSIGHTS", prompt: capsule.continuePrompt }, (res) => {
        aiOut.classList.remove("loading");
        handleAIResponse(res, aiOut);
      });
    };

    body.querySelector("#sw-btn-ai-translate").onclick = () => {
      transOpts.classList.remove("sw-hidden");
    };

    body.querySelector("#sw-btn-do-translate").onclick = () => {
      const lang = body.querySelector("#sw-translate-lang").value;
      aiOut.classList.remove("sw-hidden");
      aiOut.textContent = `Translating to ${lang}...`;
      aiOut.classList.add("loading");
      chrome.runtime.sendMessage({
        action: "AI_TRANSLATE",
        prompt: `Translate the conversation transcript to ${lang}:\n\n${capsule.continuePrompt}`
      }, (res) => {
        aiOut.classList.remove("loading");
        handleAIResponse(res, aiOut);
      });
    };

    body.querySelector("#sw-btn-ai-chat").onclick = () => {
      chatBox.classList.remove("sw-hidden");
    };

    body.querySelector("#sw-btn-do-chat").onclick = () => {
      const q = body.querySelector("#sw-chat-input").value.trim();
      if (!q) return;

      const chatRes = body.querySelector("#sw-chat-result");
      chatRes.textContent = "Thinking...";

      chrome.runtime.sendMessage({
        action: "AI_CHAT",
        prompt: q,
        system: `You are answering questions about this chat context:\n\n${capsule.continuePrompt}`
      }, (res) => {
        if (res && res.result) {
          chatRes.textContent = res.result;
        } else {
          chatRes.textContent = res?.error || "Error executing chat.";
        }
      });
    };
  }

  function handleAIResponse(res, outEl) {
    if (res && res.result) {
      outEl.textContent = res.result;
    } else {
      outEl.textContent = `Error: ${res?.error || "API failure"}`;
    }
  }

  function setupTags(body) {
    const inp = body.querySelector("#sw-tag-input");
    const row = body.querySelector("#sw-tags-display");
    if (!inp) return;

    inp.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        const v = e.target.value.trim();
        if (v && !(window._swTags || []).includes(v)) {
          (window._swTags = window._swTags || []).push(v);
          row.innerHTML = window._swTags.map((t, idx) => `<span class="sw-tag">${escapeHtml(t)}<button data-idx="${idx}">&times;</button></span>`).join("");
          row.querySelectorAll("button").forEach(btn => {
            btn.onclick = () => {
              window._swTags.splice(parseInt(btn.dataset.idx, 10), 1);
              row.innerHTML = window._swTags.map((t, idx) => `<span class="sw-tag">${escapeHtml(t)}<button data-idx="${idx}">&times;</button></span>`).join("");
            };
          });
        }
        e.target.value = "";
      }
    });
  }

  // ── WARDROBE TAB ──────────────────────────────────────────────────────────
  async function renderWardrobeTab(body) {
    body.innerHTML = `<div class="sw-loading"><span class="sw-spinner"></span></div>`;
    const res = await new Promise(r => chrome.runtime.sendMessage({ action: "GET_CAPSULES" }, r));
    const caps = res?.capsules || [];

    const q = body.querySelector("#sw-vault-search")?.value?.toLowerCase() || "";
    const filtered = q ? caps.filter(c =>
      c.title.toLowerCase().includes(q) ||
      (c.source || "").toLowerCase().includes(q) ||
      (c.tags || []).some(t => t.toLowerCase().includes(q))
    ) : caps;

    if (caps.length === 0) {
      body.innerHTML = `<div class="sw-empty">
        <span class="sw-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        </span>
        No sweaters yet.<br>Knit a conversation first.
      </div>`;
      return;
    }

    body.innerHTML = `
      <div class="sw-vault-toolbar">
        <input class="sw-search-field" id="sw-vault-search" placeholder="Search sweaters..." value="${escapeHtml(q)}" />
        <div class="sw-vault-actions">
          <button class="sw-icon-btn" id="sw-btn-export" title="Export all">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </button>
          <label class="sw-icon-btn" title="Import">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <input type="file" id="sw-import-file" accept=".json" style="display:none" />
          </label>
        </div>
      </div>
      <div class="sw-capsule-list" id="sw-capsule-list">
        ${filtered.length ? filtered.map(c => wardrobeCard(c)).join("") : `
          <div class="sw-empty">No matching sweaters.</div>
        `}
      </div>
    `;

    const searchInp = body.querySelector("#sw-vault-search");
    searchInp.addEventListener("input", e => renderWardrobeTab(body));
    if (q) {
      searchInp.focus();
      searchInp.selectionStart = searchInp.selectionEnd = searchInp.value.length;
    }

    body.querySelector("#sw-btn-export").onclick = exportAll;
    body.querySelector("#sw-import-file").onchange = (e) => importFile(e, body);

    attachWardrobeEvents(body, caps);
  }

  function wardrobeCard(c) {
    const PLATFORM_COLORS = { ChatGPT: "chatgpt", Claude: "claude", Gemini: "gemini", Groq: "groq", Perplexity: "perplexity" };
    const badge = PLATFORM_COLORS[c.source] || "default";
    const date = new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const tags = (c.tags || []).map(t => `<span class="sw-tag">${escapeHtml(t)}</span>`).join("");
    const compressedBadge = c.compressed ? `<span class="capsule-flag" title="Compressed">COMP</span>` : "";
    const aiBadge = c.summary ? `<span class="capsule-flag" title="${escapeHtml(c.summary)}">AI</span>` : "";
    return `
      <div class="sw-card" data-id="${c.id}">
        <div class="sw-card-header">
          <div class="sw-card-title" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</div>
          <div class="sw-card-actions">
            <button class="sw-card-btn sw-edit-btn" data-id="${c.id}" title="Edit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <button class="sw-card-btn sw-copy-card" data-id="${c.id}" title="Copy prompt">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="sw-card-btn sw-del" data-id="${c.id}" title="Delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
        <div class="sw-card-meta">
          <span class="sw-badge sw-badge-${badge}">${c.source || "AI"}</span>
          <span class="sw-card-count">${c.messageCount} msgs</span>
          <span class="sw-card-date">${date}</span>
          ${aiBadge}
          ${compressedBadge}
        </div>
        ${tags ? `<div class="sw-card-tags">${tags}</div>` : ""}
        <div class="sw-card-llm-row">
          <button class="sw-card-llm-btn" data-id="${c.id}" data-llm="chatgpt"    title="Open in ChatGPT">GPT</button>
          <button class="sw-card-llm-btn" data-id="${c.id}" data-llm="claude"     title="Open in Claude">Claude</button>
          <button class="sw-card-llm-btn" data-id="${c.id}" data-llm="groq"       title="Open in Groq">Groq</button>
          <button class="sw-card-llm-btn" data-id="${c.id}" data-llm="gemini"     title="Open in Gemini">Gemini</button>
          <button class="sw-card-llm-btn" data-id="${c.id}" data-llm="perplexity" title="Open in Perplexity">Perplx</button>
        </div>
        ${(c.versions && c.versions.length > 1)
        ? `<div class="sw-card-versions" style="margin-top: 6px; font-size: 10px; border-top: 1px dashed var(--sw-border); padding-top: 4px; display: flex; gap: 4px; flex-wrap: wrap; align-items: center;">
              <span style="color:#8892aa;">v History:</span>
              ${c.versions.map(v => `<a href="#" class="sw-restore-version-btn" data-id="${c.id}" data-version="${v.version}" style="color:#9b94ff; text-decoration:none; margin-right:4px; font-weight:500;">v${v.version}</a>`).join("")}
             </div>`
        : ""
      }
      </div>`;
  }

  function safeRemoveTip(card) {
    try {
      const tip = card.querySelector(".sw-preview-tip");
      if (tip && tip.parentNode === card) card.removeChild(tip);
    } catch { }
    try {
      const root = getRoot();
      if (root) {
        root.querySelectorAll(".sw-preview-tip").forEach(t => {
          try { if (t.parentNode) t.parentNode.removeChild(t); } catch { }
        });
      }
    } catch { }
  }

  function attachWardrobeEvents(body, caps) {
    body.querySelectorAll(".sw-card").forEach(card => {
      let tipTimer;
      card.addEventListener("mouseenter", () => {
        if (tipTimer) clearTimeout(tipTimer);
        tipTimer = setTimeout(() => {
          safeRemoveTip(card);
          const cap = caps.find(c => c.id === card.dataset.id);
          if (!cap || !card.isConnected) return;
          const preview = cap.messages.slice(0, 3).map(m => `
            <div class="sw-preview-msg">
              <span class="sw-preview-role ${m.role === "user" ? "user" : "ai"}">${m.role === "user" ? "YOU" : "AI"}</span>
              <span class="sw-preview-text">${escapeHtml(m.content.slice(0, 120))}</span>
            </div>`).join("");
          const tip = document.createElement("div");
          tip.className = "sw-preview-tip";
          tip.innerHTML = `<div class="sw-preview-tip-title">Preview</div>${preview}`;
          card.style.position = "relative";
          card.appendChild(tip);
        }, 450);
      });
      card.addEventListener("mouseleave", () => {
        if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
        safeRemoveTip(card);
      });
      card.addEventListener("click", () => safeRemoveTip(card));
    });

    body.querySelectorAll(".sw-edit-btn").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const cap = caps.find(c => c.id === btn.dataset.id);
        if (cap) openEditor(cap, body);
      });
    });

    body.querySelectorAll(".sw-copy-card").forEach(btn => {
      const origHTML = btn.innerHTML;
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const cap = caps.find(c => c.id === btn.dataset.id);
        if (cap) {
          await navigator.clipboard.writeText(cap.continuePrompt);
          btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
          setTimeout(() => { btn.innerHTML = origHTML; }, 1500);
        }
      });
    });

    body.querySelectorAll(".sw-del").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ action: "DELETE_CAPSULE", id: btn.dataset.id }, async () => {
          await renderWardrobeTab(body);
        });
      });
    });

    body.querySelectorAll(".sw-card-llm-btn").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const cap = caps.find(c => c.id === btn.dataset.id);
        if (cap) {
          const prompt = cap.continuePrompt;
          const llm = btn.dataset.llm;
          const url = LLM_TARGETS[llm];
          if (url && prompt) {
            await navigator.clipboard.writeText(prompt);
            chrome.storage.local.set({
              pending_injection: {
                llm,
                prompt,
                capsule: cap,
                timestamp: Date.now()
              }
            }, () => {
              window.open(url, "_blank");
              closePanel();
            });
          }
        }
      });
    });

    body.querySelectorAll(".sw-restore-version-btn").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        e.preventDefault();
        const id = btn.dataset.id;
        const version = parseInt(btn.dataset.version, 10);
        chrome.runtime.sendMessage({ action: "RESTORE_CAPSULE_VERSION", id, version }, async (res) => {
          if (res?.success) {
            showToast(`Restored version v${version}`, "success");
            await renderWardrobeTab(body);
          }
        });
      });
    });
  }

  // ── EDITOR OVERLAY ─────────────────────────────────────────────────────────
  function openEditor(cap, body) {
    if (!panel) return;
    const overlay = document.createElement("div");
    overlay.className = "sw-editor-overlay";
    overlay.innerHTML = `
      <div class="sw-editor-header">
        <button id="sw-editor-back">←</button>
        <span class="sw-editor-title">Edit Sweater</span>
        <button id="sw-editor-save-btn" style="color:#7c6bff;font-weight:700;font-size:12px;">Save</button>
      </div>
      <div class="sw-editor-body" id="sw-editor-body">
        ${cap.messages.map((m, i) => `
          <div class="sw-editor-msg">
            <div class="sw-editor-msg-label ${m.role === "user" ? "user" : "ai"}">${m.role === "user" ? "YOU" : "AI"}</div>
            <textarea class="sw-editor-msg-text" data-idx="${i}">${escapeHtml(m.content)}</textarea>
          </div>`).join("")}
      </div>
      <div class="sw-editor-footer">
        <button class="sw-btn-secondary" id="sw-editor-back2">Cancel</button>
        <button class="sw-btn-primary" id="sw-editor-save-btn2">✓ Save Changes</button>
      </div>`;

    panel.appendChild(overlay);

    const closeEditor = () => { overlay.remove(); };
    overlay.querySelector("#sw-editor-back").addEventListener("click", closeEditor);
    overlay.querySelector("#sw-editor-back2").addEventListener("click", closeEditor);

    const doSave = () => {
      const textareas = overlay.querySelectorAll(".sw-editor-msg-text");
      textareas.forEach((ta, i) => { cap.messages[i].content = ta.value; });
      const contextLines = cap.messages.map(m => {
        const label = m.role === "user" ? "USER" : "AI";
        return `[${label}]: ${m.content}`;
      }).join("\n\n");
      cap.continuePrompt = `# 🧶 Sweater — Imported Context\n\nThis conversation was transferred from **${cap.source}**.\n\n---\n\n${contextLines}\n\n---\n\n## ▶ Continue from here:\n\nYou now have the full context above. Please continue this conversation/project from where it left off.`;
      cap.contextLength = cap.continuePrompt.length;
      chrome.runtime.sendMessage({ action: "SAVE_CAPSULE", capsule: cap }, () => {
        showToast("Sweater updated!", "success");
        closeEditor();
        renderWardrobeTab(body);
      });
    };
    overlay.querySelector("#sw-editor-save-btn").addEventListener("click", doSave);
    overlay.querySelector("#sw-editor-save-btn2").addEventListener("click", doSave);
  }

  // ── EXPORT / IMPORT ────────────────────────────────────────────────────────
  async function exportAll() {
    const res = await new Promise(r => chrome.runtime.sendMessage({ action: "GET_CAPSULES" }, r));
    const caps = res?.capsules || [];
    if (caps.length === 0) { showToast("No sweaters to export", "warn"); return; }
    const blob = new Blob([JSON.stringify({ sweater_export: true, version: "3.0", date: new Date().toISOString(), capsules: caps }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `sweater-export-${Date.now()}.json`;
    a.click(); URL.revokeObjectURL(url);
    showToast(`Exported ${caps.length} sweaters`, "success");
  }

  function importFile(e, body) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        const incoming = data.capsules || (Array.isArray(data) ? data : []);
        if (!incoming.length) { showToast("No sweaters found in file", "warn"); return; }
        chrome.runtime.sendMessage({ action: "IMPORT_CAPSULES", capsules: incoming }, res => {
          showToast(`Imported ${res?.count || incoming.length} sweaters!`, "success");
          if (body) renderWardrobeTab(body);
        });
      } catch { showToast("Invalid file format", "error"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  // ── WEAR TAB ──────────────────────────────────────────────────────────────
  async function renderWearTab(body) {
    body.innerHTML = `<div class="sw-loading"><span class="sw-spinner"></span></div>`;
    const res = await new Promise(r => chrome.runtime.sendMessage({ action: "GET_CAPSULES" }, r));
    const caps = res?.capsules || [];

    if (caps.length === 0) {
      body.innerHTML = `<div class="sw-empty">
        <span class="sw-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
        </span>
        No sweaters saved.<br>Knit one first.
      </div>`;
      return;
    }

    const platform = detectPlatform();
    const platformBadge = platform
      ? `<div class="sw-badge sw-badge-default" style="display:inline-block;margin-bottom:6px;font-family:var(--sw-mono);font-size:10px;">${platform.name} · ready</div>`
      : `<div class="sw-badge sw-badge-default" style="display:inline-block;margin-bottom:6px;font-family:var(--sw-mono);font-size:10px;background:rgba(229,83,75,0.08);color:#e5534b;">Not supported page</div>`;

    const PLATFORM_COLORS = { ChatGPT: "chatgpt", Claude: "claude", Gemini: "gemini", Groq: "groq", Perplexity: "perplexity" };
    body.innerHTML = `
      <div class="sw-inject-header" style="margin-bottom:4px;">
        ${platformBadge}
      </div>
      <p class="sw-desc" style="margin-bottom:6px;">Select a sweater to wear here. Wear &amp; Send injects and auto-submits.</p>
      <div class="sw-capsule-list">
        ${caps.map(c => {
      const badge = PLATFORM_COLORS[c.source] || "default";
      const date = new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const compressedBadge = c.compressed ? `<span class="capsule-flag" title="Compressed">COMP</span>` : "";
      const aiBadge = c.summary ? `<span class="capsule-flag" title="${escapeHtml(c.summary)}">AI</span>` : "";
      return `
          <div class="sw-card" data-id="${c.id}">
            <div class="sw-card-header">
              <div class="sw-card-title">${escapeHtml(c.title)}</div>
              <div class="sw-card-actions">
                <button class="sw-wear-send sw-card-btn" data-id="${c.id}" title="Wear &amp; Send">
                  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 4 20 12 6 20 6 4"/></svg>
                </button>
              </div>
            </div>
            <div class="sw-card-meta">
              <span class="sw-badge sw-badge-${badge}">${c.source || "AI"}</span>
              <span class="sw-card-count">${c.messageCount} msgs</span>
              <span class="sw-card-date">${date}</span>
              ${aiBadge}
              ${compressedBadge}
            </div>
          </div>`;
    }).join("")}
      </div>`;

    body.querySelectorAll(".sw-card").forEach(card => {
      let tipTimer;
      card.addEventListener("mouseenter", () => {
        if (tipTimer) clearTimeout(tipTimer);
        tipTimer = setTimeout(() => {
          safeRemoveTip(card);
          const cap = caps.find(c => c.id === card.dataset.id);
          if (!cap || !card.isConnected) return;
          const preview = cap.messages.slice(0, 3).map(m => `
            <div class="sw-preview-msg">
              <span class="sw-preview-role ${m.role === "user" ? "user" : "ai"}">${m.role === "user" ? "YOU" : "AI"}</span>
              <span class="sw-preview-text">${escapeHtml(m.content.slice(0, 120))}</span>
            </div>`).join("");
          const tip = document.createElement("div");
          tip.className = "sw-preview-tip";
          tip.innerHTML = `<div class="sw-preview-tip-title">Preview</div>${preview}`;
          card.style.position = "relative";
          card.appendChild(tip);
        }, 450);
      });
      card.addEventListener("mouseleave", () => {
        if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
        safeRemoveTip(card);
      });
      card.addEventListener("click", () => safeRemoveTip(card));
    });

    body.querySelectorAll(".sw-card").forEach(card => {
      card.addEventListener("click", async e => {
        if (e.target.closest(".sw-wear-send")) return;
        const cap = caps.find(c => c.id === card.dataset.id);
        if (!cap) return;
        await doWear(cap, false, card);
      });
    });

    body.querySelectorAll(".sw-wear-send").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const cap = caps.find(c => c.id === btn.dataset.id);
        const card = btn.closest(".sw-card");
        if (cap) await doWear(cap, true, card);
      });
    });
  }

  async function doWear(cap, andSend, cardEl) {
    if (cardEl) {
      cardEl.classList.add("sw-card-injecting");
      const title = cardEl.querySelector(".sw-card-title");
      const orig = title?.textContent;
      if (title) title.textContent = andSend ? "Wearing & Sending..." : "Wearing...";
    }

    if (cap.compressed) {
      // Inject compressed text into the chat — do not auto-download.
      const ok = await injectText(cap.continuePrompt || "");
      if (ok) {
        if (andSend) {
          await sleep(150);
          const sent = tryClickSend();
          showToast(sent ? `Worn & sent — ${formatLabel(cap.compressFormat)}` : `${formatLabel(cap.compressFormat)} filled — hit Enter to send`, "success");
        } else {
          showToast(`✓ Worn — ${formatLabel(cap.compressFormat)} autofilled`, "success");
        }
        closePanel();
        return;
      }
      try { await navigator.clipboard.writeText(cap.continuePrompt || ""); } catch { }
      showToast("Auto-wear failed — compressed chat copied, paste with Ctrl+V", "warn");
      closePanel();
      return;
    }

    const ok = await injectText(cap.continuePrompt);

    if (ok) {
      if (andSend) {
        await sleep(120);
        const sent = tryClickSend();
        showToast(sent ? `Worn & sent — ${cap.messageCount} msgs` : `Worn — ${cap.messageCount} msgs, hit Enter`, "success");
      } else {
        showToast(`✓ Worn — ${cap.messageCount} messages loaded`, "success");
      }
      closePanel();
    } else {
      await navigator.clipboard.writeText(cap.continuePrompt);
      showToast("Auto-wear failed — copied, paste manually (Ctrl+V)", "warn");
      closePanel();
    }
  }

  // ── SEND BUTTON AUTO-CLICK ─────────────────────────────────────────────────
  function tryClickSend() {
    const sendSelectors = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send prompt"]',
      '[data-testid="fruitjuice-send-button"]',
      'button.send-btn',
      'button[type="submit"]',
    ];
    for (const sel of sendSelectors) {
      try {
        const btn = document.querySelector(sel);
        if (btn && !btn.disabled && visible(btn)) { btn.click(); return true; }
      } catch { }
    }
    const inp = findInput();
    if (inp) {
      inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
      return true;
    }
    return false;
  }

  // ── INJECTION ENGINE ───────────────────────────────────────────────────────
  async function injectText(text) {
    const host = location.hostname;
    try {
      if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) return await injectChatGPT(text);
      if (host.includes("claude.ai")) return await injectClaude(text);
      if (host.includes("gemini.google.com")) return await injectGemini(text);
      if (host.includes("grok.com") || host.includes("x.com")) return await injectReactTextarea("textarea", text);
      if (host.includes("perplexity.ai") || host.includes("poe.com")) return await injectContentEditable('[contenteditable="true"]', text);
      if (host.includes("copilot.microsoft.com")) return await injectContentEditable('[contenteditable="true"]', text);
      if (host.includes("chat.groq.com") || host.includes("groq.com")) return await injectGroq(text);
      return await injectUniversal(text);
    } catch (e) {
      console.error("Sweater injection failed", e);
      return false;
    }
  }

  // ── FILE ATTACHMENT ENGINE (compressed sweaters only) ──────────────────────
  function formatLabel(fmt) {
    return fmt === "clean" ? "Clean Chat" : fmt === "transcript" ? "Transcript" : "Smart Memory";
  }

  function safeFilename(title, fmt) {
    const base = (title || "sweater-knit").replace(/[^a-z0-9\-_]/gi, "-").toLowerCase();
    const suffix = fmt === "clean" ? "clean" : fmt === "transcript" ? "transcript" : "smart-memory";
    return `${base}-${suffix}.txt`;
  }

  function buildAttachmentFile(cap) {
    const fmt = cap.compressFormat || "smart";
    const date = new Date(cap.createdAt || Date.now()).toLocaleString();
    const header = `SWEATER — ${formatLabel(fmt)}\nSource: ${cap.source || "AI"} · Knitted: ${date} · Messages: ${cap.messageCount || "?"}\n\n`;
    const content = header + (cap.continuePrompt || "") + `\n\n[End of context — paste/attach into any AI to continue]\n`;
    return new File([content], safeFilename(cap.title, fmt), { type: "text/plain" });
  }

  async function tryAttachFile(file) {
    return await raceTimeout(async () => {
      const dt = new DataTransfer();
      dt.items.add(file);
      const fileInput = document.querySelector('input[type="file"]');
      if (fileInput) {
        try {
          fileInput.files = dt.files;
          fileInput.dispatchEvent(new Event("change", { bubbles: true }));
          await sleep(350);
          if (await fileAttachConfirmed()) return true;
        } catch { }
      }
      const dropTarget = findInput()?.closest("form, [class*='composer'], [class*='input']") || findInput();
      if (dropTarget) {
        try {
          for (const type of ["dragenter", "dragover", "drop"]) {
            dropTarget.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
          }
          await sleep(350);
          if (await fileAttachConfirmed()) return true;
        } catch { }
      }
      return false;
    }, 1000);
  }

  async function tryPasteAsFile(file) {
    return await raceTimeout(async () => {
      const inp = findInput();
      if (!inp) return false;
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        inp.focus();
        await sleep(60);
        const pasteEvent = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
        inp.dispatchEvent(pasteEvent);
        await sleep(350);
        return await fileAttachConfirmed();
      } catch { return false; }
    }, 1000);
  }

  async function fileAttachConfirmed() {
    const selectors = [
      '[data-testid*="attachment"]', '[class*="attachment-chip"]', '[class*="file-chip"]',
      '[class*="attached-file"]', '[aria-label*="attachment" i]', '[class*="file-preview"]',
    ];
    for (const sel of selectors) {
      try { if (document.querySelector(sel)) return true; } catch { }
    }
    return false;
  }

  async function clipboardFileFallback(file, rawText) {
    try { await navigator.clipboard.writeText(rawText); } catch { }
    // No automatic download — user must use Export/Download explicitly.
    showToast("Couldn't attach automatically. Compressed chat copied — press Ctrl+V in the chat.", "warn");
  }

  function raceTimeout(fn, ms) {
    return new Promise(resolve => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; resolve(false); } }, ms);
      fn().then(v => { if (!done) { done = true; clearTimeout(timer); resolve(v); } })
        .catch(() => { if (!done) { done = true; clearTimeout(timer); resolve(false); } });
    });
  }

  async function wearAsFile(cap) {
    const file = buildAttachmentFile(cap);
    if (await tryAttachFile(file)) return "attached";
    if (await tryPasteAsFile(file)) return "pasted";
    await clipboardFileFallback(file, cap.continuePrompt || "");
    return "fallback";
  }

  async function injectGroq(text) {
    const selectors = ['textarea[placeholder]', 'textarea', '[contenteditable="true"]'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && visible(el)) {
        const ok = el.tagName === "TEXTAREA"
          ? await injectReactTextarea(el, text)
          : await injectContentEditable(el, text);
        if (ok) return true;
      }
    }
    return await injectUniversal(text);
  }

  async function injectChatGPT(text) {
    const selectors = ['#prompt-textarea', 'textarea[data-id]', 'textarea', '[contenteditable="true"]'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el || !visible(el)) continue;
      const ok = el.matches('textarea')
        ? await injectReactTextarea(sel, text)
        : await injectContentEditable(sel, text);
      if (ok) return true;
    }
    return false;
  }

  async function injectClaude(text) { return await injectProseMirror(text); }

  async function injectGemini(text) {
    const el =
      document.querySelector('rich-textarea [contenteditable="true"]') ||
      document.querySelector('.input-area [contenteditable="true"]') ||
      document.querySelector('div.textarea[contenteditable="true"]') ||
      document.querySelector('.ql-editor') ||
      document.querySelector('[contenteditable="true"]');
    if (!el) return false;
    try {
      el.focus(); await sleep(150);
      document.execCommand('selectAll', false, null); await sleep(50);
      const success = document.execCommand('insertText', false, text);
      if (!success || !el.innerText?.trim()) {
        el.textContent = text;
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(el); range.collapse(false);
        sel.removeAllRanges(); sel.addRange(range);
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      await sleep(200);
      return el.innerText?.trim().length > 0;
    } catch (e) { console.error('Gemini injection failed', e); return false; }
  }

  async function injectReactTextarea(sel, text) {
    const el = typeof sel === "string" ? document.querySelector(sel) : sel;
    if (!el) return false;
    try {
      el.focus(); await sleep(120);
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
    } catch (e) { console.error("React injection failed", e); return false; }
  }

  async function injectProseMirror(text) {
    const selectors = ['.ProseMirror[contenteditable="true"]', '[contenteditable="true"]', 'div.ProseMirror'];
    let el = null;
    for (const selector of selectors) {
      const candidate = document.querySelector(selector);
      if (candidate && visible(candidate)) { el = candidate; break; }
    }
    if (!el) return false;
    try {
      el.focus(); await sleep(120);
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el); range.collapse(false);
      selection.removeAllRanges(); selection.addRange(range);
      const success = document.execCommand("insertText", false, text);
      if (!success) { el.textContent = text; }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      await sleep(150);
      return el.innerText.trim().length > 0;
    } catch (e) { console.error("ProseMirror injection failed", e); return false; }
  }

  async function injectContentEditable(sel, text) {
    const el = typeof sel === "string" ? document.querySelector(sel) : sel;
    if (!el) return false;
    try {
      el.focus(); await sleep(80);
      document.execCommand("selectAll", false, null); await sleep(20);
      if (!document.execCommand("insertText", false, text)) {
        el.innerText = text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
      return true;
    } catch { return false; }
  }

  async function injectUniversal(text) {
    for (const ta of Array.from(document.querySelectorAll("textarea")).filter(visible)) {
      try {
        ta.focus(); await sleep(60);
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        setter.call(ta, text);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        ta.dispatchEvent(new Event("change", { bubbles: true }));
        if (ta.value.length > 0) return true;
      } catch { }
    }
    for (const ce of Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(visible)) {
      try {
        ce.focus(); await sleep(60);
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, text);
        if (ce.innerText.trim().length > 10) return true;
      } catch { }
    }
    return false;
  }

  // ── SETTINGS TAB ──────────────────────────────────────────────────────────
  async function renderSettingsTab(body) {
    const providers = settings.providers || [];
    const curProvider = settings.activeProviderId || "prov_gemini";
    const keyUrls = {
      gemini: "https://aistudio.google.com/app/apikey",
      groq: "https://console.groq.com/keys",
      openai: "https://platform.openai.com/api-keys",
      anthropic: "https://console.anthropic.com/settings/keys",
      deepseek: "https://platform.deepseek.com/api_keys",
      openrouter: "https://openrouter.ai/keys"
    };

    body.innerHTML = `
      <div class="sw-section">
        <div class="sw-settings-label">AI Provider</div>
        <div class="sw-settings-hint">Choose a provider. Free options need no credit card.</div>
        <div class="sw-groq-recommend">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          <span><strong>Try Groq first</strong> — fastest free inference, no quota limits, great for daily use</span>
        </div>
        <div class="sw-provider-cards" id="sw-provider-cards">
          ${providers.map(p => {
      const isGemini = p.provider === "gemini";
      return `
            <div class="sw-pcard ${p.id === curProvider && !isGemini ? "sw-pcard-active" : ""} ${isGemini ? "sw-pcard-unavailable" : ""}" data-pid="${p.id}" ${isGemini ? 'data-disabled="true"' : ""}>
              <div class="sw-pcard-tier ${isGemini ? "is-soon" : (p.provider === 'gemini' || p.provider === 'groq' || p.provider === 'openrouter' ? 'is-free' : 'is-paid')}">
                ${isGemini ? "Coming Soon" : (p.provider === 'gemini' || p.provider === 'groq' || p.provider === 'openrouter' ? "Free" : "Paid")}
              </div>
              <div class="sw-pcard-name">${p.label}${isGemini ? " · Under Development" : ""}</div>
              <div class="sw-pcard-model">${isGemini ? "Integration being redesigned" : p.model}</div>
            </div>`;
    }).join("")}
        </div>
      </div>

      <div class="sw-section" style="margin-top:10px">
        <div class="sw-settings-label">API Keys</div>
        <div class="sw-key-safety">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <span>Stored in <code>chrome.storage.local</code> only — never shared.</span>
        </div>
        <div id="sw-keys-container">
          ${providers.map(p => {
      if (p.provider === "gemini") {
        return `
            <div class="sw-key-row-wrapper" style="margin-top: 6px;">
              <div style="font-size: 10px; font-weight: 600; color: var(--sw-text2); margin-bottom: 2px;">${p.label}</div>
              <div style="padding: 8px; background: rgba(108,99,255,0.06); border: 1px solid rgba(108,99,255,0.15); border-radius: 6px; font-size: 10px; color: var(--sw-text3);">
                Coming Soon / Under Development
              </div>
            </div>`;
      }
      const keyUrl = keyUrls[p.provider] || "#";
      const hasKey = !!p.apiKey;
      // SECURITY: never place the stored key value in the DOM (visible via Inspect/View Source).
      // Inputs always render empty; a masked placeholder + data-has-key flag communicate saved state.
      return `
            <div class="sw-key-row-wrapper" style="margin-top: 6px;">
              <div style="font-size: 10px; font-weight: 600; color: var(--sw-text2); margin-bottom: 2px;">${p.label} API Key</div>
              <div class="sw-key-row" style="position: relative; display: flex; align-items: center; gap: 4px;">
                <input class="sw-input sw-api-key-input" type="password" data-provider-id="${p.id}" data-has-key="${hasKey}"
                  placeholder="${hasKey ? "•••••••• (saved — type to replace)" : `Paste key for ${p.label}...`}" autocomplete="off"
                  value="" style="padding-right: 32px; flex: 1;" />
                <button class="sw-eye-btn sw-toggle-key-individual" data-provider-id="${p.id}" title="Show/hide typed key" style="position: absolute; right: 8px; background: transparent; border: none; cursor: pointer; color: var(--sw-text3); display: flex; align-items: center; justify-content: center;">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
              </div>
              <div style="font-size: 9px; margin-top: 2px; text-align: left; display:flex; gap:8px; align-items:center;">
                <a href="${keyUrl}" target="_blank" style="color: var(--sw-accent-lt); text-decoration: none;">Get API key</a>
                ${hasKey ? `<a href="#" class="sw-clear-key-individual" data-provider-id="${p.id}" style="color: var(--sw-text3); text-decoration: none;">Remove saved key</a>` : ""}
              </div>
            </div>`;
    }).join("")}
        </div>
        <button class="sw-btn-primary" id="sw-save-keys" style="width:100%;margin-top:10px">Save Keys</button>
        <div class="sw-settings-status" id="sw-key-status"></div>
      </div>

      <div class="sw-section" style="margin-top:10px">
        <button class="sw-btn-secondary" id="sw-try-more-models" style="width:100%;">Try More Models</button>
        <div id="sw-try-models-slots" class="sw-hidden" style="margin-top:8px;"></div>
        <button class="sw-btn-primary sw-hidden" id="sw-save-try-models" style="width:100%;margin-top:8px">Save Try Models</button>
        <div class="sw-settings-status" id="sw-try-models-status"></div>
      </div>

      <div class="sw-section" style="margin-top:10px">
        <div class="sw-settings-label">Preferences</div>
        <label class="sw-toggle-row">
          <input type="checkbox" id="sw-smart-naming" ${settings.smartNaming === false ? "" : "checked"} />
          <span>AI smart naming after knit</span>
        </label>
        <div style="margin-top:8px">
          <div class="sw-settings-label" style="margin-bottom:4px">Default translate language</div>
          <select class="sw-input" id="sw-default-lang">
            <option value="">Auto</option>
            ${["Spanish", "French", "German", "Hindi", "Kannada", "Tamil", "Arabic",
        "Chinese (Simplified)", "Japanese", "Portuguese", "Korean"]
        .map(l => `<option value="${l}" ${settings.defaultLang === l ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="sw-section" style="margin-top:10px">
        <div class="sw-settings-label">Wardrobe Backup</div>
        <div class="sw-row">
          <button class="sw-btn-secondary" id="sw-settings-export">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Export
          </button>
          <label class="sw-btn-secondary sw-import-label" for="sw-settings-import">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Import
            <input type="file" id="sw-settings-import" accept=".json" style="display:none" />
          </label>
        </div>
      </div>

      <div class="sw-section" style="margin-top:10px">
        <div class="sw-settings-label">Keyboard Shortcuts</div>
        <div class="sw-shortcuts-panel">
          <div class="sw-shortcut-row">
            <span class="sw-shortcut-desc">Toggle panel</span>
            <div class="sw-shortcut-keys"><span class="sw-kbd">Alt</span><span class="sw-kbd-plus">+</span><span class="sw-kbd">C</span></div>
          </div>
          <div class="sw-shortcut-row">
            <span class="sw-shortcut-desc">Quick-knit &amp; save</span>
            <div class="sw-shortcut-keys"><span class="sw-kbd">Alt</span><span class="sw-kbd-plus">+</span><span class="sw-kbd">K</span></div>
          </div>
          <div class="sw-shortcut-row">
            <span class="sw-shortcut-desc">Hide FAB (desktop)</span>
            <div class="sw-shortcut-keys"><span class="sw-kbd">Alt</span><span class="sw-kbd-plus">+</span><span class="sw-kbd">H</span></div>
          </div>
        </div>
      </div>

      <div class="sw-settings-info">
        <strong>Sweater v14</strong> — AI Context Transfer<br/>
        Free: Gemini · Groq · OpenRouter &nbsp;|&nbsp; Paid: OpenAI · Anthropic · DeepSeek
      </div>
    `;

    // Provider card click — switches active provider immediately
    body.querySelectorAll(".sw-pcard").forEach(card => {
      card.addEventListener("click", () => {
        if (card.dataset.disabled === "true") {
          showToast("Gemini is coming soon — integration under development", "warn");
          return;
        }
        const pid = card.dataset.pid;
        body.querySelectorAll(".sw-pcard").forEach(c => c.classList.remove("sw-pcard-active"));
        card.classList.add("sw-pcard-active");
        settings.activeProviderId = pid;
        chrome.runtime.sendMessage({ action: "SAVE_SETTINGS", settings });
        const name = providers.find(p => p.id === pid)?.label || pid;
        showToast(`Active model: ${name}`, "success");
      });
    });

    // Eye-button toggle
    body.querySelectorAll(".sw-toggle-key-individual").forEach(btn => {
      btn.addEventListener("click", () => {
        const pid = btn.dataset.providerId;
        const inp = body.querySelector(`.sw-api-key-input[data-provider-id="${pid}"]`);
        if (inp) inp.type = inp.type === "password" ? "text" : "password";
      });
    });

    // Remove saved key (explicit action — blank field alone never clears a key)
    body.querySelectorAll(".sw-clear-key-individual").forEach(link => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const pid = link.dataset.providerId;
        const prov = providers.find(p => p.id === pid);
        if (prov) prov.apiKey = "";
        chrome.runtime.sendMessage({ action: "SAVE_SETTINGS", settings }, () => {
          showToast("API key removed", "success");
          renderSettingsTab(body);
        });
      });
    });

    // Save Keys
    // SECURITY: a blank input never overwrites an existing saved key — inputs render
    // empty by design (see renderSettingsTab), so "blank" only ever means "user typed
    // nothing new", not "user wants to clear the key". Clearing is a separate explicit action.
    body.querySelector("#sw-save-keys").addEventListener("click", () => {
      const inputs = body.querySelectorAll(".sw-api-key-input");
      inputs.forEach(inp => {
        const pid = inp.dataset.providerId;
        const prov = providers.find(p => p.id === pid);
        const typed = inp.value.trim();
        if (prov && typed) prov.apiKey = typed;
      });
      chrome.runtime.sendMessage({ action: "SAVE_SETTINGS", settings }, () => {
        const status = body.querySelector("#sw-key-status");
        if (status) {
          status.textContent = "✓ Keys saved successfully!";
          status.className = "sw-settings-status sw-ok";
          setTimeout(() => { status.textContent = ""; }, 3000);
        }
        showToast("API keys saved!", "success");
      });
    });

    // Preferences
    body.querySelector("#sw-smart-naming").addEventListener("change", e => {
      settings.smartNaming = e.target.checked;
      chrome.runtime.sendMessage({ action: "SAVE_SETTINGS", settings });
    });
    body.querySelector("#sw-default-lang").addEventListener("change", e => {
      settings.defaultLang = e.target.value;
      settings.language = e.target.value ? "override" : "system";
      settings.overrideLanguage = e.target.value;
      chrome.runtime.sendMessage({ action: "SAVE_SETTINGS", settings });
    });

    // Export/Import
    body.querySelector("#sw-settings-export").addEventListener("click", exportAll);
    body.querySelector("#sw-settings-import").addEventListener("change", (e) => importFile(e, body));

    bindTryModelsSettings(body);
  }

  function bindTryModelsSettings(body) {
    const slots = TryModelsRegistry.normalizeSlots(settings.tryModelSlots);
    const expandBtn = body.querySelector("#sw-try-more-models");
    const slotsContainer = body.querySelector("#sw-try-models-slots");
    const saveBtn = body.querySelector("#sw-save-try-models");
    if (!expandBtn || !slotsContainer) return;

    expandBtn.addEventListener("click", () => {
      slotsContainer.classList.toggle("sw-hidden");
      saveBtn.classList.toggle("sw-hidden");
      if (!slotsContainer.classList.contains("sw-hidden") && !slotsContainer.innerHTML) {
        renderTryModelSlots(slotsContainer, slots);
      }
    });

    saveBtn.addEventListener("click", () => {
      settings.tryModelSlots = collectTryModelSlots(slotsContainer);
      chrome.runtime.sendMessage({ action: "SAVE_SETTINGS", settings }, () => {
        const status = body.querySelector("#sw-try-models-status");
        if (status) {
          status.textContent = "✓ Try Models saved!";
          status.className = "sw-settings-status sw-ok";
          setTimeout(() => { status.textContent = ""; }, 3000);
        }
        showToast("Try Models configuration saved!", "success");
      });
    });
  }

  function renderTryModelSlots(container, slots) {
    container.innerHTML = slots.map((slot, idx) => {
      const providerOptions = TryModelsRegistry.providerIds().map(pid => {
        const prov = TryModelsRegistry.getProvider(pid);
        return `<option value="${pid}" ${slot.provider === pid ? "selected" : ""}>${prov.label}</option>`;
      }).join("");
      const models = slot.provider ? TryModelsRegistry.getModels(slot.provider) : [];
      const modelOptions = models.map(m =>
        `<option value="${m.id}" ${slot.model === m.id ? "selected" : ""}>${m.label}</option>`
      ).join("");
      const keyUrl = slot.provider ? TryModelsRegistry.getKeyUrl(slot.provider) : "#";
      // SECURITY: same masked-input pattern as the Main AI Models section — the stored
      // key is never written into the DOM. See renderSettingsTab for the rationale.
      const isLocalSlot = slot.provider === "ollama" || slot.provider === "lmstudio";
      const hasKey = !isLocalSlot && !!slot.apiKey;
      return `
        <div class="sw-key-row-wrapper sw-try-slot" data-slot="${idx}" style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--sw-border);">
          <div style="font-size: 10px; font-weight: 700; color: var(--sw-text2); margin-bottom: 4px;">Fallback Slot ${idx + 1}</div>
          <div style="font-size: 9px; color: var(--sw-text3); margin-bottom: 2px;">Provider</div>
          <select class="sw-input sw-try-provider" data-slot="${idx}" style="margin-bottom: 4px;">
            <option value="">Select provider...</option>
            ${providerOptions}
          </select>
          <div style="font-size: 9px; color: var(--sw-text3); margin-bottom: 2px;">Model</div>
          <select class="sw-input sw-try-model" data-slot="${idx}" style="margin-bottom: 4px;">
            ${modelOptions || '<option value="">Select provider first</option>'}
          </select>
          <div style="font-size: 9px; color: var(--sw-text3); margin-bottom: 2px;">API Key</div>
          <input class="sw-input sw-try-key" type="password" data-slot="${idx}" data-has-key="${hasKey}" placeholder="${hasKey ? "•••••••• (saved — type to replace)" : "Paste API key..."}" value="" autocomplete="off" />
          <div style="font-size: 9px; margin-top: 2px; display:flex; gap:8px; align-items:center;">
            <a class="sw-try-key-link" data-slot="${idx}" href="${keyUrl}" target="_blank" style="color: var(--sw-accent-lt); text-decoration: none;">Get API Key</a>
            ${hasKey ? `<a href="#" class="sw-try-key-clear" data-slot="${idx}" style="color: var(--sw-text3); text-decoration: none;">Remove saved key</a>` : ""}
          </div>
        </div>`;
    }).join("");

    container.querySelectorAll(".sw-try-provider").forEach(sel => {
      sel.addEventListener("change", () => {
        const idx = sel.dataset.slot;
        const providerId = sel.value;
        const slotEl = container.querySelector(`.sw-try-slot[data-slot="${idx}"]`);
        const modelDropdown = slotEl.querySelector(".sw-try-model");
        const keyLink = slotEl.querySelector(".sw-try-key-link");
        const models = providerId ? TryModelsRegistry.getModels(providerId) : [];
        modelDropdown.innerHTML = models.length
          ? models.map(m => `<option value="${m.id}">${m.label}</option>`).join("")
          : '<option value="">Select provider first</option>';
        if (models.length) modelDropdown.value = models[0].id;
        if (keyLink) keyLink.href = providerId ? TryModelsRegistry.getKeyUrl(providerId) : "#";
      });
    });

    // Remove saved key for a Try Models slot — explicit action, same as Main AI Models.
    container.querySelectorAll(".sw-try-key-clear").forEach(link => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const idx = parseInt(link.dataset.slot, 10);
        const current = TryModelsRegistry.normalizeSlots(settings.tryModelSlots);
        if (current[idx]) current[idx].apiKey = "";
        settings.tryModelSlots = current;
        chrome.runtime.sendMessage({ action: "SAVE_SETTINGS", settings }, () => {
          showToast("API key removed", "success");
          renderTryModelSlots(container, current);
        });
      });
    });
  }

  function collectTryModelSlots(container) {
    // SECURITY: inputs always render blank (see renderTryModelSlots), so a blank field
    // means "no change" and must fall back to the previously saved key, not overwrite it.
    const existing = TryModelsRegistry.normalizeSlots(settings.tryModelSlots);
    return TryModelsRegistry.normalizeSlots(
      Array.from(container.querySelectorAll(".sw-try-slot")).map((slotEl, idx) => {
        const typed = slotEl.querySelector(".sw-try-key")?.value.trim() || "";
        return {
          provider: slotEl.querySelector(".sw-try-provider")?.value || "",
          model: slotEl.querySelector(".sw-try-model")?.value || "",
          apiKey: typed || existing[idx]?.apiKey || ""
        };
      })
    );
  }
  // ── PENDING INJECTION ROUTE ───────────────────────────────────────────────
  async function checkPendingInjection() {
    chrome.storage.local.get(["pending_injection"], async (res) => {
      const pending = res.pending_injection;
      if (!pending) return;

      const now = Date.now();
      if (now - pending.timestamp > 60000) {
        chrome.storage.local.remove("pending_injection");
        return;
      }

      const adapter = SiteAdapterFactory.getAdapter();
      if (adapter && adapter.detect()) {
        chrome.storage.local.remove("pending_injection");

        // Prefer stored compressed continuePrompt when capsule was compressed
        const promptText = (pending.capsule && pending.capsule.compressed && pending.capsule.continuePrompt)
          ? pending.capsule.continuePrompt
          : (pending.prompt || pending.capsule?.continuePrompt || "");

        let retries = 40;
        while (retries > 0) {
          const inputEl = adapter.detectInput();
          if (inputEl) {
            const success = await adapter.injectPrompt(promptText, pending.capsule);
            if (success) {
              showToast("Sweater context autofilled!", "success");
              break;
            }
          }
          await sleep(250);
          retries--;
        }
      }
    });
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function fmt(n) { return n < 1000 ? `${n}c` : `${(n / 1000).toFixed(1)}k chars`; }
  function escapeHtml(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  // Custom Toast helper
  function showToast(text, type = "info") {
    const root = getRoot();
    if (!root) return;
    const old = root.getElementById("sweater-toast");
    if (old) old.remove();
    const t = document.createElement("div");
    t.id = "sweater-toast";
    t.className = `sw-toast-${type}`;
    t.textContent = text;
    root.appendChild(t);
    requestAnimationFrame(() => t.classList.add("sw-toast-show"));
    setTimeout(() => { t.classList.remove("sw-toast-show"); setTimeout(() => t.remove(), 400); }, 3000);
  }

  function showError(body, msg) {
    const zone = body.querySelector("#sw-knit-zone");
    if (zone) {
      const desc = zone.querySelector(".sw-desc");
      if (desc) desc.textContent = `⚠ ${msg}`;
    }
  }

  function detectPlatform() {
    const adapter = SiteAdapterFactory.getAdapter();
    if (!adapter) return null;
    if (adapter.constructor.name === "GenericTextareaAdapter" || adapter.name === "Generic" || adapter.name === "AI Chat") {
      return null;
    }
    return adapter;
  }

  function buildCapsule(messages, source) {
    const cleaned = messages.map(m => ({ role: m.role, content: m.content.trim() }));
    const title = cleaned[0]?.content.slice(0, 60) + "..." || "Untitled Checkpoint";
    const contextLines = cleaned.map(m => `[${m.role === "user" ? "USER" : "AI"}]: ${m.content}`).join("\n\n");
    const continuePrompt = `# 🧶 Sweater — Transferred Context\n\n${contextLines}\n\n---\n\nContinue the task from here.`;
    return {
      version: "2.0",
      id: `sw_${Date.now()}`,
      title,
      source: source || "AI",
      createdAt: new Date().toISOString(),
      messageCount: cleaned.length,
      contextLength: continuePrompt.length,
      messages: cleaned,
      continuePrompt,
      tags: [],
      versions: []
    };
  }

  // Event Listeners for global extensions hotkeys Alt+C, Alt+K and popup actions
  chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    if (msg.action === "TOGGLE_PANEL") {
      lastTrigger = "sticky";
      togglePanel();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.action === "HIDE_FAB") {
      if (window.innerWidth >= 768 && fab) {
        const hidden = fab.dataset.hidden === "1";
        if (hidden) {
          fab.dataset.hidden = "0";
          positionFAB();
        } else {
          fab.dataset.hidden = "1";
          fab.style.display = "none";
        }
      }
      sendResponse({ ok: true });
      return true;
    }
    if (msg.action === "QUICK_KNIT") {
      const adapter = SiteAdapterFactory.getAdapter();
      if (!adapter || adapter.constructor.name === "GenericTextareaAdapter") {
        showToast("Not an AI tool page", "error");
        sendResponse({ ok: false });
        return true;
      }
      try {
        const messages = adapter.extractMessages();
        const validMessages = messages.filter(m => m.content && m.content.trim().length > 0);
        if (!validMessages.length) {
          showToast("No conversation to knit", "warn");
          sendResponse({ ok: false });
          return true;
        }
        const capsule = buildCapsule(validMessages, adapter.name);
        chrome.runtime.sendMessage({ action: "SAVE_CAPSULE", capsule }, () => {
          showToast(`Quick-knitted: ${capsule.messageCount} messages saved`, "success");
        });
        sendResponse({ ok: true });
      } catch (e) {
        showToast("Quick-knit failed: " + e.message, "error");
        sendResponse({ ok: false });
      }
      return true;
    }
    if (msg.action === "DETECT_PLATFORM") {
      const platform = detectPlatform();
      sendResponse({ platform: platform?.name || null, url: location.href });
      return true;
    }
    if (msg.action === "EXTRACT_CONVERSATION") {
      const adapter = SiteAdapterFactory.getAdapter();
      if (!adapter || adapter.constructor.name === "GenericTextareaAdapter") {
        sendResponse({ success: false, error: "Not supported" });
        return true;
      }
      try {
        const messages = adapter.extractMessages();
        const validMessages = messages.filter(m => m.content && m.content.trim().length > 0);
        sendResponse({ success: true, capsule: buildCapsule(validMessages, adapter.name) });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return true;
    }
    if (msg.action === "INJECT_CAPSULE") {
      // Inject compressed and uncompressed the same way (text). No auto-download.
      const text = msg.capsule ? msg.capsule.continuePrompt : msg.prompt;
      injectText(text)
        .then(ok => sendResponse({ success: ok }))
        .catch(() => sendResponse({ success: false }));
      return true;
    }
    if (msg.action === "SHOW_TOAST") {
      showToast(msg.text, msg.type || "info");
      sendResponse({ ok: true });
      return true;
    }
    if (msg.action === "OPEN_MINI_SWEATER") {
      if (window.SweaterMiniSweater && typeof window.SweaterMiniSweater.open === "function") {
        window.SweaterMiniSweater.open();
        sendResponse({ ok: true });
      } else {
        showToast("Mini Sweater unavailable on this page", "warn");
        sendResponse({ ok: false });
      }
      return true;
    }
  });

  // Subscribe to settings changes from popup/background
  if (window.EventBus) {
    window.EventBus.subscribe("settingsChanged", (newSettings) => {
      settings = newSettings;
      const settingsTab = panel?.querySelector("#sw-view-settings");
      if (settingsTab && settingsTab.classList.contains("sw-active")) {
        renderSettingsTab(settingsTab);
      }
    });
  }

  // Start orchestrator boot
  init();

})();
