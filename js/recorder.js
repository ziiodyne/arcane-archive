let mediaRecorder = null;
let audioChunks = [];
let timerId = null;

let startedAt = 0;
let elapsedBeforePause = 0;
let streamRef = null;

function formatTime(ms){
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
}

function setRecUI(status){
  const st = document.getElementById("recStatus");
  if (st) st.textContent = status;
}


function estimateMinutesFromBytes(bytes){
  // crude estimate assuming ~128 kbps average audio
  // minutes ≈ (bytes * 8) / 128000 / 60
  const minutes = (bytes * 8) / 128000 / 60;
  return Math.max(0, minutes);
}

function shouldWarnLarge(bytes){
  try{
    const s = JSON.parse(localStorage.getItem("arcaneArchiveSettings") || "{}");
    if (s.warnLarge === false) return false;
  } catch{}
  const mins = estimateMinutesFromBytes(bytes);
  return mins >= 60; // warn at ~1 hour estimated
}

async function confirmLarge(fileLike){
  const bytes = fileLike?.size || 0;
  if (!shouldWarnLarge(bytes)) return true;

  const mins = estimateMinutesFromBytes(bytes);
  const msg =
`This file looks like roughly ${Math.round(mins)} minutes (very rough estimate).
Long transcriptions can take a while on CPU.

Tip: Split into 15–30 minute chunks for best results.

Continue anyway?`;

  return window.confirm(msg);
}

function startTimer(){
  stopTimer();
  timerId = setInterval(() => {
    const now = Date.now();
    const total = elapsedBeforePause + (now - startedAt);
    const t = document.getElementById("recTime");
    if (t) t.textContent = formatTime(total);

    // fake meter wobble
    const fill = document.getElementById("meterFill");
    if (fill){
      const pct = 6 + Math.random() * 24;
      fill.style.width = `${pct}%`;
    }
  }, 250);
}

function stopTimer(){
  if (timerId){
    clearInterval(timerId);
    timerId = null;
  }
}

/* ---------------- Upload / Drag-Drop ---------------- */

function wireUpload(){
  const dropZone = document.getElementById("dropZone");
  const input = document.getElementById("audioFileInput");
  const choose = document.getElementById("btnChooseFile");
  const status = document.getElementById("uploadStatus");

  // If you haven't added the HTML yet, just skip silently
  if (!dropZone || !input || !choose || !status) return;

  const processFile = async (file) => {
    if (!file) return;

    status.textContent = `Processing: ${file.name}`;
    const ok = await confirmLarge(file);
    if (!ok){
      status.textContent = "Cancelled.";
      return;
    }
    // Optional: show processing view immediately
    showView("processing");

    try{
      // File is a Blob, so transcribeAudio(file) works
      const transcript = await transcribeAudio(file);
      startPipeline(transcript);
      status.textContent = `Done: ${file.name}`;
    } catch (err){
      console.error("Upload ASR failed:", err);
      status.textContent = `Error: ${file.name} (see console)`;

      // Fallback
      try{
        const fallback = await loadSampleTranscript();
        startPipeline(fallback);
      } catch(e){}
    } finally {
      // allow uploading the same file again
      input.value = "";
    }
  };

  choose.addEventListener("click", () => input.click());

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    processFile(file);
  });

  ["dragenter","dragover"].forEach(evt => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add("dragover");
    });
  });

  ["dragleave","drop"].forEach(evt => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("dragover");
    });
  });

  dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    processFile(file);
  });

  // keyboard accessibility
  dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " "){
      e.preventDefault();
      input.click();
    }
  });
}

/* ---------------- Recorder ---------------- */

async function initRecorder(){
  const btnRecord = document.getElementById("btnRecord");
  const btnPause  = document.getElementById("btnPause");
  const btnStop   = document.getElementById("btnStop");
  const playback  = document.getElementById("playback");

  if (!btnRecord || !btnPause || !btnStop) return;

  // hook upload UI if present
  wireUpload();

  // If MediaRecorder isn't supported, bail with a helpful UI state.
  if (typeof MediaRecorder === "undefined"){
    btnRecord.disabled = true;
    btnPause.disabled = true;
    btnStop.disabled = true;
    setRecUI("Recording not supported in this browser");
    return;
  }

  btnRecord.addEventListener("click", async () => {
    // already recording
    if (mediaRecorder && mediaRecorder.state === "recording") return;

    // reset time
    elapsedBeforePause = 0;
    const timeEl = document.getElementById("recTime");
    if (timeEl) timeEl.textContent = "00:00";

    // Hide previous playback preview
    if (playback){ playback.hidden = true; playback.src = ""; }

    // new stream every record
    streamRef = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Prefer mimeType when possible
    const options = {};
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")){
      options.mimeType = "audio/webm;codecs=opus";
    } else if (MediaRecorder.isTypeSupported("audio/webm")){
      options.mimeType = "audio/webm";
    }

    mediaRecorder = new MediaRecorder(streamRef, options);
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onerror = (e) => {
      console.error("MediaRecorder error:", e);
      setRecUI("Recorder error");
    };

    mediaRecorder.onstart = () => setRecUI("Recording");
    mediaRecorder.onpause = () => setRecUI("Paused");
    mediaRecorder.onresume = () => setRecUI("Recording");

    mediaRecorder.onstop = async () => {
      stopTimer();

      // stop tracks
      if (streamRef){
        streamRef.getTracks().forEach(t => t.stop());
        streamRef = null;
      }

      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      // We keep the audio blob for transcription, but do not show a playback preview in the UI.
      // (Helps keep the Record page clean.)
      const url = URL.createObjectURL(blob);
      if (playback){
        playback.hidden = true;
        playback.removeAttribute("src");
      }

      try{
        const ok = await confirmLarge(blob);
        if (!ok){
          // user cancelled; return to idle state
          return;
        }
        const transcript = await transcribeAudio(blob); // from pipeline.js
        startPipeline(transcript);
      } catch(err){
        console.warn("ASR failed, falling back to sample transcript.", err);
        const fallback = await loadSampleTranscript();
        startPipeline(fallback);
      }

      URL.revokeObjectURL(url);

      // reset UI
      const fill = document.getElementById("meterFill");
      if (fill) fill.style.width = "8%";

      btnRecord.disabled = false;
      btnPause.disabled = true;
      btnStop.disabled = true;
      btnPause.textContent = "Pause";

      setRecUI("Idle");
    };

    // start recording
    mediaRecorder.start(250);

    startedAt = Date.now();
    startTimer();

    // UI
    btnRecord.disabled = true;
    btnPause.disabled = false;
    btnStop.disabled = false;
    btnPause.textContent = "Pause";
  });

  btnPause.addEventListener("click", () => {
    if (!mediaRecorder) return;

    if (typeof mediaRecorder.pause !== "function" || typeof mediaRecorder.resume !== "function"){
      setRecUI("Pause not supported");
      return;
    }

    if (mediaRecorder.state === "recording"){
      elapsedBeforePause += (Date.now() - startedAt);
      stopTimer();

      mediaRecorder.pause();
      btnPause.textContent = "Resume";
    } else if (mediaRecorder.state === "paused"){
      startedAt = Date.now();
      startTimer();

      mediaRecorder.resume();
      btnPause.textContent = "Pause";
    }
  });

  btnStop.addEventListener("click", () => {
    if (!mediaRecorder) return;
    if (mediaRecorder.state === "inactive") return;
    mediaRecorder.stop();
  });
}

document.addEventListener("DOMContentLoaded", initRecorder);