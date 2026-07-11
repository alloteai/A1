/* =========================================================
   ALLOTE AI — HESAB SİSTEMİ (local, brauzer-daxili)
   Qeyd: Bu server-əsaslı deyil — bu CİHAZ/brauzerdə profilləri
   ayırır ki, tema/yaddaş/söhbətlər hesaba bağlı qalıb silinməsin.
   Fərqli cihaz və ya brauzerdə eyni hesabı görməzsən (cloud sync yoxdur).
   ========================================================= */

(() => {
  "use strict";

  const STORAGE_ACCOUNTS = "allote_accounts_v1";
  const STORAGE_SESSION  = "allote_session_v1";

  /* ---------------- CRYPTO HELPERS ---------------- */
  async function sha256(str) {
    const enc = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  function randomSalt() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  /* ---------------- STORAGE ---------------- */
  function loadAccounts() {
    try { return JSON.parse(localStorage.getItem(STORAGE_ACCOUNTS) || "{}"); } catch (_) { return {}; }
  }
  function saveAccounts(a) {
    try { localStorage.setItem(STORAGE_ACCOUNTS, JSON.stringify(a)); } catch (_) {}
  }
  function loadSession() {
    try { return JSON.parse(localStorage.getItem(STORAGE_SESSION) || "null"); } catch (_) { return null; }
  }
  function saveSession(username) {
    try { localStorage.setItem(STORAGE_SESSION, JSON.stringify(username)); } catch (_) {}
  }

  function currentUsername() { return loadSession(); }
  function namespace() {
    const u = currentUsername();
    return u ? `acc_${u}__` : "";
  }
  function isLoggedIn() { return !!currentUsername(); }

  /* ---------------- ACTIONS ---------------- */
  async function register(username, password) {
    username = (username || "").trim().toLowerCase();
    if (username.length < 3) return { ok: false, error: "İstifadəçi adı ən azı 3 simvol olmalıdır." };
    if (!/^[a-z0-9_.]+$/.test(username)) return { ok: false, error: "Yalnız hərf, rəqəm, _ və . istifadə et." };
    if ((password || "").length < 4) return { ok: false, error: "Şifrə ən azı 4 simvol olmalıdır." };

    const accounts = loadAccounts();
    if (accounts[username]) return { ok: false, error: "Bu istifadəçi adı artıq mövcuddur." };

    const salt = randomSalt();
    const hash = await sha256(password + salt);
    accounts[username] = { hash, salt, createdAt: Date.now() };
    saveAccounts(accounts);
    saveSession(username);
    return { ok: true };
  }

  async function login(username, password) {
    username = (username || "").trim().toLowerCase();
    const accounts = loadAccounts();
    const acc = accounts[username];
    if (!acc) return { ok: false, error: "Belə istifadəçi tapılmadı." };
    const hash = await sha256(password + acc.salt);
    if (hash !== acc.hash) return { ok: false, error: "Şifrə yanlışdır." };
    saveSession(username);
    return { ok: true };
  }

  function logout() {
    saveSession(null);
  }

  function deleteCurrentAccount() {
    const u = currentUsername();
    if (!u) return;
    const accounts = loadAccounts();
    delete accounts[u];
    saveAccounts(accounts);
    // hesabın öz məlumatlarını da (söhbət/tema/yaddaş) təmizlə
    const prefix = `acc_${u}__`;
    Object.keys(localStorage)
      .filter(k => k.startsWith(prefix))
      .forEach(k => localStorage.removeItem(k));
    logout();
  }

  /* ================================================================
     UI
     ================================================================ */
  let mode = "login"; // login | register

  function renderAccountBar() {
    const el = document.getElementById("sidebarAccount");
    if (!el) return;
    const user = currentUsername();
    if (user) {
      el.innerHTML = `
        <div class="acct-bar">
          <div class="acct-bar__avatar">${escapeHtml(user[0].toUpperCase())}</div>
          <div class="acct-bar__info">
            <span class="acct-bar__name">${escapeHtml(user)}</span>
            <span class="acct-bar__tag">Hesaba bağlı</span>
          </div>
          <button class="acct-bar__btn" id="acctLogoutBtn" title="Çıxış">
            <svg viewBox="0 0 24 24" fill="none"><path d="M9 6V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-1M15 12H3m0 0 3.5-3.5M3 12l3.5 3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      `;
      document.getElementById("acctLogoutBtn").addEventListener("click", () => {
        if (confirm("Hesabdan çıxmaq istəyirsən? Tema/yaddaş/söhbətlər hesabında saxlanılacaq.")) {
          logout();
          location.reload();
        }
      });
    } else {
      el.innerHTML = `
        <button class="acct-bar acct-bar--guest" id="acctLoginBtn">
          <div class="acct-bar__avatar acct-bar__avatar--ghost">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z" stroke="currentColor" stroke-width="1.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          </div>
          <div class="acct-bar__info">
            <span class="acct-bar__name">Qonaq</span>
            <span class="acct-bar__tag">Hesab yarat / Giriş et</span>
          </div>
        </button>
      `;
      document.getElementById("acctLoginBtn").addEventListener("click", openAuthModal);
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, m => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
  }

  function setMode(newMode) {
    mode = newMode;
    const tabLogin = document.getElementById("authTabLogin");
    const tabRegister = document.getElementById("authTabRegister");
    const submitBtn = document.getElementById("authSubmitBtn");
    const errorEl = document.getElementById("authError");
    errorEl.textContent = "";
    tabLogin.classList.toggle("is-active", mode === "login");
    tabRegister.classList.toggle("is-active", mode === "register");
    submitBtn.textContent = mode === "login" ? "Daxil ol" : "Hesab yarat";
  }

  function openAuthModal() {
    const overlay = document.getElementById("authOverlay");
    if (!overlay) return;
    document.getElementById("authError").textContent = "";
    document.getElementById("authUsername").value = "";
    document.getElementById("authPassword").value = "";
    setMode("login");
    overlay.classList.add("is-open");
    setTimeout(() => document.getElementById("authUsername").focus(), 150);
  }
  function closeAuthModal() {
    const overlay = document.getElementById("authOverlay");
    if (overlay) overlay.classList.remove("is-open");
  }

  function bindUI() {
    const overlay = document.getElementById("authOverlay");
    if (!overlay) return;

    document.getElementById("closeAuth").addEventListener("click", closeAuthModal);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeAuthModal(); });
    document.getElementById("authTabLogin").addEventListener("click", () => setMode("login"));
    document.getElementById("authTabRegister").addEventListener("click", () => setMode("register"));
    document.getElementById("authGuestBtn").addEventListener("click", closeAuthModal);

    const form = document.getElementById("authForm");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("authUsername").value;
      const password = document.getElementById("authPassword").value;
      const errorEl = document.getElementById("authError");
      const submitBtn = document.getElementById("authSubmitBtn");
      errorEl.textContent = "";
      submitBtn.disabled = true;
      const result = mode === "login" ? await login(username, password) : await register(username, password);
      submitBtn.disabled = false;
      if (result.ok) {
        location.reload();
      } else {
        errorEl.textContent = result.error;
      }
    });

    const memoryBtnAcct = document.getElementById("acctOpenFromMemory");
    if (memoryBtnAcct) memoryBtnAcct.addEventListener("click", openAuthModal);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAuthModal();
  });

  function init() {
    renderAccountBar();
    bindUI();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.AllotteAuth = {
    namespace,
    currentUsername,
    isLoggedIn,
    openAuthModal,
    logout,
    deleteCurrentAccount,
  };
})();
