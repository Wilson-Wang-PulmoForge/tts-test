import threading
from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from engines import load_engine, pcm_to_wav
from textprep import clean_text
import extract

app = FastAPI(title="Lectern")
engine = load_engine()
lock = threading.Lock()  # one model call at a time
cache: dict[tuple, bytes] = {}  # (voice, text) -> pcm, small in-memory LRU-ish


def synth(text: str, voice: str) -> bytes:
    if voice not in {v["id"] for v in engine.voices}:
        voice = engine.default_voice
    key = (voice, text)
    if key in cache:
        return cache[key]
    with lock:
        pcm = engine.synth(text, voice)
    if len(cache) > 500:
        cache.pop(next(iter(cache)))
    cache[key] = pcm
    return pcm


class TTSReq(BaseModel):
    text: str
    voice: str = ""

class CleanReq(BaseModel):
    text: str

class UrlReq(BaseModel):
    url: str

class ExportReq(BaseModel):
    chunks: list[str]
    voice: str = ""
    title: str = "lectern"


@app.get("/api/voices")
def voices():
    return {"engine": engine.name, "default": engine.default_voice, "voices": engine.voices}


@app.post("/api/tts")
def tts(req: TTSReq):
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "Nothing to read.")
    if len(text) > 1500:
        raise HTTPException(400, "That passage is too long to read at once.")
    return Response(pcm_to_wav(synth(text, req.voice), engine.sample_rate), media_type="audio/wav")


@app.post("/api/clean")
def clean(req: CleanReq):
    return {"text": clean_text(req.text)}


@app.post("/api/extract")
async def extract_file(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > extract.MAX_BYTES:
        raise HTTPException(413, "That file is too large (25 MB max).")
    try:
        return extract.from_file(file.filename or "", data)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception:
        raise HTTPException(422, "Couldn't read that file.")


@app.post("/api/extract-url")
def extract_url(req: UrlReq):
    try:
        return extract.from_url(req.url)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception:
        raise HTTPException(422, "Couldn't fetch that page.")


@app.post("/api/export")
def export(req: ExportReq):
    if not req.chunks:
        raise HTTPException(400, "Nothing to export.")
    gap = b"\x00\x00" * int(engine.sample_rate * 0.25)
    pcm = gap.join(synth(c, req.voice) for c in req.chunks if c.strip())
    safe = "".join(ch for ch in req.title if ch.isalnum() or ch in " -_")[:60].strip() or "lectern"
    return Response(pcm_to_wav(pcm, engine.sample_rate), media_type="audio/wav",
                    headers={"Content-Disposition": f'attachment; filename="{safe}.wav"'})


app.mount("/", StaticFiles(directory=Path(__file__).parent.parent / "frontend", html=True), name="ui")
