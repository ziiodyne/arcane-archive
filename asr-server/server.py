from fastapi import FastAPI, UploadFile, File, Form
from pydantic import BaseModel
import os
import json
from openai import OpenAI
from fastapi.middleware.cors import CORSMiddleware
import tempfile, shutil

from faster_whisper import WhisperModel

app = FastAPI()

client = OpenAI(api_key=os.environ.get('OPENAI_API_KEY'))

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

FAST_MODEL_NAME = "tiny"
ACCURATE_MODEL_NAME = "base"
MODELS = {}

def get_model(mode: str):
    key = "accurate" if mode == "accurate" else "fast"
    name = ACCURATE_MODEL_NAME if key == "accurate" else FAST_MODEL_NAME
    if key not in MODELS:
        MODELS[key] = WhisperModel(name, device="cpu", compute_type="int8")
    return MODELS[key]




@app.get("/health")
async def health():
    return {"ok": True}

@app.post("/asr")
async def asr(audio: UploadFile = File(...), mode: str = Form("fast")):
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        shutil.copyfileobj(audio.file, tmp)
        path = tmp.name

    model = get_model(mode)
    segments, info = model.transcribe(path, vad_filter=True)

    seg_list = []
    full_text_parts = []
    for seg in segments:
        seg_list.append({
            "start": float(seg.start),   # seconds
            "end": float(seg.end),
            "text": seg.text.strip()
        })
        full_text_parts.append(seg.text.strip())

    return {
        "transcript": " ".join(full_text_parts).strip(),
        "segments": seg_list
    }

class SummarizeReq(BaseModel):
    transcript: str

@app.post("/summarize")
async def summarize(req: SummarizeReq):
    text = (req.transcript or "").strip()
    if len(text) < 20:
        return {"summary": "Transcript too short to summarize.", "bullets": [], "threads": [], "characters": [], "locations": []}

    prompt = f"""
You are a constrained tabletop RPG memory assistant.
You must summarize and organize strictly from the transcript.
Do NOT copy the transcript or paraphrase line-by-line.
If something is uncertain, omit it.

Return JSON with:
summary (string),
bullets (array),
threads (array),
characters (array),
locations (array),
factions (array).

Transcript:
{text}
"""

    resp = client.responses.create(
        model="gpt-4.1-mini",
        input=prompt,
        text={"format":{"type":"json_object"}}
    )

    try:
        return json.loads(resp.output_text)
    except Exception:
        # Fallback: return as plain text if parsing fails
        return {"summary": resp.output_text, "bullets": [], "threads": [], "characters": [], "locations": []}
