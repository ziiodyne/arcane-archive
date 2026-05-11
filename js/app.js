const DB_KEY = "arcaneArchiveDB";
const SETTINGS_KEY = "arcaneArchiveSettings";

const settings = {
  localOnly: true,
  labelAI: true,
  requireReview: true,
  useASR: true,
  asrPort: 8000,
  asrMode: "fast",
  warnLarge: true
};


const state = {
  db: null,
  campaigns: [],
  activeCampaignId: null,

  // these two are always for the ACTIVE campaign
  sessions: [],
  activeId: null,

  get campaign(){
    return state.campaigns.find(c => c.id === state.activeCampaignId) || null;
  },
  get session(){
    return state.sessions.find(s => s.id === state.activeId) || state.sessions[0] || null;
  }
};

function uid(prefix="id"){
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function loadDB(){
  // New DB format
  try{
    const raw = localStorage.getItem(DB_KEY);
    if (raw){
      const db = JSON.parse(raw);
      if (db && Array.isArray(db.campaigns)){
        state.db = db;
        state.campaigns = db.campaigns;
        state.activeCampaignId = db.activeCampaignId || (db.campaigns[0]?.id ?? null);
        syncActiveCampaign();
        return;
      }
    }
  }catch(e){
    console.warn("DB parse failed, rebuilding.", e);
  }

  // Migration: old sessions key -> one default campaign
  let migratedSessions = [];
  try{
    const old = localStorage.getItem("arcaneArchiveSessions");
    if (old){
      migratedSessions = JSON.parse(old) || [];
    }
  }catch{}

  const defaultCampaign = {
    id: uid("camp"),
    name: "My Campaign",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sessions: Array.isArray(migratedSessions) ? migratedSessions : [],
    entities: { characters: {}, locations: {}, factions: {} },
    threads: {}
  };

  state.campaigns = [defaultCampaign];
  state.activeCampaignId = defaultCampaign.id;

  state.db = { campaigns: state.campaigns, activeCampaignId: state.activeCampaignId };
  saveDB();
  syncActiveCampaign();
}

function saveDB(){
  state.db = { campaigns: state.campaigns, activeCampaignId: state.activeCampaignId };
  localStorage.setItem(DB_KEY, JSON.stringify(state.db));
}

function syncActiveCampaign(){
  const camp = state.campaign;
  if (!camp){
    state.sessions = [];
    state.activeId = null;
    return;
  }
  // ensure fields exist
  camp.sessions = camp.sessions || [];
  camp.entities = camp.entities || { characters:{}, locations:{}, factions:{} };
  camp.threads = camp.threads || {};
  state.sessions = camp.sessions;
  // keep active session inside this campaign
  if (!state.activeId || !state.sessions.find(s => s.id === state.activeId)){
    state.activeId = state.sessions[0]?.id ?? null;
  }
}


function setTopbar(title, meta){
  const t = document.getElementById("topTitle");
  const m = document.getElementById("topMeta");
  if (t) t.textContent = title;
  if (m) m.textContent = meta;
}

function showView(name){
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(`view-${name}`)?.classList.add("active");

  document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
  document.querySelector(`.nav-item[data-view="${name}"]`)?.classList.add("active");

  const meta = {
    dashboard: "Choose a campaign and start a session.",
    record: "Record audio, then transcribe + organize.",
    processing: "Turning audio into structured memory.",
    session: "Review transcript + structured notes.",
    search: "Search across all saved sessions (prototype).",
    settings: "Prototype toggles + boundaries."
  };

  setTopbar(
    name.charAt(0).toUpperCase() + name.slice(1),
    meta[name] || ""
  );
}

/* ---------- Storage ---------- */
function makeEmptySession(title){
  return {
    id: crypto.randomUUID(),
    title: title || "Untitled Session",
    date: new Date().toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" }),
    transcriptChunks: [],
    summary: "",
    characters: [], // [{name, approved}]
    locations: [],  // [{name, approved}]
    threads: [],    // [{text, time}]
    timeline: []    // [{time, text}]
  };
}

function loadSessions(){
  // Backwards compatible entrypoint used by pipeline/recorder.
  loadDB();
}

function saveSessions(){
  const camp = state.campaign;
  if (camp){
    camp.sessions = state.sessions;
    camp.updatedAt = Date.now();
  }
  saveDB();
  renderCampaignUI();
  renderCampaignUI();
  renderSessionList();
  renderTopContext();
  renderKPIs();
}

/* ---------- Settings ---------- */
function loadSettings(){
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return;
  try{
    const parsed = JSON.parse(raw);
    Object.assign(settings, parsed || {});
  } catch{}
}

function saveSettings(){
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

async function checkASROnline(){
  if (!settings.useASR) return false;
  try{
    const res = await fetch(`http://127.0.0.1:${settings.asrPort}/health`, { cache: "no-store" });
    return res.ok;
  } catch{
    return false;
  }
}

function wireSettings(){
  const elLocal = document.getElementById("settingLocalOnly");
  const elLabel = document.getElementById("settingLabelAI");
  const elReview = document.getElementById("settingRequireReview");
  const elUseASR = document.getElementById("settingUseASR");
  const elMode = document.getElementById("settingASRMode");
  const elWarn = document.getElementById("settingWarnLarge");
  const elStatus = document.getElementById("asrStatus");
  const btnCheck = document.getElementById("btnCheckASR");

  if (elLocal) elLocal.checked = !!settings.localOnly;
  if (elLabel) elLabel.checked = !!settings.labelAI;
  if (elReview) elReview.checked = !!settings.requireReview;
  if (elUseASR) elUseASR.checked = !!settings.useASR;
  if (elMode) elMode.value = settings.asrMode || "fast";
  if (elWarn) elWarn.checked = settings.warnLarge !== false;

  const updateAIUI = () => {
    const badge = document.getElementById("badgeAIGenerated");
    if (badge) badge.style.display = settings.labelAI ? "" : "none";
  };
  updateAIUI();

  const updateStatus = (online) => {
    if (!elStatus) return;
    if (!settings.useASR){
      elStatus.textContent = "Off";
      return;
    }
    elStatus.textContent = online ? "Online" : "Offline";
  };

  const refreshStatus = async () => {
    const online = await checkASROnline();
    updateStatus(online);
  };

  elLocal?.addEventListener("change", () => { settings.localOnly = elLocal.checked; saveSettings(); });
  elLabel?.addEventListener("change", () => { settings.labelAI = elLabel.checked; saveSettings(); updateAIUI(); });
  elReview?.addEventListener("change", () => { settings.requireReview = elReview.checked; saveSettings(); });
  elUseASR?.addEventListener("change", () => { settings.useASR = elUseASR.checked; saveSettings(); refreshStatus(); });
  elMode?.addEventListener("change", () => { settings.asrMode = elMode.value; saveSettings(); });
  elWarn?.addEventListener("change", () => { settings.warnLarge = elWarn.checked; saveSettings(); });
  btnCheck?.addEventListener("click", refreshStatus);
  refreshStatus();
}


/* ---------- Rendering ---------- */
function renderTranscript(chunks){
  const el = document.getElementById("transcript");
  if (!el) return;
  el.innerHTML = "";

  (chunks || []).forEach(c => {
    const div = document.createElement("div");
    div.className = "chunk";
    div.dataset.text = c.text;

    div.innerHTML = `
      <div class="time">${escapeHtml(c.time || "--:--")}</div>
      <div class="text">${escapeHtml(c.text || "")}</div>
    `;
    el.appendChild(div);
  });
}

function makeConfirmChip(entity){
  const wrap = document.createElement("div");
  wrap.className = "chip-confirm " + (entity.approved ? "" : "unapproved");

  const chip = document.createElement("button");
  chip.className = "chip";
  chip.type = "button";
  chip.textContent = entity.name;

  chip.addEventListener("click", () => highlightInTranscript(entity.name, true));

  const toggle = document.createElement("button");
  toggle.className = "approve-btn";
  toggle.type = "button";
  toggle.textContent = entity.approved ? "Approved" : "Removed";

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    entity.approved = !entity.approved;
    toggle.textContent = entity.approved ? "Approved" : "Removed";
    wrap.classList.toggle("unapproved", !entity.approved);
    saveSessions();
  });

  wrap.appendChild(chip);
  wrap.appendChild(toggle);
  return wrap;
}

