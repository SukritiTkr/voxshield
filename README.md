# VoxShield

**An Accessible, AI Assisted Browser Defense Against Phishing, Fake CAPTCHAs & Clipboard Hijacking Scams for Visually Impaired Users**

Bharat Academix CodeQuest 2026 - Round 2 Prototype Submission
Team: Sukriti Thakur

---

## 1. Problem Statement

India has an estimated 4.95 crore (49.5 million) visually impaired individuals who navigate the web using screen readers such as NVDA and JAWS. Cybersecurity tooling almost universally assumes a sighted user who can visually spot a fake padlock icon, a misspelled domain or an off looking CAPTCHA box. None of these visual cues exist for a screen reader user.

Fake CAPTCHA clipboard hijacking scams have escalated sharply through 2025–2026. The attack pattern:

1. A fraudulent "verification" overlay appears, mimicking a real CAPTCHA.
2. The victim is instructed to press **Windows + R** (opening the Run dialog) and paste clipboard contents.
3. Unknown to the victim, the page has already silently overwritten their clipboard via `document.execCommand('copy')` or the Clipboard API with an obfuscated malicious command.
4. Pasting and pressing Enter executes that command, installing an information-stealer.

For a screen reader user, the screen reader simply reads attacker-written instructions in the same neutral tone it uses for legitimate content — there is no visual inconsistency to notice, because there is no visual channel being used at all.

## 2. What VoxShield Does

VoxShield is a lightweight Chrome browser extension that adds an **audio-first security layer** on top of any webpage. It runs three independent, client-side detectors and announces findings audibly and immediately — both via screen-reader-compatible ARIA live regions and via browser speech synthesis as a fallback.

### Detector 1 — Fake CAPTCHA Detection
Distinguishes genuine CAPTCHA embeds (sandboxed `<iframe>` served from a verified provider domain — Google/reCAPTCHA, hCaptcha, Cloudflare Turnstile) from fake, plain-HTML "verification" blocks. Cross-references nearby text for known scam phrasing (e.g. Run-dialog / paste instructions).

### Detector 2 — Clipboard Hijack Monitor
Monkey-patches `document.execCommand('copy')` and `navigator.clipboard.writeText` to detect unsolicited, script-triggered clipboard writes — the near-universal fingerprint of this scam family — and announces a warning the instant it happens, before the user has a chance to paste anything.

### Detector 3 — Hyperlink Destination Audit
For every link on the page, compares the visible anchor text against the actual `href` destination. If a link's text implies one domain but the real destination is different, VoxShield announces the mismatch before the user activates the link — the audio equivalent of a sighted user checking the browser's status-bar URL preview.

