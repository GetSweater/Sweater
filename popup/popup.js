// Sweater v14 Popup Logic
(function () {
  "use strict";

  let currentPlatform = null;
  let currentCapsule = null;
  let capsules = [];
  let currentTags = [];
  let settings = {};
  let activeAITool = null;
  let compressApplied = false;
  let compressedText = null;
  let compressFormat = null;
  let isCodeKnit = false;

  const LLM_TARGETS = {
    chatgpt: "https://chatgpt.com/",
    claude: "https://claude.ai/new",
    groq: "https://chat.groq.com/",
    gemini: "https://gemini.google.com/app",
    perplexity: "https://www.perplexity.ai/",
  };

  // ── BOOT ──────────────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", async () => {
    await loadSettings();
    await detectPlatform();
    await loadCapsules();
    bindNav();
    bindCapture();
    bindSettings();
    bindCompressModal();
    renderWardrobe();
    renderWear();
  });

  // ── SETTINGS ──────────────────────────────────────────────────────────────
  async function loadSettings() {
    settings = await SettingsService.loadSettings();
  }

  // ── PLATFORM ──────────────────────────────────────────────────────────────
  async function detectPlatform() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { action: "DETECT_PLATFORM" });
      currentPlatform = res;
      setPlatformBadge("platform-badge", "platform-name", res);
    } catch {
      setPlatformBadge("platform-badge", "platform-name", null);
    }
  }

  function setPlatformBadge(bid, nid, res) {
    const b = document.getElementById(bid), n = document.getElementById(nid);
    if (!b || !n) return;
    if (res?.platform) {
      b.className = "platform-badge detected";
      n.textContent = res.platform + " · ready";
    } else {
      b.className = "platform-badge unsupported";
      n.textContent = "Not an AI tool page";
    }
  }

  async function loadCapsules() {
    return new Promise(r => chrome.runtime.sendMessage({ action: "GET_CAPSULES" }, res => {
      capsules = res?.capsules || []; r();
    }));
  }

  // ── NAV ───────────────────────────────────────────────────────────────────
  function bindNav() {
    ["capture", "vault", "inject", "settings"].forEach(v => {
      document.getElementById(`btn-nav-${v}`).addEventListener("click", () => setView(v));
    });
  }

  function setView(v) {
    document.querySelectorAll(".view").forEach(el => el.classList.remove("active"));
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.getElementById(`view-${v}`).classList.add("active");
    document.getElementById(`btn-nav-${v}`).classList.add("active");
    if (v === "vault") renderWardrobe();
    if (v === "inject") renderWear();
    if (v === "settings") renderSettings();
  }

  // ── CAPTURE & KNIT ────────────────────────────────────────────────────────
  function bindCapture() {
    document.getElementById("btn-capture").addEventListener("click", doKnit);
    document.getElementById("btn-copy-capsule").addEventListener("click", copyPrompt);
    document.getElementById("btn-save-capsule").addEventListener("click", saveSweater);
    document.getElementById("btn-reset-capture").addEventListener("click", resetCapture);

    document.querySelectorAll("#llm-shortcuts-row .llm-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        await saveSweater();
        await openInLLM(btn.dataset.llm, currentCapsule);
      });
    });

    document.getElementById("tag-input").addEventListener("keydown", e => {
      if (e.key === "Enter") {
        const v = e.target.value.trim();
        if (v && !currentTags.includes(v)) { currentTags.push(v); renderTags(); }
        e.target.value = "";
      }
    });

    document.getElementById("vault-search").addEventListener("input", e =>
      renderWardrobe(e.target.value.toLowerCase()));
    document.getElementById("btn-export").addEventListener("click", exportAll);
    document.getElementById("import-file").addEventListener("change", importFile);

    // AI Tool buttons
    ["summarize", "insights", "translate", "chat"].forEach(t => {
      document.getElementById(`btn-ai-${t}`).addEventListener("click", () => toggleAITool(t));
    });
    document.getElementById("btn-do-translate").addEventListener("click", doTranslate);
    document.getElementById("btn-do-chat").addEventListener("click", doChat);
    document.getElementById("chat-input").addEventListener("keydown", e => {
      if (e.key === "Enter") doChat();
    });

    document.getElementById("compress-cta").addEventListener("click", handleCompress);
  }

  // ── KNIT ──────────────────────────────────────────────────────────────────
  async function copyPrompt() {
    if (!currentCapsule) return;
    const text = (compressApplied && compressedText) ? compressedText : currentCapsule.continuePrompt;
    await navigator.clipboard.writeText(text);
    showToast("Copied to clipboard!", "success");
  }

  function resetCapture() {
    currentCapsule = null;
    currentTags = [];
    compressApplied = false;
    compressedText = null;
    compressFormat = null;
    isCodeKnit = false;
    activeAITool = null;

    document.getElementById("capture-result").classList.add("hidden");
    document.getElementById("capture-zone").classList.remove("hidden");
    document.getElementById("ai-output")?.classList.add("hidden");
    document.getElementById("translate-opts")?.classList.add("hidden");
    document.getElementById("chat-box")?.classList.add("hidden");
    document.getElementById("compress-cta")?.classList.remove("hidden", "compressed");
  }

  async function doKnit() {
    const btn = document.getElementById("btn-capture");
    btn.classList.add("loading");
    btn.textContent = "Knitting...";
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { action: "EXTRACT_CONVERSATION" });
      if (!res.success) { setKnitError(res.error || "Could not extract"); return; }
      currentCapsule = res.capsule;
      currentTags = [];
      compressApplied = false;
      compressedText = null;
      compressFormat = null;
      isCodeKnit = detectCodeContent(currentCapsule);

      // Category / Domain Classifier Trigger
      chrome.runtime.sendMessage({
        action: "AI_CLASSIFY",
        prompt: currentCapsule.continuePrompt
      }, (catRes) => {
        window._swCategory = catRes?.result || "General";
        const detCat = document.getElementById("detected-category");
        if (detCat) detCat.textContent = window._swCategory;

        // Context Quality Score evaluator
        const quality = StateEngine.evaluateQuality(currentCapsule.continuePrompt);
        const qBadge = document.getElementById("quality-badge");
        if (qBadge) qBadge.textContent = `${quality.score}%`;
        const qMissing = document.getElementById("quality-missing");
        if (qMissing) {
          qMissing.textContent = quality.missing.length > 0
            ? `Missing: ${quality.missing.join(", ")}`
            : "Context Complete! ✓";
        }
      });

      // Smart naming
      const activeSlot = settings.providers.find(p => p.id === settings.activeProviderId);
      if (activeSlot && activeSlot.apiKey && settings.smartNaming !== false) {
        chrome.runtime.sendMessage({
          action: "AI_SMART_TITLE",
          prompt: `Generate a concise, descriptive title (max 8 words) for this conversation. Return ONLY the title, nothing else.\n\nFirst message: "${currentCapsule.messages?.[0]?.content?.slice(0, 300) || currentCapsule.title}"`
        }, res2 => {
          if (res2?.result) {
            currentCapsule.title = res2.result.trim().replace(/^['"']|['"']$/g, "");
            const inp = document.getElementById("capsule-title-input");
            if (inp) inp.value = currentCapsule.title.slice(0, 80);
          }
        });
      }

      showKnitResult(currentCapsule);
      chrome.tabs.sendMessage(tab.id, { action: "SHOW_TOAST", text: `Knitted ${res.capsule.messageCount} messages`, type: "success" });
    } catch (e) {
      setKnitError("Failed to connect. Refresh the page.");
    } finally {
      btn.classList.remove("loading");
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="3"/><path d="M3 12h1M20 12h1M12 3v1M12 20v1"/></svg> Knit Conversation`;
    }
  }

  function setKnitError(msg) {
    const sub = document.getElementById("capture-sub");
    if (sub) sub.textContent = `⚠ ${msg}`;
  }

  function detectCodeContent(cap) {
    const text = cap.continuePrompt || "";
    const codeBlocks = (text.match(/```/g) || []).length;
    return codeBlocks >= 4;
  }

  function showKnitResult(cap) {
    document.getElementById("capture-zone").classList.add("hidden");
    document.getElementById("capture-result").classList.remove("hidden");
    document.getElementById("result-meta").textContent =
      `✓ ${cap.messageCount} messages · ${fmt(cap.contextLength)} knitted from ${cap.source}`;
    document.getElementById("capsule-title-input").value = cap.title.slice(0, 80).replace(/\.\.\.$/, "");

    // Recapture banner
    const existing = capsules.find(c => c.source === cap.source);
    const banner = document.getElementById("recapture-banner");
    const recaptureBtn = document.getElementById("btn-recapture");
    if (existing && banner) {
      document.getElementById("recapture-text").innerHTML = `Update <strong>${esc(existing.title.slice(0, 30))}</strong>?`;
      banner.classList.remove("hidden");
      recaptureBtn.onclick = () => { currentCapsule.id = existing.id; };
    } else if (banner) {
      banner.classList.add("hidden");
    }

    // Token row
    const tokenRow = document.getElementById("token-row");
    const tokenVal = document.getElementById("token-value");
    if (tokenRow && tokenVal) {
      tokenVal.textContent = Math.round(cap.contextLength / 4) >= 1000
        ? (Math.round(cap.contextLength / 4) / 1000).toFixed(1) + "k"
        : Math.round(cap.contextLength / 4);
      tokenRow.classList.remove("hidden");
    }

    // lock hint
    const activeSlot = settings.providers.find(p => p.id === settings.activeProviderId);
    const hasKey = activeSlot && !!activeSlot.apiKey;
    const lockHint = document.getElementById("ai-lock-hint");
    if (lockHint) lockHint.textContent = hasKey ? "" : "— set API key in Settings";
    document.querySelectorAll(".ai-tool-btn").forEach(b => {
      b.disabled = !hasKey;
      b.title = hasKey ? b.title : "Set API key in Settings to enable AI features";
    });

    // Show compression CTA if content is large (>3000 chars)
    const cta = document.getElementById("compress-cta");
    if (cap.contextLength > 3000) {
      cta.classList.remove("hidden");
      updateCompressCTA();
    } else {
      cta.classList.add("hidden");
    }

    renderTags();
  }

  function updateCompressCTA() {
    const cta = document.getElementById("compress-cta");
    const icon = document.getElementById("compress-icon");
    const title = document.getElementById("compress-title");
    const sub = document.getElementById("compress-sub");
    const badge = document.getElementById("compress-badge");

    if (compressApplied) {
      cta.classList.add("compressed");
      icon.textContent = "✓";
      const fmtLabel = compressFormat === "clean" ? "Clean Chat"
        : compressFormat === "transcript" ? "Transcript"
          : "Smart Memory";
      title.textContent = `Compressed — ${fmtLabel}`;
      sub.textContent = "Ready for Wardrobe, Wear & Shortcuts";
      badge.textContent = "DONE";
    } else {
      cta.classList.remove("compressed");
      badge.classList.remove("code-badge");
      icon.textContent = "⟁";
      title.textContent = "Compress for fewer tokens";
      sub.textContent = "Large conversation detected — tap to shrink";
      badge.textContent = "COMPRESS";
    }
  }

  // ── COMPRESSION MODAL ──────────────────────────────────────────────────────
  function bindCompressModal() {
    document.getElementById("compress-modal-cancel").addEventListener("click", () => {
      document.getElementById("compress-modal").classList.add("hidden");
    });

    document.getElementById("compress-opt-md").addEventListener("click", () => {
      document.getElementById("compress-modal").classList.add("hidden");
      applyInlineCompress("clean");
    });

    document.getElementById("compress-opt-txt").addEventListener("click", () => {
      document.getElementById("compress-modal").classList.add("hidden");
      applyInlineCompress("transcript");
    });

    document.getElementById("compress-opt-inline").addEventListener("click", () => {
      document.getElementById("compress-modal").classList.add("hidden");
      doInlineCompress();
    });
  }

  function handleCompress() {
    if (compressApplied || !currentCapsule) return;
    document.getElementById("compress-modal").classList.remove("hidden");
  }

  function applyInlineCompress(format) {
    if (!currentCapsule) return;
    const raw = currentCapsule.continuePrompt;
    const compressed = (format === "clean") ? buildCleanChat(raw) : buildTranscript(raw, currentCapsule.messages);

    syncCompressedToCapsule(compressed, format);
    updateCompressCTA();

    const saved = Math.round((raw.length - compressed.length) / 4);
    if (saved > 0) {
      const tv = document.getElementById("token-value");
      const newEst = Math.max(0, Math.round(compressed.length / 4));
      if (tv) tv.textContent = (newEst >= 1000 ? (newEst / 1000).toFixed(1) + "k" : newEst) + " (saved ~" + (saved >= 1000 ? (saved / 1000).toFixed(1) + "k" : saved) + ")";
    }
  }

  function syncCompressedToCapsule(compressed, format) {
    compressedText = compressed;
    compressApplied = true;
    compressFormat = format;
    isCodeKnit = false;

    currentCapsule.compressed = true;
    currentCapsule.compressFormat = format;
    currentCapsule.continuePrompt = compressed;
    currentCapsule.contextLength = compressed.length;

    chrome.runtime.sendMessage({ action: "SAVE_CAPSULE", capsule: currentCapsule });
  }

  async function doInlineCompress() {
    if (!currentCapsule) return;
    const cta = document.getElementById("compress-cta");
    const title = document.getElementById("compress-title");
    const sub = document.getElementById("compress-sub");

    const activeSlot = settings.providers.find(p => p.id === settings.activeProviderId);
    const hasTryModels = TryModelsRegistry.getConfiguredSlots(settings).length > 0;
    const canUseAi = (activeSlot && activeSlot.apiKey && activeSlot.provider !== "gemini") || hasTryModels;
    if (canUseAi) {
      title.textContent = "Building Smart Memory...";
      sub.textContent = "AI extracting goals, decisions & progress";
      cta.style.pointerEvents = "none";

      const raw = currentCapsule.continuePrompt;
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
          compressed = buildSmartMemoryLocal(currentCapsule.messages || [], currentCapsule.continuePrompt);
        }
        syncCompressedToCapsule(compressed, "smart");

        // Quality score refresh
        const quality = res?.quality || StateEngine.evaluateQuality(compressedText);
        if (quality) {
          const qBadge = document.getElementById("quality-badge");
          if (qBadge) qBadge.textContent = `${quality.score}%`;
          const qMissing = document.getElementById("quality-missing");
          if (qMissing) {
            qMissing.textContent = quality.missing.length > 0
              ? `Missing: ${quality.missing.join(", ")}`
              : "Context Complete! ✓";
          }
        }

        updateCompressCTA();
      });
    } else {
      const compressed = buildSmartMemoryLocal(currentCapsule.messages || [], currentCapsule.continuePrompt);
      syncCompressedToCapsule(compressed, "smart");

      const quality = StateEngine.evaluateQuality(compressedText);
      if (quality) {
        const qBadge = document.getElementById("quality-badge");
        if (qBadge) qBadge.textContent = `${quality.score}%`;
        const qMissing = document.getElementById("quality-missing");
        if (qMissing) {
          qMissing.textContent = quality.missing.length > 0
            ? `Missing: ${quality.missing.join(", ")}`
            : "Context Complete! ✓";
        }
      }

      updateCompressCTA();
    }
  }

  // ── SAVE & CHECKPOINTS ────────────────────────────────────────────────────
  async function saveSweater() {
    if (!currentCapsule) return;
    const t = document.getElementById("capsule-title-input").value.trim();
    if (t) currentCapsule.title = t;
    currentCapsule.tags = [...currentTags];

    // Smart Save
    const smartSaveEnabled = document.getElementById("smart-save-toggle")?.checked;
    if (smartSaveEnabled && !compressApplied) {
      document.getElementById("btn-save-capsule").textContent = "Smart Saving...";

      const activeSlot = settings.providers.find(p => p.id === settings.activeProviderId);
      if (activeSlot && activeSlot.apiKey) {
        const response = await new Promise(resolve => {
          chrome.runtime.sendMessage({
            action: "AI_SMART_SAVE",
            prompt: currentCapsule.continuePrompt
          }, resolve);
        });

        if (response && response.result) {
          const stateObj = StateEngine.parseYamlState(response.result);
          currentCapsule.continuePrompt = StateEngine.compileStatePrompt(stateObj, currentPlatform?.platform || "AI", window._swCategory || "General");
          currentCapsule.state = response.result;
          currentCapsule.contextLength = currentCapsule.continuePrompt.length;
        }
      } else {
        const local = buildSmartSaveLocal(currentCapsule.messages);
        currentCapsule.continuePrompt = StateEngine.compileStatePrompt(local, currentPlatform?.platform || "AI", window._swCategory || "General");
        currentCapsule.state = `goal: ${local.goal}\nnext_task: ${local.next_task}`;
        currentCapsule.contextLength = currentCapsule.continuePrompt.length;
      }
    }

    if (compressApplied) {
      currentCapsule.compressed = true;
      currentCapsule.compressFormat = compressFormat;
      if (compressedText) {
        currentCapsule.continuePrompt = compressedText;
        currentCapsule.contextLength = compressedText.length;
      }
    } else if (!smartSaveEnabled) {
      currentCapsule.compressed = false;
      currentCapsule.compressFormat = null;
    }

    chrome.runtime.sendMessage({ action: "SAVE_CAPSULE", capsule: currentCapsule }, async () => {
      await loadCapsules();
      renderWardrobe();
      renderWear();
      const btn = document.getElementById("btn-save-capsule");
      btn.textContent = "Saved! ✓";
      setTimeout(() => { btn.textContent = "Save"; }, 1500);
    });
  }

  // Local Smart Save Fallback
  function buildSmartSaveLocal(messages) {
    const text = messages.map(m => m.content).join("\n");
    const stack = [];
    const matchedTech = text.match(/\b(React|Vue|Next\.js|Node|Python|Postgres|Tailwind|Supabase|OpenAI|DeepSeek|Llama)\b/gi) || [];
    matchedTech.forEach(t => { if (!stack.includes(t)) stack.push(t); });

    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    let goal = "Active Project Tasks";
    let nextTask = "Continue coding features";

    for (const line of lines) {
      if (/\b(goal|build|create|implement|fixing)\b/i.test(line)) {
        goal = line.slice(0, 100);
      }
      if (/\b(next step|next task|todo|to-do)\b/i.test(line)) {
        nextTask = line.slice(0, 100);
      }
    }

    return {
      goal,
      stack,
      facts: ["Extracted locally"],
      completed: ["Recent chat progress"],
      pending: ["Pending next items"],
      context: "Local backup checkpoint",
      next_task: nextTask
    };
  }

  // Local clean chat logic
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

  // ── WARDROBE (with versions dropdown) ─────────────────────────────────────
  function renderWardrobe(q = "") {
    const list = document.getElementById("capsule-list");
    const filtered = q ? capsules.filter(c =>
      c.title.toLowerCase().includes(q) ||
      (c.source || "").toLowerCase().includes(q) ||
      (c.tags || []).some(t => t.toLowerCase().includes(q))
    ) : capsules;

    if (!filtered.length) {
      list.innerHTML = `<div class="empty-state"><p>${q ? "No matches" : "No sweaters saved yet"}</p></div>`;
      return;
    }

    list.innerHTML = filtered.map(c => {
      const date = new Date(c.updatedAt || c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const versions = c.versions || [];

      let versionSelect = "";
      if (versions.length > 1) {
        versionSelect = `
          <div style="margin-top:6px; display:flex; align-items:center; gap:6px;">
            <span style="font-size:10px; color:var(--text3)">Version:</span>
            <select class="field-sm version-selector" data-id="${c.id}" style="padding:2px; font-size:10px; height:18px; width: auto; flex: none;">
              ${versions.map(v => `<option value="${v.version}" ${v.version === versions.length ? "selected" : ""}>v${v.version} (${v.messageCount} msgs)</option>`).join("")}
            </select>
          </div>`;
      }

      const compressedBadge = c.compressed ? `<span class="capsule-flag" title="Compressed">COMP</span>` : "";
      const aiBadge = c.summary ? `<span class="capsule-flag" title="${esc(c.summary)}">AI</span>` : "";

      return `
        <div class="capsule-card" data-id="${c.id}">
          <div class="capsule-card-header">
            <div class="capsule-card-title">${escapeHtml(c.title)}</div>
            <div class="capsule-card-actions">
              <button class="capsule-action-btn edit capsule-edit-btn" data-id="${c.id}">✏️</button>
              <button class="capsule-action-btn copy capsule-copy-btn" data-id="${c.id}">📋</button>
              <button class="capsule-action-btn delete capsule-delete-btn" data-id="${c.id}">🗑️</button>
            </div>
          </div>
          <div class="capsule-card-meta">
            <span class="capsule-source">${c.source}</span>
            <span>${c.messageCount} msgs</span>
            <span>${date}</span>
            ${aiBadge}
            ${compressedBadge}
          </div>
          ${versionSelect}
          <div class="card-llm-row" style="margin-top:6px">
            <button class="card-llm-btn" data-id="${c.id}" data-llm="chatgpt">GPT</button>
            <button class="card-llm-btn" data-id="${c.id}" data-llm="claude">Claude</button>
            <button class="card-llm-btn" data-id="${c.id}" data-llm="groq">Groq</button>
            <button class="card-llm-btn" data-id="${c.id}" data-llm="gemini">Gemini</button>
            <button class="card-llm-btn" data-id="${c.id}" data-llm="perplexity">Perplx</button>
          </div>
        </div>`;
    }).join("");

    // Attach hover tooltip previews
    list.querySelectorAll(".capsule-card").forEach(card => {
      attachHoverPreview(card);
    });

    list.querySelectorAll(".capsule-edit-btn").forEach(btn => btn.addEventListener("click", e => {
      e.stopPropagation();
      const cap = capsules.find(c => c.id === btn.dataset.id);
      if (cap) openEditor(cap);
    }));

    // Dynamic versions switch
    list.querySelectorAll(".version-selector").forEach(sel => {
      sel.onchange = async (e) => {
        const capsuleId = sel.dataset.id;
        const versionNum = e.target.value;
        const cap = capsules.find(c => c.id === capsuleId);
        if (!cap) return;

        const versionData = StateEngine.getVersion(cap, versionNum);
        if (versionData) {
          cap.continuePrompt = versionData.continuePrompt;
          cap.compressFormat = versionData.compressFormat;
          cap.state = versionData.state;
          cap.messageCount = versionData.messageCount;

          await new Promise(resolve => {
            chrome.runtime.sendMessage({ action: "SAVE_CAPSULE", capsule: cap }, resolve);
          });
          showToast(`Switched to version v${versionNum}`, "success");
        }
      };
    });

    list.querySelectorAll(".capsule-copy-btn").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const cap = capsules.find(c => c.id === btn.dataset.id);
        if (cap) {
          await navigator.clipboard.writeText(cap.continuePrompt);
          btn.textContent = "✓";
          setTimeout(() => { btn.textContent = "📋"; }, 1500);
        }
      });
    });

    list.querySelectorAll(".capsule-delete-btn").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ action: "DELETE_CAPSULE", id: btn.dataset.id }, async () => {
          await loadCapsules(); renderWardrobe();
        });
      });
    });

    list.querySelectorAll(".card-llm-btn").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const cap = capsules.find(c => c.id === btn.dataset.id);
        if (cap) await openInLLM(btn.dataset.llm, cap);
      });
    });
  }

  // ── HOVER PREVIEW TOOLTIP ──────────────────────────────────────────────────
  function safeRemoveTip(card) {
    try {
      const tip = card.querySelector(".preview-tip");
      if (tip && tip.parentNode === card) card.removeChild(tip);
    } catch { }
  }

  function attachHoverPreview(card) {
    let tipTimer;
    card.addEventListener("mouseenter", () => {
      if (tipTimer) clearTimeout(tipTimer);
      tipTimer = setTimeout(() => {
        safeRemoveTip(card);
        const cap = capsules.find(c => c.id === card.dataset.id);
        if (!cap || !card.isConnected) return;

        const messages = cap.messages || [{ role: "user", content: cap.continuePrompt || "" }];
        const preview = messages.slice(0, 3).map(m => `
          <div class="preview-msg">
            <span class="preview-role ${m.role === "user" ? "user" : "ai"}">${m.role === "user" ? "YOU" : "AI"}</span>
            <span class="preview-text">${esc(m.content.slice(0, 120))}</span>
          </div>`).join("");

        const tip = document.createElement("div");
        tip.className = "preview-tip";
        tip.innerHTML = `<div class="preview-tip-title">Preview</div>${preview}`;
        card.style.position = "relative";
        card.appendChild(tip);
      }, 450);
    });

    card.addEventListener("mouseleave", () => {
      if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
      safeRemoveTip(card);
    });

    card.addEventListener("click", () => {
      if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
      safeRemoveTip(card);
    });
  }

  // ── EDITOR OVERLAY ─────────────────────────────────────────────────────────
  function openEditor(cap) {
    const app = document.querySelector(".app");
    if (!app) return;

    if (!cap.messages || !cap.messages.length) {
      cap.messages = [{ role: "user", content: cap.continuePrompt || "" }];
    }

    const overlay = document.createElement("div");
    overlay.className = "editor-overlay";
    overlay.innerHTML = `
      <div class="editor-header">
        <button id="editor-back">←</button>
        <span class="editor-title">Edit Sweater</span>
        <button id="editor-save-btn" style="color:#9b94ff;font-weight:700;font-size:12px;">Save</button>
      </div>
      <div class="editor-body" id="editor-body">
        ${cap.messages.map((m, i) => `
          <div class="editor-msg">
            <div class="editor-msg-label ${m.role === "user" ? "user" : "ai"}">${m.role === "user" ? "YOU" : "AI"}</div>
            <textarea class="editor-msg-text" data-idx="${i}">${esc(m.content)}</textarea>
          </div>`).join("")}
       </div>
       <div class="editor-footer">
         <button class="btn-secondary" id="editor-back2">Cancel</button>
         <button class="btn-primary" id="editor-save-btn2">✓ Save Changes</button>
       </div>`;

    app.appendChild(overlay);

    const closeEditor = () => { overlay.remove(); };
    overlay.querySelector("#editor-back").addEventListener("click", closeEditor);
    overlay.querySelector("#editor-back2").addEventListener("click", closeEditor);

    const doSave = () => {
      const textareas = overlay.querySelectorAll(".editor-msg-text");
      textareas.forEach((ta, i) => { cap.messages[i].content = ta.value; });

      const contextLines = cap.messages.map(m => {
        const label = m.role === "user" ? "USER" : "AI";
        return `[${label}]: ${m.content}`;
      }).join("\n\n");

      cap.continuePrompt = `# 🧶 Sweater — Imported Context\n\nThis conversation was transferred from **${cap.source}**.\n\n---\n\n${contextLines}\n\n---\n\n## ▶ Continue from here:\n\nYou now have the full context above. Please continue this conversation/project from where it left off. Acknowledge the context briefly, then ask what the user wants to do next.`;
      cap.contextLength = cap.continuePrompt.length;

      chrome.runtime.sendMessage({ action: "SAVE_CAPSULE", capsule: cap }, () => {
        loadCapsules().then(() => {
          renderWardrobe();
          renderWear();
          closeEditor();
        });
      });
    };
    overlay.querySelector("#editor-save-btn").addEventListener("click", doSave);
    overlay.querySelector("#editor-save-btn2").addEventListener("click", doSave);
  }

  // ── WEAR ──────────────────────────────────────────────────────────────────
  function renderWear() {
    const list = document.getElementById("inject-list");
    if (!capsules.length) {
      list.innerHTML = `<div class="empty-state"><p>No sweaters saved</p></div>`;
      return;
    }

    list.innerHTML = capsules.map(c => {
      return `<div class="inject-card" data-id="${c.id}">
        <div class="inject-card-header" style="display:flex;align-items:center;justify-content:space-between;">
          <div class="inject-card-title" style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;margin-bottom:0;">${escapeHtml(c.title)}</div>
          <button class="wear-btn wear-send-btn" data-id="${c.id}">Wear</button>
        </div>
        <div class="inject-card-meta" style="display:flex;align-items:center;gap:7px;margin-top:5px;font-size:10px;color:var(--text3);">
          <span class="capsule-source">${c.source}</span>
          <span>${c.messageCount} msgs</span>
        </div>
      </div>`;
    }).join("");

    list.querySelectorAll(".inject-card").forEach(card => {
      attachHoverPreview(card);
    });

    list.querySelectorAll(".wear-send-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const cap = capsules.find(c => c.id === btn.dataset.id);
        if (!cap) return;

        btn.disabled = true;
        btn.textContent = "Wearing...";

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        chrome.tabs.sendMessage(tab.id, { action: "INJECT_CAPSULE", capsule: cap }, (res) => {
          if (res?.success) {
            showToast("Worn successfully!", "success");
            window.close();
          } else {
            showToast("Auto-wear failed — copied", "warn");
            navigator.clipboard.writeText(cap.continuePrompt).then(() => window.close());
          }
        });
      });
    });
  }

  async function openInLLM(llm, capsule) {
    const url = LLM_TARGETS[llm];
    if (!url || !capsule) return;
    await navigator.clipboard.writeText(capsule.continuePrompt);
    chrome.storage.local.set({
      pending_injection: {
        llm: llm,
        prompt: capsule.continuePrompt,
        capsule: capsule,
        timestamp: Date.now()
      }
    }, () => {
      chrome.tabs.create({ url });
      window.close();
    });
  }

  // ── SETTINGS slots UI binding ─────────────────────────────────────────────
  function bindSettings() {
    document.getElementById("btn-save-api-keys").addEventListener("click", saveAPIKeys);
    document.getElementById("btn-export-settings").addEventListener("click", exportAll);
    document.getElementById("import-file-settings").addEventListener("change", importFile);
  }

  async function renderSettings() {
    const providers = settings.providers || [];
    const curProvider = settings.activeProviderId || "prov_gemini";

    const grid = document.getElementById("provider-grid");
    if (grid) {
      grid.innerHTML = providers.map(p => {
        const isGemini = p.provider === "gemini";
        return `
        <div class="provider-card ${p.id === curProvider && !isGemini ? "provider-card-active" : ""} ${isGemini ? "provider-card-unavailable" : ""}" data-pid="${p.id}" ${isGemini ? 'data-disabled="true"' : ""}>
          <div class="provider-card-free ${isGemini ? "is-soon" : (p.provider === 'gemini' || p.provider === 'groq' || p.provider === 'openrouter' ? 'is-free' : 'is-paid')}">
            ${isGemini ? "Coming Soon" : (p.provider === 'gemini' || p.provider === 'groq' || p.provider === 'openrouter' ? "Free" : "Paid")}
          </div>
          <div class="provider-card-name">${p.label}${isGemini ? " · Under Development" : ""}</div>
          <div class="provider-card-model">${isGemini ? "Integration being redesigned" : p.model}</div>
        </div>`;
      }).join("");

      grid.querySelectorAll(".provider-card").forEach(card => {
        card.addEventListener("click", () => {
          if (card.dataset.disabled === "true") return;
          const pid = card.dataset.pid;
          grid.querySelectorAll(".provider-card").forEach(c => c.classList.remove("provider-card-active"));
          card.classList.add("provider-card-active");
          settings.activeProviderId = pid;
          chrome.runtime.sendMessage({ action: "SAVE_SETTINGS", settings });
        });
      });
    }

    const keysContainer = document.getElementById("keys-inputs-container");
    if (keysContainer) {
      const keyUrls = {
        gemini: "https://aistudio.google.com/app/apikey",
        groq: "https://console.groq.com/keys",
        openai: "https://platform.openai.com/api-keys",
        anthropic: "https://console.anthropic.com/settings/keys",
        deepseek: "https://platform.deepseek.com/api_keys",
        openrouter: "https://openrouter.ai/keys"
      };

      keysContainer.innerHTML = providers.map(p => {
        if (p.provider === "gemini") {
          return `
        <div class="key-row-wrapper" style="margin-top: 6px;">
          <div style="font-size: 10px; font-weight: 600; color: var(--text2); margin-bottom: 2px;">${p.label}</div>
          <div style="padding: 8px; background: rgba(108,99,255,0.06); border: 1px solid rgba(108,99,255,0.15); border-radius: 6px; font-size: 10px; color: var(--text3);">
            Coming Soon / Under Development
          </div>
        </div>`;
        }
        const keyUrl = keyUrls[p.provider] || "#";
        // SECURITY: never place the stored key value in the DOM (visible via Inspect/View
        // Source/DevTools). Inputs render empty; a masked placeholder communicates saved state.
        const hasKey = !!p.apiKey;
        return `
        <div class="key-row-wrapper" style="margin-top: 6px;">
          <div style="font-size: 10px; font-weight: 600; color: var(--text2); margin-bottom: 2px;">${p.label} API Key</div>
          <div class="key-row" style="position: relative; display: flex; align-items: center;">
            <input class="field api-key-input-individual" type="password" data-provider-id="${p.id}" data-has-key="${hasKey}"
              placeholder="${hasKey ? "•••••••• (saved — type to replace)" : `Paste key for ${p.label}...`}" autocomplete="off"
              value="" style="padding-right: 32px; width: 100%;" />
            <button class="eye-btn toggle-key-individual" data-provider-id="${p.id}" title="Show/hide typed key" style="position: absolute; right: 8px; background: transparent; border: none; cursor: pointer; color: var(--text3); display: flex; align-items: center; justify-content: center;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
          <div style="font-size: 9px; margin-top: 2px; text-align: left; display:flex; gap:8px; align-items:center;">
            <a href="${keyUrl}" target="_blank" style="color: var(--accent-lt); text-decoration: none;">Get API key</a>
            ${hasKey ? `<a href="#" class="clear-key-individual" data-provider-id="${p.id}" style="color: var(--text3); text-decoration: none;">Remove saved key</a>` : ""}
          </div>
        </div>`;
      }).join("");

      // Bind eye buttons
      keysContainer.querySelectorAll(".toggle-key-individual").forEach(btn => {
        btn.addEventListener("click", () => {
          const pid = btn.dataset.providerId;
          const inp = keysContainer.querySelector(`.api-key-input-individual[data-provider-id="${pid}"]`);
          if (inp) {
            inp.type = inp.type === "password" ? "text" : "password";
          }
        });
      });

      // Remove saved key — explicit action, blank field alone never clears a key.
      keysContainer.querySelectorAll(".clear-key-individual").forEach(link => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          const pid = link.dataset.providerId;
          const prov = settings.providers.find(p => p.id === pid);
          if (prov) prov.apiKey = "";
          chrome.runtime.sendMessage({ action: "SAVE_SETTINGS", settings }, () => {
            renderSettings();
          });
        });
      });
    }

    const langSel = document.getElementById("default-lang-select");
    const smartToggle = document.getElementById("smart-naming-toggle");
    if (langSel && settings.language) {
      langSel.value = settings.language === "system" ? "system" : (settings.defaultLang || settings.overrideLanguage || "");
    }
    if (smartToggle && settings.smartNaming === false) smartToggle.checked = false;

    langSel?.addEventListener("change", () => {
      const val = langSel.value;
      settings.language = val === "system" ? "system" : "override";
      settings.defaultLang = val === "system" ? "" : val;
      settings.overrideLanguage = val === "system" ? "" : val;
      chrome.runtime.sendMessage({ action: "SAVE_SETTINGS", settings });
    });
    smartToggle?.addEventListener("change", () => {
      settings.smartNaming = smartToggle.checked;
      chrome.runtime.sendMessage({ action: "SAVE_SETTINGS", settings });
    });

    bindTryModelsSettingsPopup();
  }

  function bindTryModelsSettingsPopup() {
    const slots = TryModelsRegistry.normalizeSlots(settings.tryModelSlots);
    const expandBtn = document.getElementById("btn-try-more-models");
    const slotsContainer = document.getElementById("try-models-slots");
    const saveBtn = document.getElementById("btn-save-try-models");
    if (!expandBtn || !slotsContainer) return;

    expandBtn.onclick = () => {
      slotsContainer.classList.toggle("hidden");
      saveBtn.classList.toggle("hidden");
      if (!slotsContainer.classList.contains("hidden") && !slotsContainer.innerHTML) {
        renderTryModelSlotsPopup(slotsContainer, slots);
      }
    };

    saveBtn.onclick = () => {
      settings.tryModelSlots = collectTryModelSlotsPopup(slotsContainer);
      chrome.runtime.sendMessage({ action: "SAVE_SETTINGS", settings }, () => {
        const status = document.getElementById("try-models-status");
        if (status) {
          status.className = "settings-status ok";
          status.textContent = "✓ Try Models saved!";
          setTimeout(() => status.textContent = "", 3000);
        }
      });
    };
  }

  function renderTryModelSlotsPopup(container, slots) {
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
      // SECURITY: same masked-input pattern as the Main AI Models section above.
      const isLocalSlot = slot.provider === "ollama" || slot.provider === "lmstudio";
      const hasKey = !isLocalSlot && !!slot.apiKey;
      return `
        <div class="key-row-wrapper try-slot" data-slot="${idx}" style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border);">
          <div style="font-size: 10px; font-weight: 700; color: var(--text2); margin-bottom: 4px;">Fallback Slot ${idx + 1}</div>
          <div style="font-size: 9px; color: var(--text3); margin-bottom: 2px;">Provider</div>
          <select class="field try-provider" data-slot="${idx}" style="margin-bottom: 4px; width: 100%;">
            <option value="">Select provider...</option>
            ${providerOptions}
          </select>
          <div style="font-size: 9px; color: var(--text3); margin-bottom: 2px;">Model</div>
          <select class="field try-model" data-slot="${idx}" style="margin-bottom: 4px; width: 100%;">
            ${modelOptions || '<option value="">Select provider first</option>'}
          </select>
          <div style="font-size: 9px; color: var(--text3); margin-bottom: 2px;">API Key</div>
          <input class="field try-key" type="password" data-slot="${idx}" data-has-key="${hasKey}" placeholder="${hasKey ? "•••••••• (saved — type to replace)" : "Paste API key..."}" value="" autocomplete="off" style="width: 100%;" />
          <div style="font-size: 9px; margin-top: 2px; display:flex; gap:8px; align-items:center;">
            <a class="try-key-link" data-slot="${idx}" href="${keyUrl}" target="_blank" style="color: var(--accent-lt); text-decoration: none;">Get API Key</a>
            ${hasKey ? `<a href="#" class="try-key-clear" data-slot="${idx}" style="color: var(--text3); text-decoration: none;">Remove saved key</a>` : ""}
          </div>
        </div>`;
    }).join("");

    container.querySelectorAll(".try-provider").forEach(sel => {
      sel.addEventListener("change", () => {
        const idx = sel.dataset.slot;
        const providerId = sel.value;
        const slotEl = container.querySelector(`.try-slot[data-slot="${idx}"]`);
        const modelDropdown = slotEl.querySelector(".try-model");
        const keyLink = slotEl.querySelector(".try-key-link");
        const models = providerId ? TryModelsRegistry.getModels(providerId) : [];
        modelDropdown.innerHTML = models.length
          ? models.map(m => `<option value="${m.id}">${m.label}</option>`).join("")
          : '<option value="">Select provider first</option>';
        if (models.length) modelDropdown.value = models[0].id;
        if (keyLink) keyLink.href = providerId ? TryModelsRegistry.getKeyUrl(providerId) : "#";
      });
    });

    // Remove saved key for a Try Models slot — explicit action.
    container.querySelectorAll(".try-key-clear").forEach(link => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const idx = parseInt(link.dataset.slot, 10);
        const current = TryModelsRegistry.normalizeSlots(settings.tryModelSlots);
        if (current[idx]) current[idx].apiKey = "";
        settings.tryModelSlots = current;
        chrome.runtime.sendMessage({ action: "SAVE_SETTINGS", settings }, () => {
          renderTryModelSlotsPopup(container, current);
        });
      });
    });
  }

  function collectTryModelSlotsPopup(container) {
    // SECURITY: inputs always render blank, so a blank field means "no change" and
    // must fall back to the previously saved key rather than overwrite it.
    const existing = TryModelsRegistry.normalizeSlots(settings.tryModelSlots);
    return TryModelsRegistry.normalizeSlots(
      Array.from(container.querySelectorAll(".try-slot")).map((slotEl, idx) => {
        const typed = slotEl.querySelector(".try-key")?.value.trim() || "";
        return {
          provider: slotEl.querySelector(".try-provider")?.value || "",
          model: slotEl.querySelector(".try-model")?.value || "",
          apiKey: typed || existing[idx]?.apiKey || ""
        };
      })
    );
  }

  async function saveAPIKeys() {
    const status = document.getElementById("api-key-status");
    const inputs = document.querySelectorAll(".api-key-input-individual");

    // SECURITY: a blank input never overwrites an existing saved key — see renderSettings().
    inputs.forEach(inp => {
      const pid = inp.dataset.providerId;
      const prov = settings.providers.find(p => p.id === pid);
      const typed = inp.value.trim();
      if (prov && typed) {
        prov.apiKey = typed;
      }
    });

    chrome.runtime.sendMessage({ action: "SAVE_SETTINGS", settings }, (res) => {
      if (status) {
        status.className = "settings-status ok";
        status.textContent = "✓ Saved! AI features updated.";
        setTimeout(() => status.textContent = "", 3000);
      }
    });
  }

  // ── AI TOOLS ──────────────────────────────────────────────────────────────
  function toggleAITool(tool) {
    const aiOut = document.getElementById("ai-output");
    const transOpts = document.getElementById("translate-opts");
    const chatBox = document.getElementById("chat-box");

    if (activeAITool === tool) {
      activeAITool = null;
      aiOut.classList.add("hidden");
      transOpts.classList.add("hidden");
      chatBox.classList.add("hidden");
      return;
    }

    activeAITool = tool;
    aiOut.classList.add("hidden");
    transOpts.classList.add("hidden");
    chatBox.classList.add("hidden");

    if (tool === "summarize") { aiOut.classList.remove("hidden"); runAISummarize(); }
    else if (tool === "insights") { aiOut.classList.remove("hidden"); runAIInsights(); }
    else if (tool === "translate") { transOpts.classList.remove("hidden"); }
    else if (tool === "chat") { chatBox.classList.remove("hidden"); document.getElementById("chat-input").focus(); }
  }

  function getContext() {
    return currentCapsule.continuePrompt;
  }

  function runAISummarize() {
    const out = document.getElementById("ai-output");
    out.textContent = "Summarizing"; out.classList.add("loading");
    chrome.runtime.sendMessage({
      action: "AI_SUMMARIZE",
      prompt: getContext()
    }, res => { out.classList.remove("loading"); handleAIResult(res, out); });
  }

  function runAIInsights() {
    const out = document.getElementById("ai-output");
    out.textContent = "Extracting insights"; out.classList.add("loading");
    chrome.runtime.sendMessage({
      action: "AI_INSIGHTS",
      prompt: getContext()
    }, res => { out.classList.remove("loading"); handleAIResult(res, out); });
  }

  function doTranslate() {
    const lang = document.getElementById("translate-lang").value;
    const out = document.getElementById("ai-output");
    out.textContent = `Translating to ${lang}`;
    out.classList.remove("hidden"); out.classList.add("loading");
    chrome.runtime.sendMessage({
      action: "AI_TRANSLATE",
      prompt: `Translate the following conversation to ${lang}:\n\n${getContext()}`
    }, res => { out.classList.remove("loading"); handleAIResult(res, out); });
  }

  function doChat() {
    const question = document.getElementById("chat-input").value.trim();
    if (!question || !currentCapsule) return;
    const chatResult = document.getElementById("chat-result");
    chatResult.textContent = "Thinking...";
    chrome.runtime.sendMessage({
      action: "AI_CHAT",
      prompt: question,
      system: `You are answering questions about this chat context:\n\n${getContext()}`
    }, res => {
      if (res && res.result) {
        chatResult.textContent = res.result;
      } else {
        chatResult.textContent = res?.error || "Error executing chat.";
      }
    });
  }

  function handleAIResult(res, outEl) {
    const diagnosticCard = document.getElementById("popup-diagnostic-card");
    if (res && res.result) {
      outEl.textContent = res.result;
      if (diagnosticCard) diagnosticCard.classList.add("hidden");
    } else {
      outEl.textContent = `Error: ${res?.error || "API failure"}`;
      if (res?.diagnostic && diagnosticCard) {
        diagnosticCard.classList.remove("hidden");
        document.getElementById("p-diag-title").textContent = res.diagnostic.message;
        document.getElementById("p-diag-msg").textContent = `Type: ${res.diagnostic.type}`;
        document.getElementById("p-diag-suggestion").textContent = res.diagnostic.suggestion;
      }
    }
  }

  // ── EXPORT / IMPORT ───────────────────────────────────────────────────────
  async function exportAll() {
    if (!capsules.length) return;
    const blob = new Blob([JSON.stringify({ sweater_export: true, version: "14.0", date: new Date().toISOString(), capsules }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `sweater-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  function importFile(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        const incoming = data.capsules || (Array.isArray(data) ? data : []);
        chrome.runtime.sendMessage({ action: "IMPORT_CAPSULES", capsules: incoming }, async () => {
          await loadCapsules(); renderWardrobe(); renderWear();
          setView("vault");
        });
      } catch { }
    };
    reader.readAsText(file); e.target.value = "";
  }

  // ── UTILS ─────────────────────────────────────────────────────────────────
  function fmt(n) { return n < 1000 ? `${n}c` : `${(n / 1000).toFixed(1)}k chars`; }
  function esc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function escapeHtml(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  // Custom Toast
  function showToast(text, type = "info") {
    const old = document.getElementById("popup-toast-box");
    if (old) old.remove();
    const t = document.createElement("div");
    t.id = "popup-toast-box";
    t.style.cssText = `
      position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%);
      background: ${type === "success" ? "#3ecf8e" : "#e5534b"};
      color: white; padding: 6px 12px; border-radius: 4px; font-size: 11px;
      z-index: 99999; box-shadow: 0 4px 10px rgba(0,0,0,0.3); font-family: var(--font);
    `;
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }
  // Subscribe to settings changes from content/background
  if (window.EventBus) {
    window.EventBus.subscribe("settingsChanged", (newSettings) => {
      settings = newSettings;
      const settingsView = document.getElementById("view-settings");
      if (settingsView && settingsView.classList.contains("active")) {
        renderSettings();
      }
    });
  }
})();
