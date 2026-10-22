# Work log: portfolio fixes and the notes site

_October 20–21, 2026_

## Summary

- **Portfolio runs again.** It needs Node 14. An `.nvmrc` now selects that automatically with `nvm use`.
- **New notes site** in [`notes/`](notes/), built with Docusaurus:
  - an empty "AI Engineer Roadmap" with 169 titled pages to write in;
  - a reading-first layout styled like the portfolio;
  - live at **https://chiraggandhi-notes.vercel.app**.
- **The portfolio nav links to it** ("Notes ↗").
- **Nothing is committed yet.** All changes are in the working tree.

---

## 1. Getting the portfolio to start

**Problem:** `npm start` crashed with `ERR_PACKAGE_PATH_NOT_EXPORTED` (from `postcss-safe-parser`). The project uses `react-scripts` 4.0.1, which doesn't work on Node 17 or newer. The machine's default Node is 22.

**Fix:**
- Run the portfolio on Node 14 (already installed through nvm).
- Added `.nvmrc` containing `14`, so `nvm use` in the repo root picks it.
- No dependency changes were needed.

**Also fixed:** `src/components/Blogs/index.js` was an empty, untracked file. The old router-based `App.js` mounted it on `/blogs`, which caused an "invalid prop `component` supplied to `Route`" error. It's now a small "Coming soon" placeholder.

> The site was later redesigned into `src/site/*` with content in `src/data.js`, and that version doesn't use the router or `Blogs` any more. The placeholder is harmless but unused.

## 2. First notes attempt (built, then removed)

1. Built a notes section inside the portfolio:
   - Markdown files in `src/notes/`;
   - rendered with `markdown-to-jsx`;
   - cards on the page, plus a full-screen reader.
