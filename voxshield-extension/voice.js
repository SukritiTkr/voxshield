/**
 * VoxShield Voice Module
 * -----------------------------------------------------------------
 * Two parallel announcement channels:
 *  1. A hidden DOM node with aria-live="assertive" — the correct,
 *     spec-compliant way to interrupt NVDA/JAWS/VoiceOver.
 *  2. window.speechSynthesis — ensures audible output even when
 *     no screen reader is running (e.g. for demo recording, or
 *     sighted teammates testing).
 * -----------------------------------------------------------------
 */

const VoxShieldVoice = (() => {
  let liveRegion = null;
  let lastSpoken = "";
  let lastSpokenAt = 0;

  function ensureLiveRegion() {
    if (liveRegion && document.body.contains(liveRegion)) return liveRegion;

    liveRegion = document.createElement("div");
    liveRegion.id = "voxshield-live-region";
    liveRegion.setAttribute("aria-live", "assertive");
    liveRegion.setAttribute("role", "alert");
    // Visually hidden but accessible to assistive tech
    liveRegion.style.position = "absolute";
    liveRegion.style.width = "1px";
    liveRegion.style.height = "1px";
    liveRegion.style.overflow = "hidden";
    liveRegion.style.clip = "rect(1px, 1px, 1px, 1px)";
    liveRegion.style.whiteSpace = "nowrap";
    document.documentElement.appendChild(liveRegion);
    return liveRegion;
  }

  // ---------------------------------------------------------------
  // Priority speech queue
  // -----------------------------------------------------------------
  // Problem this solves: multiple detectors can fire within the same
  // fraction of a second (e.g. a fake-CAPTCHA warning, a blocked-iframe
  // false read, and a link-mismatch warning all in one scan pass). Naively
  // calling speechSynthesis.cancel() + speak() for each one means every
  // new message instantly cuts off the previous one mid-sentence — so a
  // user can hear three garbled fragments and miss the most important
  // word ("Warning... do not press Win—" *cut off*).
  //
  // Fix: a small in-memory queue. A "critical" message currently speaking
  // is never interrupted by a "warning"-level message — it must finish.
  // A new "critical" message DOES still preempt an in-progress "warning"
  // message, since the most dangerous case must always win. Same-priority
  // duplicates are deduped; the queue is capped so a noisy page can't
  // cause an endless droning backlog.
  // -----------------------------------------------------------------
  const queue = [];
  let speaking = false;
  let currentPriority = null;
  const MAX_QUEUE_LENGTH = 4;

  function priorityRank(p) {
    return p === "critical" ? 2 : 1;
  }

  function speakNext() {
    if (queue.length === 0) {
      speaking = false;
      currentPriority = null;
      return;
    }
    const next = queue.shift();
    speaking = true;
    currentPriority = next.priority;
    speakAloud(next.message, () => {
      // onend / onerror — move to the next queued item
      speakNext();
    });

    const region = ensureLiveRegion();
    region.textContent = "";
    requestAnimationFrame(() => {
      region.textContent = next.message;
    });

    console.log("%c[VoxShield ANNOUNCE] " + next.message, "color:#b30000;font-weight:bold;");
  }

  function enqueue(message, priority) {
    // If something of equal-or-higher priority is already speaking, and
    // this new message is NOT critical, just queue it (don't interrupt).
    // If the new message IS critical and something lower is speaking,
    // preempt immediately.
    const incomingRank = priorityRank(priority);

    if (speaking && currentPriority !== null) {
      const currentRank = priorityRank(currentPriority);
      if (incomingRank > currentRank) {
        // Critical message preempts an in-progress lower-priority one.
        queue.length = 0; // drop anything queued behind the old one
        queue.push({ message, priority });
        window.speechSynthesis.cancel(); // triggers onend/onerror -> speakNext via the cancelled utterance's handler path
        speaking = false;
        speakNext();
        return;
      }
    }

    if (queue.length >= MAX_QUEUE_LENGTH) {
      queue.shift(); // drop the oldest queued (non-urgent) item to make room
    }
    queue.push({ message, priority });

    if (!speaking) {
      speakNext();
    }
  }

  function speakAloud(text, onDone) {
    if (!("speechSynthesis" in window)) {
      if (onDone) onDone();
      return;
    }
    try {
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.0;
      utter.pitch = 1.0;
      utter.volume = 1.0;

      utter.onend = () => { if (onDone) onDone(); };
      utter.onerror = (e) => {
        const benign = e?.error === "interrupted" || e?.error === "canceled";
        if (!benign) {
          console.warn("VoxShield: speechSynthesis utterance error", e?.error || e);
        }
        if (onDone) onDone();
      };

      window.speechSynthesis.speak(utter);
    } catch (e) {
      console.warn("VoxShield: speechSynthesis failed", e);
      if (onDone) onDone();
    }
  }

  // Chrome's speechSynthesis engine has a known bug where it can silently
  // enter a stuck/paused state after a tab backgrounds, a previous
  // utterance errors, or after certain cancel() sequences — leaving every
  // future speak() call queued forever with no sound and no error thrown.
  // A periodic pause+resume kick is the standard workaround.
  function startSpeechWatchdog() {
    if (!("speechSynthesis" in window)) return;
    setInterval(() => {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      // Some Chrome versions need a resume() even when .paused reads false
      // but the queue is wedged; this is harmless to call regardless.
      if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
        window.speechSynthesis.resume();
      }
    }, 2000);
  }
  startSpeechWatchdog();

  function announce(message, { dedupeWindowMs = 1500, severity = "warning" } = {}) {
    const now = Date.now();
    if (message === lastSpoken && now - lastSpokenAt < dedupeWindowMs) {
      return; // avoid spamming the exact same warning repeatedly
    }
    lastSpoken = message;
    lastSpokenAt = now;

    enqueue(message, severity === "critical" ? "critical" : "warning");
  }

  return { announce };
})();
