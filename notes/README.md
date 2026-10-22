# Chirag's Notes

The notes site linked from the portfolio's **Notes ↗** nav item, live at https://chiraggandhi-notes.vercel.app. It's built with [Docusaurus](https://docusaurus.io/) and needs Node 20 (the portfolio itself still needs Node 14).

## Run it

```bash
cd notes
nvm use        # switches to Node 20 (from notes/.nvmrc)
npm install    # first time only
npm start      # http://localhost:3000, or add -- --port 3001 if the portfolio is running
```

Search only works on a production build: `npm run build && npm run serve`.

## Write a note

Every page already exists under `docs/`, one folder per roadmap stage:

1. Open the page, e.g. `docs/04-rag/02-introduction-to-rag.md`, and write under the front matter in normal Markdown.
2. Delete the `sidebar_class_name: soon` line once the page has content. That marks the note as written: its dot fills in on the home page, the stage's count goes up, and the "not written yet" stamp disappears.

To add a page, create a new `.md` file in the right folder with a `title:` in its front matter. The number at the start of the file name sets its order. To add a section, create a folder with a `_category_.json` (copy one from a sibling folder). The home page picks up new pages and sections automatically.

`docs/roadmap.md` (at `/roadmap`) is for your own write-up of the roadmap: how to use it, resources, pace.

## How it's put together

- `src/pages/index.js`: the home page (stage list with written/total counts).
- `plugins/notes-index.js`: hands the sidebar structure to the home page.
- `src/theme/`: small overrides. Stage pages reuse the home page's list, and unwritten pages get the stamp.
- `src/css/custom.css`: the portfolio styling, and the desktop layout without a sidebar (the mobile menu still lists every page).

## Deploy

The site is a Vercel project named **chiraggandhi-notes**. It isn't connected to git yet, so redeploy from this folder with:

```bash
nvm use 22 && npx vercel@65.0.0 deploy --prod --yes
```

To deploy on every push instead, connect the repo in the Vercel dashboard and set **Root Directory** to `notes`. Run `npm run build` before deploying if you've added links. The build fails on broken links.