function renderOrganized(){
  const s = state.session;
  if (!s) return;

  const nameEl = document.getElementById("sessionName");
  const dateEl = document.getElementById("sessionDate");
  if (nameEl) nameEl.textContent = s.title || "Untitled Session";
  if (dateEl) dateEl.textContent = s.date || "";

  const pending = document.getElementById("pendingBadge");
  if (pending) pending.style.display = s.pendingReview ? "" : "none";

  const summaryBox = document.getElementById("summaryBox");
  if (summaryBox) summaryBox.textContent = s.summary || "(Summary will appear here.)";

  const chars = document.getElementById("characters");
  if (chars){
    chars.innerHTML = "";
    (s.characters || []).forEach(ent => chars.appendChild(makeConfirmChip(ent)));
  }

  const locs = document.getElementById("locations");
  if (locs){
    locs.innerHTML = "";
    (s.locations || []).forEach(ent => locs.appendChild(makeConfirmChip(ent)));
  }

  const facs = document.getElementById("factions");
  if (facs){
    facs.innerHTML = "";
    (s.factions || []).forEach(ent => facs.appendChild(makeConfirmChip(ent)));
  }

  const threads = document.getElementById("threads");
  if (threads){
    threads.innerHTML = "";
    (s.threads || []).forEach(t => {
      const li = document.createElement("li");
      li.className = "thread-item";
      const prefix = t.time ? `${t.time} · ` : "";
      li.innerHTML = `<strong>${escapeHtml(prefix)}</strong>${escapeHtml(t.text || "")}`;

      li.addEventListener("click", () => {
        if (t.time) jumpToTime(t.time);
        else highlightInTranscript((t.text || "").split(" ").slice(0, 5).join(" "), true);
      });

      threads.appendChild(li);
    });
  }

  const timeline = document.getElementById("timeline");
  if (timeline){
    timeline.innerHTML = "";
    (s.timeline || []).forEach(e => {
      const div = document.createElement("div");
      div.className = "event";
      const prefix = e.time ? `${e.time} · ` : "";
      div.textContent = `${prefix}${e.text || ""}`;
      div.addEventListener("click", () => {
        if (e.time) jumpToTime(e.time);
      });
      timeline.appendChild(div);
    });
  }
}


