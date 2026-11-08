---
title: "Personal AI Voice Assistant"
---

## Goal

Build a terminal voice assistant: press Enter, speak, and it **transcribes your voice, thinks with an LLM, and talks back**. It keeps the conversation in memory and can answer simple local questions (time, date) through plain Python functions. It ties together most of this stage: functions, classes, files, `.env`, error handling and API calls.

**Skills practiced:** audio recording, speech-to-text, text-to-speech, chat history, a small class, dispatching to Python functions, error handling, secrets in `.env`.

## Architecture

```
 mic ──► record_audio() ──► input.wav
                               │
                               ▼
                 speech-to-text (whisper-1)  ──► "what's on my mind today?"
                               │
                               ▼
               Assistant.reply(text)
                 ├─ local commands? (time, date, quit) ──► answer directly
                 └─ else: history + LLM (gpt-4o-mini)  ──► reply text
                               │
                               ▼
                 text-to-speech (tts-1) ──► reply.wav ──► speakers
```

Three API calls per turn: transcribe, chat, speak. Everything else is ordinary Python.

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install openai python-dotenv sounddevice soundfile numpy
```

`sounddevice` needs PortAudio. On macOS it's bundled with the wheel; on Linux you may need `sudo apt install libportaudio2`. Allow microphone access for your terminal when asked.

`.env` (gitignored):

```
OPENAI_API_KEY=sk-...
```

## Code

### `audio.py`: record and play

```python
import queue

import numpy as np
import sounddevice as sd
import soundfile as sf

SAMPLE_RATE = 16_000          # plenty for speech, small files


def record_audio(path: str = "input.wav") -> str:
    """Record from the default mic until the user presses Enter."""
    frames: queue.Queue = queue.Queue()

    def callback(indata, frame_count, time_info, status):
        frames.put(indata.copy())

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, callback=callback):
        input("🎙️  Recording... press Enter to stop.")

    chunks = []
    while not frames.empty():
        chunks.append(frames.get())
    audio = np.concatenate(chunks) if chunks else np.zeros((0, 1))
    sf.write(path, audio, SAMPLE_RATE)
    return path


def play_audio(path: str) -> None:
    data, sr = sf.read(path)
    sd.play(data, sr)
    sd.wait()                 # block until playback finishes
```

### `assistant.py`: the brain

```python
from datetime import datetime
from pathlib import Path

import openai
from openai import OpenAI

MODEL = "gpt-4o-mini"
SYSTEM = (
    "You are a concise personal voice assistant. Replies are spoken aloud, "
    "so use one to three short sentences and no markdown or lists."
)
MAX_MESSAGES = 20


class Assistant:
    def __init__(self):
        self.client = OpenAI()
        self.history: list[dict] = []

    # --- speech ---------------------------------------------------------
    def transcribe(self, path: str) -> str:
        with open(path, "rb") as f:
            result = self.client.audio.transcriptions.create(model="whisper-1", file=f)
        return result.text.strip()

    def speak(self, text: str, path: str = "reply.wav") -> str:
        with self.client.audio.speech.with_streaming_response.create(
            model="tts-1", voice="alloy", input=text, response_format="wav"
        ) as response:
            response.stream_to_file(Path(path))
        return path

    # --- thinking -------------------------------------------------------
    def local_command(self, text: str) -> str | None:
        t = text.lower()
        if "time" in t and "what" in t:
            return f"It's {datetime.now():%I:%M %p}."
        if "date" in t or "what day" in t:
            return f"Today is {datetime.now():%A, %d %B}."
        if "clear" in t and "memory" in t:
            self.history.clear()
            return "Okay, I've forgotten our conversation."
        return None

    def reply(self, text: str) -> str:
        if (answer := self.local_command(text)) is not None:
            return answer

        self.history.append({"role": "user", "content": text})
        try:
            response = self.client.chat.completions.create(
                model=MODEL,
                max_completion_tokens=200,
                messages=[{"role": "system", "content": SYSTEM}, *self.history[-MAX_MESSAGES:]],
            )
        except openai.APIError as e:
            self.history.pop()
            return f"Sorry, I couldn't reach the model. {type(e).__name__}."

        answer = response.choices[0].message.content
        self.history.append({"role": "assistant", "content": answer})
        return answer
```

### `main.py`: the loop

```python
from dotenv import load_dotenv

load_dotenv()

from assistant import Assistant          # import after env is loaded
from audio import play_audio, record_audio

QUIT_WORDS = {"quit", "exit", "goodbye", "stop"}


def main():
    bot = Assistant()
    print("Voice assistant ready. Ctrl+C to exit.")
    while True:
        input("\nPress Enter and speak...")
        text = bot.transcribe(record_audio())
        if not text:
            print("(heard nothing)")
            continue
        print(f"🧑 {text}")

        if text.lower().strip(" .!") in QUIT_WORDS:
            play_audio(bot.speak("Goodbye!"))
            break

        answer = bot.reply(text)
        print(f"🤖 {answer}")
        play_audio(bot.speak(answer))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nBye.")
```

Run with `python main.py`.

## How it works

1. **Recording** — `sd.InputStream` calls `callback` with small audio blocks while you talk. They go into a queue; on Enter, they're joined with NumPy and written as a WAV file.
2. **Transcription** — the WAV is uploaded to the speech-to-text endpoint, which returns plain text.
3. **Local commands first** — cheap, deterministic questions (time, date, "clear memory") are answered in Python without an LLM call. This is the same "route to a function" idea as tool calling, done with `if` statements.
4. **LLM with memory** — the transcript joins `self.history`, the last 20 messages go to the model, and the reply is saved. The system prompt asks for short, markdown-free answers because they're spoken.
5. **Speech** — the reply is turned into a WAV with text-to-speech and played back. `sd.wait()` blocks so it doesn't start listening while talking.

Latency is the sum of three network calls. Short replies and a small `max_completion_tokens` keep it snappy.

## Stretch goals

- [ ] **Real tool calling** — replace `local_command` with [tool calling](../../02-calling-models/05-tool-function-calling.md): weather, reminders, opening URLs.
- [ ] **Stream the reply** — speak sentence by sentence as tokens arrive to cut perceived latency.
- [ ] **Wake word** — listen continuously for "hey assistant" (e.g. openWakeWord, Porcupine).
- [ ] **Voice activity detection** — stop recording automatically on silence instead of Enter.
- [ ] **Fully local** — `faster-whisper` for STT, a local model through Ollama, and Piper for TTS.
- [ ] **Persistent memory** — save `history` to JSON between runs and summarize old turns.
- [ ] **Realtime API** — try a speech-to-speech model for a much lower-latency conversation.
- [ ] **Web UI** — move it to Streamlit or Gradio with a mic input component.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
