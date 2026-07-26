# 🧶 Sweater — AI Context Transfer & Intelligence Platform MVP - A Browser Extension no installation directly install and open developer mode and make it pack unload and sweater is ready to use

**Carry your conversation from one AI to another — without losing the thread.**

Sweater is a Chrome extension (Manifest V3) that captures the context of an AI chat, compresses and enriches it, and lets you "wear" it into a different AI — ChatGPT, Claude, Gemini, Grok, Perplexity, Groq, and more — so you never have to re-explain yourself.

---

## ✨ Features

### 🧵 Knit — Capture & Compress
- One-click capture of the current AI conversation into a portable **capsule**.
- **Smart Compress**: multiple compression modes (Clean Chat, Transcript, AI Smart Memory) to cut token usage while preserving intent.
- Context Quality Score and auto-detected conversation domain/tags.
- Smart Save Checkpoints — extract durable state (goals, decisions, open items) instead of raw transcript.

### 🤖 AI Tools
- **Summary**, **Insights**, **Translate** (11+ languages), and **Ask AI** — run directly on the captured context.
- Bring your own key via **multiple provider integrations** (OpenAI, Anthropic, Gemini, Groq, DeepSeek, Mistral, OpenRouter, NVIDIA NIM, local Ollama/LM Studio, and more).
- **Try More Models** — test additional providers/models without changing your primary configuration.

### 👕 Wardrobe & Wear
- **Wardrobe**: your saved capsule library — tag, search, edit, duplicate, and manage every captured context.
- **Wear**: inject a saved capsule straight into any supported AI's input box (or attach as a file) to resume the conversation instantly.

### 🧶 Mini Sweater (in-page)
- Select any text on a supported AI site and launch **Mini Sweater** — a floating, assistant scoped to just that selection.
- Run quick actions (Explain, Summarize, Rewrite, Fix Grammar, Change Tone, Review Code, and more) or have a follow-up conversation about the selected text, without leaving the page.

### ⚙️ Settings
- Manage API keys per provider, set a default translation language, toggle Smart Save/Smart Naming, and configure Try More Models slots.
- Export/import your full capsule library as backup.

---

## 🖥️ Two Ways to Use It

| Surface | Where | Best for |
|---|---|---|
| **Sticky Sweater** | Floating panel injected on supported AI chat pages | Full workflow — capture, compress, AI tools, wardrobe, wear, in context |
| **Toolbar Popup** | Click the extension icon | Same core feature set, quick access from anywhere |

---

## 🌐 Supported Platforms

ChatGPT, Claude, Gemini, Grok (x.com/grok.com), Copilot, Perplexity, Poe, Character.AI, Hugging Face, Mistral, Phind, You.com — plus direct API access to OpenAI, Anthropic, Groq, DeepSeek, Google Generative Language, OpenRouter, NVIDIA NIM, and local models via Ollama / LM Studio.

---

## 🚀 Installation (Developer Mode)

Sweater is not on the Chrome Web Store — install it manually from source:

1. **Download** the latest release ZIP from this repository (see [Releases](../../releases) or the green **Code → Download ZIP** button).
2. **Unzip** it to a folder on your machine.
3. Open Chrome (or any Chromium browser) and go to `chrome://extensions`.
4. Toggle **Developer mode** on (top-right corner).
5. Click **Load unpacked** and select the unzipped Sweater folder.
6. Pin the Sweater icon to your toolbar for quick access.
7. Open **Settings** in the extension and add your API key(s) for the providers you want to use.

> Updates: re-download the ZIP, remove the old unpacked extension (or overwrite the folder), and click the refresh icon on `chrome://extensions`.

---

## 🔐 Privacy & Data

- API keys and capsules are stored locally via `chrome.storage` — Sweater does not run its own backend or collect your conversations.
- AI provider calls are made directly from your browser to the provider you configure, using your own key.

---

## 🛠️ Tech Stack

- Manifest V3 Chrome Extension
- Vanilla JS content scripts + Shadow DOM isolation (Sticky Sweater / Mini Sweater UI)
- Service-worker background with a provider-agnostic AI job queue
- Shared modules for settings, state, prompts, and storage used across the popup and in-page panel

---

## 📄 License

MIT — see [LICENSE](./LICENSE).
