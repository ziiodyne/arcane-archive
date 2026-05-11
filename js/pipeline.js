
// Turn this on when your ASR server is running
// js/pipeline.js

function getSettings(){
  try{ return JSON.parse(localStorage.getItem("arcaneArchiveSettings") || "{}"); }
  catch{ return {}; }
}

function asrEndpoint(){
  const s = getSettings();
  const port = Number(s.asrPort || 8000);
  return `http://127.0.0.1:${port}/asr`;
}

function useRealASR(){
  const s = getSettings();
  return s.useASR === true;
}

/* ----------------------- Helpers ----------------------- */

function secToMMSS(sec){
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
}

function guessSpeaker(text){
  // Keep explicit speaker tags if ASR captured them
  if (/^(dm|gm)\s*:/i.test(text)) return text;
  if (/^(player|pc)\s*:/i.test(text)) return text;
  return text;
}

/* ----------------------- ASR ----------------------- */

async function transcribeAudio(audioBlob){
  // Fallback mode (no server)
  if (!useRealASR()){
    return await loadSampleTranscript();
  }

  const form = new FormData();
  form.append("audio", audioBlob, "session.webm");
  // pass transcription mode to the server ("fast" or "accurate")
  const s = getSettings();
  form.append("mode", (s.asrMode || "fast"));

  const res = await fetch(asrEndpoint(), {
    method: "POST",
    body: form
  });

  if (!res.ok){
    const txt = await res.text().catch(()=> "");
    throw new Error(`ASR error ${res.status}: ${txt}`);
  }

  const data = await res.json();

  // Preferred path: server returns timestamped segments
  if (Array.isArray(data.segments) && data.segments.length){
    const lines = data.segments
      .filter(s => (s.text || "").trim().length)
      .map(s => `${secToMMSS(s.start)} ${guessSpeaker((s.text || "").trim())}`);

    return lines.join("\n");
  }

  // Fallback: no segments, only full transcript
  const text = (data.transcript || "").trim();
  return `00:00 ${text || "Transcript unavailable."}`;
}

/* ----------------------- Sample transcript ----------------------- */

async function loadSampleTranscript(){
  const res = await fetch("assets/samples/sample-transcript.txt");
  if (!res.ok){
    return `00:00 DM: The party arrives at Dawnspire Cathedral and meets Nyssara.
00:15 Player: We ask about the Lantern Oath and the missing acolyte.
00:33 DM: A cloaked figure called Kerrik watches from the Umbral Quarter alley.
01:05 Player: We travel to Azure Serpent River and notice strange silver markings.
01:40 DM: Thread: Who stole the relic?
01:55 DM: Thread: Why is the Moonstone warm?`;
  }
  return await res.text();
}

/* ----------------------- Organizer pipeline ----------------------- */

function parseTranscript(raw){
  return raw.split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => {
      const m = line.match(/^(\d{2}:\d{2})\s+(.*)$/);
      if (!m) return { time: "--:--", text: line };
      return { time: m[1], text: m[2] };
    });
}

function summarize(chunks){
  const joined = chunks.map(c => c.text).join(" ");
  const sentences = joined.split(".").map(s => s.trim()).filter(Boolean);
  const top = sentences.slice(0, 3).join(". ") + (sentences.length ? "." : "");
  return top || joined.slice(0, 240) + "…";
}

