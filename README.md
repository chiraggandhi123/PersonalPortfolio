# Chirag Gandhi — Portfolio

Single-page portfolio in the style of [nskr.dev](https://www.nskr.dev/): orange poster hero, numbered sections, generated project thumbnails.

## Editing content

Everything on the page comes from **`src/data.js`** — profile, stack, experience, projects, awards, education, contact links. Change it there; no component edits needed.

- Wrap words in `*asterisks*` in `about.headline` / `contact.headline` to get the orange italic accent.
- To show a photo instead of the terminal in the hero, add it to `src/Assets/` and set `profile.photo` to the imported image.
- Each project picks a generated thumbnail via `visual` (see the list at the bottom of `src/site/Visuals.js`).
- The resume download is `public/resume.pdf`.

## Code map

| File | What it holds |
| --- | --- |
| `src/data.js` | All content |
| `src/site/Hero.js` | Nav, mobile menu, hero with the typing terminal and marquee |
| `src/site/Sections.js` | About → Contact sections and footer |
| `src/site/Visuals.js` | Animated SVG project thumbnails |
| `src/site/Reveal.js` | Scroll-reveal, word-by-word headline, count-up helpers |
| `src/site/site.css` | All styles (tokens at the top) |

## Running

This is Create React App 4 (`react-scripts@4.0.1`), which only runs on **Node ≤ 16**:

```bash
nvm use 14
npm start          # http://localhost:3000
npm run build      # outputs to build/
```

On Node 17+ the build fails inside react-scripts 4 (`ERR_PACKAGE_PATH_NOT_EXPORTED`). Hosting platforms like Vercel no longer offer Node 14/16, so to deploy from CI either upgrade to `react-scripts@5` / Vite, or build locally on Node 14 and upload the `build/` folder.