function renderCampaignUI(){
  renderTopContext();
  const dash = document.getElementById("dashCampaignName");
  if (dash) dash.textContent = state.campaign?.name || "No campaign selected";
}

function renderTopContext(){
  const el = document.getElementById("topContext");
  const c = state.campaign;
  const s = state.session;
  if (!el){ return; }
  if (!c){ el.textContent = "None"; return; }
  if (!s){ el.textContent = `${c.name}`; return; }
  el.textContent = `"${s.title || "Untitled Session"}" in ${c.name || "Campaign"}`;
}



function renderSessionList(){
  // legacy: now handled by renderCampaignTree
  renderCampaignTree();
}



function renderCampaignTree(){
  const tree = document.getElementById("campaignTree");
  if (!tree) return;

  tree.innerHTML = "";

  if (!state.campaigns.length){
    tree.innerHTML = `<div class="empty-sessions"><div class="muted">No campaigns yet.</div></div>`;
    return;
  }

  state._treeOpenMap = state._treeOpenMap || {};

  state.campaigns.forEach(c => {
    const isActive = c.id === state.activeCampaignId;
    const isOpen = state._treeOpenMap[c.id] ?? isActive;

    const wrap = document.createElement("div");
    wrap.className = "tree-campaign";

    wrap.innerHTML = `
      <div class="tree-campaign-header" data-camp="${c.id}">
        <div class="tree-campaign-name" title="${escapeHtml(c.name || "Campaign")}">
          <span class="name">${escapeHtml(c.name || "Campaign")}</span>
          <span class="pencil" title="Rename">✎</span>
        </div>
        <div class="row" style="gap:.35rem; align-items:center;">
          <span class="campMenuIcon" title="Campaign options">⋯</span>
          <div class="tree-chevron">${isOpen ? "▾" : "▸"}</div>
        </div>
      </div>
      <div class="tree-sessions" style="${isOpen ? "" : "display:none;"}"></div>
    `;

    const header = wrap.querySelector(".tree-campaign-header");
    const nameWrap = wrap.querySelector(".tree-campaign-name");
    const sessionsBox = wrap.querySelector(".tree-sessions");

    header.addEventListener("click", (e) => {
      if (e.target && (e.target.classList.contains("pencil") || e.target.classList.contains("campMenuIcon") || e.target.tagName === "INPUT")) return;

      state.activeCampaignId = c.id;
      syncActiveCampaign();
      saveDB();

      state._treeOpenMap[c.id] = !(state._treeOpenMap[c.id] ?? isOpen);
      renderAll();
    });


    // Campaign menu: small popover with Rename / Delete
    const menuIcon = wrap.querySelector(".campMenuIcon");
    const closeMenus = () => {
      document.querySelectorAll(".popMenu").forEach(n => n.remove());
    };
    const openMenu = (anchorEl) => {
      closeMenus();
      const r = anchorEl.getBoundingClientRect();
      const menu = document.createElement("div");
      menu.className = "popMenu";
      menu.innerHTML = `
        <button type="button" class="rename">Rename</button>
        <button type="button" class="danger delete">Delete</button>
      `;
      menu.style.left = `${Math.min(window.innerWidth - 180, r.left)}px`;
      menu.style.top  = `${r.bottom + 8}px`;

      menu.querySelector(".rename")?.addEventListener("click", (e) => {
        e.stopPropagation();
        closeMenus();
        const next = prompt("New campaign name?", c.name || "Campaign");
        if (!next) return;
        c.name = next.trim();
        c.updatedAt = Date.now();
        saveDB();
        renderAll();
      });

      menu.querySelector(".delete")?.addEventListener("click", (e) => {
        e.stopPropagation();
        closeMenus();
        const ok = confirm(`Delete campaign "${c.name}" and ALL its sessions? This cannot be undone.`);
        if (!ok) return;
        state.campaigns = state.campaigns.filter(x => x.id !== c.id);
        if (state.activeCampaignId === c.id){
          state.activeCampaignId = state.campaigns[0]?.id || null;
          syncActiveCampaign();
          state.activeId = null;
        }
        saveDB();
        renderAll();
        showView("dashboard");
      });

      const onDoc = (ev) => {
        if (!menu.contains(ev.target)) closeMenus();
      };
      const onKey = (ev) => {
        if (ev.key === "Escape") closeMenus();
      };
      setTimeout(() => {
        document.addEventListener("click", onDoc, { once: true });
        document.addEventListener("keydown", onKey, { once: true });
      }, 0);

      document.body.appendChild(menu);
    };

    menuIcon?.addEventListener("click", (e) => {
      e.stopPropagation();
      openMenu(menuIcon);
    });



    function startRename(){
      const current = c.name || "Campaign";
      nameWrap.innerHTML = `<input type="text" value="${escapeHtml(current)}" />`;
      const input = nameWrap.querySelector("input");
      input.focus();
      input.select();

      const commit = () => {
        const next = input.value.trim();
        if (next){
          c.name = next;
          c.updatedAt = Date.now();
          saveDB();
        }
        renderAll();
      };

      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") commit();
        if (ev.key === "Escape") renderAll();
      });
      input.addEventListener("blur", commit);
    }

    nameWrap.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      startRename();
    });
    wrap.querySelector(".pencil")?.addEventListener("click", (e) => {
      e.stopPropagation();
      startRename();
    });

    const sessions = (c.sessions || []);
    if (!sessions.length){
      sessionsBox.innerHTML = `
        <div class="empty-sessions">
          <div class="muted" style="margin-bottom:.6rem;">No sessions yet.</div>
          <button class="btn primary" type="button">Create session</button>
        </div>
      `;
      sessionsBox.querySelector("button")?.addEventListener("click", (e) => {
        e.stopPropagation();
        state.activeCampaignId = c.id;
        syncActiveCampaign();
        saveDB();
        renderAll();
        showView("record");
        document.getElementById("sessionTitle")?.focus();
      });
    } else {
      sessions.forEach(s => {
        const row = document.createElement("div");
        row.className = "tree-session";
        const isActiveSession = (c.id === state.activeCampaignId) && (s.id === state.activeId);
        if (isActiveSession) row.classList.add("active");
        const threads = (s.threads || []).filter(t => t && t.approved !== false);
        row.innerHTML = `
          <div style="min-width:0;">
            <div class="tree-session-title" style="font-weight:900; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:18ch;">${escapeHtml(s.title || "Untitled Session")}</div>
            <div class="meta">${escapeHtml(s.date || "")} · Threads: ${threads.length}</div>
          </div>
          <button class="btn secondary tiny" type="button">Open</button>
        `;

        // Inline rename on double-click
        const titleEl = row.querySelector(".tree-session-title");
        titleEl?.addEventListener("dblclick", (ev) => {
          ev.stopPropagation();
          const current = s.title || "Untitled Session";
          titleEl.innerHTML = `<input class="input" style="height:30px; padding:.25rem .4rem;" value="${escapeHtml(current)}" />`;
          const input = titleEl.querySelector("input");
          input.focus();
          input.select();

          const commit = () => {
            const next = input.value.trim();
            if (next){
              s.title = next;
              c.updatedAt = Date.now();
              saveDB();
            }
            renderAll();
          };

          input.addEventListener("keydown", (k) => {
            if (k.key === "Enter") commit();
            if (k.key === "Escape") renderAll();
          });
          input.addEventListener("blur", commit);
        });

        row.querySelector("button")?.addEventListener("click", (e) => {
          e.stopPropagation();
          state.activeCampaignId = c.id;
          syncActiveCampaign();
          state.activeId = s.id;
          saveDB();
          renderAll();
          showView("session");
        });
        sessionsBox.appendChild(row);
      });
    }


    // Campaign footer action: create a new session (only when expanded + has sessions)
    if (isOpen && (c.sessions || []).length){
      const footer = document.createElement("div");
      footer.style.marginTop = ".35rem";
      footer.innerHTML = `<button class="btn primary" type="button" style="width:100%;">+ New Session</button>`;
      footer.querySelector("button")?.addEventListener("click", (e) => {
        e.stopPropagation();
        createNewSessionInCampaign(c.id);
      });
      sessionsBox.appendChild(footer);
    }


    if (isActive){
      wrap.style.borderColor = "rgba(255,255,255,.18)";
      wrap.style.background = "rgba(255,255,255,.05)";
    }

    tree.appendChild(wrap);
  });

  const btnToggle = document.getElementById("btnToggleSessions");
  if (btnToggle){
    const c = state.campaign;
    if (c){
      const open = state._treeOpenMap[c.id] ?? true;
      btnToggle.textContent = open ? "Collapse" : "Expand";
      btnToggle.onclick = () => {
        state._treeOpenMap[c.id] = !open;
        renderCampaignTree();
      };
    } else {
      btnToggle.textContent = "Expand";
    }
  }
}



