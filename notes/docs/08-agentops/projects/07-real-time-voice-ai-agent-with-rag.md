---
title: "Real-Time Voice AI Agent with RAG"
---

## Goal

Build a **voice assistant you can talk to** that answers questions from **your own documents**. You speak, it transcribes, retrieves relevant chunks, streams an answer from the LLM, and **starts speaking before the full answer is written**. The focus is the latency budget: every stage is streamed or kept small so the reply feels conversational.

**Skills practiced:** speech-to-text, text-to-speech, streaming completions, sentence-level TTS pipelining, embeddings and retrieval, latency measurement, voice-friendly prompting.

## Architecture

```
mic ──► record (push-to-talk) ──► STT ──► question text
                                             │
                                  embed ──► top-k chunks (in-memory vector index)
                                             │
                     LLM (stream=True) ── tokens ──► sentence splitter
                                                        │ each full sentence
                                                        ▼
                                            TTS (streamed PCM) ──► speaker

latency budget (rough):  STT ~0.5–1s | retrieval ~0.2s | first sentence ~0.5–1s | first audio ~0.3s
```

The trick is **pipelining**: TTS for sentence 1 plays while the LLM is still writing sentence 2.

## Setup

```bash
pip install openai numpy sounddevice soundfile python-dotenv
```

`sounddevice` needs PortAudio (`brew install portaudio` on macOS, `apt install libportaudio2` on Debian/Ubuntu).

`.env`:

```
OPENAI_API_KEY=sk-...
```

Put a few `.txt` or `.md` files in `docs/` (product FAQ, your notes, a policy).

## Code — `rag.py`

```python
from pathlib import Path
import numpy as np
from openai import OpenAI

client = OpenAI()
EMBED_MODEL = "text-embedding-3-small"

def chunk(text: str, size: int = 600, overlap: int = 100) -> list[str]:
    return [text[i:i + size] for i in range(0, len(text), size - overlap)]

def embed(texts: list[str]) -> np.ndarray:
    resp = client.embeddings.create(model=EMBED_MODEL, input=texts)
    vecs = np.array([d.embedding for d in resp.data])
    return vecs / np.linalg.norm(vecs, axis=1, keepdims=True)

class Index:
    def __init__(self, folder: str = "docs"):
        self.chunks = [c for p in Path(folder).glob("*.*") for c in chunk(p.read_text())]
        self.vecs = embed(self.chunks)

    def search(self, query: str, k: int = 3) -> list[str]:
        scores = self.vecs @ embed([query])[0]          # cosine similarity
        return [self.chunks[i] for i in np.argsort(scores)[::-1][:k]]
```

## Code — `voice_agent.py`

```python
import io, re, time
import numpy as np
import sounddevice as sd
import soundfile as sf
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
from rag import Index

client = OpenAI()
index = Index("docs")
MIC_RATE, TTS_RATE = 16_000, 24_000          # TTS "pcm" output is 24 kHz 16-bit mono
SYSTEM = ("You are a voice assistant. Answer ONLY from the context. If it isn't there, say so. "
          "Speak naturally in 1-3 short sentences. No lists, markdown, URLs or emojis.")
history: list[dict] = []

def record() -> bytes:
    input("Press Enter and speak; press Enter again to stop...")
    frames = []
    with sd.InputStream(samplerate=MIC_RATE, channels=1, dtype="int16",
                        callback=lambda d, *_: frames.append(d.copy())):
        input()
    buf = io.BytesIO()
    sf.write(buf, np.concatenate(frames), MIC_RATE, format="WAV")
    return buf.getvalue()

def transcribe(wav: bytes) -> str:
    return client.audio.transcriptions.create(
        model="gpt-4o-mini-transcribe",          # or "whisper-1"
        file=("speech.wav", wav),
    ).text

def speak(sentence: str, out: sd.RawOutputStream):
    with client.audio.speech.with_streaming_response.create(
        model="gpt-4o-mini-tts", voice="alloy", input=sentence, response_format="pcm",
    ) as resp:
        for chunk in resp.iter_bytes(4096):
            out.write(chunk)                     # play audio as it arrives

def answer(question: str, out: sd.RawOutputStream):
    context = "\n---\n".join(index.search(question))
    messages = [{"role": "system", "content": f"{SYSTEM}\n\nContext:\n{context}"},
                *history[-6:], {"role": "user", "content": question}]
    stream = client.chat.completions.create(model="gpt-4o-mini", messages=messages, stream=True)

    buffer, full, t0, first = "", "", time.perf_counter(), True
    for event in stream:
        delta = event.choices[0].delta.content if event.choices else None
        if not delta:
            continue
        buffer += delta
        full += delta
        # flush every complete sentence to TTS immediately
        while (m := re.search(r"(.+?[.!?])(\s|$)", buffer)):
            if first:
                print(f"[first sentence after {time.perf_counter() - t0:.2f}s]")
                first = False
            speak(m.group(1), out)
            buffer = buffer[m.end():]
    if buffer.strip():
        speak(buffer, out)
    history.extend([{"role": "user", "content": question},
                    {"role": "assistant", "content": full}])
    print("Agent:", full)

def main():
    with sd.RawOutputStream(samplerate=TTS_RATE, channels=1, dtype="int16") as out:
        while True:
            t = time.perf_counter()
            question = transcribe(record())
            print(f"You: {question}   [STT {time.perf_counter() - t:.2f}s]")
            if question.strip().lower() in {"quit", "exit", "goodbye"}:
                break
            answer(question, out)

if __name__ == "__main__":
    main()
```

Run `python voice_agent.py`, press Enter, ask "What's the refund policy?", press Enter.

## How it works

1. **Index once** — documents are chunked and embedded at startup; vectors are normalized so a dot product is cosine similarity.
2. **Record and transcribe** — push-to-talk avoids building voice activity detection on day one. WAV bytes go straight to the STT model.
3. **Retrieve** — the question is embedded and the top 3 chunks are placed in the system prompt.
4. **Stream and split** — LLM tokens accumulate until a sentence ends, then that sentence goes to TTS while the LLM keeps streaming.
5. **Stream audio** — TTS returns raw 24 kHz PCM in chunks that are written straight to the speaker, so playback starts before synthesis finishes.
6. **Voice prompting** — short sentences and no markdown, because bullet points and URLs sound terrible read aloud.

In this simple version, TTS calls run one after another in the main thread. A queue with a separate TTS worker thread removes the remaining gaps.

## Going truly real-time

For full-duplex conversation (interruptions, no push-to-talk), use a speech-to-speech stack instead of the STT → LLM → TTS chain: the **OpenAI Realtime API** over WebSocket or WebRTC, or frameworks like **LiveKit Agents** and **Pipecat** that handle voice activity detection, turn-taking, interruption and telephony. RAG then becomes a tool the realtime model calls.

## Stretch goals

- [ ] **TTS worker thread** with a queue so audio never pauses between sentences.
- [ ] **Voice activity detection** (e.g. Silero VAD or `webrtcvad`) instead of push-to-talk.
- [ ] **Barge-in** — stop playback when the user starts talking.
- [ ] **Persistent vector DB** — swap the in-memory index for Chroma or Qdrant.
- [ ] **Realtime API version** — rebuild with RAG as a function tool and compare latency.
- [ ] **Phone line** — connect via Twilio or LiveKit SIP.
- [ ] **Latency dashboard** — log STT, retrieval, first-token and first-audio times per turn.
- [ ] **Open-source stack** — faster-whisper for STT, a local LLM, Piper or Kokoro for TTS.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
