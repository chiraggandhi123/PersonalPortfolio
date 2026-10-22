#!/usr/bin/env node
// Drafts a "learning AI in public" LinkedIn post, one note per day.
//
// Notes are posted in roadmap order. linkedin-posts/posted.json records which
// notes have been posted, so each run takes the next written note that hasn't
// been posted yet. It never posts anything itself: the daily GitHub Action
// (.github/workflows/linkedin-post.yml) puts the draft in an issue for review.
//
//   node scripts/linkedin-post.mjs                # next note → post.md, record it
//   node scripts/linkedin-post.mjs --count 4      # next 4 notes in one post
//   node scripts/linkedin-post.mjs --dry          # print only, record nothing
//   node scripts/linkedin-post.mjs --out post.md  # write the post to a file
//   node scripts/linkedin-post.mjs --clip         # also copy to clipboard (macOS)
//
// When every written note has been posted, writes a reminder naming the next
// note to write (to <out>.reminder.md) instead of a post.
// A note counts as written once its front matter no longer has `sidebar_class_name: soon`.

import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'notes', 'docs');
const STATE_FILE = path.join(ROOT, 'linkedin-posts', 'posted.json');
const SITE = 'https://chiraggandhi-notes.vercel.app';
const ROADMAP = `${SITE}/roadmap`;
const MAX_BULLETS = 6;
const SKIP_HEADINGS = /^(TL;DR|Key terms|Interview quick-fire|Checklist|Next steps|Setup|Goal|What I learned)/i;

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
const count = Number(opt('--count') ?? 1);
const outFile = opt('--out');
const dry = args.includes('--dry');

// ---------- read notes ----------
const stripPrefix = (s) => s.replace(/^\d+-/, '');

function frontMatter(src) {
  const fm = {};
  for (const line of (src.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '').split('\n')) {
    const kv = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
    if (kv) fm[kv[1]] = kv[2];
  }
  return fm;
}

const plain = (md) =>
  md.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim();

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function section(src, heading) {
  return src.match(new RegExp(`##\\s*${heading}\\s*\\n+([\\s\\S]*?)(\\n## |$)`))?.[1] ?? null;
}

// First paragraph of "## TL;DR" (code blocks dropped).
function tldr(src) {
  const body = section(src, 'TL;DR');
  if (!body) return null;
  return plain(body.replace(/```[\s\S]*?```/g, '').split(/\n\s*\n/)[0].replace(/^[-*]\s+/gm, ''));
}

const firstSentence = (text) => text?.match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? text;

function interviewQ(src) {
  const line = section(src, 'Interview quick-fire')?.match(/^- \*\*"?(.+?)"?\*\*\s*→\s*(.+)$/m);
  return line ? {q: plain(line[1]), a: clip(plain(line[2]), 220)} : null;
}

