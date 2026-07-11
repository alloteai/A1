/* =========================================================
   ALLOTE AI — ŞƏKİL DÜZƏLTMƏ MODULU
   Slash-komanda ilə (/şəkil, /image, /resim ...) prompt yazılanda
   şəkil generasiya edir, animasiyalı gözləmə göstərir, nəticəni
   söhbətə mesaj kimi yerləşdirir, yükləmə/böyütmə imkanı verir
   və prompt+şəkli aktiv söhbətin yaddaşında saxlayır.
   ========================================================= */

(() => {
  "use strict";

  /* ---------------- SLASH TRIGGER SÖZLƏRİ (AZ / TR / EN) ---------------- */
  const TRIGGERS = [
    "şəkil", "sekil", "şekil", "resim", "görüntü", "goruntu",
    "image", "picture", "img", "draw", "generate",
  ];

  function isImageCommand(raw) {
    const t = raw.trim();
    if (!t.startsWith("/")) return null;
    const spaceIdx = t.indexOf(" ");
    const cmd = (spaceIdx === -1 ? t.slice(1) : t.slice(1, spaceIdx)).toLowerCase();
    if (!TRIGGERS.includes(cmd)) return null;
    const prompt = spaceIdx === -1 ? "" : t.slice(spaceIdx + 1).trim();
    return { cmd, prompt };
  }

  /* ---------------- IMAGE GENERATION (pollinations.ai — key tələb etmir) ---------------- */
  function buildImageUrl(prompt, seed) {
    const cleaned = encodeURIComponent(prompt.trim());
    const s = seed || Math.floor(Math.random() * 1e9);
    return `https://image.pollinations.ai/prompt/${cleaned}?width=1024&height=1024&seed=${s}&nologo=true`;
  }

  function preloadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = () => reject(new Error("IMG_LOAD_FAIL"));
      img.src = url;
    });
  }

  async function generateImage(prompt) {
    const seed = Math.floor(Math.random() * 1e9);
    const url = buildImageUrl(prompt, seed);
    await preloadImage(url);
    return { url, seed };
  }

  /* ---------------- UI: LOADING CARD ---------------- */
  function buildLoadingCard(prompt) {
    const wrap = document.createElement("div");
    wrap.className = "img-card img-card--loading";
    wrap.innerHTML = `
      <div class="img-card__scene" aria-hidden="true">
        <div class="img-card__ring"></div>
        <div class="img-card__ring img-card__ring--2"></div>
        <svg class="img-card__spark" viewBox="0 0 24 24" fill="none">
          <path d="M12 2.5 13.9 9l6.6 1.9-6.6 1.9L12 19.4 10.1 12.8 3.5 10.9l6.6-1.9L12 2.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
        </svg>
      </div>
      <p class="img-card__status">Şəkil düzəldilir<span class="img-dots"><span>.</span><span>.</span><span>.</span></span></p>
      <p class="img-card__prompt">${escapeHtml(prompt)}</p>
    `;
    return wrap;
  }

  function swapToResult(cardEl, prompt, url) {
    cardEl.classList.remove("img-card--loading");
    cardEl.classList.add("img-card--done");
    cardEl.innerHTML = `
      <div class="img-card__frame">
        <img src="${url}" alt="${escapeHtml(prompt)}" class="img-card__img" loading="lazy">
      </div>
      <p class="img-card__prompt img-card__prompt--done">${escapeHtml(prompt)}</p>
      <div class="img-card__actions">
        <button type="button" class="img-btn" data-img-download title="Yüklə" aria-label="Yüklə">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Yüklə
        </button>
        <button type="button" class="img-btn" data-img-zoom title="Böyüt" aria-label="Böyüt">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.8"/><path d="m20 20-4.3-4.3M8.3 10.5h4.4M10.5 8.3v4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          Böyüt
        </button>
      </div>
    `;
    bindCardActions(cardEl, prompt, url);
  }

  function swapToError(cardEl, prompt) {
    cardEl.classList.remove("img-card--loading");
    cardEl.classList.add("img-card--error");
    cardEl.innerHTML = `
      <div class="img-card__scene img-card__scene--error" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" width="30" height="30"><path d="M12 8v5M12 16.2v.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="9.3" stroke="currentColor" stroke-width="1.6"/></svg>
      </div>
      <p class="img-card__status img-card__status--error">Şəkil düzəldilə bilmədi. Bir az sonra yenidən cəhd et.</p>
      <p class="img-card__prompt">${escapeHtml(prompt)}</p>
    `;
  }

  function bindCardActions(cardEl, prompt, url) {
    const dlBtn = cardEl.querySelector("[data-img-download]");
    const zoomBtn = cardEl.querySelector("[data-img-zoom]");
    if (dlBtn) dlBtn.addEventListener("click", () => downloadImage(url, prompt));
    if (zoomBtn) zoomBtn.addEventListener("click", () => openLightbox(url, prompt));
    const imgEl = cardEl.querySelector(".img-card__img");
    if (imgEl) imgEl.addEventListener("click", () => openLightbox(url, prompt));
  }

  async function downloadImage(url, prompt) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safe = prompt.replace(/[^\p{L}\p{N}\- ]/gu, "").trim().slice(0, 40) || "sekil";
      a.href = objUrl;
      a.download = `allote-${safe}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (_) {
      window.open(url, "_blank");
    }
  }

  /* ---------------- LIGHTBOX ---------------- */
  let lightboxEl = null;
  function ensureLightbox() {
    if (lightboxEl) return lightboxEl;
    lightboxEl = document.createElement("div");
    lightboxEl.className = "img-lightbox";
    lightboxEl.innerHTML = `
      <button type="button" class="img-lightbox__close" aria-label="Bağla">
        <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
      <img class="img-lightbox__img" src="" alt="">
      <div class="img-lightbox__bar">
        <button type="button" class="img-btn img-btn--light" data-lb-download>
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Yüklə
        </button>
      </div>
    `;
    document.body.appendChild(lightboxEl);
    lightboxEl.addEventListener("click", (e) => {
      if (e.target === lightboxEl) closeLightbox();
    });
    lightboxEl.querySelector(".img-lightbox__close").addEventListener("click", closeLightbox);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && lightboxEl.classList.contains("is-open")) closeLightbox();
    });
    return lightboxEl;
  }
  function openLightbox(url, prompt) {
    const el = ensureLightbox();
    el.querySelector(".img-lightbox__img").src = url;
    el.querySelector(".img-lightbox__img").alt = prompt;
    const dlBtn = el.querySelector("[data-lb-download]");
    dlBtn.onclick = () => downloadImage(url, prompt);
    el.classList.add("is-open");
    document.body.classList.add("no-scroll");
  }
  function closeLightbox() {
    if (!lightboxEl) return;
    lightboxEl.classList.remove("is-open");
    document.body.classList.remove("no-scroll");
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, m => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
  }

  /* ---------------- SLASH MENU (inputun üstündə) ---------------- */
  const SLASH_ITEMS = [
    {
      cmd: "şəkil",
      title: "Şəkil düzəlt",
      desc: "Yazdığın təsvirdən şəkil yaradır",
      icon: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" stroke-width="1.7"/><circle cx="8.5" cy="9.5" r="1.6" stroke="currentColor" stroke-width="1.5"/><path d="m5 17 4.5-4.8a1.7 1.7 0 0 1 2.5 0L15 15.3l1-1.1a1.7 1.7 0 0 1 2.5 0L21 17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    },
  ];

  let slashMenuEl = null;
  let input = null;

  function ensureSlashMenu() {
    if (slashMenuEl) return slashMenuEl;
    slashMenuEl = document.createElement("div");
    slashMenuEl.className = "slash-menu";
    slashMenuEl.innerHTML = SLASH_ITEMS.map(it => `
      <button type="button" class="slash-item" data-slash-cmd="${it.cmd}">
        <span class="slash-item__icon">${it.icon}</span>
        <span class="slash-item__text">
          <span class="slash-item__title">${it.title}</span>
          <span class="slash-item__desc">${it.desc}</span>
        </span>
        <span class="slash-item__tag">/${it.cmd}</span>
      </button>
    `).join("");
    const composerBar = document.querySelector(".composer__bar");
    const composer = document.querySelector(".composer");
    if (composer) composer.insertBefore(slashMenuEl, composerBar);

    slashMenuEl.querySelectorAll("[data-slash-cmd]").forEach(btn => {
      btn.addEventListener("click", () => {
        const cmd = btn.dataset.slashCmd;
        input.value = `/${cmd} `;
        input.focus();
        input.dispatchEvent(new Event("input"));
        hideSlashMenu();
      });
    });
    return slashMenuEl;
  }

  function showSlashMenu() {
    ensureSlashMenu().classList.add("is-open");
  }
  function hideSlashMenu() {
    if (slashMenuEl) slashMenuEl.classList.remove("is-open");
  }

  function bindSlashTrigger() {
    input = document.getElementById("messageInput");
    if (!input) return;
    ensureSlashMenu();
    input.addEventListener("input", () => {
      const v = input.value;
      if (v === "/" || (v.startsWith("/") && !v.includes(" ") && v.length <= 12)) {
        showSlashMenu();
      } else {
        hideSlashMenu();
      }
    });
    input.addEventListener("blur", () => setTimeout(hideSlashMenu, 150));
    document.addEventListener("click", (e) => {
      if (slashMenuEl && !slashMenuEl.contains(e.target) && e.target !== input) hideSlashMenu();
    });
  }

  /* ---------------- CHAT INTEGRATION ---------------- */
  // script.js tərəfindən çağırılır: mesaj göndərilməzdən əvvəl komanda yoxlanır.
  // true qaytarsa — normal Groq axını dayandırılmalıdır (image.js özü idarə edir).
  async function handleSend(rawText, conv, helpers) {
    const parsed = isImageCommand(rawText);
    if (!parsed) return false;
    const prompt = parsed.prompt;

    helpers.addUserMessage(rawText);

    if (!prompt) {
      helpers.addAssistantMessage("Şəkil üçün nə istədiyini də yaz, məs: `/şəkil qar dağının üstündə gün doğuşu`");
      return true;
    }

    const chatInner = document.getElementById("chatInner");
    if (chatInner.querySelector(".welcome")) chatInner.innerHTML = "";

    const msgWrap = document.createElement("div");
    msgWrap.className = "msg msg--ai";
    msgWrap.innerHTML = `<img src="menu.jpg" alt="Allote AI" class="logo-img logo-img--msg is-thinking">`;
    const bubble = document.createElement("div");
    bubble.className = "msg__bubble msg__bubble--img";
    const card = buildLoadingCard(prompt);
    bubble.appendChild(card);
    msgWrap.appendChild(bubble);
    chatInner.appendChild(msgWrap);
    helpers.scrollToBottom();

    // yaddaşda mesaj obyekti kimi saxlanılan struktur
    const imgMsg = {
      role: "assistant",
      content: `[şəkil]: ${prompt}`,
      image: { prompt, url: null, status: "loading" },
    };
    conv.messages.push(imgMsg);
    helpers.persist();

    try {
      const { url } = await generateImage(prompt);
      msgWrap.querySelector(".logo-img").classList.remove("is-thinking");
      swapToResult(card, prompt, url);
      imgMsg.image.url = url;
      imgMsg.image.status = "done";
      helpers.persist();
    } catch (_) {
      msgWrap.querySelector(".logo-img").classList.remove("is-thinking");
      swapToError(card, prompt);
      imgMsg.image.status = "error";
      helpers.persist();
    }

    return true;
  }

  // Söhbət tarixçəsini render edərkən (renderActiveConversation) şəkil mesajlarını göstərmək üçün
  function renderStoredMessage(m) {
    if (!m.image) return null;
    const wrap = document.createElement("div");
    wrap.className = "msg msg--ai";
    wrap.style.animation = "none";
    const avatar = document.createElement("img");
    avatar.src = "menu.jpg";
    avatar.alt = "Allote AI";
    avatar.className = "logo-img logo-img--msg";
    wrap.appendChild(avatar);

    const bubble = document.createElement("div");
    bubble.className = "msg__bubble msg__bubble--img";

    if (m.image.status === "done" && m.image.url) {
      const card = document.createElement("div");
      card.className = "img-card img-card--done";
      swapToResult(card, m.image.prompt, m.image.url);
      bubble.appendChild(card);
    } else if (m.image.status === "error") {
      const card = document.createElement("div");
      card.className = "img-card";
      swapToError(card, m.image.prompt);
      bubble.appendChild(card);
    } else {
      const card = buildLoadingCard(m.image.prompt);
      bubble.appendChild(card);
    }
    wrap.appendChild(bubble);
    return wrap;
  }

  document.addEventListener("DOMContentLoaded", bindSlashTrigger);
  if (document.readyState !== "loading") bindSlashTrigger();

  window.AllotteImage = {
    isImageCommand,
    handleSend,
    renderStoredMessage,
  };
})();