### Voice Layer
Every finding is announced through two parallel channels:
- A hidden DOM node with `aria-live="assertive"` — the W3C ARIA mechanism that tells screen readers (NVDA, JAWS, VoiceOver) to interrupt and announce immediately.
- `window.speechSynthesis` as a fallback, so warnings are audible even without a screen reader running (useful for sighted testers, developers, or assistive setups that don't expose ARIA live regions reliably).

Findings are queued by priority: a **critical** finding (e.g. an active clipboard hijack) always finishes speaking without being cut off by a lower-priority caution; multiple lower-priority findings in a single scan are folded into a short summary rather than read out individually, avoiding announcement spam on pages with several minor flags.

## 3. Why This Is Different

- **Audio-first by design**, not a visual security tool with screen-reader support bolted on afterward.
- **Targets a current, specific, and rapidly growing attack** (clipboard-hijacking fake CAPTCHAs), not generic phishing.
- **Intervenes before the harmful action** (pasting and executing), the only point at which intervention can actually prevent malware installation.
- **100% client-side.** No network calls, no telemetry, no data collection. All detection logic runs locally in the browser.

## 4. Technology Stack

| Layer | Technology |
|---|---|
| Extension platform | Chrome Extension, Manifest V3 |
| Detection logic | Vanilla JavaScript (DOM inspection, regex pattern matching, behavioural API monitoring) |
| Accessibility integration | W3C ARIA Live Regions (`aria-live="assertive"`, `role="alert"`) |
| Audio fallback | Web Speech API (`SpeechSynthesisUtterance`) |
| Persistence | `chrome.storage.local` (threat log, local only) |
| UI | HTML/CSS popup (toolbar icon) |

No backend, no external API calls, no build step — plain JS/HTML/JSON, runnable directly via Chrome's "Load unpacked" developer mode.

## 5. System Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      Web Page (any site)                 │
│                                                          │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐ │
│   │ DOM Scanner  │   │  Clipboard   │   │  Link Audit  │ │
│   │ (fake CAPTCHA│   │   Monitor    │   │  (href vs.   │ │
│   │  detection)  │   │ (hijack det.)│   │ anchor text) │ │
│   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘ │
│          │                  │                   │        │
│          └──────────────────┼───────────────────┘        │
│                             ▼                            │
│                   content.js (orchestrator)              │
│                             │                            │
│                             ▼                            │
│                    voice.js (priority queue)             │
│                    ┌────────┴────────┐                   │
│                    ▼                 ▼                   │
│            aria-live region   speechSynthesis            │
│            (screen readers)   (audio fallback)           │
└──────────────────────────────────────────────────────────┘
                             │
                             ▼
                    background.js (service worker)
                    chrome.storage.local (threat log)
                             │
                             ▼
                      popup.html (toolbar UI)
```

## 6. Repository Structure

```
voxshield-extension/
├── manifest.json       # Chrome extension manifest (MV3)
├── detectors.js        # Core detection engine (3 detectors)
├── voice.js             # ARIA live region + speech synthesis + priority queue
├── content.js           # Orchestrates detectors on page load / mutation / events
├── background.js        # Service worker — threat log persistence
├── popup.html / popup.js # Toolbar popup UI
└── icons/                # Extension icons
```

## 7. Installation (for evaluators)

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `voxshield-extension` folder.
5. Browse normally — VoxShield runs automatically on every page.
6. To see a guided demonstration of all three detectors, open `demo-site/test-harness.html` from this repository in Chrome. This is a controlled, safe test page that recreates the visual/DOM patterns of the real scam (without executing any real harmful command) so each detector can be triggered and observed directly.

## 8. Feasibility & Current Scope

This prototype implements working, testable versions of all three core detectors described in the Round 1 proposal. Detection runs entirely in the browser with no server dependency, making it lightweight and privacy-preserving by construction.

**Current scope (prototype/MVP stage):**
- Heuristic, rule-based detection (regex + DOM structure checks) rather than a trained ML classifier. This keeps the MVP fast, transparent, and explainable, and avoids the need for labelled training data or server-side inference within the hackathon timeline.
- Tested against a controlled simulation harness rather than live in-the-wild scam pages, for safety.

**Planned next steps (post-MVP roadmap):**
- Optional cloud-assisted classification layer (e.g. an LLM call to assess ambiguous, borderline pages) for cases the heuristics are unsure about, while keeping the default fast path fully local.
- Expand the trusted-CAPTCHA-provider list and scam-phrase corpus based on real-world telemetry (opt-in, anonymized).
- NVDA/JAWS-specific QA pass with real assistive-technology users.
- Chrome Web Store packaging and listing.
- Firefox/Edge portability (the detection logic is vanilla JS and largely portable; only the manifest and a few Chrome-specific APIs would need adaptation).

## 9. Impact

Targets a population — screen reader users — that is simultaneously highly exposed to this scam family (no visual cues to rely on) and almost entirely unserved by existing security tooling, which is built visual-first. The approach is inexpensive to run (no server costs), preserves user privacy (no data leaves the browser), and is portable to any Chromium-based browser.