function headings(src) {
  return [...src.matchAll(/^## (.+)$/gm)].map((m) => plain(m[1])).filter((h) => !SKIP_HEADINGS.test(h));
}

function stageLabel(rel) {
  try {
    const cat = path.join(DOCS, rel.split(path.sep)[0], '_category_.json');
    return JSON.parse(fs.readFileSync(cat, 'utf8')).label.replace(/^\d+\s*·\s*/, '');
  } catch {
    return null;
  }
}

const url = (n) =>
  n.fm.slug ? SITE + `/${n.fm.slug.replace(/^\//, '')}` : `${SITE}/${n.rel.replace(/\.md$/, '').split(path.sep).map(stripPrefix).join('/')}`;

// Every note inside a stage folder, in roadmap order.
const notes = fs
  .readdirSync(DOCS, {recursive: true})
  .filter((p) => p.endsWith('.md') && p.includes(path.sep))
  .sort((a, b) => a.localeCompare(b))
  .map((rel) => {
    const src = fs.readFileSync(path.join(DOCS, rel), 'utf8');
    return {rel, src, fm: frontMatter(src), written: !/^sidebar_class_name:\s*soon/m.test(src)};
  })
  .filter((n) => n.fm.title);

let state = {posts: []};
try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
} catch {}
const posted = new Set(state.posts.flatMap((p) => p.notes));

const queue = notes.filter((n) => n.written && !posted.has(n.rel));
const batch = queue.slice(0, count);
const nextUp = queue[count] ?? notes.find((n) => !n.written);
const writtenCount = notes.filter((n) => n.written).length;

// ---------- nothing to post: remind which note to write ----------
if (batch.length === 0) {
  const next = notes.find((n) => !n.written);
  const msg = next
    ? `Every written note has been posted. Next note to write: **${next.fm.title}** (\`notes/docs/${next.rel}\`).\n\nWrite it, delete the \`sidebar_class_name: soon\` line, push, and tomorrow's post will cover it.`
    : 'Every note on the roadmap is written and posted. 🎉';
  if (outFile) fs.writeFileSync(`${outFile}.reminder.md`, msg + '\n');
  console.error(msg);
  process.exit(0);
}

// ---------- build the post ----------
const day = state.posts.length + 1;
const pick = (list) => list[(day - 1) % list.length];
const hook = pick(HOOKS).replace('{day}', day);
const progress = `📈 Progress: ${writtenCount}/${notes.length} notes written.`;
const next = nextUp ? `\n⏭️ Next up: ${nextUp.fm.title}\n` : '';

let post;
if (batch.length === 1) {
  const [n] = batch;
  const covered = headings(n.src).slice(0, 5).map((h) => `• ${h}`).join('\n');
  const iq = interviewQ(n.src);
  post = `${hook}

Today's topic: ${n.fm.title}

${clip(tldr(n.src) ?? '', 400)}
${covered ? `\nWhat I covered:\n${covered}\n` : ''}${iq ? `\n💡 An interview question I can now answer:\n"${iq.q}"\n→ ${iq.a}\n` : ''}
✍️ Full notes (free to read): ${url(n)}
🗺️ The roadmap I'm following, Python → LLMs → RAG → Agents → AgentOps: ${ROADMAP}

${progress}${next}
${pick(CLOSERS)}

${HASHTAGS}
`;
} else {
  const stages = [...new Set(batch.map((n) => stageLabel(n.rel)).filter(Boolean))];
  const stageDirs = new Set(batch.map((n) => n.rel.split(path.sep)[0]));
  const notesUrl = stageDirs.size === 1 ? `${SITE}/${stripPrefix([...stageDirs][0])}` : SITE;
  const bullets = batch.slice(0, MAX_BULLETS).map((n) => {
    const t = firstSentence(tldr(n.src));
    return `• ${n.fm.title}${t ? `\n   ↳ ${clip(t, 160)}` : ''}`;
  });
  if (batch.length > MAX_BULLETS) bullets.push(`• …and ${batch.length - MAX_BULLETS} more`);
  post = `${hook}

Today I worked through ${stages.length ? stages.join(' + ') : 'a few topics'} and turned it into notes:

${bullets.join('\n')}

✍️ My notes (free to read): ${notesUrl}
🗺️ The roadmap I'm following, Python → LLMs → RAG → Agents → AgentOps: ${ROADMAP}

${progress}${next}
${pick(CLOSERS)}

${HASHTAGS}
`;
}

// ---------- output ----------
if (outFile) {
  fs.writeFileSync(outFile, post);
  fs.writeFileSync(`${outFile}.meta.json`, JSON.stringify({day, title: batch.length === 1 ? batch[0].fm.title : `${batch.length} notes`}));
} else {
  process.stdout.write(post);
}
if (args.includes('--clip')) execFileSync('pbcopy', {input: post});
if (!dry) {
  state.posts.push({day, date: new Date().toISOString().slice(0, 10), notes: batch.map((n) => n.rel)});
  fs.mkdirSync(path.dirname(STATE_FILE), {recursive: true});
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}
