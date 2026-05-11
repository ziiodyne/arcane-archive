# Arcane Archive

**A constrained AI-based narrative memory assistant for tabletop role-playing games.**

> Built as an HCAI semester research project — Spring 2026  
> Ziona Agyemang · University of North Carolina at Charlotte

---

## What It Does

Tabletop RPG sessions are 2–4 hours long. Players forget NPCs, lose narrative threads, and can't always recall what happened last session. Arcane Archive solves the **long-horizon memory problem** by automatically transcribing session audio, extracting characters/locations/factions, detecting unresolved narrative threads, and organizing everything into a searchable campaign wiki.

Critically, **the AI never suggests what you should do next.** Every AI-generated output is labeled, editable, and requires explicit human approval before it enters your permanent campaign record.

---

## Live Demo

**[Try it here →](https://ziiodyne.github.io/arcane-archive)**

The live demo loads a sample session automatically so you can explore the full UI without any setup. Your data stays in your browser — nothing is sent anywhere.

> **Note:** Live transcription of your own audio requires running the local ASR server (see below). The demo works fully without it.

---

## Screenshots

| Dashboard | Session View | Campaign Memory |
|-----------|-------------|----------------|
| Campaign folder tree, KPIs, navigation | AI-generated summary + entity review gate | Searchable wiki with evidence links |

---

## Features

- 🎙️ **In-browser audio recording** with pause/resume and live level meter
- 📁 **File upload** — drag & drop WAV, MP3, M4A, WebM
- 🗣️ **Local Whisper ASR** — fast (tiny model) or accurate (base model), runs on your machine
- 🧠 **AI organization pipeline** — entity extraction, thread detection, session summarization
- 🔒 **Human review gate** — nothing saves until you approve it
- 🏷️ **Labeled AI output** — every AI-generated element is visibly marked
- 📖 **Campaign memory wiki** — persistent characters, locations, factions with evidence links
- 📁 **Multi-campaign support** — campaigns as folders, sessions nested inside
- 📤 **Markdown export** — share session recaps anywhere
- 🔐 **Privacy-first** — local-only mode, no data leaves your machine

---

## HCAI Design Principles

This tool is built around three constraints:

| Principle | What it means |
|-----------|--------------|
| **Constrained** | AI cannot invent content, suggest actions, or predict outcomes |
| **Transparent** | Every AI output is labeled and comes with a source transcript link |
| **Human-first** | Nothing enters the campaign record without explicit human approval |

---

## Running Locally (Full Version with Transcription)

### Prerequisites
- Python 3.10+
- Node.js (optional, for a local dev server)
- A microphone or audio files from your sessions

### 1. Clone the repo

```bash
git clone https://github.com/ziiodyne/arcane-archive.git
cd arcane-archive
```

### 2. Install ASR server dependencies

```bash
cd asr-server
pip install fastapi uvicorn faster-whisper openai python-multipart
```

### 3. Set your OpenAI API key

```bash
export OPENAI_API_KEY=your_key_here
```

> The server uses GPT-4.1-mini for structured summarization. If you don't have an API key, the tool still works — it just skips AI summarization and shows raw transcript output.

### 4. Start the ASR server

```bash
uvicorn server:app --reload --port 8000
```

### 5. Open the frontend

Open `index.html` directly in your browser, or serve it with:

```bash
# From the root of the repo
npx serve .
```

Then go to `http://localhost:3000` (or wherever serve puts it).

---

## Project Structure

```
arcane-archive/
├── index.html              # Main app entry point
├── css/
│   ├── variables.css       # Design tokens (colors, spacing)
│   ├── base.css            # Reset + base styles
│   ├── components.css      # UI components
│   └── layout.css          # View layouts
├── js/
│   ├── app.js              # Main app logic, state, views
│   ├── pipeline.js         # ASR + AI organization pipeline
│   ├── recorder.js         # In-browser audio recording
│   └── export.js           # Markdown export
├── assets/
│   └── samples/
│       ├── sample-transcript.txt   # Built-in demo session
│       └── arcane-archive-favicon.png
└── asr-server/
    └── server.py           # FastAPI + faster-whisper + GPT-4.1-mini
```

---

## Research Context

This project was built as part of a Human-Centered AI (HCAI) course research project. The full paper is available in the course submission.

**Research question:** *How can a constrained AI-based narrative memory assistant improve players' sense-making and recall in tabletop role-playing games without diminishing perceived player agency?*

**Pilot evaluation:** 5 participants, ages 19–21, one live ~3-hour campaign session. Key findings: strong perceived utility, intuitive navigation, transcription latency for long sessions, and speaker differentiation challenges in noisy group play.

---

## Known Limitations

- **Transcription latency** — long sessions (2–3 hrs) take time to process locally. Incremental transcription is planned.
- **Speaker differentiation** — the current pipeline does not diarize speakers. All voices appear as one stream.
- **localStorage limit** — browser storage caps at ~5MB. Long campaigns with many sessions may approach this.
- **Entity extraction** — heuristic-based; may produce false positives with uncommon fantasy names.

---

## License

MIT — use it, fork it, run it at your table.

---

*Built with vanilla HTML/CSS/JS + Python + faster-whisper + GPT-4.1-mini*
