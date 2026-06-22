// VoxShield Background Service Worker
// Tracks a running count of threats blocked, shown in the popup.

let threatLog = [];

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "VOXSHIELD_FINDING") {
    threatLog.unshift({ ...msg.payload, tabId: sender.tab?.id, time: Date.now() });
    threatLog = threatLog.slice(0, 50); // keep last 50
    try {
      chrome.storage?.local?.set({ voxshieldThreatLog: threatLog });
    } catch (e) {
      console.warn("VoxShield: storage.set failed", e);
    }
  }
});

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.storage?.local?.set({ voxshieldThreatLog: [] });
  } catch (e) {
    console.warn("VoxShield: storage init failed", e);
  }
});
