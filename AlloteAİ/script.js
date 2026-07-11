/* =========================================================
   ALLOTE AI — CHAT MƏNTİQİ
   ========================================================= */

(() => {
  "use strict";

  const chatInner   = document.getElementById("chatInner");
  const chatBox     = document.getElementById("chat");
  const form        = document.getElementById("composerForm");
  const input       = document.getElementById("messageInput");
  const sendBtn     = document.getElementById("sendBtn");
  const clearBtn    = document.getElementById("clearChat");
  const scrollBtn   = document.getElementById("scrollBottomBtn");

  const sidebar         = document.getElementById("sidebar");
  const sidebarToggle   = document.getElementById("sidebarToggle");
  const sidebarOverlay  = document.getElementById("sidebarOverlay");
  const newChatBtn      = document.getElementById("newChatBtn");
  const conversationList = document.getElementById("conversationList");

  const settingsBtn     = document.getElementById("settingsBtn");
  const settingsOverlay = document.getElementById("settingsOverlay");
  const closeSettings   = document.getElementById("closeSettings");
  const themeCards       = document.querySelectorAll("[data-theme-btn]");
  const deleteAllBtn    = document.getElementById("deleteAllChats");

  const STORAGE_THEME         = "allote_theme";
  const STORAGE_CONVERSATIONS = "allote_conversations";
  const STORAGE_ACTIVE_ID     = "allote_active_conversation";
  const STORAGE_OLD_HISTORY   = "allote_history"; // köhnə tək-söhbət formatı
  const MAX_HISTORY_PAIRS = 14; // Groq-a göndərilən son mesaj sayı

  // Hesaba görə fərqli yaddaş "bölməsi" (namespace) - hesab yoxdursa boş qalır
  function nsKey(base) {
    try {
      return (window.AllotteAuth ? window.AllotteAuth.namespace() : "") + base;
    } catch (_) { return base; }
  }

  let conversations = [];  // [{ id, title, messages:[{role,content}], updatedAt }]
  let activeId = null;
  let isSending = false;

  /* ---------------- THEME ---------------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeCards.forEach(btn =>
      btn.classList.toggle("is-active", btn.dataset.themeBtn === theme)
    );
    try { localStorage.setItem(nsKey(STORAGE_THEME), theme); } catch (_) {}
  }

  themeCards.forEach(btn => {
    btn.addEventListener("click", () => applyTheme(btn.dataset.themeBtn));
  });

  (function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem(nsKey(STORAGE_THEME)); } catch (_) {}
    applyTheme(saved || "dark");
  })();

  /* ---------------- CONVERSATION STORAGE ---------------- */
  function loadConversations() {
    try {
      const raw = localStorage.getItem(nsKey(STORAGE_CONVERSATIONS));
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
  }
  function saveConversations() {
    try { localStorage.setItem(nsKey(STORAGE_CONVERSATIONS), JSON.stringify(conversations)); } catch (_) {}
  }
  function saveActiveId() {
    try { localStorage.setItem(nsKey(STORAGE_ACTIVE_ID), activeId || ""); } catch (_) {}
  }

  // köhnə tək-söhbət yaddaşını yeni çox-söhbət formatına köçür
  function migrateOldHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_OLD_HISTORY);
      if (!raw) return;
      const oldMessages = JSON.parse(raw);
      if (Array.isArray(oldMessages) && oldMessages.length) {
        conversations.push({
          id: makeId(),
          title: titleFromMessages(oldMessages),
          messages: oldMessages,
          updatedAt: Date.now(),
        });
        saveConversations();
      }
      localStorage.removeItem(STORAGE_OLD_HISTORY);
    } catch (_) {}
  }

  function makeId() {
    return "conv_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  }

  function titleFromMessages(messages) {
    const firstUser = messages.find(m => m.role === "user");
    if (!firstUser) return "Yeni söhbət";
    const trimmed = firstUser.content.trim();
    return trimmed.length > 40 ? trimmed.slice(0, 40) + "…" : (trimmed || "Yeni söhbət");
  }

  function getActiveConversation() {
    return conversations.find(c => c.id === activeId) || null;
  }

  function createConversation() {
    const conv = { id: makeId(), title: "Yeni söhbət", messages: [], updatedAt: Date.now() };
    conversations.unshift(conv);
    activeId = conv.id;
    saveConversations();
    saveActiveId();
    renderConversationList();
    renderWelcome();
    if (isMobile()) setSidebarOpen(false);
  }

  function switchConversation(id) {
    if (id === activeId) { if (isMobile()) setSidebarOpen(false); return; }
    activeId = id;
    saveActiveId();
    renderConversationList();
    renderActiveConversation();
    if (isMobile()) setSidebarOpen(false);
  }

  function deleteConversation(id) {
    conversations = conversations.filter(c => c.id !== id);
    saveConversations();
    if (activeId === id) {
      if (conversations.length) {
        activeId = conversations[0].id;
        saveActiveId();
        renderConversationList();
        renderActiveConversation();
      } else {
        createConversation();
        return;
      }
    } else {
      renderConversationList();
    }
  }

  function renderConversationList() {
    if (!conversations.length) {
      conversationList.innerHTML = `<p class="sidebar__empty">Hələ söhbət yoxdur</p>`;
      return;
    }
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    conversationList.innerHTML = sorted.map(c => `
      <div class="conv-item ${c.id === activeId ? "is-active" : ""}" data-id="${c.id}">
        <span class="conv-item__title">${escapeHtml(c.title)}</span>
        <button class="conv-item__delete" data-delete-id="${c.id}" aria-label="Söhbəti sil" title="Sil">
          <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 .7 12a2 2 0 0 0 2 1.9h4.6a2 2 0 0 0 2-1.9L17 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    `).join("");

    conversationList.querySelectorAll(".conv-item").forEach(el => {
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-delete-id]")) return;
        switchConversation(el.dataset.id);
      });
    });
    conversationList.querySelectorAll("[data-delete-id]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteConversation(btn.dataset.deleteId);
      });
    });
  }

  function renderActiveConversation() {
    const conv = getActiveConversation();
    if (!conv || conv.messages.length === 0) { renderWelcome(); return; }
    chatInner.innerHTML = "";
    conv.messages.forEach(m => {
      if (m.image && window.AllotteImage) {
        const el = window.AllotteImage.renderStoredMessage(m);
        if (el) { chatInner.appendChild(el); return; }
      }
      addMessage(m.role === "user" ? "user" : "assistant", m.content, { animate: false });
    });
    scrollToBottom(false);
  }

  /* ---------------- SIDEBAR (mobile drawer / desktop collapse) ---------------- */
  function isMobile() { return window.innerWidth <= 900; }

  function setSidebarOpen(open) {
    sidebar.classList.toggle("is-collapsed", !open);
    sidebarOverlay.classList.toggle("is-open", open && isMobile());
  }

  sidebarToggle.addEventListener("click", () => {
    setSidebarOpen(sidebar.classList.contains("is-collapsed"));
  });
  sidebarOverlay.addEventListener("click", () => setSidebarOpen(false));
  newChatBtn.addEventListener("click", () => createConversation());

  /* ---------------- SETTINGS MODAL ---------------- */
  function openSettingsModal() {
    settingsOverlay.classList.add("is-open");
  }
  function closeSettingsModal() {
    settingsOverlay.classList.remove("is-open");
  }
  settingsBtn.addEventListener("click", openSettingsModal);
  closeSettings.addEventListener("click", closeSettingsModal);
  settingsOverlay.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) closeSettingsModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSettingsModal();
  });
  deleteAllBtn.addEventListener("click", () => {
    if (isSending) return;
    const ok = confirm("Bütün söhbətlər həmişəlik silinsin?");
    if (!ok) return;
    conversations = [];
    saveConversations();
    createConversation();
    closeSettingsModal();
  });

  /* ---------------- RENDERING ---------------- */
  const SUGGESTIONS = [
    "Allote, özünü tanıt",
    "Mənə qısa bir zarafat de",
    "Bugün üçün motivasiya sözü ver",
    "React nədir, 3 cümlə ilə izah et",
  ];

  function renderWelcome() {
    chatInner.innerHTML = `
      <div class="welcome">
        <img src="menu.jpg" alt="Allote AI" class="logo-img logo-img--lg">
        <h2>Salam, mən Allote AI-yam</h2>
        <p>Nə haqda danışmaq istəyirsən? Sual ver, fikir soruş, ya da sadəcə söhbət elə.</p>
        <div class="welcome__chips">
          ${SUGGESTIONS.map(s => `<button type="button" class="chip" data-chip>${escapeHtml(s)}</button>`).join("")}
        </div>
      </div>
    `;
    chatInner.querySelectorAll("[data-chip]").forEach(chip => {
      chip.addEventListener("click", () => {
        input.value = chip.textContent;
        autoResize();
        input.focus();
      });
    });
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, m => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
  }

  // sadə format: **qalın**, `kod`, sətir sonları
  function formatContent(text) {
    let safe = escapeHtml(text);
    safe = safe.replace(/`([^`]+)`/g, "<code>$1</code>");
    safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    safe = safe.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
    return safe;
  }

  function scrollToBottom(smooth = true) {
    chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  function addMessage(role, content, { animate = true } = {}) {
    if (chatInner.querySelector(".welcome")) chatInner.innerHTML = "";

    const wrap = document.createElement("div");
    wrap.className = `msg msg--${role === "user" ? "user" : "ai"}`;
    if (!animate) wrap.style.animation = "none";

    const avatar = role === "user" ? "" : `
      <img src="menu.jpg" alt="Allote AI" class="logo-img logo-img--msg">`;

    wrap.innerHTML = `
      ${avatar}
      <div class="msg__bubble">${formatContent(content)}</div>
    `;
    chatInner.appendChild(wrap);
    scrollToBottom(animate);
    return wrap;
  }

  function addTypingBubble() {
    if (chatInner.querySelector(".welcome")) chatInner.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "msg msg--ai";
    wrap.id = "typingBubble";
    wrap.innerHTML = `
      <img src="menu.jpg" alt="Allote AI" class="logo-img logo-img--msg is-thinking">
      <div class="msg__bubble">
        <span class="typing"><span></span><span></span><span></span></span>
      </div>
    `;
    chatInner.appendChild(wrap);
    scrollToBottom();
  }
  function removeTypingBubble() {
    const el = document.getElementById("typingBubble");
    if (el) el.remove();
  }

  /* ---------------- TEXTAREA AUTO-RESIZE ---------------- */
  function autoResize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  }
  input.addEventListener("input", autoResize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  /* ---------------- GROQ API ---------------- */
  async function askAllote(convMessages) {
    if (typeof ALLOTE_CONFIG === "undefined") {
      console.error(
        "[Allote AI] ALLOTE_CONFIG tapılmadı. index.html içindəki config bloku " +
        "script.js-dən ƏVVƏL yerləşməlidir."
      );
      throw new Error("NO_KEY");
    }
    const key = (ALLOTE_CONFIG.GROQ_API_KEY || "").trim();
    if (!key) {
      console.error("[Allote AI] config tapıldı, amma GROQ_API_KEY boşdur.");
      throw new Error("NO_KEY");
    }

    let systemPrompt = ALLOTE_CONFIG.SYSTEM_PROMPT;
    try {
      if (window.AllotteMemory) {
        const memoryContext = window.AllotteMemory.buildContextString();
        if (memoryContext) systemPrompt += "\n\n" + memoryContext;
      }
    } catch (_) {}

    const messages = [
      { role: "system", content: systemPrompt },
      ...convMessages.slice(-MAX_HISTORY_PAIRS * 2),
    ];

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: ALLOTE_CONFIG.GROQ_MODEL || "openai/gpt-oss-120b",
        messages,
        temperature: 0.8,
        max_tokens: 1024,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error("Groq error:", res.status, errBody);
      throw new Error("API_ERROR");
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || "Bağışla, cavab ala bilmədim.";
  }

  /* ---------------- SEND FLOW ---------------- */
  function setSending(state) {
    isSending = state;
    sendBtn.disabled = state;
    sendBtn.classList.toggle("is-loading", state);
    input.disabled = state;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || isSending) return;

    let conv = getActiveConversation();
    if (!conv) { createConversation(); conv = getActiveConversation(); }

    // Şəkil düzəltmə komandası (/şəkil, /image, /resim ...) varsa,
    // axını image.js-ə həvalə edirik və Groq mətn axınından çıxırıq.
    if (window.AllotteImage && window.AllotteImage.isImageCommand(text)) {
      input.value = "";
      autoResize();
      setSending(true);
      const handled = await window.AllotteImage.handleSend(text, conv, {
        addUserMessage: (t) => {
          addMessage("user", t);
          conv.messages.push({ role: "user", content: t });
          if (conv.messages.filter(m => m.role === "user").length === 1) {
            conv.title = titleFromMessages(conv.messages);
          }
          conv.updatedAt = Date.now();
          saveConversations();
          renderConversationList();
        },
        addAssistantMessage: (t) => {
          addMessage("assistant", t);
          conv.messages.push({ role: "assistant", content: t });
          conv.updatedAt = Date.now();
          saveConversations();
        },
        persist: () => {
          conv.updatedAt = Date.now();
          saveConversations();
          renderConversationList();
        },
        scrollToBottom: () => scrollToBottom(),
      });
      setSending(false);
      input.focus();
      if (handled) return;
    }

    addMessage("user", text);
    conv.messages.push({ role: "user", content: text });
    if (conv.messages.filter(m => m.role === "user").length === 1) {
      conv.title = titleFromMessages(conv.messages);
    }
    conv.updatedAt = Date.now();
    saveConversations();
    renderConversationList();

    input.value = "";
    autoResize();
    setSending(true);
    addTypingBubble();

    try {

      const answer = await askAllote(conv.messages);
      removeTypingBubble();
      addMessage("assistant", answer);
      conv.messages.push({ role: "assistant", content: answer });
      conv.updatedAt = Date.now();
      saveConversations();
      renderConversationList();

      // Yaddaş mühərriki: söhbətdən uzunmüddətli faktları arxa planda çıxarır
      try {
        if (window.AllotteMemory) {
          window.AllotteMemory.extractFromExchange(text, answer, conv.id);
        }
      } catch (_) {}

      // Transkript mühərriki: söhbəti .txt fayla (varsa qoşulub) avtomatik yazır
      try {
        if (window.AllotteTranscript) {
          window.AllotteTranscript.appendExchange(conv.title, conv.id, text, answer);
        }
      } catch (_) {}
    } catch (err) {
      removeTypingBubble();
      if (err.message === "NO_KEY") {
        addMessage("assistant",
          "Hələ Groq API açarı qoşulmayıb 🙈\n" +
          "`index.html` faylını aç, `GROQ_API_KEY: \"\"` yerinə öz açarını yaz " +
          "(https://console.groq.com/keys ünvanından ala bilərsən)."
        );
      } else {
        addMessage("assistant", "Bağışla, hazırda cavab verə bilmədim 😕 Bir az sonra yenidən yoxla.");
      }
    } finally {
      setSending(false);
      input.focus();
    }
  });

  /* ---------------- CLEAR CURRENT CHAT ---------------- */
  clearBtn.addEventListener("click", () => {
    if (isSending) return;
    const conv = getActiveConversation();
    if (!conv) return;
    conv.messages = [];
    conv.title = "Yeni söhbət";
    saveConversations();
    renderConversationList();
    renderWelcome();
  });

  /* ---------------- SCROLL BUTTON ---------------- */
  scrollBtn.addEventListener("click", () => scrollToBottom());

  /* ---------------- RESPONSIVE SIDEBAR ON RESIZE ---------------- */
  window.addEventListener("resize", () => {
    if (!isMobile() && sidebar.classList.contains("is-collapsed") && !sidebarOverlay.classList.contains("is-open")) {
      // desktopda default açıq görünsün deyə istifadəçi özü bağlamayıbsa toxunmuruq
    }
  });

  /* ---------------- INIT ---------------- */
  (function init() {
    conversations = loadConversations();
    migrateOldHistory();

    let savedActiveId = null;
    try { savedActiveId = localStorage.getItem(nsKey(STORAGE_ACTIVE_ID)); } catch (_) {}
    activeId = (savedActiveId && conversations.find(c => c.id === savedActiveId)) ? savedActiveId : (conversations[0] ? conversations[0].id : null);

    if (!activeId) {
      createConversation();
    } else {
      saveActiveId();
      renderConversationList();
      renderActiveConversation();
    }

    setSidebarOpen(!isMobile());
    autoResize();
  })();

  /* ---------------- PUBLIC API (transcript.js üçün) ---------------- */
  window.AllotteChat = {
    getActiveConversation,
    getAllConversations: () => conversations,
  };

})();
