---
title: "Realtime Source-Code Analyzer"
---

## Goal

Build a chat assistant for a codebase: point it at a Git repo (a GitHub URL or a local folder), ask "where is authentication handled?" or "what does `process_order` do?", and get answers that **cite files and line context**. "Realtime" means the index **stays in sync while you code**: a file watcher re-indexes only the files that change, so answers reflect the current code without a full rebuild.

**Skills practiced:** cloning repos with GitPython, code-aware chunking, metadata per file, Chroma upserts and deletes, incremental re-indexing with `watchdog`, code-focused prompting.

## Architecture

```
GitHub URL ─► git clone ─┐
local path ──────────────┴─► repo/
                               │
                     index_repo(): for each source file
                       split by language (functions/classes) ─► Chroma (metadata: path, lang)
                               ▲
   watchdog observer ──────────┘  on create/modify: delete chunks for path → re-add
                                  on delete:        delete chunks for path

user ─► chat loop ─► retrieve top 6 chunks (MMR) ─► gpt-4o-mini ─► answer citing file paths
```

## Setup

```bash
pip install gitpython langchain-openai langchain-chroma langchain-text-splitters \
            watchdog python-dotenv
```

`.env`:

```
OPENAI_API_KEY=sk-...
```

## Code

### `indexer.py`

```python
from pathlib import Path
from git import Repo
from langchain_chroma import Chroma
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import Language, RecursiveCharacterTextSplitter

LANGS = {".py": Language.PYTHON, ".js": Language.JS, ".ts": Language.TS,
         ".go": Language.GO, ".java": Language.JAVA, ".md": Language.MARKDOWN}
SKIP_DIRS = {".git", "node_modules", "venv", ".venv", "dist", "build", "__pycache__"}

store = Chroma(collection_name="code", persist_directory="code_index",
               embedding_function=OpenAIEmbeddings(model="text-embedding-3-small"))

def get_repo(src: str) -> Path:
    if src.startswith(("http://", "https://", "git@")):
        dest = Path("repos") / src.rstrip("/").split("/")[-1].removesuffix(".git")
        if not dest.exists():
            Repo.clone_from(src, dest, depth=1)        # shallow clone is enough
        return dest
    return Path(src)

def is_indexable(path: Path) -> bool:
    return (path.suffix in LANGS and not SKIP_DIRS & set(path.parts)
            and path.is_file() and path.stat().st_size < 200_000)

def remove_file(path: Path):
    ids = store.get(where={"path": str(path)})["ids"]
    if ids:
        store.delete(ids=ids)

def index_file(path: Path):
    remove_file(path)                                   # replace old chunks
    if not is_indexable(path):
        return
    splitter = RecursiveCharacterTextSplitter.from_language(
        LANGS[path.suffix], chunk_size=1200, chunk_overlap=100)
    text = path.read_text(errors="ignore")
    chunks = splitter.create_documents([text], metadatas=[{"path": str(path),
                                                           "lang": path.suffix}])
    for c in chunks:                                    # header helps retrieval and citation
        c.page_content = f"# File: {path}\n{c.page_content}"
    if chunks:
        store.add_documents(chunks, ids=[f"{path}:{i}" for i in range(len(chunks))])

def index_repo(root: Path):
    files = [p for p in root.rglob("*") if is_indexable(p)]
    for p in files:
        index_file(p)
    print(f"Indexed {len(files)} files")
```

### `watcher.py`

```python
from pathlib import Path
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer
from indexer import index_file, remove_file

class Reindex(FileSystemEventHandler):
    def on_created(self, event):
        if not event.is_directory:
            index_file(Path(event.src_path)); print("indexed", event.src_path)

    on_modified = on_created

    def on_deleted(self, event):
        if not event.is_directory:
            remove_file(Path(event.src_path)); print("removed", event.src_path)

def watch(root: Path) -> Observer:
    obs = Observer()
    obs.schedule(Reindex(), str(root), recursive=True)
    obs.start()                                          # runs in a background thread
    return obs
```

### `main.py`

```python
import sys
from dotenv import load_dotenv
load_dotenv()

from openai import OpenAI
from indexer import get_repo, index_repo, store
from watcher import watch

client = OpenAI()
root = get_repo(sys.argv[1])
index_repo(root)
observer = watch(root)
retriever = store.as_retriever(search_type="mmr", search_kwargs={"k": 6, "fetch_k": 20})

SYSTEM = ("You are a senior engineer explaining a codebase. Answer from the code "
          "snippets only. Mention file paths for every claim. If the snippets don't "
          "show it, say which files to look at instead of guessing.")
history = []

try:
    while True:
        q = input("\nask> ")
        docs = retriever.invoke(q)
        context = "\n\n---\n\n".join(d.page_content for d in docs)
        history.append({"role": "user", "content": f"Code:\n{context}\n\nQuestion: {q}"})
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "system", "content": SYSTEM}, *history[-6:]])
        reply = resp.choices[0].message.content
        history.append({"role": "assistant", "content": reply})
        print(reply)
finally:
    observer.stop(); observer.join()
```

Run `python main.py https://github.com/some/repo` or `python main.py ../my-project`. Edit a file in the repo while the chat runs; the watcher re-indexes it within a second.

## How it works

1. **Code-aware splitting.** `from_language` splits on language boundaries (classes, functions) before falling back to lines, so chunks are usually whole functions.
2. **File header in each chunk** (`# File: path`) gives the embedding and the model the location, so answers can cite paths.
3. **Deterministic ids** (`path:i`) plus delete-then-add make re-indexing a file idempotent.
4. **The watcher** listens for filesystem events and re-indexes only the touched file. That's the "realtime" part: cost scales with the edit, not the repo size.
5. **MMR retrieval** picks diverse chunks, so one large file doesn't fill all six slots.
6. **History** keeps the last few turns for follow-ups ("and where is that called?").

## Gotchas

- Editors fire several events per save; debounce if you see duplicate re-indexing.
- Embeddings match on names and comments well but miss call graphs; "who calls X?" is better answered with `grep` or a static-analysis tool exposed as an extra function.
- Skip generated files, lockfiles and vendored code, or they will dominate search results.

## Stretch goals

- [ ] **Tool calling** — give the model `grep_repo` and `read_file` tools for exact lookups.
- [ ] **Debounced watcher** with a short delay per path.
- [ ] **Git-aware updates** — re-index files changed between two commits (`git diff --name-only`).
- [ ] **Symbol metadata** — store function and class names for filtering.
- [ ] **Streamlit UI** with syntax-highlighted sources.
- [ ] **Code-specific embedding model** and compare retrieval quality.
- [ ] **Eval set** of 20 "where is X?" questions with the correct file.

## What I learned

<!-- Fill in after building: surprises, bugs, what you'd do differently. -->