function renderKPIs(){
  const totalSessions = state.sessions.length;
  const openThreads = state.sessions.reduce((acc,s) => acc + (s.threads||[]).length, 0);

  const entities = state.sessions.reduce((acc,s) => {
    const c = (s.characters||[]).filter(x => x.approved !== false).length;
    const l = (s.locations||[]).filter(x => x.approved !== false).length;
    return acc + c + l;
  }, 0);

  const a = document.getElementById("kpiSessions");
  const b = document.getElementById("kpiThreads");
  const c = document.getElementById("kpiEntities");
  if (a) a.textContent = String(totalSessions);
  if (b) b.textContent = String(openThreads);
  if (c) c.textContent = String(entities);
}

function renderAll(){
  const s = state.session;
  renderTranscript(s?.transcriptChunks || []);
  if (s) renderOrganized();
  else {
    // Clear session view when nothing is active
    const nameEl = document.getElementById("sessionName");
    const dateEl = document.getElementById("sessionDate");
    if (nameEl) nameEl.textContent = "No active session";
    if (dateEl) dateEl.textContent = "";
    const pending = document.getElementById("pendingBadge");
    if (pending) pending.style.display = "none";
    const summaryBox = document.getElementById("summaryBox");
    if (summaryBox) summaryBox.textContent = "Let\'s start a new session.";
    ["characters","locations","factions"].forEach(id=>{ const el=document.getElementById(id); if(el) el.innerHTML=""; });
    const threads = document.getElementById("threads");
    if (threads) threads.innerHTML = "";
    const timeline = document.getElementById("timeline");
    if (timeline) timeline.innerHTML = "";
  }
  renderCampaignUI();
  renderSessionList();
  renderTopContext();
  renderKPIs();
}

