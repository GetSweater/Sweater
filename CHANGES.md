# Sweater v14 — July 2026 Provider & Security Audit

This documents every change made, why, and what was verified. Nothing outside the
items below was touched — all other functionality is unchanged.

---

## 1. API Key Security Fix (Try More Models exposure)

### What was actually wrong
Both the **Main AI Models** section and the **Try More Models** section rendered the
stored API key directly into the DOM as an input's `value="..."` attribute:

```html
<input type="password" value="YOUR_API_KEY_HERE" />
```

`type="password"` only masks the *visual display* — the raw string is still sitting
in the HTML. Right-click → Inspect (or View Source, or `document.querySelector(...).value`
in the console) reveals it in plain text. This is true regardless of which section
you look at.

**Correction to the brief:** the brief described the Main AI Models section as already
using "the existing secure architecture," implying Try More Models was the outlier.
On inspection, both sections used the identical pattern and were **equally exposed**
— there was no existing secure implementation to copy. Rather than build a second,
different scheme, I designed one secure pattern and applied it consistently to
**both** sections, in both `content/content.js` and `popup/popup.js` (the two places
this UI is duplicated).

### The fix
- Inputs now always render **empty**. A placeholder (`•••••••• (saved — type to
  replace)`) communicates that a key is already stored, without ever putting the
  secret in the DOM.
- **Save** only overwrites a provider's/slot's key if the user typed something new.
  A blank field is treated as "no change" — it no longer silently blanks out a saved
  key (which the old code would have done once the raw-value prefill was removed).
- A new **"Remove saved key"** link gives an explicit, unambiguous way to clear a key
  (needed now that blank-and-save no longer does this).
- The "eye" show/hide toggle still works for whatever the user is actively typing in
  that field — that's just a local echo of their own current input, not a fetch of a
  stored secret, so it doesn't reintroduce the exposure.
- No new storage mechanism was introduced. Keys still live only in
  `chrome.storage.local` (Chrome's extension-storage API — distinct from
  `localStorage`/`sessionStorage`/IndexedDB) and are only ever read with a real
  `Authorization`/`x-api-key` header from `background/providers.js`, which runs in
  the service worker, a context page DevTools cannot inspect. That fetch path was
  already correct for both sections and was not changed.

### Verified NOT exposed to page/content-script network traffic
`shared/registry.js` has an OpenAI-key-bearing `discoverCapabilities()` function that
looked, at first glance, like it might run in the content-script (page) context, since
`registry.js` is loaded there per `manifest.json`. Traced its only caller —
`background/service_worker.js` — confirming it only ever runs in the background
service worker, never in a page's content-script context. No actual key-bearing
network request originates from a page context. Left unchanged.

### Files touched
`content/content.js`, `popup/popup.js` (rendering + save handlers for both the
Main AI Models keys and the Try More Models slot keys).

---

## 2. Cerebras Review

**Verdict: Cerebras removed as a provider.** It no longer meets the extension's own
"free, no credit card" bar, and its previously-configured models are dead.

### Findings (verified against cerebras.ai/pricing and inference-docs.cerebras.ai, July 2026)

- **Developer Tier / free-tier eligibility — this is the disqualifying change.**
  Cerebras's pricing page no longer offers a persistent no-card free tier. It now
  offers a **"Free Trial"**: *"Get started with $5 in free credits after making an
  account."* The rate-limits doc is explicit: *"New accounts receive $5 in free
  credits **after adding a verified payment method**. These credits expire 30 days
  after they're granted."* After that, it's Developer tier = pay-as-you-go.
  This directly matches the disqualifying criteria in this audit's brief: it now
  requires billing-account setup and only offers **temporary, expiring promotional
  credit**, not an ongoing free allotment.
- **PAYGO migration:** confirmed — "How do I get higher rate limits? Purchase credits
  (Pay as You Go) ... Your first purchase moves you to the Developer tier." There is
  no non-PAYGO path to sustained usage once the $5/30-day credit is gone.
- **Cache-aware rate limits:** confirmed. Cerebras is rolling out a dual-bucket model
  (separate "uncached TPM" vs. "total TPM," with cache hits not counting against the
  uncached limit). Full rollout completes **August 17, 2026**.
- **GLM 4.7 deprecation:** confirmed for **August 17, 2026**, per Cerebras's own model
  catalog docs, with no announced successor model yet.
- **GPT-OSS availability:** `openai/gpt-oss-120b` remains Cerebras's only *Production*
  (i.e., safe-for-production) model.
- **Gemma 4 availability:** `gemma-4-31b` is available, but only as a *Preview* model
  — Cerebras's own docs say preview models "may be discontinued on short notice" and
  are "intended for evaluation purposes only."
- **Model rot already in this codebase:** the extension's Cerebras entries defaulted
  to `llama-3.3-70b` and referenced `qwen-3-235b-a22b-instruct-2507` — both of which
  were **already deprecated by Cerebras on February 16, 2026**. Any user who had
  configured Cerebras with these defaults has been silently broken since February.

