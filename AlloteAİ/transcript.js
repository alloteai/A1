/* =========================================================
   ALLOTE AI — TRANSKRİPT MÜHƏRRİKİ
   Söhbətləri notepad (.txt) formatında ya avtomatik fayla yazır
   (File System Access API dəstəklənən brauzerlərdə: Chrome/Edge),
   ya da manual endirmə düyməsi ilə .txt kimi ixrac edir.
   ========================================================= */

(() => {
  "use strict";

  const IDB_NAME = "allote_fs_db";
  const IDB_STORE = "handles";
  const IDB_KEY = "transcriptHandle";

  const supportsFSAccess = typeof window.showSaveFilePicker === "function";

  let fileHandle = null;      // aktiv, icazəli handle
  let pendingHandle = null;   // icazə gözləyən handle (səhifə yenilənəndən sonra)
  let lastWrittenConvId = null;

  /* ---------------- INDEXEDDB (handle-i saxlamaq üçün) ---------------- */
  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSet(key, val) {
    try {
      const db = await idbOpen();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {}
  }
  async function idbGet(key) {
    try {
      const db = await idbOpen();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (_) { return null; }
  }
  async function idbDelete(key) {
    try {
      const db = await idbOpen();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {}
  }

  /* ---------------- FORMATTING ---------------- */
  function stamp(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString("az-AZ") + " " + d.toLocaleTimeString("az-AZ", { hour: "2-digit", minute: "2-digit" });
  }
  function formatExchange(convTitle, userText, aiText, isNewConv) {
    let out = "";
    if (isNewConv) {
      out += `\n──────────────────────────────\n`;
      out += `SÖHBƏT: ${convTitle}\n`;
      out += `──────────────────────────────\n`;
    }
    out += `[${stamp(Date.now())}] Sən:\n${userText}\n\n`;
    out += `[${stamp(Date.now())}] Allote AI:\n${aiText}\n\n`;
    return out;
  }
  function formatFullConversation(conv) {
    let out = `================================\n`;
    out += `Allote AI — Söhbət qeydi\n`;
    out += `Başlıq: ${conv.title}\n`;
    out += `Tarix: ${stamp(conv.updatedAt || Date.now())}\n`;
    out += `================================\n\n`;
    conv.messages.forEach(m => {
      out += `${m.role === "user" ? "Sən" : "Allote AI"}:\n${m.content}\n\n`;
    });
    return out;
  }
  function formatAllConversations(conversations) {
    let out = `================================\n`;
    out += `Allote AI — Bütün söhbətlər\n`;
    out += `İxrac tarixi: ${stamp(Date.now())}\n`;
    out += `================================\n\n`;
    [...conversations].sort((a, b) => a.updatedAt - b.updatedAt).forEach(conv => {
      out += formatFullConversation(conv) + "\n";
    });
    return out;
  }

  /* ---------------- AUTO-FILE WRITE ---------------- */
  async function appendToHandle(handle, text) {
    const file = await handle.getFile();
    const existingSize = file.size;
    const writable = await handle.createWritable({ keepExistingData: true });
    await writable.write({ type: "write", position: existingSize, data: text });
    await writable.close();
  }

  async function connectFile() {
    if (!supportsFSAccess) return { ok: false, error: "Bu brauzer avtomatik fayl yazmağı dəstəkləmir. Chrome/Edge istifadə et, ya da aşağıdakı manual endirmədən istifadə et." };
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: "allote-sohbetler.txt",
        types: [{ description: "Mətn faylı", accept: { "text/plain": [".txt"] } }],
      });
      const perm = await handle.requestPermission({ mode: "readwrite" });
      if (perm !== "granted") return { ok: false, error: "İcazə verilmədi." };
      // ilkin başlıq yaz (boş fayldırsa)
      const file = await handle.getFile();
      if (file.size === 0) {
        await appendToHandle(handle, `================================\nAllote AI — Avtomatik Söhbət Qeydi\nBaşladı: ${stamp(Date.now())}\n================================\n`);
      }
      fileHandle = handle;
      pendingHandle = null;
      lastWrittenConvId = null;
      await idbSet(IDB_KEY, handle);
      updateStatusUI();
      return { ok: true, name: handle.name };
    } catch (err) {
      if (err && err.name === "AbortError") return { ok: false, error: null };
      return { ok: false, error: "Fayl seçilə bilmədi." };
    }
  }

  async function disconnectFile() {
    fileHandle = null;
    pendingHandle = null;
    await idbDelete(IDB_KEY);
    updateStatusUI();
  }

  async function reauthorize() {
    if (!pendingHandle) return;
    try {
      const perm = await pendingHandle.requestPermission({ mode: "readwrite" });
      if (perm === "granted") {
        fileHandle = pendingHandle;
        pendingHandle = null;
        updateStatusUI();
      }
    } catch (_) {}
  }

  async function tryRestoreHandle() {
    if (!supportsFSAccess) { updateStatusUI(); return; }
    const handle = await idbGet(IDB_KEY);
    if (!handle) { updateStatusUI(); return; }
    try {
      const perm = await handle.queryPermission({ mode: "readwrite" });
      if (perm === "granted") {
        fileHandle = handle;
      } else {
        pendingHandle = handle;
      }
    } catch (_) {}
    updateStatusUI();
  }

  async function appendExchange(convTitle, convId, userText, aiText) {
    if (!fileHandle) return;
    const isNewConv = convId !== lastWrittenConvId;
    lastWrittenConvId = convId;
    try {
      await appendToHandle(fileHandle, formatExchange(convTitle, userText, aiText, isNewConv));
      flashStatus("saved");
    } catch (_) {
      flashStatus("error");
    }
  }

  /* ---------------- MANUAL DOWNLOAD (hamısında işləyir) ---------------- */
  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadCurrentConversation(conv) {
    if (!conv || !conv.messages.length) return;
    const safe = (conv.title || "sohbet").replace(/[^\p{L}\p{N}\- ]/gu, "").trim().slice(0, 40) || "sohbet";
    downloadText(`allote-${safe}.txt`, formatFullConversation(conv));
  }

  function downloadAllConversations(conversations) {
    if (!conversations || !conversations.length) return;
    downloadText(`allote-butun-sohbetler-${new Date().toISOString().slice(0, 10)}.txt`, formatAllConversations(conversations));
  }

  /* ---------------- UI ---------------- */
  function updateStatusUI() {
    const statusEl = document.getElementById("transcriptStatus");
    const connectBtn = document.getElementById("transcriptConnectBtn");
    const disconnectBtn = document.getElementById("transcriptDisconnectBtn");
    const reauthBtn = document.getElementById("transcriptReauthBtn");
    if (!statusEl) return;

    if (!supportsFSAccess) {
      statusEl.innerHTML = `<span class="ts-dot ts-dot--off"></span> Bu brauzerdə avtomatik yazma yoxdur — aşağıdan manual endir.`;
      connectBtn.style.display = "none";
      disconnectBtn.style.display = "none";
      reauthBtn.style.display = "none";
      return;
    }
    if (fileHandle) {
      statusEl.innerHTML = `<span class="ts-dot ts-dot--on"></span> Qoşulub: <strong>${fileHandle.name}</strong> — hər mesaj avtomatik yazılır`;
      connectBtn.style.display = "none";
      disconnectBtn.style.display = "inline-flex";
      reauthBtn.style.display = "none";
    } else if (pendingHandle) {
      statusEl.innerHTML = `<span class="ts-dot ts-dot--warn"></span> Fayl seçilib, amma icazə lazımdır`;
      connectBtn.style.display = "none";
      disconnectBtn.style.display = "none";
      reauthBtn.style.display = "inline-flex";
    } else {
      statusEl.innerHTML = `<span class="ts-dot ts-dot--off"></span> Heç bir fayla qoşulmayıb`;
      connectBtn.style.display = "inline-flex";
      disconnectBtn.style.display = "none";
      reauthBtn.style.display = "none";
    }
  }

  function flashStatus(kind) {
    const statusEl = document.getElementById("transcriptStatus");
    if (!statusEl) return;
    statusEl.classList.remove("ts-flash-ok", "ts-flash-err");
    void statusEl.offsetWidth;
    statusEl.classList.add(kind === "saved" ? "ts-flash-ok" : "ts-flash-err");
  }

  function bindUI() {
    const connectBtn = document.getElementById("transcriptConnectBtn");
    const disconnectBtn = document.getElementById("transcriptDisconnectBtn");
    const reauthBtn = document.getElementById("transcriptReauthBtn");
    const downloadCurrentBtn = document.getElementById("transcriptDownloadCurrent");
    const downloadAllBtn = document.getElementById("transcriptDownloadAll");
    if (!connectBtn) return;

    connectBtn.addEventListener("click", async () => {
      const res = await connectFile();
      if (!res.ok && res.error) alert(res.error);
    });
    disconnectBtn.addEventListener("click", () => {
      if (confirm("Avtomatik yazmanı dayandırmaq istəyirsən? (Fayl özü silinmir)")) disconnectFile();
    });
    reauthBtn.addEventListener("click", reauthorize);

    downloadCurrentBtn.addEventListener("click", () => {
      if (window.AllotteChat && typeof window.AllotteChat.getActiveConversation === "function") {
        downloadCurrentConversation(window.AllotteChat.getActiveConversation());
      }
    });
    downloadAllBtn.addEventListener("click", () => {
      if (window.AllotteChat && typeof window.AllotteChat.getAllConversations === "function") {
        downloadAllConversations(window.AllotteChat.getAllConversations());
      }
    });
  }

  function init() {
    bindUI();
    tryRestoreHandle();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.AllotteTranscript = {
    appendExchange,
    downloadCurrentConversation,
    downloadAllConversations,
  };
})();
