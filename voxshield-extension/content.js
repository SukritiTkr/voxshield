/**
 * VoxShield Content Script
 * -----------------------------------------------------------------
 * Orchestrates the detectors on:
 *   - initial page load
 *   - DOM mutations (scammers often inject the fake overlay late,
 *     or after a delay, to evade simple on-load scanners)
 *   - link focus/hover (real-time audit before the user activates it)
 *   - clipboard hijack attempts (instant, via monkey-patched APIs)
 * -----------------------------------------------------------------
 */

(function VoxShieldMain() {
  // Maps element -> Set of finding "type" strings already announced for it.
  // This lets a *different* finding type (e.g. critical "fake-captcha" after
  // an earlier softer "fake-captcha-suspect") still get through, while still
  // preventing the exact same finding from re-announcing on every mutation.
  const reportedTypesByElement = new WeakMap();
  const reportedLinkPairs = new Set();

  function handleFinding(finding) {
    if (finding.element) {
      let seenTypes = reportedTypesByElement.get(finding.element);
      if (!seenTypes) {
        seenTypes = new Set();
        reportedTypesByElement.set(finding.element, seenTypes);
      }
      if (seenTypes.has(finding.type)) return null; // already announced for this element
      seenTypes.add(finding.type);
    }
    chrome.runtime?.sendMessage?.({
      type: "VOXSHIELD_FINDING",
      payload: { type: finding.type, severity: finding.severity, message: finding.message, url: location.href }
    });
    return finding;
  }

  // Speaks at most one message per scan batch immediately (the most severe
  // one), and folds any remaining findings from the same batch into a brief
  // follow-up summary instead of speaking every individual message back to
  // back. This avoids the "spams everything on load" experience when a page
  // has multiple issues that are all detected within the same scan pass.
  function announceBatch(findings) {
    const valid = findings.filter(Boolean);
    if (valid.length === 0) return;

    valid.sort((a, b) => (a.severity === "critical" ? -1 : 0) - (b.severity === "critical" ? -1 : 0));

    const [primary, ...rest] = valid;
    VoxShieldVoice.announce(primary.message, { severity: primary.severity });

    if (rest.length > 0) {
      const summary = `VoxShield also found ${rest.length} more issue${rest.length > 1 ? "s" : ""} on this page. Open the VoxShield panel for details.`;
      VoxShieldVoice.announce(summary, { severity: "warning" });
    }
  }

  function runFullScan() {
    const batch = [];

    VoxShieldDetectors.scanForFakeCaptcha().forEach(f => {
      const result = handleFinding(f);
      if (result) batch.push(result);
    });

    VoxShieldDetectors.scanLinks().forEach(f => {
      const key = f.element?.href || f.message;
      if (reportedLinkPairs.has(key)) return;
      reportedLinkPairs.add(key);
      const result = handleFinding(f);
      if (result) batch.push(result);
    });

    announceBatch(batch);
  }

  // ---- Initial scan ----
  runFullScan();

  // ---- Re-scan on DOM mutation (lightly debounced for performance only) ----
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runFullScan, 80);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // ---- Immediate scan on click/keydown — catches scam reveals (e.g. a
  //      "Verify" button exposing scam instructions) faster than waiting
  //      for the mutation debounce window, since clicks are the moment
  //      that matters most in a live scam scenario. ----
  document.addEventListener("click", () => setTimeout(runFullScan, 0), true);

  // ---- Real-time per-link audit on focus/hover (keyboard + mouse users) ----
  function auditSingle(anchor) {
    const finding = VoxShieldDetectors.auditLink(anchor);
    if (!finding) return;
    const result = handleFinding(finding);
    if (result) VoxShieldVoice.announce(result.message, { severity: result.severity });
  }
  document.addEventListener("focusin", (e) => {
    if (e.target.tagName === "A") auditSingle(e.target);
  });
  document.addEventListener("mouseover", (e) => {
    const a = e.target.closest("a[href]");
    if (a) auditSingle(a);
  });

  // ---- Clipboard hijack monitor (instant trigger, always speaks immediately
  //      since this is the most time-critical detection of all) ----
  VoxShieldDetectors.installClipboardMonitor((finding) => {
    const result = handleFinding(finding);
    if (result) VoxShieldVoice.announce(result.message, { severity: result.severity });
  });

  console.log("%c[VoxShield] Protection active on this page.", "color:#0a7a0a;font-weight:bold;");
})();