### Decision
Given (a) the free tier now requires a payment method for an expiring credit, (b) the
extension's configured default models are already dead, and (c) even the surviving
model lineup is thin (one production model, two preview-only/soon-deprecated models),
Cerebras does not meet this project's bar of "genuinely free, no mandatory billing,
no promotional-credit dependency, production-appropriate models." **Removed entirely**
rather than patched, per the brief's fallback option.

### Files touched
- `shared/try_models.js` — removed the `cerebras` entry from `TRY_MODEL_PROVIDERS`.
- `background/providers.js` — removed `CerebrasProvider` and its factory/export
  wiring.
- `manifest.json` — removed the `https://api.cerebras.ai/*` host permission (least
  privilege — no code references it anymore).
- `shared/settings.js` — `migrate()` now clears (not silently keeps) any previously
  saved Try Models slot that still points at `cerebras`, so no orphaned config/key
  lingers; added `MODEL_MIGRATIONS` entries in case a stale model id shows up
  elsewhere.

---

## 3. Full Provider/Model Validation

Checked every provider currently wired into the extension against its official
docs/pricing pages (July 2026).

| Provider | Free tier verdict | Action taken |
|---|---|---|
| **Groq** | Genuinely free, no card, ongoing (not a trial): 30 RPM / 6K TPM / 14,400 RPD org-wide. Confirmed stays. | **Deprecated models found and fixed** — see below. |
| **OpenRouter** | Genuinely free `:free` models, no card. 20 RPM, 50/day (or 1,000/day after a one-time non-expiring $10 top-up — optional, not required). | No change needed; catalog already current. |
| **Gemini** | Marked "Coming Soon / Under Development" in the UI already — not selectable. Left as-is (out of scope; pre-existing state, not part of this audit's problems). | No change. |
| **NVIDIA NIM** | No card required; ~1,000 free inference credits + 40 RPM. Credit-limited rather than an unlimited daily quota — flagged as a caveat, but legitimate and still meets "no mandatory billing" bar. | **Stale model id fixed** — see below. |
| **Cerebras** | Now requires a card for a 30-day expiring $5 credit; PAYGO after. | **Removed** (Section 2). |
| **Ollama / LM Studio** | Local-only, no network billing concept applies. | No change. |
| **OpenAI / Anthropic / DeepSeek** | Paid-by-design providers, already labeled "Paid" in the UI; not in scope for "free tier" validation. | No change. |

### Deprecated models found and fixed (outside of Cerebras)

- **Groq deprecated `llama-3.3-70b-versatile` and `llama-3.1-8b-instant`** (announced
  June 17, 2026), and separately **`qwen/qwen3-32b`** and
  **`meta-llama/llama-4-scout-17b-16e-instruct`**. Groq's own migration guidance
  points to `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, and `qwen/qwen3.6-27b`.
  - This extension's **default Main provider model for Groq** (`prov_groq` in
    `shared/settings.js`) and the **default `GroqProvider` model**
    (`background/providers.js`) were both set to the now-deprecated
    `llama-3.3-70b-versatile` — i.e., a brand-new install would default to a dead
    model. Fixed both to `openai/gpt-oss-120b`.
  - The Try Models Groq catalog (`shared/try_models.js`) and the capability fallback
    registry (`shared/registry.js`) listed the same deprecated ids. Updated to
    `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.6-27b`.
  - Added `MODEL_MIGRATIONS` entries so any user with one of these dead ids already
    saved gets silently migrated on next load, the same mechanism this file already
    used for older migrations.
- **NVIDIA NIM**: `nvidia/nemotron-4-340b-instruct` is a 2024-generation id and is no
  longer NVIDIA's current offering. Replaced with the current
  `nvidia/nemotron-3-super-120b-a12b` (NVIDIA Nemotron 3 Super, launched March 2026),
  confirmed against NVIDIA's own NIM API reference.

### Files touched
`background/providers.js`, `background/service_worker.js`, `shared/settings.js`,
`shared/try_models.js`, `shared/registry.js`.

---

## Summary of every file changed

| File | Why |
|---|---|
| `content/content.js` | API key DOM-exposure fix (Main + Try Models sections) |
| `popup/popup.js` | Same fix, mirrored (this UI is duplicated in the popup) |
| `shared/try_models.js` | Removed Cerebras; fixed deprecated Groq/NVIDIA model ids |
| `background/providers.js` | Removed `CerebrasProvider`; fixed deprecated default Groq model |
| `background/service_worker.js` | Fixed deprecated Groq models in provider metadata |
| `shared/settings.js` | Fixed default Groq model; added model migrations; clear stale Cerebras slots |
| `shared/registry.js` | Fixed deprecated Groq models in capability fallback table |
| `manifest.json` | Removed now-unused `api.cerebras.ai` host permission |

Nothing else was modified. Gemini's "Coming Soon" placeholder state, all UI styling,
capsule/knit functionality, keyboard shortcuts, export/import, and every other
feature are untouched.
