"""Swappable TTS engines. To use a different model, subclass Engine and
return it from load_engine(). synth() returns mono 16-bit PCM bytes."""
import math, os, struct, wave, io, threading
from array import array


class Engine:
    name = "base"
    sample_rate = 24000
    voices: list[dict] = []
    default_voice = ""

    def synth(self, text: str, voice: str) -> bytes:
        raise NotImplementedError


class MockEngine(Engine):
    """No model needed: soft two-tone 'speech' whose length tracks the text.
    Lets you test the whole app before installing Kokoro."""
    name = "mock"
    voices = [{"id": "mock-low", "name": "Mock (low)"}, {"id": "mock-high", "name": "Mock (high)"}]
    default_voice = "mock-low"

    def synth(self, text, voice):
        sr = self.sample_rate
        base = 180 if voice == "mock-low" else 300
        n = int(sr * max(0.5, len(text) / 15))
        out = array("h")
        for i in range(n):
            t = i / sr
            env = 0.5 * (1 + math.sin(2 * math.pi * 3.5 * t)) * min(1, i / 800, (n - i) / 800)
            out.append(int(9000 * env * math.sin(2 * math.pi * (base + 40 * math.sin(t * 5)) * t)))
        return out.tobytes()


class KokoroEngine(Engine):
    """https://huggingface.co/hexgrad/Kokoro-82M  (pip install kokoro; needs espeak-ng)."""
    name = "kokoro"
    sample_rate = 24000
    default_voice = "af_heart"
    voices = [
        {"id": "af_heart", "name": "Heart (US, female)"},
        {"id": "af_bella", "name": "Bella (US, female)"},
        {"id": "af_nicole", "name": "Nicole (US, female)"},
        {"id": "am_adam", "name": "Adam (US, male)"},
        {"id": "am_michael", "name": "Michael (US, male)"},
        {"id": "bf_emma", "name": "Emma (UK, female)"},
        {"id": "bm_george", "name": "George (UK, male)"},
    ]

    def __init__(self):
        import numpy as np
        from kokoro import KPipeline
        self._np, self._KPipeline, self._pipes = np, KPipeline, {}

    def synth(self, text, voice):
        np = self._np
        lang = voice[0]  # 'a' = American English, 'b' = British English
        pipe = self._pipes.get(lang) or self._pipes.setdefault(lang, self._KPipeline(lang_code=lang))
        parts = []
        for _, _, audio in pipe(text, voice=voice, speed=1.0):
            arr = audio.detach().cpu().numpy() if hasattr(audio, "detach") else np.asarray(audio)
            parts.append((np.clip(arr, -1, 1) * 32767).astype(np.int16).tobytes())
        return b"".join(parts)


def load_engine() -> Engine:
    want = os.environ.get("LECTERN_ENGINE", "auto").lower()
    if want in ("kokoro", "auto"):
        try:
            return KokoroEngine()
        except Exception as e:  # not installed / no espeak
            if want == "kokoro":
                raise
            print(f"[lectern] Kokoro unavailable ({e}); using mock engine.")
    return MockEngine()


def pcm_to_wav(pcm: bytes, sr: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm)
    return buf.getvalue()