function extractEntities(chunks){
  // Better demo entity extraction:
  // - capture multi-word Proper Nouns (e.g., "Nyssara Trialmere", "Azure Serpent River")
  // - keep single-word names too
  // - bucket into Characters vs Locations using simple suffix rules
  const text = chunks.map(c => c.text).join(" ");

  // Multi-word Proper Nouns: sequences of Capitalized words (allow apostrophes)
  const multi = text.match(/\b(?:[A-Z][a-zA-Z']{1,})(?:\s+[A-Z][a-zA-Z']{1,})+\b/g) || [];
  const single = text.match(/\b[A-Z][a-zA-Z']{2,}\b/g) || [];

  const stop = new Set(["The","A","An","And","Or","But","If","Then","When","While","For","From","With","Without","Into","Over","Under","Near","After","Before","As","At","In","On","To","Of","We","I","You","He","She","They","It","DM","GM","PC","Player"]);
  const locHints = [
    "River","Cathedral","Forest","Woods","Quarter","City","Town","Village","Keep","Castle","Fort","Cave","Cavern","Temple","Shrine",
    "Inn","Tavern","Road","Path","Trail","Mount","Mountain","Peak","Spire","Bay","Sea","Lake","Swamp","Marsh","Vale","Plains","Bridge",
    "Market","Harbor","Port","Dock","District","Sanctuary"
  ];

  const counts = new Map();

  const add = (name) => {
    const clean = (name || "").trim().replace(/\s+/g," ");
    if (!clean) return;
    // Drop if it’s basically stopwords
    if (stop.has(clean)) return;
    // Drop if it starts with a stopword and is only two words like "The Something"
    const first = clean.split(" ")[0];
    if (stop.has(first)) return;

    counts.set(clean, (counts.get(clean) || 0) + 1);
  };

  multi.forEach(add);
  single.forEach(add);

  // Rank by frequency
  const ranked = [...counts.entries()]
    .sort((a,b) => b[1] - a[1])
    .map(([name]) => name);

  const isLocation = (name) => {
    // keyword hint
    if (locHints.some(h => new RegExp(`\\b${h}\\b`).test(name))) return true;
    // common "Place of X" patterns
    if (/\\b(Quarter|District|Forest|River|Cathedral|Temple|Keep|Castle|Inn|Tavern)\\b/i.test(name)) return true;
    return false;
  };

  const locations = [];
  const characters = [];

  for (const name of ranked){
    if (isLocation(name)) locations.push(name);
    else characters.push(name);
  }

  return {
    characters: characters.slice(0, 10),
    locations: locations.slice(0, 10)
  };
}

function extractThreads(chunks){
  // Threads are easiest if the DM/players literally say "Thread: ..."
  // This makes the timestamp match a real transcript chunk.
  const hits = [];
  for (const c of chunks){
    if (/thread:/i.test(c.text)){
      hits.push({ text: c.text.replace(/thread:\s*/i,"").trim(), time: c.time });
    }
  }

  // fallback demo threads if none spoken
  return hits.length ? hits : [
    { text: "Who stole the relic, and why?", time: null },
    { text: "What does the Lantern Oath actually bind?", time: null },
    { text: "Why are the silver markings appearing near the river?", time: null }
  ];
}

function buildTimeline(chunks){
  // Simple: show first ~7 moments as events
  return chunks.slice(0, 7).map(c => ({ time: c.time, text: c.text }));
}

/* ----------------------- UI processing flow ----------------------- */

function startPipeline(rawTranscript){
  showView("processing");

  const progressFill = document.getElementById("progressFill");
  const hint = document.getElementById("processingHint");
  const steps = [
    document.getElementById("step1"),
    document.getElementById("step2"),
    document.getElementById("step3"),
    document.getElementById("step4")
  ];

  steps.forEach(s => s?.classList.remove("done"));
  if (progressFill) progressFill.style.width = "0%";

  const phases = [
    { pct: 18, msg: "Preparing audio…", done: 0 },
    { pct: 55, msg: "Transcribing session…", done: 1 },
    { pct: 88, msg: "Organizing entities + threads…", done: 2 },
    { pct: 100, msg: "Ready.", done: 3 },
  ];

  let i = 0;
  const timer = setInterval(async () => {
    const p = phases[i];
    if (progressFill) progressFill.style.width = `${p.pct}%`;
    if (hint) hint.textContent = p.msg;

    for (let k = 0; k <= p.done; k++) steps[k]?.classList.add("done");

    i++;
    if (i >= phases.length){
      clearInterval(timer);

      const chunks = parseTranscript(rawTranscript);
      const summary = summarize(chunks);
      const ent = extractEntities(chunks);
      const threads = extractThreads(chunks);
      const timeline = buildTimeline(chunks);

      // Optional: AI-generated summary (requires /summarize)
      let aiData = null;
      try{
        aiData = await aiSummarize(rawTranscript);
      } catch(e){
        console.warn("AI summary failed, falling back to basic summary.", e);
      }

      const newSession = {
        id: crypto.randomUUID(),
        title: document.getElementById("sessionTitle")?.value?.trim()
          || `Session ${state.sessions.length + 1}`,
        date: new Date().toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" }),
        transcriptChunks: chunks,
        summary: (aiData?.summary || summary),
        characters: ent.characters.map(name => ({ name, approved: true })),
        locations: ent.locations.map(name => ({ name, approved: true })),
        threads,
        timeline
      };

      const cfg = getSettings();
      newSession.pendingReview = cfg.requireReview === true;

      state.sessions.push(newSession);
      state.activeId = newSession.id;

      // If "Require human review" is on, we keep this as a draft until the user clicks Save.
      if (newSession.pendingReview){
        renderAll();
        showView("session");
      } else {
        saveSessions();
        renderAll();
        showView("session");
      }
    }
  }, 650);
}

async function aiSummarize(transcriptText){
  const res = await fetch("http://127.0.0.1:8000/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript: transcriptText })
  });
  if (!res.ok) throw new Error("Summarize failed");
  return await res.json();
}


// Expose key functions globally
window.startPipeline = startPipeline;
window.transcribeAudio = transcribeAudio;
window.loadSampleTranscript = loadSampleTranscript;
window.loadSampleTranscript = loadSampleTranscript;
