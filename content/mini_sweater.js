// Sweater v2 — Mini Sweater Floating Assistant
(function () {
  "use strict";

  // See content.js for details — this restores innerHTML on sites (like
  // chatgpt.com) that enforce Trusted Types via CSP. Harmless no-op elsewhere.
  try {
    if (window.trustedTypes && window.trustedTypes.createPolicy && !window.trustedTypes.defaultPolicy) {
      window.trustedTypes.createPolicy("default", {
        createHTML: (s) => s,
        createScript: (s) => s,
        createScriptURL: (s) => s,
      });
    }
  } catch (e) { /* non-fatal, see content.js */ }

  let selectionTrigger = null;
  let activeWidget = null;
  let currentSelectionText = "";
  let activeSession = []; // tracks [{ role: 'user'|'assistant', text }] for multi-turn chats

  // 1. Text Selection Listener
  document.addEventListener("mouseup", handleSelectionChange);
  document.addEventListener("keyup", handleSelectionChange);

  function handleSelectionChange(e) {
    // Prevent trigger if clicking inside the widget or trigger button
    if (activeWidget && activeWidget.contains(e.target)) return;
    if (selectionTrigger && selectionTrigger.contains(e.target)) return;

    const selection = window.getSelection();
    const text = selection.toString().trim();

    if (text.length > 5) {
      // Prevent trigger if selection common ancestor is inside Sweater panel, trigger, or widget
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        const element = container.nodeType === 3 ? container.parentNode : container;
        if (element.closest("#sweater-panel") || element.closest("#sweater-mini-trigger") || element.closest("#sweater-mini-widget-container")) {
          return;
        }
      }

      // Only trigger if currently selected chat belongs to a recognized specific LLM provider page
      const adapter = typeof SiteAdapterFactory !== "undefined" ? SiteAdapterFactory.getAdapter() : null;
      if (!adapter || adapter.constructor.name === "GenericTextareaAdapter" || adapter.name === "AI Chat") {
        hideTriggerButton();
        return;
      }

      currentSelectionText = text;
      showTriggerButton(e);
    } else {
      hideTriggerButton();
    }
  }

  function showTriggerButton(e) {
    if (!selectionTrigger) {
      // selectionTrigger itself is the Shadow DOM host: its layout (position/
      // size) stays in the light DOM so positioning math elsewhere keeps
      // working unchanged, while all visual styling + the icon live inside
      // an isolated shadow tree that other extensions/page CSS can't reach.
      selectionTrigger = document.createElement("div");
      selectionTrigger.id = "sweater-mini-trigger";
      selectionTrigger.title = "Open Mini Sweater";
      selectionTrigger.style.cssText = `
        all: initial;
        position: fixed;
        width: 28px;
        height: 28px;
        z-index: 2147483646;
      `;
      document.body.appendChild(selectionTrigger);

      const triggerShadow = selectionTrigger.attachShadow({ mode: "open" });
      const triggerStyle = document.createElement("style");
      triggerStyle.textContent = `
        :host { all: initial; }
        .sw-trigger-btn {
          width: 28px;
          height: 28px;
          background: #6c63ff;
          color: white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          font-size: 14px;
          user-select: none;
          transition: transform 0.15s ease;
        }
        .sw-trigger-btn:hover { transform: scale(1.15); }
      `;
      triggerShadow.appendChild(triggerStyle);

      const triggerBtn = document.createElement("div");
      triggerBtn.className = "sw-trigger-btn";
      triggerBtn.textContent = "🧶";
      triggerBtn.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        openMiniSweater();
        hideTriggerButton();
      });
      triggerShadow.appendChild(triggerBtn);
    }

    // Position trigger near cursor or selection bounds
    const rects = window.getSelection().getRangeAt(0).getBoundingClientRect();
    const x = Math.min(window.innerWidth - 35, rects.right + 5);
    const y = Math.min(window.innerHeight - 35, rects.bottom + window.scrollY + 5);

    selectionTrigger.style.left = `${x}px`;
    selectionTrigger.style.top = `${y}px`;
    selectionTrigger.style.display = "flex";
  }

  function hideTriggerButton() {
    if (selectionTrigger) {
      selectionTrigger.style.display = "none";
    }
  }

  // 2. Open Mini Sweater Widget
  async function openMiniSweater() {
    if (activeWidget) {
      // Re-use and set selection context
      setContextText(currentSelectionText);
      return;
    }

    // Load active settings to populate model selectors
    const res = await new Promise(r => chrome.runtime.sendMessage({ action: "GET_SETTINGS" }, r));
    const settings = res?.settings || {};
    const configuredProviders = (settings.providers || []).filter(p => p.apiKey && p.provider !== "gemini");
    const tryModelProviders = typeof TryModelsRegistry !== "undefined"
      ? TryModelsRegistry.toMiniSweaterProviders(settings)
      : [];
    const allProviders = [...configuredProviders, ...tryModelProviders];

    // Create wrapper node
    activeWidget = document.createElement("div");
    activeWidget.id = "sweater-mini-widget-container";
    activeWidget.style.cssText = `
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 490px;
      height: 520px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
    `;
    document.body.appendChild(activeWidget);

    // Create Isolated Shadow DOM
    const shadow = activeWidget.attachShadow({ mode: "open" });

    // Styles for Shadow DOM
    const styleEl = document.createElement("style");
    styleEl.textContent = `
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        background: #0d0f14;
        border: 1px solid #252b3b;
        border-radius: 12px;
        box-shadow: 0 20px 50px rgba(0,0,0,0.6);
        color: #dde1ed;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        overflow: hidden;
        user-select: text;
      }
      
      /* Header styles */
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: #13161e;
        border-bottom: 1px solid #252b3b;
        cursor: move;
        flex-shrink: 0;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 700;
        font-size: 13px;
        letter-spacing: -0.3px;
      }
      .model-select {
        background: #191d27;
        color: #dde1ed;
        border: 1px solid #252b3b;
        border-radius: 4px;
        font-size: 11px;
        padding: 3px 6px;
        outline: none;
        max-width: 160px;
      }
      .close-btn {
        background: none;
        border: none;
        color: #4a5368;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        padding: 0 4px;
      }
      .close-btn:hover { color: #e5534b; }

      /* App Workspace Layout */
      .workspace {
        display: flex;
        flex: 1;
        overflow: hidden;
      }
      
      /* Sidebar styles */
      .sidebar {
        width: 160px;
        background: #13161e;
        border-right: 1px solid #252b3b;
        overflow-y: auto;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex-shrink: 0;
      }
      .group-title {
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.8px;
        color: #4a5368;
        text-transform: uppercase;
        margin: 6px 0 2px 4px;
      }
      .plugin-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        background: none;
        border: 1px solid transparent;
        color: #8892aa;
        text-align: left;
        padding: 5px 8px;
        font-size: 11px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.1s ease;
      }
      .plugin-btn:hover {
        background: #191d27;
        color: #dde1ed;
      }

      /* Chat / Output Body Workspace */
      .chat-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        background: #0d0f14;
        overflow: hidden;
      }
      .session-log {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .message {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-width: 90%;
      }
      .message.user {
        align-self: flex-end;
      }
      .message.assistant {
        align-self: flex-start;
      }
      .bubble {
        padding: 8px 12px;
        border-radius: 8px;
        font-size: 11.5px;
        line-height: 1.55;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .message.user .bubble {
        background: #6c63ff;
        color: white;
        border-bottom-right-radius: 2px;
      }
      .message.assistant .bubble {
        background: #191d27;
        color: #dde1ed;
        border-bottom-left-radius: 2px;
        border: 1px solid #252b3b;
      }
      .sender-lbl {
        font-size: 8px;
        font-weight: 700;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        color: #4a5368;
      }
      .message.user .sender-lbl { align-self: flex-end; }
      
      /* Input controls */
      .composer {
        padding: 8px 12px;
        background: #13161e;
        border-top: 1px solid #252b3b;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .text-context-summary {
        font-size: 10px;
        color: #4a5368;
        background: #0d0f14;
        padding: 4px 6px;
        border-radius: 3px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .composer-row {
        display: flex;
        gap: 6px;
      }
      .input-box {
        flex: 1;
        background: #191d27;
        border: 1px solid #252b3b;
        border-radius: 4px;
        color: #dde1ed;
        padding: 6px 10px;
        font-size: 11.5px;
        outline: none;
        resize: none;
        height: 20px;
      }
      .input-box:focus { border-color: #6c63ff; }
      .send-btn {
        background: #6c63ff;
        color: white;
        border: none;
        border-radius: 4px;
        padding: 0 12px;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .send-btn:hover { background: #9b94ff; }
      .actions-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 12px 8px;
        background: #13161e;
        font-size: 10px;
      }
      .secondary-btn {
        background: none;
        border: 1px solid #252b3b;
        color: #8892aa;
        padding: 3px 8px;
        border-radius: 3px;
        cursor: pointer;
      }
      .secondary-btn:hover { color: #dde1ed; border-color: #4a5368; }

      .system-notice {
        padding: 12px;
        text-align: center;
        color: #8892aa;
        font-size: 11px;
      }
    `;
    shadow.appendChild(styleEl);

    // Create Main Body HTML
    const content = document.createElement("div");
    content.style.cssText = "display:flex; flex-direction:column; width:100%; height:100%;";
    content.innerHTML = `
      <div class="header">
        <div class="brand">🧶 Mini Sweater</div>
        <div style="display:flex; gap:8px; align-items:center;">
          <select class="model-select" id="mini-model-select">
            ${allProviders.length > 0
              ? allProviders.map(p => `<option value="${p.id}" ${p.id === settings.activeProviderId ? "selected" : ""}>${p.label}</option>`).join("")
              : `<option value="">No Active API Key</option>`
            }
          </select>
          <button class="close-btn" id="mini-close">&times;</button>
        </div>
      </div>
      <div class="workspace">
        <div class="sidebar" id="mini-sidebar">
          <!-- Populated from plugins registry -->
        </div>
        <div class="chat-area">
          <div class="session-log" id="mini-session-log">
            <div class="system-notice">
              Mini Sweater Session Started. Highlight text and select a tool on the left to begin.
            </div>
          </div>
          <div class="composer">
            <div class="text-context-summary" id="mini-context-summary">
              Selection: "${currentSelectionText.slice(0, 80)}${currentSelectionText.length > 80 ? "..." : ""}"
            </div>
            <div class="composer-row">
              <textarea class="input-box" id="mini-input" placeholder="Ask a follow-up about this context..."></textarea>
              <button class="send-btn" id="mini-send">Send</button>
            </div>
          </div>
          <div class="actions-bar">
            <button class="secondary-btn" id="mini-copy">Copy Last Answer</button>
            <button class="secondary-btn" id="mini-clear">Clear Chat</button>
          </div>
        </div>
      </div>
    `;
    shadow.appendChild(content);

    // Populate Plugins List
    const sidebar = shadow.getElementById("mini-sidebar");
    const pluginsByGroup = {};
    window.MiniSweaterPlugins.forEach(p => {
      if (!pluginsByGroup[p.group]) pluginsByGroup[p.group] = [];
      pluginsByGroup[p.group].push(p);
    });

    Object.entries(pluginsByGroup).forEach(([group, list]) => {
      const gTitle = document.createElement("div");
      gTitle.className = "group-title";
      gTitle.textContent = group;
      sidebar.appendChild(gTitle);

      list.forEach(p => {
        const btn = document.createElement("button");
        btn.className = "plugin-btn";
        btn.innerHTML = `<span>${p.icon}</span> <span>${p.name}</span>`;
        btn.addEventListener("click", () => executePlugin(p));
        sidebar.appendChild(btn);
      });
    });

    // Make window draggable
    makeDraggable(content.querySelector(".header"), activeWidget);

    // Event Listeners
    shadow.getElementById("mini-close").onclick = closeMiniSweater;
    shadow.getElementById("mini-clear").onclick = clearSession;
    shadow.getElementById("mini-copy").onclick = copyLastResponse;
    shadow.getElementById("mini-send").onclick = handleComposerSend;
    shadow.getElementById("mini-input").onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleComposerSend();
      }
    };
  }

  function setContextText(text) {
    if (!activeWidget) return;
    currentSelectionText = text;
    const summary = activeWidget.shadowRoot.getElementById("mini-context-summary");
    if (summary) {
      summary.textContent = `Selection: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`;
    }
  }

  function closeMiniSweater() {
    if (activeWidget) {
      activeWidget.remove();
      activeWidget = null;
      activeSession = [];
    }
  }

  function clearSession() {
    activeSession = [];
    const log = activeWidget.shadowRoot.getElementById("mini-session-log");
    log.innerHTML = `<div class="system-notice">Session cleared. Pick a plugin or ask a question.</div>`;
  }

  async function copyLastResponse() {
    const assistantMessages = activeSession.filter(m => m.role === "assistant");
    if (assistantMessages.length === 0) return;
    const last = assistantMessages[assistantMessages.length - 1];
    await navigator.clipboard.writeText(last.text);

    // Show brief copy notice
    const copyBtn = activeWidget.shadowRoot.getElementById("mini-copy");
    const originalText = copyBtn.textContent;
    copyBtn.textContent = "Copied! ✓";
    setTimeout(() => { copyBtn.textContent = originalText; }, 1200);
  }

  // Draggable logic helper
  function makeDraggable(header, container) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    header.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
      e = e || window.event;
      // Do not drag if clicking input or selectors
      if (e.target.closest("select") || e.target.closest("button")) return;
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      e = e || window.event;
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      container.style.top = (container.offsetTop - pos2) + "px";
      container.style.left = (container.offsetLeft - pos1) + "px";
      // Clear translation offsets from initial center centering
      container.style.transform = "none";
    }

    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }

  // Execute Plugin action
  async function executePlugin(plugin) {
    if (!currentSelectionText) return;
    const log = activeWidget.shadowRoot.getElementById("mini-session-log");

    // Remove system notice
    const notice = log.querySelector(".system-notice");
    if (notice) notice.remove();

    // 1. Add user message
    const userPrompt = plugin.prompt.replace("{text}", currentSelectionText);
    appendMessage("user", `${plugin.icon} ${plugin.name} on selected text`);
    activeSession.push({ role: "user", text: userPrompt });

    // 2. Add loader response bubble
    const loaderId = appendMessage("assistant", "Thinking...");

    // 3. Make background AI call
    const modelSelect = activeWidget.shadowRoot.getElementById("mini-model-select");
    const customProviderId = modelSelect.value;

    chrome.runtime.sendMessage({
      action: "AI_PLUGIN",
      prompt: userPrompt,
      customProviderId: customProviderId,
      temperature: 0.7,
      maxTokens: 1200
    }, (res) => {
      const bubble = activeWidget.shadowRoot.getElementById(loaderId);
      if (res && res.result) {
        bubble.querySelector(".bubble").textContent = res.result;
        activeSession.push({ role: "assistant", text: res.result });
      } else {
        const errorMsg = res?.error || "Error executing request. Verify provider configured key.";
        bubble.querySelector(".bubble").textContent = `Error: ${errorMsg}`;
        bubble.querySelector(".bubble").style.color = "#e5534b";
      }
      log.scrollTop = log.scrollHeight;
    });
  }

  // Execute Composer input send (multi-turn follow-up)
  async function handleComposerSend() {
    const input = activeWidget.shadowRoot.getElementById("mini-input");
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    const log = activeWidget.shadowRoot.getElementById("mini-session-log");
    const notice = log.querySelector(".system-notice");
    if (notice) notice.remove();

    // 1. Append user follow up message
    appendMessage("user", text);

    // Build context prompt containing previous history + selection context
    let contextPrompt = `Context Text:\n"""\n${currentSelectionText}\n"""\n\n`;
    activeSession.forEach(msg => {
      contextPrompt += `${msg.role === "user" ? "Human" : "Assistant"}: ${msg.text}\n\n`;
    });
    contextPrompt += `Human: ${text}\n\nAssistant:`;

    activeSession.push({ role: "user", text: text });

    // 2. Append thinking bubble
    const loaderId = appendMessage("assistant", "Thinking...");

    // 3. Query AI
    const modelSelect = activeWidget.shadowRoot.getElementById("mini-model-select");
    const customProviderId = modelSelect.value;

    chrome.runtime.sendMessage({
      action: "AI_PLUGIN",
      prompt: contextPrompt,
      customProviderId: customProviderId,
      temperature: 0.7,
      maxTokens: 1000
    }, (res) => {
      const bubble = activeWidget.shadowRoot.getElementById(loaderId);
      if (res && res.result) {
        bubble.querySelector(".bubble").textContent = res.result;
        activeSession.push({ role: "assistant", text: res.result });
      } else {
        const errorMsg = res?.error || "Error executing request. Verify provider credentials.";
        bubble.querySelector(".bubble").textContent = `Error: ${errorMsg}`;
        bubble.querySelector(".bubble").style.color = "#e5534b";
      }
      log.scrollTop = log.scrollHeight;
    });
  }

  // Log Message Appender
  function appendMessage(role, text) {
    const log = activeWidget.shadowRoot.getElementById("mini-session-log");
    const id = `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const el = document.createElement("div");
    el.id = id;
    el.className = `message ${role}`;
    el.innerHTML = `
      <div class="sender-lbl">${role === "user" ? "You" : "Assistant"}</div>
      <div class="bubble">${escapeHtml(text)}</div>
    `;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return id;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Expose the existing open routine so other entry points (e.g. the
  // right-click context menu handler in content.js) can trigger the same
  // Mini Sweater popup used by the selection trigger button, with no
  // changes to its internal logic.
  window.SweaterMiniSweater = { open: openMiniSweater };

})();