/* ---------- Transcript interactions ---------- */
function highlightInTranscript(term, scrollToFirst = false){
  const q = (term || "").trim();
  if (!q) return;

  let firstMatch = null;

  document.querySelectorAll(".chunk").forEach(ch => {
    const raw = ch.dataset.text || "";
    const safe = escapeHtml(raw);
    const re = new RegExp(`(${escapeRegExp(q)})`, "gi");

    if (re.test(raw) && !firstMatch) firstMatch = ch;
    const t = ch.querySelector(".text");
    if (t) t.innerHTML = safe.replace(re, "<mark>$1</mark>");
  });

  if (scrollToFirst && firstMatch){
    firstMatch.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function jumpToTime(time){
  const target = [...document.querySelectorAll(".chunk")]
    .find(ch => (ch.querySelector(".time")?.textContent || "") === time);

  if (target){
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.style.outline = "2px solid rgba(58,110,165,0.65)";
    setTimeout(() => target.style.outline = "", 900);
  }
}

/* ---------- Wiring ---------- */
function wireNav(){
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });

  document.querySelectorAll("[data-goto]").forEach(btn => {
    btn.addEventListener("click", () => showView(btn.dataset.goto));
  });
}

function wireTabs(){
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".panel");
  tabs.forEach(t => {
    t.addEventListener("click", () => {
      tabs.forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      panels.forEach(p => p.classList.remove("active"));
      document.getElementById(`panel-${t.dataset.tab}`)?.classList.add("active");
    });
  });
}

