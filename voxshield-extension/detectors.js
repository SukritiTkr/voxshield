/**
 * VoxShield Detection Engine
 * -----------------------------------------------------------------
 * Three independent detectors, each returning a finding object:
 *   { type, severity, message, element }
 *
 * Design principle: client-side only, no network calls, no data
 * leaves the browser. Pure DOM + behavioural heuristics.
 * -----------------------------------------------------------------
 */

const VoxShieldDetectors = (() => {

  // ---- Known legitimate CAPTCHA provider domains ----
  const TRUSTED_CAPTCHA_DOMAINS = [
    "google.com", "gstatic.com", "recaptcha.net",
    "hcaptcha.com", "challenges.cloudflare.com"
  ];

  // ---- Phrases strongly associated with the fake-CAPTCHA /
  //      "verify you are human" clipboard-paste scam family ----
  const SCAM_PHRASE_PATTERNS = [
    /win(dows)?\s*\+?\s*r\b/i,
    /press\s+(the\s+)?(windows|win)\s*(key)?\s*(\+|and)\s*r/i,
    /open(ing)?\s+(the\s+)?run\s+(dialog|box|window)/i,
    /ctrl\s*\+?\s*v/i,
    /paste\s+(it|this|the\s+code|the\s+command)/i,
    /copy\s+(this|the)\s+(code|verification|command)/i,
    /verify\s+you\s+are\s+human.{0,80}(paste|run|windows)/is,
    /i\s*'?\s*m\s+not\s+a\s+robot.{0,80}(paste|run|copy)/is
  ];

  function hostnameMatchesTrusted(src) {
    try {
      const host = new URL(src, window.location.href).hostname;
      return TRUSTED_CAPTCHA_DOMAINS.some(d => host === d || host.endsWith("." + d));
    } catch {
      return false;
    }
  }

  function getVisibleText(el) {
    // innerText is visibility-aware (respects display:none, visibility:hidden)
    // in real browsers. textContent is NOT visibility-aware — it returns
    // hidden text too. We prefer innerText, and only fall back to
    // textContent when innerText is genuinely unsupported (very old or
    // non-standard environments), since callers are expected to have
    // already confirmed the element is visible via isVisible() first.
    if (typeof el.innerText === "string") return el.innerText;
    return el.textContent || "";
  }

  function isLikelyVerificationStyledBlock(el) {
    const text = getVisibleText(el).toLowerCase();
    const keywords = ["verify", "captcha", "human", "robot", "i am not a robot", "i'm not a robot", "security check"];
    return keywords.some(k => text.includes(k));
  }

  function isVisible(el) {
    if (!el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // ---------------------------------------------------------------
  // DETECTOR 1: Fake CAPTCHA block detection
  // ---------------------------------------------------------------
  function scanForFakeCaptcha(root = document) {
    const findings = [];
    const candidates = root.querySelectorAll("div, section, form, p");

    candidates.forEach(el => {
      if (!isVisible(el)) return; // never flag content the user isn't actually seeing
      if (!isLikelyVerificationStyledBlock(el)) return;

      // Does this block contain a genuine sandboxed iframe from a trusted provider?
      const iframes = el.querySelectorAll("iframe");
      const hasTrustedIframe = Array.from(iframes).some(f => hostnameMatchesTrusted(f.src || ""));

      if (hasTrustedIframe) return; // genuine CAPTCHA, skip

      // No trusted iframe backing a "verification" styled block —
      // check for scam phrase co-occurrence to raise confidence.
      const text = getVisibleText(el);
      const matchedPhrase = SCAM_PHRASE_PATTERNS.find(p => p.test(text));

      if (matchedPhrase) {
        findings.push({
          type: "fake-captcha",
          severity: "critical",
          message: "Warning. This page shows a fake human verification block. Do not press Windows plus R, and do not paste anything. This is a scam designed to install malicious software.",
          element: el
        });
      } else if (!hasTrustedIframe && iframes.length === 0) {
        // Verification-styled, no iframe at all, no phrase yet — lower confidence,
        // still worth a softer flag since legit CAPTCHAs are virtually always iframed.
        findings.push({
          type: "fake-captcha-suspect",
          severity: "warning",
          message: "Caution. This verification box does not appear to come from a recognized CAPTCHA provider. Proceed carefully.",
          element: el
        });
      }
    });

    return findings;
  }

  // ---------------------------------------------------------------
  // DETECTOR 2: Clipboard hijack behavioural monitor
  // ---------------------------------------------------------------
  function installClipboardMonitor(onHijack) {
    // Wrap the legacy execCommand path
    const originalExecCommand = document.execCommand.bind(document);
    document.execCommand = function (cmd, ...rest) {
      if (typeof cmd === "string" && cmd.toLowerCase() === "copy") {
        onHijack({
          type: "clipboard-hijack",
          severity: "critical",
          message: "Warning. This page just silently changed your clipboard contents without your permission. Do not paste anything into the Run dialog or a terminal.",
          via: "execCommand"
        });
      }
      return originalExecCommand(cmd, ...rest);
    };

    // Wrap the modern async Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = function (text) {
        onHijack({
          type: "clipboard-hijack",
          severity: "critical",
          message: "Warning. This page just silently changed your clipboard contents without your permission. Do not paste anything into the Run dialog or a terminal.",
          via: "ClipboardAPI",
          payloadPreview: typeof text === "string" ? text.slice(0, 60) : ""
        });
        return originalWriteText(text);
      };
    }

    // Also catch the 'copy' event fired programmatically without user keypress
    document.addEventListener("copy", (e) => {
      if (!e.isTrusted) {
        onHijack({
          type: "clipboard-hijack",
          severity: "critical",
          message: "Warning. An untrusted script triggered a clipboard copy on this page.",
          via: "copy-event"
        });
      }
    }, true);
  }

  // ---------------------------------------------------------------
  // DETECTOR 3: Hyperlink destination vs anchor-text audit
  // ---------------------------------------------------------------
  function extractClaimedDomain(anchorText) {
    // Look for something that resembles a domain inside the visible text
    const match = anchorText.match(/([a-z0-9-]+\.(com|in|org|net|co|gov|edu|io)(\.[a-z]{2})?)/i);
    return match ? match[1].toLowerCase() : null;
  }

  function rootDomain(hostname) {
    const parts = hostname.split(".");
    if (parts.length <= 2) return hostname;
    return parts.slice(-2).join(".");
  }

  function auditLink(anchor) {
    try {
      const text = (anchor.innerText || anchor.getAttribute("aria-label") || "").trim();
      if (!text || !anchor.href) return null;

      const claimedDomain = extractClaimedDomain(text);
      if (!claimedDomain) return null; // anchor text doesn't claim a specific domain, nothing to compare

      const actualHost = new URL(anchor.href, window.location.href).hostname.toLowerCase();
      const claimedRoot = rootDomain(claimedDomain);
      const actualRoot = rootDomain(actualHost);

      if (claimedRoot !== actualRoot) {
        return {
          type: "link-mismatch",
          severity: "warning",
          message: `Caution. This link displays the text ${claimedDomain}, but actually leads to ${actualHost}. The destination does not match what is shown.`,
          element: anchor
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  function scanLinks(root = document) {
    const findings = [];
    root.querySelectorAll("a[href]").forEach(a => {
      const finding = auditLink(a);
      if (finding) findings.push(finding);
    });
    return findings;
  }

  return {
    scanForFakeCaptcha,
    installClipboardMonitor,
    scanLinks,
    auditLink
  };
})();
