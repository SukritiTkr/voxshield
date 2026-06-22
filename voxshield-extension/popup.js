chrome.storage.local.get("voxshieldThreatLog", ({ voxshieldThreatLog }) => {
  const log = voxshieldThreatLog || [];
  const list = document.getElementById("log");
  const emptyMsg = document.getElementById("empty-msg");

  if (log.length === 0) {
    emptyMsg.style.display = "block";
    return;
  }
  emptyMsg.style.display = "none";

  log.forEach(item => {
    const li = document.createElement("li");
    li.className = item.severity === "warning" ? "warning" : "";
    li.textContent = item.message;
    list.appendChild(li);
  });
});