function wireTranscriptSearch(){
  const input = document.getElementById("transcriptSearch");
  if (!input) return;

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll(".chunk").forEach(ch => {
      const raw = (ch.dataset.text || "").toLowerCase();
      ch.style.display = raw.includes(q) ? "" : "none";
    });
  });
}


function wireCampaignMemory(){
  const filter = document.getElementById("memoryType");
  const search = document.getElementById("memorySearch");
  const list = document.getElementById("memoryResults");
  const editor = document.getElementById("memoryEditor");

  function currentBucket(){
    const t = filter?.value || "characters";
    return t;
  }

  function getBucket(){
    const c = state.campaign;
    if (!c) return {};
    const bucket = c.entities?.[currentBucket()] || {};
    return bucket;
  }

  function renderList(){
    if (!list) return;
    list.innerHTML = "";
    const c = state.campaign;
    if (!c){
      list.innerHTML = `<div class="muted">Select or create a campaign first.</div>`;
      if (editor) editor.innerHTML = `<div class="muted">No campaign selected.</div>`;
      return;
    }

    const q = (search?.value || "").trim().toLowerCase();
    const bucket = Object.values(getBucket())
      .filter(e => !q || (e.name||"").toLowerCase().includes(q))
      .sort((a,b) => (a.name||"").localeCompare(b.name||""));

    if (!bucket.length){
      list.innerHTML = `<div class="muted">No matches.</div>`;
      if (editor) editor.innerHTML = `<div class="muted">Select an item to edit, or add a new one.</div>`;
      return;
    }

    bucket.forEach(ent => {
      const row = document.createElement("div");
      row.className = "result-row";
      row.innerHTML = `
        <div>
          <div class="result-title">${escapeHtml(ent.name || "Untitled")}</div>
          <div class="result-meta">${escapeHtml(ent.provenance || "user")} · Evidence: ${(ent.evidence||[]).length}</div>
        </div>
        <button class="btn secondary tiny" type="button">Edit</button>
      `;
      row.querySelector("button").addEventListener("click", () => openEditor(ent.id));
      list.appendChild(row);
    });
  }

  function openEditor(id){
    if (!editor) return;
    const c = state.campaign;
    if (!c) return;

    const bucketKey = currentBucket();
    const bucket = c.entities[bucketKey] || {};
    const ent = bucket[id];
    if (!ent){
      editor.innerHTML = `<div class="muted">Not found.</div>`;
      return;
    }

    editor.innerHTML = `
      <div class="row" style="justify-content:space-between; align-items:center;">
        <div style="font-weight:900;">Edit ${bucketKey.slice(0,-1)}</div>
        <button id="btnDeleteEntity" class="btn danger tiny" type="button">Delete</button>
      </div>

      <div class="spacer"></div>
      <label class="label">Name</label>
      <input id="entName" class="input" value="${escapeHtml(ent.name || "")}" />

      <div class="spacer"></div>
      <label class="label">Tags (comma-separated)</label>
      <input id="entTags" class="input" value="${escapeHtml((ent.tags||[]).join(", "))}" />

      <div class="spacer"></div>
      <label class="label">Notes (you write canon here)</label>
      <textarea id="entNotes" class="input" style="min-height:140px;">${escapeHtml(ent.notes || "")}</textarea>

      <div class="spacer"></div>
      <div class="row" style="gap:.5rem;">
        <button id="btnSaveEntity" class="btn primary" type="button">Save</button>
        <button id="btnCloseEntity" class="btn secondary" type="button">Close</button>
      </div>

      <div class="spacer"></div>
      <div class="callout">
        <div class="callout-title">Evidence (grounding)</div>
        <div class="muted">${(ent.evidence||[]).slice(0,6).map(ev => `${escapeHtml(ev.sessionTitle||ev.sessionId||"")} @ ${escapeHtml(ev.time||"")}`).join("<br/>") || "No evidence linked yet."}</div>
      </div>
    `;

    editor.querySelector("#btnSaveEntity")?.addEventListener("click", () => {
      ent.name = editor.querySelector("#entName")?.value?.trim() || ent.name;
      ent.tags = (editor.querySelector("#entTags")?.value || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
      ent.notes = editor.querySelector("#entNotes")?.value || "";
      ent.provenance = ent.provenance || "user";
      c.updatedAt = Date.now();
      saveDB();
      renderList();
    });

    editor.querySelector("#btnCloseEntity")?.addEventListener("click", () => {
      editor.innerHTML = `<div class="muted">Select an item to edit, or add a new one.</div>`;
    });

    editor.querySelector("#btnDeleteEntity")?.addEventListener("click", () => {
      if (!confirm("Delete this item?")) return;
      delete c.entities[bucketKey][id];
      c.updatedAt = Date.now();
      saveDB();
      editor.innerHTML = `<div class="muted">Deleted.</div>`;
      renderList();
    });
  }

  function addNew(){
    const c = state.campaign;
    if (!c) return;
    const bucketKey = currentBucket();
    const id = uid(bucketKey.slice(0,-1));
    c.entities[bucketKey] = c.entities[bucketKey] || {};
    c.entities[bucketKey][id] = {
      id,
      name: "New " + bucketKey.slice(0,-1),
      tags: [],
      notes: "",
      provenance: "user",
      evidence: []
    };
    c.updatedAt = Date.now();
    saveDB();
    renderList();
    openEditor(id);
  }

  document.getElementById("btnAddMemory")?.addEventListener("click", addNew);
  filter?.addEventListener("change", () => { renderList(); });
  search?.addEventListener("input", () => { renderList(); });

  // initial
  renderList();
}



function wireRenameSession(){
  const btn = document.getElementById("btnRenameSession");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const s = state.session;
    if (!s) return;
    const current = s.title || "Untitled Session";
    const next = prompt("Rename session:", current);
    if (!next) return;
    s.title = next.trim();
    // only persist on Save if requireReview is enabled; otherwise save immediately
    if (!settings.requireReview){
      saveSessions();
    }
    renderAll();
  });
}

