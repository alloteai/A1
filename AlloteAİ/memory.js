/* =========================================================
   ALLOTE AI — MEMORY ENGINE
   Persistent, self-organizing long-term memory for Allote AI.
   Storage: localStorage. Extraction: Groq LLM (JSON mode).
   ========================================================= */

(() => {
  "use strict";

  /* ---------------- CONFIG ---------------- */
  const STORAGE_MEMORIES = "allote_memories_v1";
  const STORAGE_MEM_META = "allote_memory_meta_v1"; // { lastExtractedMsgCount: {convId: n} }

  function nsKey(base) {
    try {
      return (window.AllotteAuth ? window.AllotteAuth.namespace() : "") + base;
    } catch (_) { return base; }
  }

  const CATEGORIES = {
    identity:      { label: "Şəxsiyyət",      color: "#7c6cff", icon: "user"   },
    preferences:   { label: "Zövqlər",        color: "#4fd1c5", icon: "heart"  },
    projects:      { label: "Layihələr",      color: "#4c9aff", icon: "folder" },
    skills:        { label: "Bacarıqlar",     color: "#ffb020", icon: "bolt"   },
    goals:         { label: "Məqsədlər",      color: "#ff5ca8", icon: "flag"   },
    relationships: { label: "Münasibətlər",   color: "#33d17a", icon: "users"  },
    habits:        { label: "Vərdişlər",      color: "#5ec8ff", icon: "clock"  },
  };
  const CATEGORY_KEYS = Object.keys(CATEGORIES);

  const MAX_MEMORIES_IN_CONTEXT = 24;
  const SIMILARITY_MERGE_THRESHOLD = 0.55;
  const MIN_MSGS_BEFORE_EXTRACTION = 2; // extract after every full user+ai pair

  /* ---------------- STATE ---------------- */
  let memories = [];       // in-memory cache
  let dashboardState = {
    search: "",
    category: "all",       // all | pinned | one of CATEGORY_KEYS
    sort: "importance",    // importance | recent | alpha | confidence
    view: "grid",          // grid | timeline
  };
  let editingId = null;

  /* ---------------- UTIL ---------------- */
  function uid() {
    return "mem_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }
  function now() { return Date.now(); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, m => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
  }
  function normalizeWords(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(w => w.length > 2);
  }
  function jaccard(a, b) {
    const sa = new Set(normalizeWords(a));
    const sb = new Set(normalizeWords(b));
    if (!sa.size || !sb.size) return 0;
    let inter = 0;
    sa.forEach(w => { if (sb.has(w)) inter++; });
    const union = sa.size + sb.size - inter;
    return union === 0 ? 0 : inter / union;
  }
  function relativeTime(ts) {
    const diff = Date.now() - ts;
    const min = 60000, hr = 3600000, day = 86400000;
    if (diff < min) return "indicə";
    if (diff < hr) return Math.floor(diff / min) + " dəq əvvəl";
    if (diff < day) return Math.floor(diff / hr) + " saat əvvəl";
    if (diff < day * 30) return Math.floor(diff / day) + " gün əvvəl";
    return new Date(ts).toLocaleDateString("az-AZ");
  }

  /* ---------------- PERSISTENCE ---------------- */
  function loadMemories() {
    try {
      const raw = localStorage.getItem(nsKey(STORAGE_MEMORIES));
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
  }
  function saveMemories() {
    try { localStorage.setItem(nsKey(STORAGE_MEMORIES), JSON.stringify(memories)); } catch (_) {}
  }
  function loadMeta() {
    try {
      const raw = localStorage.getItem(nsKey(STORAGE_MEM_META));
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  function saveMeta(meta) {
    try { localStorage.setItem(nsKey(STORAGE_MEM_META), JSON.stringify(meta)); } catch (_) {}
  }

  /* ---------------- CORE CRUD ---------------- */
  function findSimilar(category, content) {
    let best = null, bestScore = 0;
    for (const m of memories) {
      if (m.category !== category) continue;
      const score = jaccard(m.content, content);
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return bestScore >= SIMILARITY_MERGE_THRESHOLD ? best : null;
  }

  function computeConnections(mem) {
    const words = new Set(normalizeWords(mem.content).concat(mem.tags || []));
    const links = [];
    for (const other of memories) {
      if (other.id === mem.id || other.category === mem.category) continue;
      const otherWords = new Set(normalizeWords(other.content).concat(other.tags || []));
      let overlap = 0;
      words.forEach(w => { if (otherWords.has(w)) overlap++; });
      if (overlap >= 2) links.push({ id: other.id, score: overlap });
    }
    return links.sort((a, b) => b.score - a.score).slice(0, 5).map(l => l.id);
  }

  function addOrMergeMemory(partial) {
    const category = CATEGORY_KEYS.includes(partial.category) ? partial.category : "identity";
    const content = (partial.content || "").trim();
    if (!content) return null;
    const importance = clamp(Math.round(partial.importance ?? 5), 1, 10);
    const confidence = clamp(partial.confidence ?? 0.7, 0, 1);
    const tags = Array.isArray(partial.tags) ? partial.tags.slice(0, 8) : [];

    const existing = findSimilar(category, content);
    if (existing) {
      // merge: keep the richer/longer description, reinforce confidence & importance
      existing.content = content.length > existing.content.length ? content : existing.content;
      existing.confidence = clamp(existing.confidence + (1 - existing.confidence) * 0.35, 0, 1);
      existing.importance = clamp(Math.round((existing.importance + importance) / 2) + 1, 1, 10);
      existing.updatedAt = now();
      existing.mergeCount = (existing.mergeCount || 1) + 1;
      existing.tags = Array.from(new Set([...(existing.tags || []), ...tags])).slice(0, 8);
      existing.connections = computeConnections(existing);
      saveMemories();
      return existing;
    }

    const mem = {
      id: uid(),
      category,
      content,
      importance,
      confidence,
      pinned: false,
      tags,
      mergeCount: 1,
      createdAt: now(),
      updatedAt: now(),
      connections: [],
      sourceConvId: partial.sourceConvId || null,
    };
    mem.connections = computeConnections(mem);
    memories.push(mem);
    saveMemories();
    return mem;
  }

  function updateMemory(id, patch) {
    const mem = memories.find(m => m.id === id);
    if (!mem) return;
    Object.assign(mem, patch, { updatedAt: now() });
    mem.importance = clamp(Math.round(mem.importance), 1, 10);
    mem.confidence = clamp(mem.confidence, 0, 1);
    mem.connections = computeConnections(mem);
    saveMemories();
  }

  function deleteMemory(id) {
    memories = memories.filter(m => m.id !== id);
    memories.forEach(m => { m.connections = (m.connections || []).filter(cid => cid !== id); });
    saveMemories();
  }

  function togglePin(id) {
    const mem = memories.find(m => m.id === id);
    if (!mem) return;
    mem.pinned = !mem.pinned;
    mem.updatedAt = now();
    saveMemories();
  }

  function deleteAllMemories() {
    memories = [];
    saveMemories();
  }

  /* ---------------- CONTEXT INJECTION ---------------- */
  function buildContextString() {
    if (!memories.length) return "";
    const sorted = [...memories].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.importance * b.confidence) - (a.importance * a.confidence);
    }).slice(0, MAX_MEMORIES_IN_CONTEXT);

    const byCat = {};
    sorted.forEach(m => {
      (byCat[m.category] = byCat[m.category] || []).push(m);
    });

    let out = "İSTİFADƏÇİ HAQQINDA UZUNMÜDDƏTLİ YADDAŞ (öncəki söhbətlərdən toplanıb, təbii şəkildə istifadə et, sadalama):\n";
    CATEGORY_KEYS.forEach(cat => {
      if (!byCat[cat]) return;
      out += `[${CATEGORIES[cat].label}] `;
      out += byCat[cat].map(m => m.content).join("; ");
      out += "\n";
    });
    return out.trim();
  }

  /* ---------------- EXTRACTION (LLM-driven) ---------------- */
  async function extractFromExchange(userText, aiText, convId) {
    if (typeof ALLOTE_CONFIG === "undefined") return;
    const key = (ALLOTE_CONFIG.GROQ_API_KEY || "").trim();
    if (!key) return;

    const meta = loadMeta();
    meta[convId] = (meta[convId] || 0) + 1;
    saveMeta(meta);
    if (meta[convId] % MIN_MSGS_BEFORE_EXTRACTION !== 0) return; // extract every other pair

    const extractionPrompt =
`Sən bir yaddaş çıxarma mühərrikisən. Aşağıdakı istifadəçi/AI dialoqundan istifadəçi haqqında UZUNMÜDDƏTLİ, gələcəkdə faydalı ola biləcək faktları çıxar.
Yalnız aşağıdakı kateqoriyalardan istifadə et: identity, preferences, projects, skills, goals, relationships, habits.
Hər fakt üçün: category, content (qısa, konkret, 3-ci şəxs kimi yaz, məs: "React və Tailwind ilə frontend layihələri qurur"), importance (1-10, nə qədər vacib/dəyişməz), confidence (0-1, nə qədər əmin), tags (1-4 açar söz).
Yalnız HƏQİQƏTƏN uzunmüddətli əhəmiyyəti olan şeyləri çıxar (ad, peşə, dil seçimləri, layihələr, məqsədlər, vərdişlər, maraqlar). Səthi, keçici və ya bir dəfəlik detalları ÇIXARMA.
Əgər heç bir uzunmüddətli fakt yoxdursa, boş massiv qaytar.
YALNIZ JSON qaytar, başqa heç nə: {"memories":[{"category":"...","content":"...","importance":N,"confidence":N,"tags":["..."]}]}

DİALOQ:
İstifadəçi: ${userText}
Allote AI: ${aiText}`;

    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: ALLOTE_CONFIG.GROQ_MODEL || "openai/gpt-oss-120b",
          messages: [
            { role: "system", content: "Sən sadəcə JSON qaytaran bir yaddaş çıxarma alətisən. Heç vaxt izah, şərh və ya markdown code-fence əlavə etmə." },
            { role: "user", content: extractionPrompt },
          ],
          temperature: 0.2,
          max_tokens: 700,
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      let raw = data?.choices?.[0]?.message?.content?.trim() || "";
      raw = raw.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
      let parsed;
      try { parsed = JSON.parse(raw); } catch (_) { return; }
      const list = Array.isArray(parsed?.memories) ? parsed.memories : [];
      let addedCount = 0, mergedCount = 0;
      list.forEach(item => {
        if (!item || !item.content) return;
        const before = memories.length;
        const result = addOrMergeMemory({ ...item, sourceConvId: convId });
        if (result) {
          if (memories.length > before) addedCount++; else mergedCount++;
        }
      });
      if (addedCount || mergedCount) {
        notifyMemoryActivity(addedCount, mergedCount);
        if (isDashboardOpen()) renderDashboard();
      }
    } catch (_) {
      // fail silently — memory extraction should never break chat
    }
  }

  function notifyMemoryActivity(added, merged) {
    const el = document.getElementById("memoryToast");
    if (!el) return;
    let msg = "";
    if (added) msg += `🧠 ${added} yeni xatirə`;
    if (merged) msg += (msg ? " · " : "") + `${merged} yeniləndi`;
    if (!msg) return;
    el.textContent = msg;
    el.classList.add("is-show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("is-show"), 2600);
  }

  /* ---------------- IMPORT / EXPORT ---------------- */
  function exportMemories() {
    const blob = new Blob([JSON.stringify({ exportedAt: now(), memories }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `allote-memories-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importMemoriesFromText(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { return { ok: false, count: 0 }; }
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.memories) ? parsed.memories : null;
    if (!list) return { ok: false, count: 0 };
    let count = 0;
    list.forEach(item => {
      if (!item || !item.content || !item.category) return;
      addOrMergeMemory(item);
      count++;
    });
    return { ok: true, count };
  }

  /* ================================================================
     DASHBOARD UI
     ================================================================ */
  function isDashboardOpen() {
    const overlay = document.getElementById("memoryOverlay");
    return overlay && overlay.classList.contains("is-open");
  }

  function iconSvg(name) {
    const icons = {
      user: '<path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z" stroke="currentColor" stroke-width="1.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
      heart: '<path d="M12 20s-7-4.35-9.5-8.8C.8 8 2.3 4.8 5.6 4.2c2-.36 3.7.6 4.9 2.3 1.2-1.7 2.9-2.66 4.9-2.3 3.3.6 4.8 3.8 3.1 7-2.5 4.45-9.5 8.8-9.5 8.8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
      folder: '<path d="M3 7a1.5 1.5 0 0 1 1.5-1.5h4.4l1.8 2.1H19.5A1.5 1.5 0 0 1 21 9.1V17a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17V7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
      bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
      flag: '<path d="M5 21V4m0 1.5 12 3.5-12 3.5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>',
      users: '<circle cx="8.5" cy="8" r="3.2" stroke="currentColor" stroke-width="1.6"/><circle cx="17" cy="9.5" r="2.4" stroke="currentColor" stroke-width="1.6"/><path d="M2.5 20a6 6 0 0 1 12 0M13.6 14a5 5 0 0 1 7.9 4.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
      clock: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v5l3.5 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    };
    return icons[name] || icons.user;
  }

  function statsHtml() {
    const total = memories.length;
    const avgConf = total ? Math.round((memories.reduce((s, m) => s + m.confidence, 0) / total) * 100) : 0;
    const pinned = memories.filter(m => m.pinned).length;
    return `
      <div class="mem-stat"><span class="mem-stat__num">${total}</span><span class="mem-stat__label">Ümumi</span></div>
      <div class="mem-stat"><span class="mem-stat__num">${pinned}</span><span class="mem-stat__label">Sancaqlı</span></div>
      <div class="mem-stat"><span class="mem-stat__num">${avgConf}%</span><span class="mem-stat__label">Orta əminlik</span></div>
    `;
  }

  function filteredSortedMemories() {
    let list = [...memories];
    if (dashboardState.category === "pinned") list = list.filter(m => m.pinned);
    else if (dashboardState.category !== "all") list = list.filter(m => m.category === dashboardState.category);

    if (dashboardState.search.trim()) {
      const q = dashboardState.search.trim().toLowerCase();
      list = list.filter(m =>
        m.content.toLowerCase().includes(q) ||
        (m.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }

    switch (dashboardState.sort) {
      case "recent": list.sort((a, b) => b.updatedAt - a.updatedAt); break;
      case "alpha": list.sort((a, b) => a.content.localeCompare(b.content, "az")); break;
      case "confidence": list.sort((a, b) => b.confidence - a.confidence); break;
      default: list.sort((a, b) => (b.pinned - a.pinned) || (b.importance - a.importance));
    }
    return list;
  }

  function memoryCardHtml(m) {
    const cat = CATEGORIES[m.category] || CATEGORIES.identity;
    const connCount = (m.connections || []).length;
    const isEditing = editingId === m.id;
    return `
      <div class="mem-card" data-id="${m.id}" style="--cat-color:${cat.color}">
        <div class="mem-card__top">
          <span class="mem-badge">
            <svg viewBox="0 0 24 24" fill="none">${iconSvg(cat.icon)}</svg>
            ${cat.label}
          </span>
          <div class="mem-card__actions">
            <button class="mem-icon-btn ${m.pinned ? "is-active" : ""}" data-action="pin" title="Sancaqla" aria-label="Sancaqla">
              <svg viewBox="0 0 24 24" fill="${m.pinned ? "currentColor" : "none"}"><path d="M12 2.5 14 9l6 1-4.5 4.2L16.7 21 12 17.8 7.3 21l1.2-6.8L4 10l6-1 2-6.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
            </button>
            <button class="mem-icon-btn" data-action="edit" title="Redaktə et" aria-label="Redaktə et">
              <svg viewBox="0 0 24 24" fill="none"><path d="m15 4 5 5-11 11H4v-5L15 4Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
            </button>
            <button class="mem-icon-btn mem-icon-btn--danger" data-action="delete" title="Sil" aria-label="Sil">
              <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 .7 12a2 2 0 0 0 2 1.9h4.6a2 2 0 0 0 2-1.9L17 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>

        ${isEditing ? `
          <textarea class="mem-card__edit-input" data-edit-input>${escapeHtml(m.content)}</textarea>
          <div class="mem-card__edit-actions">
            <button class="mem-mini-btn" data-action="save-edit">Yadda saxla</button>
            <button class="mem-mini-btn mem-mini-btn--ghost" data-action="cancel-edit">İmtina</button>
          </div>
        ` : `<p class="mem-card__content">${escapeHtml(m.content)}</p>`}

        <div class="mem-card__bars">
          <div class="mem-bar" title="Vacibliq">
            <span class="mem-bar__label">Vacibliq</span>
            <div class="mem-bar__track"><div class="mem-bar__fill" style="width:${m.importance * 10}%"></div></div>
          </div>
          <div class="mem-bar" title="Əminlik">
            <span class="mem-bar__label">Əminlik</span>
            <div class="mem-bar__track"><div class="mem-bar__fill mem-bar__fill--alt" style="width:${Math.round(m.confidence * 100)}%"></div></div>
          </div>
        </div>

        ${(m.tags && m.tags.length) ? `<div class="mem-tags">${m.tags.map(t => `<span class="mem-tag">#${escapeHtml(t)}</span>`).join("")}</div>` : ""}

        <div class="mem-card__meta">
          <span title="Yaradılıb">✦ ${relativeTime(m.createdAt)}</span>
          <span title="Yenilənib">↻ ${relativeTime(m.updatedAt)}</span>
          ${connCount ? `<span class="mem-card__conn" title="Əlaqəli xatirələr">⌁ ${connCount} əlaqə</span>` : ""}
        </div>
      </div>
    `;
  }

  function timelineHtml(list) {
    const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
    let lastDay = "";
    let html = "";
    sorted.forEach(m => {
      const day = new Date(m.createdAt).toLocaleDateString("az-AZ", { day: "2-digit", month: "long", year: "numeric" });
      if (day !== lastDay) {
        html += `<div class="mem-timeline__day">${day}</div>`;
        lastDay = day;
      }
      const cat = CATEGORIES[m.category] || CATEGORIES.identity;
      html += `
        <div class="mem-timeline__item" data-id="${m.id}" style="--cat-color:${cat.color}">
          <div class="mem-timeline__dot"></div>
          <div class="mem-timeline__body">
            <span class="mem-badge mem-badge--sm"><svg viewBox="0 0 24 24" fill="none">${iconSvg(cat.icon)}</svg>${cat.label}</span>
            <p>${escapeHtml(m.content)}</p>
            <span class="mem-timeline__time">${new Date(m.createdAt).toLocaleTimeString("az-AZ", { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        </div>
      `;
    });
    return html || emptyStateHtml();
  }

  function emptyStateHtml() {
    return `
      <div class="mem-empty">
        <svg viewBox="0 0 24 24" fill="none" width="46" height="46"><path d="M12 2.5a5.5 5.5 0 0 0-5.5 5.5c0 1.6.7 2.9 1.6 3.9-.9.6-1.6 1.7-1.6 3.1a3.5 3.5 0 0 0 3.5 3.5h4a3.5 3.5 0 0 0 3.5-3.5c0-1.4-.7-2.5-1.6-3.1.9-1 1.6-2.3 1.6-3.9A5.5 5.5 0 0 0 12 2.5Z" stroke="currentColor" stroke-width="1.4"/></svg>
        <p>Hələ heç bir xatirə yoxdur. Allote ilə danışdıqca burada avtomatik toplanacaq.</p>
      </div>
    `;
  }

  function categoryChipsHtml() {
    const counts = {};
    memories.forEach(m => { counts[m.category] = (counts[m.category] || 0) + 1; });
    const pinnedCount = memories.filter(m => m.pinned).length;
    let html = `<button class="mem-chip ${dashboardState.category === "all" ? "is-active" : ""}" data-cat="all">Hamısı <em>${memories.length}</em></button>`;
    html += `<button class="mem-chip ${dashboardState.category === "pinned" ? "is-active" : ""}" data-cat="pinned">📌 Sancaqlı <em>${pinnedCount}</em></button>`;
    CATEGORY_KEYS.forEach(key => {
      const cat = CATEGORIES[key];
      const c = counts[key] || 0;
      html += `<button class="mem-chip ${dashboardState.category === key ? "is-active" : ""}" data-cat="${key}" style="--cat-color:${cat.color}">
        <svg viewBox="0 0 24 24" fill="none">${iconSvg(cat.icon)}</svg>${cat.label} <em>${c}</em>
      </button>`;
    });
    return html;
  }

  function renderDashboard() {
    const statsEl = document.getElementById("memStats");
    const chipsEl = document.getElementById("memChips");
    const bodyEl = document.getElementById("memBody");
    if (!statsEl || !chipsEl || !bodyEl) return;

    statsEl.innerHTML = statsHtml();
    chipsEl.innerHTML = categoryChipsHtml();

    const list = filteredSortedMemories();
    if (dashboardState.view === "timeline") {
      bodyEl.className = "mem-body mem-body--timeline";
      bodyEl.innerHTML = timelineHtml(list);
    } else {
      bodyEl.className = "mem-body mem-body--grid";
      bodyEl.innerHTML = list.length ? list.map(memoryCardHtml).join("") : emptyStateHtml();
    }

    bindCardEvents();
  }

  function bindCardEvents() {
    document.querySelectorAll(".mem-card").forEach(card => {
      const id = card.dataset.id;
      card.querySelectorAll("[data-action]").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          if (action === "pin") { togglePin(id); renderDashboard(); }
          if (action === "delete") {
            if (confirm("Bu xatirəni silmək istəyirsən?")) { deleteMemory(id); renderDashboard(); }
          }
          if (action === "edit") { editingId = id; renderDashboard(); }
          if (action === "cancel-edit") { editingId = null; renderDashboard(); }
          if (action === "save-edit") {
            const ta = card.querySelector("[data-edit-input]");
            const val = ta ? ta.value.trim() : "";
            if (val) updateMemory(id, { content: val });
            editingId = null;
            renderDashboard();
          }
        });
      });
    });
  }

  function bindDashboardChrome() {
    const overlay = document.getElementById("memoryOverlay");
    const closeBtn = document.getElementById("closeMemory");
    const searchInput = document.getElementById("memSearch");
    const sortSelect = document.getElementById("memSort");
    const viewGridBtn = document.getElementById("memViewGrid");
    const viewTimelineBtn = document.getElementById("memViewTimeline");
    const exportBtn = document.getElementById("memExport");
    const importBtn = document.getElementById("memImportBtn");
    const importInput = document.getElementById("memImportInput");
    const clearAllBtn = document.getElementById("memClearAll");
    const addBtn = document.getElementById("memAddBtn");
    const chipsEl = document.getElementById("memChips");

    closeBtn.addEventListener("click", closeDashboard);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeDashboard(); });

    searchInput.addEventListener("input", () => {
      dashboardState.search = searchInput.value;
      renderDashboard();
    });
    sortSelect.addEventListener("change", () => {
      dashboardState.sort = sortSelect.value;
      renderDashboard();
    });
    viewGridBtn.addEventListener("click", () => {
      dashboardState.view = "grid";
      viewGridBtn.classList.add("is-active");
      viewTimelineBtn.classList.remove("is-active");
      renderDashboard();
    });
    viewTimelineBtn.addEventListener("click", () => {
      dashboardState.view = "timeline";
      viewTimelineBtn.classList.add("is-active");
      viewGridBtn.classList.remove("is-active");
      renderDashboard();
    });
    chipsEl.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-cat]");
      if (!chip) return;
      dashboardState.category = chip.dataset.cat;
      renderDashboard();
    });
    exportBtn.addEventListener("click", exportMemories);
    importBtn.addEventListener("click", () => importInput.click());
    importInput.addEventListener("change", async () => {
      const file = importInput.files[0];
      if (!file) return;
      const text = await file.text();
      const result = importMemoriesFromText(text);
      importInput.value = "";
      if (result.ok) {
        notifyMemoryActivity(result.count, 0);
        renderDashboard();
      } else {
        alert("Fayl düzgün formatda deyil.");
      }
    });
    clearAllBtn.addEventListener("click", () => {
      if (!memories.length) return;
      if (confirm("BÜTÜN xatirələr həmişəlik silinsin? Bu geri qaytarıla bilməz.")) {
        deleteAllMemories();
        renderDashboard();
      }
    });
    addBtn.addEventListener("click", () => {
      const content = prompt("Yeni xatirə (məs: \"React və Node.js ilə işləyir\"):");
      if (!content || !content.trim()) return;
      const category = prompt(
        "Kateqoriya seç: " + CATEGORY_KEYS.map(k => `${k} (${CATEGORIES[k].label})`).join(", "),
        "identity"
      );
      const finalCat = CATEGORY_KEYS.includes((category || "").trim()) ? category.trim() : "identity";
      addOrMergeMemory({ category: finalCat, content: content.trim(), importance: 6, confidence: 0.9 });
      renderDashboard();
    });
  }

  function openDashboard() {
    const overlay = document.getElementById("memoryOverlay");
    if (!overlay) return;
    overlay.classList.add("is-open");
    renderDashboard();
  }
  function closeDashboard() {
    const overlay = document.getElementById("memoryOverlay");
    if (!overlay) return;
    overlay.classList.remove("is-open");
    editingId = null;
  }

  /* ---------------- INIT ---------------- */
  function init() {
    memories = loadMemories();
    const memoryBtn = document.getElementById("memoryBtn");
    if (memoryBtn) memoryBtn.addEventListener("click", openDashboard);
    if (document.getElementById("memoryOverlay")) bindDashboardChrome();
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDashboard();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* ---------------- PUBLIC API ---------------- */
  window.AllotteMemory = {
    extractFromExchange,
    buildContextString,
    openDashboard,
    closeDashboard,
    get count() { return memories.length; },
  };
})();