2. You then shared [notes.priyanshsinghal.com](https://notes.priyanshsinghal.com/docs/roadmap) and asked for a Docusaurus site like it.
3. So the in-page section was removed completely:
   - deleted `src/site/Notes.js`, `src/notes/` and its CSS;
   - put `Sections.js` and `App.js` back as they were;
   - uninstalled `markdown-to-jsx`. `node_modules` is committed in this repo, so this was checked to touch only that one package.

## 3. The notes site (`notes/`)

### Why it's a separate site

Docusaurus 3.10 needs Node 20 or newer and React 19. The portfolio is stuck on Node 14 and React 17, so the notes can't live inside it.

The notes are a separate project in the same repo:
- its own `package.json`;
- `notes/.nvmrc` set to `20`;
- its own `.gitignore`, so `notes/node_modules` and `notes/build` aren't committed.

### Roadmap structure

The structure is modelled on the example site. Every page has a title and nothing else, so you write all the content yourself.

| Folder (`notes/docs/`) | Stage | Topic pages | Project pages |
| --- | --- | ---: | ---: |
| `00-python-for-ai` | 0 · Python for AI | 14 | 2 |
| `01-llm-basics` | 1 · LLM Basics | 8 | 2 |
| `02-calling-models` | 2 · Calling Models | 9 | 0 |
| `03-prompting-llm-apps` | 3 · Prompting & LLM Apps | 10 | 4 |
| `04-rag` | 4 · Retrieval (RAG) | 30 | 5 |
| `05-advanced-rag` | 5 · Advanced & Production RAG | 9 | 3 |
| `06-fine-tuning` | 6 · Fine-Tuning & Open Models | 8 | 2 |
| `07-agentic-ai` | 7 · Agentic AI (31 lessons in "The Agentic AI Course", modules A–J, plus 5 topics) | 36 | 9 |
| `08-agentops` | 8 · AgentOps, MCP & Production | 11 | 7 |
| **Total** | | **135** | **34** |

Four more pages sit at the top level:
- `intro.md` (Author Introduction)
- `roadmap.md` (at `/roadmap`, for your own write-up)
- `glossary.md`
- `interview-prep.md`

**Where it differs from the example:**
- **Stages 1–3:** the example only says "Coming soon" for these, so their chapter titles are new. Rename them freely.
- **Duplicates dropped:** some course lessons in the example just pointed back to stage 4 pages (Guardrails, Evaluation, LLM Gateways, CRAG, Self-RAG, Agentic RAG). They were left out so each topic has one page. As a result, the FDE track is module J instead of K.
- **Project titles:** these are copied from the example and come from Krish Naik's course. Delete any `projects/` folders you don't plan to do.

### Writing a note

1. Open the page, for example `notes/docs/04-rag/02-introduction-to-rag.md`, and write below the front matter.
2. Delete the `sidebar_class_name: soon` line when the page has content. This updates:
   - the page's dot on the home page (○ becomes ●);
   - the written/total counts;
   - the "// not written yet" stamp, which disappears.
3. To add a page, create a new `.md` file with a `title:`. The number at the start of the file name sets its order. The home page picks it up automatically.

`.md` files are plain Markdown (`markdown.format: 'detect'`), so characters like `<`, `{` and `<!-- comments -->` don't break the build. Rename a file to `.mdx` if you want React components in it.

### Layout and style (approved option: "Reading-first" + "Match the portfolio")

**Home page** (`src/pages/index.js`):
- Big orange "THE AI ENGINEER ROADMAP" title;
- a "9 stages · 169 notes · N written" line with a progress bar;
- links to the four top-level pages;
- an expandable list of stages, each with its written/total count and ● / ○ dots per note.

**Note pages:**
- No left sidebar on desktop, just a centred reading column.
- Mono breadcrumbs, an "On this page" contents list on the right, and previous/next links.
- On mobile, the menu still lists every page.

**Stage pages** (like `/rag`) use the same dot list instead of Docusaurus's default cards.

**Style:**
- Anton uppercase orange headings, JetBrains Mono uppercase labels, Inter for reading;
- dark code blocks (oneDark);
- an orange "Portfolio ↗" pill, plus GitHub and LinkedIn icons;
- dark mode supported.

**Search** comes from `@easyops-cn/docusaurus-search-local`. It works on the deployed site and on production builds, not under `npm start`.

### Key files

| File | What it does |
| --- | --- |
| `notes/docusaurus.config.js` | Site config: URL, navbar, fonts, search, plain-Markdown mode |
| `notes/sidebars.js` | Sidebar generated automatically from the `docs/` folders |
| `notes/plugins/notes-index.js` | Hands the sidebar structure to the home page |
| `notes/src/pages/index.js` | Home page |
| `notes/src/components/NoteTree/` | The ● / ○ note list used on the home page and stage pages |
| `notes/src/theme/DocCardList/` | Stage pages use the note list instead of cards |
| `notes/src/theme/DocItem/Content/` | Adds the "not written yet" stamp |
| `notes/src/css/custom.css` | Portfolio styling, and hiding the sidebar on desktop |
| `notes/README.md` | How to run, write and deploy |

## 4. Portfolio changes

- `src/data.js`: added `profile.notes = "https://chiraggandhi-notes.vercel.app"`.
- `src/site/Hero.js`: added **Notes ↗** to the nav, between About and Resume. It opens in a new tab.
- `.nvmrc`: `14`.
- `src/components/Blogs/index.js`: the placeholder component from section 1.

## 5. Deployment

| | |
| --- | --- |
| Live URL | https://chiraggandhi-notes.vercel.app |
| Vercel project | `chiraggandhi-notes`, in the personal scope `chiraggandhi123s-projects`. The account also has a `funzofi-fed` team scope, which wasn't used. |
| How it was deployed | Vercel CLI from `notes/`. It isn't connected to git. |
| Access | Production is public. Preview URLs are behind Vercel Authentication (the default). |
| Ignored on upload | `notes/.vercelignore`: `node_modules`, `build`, `.docusaurus`, `.env*` |
| Local link files | `notes/.vercel/` and `notes/.env.local` (gitignored) |

Redeploy after writing notes:

```bash
cd notes
nvm use 22 && npx vercel@65.0.0 deploy --prod --yes
```

To deploy on every push instead, connect the repo in the Vercel dashboard and set **Root Directory** to `notes`.

## 6. What was checked

- Production builds pass. `onBrokenLinks: 'throw'` makes the build fail on any broken link.
- Checked in a browser:
  - home page, note page, roadmap page and stage pages;
  - search results for "langgraph";
  - phone width (390px) in dark mode, with no horizontal scrolling.
- The live site returns 200 for `/`, `/rag`, `/roadmap` and the search index, and shows the new layout.
- The portfolio dev server compiles with no console errors, and its nav shows "Notes ↗" pointing at the live site.

## 7. Commands

```bash
# Portfolio (Node 14)
nvm use && npm start                      # http://localhost:3000

# Notes site (Node 20)
cd notes && nvm use
npm start -- --port 3001                  # live-reload while writing
npm run build && npm run serve -- --port 3001   # production build, search included

# Deploy notes (Node 22 for the Vercel CLI)
nvm use 22 && npx vercel@65.0.0 deploy --prod --yes
```

## 8. Still open

- **Nothing is committed.** The working tree also still has large, older pending changes, including `node_modules` and `build/`.
- **The portfolio isn't deployed.** CRA 4 can't build on Vercel's current Node versions. An earlier session confirmed the redesigned site builds with `react-scripts` 5.0.1 on Node 22, but that upgrade hasn't been applied. Until the portfolio is live, its "Notes ↗" link is only reachable locally.
- **The notes site isn't git-connected,** so every update needs a manual redeploy (see section 5).
- **Placeholder pages** for stages 1–3 and all project titles are guesses or copied from the example. Rename or delete them as you like.
- **`.playwright-mcp/`** in the repo root only holds screenshots from browser checks. It's safe to delete.