function wireSessionButtons(){
  const saveBtn = document.getElementById("btnSaveSession");
  const delBtn = document.getElementById("btnClearSession");
  if (!saveBtn || !delBtn) return;

  saveBtn.addEventListener("click", () => {
    const s = state.session;
    if (!s) return;
    s.summary = document.getElementById("summaryBox")?.textContent?.trim() || s.summary;
    s.pendingReview = false;

    // Upsert approved entities into Campaign Memory
    const camp = state.campaign;
    if (camp){
      camp.entities = camp.entities || { characters:{}, locations:{}, factions:{} };

      function upsert(kind, items){
        (items || []).filter(e => e && e.approved !== false).forEach(e => {
          const key = (e.name || "").trim();
          if (!key) return;
          // find existing by name (case-insensitive)
          const existingId = Object.keys(camp.entities[kind] || {}).find(id =>
            (camp.entities[kind][id]?.name || "").toLowerCase() === key.toLowerCase()
          );
          const id = existingId || uid(kind.slice(0,-1));
          camp.entities[kind] = camp.entities[kind] || {};
          camp.entities[kind][id] = camp.entities[kind][id] || { id, name: key, tags: [], notes: "", provenance: e.provenance || "mixed", evidence: [] };
          camp.entities[kind][id].name = key;

          // evidence (lightweight): attach session + time if present
          const ev = { sessionId: s.id, sessionTitle: s.title, time: e.time || null };
          const arr = camp.entities[kind][id].evidence = camp.entities[kind][id].evidence || [];
          // avoid duplicates
          if (!arr.some(x => x.sessionId === ev.sessionId && x.time === ev.time)){
            arr.unshift(ev);
          }
        });
      }

      upsert("characters", s.characters);
      upsert("locations", s.locations);
      upsert("factions", s.factions);
      camp.updatedAt = Date.now();
    }

    saveSessions();
    renderAll();
  });

  delBtn.addEventListener("click", () => {
    if (!state.activeId) return;
    const idx = state.sessions.findIndex(x => x.id === state.activeId);
    if (idx === -1) return;

    state.sessions.splice(idx, 1);
    state.activeId = state.sessions[0]?.id ?? null;
    // allow deleting the last session; leave no active sessions

    saveSessions();
    renderAll();
    showView("dashboard");
  });
}

