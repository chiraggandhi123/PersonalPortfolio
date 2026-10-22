#!/usr/bin/env node
// Drafts a "learning AI in public" LinkedIn post from the notes committed in
// the last N hours. It never posts anything: the daily GitHub Action
// (.github/workflows/linkedin-post.yml) puts the draft in an issue for review.
//
//   node scripts/linkedin-post.mjs                 # notes committed in the last 24h
//   node scripts/linkedin-post.mjs --hours 48      # widen the window
//   node scripts/linkedin-post.mjs --out post.md   # write to a file instead of stdout
//   node scripts/linkedin-post.mjs --clip          # also copy to the clipboard (macOS)
//
// Prints nothing and writes no file when no notes were written in the window.
// A note counts as written once its front matter no longer has `sidebar_class_name: soon`.

import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'notes', 'docs');
const SITE = 'https://chiraggandhi-notes.vercel.app';
const ROADMAP = `${SITE}/roadmap`;
const TZ = 'Asia/Kolkata';
const MAX_BULLETS = 6;

const HOOKS = [
  'Day {day} of learning AI in public 🚀',
  'Day {day} of my AI engineering journey 🧠',
  'Learning AI, one note at a time: Day {day} 📒',
  'Day {day}: still showing up, still learning AI ⚡',
  'Day {day} of going from developer to AI engineer 🛠️',
];
const CLOSERS = [
  "If you're learning AI too, let's connect. What should I dig into next?",
  'Building in public keeps me honest. Any resources you swear by for this?',
  "Learning this alongside work. If you are too, drop a 👋 and let's keep each other going.",
  "Anything here you see differently? I'd love to hear it in the comments.",
];
const HASHTAGS = '#AI #LearningInPublic #GenerativeAI #LLM #AIEngineering';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const hours = Number(opt('--hours') ?? 24);
const outFile = opt('--out');

const git = (...a) => execFileSync('git', a, {cwd: ROOT, encoding: 'utf8', env: {...process.env, TZ}});

// ---------- notes on disk ----------
const stripPrefix = (s) => s.replace(/^\d+-/, '');

function frontMatter(src) {
  const fm = {};
  for (const line of (src.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '').split('\n')) {
    const kv = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
    if (kv) fm[kv[1]] = kv[2];
  }
  return fm;
}

function readNote(relFromRoot) {
  const file = path.join(ROOT, relFromRoot);
  const rel = path.relative(DOCS, file);
  // Only notes inside a stage folder (skip intro, roadmap, glossary...).
  if (!fs.existsSync(file) || !rel.includes(path.sep) || !file.endsWith('.md')) return null;
  const src = fs.readFileSync(file, 'utf8');
  const fm = frontMatter(src);
  if (!fm.title || /^sidebar_class_name:\s*soon/m.test(src)) return null;
  return {file, rel, src, fm};
}

const plain = (md) =>
  md.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim();

// First sentence of the note's "## TL;DR" section, if it has one.
function takeaway(src) {
  const m = src.match(/##\s*TL;DR\s*\n+([\s\S]*?)(\n##|\n```|$)/);
  if (!m) return null;
  const text = plain(m[1].split(/\n\s*\n/)[0].replace(/^[-*]\s+/gm, ''));
  const sentence = text.match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? text;
  return sentence.length > 160 ? `${sentence.slice(0, 157).trimEnd()}…` : sentence;
}

function stageLabel(rel) {
  try {
    const cat = path.join(DOCS, rel.split(path.sep)[0], '_category_.json');
    return JSON.parse(fs.readFileSync(cat, 'utf8')).label.replace(/^\d+\s*·\s*/, '');
  } catch {
    return null;
  }
}

// ---------- what changed, from git ----------
const changedPaths = (sinceArg) =>
  [...new Set(git('log', `--since=${sinceArg}`, '--name-only', '--pretty=format:', '--', 'notes/docs').split('\n'))]
    .filter(Boolean);

const fresh = changedPaths(`${hours} hours ago`)
  .map(readNote)
  .filter(Boolean)
  .sort((a, b) => a.rel.localeCompare(b.rel));

if (fresh.length === 0) {
  console.error(`No notes written in the last ${hours}h. No post.`);
  process.exit(0);
}

// Day N = number of distinct days (IST) with a commit that touched notes.
const day = new Set(
  git('log', '--date=format-local:%Y-%m-%d', '--pretty=%cd', '--', 'notes/docs').split('\n').filter(Boolean),
).size;

const all = fs
  .readdirSync(DOCS, {recursive: true})
  .filter((p) => p.endsWith('.md') && p.includes(path.sep))
  .map((p) => fs.readFileSync(path.join(DOCS, p), 'utf8'))
  .filter((src) => frontMatter(src).title);
const written = all.filter((src) => !/^sidebar_class_name:\s*soon/m.test(src)).length;

// ---------- build the post ----------
const pick = (list) => list[(day - 1) % list.length];
const stages = [...new Set(fresh.map((n) => stageLabel(n.rel)).filter(Boolean))];
const stageDirs = new Set(fresh.map((n) => n.rel.split(path.sep)[0]));
const notesUrl = stageDirs.size === 1 ? `${SITE}/${stripPrefix([...stageDirs][0])}` : SITE;

const bullets = fresh.slice(0, MAX_BULLETS).map((n) => {
  const t = takeaway(n.src);
  return `• ${n.fm.title}${t ? `\n   ↳ ${t}` : ''}`;
});
if (fresh.length > MAX_BULLETS) bullets.push(`• …and ${fresh.length - MAX_BULLETS} more`);

const post = `${pick(HOOKS).replace('{day}', day)}

Yesterday I worked through ${stages.length ? stages.join(' + ') : 'a few topics'} and turned it into notes:

${bullets.join('\n')}

✍️ My notes (free to read): ${notesUrl}
🗺️ The roadmap I'm following, Python → LLMs → RAG → Agents → AgentOps: ${ROADMAP}

📈 Progress: ${written}/${all.length} notes written.

${pick(CLOSERS)}

${HASHTAGS}
`;

if (outFile) {
  fs.writeFileSync(outFile, post);
  fs.writeFileSync(`${outFile}.meta.json`, JSON.stringify({day, notes: fresh.length}));
} else {
  process.stdout.write(post);
}
if (args.includes('--clip')) execFileSync('pbcopy', {input: post});