function wireNewSession(){
  const btn = document.getElementById("btnNewSession");
  if (!btn) return;

  btn.addEventListener("click", () => {
    // Don’t create an empty session. We only create one after we have transcript output.
    const titleInput = document.getElementById("sessionTitle");
    if (titleInput) titleInput.value = `Session ${state.sessions.length + 1}`;
    showView("record");
  });
}

function wireSample(){
  const btn = document.getElementById("btnUseSample");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const transcript = await loadSampleTranscript();
    startPipeline(transcript);
  });
}

function wireExport(){
  const btn = document.getElementById("btnExportMD");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const s = state.session;
    if (!s) return;
    s.summary = document.getElementById("summaryBox")?.textContent?.trim() || s.summary;
    exportSessionMarkdown(s);
  });
}



function wireInlineTitleEdit(){
  const nameEl = document.getElementById("sessionName");
  const editEl = document.getElementById("sessionNameEdit");
  if (!nameEl || !editEl) return;

  const commit = () => {
    const s = state.session;
    if (!s) return;
    const next = (editEl.value || "").trim();
    if (!next){
      editEl.value = s.title || "Session";
      return;
    }
    s.title = next;

    // Update UI
    nameEl.textContent = s.title;
    editEl.style.display = "none";
    nameEl.style.display = "";

    // Persist only if we are not in pending review mode
    if (!s.pendingReview){
      saveSessions();
    } else {
      renderAll(); // update sidebar label without saving
    }
  };

  const cancel = () => {
    const s = state.session;
    editEl.value = s?.title || "Session";
    editEl.style.display = "none";
    nameEl.style.display = "";
  };

  nameEl.addEventListener("click", () => {
    const s = state.session;
    if (!s) return;
    editEl.value = s.title || "Session";
    nameEl.style.display = "none";
    editEl.style.display = "";
    editEl.focus();
    editEl.select();
  });

  editEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") cancel();
  });

  editEl.addEventListener("blur", () => commit());
}



function wireCampaignControls(){
  const btnNew = document.getElementById("btnNewCampaign");
  btnNew?.addEventListener("click", () => {
    const name = prompt("Campaign name?", "New Campaign");
    if (!name) return;
    const c = {
      id: uid("camp"),
      name: name.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessions: [],
      entities: { characters:{}, locations:{}, factions:{} },
      threads: {}
    };
    state.campaigns.unshift(c);
    state.activeCampaignId = c.id;
    syncActiveCampaign();
    saveDB();
    renderAll();
    showView("dashboard");
  });
}


function boot(){
  loadSessions();
  loadSettings();
  saveSettings();

  wireNav();
  wireTabs();
  wireTranscriptSearch();
  wireCampaignControls();
  wireCampaignMemory();
  wireSessionButtons();
  wireRenameSession();
  wireNewSession();
  wireSample();
  wireExport();
  wireSettings();

  renderAll();

  // Auto-load demo on first visit (no existing sessions in any campaign)
  const hasAnySessions = state.campaigns.some(c => c.sessions && c.sessions.length > 0);
  if (!hasAnySessions) {
    setTimeout(async () => {
      try {
        const transcript = await loadSampleTranscript();
        startPipeline(transcript);
      } catch(e) {
        // silently skip if sample unavailable
      }
    }, 600);
  }
}

document.addEventListener("DOMContentLoaded", boot);

/* Utilities */
function escapeHtml(str){
  return (str || "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));
}

function createNewSessionInCampaign(campaignId){
  state.activeCampaignId = campaignId;
  syncActiveCampaign();
  saveDB();
  renderAll();
  showView("record");
  document.getElementById("sessionTitle")?.focus();
}

function escapeRegExp(str){
  return (str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}