// Everything the site shows lives here. Edit this file to update the portfolio.
// Sources: ChiragGandhi_ai_fullstack.pdf + ChiragGandhi_fullstack_rp.pdf (Oct 2026),
// side projects from the previous version of this site.

export const profile = {
  name: "Chirag Gandhi",
  short: "CHIRAG",
  ghost: "GANDHI",
  role: "Lead Engineer",
  heroTitle: "FULL STACK",
  heroLeft: [
    "// I'M CHIRAG — LEAD ENGINEER AT",
    "NAUKRI CAMPUS. 5+ YEARS SHIPPING WEB",
    "PRODUCTS FOR 200K+ USERS.",
  ],
  heroRight: ["// NOW BUILDING", "AGENTIC AI · VOICE · EVALS"],
  // Drop a photo in src/Assets and import it here to replace the terminal in the hero.
  photo: null,
  email: "chiraggandhi70726@gmail.com",
  resume: "/resume.pdf",
  site: "https://chiraggandhi.vercel.app",
  // The Docusaurus notes site in notes/ (deploy it as the Vercel project "chiraggandhi-notes").
  notes: "https://chiraggandhi-notes.vercel.app",
};

export const marquee = [
  "TypeScript",
  "React",
  "Next.js",
  "Node.js",
  "Python",
  "Claude",
  "Gemini",
  "OpenAI",
  "LiveKit",
  "ElevenLabs",
  "GraphQL",
  "AWS",
  "Redux",
  "PostgreSQL",
  "Docker",
  "Kubernetes",
  "React Native",
  "GitHub Actions",
];

export const about = {
  // Words wrapped in *asterisks* render as the orange italic accent.
  headline: "I build web products for scale — *and AI agents that talk back.*",
  paragraphs: [
    "I'm a Lead Engineer at Naukri Campus (InfoEdge) with 5+ years of shipping full-stack products — contest, engagement and assessment platforms used by 200K+ users. My home turf is TypeScript, React and Node.js, with a soft spot for performance work.",
    "Lately I build agentic AI end to end: multi-agent orchestration, real-time voice, structured outputs, guardrails and LLM-as-judge evaluation, routed across Claude, Gemini and OpenAI.",
  ],
  stats: [
    { value: 200, suffix: "K+", label: "Users served" },
    { value: 5, suffix: "+", label: "Years shipping" },
    { value: 40, suffix: "%", label: "Faster page loads" },
    { value: 20, suffix: "K", label: "Simulated agent sessions" },
  ],
  stamps: ["// shipping since 2021", "// 200k+ users"],
};

export const stack = [
  {
    group: "AI / LLM",
    items: [
      "Claude API",
      "Gemini API",
      "OpenAI API",
      "Multi-Agent Systems",
      "Agent Orchestration",
      "Structured Outputs",
      "LLM-as-Judge",
      "Guardrails",
      "RAG",
      "Vector DBs",
      "Prompt Engineering",
    ],
  },
  {
    group: "Realtime & Voice",
    items: ["LiveKit (WebRTC)", "SSE Streaming", "ElevenLabs TTS/STT", "Web Speech API"],
  },
  {
    group: "Languages",
    items: ["TypeScript", "JavaScript", "Python", "SQL", "HTML", "CSS / SASS"],
  },
  {
    group: "Frontend",
    items: ["React", "Next.js", "Redux", "React Native", "styled-components", "Vite", "Webpack"],
  },
  {
    group: "Backend & APIs",
    items: ["Node.js", "Express", "Flask", "REST", "GraphQL", "gRPC", "Microservices", "OAuth", "JWT"],
  },
  {
    group: "Cloud & Data",
    items: ["AWS EC2", "S3", "RDS", "Aurora", "DynamoDB", "PostgreSQL", "MySQL", "MongoDB"],
  },
  {
    group: "CI/CD & DevOps",
    items: ["Docker", "Kubernetes", "GitHub Actions", "Jenkins", "ESLint", "Git"],
  },
  {
    group: "Tools",
    items: ["Claude Code", "Cursor", "GitHub Copilot", "Jira", "Confluence", "Figma", "Bitbucket"],
  },
];

export const experience = [
  {
    company: "InfoEdge · Naukri Campus",
    mark: "NC",
    markColor: "#4a6cf7",
    meta: "Full-time",
    period: "Mar 2022 — Present",
    link: "https://www.naukri.com/campus",
    roles: [
      {
        title: "Lead Engineer",
        period: "Apr 2025 — Present",
        points: [
          "Built a real-time multi-agent Group Discussion simulator: 5 LLM personas share a LiveKit voice room, stream replies, interrupt each other and yield when the candidate speaks",
          "Designed the orchestration layer — an LLM dispatcher returning strict JSON, backed by a deterministic fallback and a shared guardrail gate; 20,000 simulated sessions, all 47K adversarial decisions blocked",
          "Built a provider-agnostic LLM layer that routes by workload (Gemini Flash for streaming, Claude for evaluation) with automatic fallback",
          "Led the React 17 → 18 migration and performance work (code-splitting, Webpack 5, Partytown): page load −40%, interaction latency −15%",
          "Introduced TypeScript across core modules (production bugs −30%) and mentored 3+ engineers",
        ],
      },
      {
        title: "Senior Software Engineer",
        period: "Jun 2023 — Apr 2025",
        points: [
          "Shipped 10+ production features across contest, engagement and assessment platforms used by 200K+ users",
          "Led Core Web Vitals optimization across 10+ high-traffic pages: INP −38%, CLS −95%",
          "Set up CI/CD with GitHub Actions and Jenkins to automate build, lint, test and deploy",
          "5-Star Annual Rating, Quarterly Individual Excellence Award and Team Collaboration Award",
        ],
      },
      {
        title: "Software Engineer",
        period: "Mar 2022 — Jun 2023",
        points: [
          "Built an AI-powered resume summary system with LLM-based generation, improving resume quality scores by 20%",
          "Migrated 7+ components to React Native and Flutter and benchmarked both (React Native used up to 2.7× more CPU)",
          "Implemented secure JWT-based authentication",
        ],
      },
    ],
    tags: ["TypeScript", "React", "Node.js", "LiveKit", "Claude", "Gemini", "AWS", "GitHub Actions"],
  },
  {
    company: "TO THE NEW",
    mark: "TTN",
    markColor: "#e11d48",
    meta: "Full-time · Noida",
    period: "Aug 2021 — Mar 2022",
    roles: [
      {
        title: "Software Developer",
        points: [
          "Built 3 high-traffic UIs with React, Redux and SASS serving 50K+ daily active users",
          "Built APIs with Node.js and Flask (Python), reducing average latency by 40%",
          "Cut JavaScript bundle size by 25% by refactoring legacy code",
        ],
      },
    ],
    tags: ["React", "Redux", "SASS", "Node.js", "Flask", "Webpack"],
  },
  {
    company: "Coding Blocks",
    mark: "CB",
    markColor: "#f59e0b",
    meta: "Teaching",
    period: "Oct 2020 — Jul 2021",
    link: "https://drive.google.com/file/d/1ISnso91MObnboqgzILXodvo-x7UKQJOi/view",
    roles: [
      {
        title: "Teaching Assistant",
        points: [
          "Resolved 300+ student queries in Python, C++, Machine Learning and Data Science through 1-on-1 sessions",
        ],
      },
    ],
    tags: ["Python", "C++", "Machine Learning", "Data Science"],
  },
];

// visual: which generated thumbnail to draw (see src/site/Visuals.js)
export const featured = [
  {
    title: "GD Simulator",
    tagline: "Five LLM agents, one live voice room",
    period: "Lead Engineer · Naukri Campus",
    desc: "A real-time Group Discussion simulator. Five agent personas share a LiveKit room, each with its own ElevenLabs voice; they stream replies, interrupt each other and yield the floor the moment the candidate speaks.",
    tags: ["TypeScript", "Node.js", "React", "LiveKit", "ElevenLabs"],
    visual: "council",
  },
  {
    title: "Guardrailed Orchestrator",
    tagline: "Strict-JSON dispatcher with a deterministic safety net",
    period: "Lead Engineer · Naukri Campus",
    desc: "An LLM dispatcher picks the next speaker as strict JSON, backed by a deterministic fallback and a shared guardrail gate. Stress-tested with 20,000 simulated sessions — all 47K adversarial decisions blocked.",
    tags: ["Structured Outputs", "Guardrails", "Evals"],
    visual: "gate",
  },
  {
    title: "LLM-as-Judge",
    tagline: "Rubric scoring with structured output",
    period: "Lead Engineer · Naukri Campus",
    desc: "Scores candidates on a 4-dimension rubric with structured output and a heuristic fallback, plus a dashboard that tracks score trends across sessions.",
    tags: ["Claude", "Structured Outputs", "React"],
    visual: "judge",
  },
];

// kind: "work" (built at a job) or "side" (personal project)
export const projects = [
  {
    title: "Multi-provider LLM Layer",
    tagline: "Routes by workload, falls back automatically",
    date: "Lead Engineer · Naukri Campus",
    tags: ["Gemini", "Claude", "Node.js"],
    kind: "work",
    visual: "router",
  },
  {
    title: "React 18 Migration",
    tagline: "Page load −40% · interaction latency −15%",
    date: "Lead Engineer · Naukri Campus",
    tags: ["React 18", "Webpack 5", "Partytown"],
    kind: "work",
    visual: "speed",
  },
  {
    title: "Core Web Vitals",
    tagline: "INP −38% · CLS −95% on 10+ pages",
    date: "Senior SWE · Naukri Campus",
    tags: ["Performance", "INP", "CLS"],
    kind: "work",
    visual: "vitals",
  },
  {
    title: "AI Resume Summary",
    tagline: "LLM-written summaries, +20% quality score",
    date: "SWE · Naukri Campus",
    tags: ["LLM", "React", "Node.js"],
    kind: "work",
    visual: "resume",
  },
  {
    title: "RN vs Flutter Benchmark",
    tagline: "7+ components ported; React Native used up to 2.7× more CPU",
    date: "SWE · Naukri Campus",
    tags: ["React Native", "Flutter"],
    kind: "work",
    visual: "bench",
  },
  {
    title: "Buzzz",
    tagline: "MERN social network with a moderator mode",
    date: "Side project",
    tags: ["MongoDB", "Express", "React", "Node.js"],
    kind: "side",
    visual: "graph",
    link: "https://github.com/chirag-ttn/PROJECT_BACKEND",
  },
  {
    title: "ChatApp",
    tagline: "Real-time chat over Express + Socket.io",
    date: "Side project",
    tags: ["Node.js", "Socket.io"],
    kind: "side",
    visual: "chat",
    link: "https://github.com/chiraggandhi123/my-discord-clone",
  },
  {
    title: "Twitter Clone",
    tagline: "React + Firebase real-time feed",
    date: "Side project",
    tags: ["React", "Firebase"],
    kind: "side",
    visual: "feed",
    link: "https://github.com/chiraggandhi123/fullstack-twitter-clone",
  },
  {
    title: "Covid-19 Detection",
    tagline: "Siamese ResNet across 4 chest X-ray classes",
    date: "Side project",
    tags: ["Python", "Deep Learning"],
    kind: "side",
    visual: "siamese",
  },
];

export const awards = [
  {
    date: "At InfoEdge",
    title: "5-Star Annual Rating",
    detail: "Plus the Quarterly Individual Excellence Award and the Team Collaboration Award.",
    badge: "★★★★★",
  },
  {
    date: "Jun 2022",
    title: "e-Yantra",
    detail: "Secured 2nd Prize.",
    badge: "2ND",
    link: "https://drive.google.com/file/d/1_m6fPh-Ej_qA7iQO3mlDlbOpBi4RyEe4/view?usp=sharing",
  },
  {
    date: "Jun 2021",
    title: "National Programming Contest",
    detail: "Ranked 6th — Nagarro × Coding Blocks.",
    badge: "6TH",
  },
  {
    date: "Jan 2020",
    title: "IDEAHACK",
    detail: "Secured 1st Prize — HackerEarth, BVP.",
    badge: "1ST",
  },
  {
    date: "Jan 2020",
    title: "RoboRugby",
    detail: "Secured 1st Prize — AVENSIS, MSIT.",
    badge: "1ST",
  },
];

export const education = [
  {
    period: "Aug 2017 — Aug 2021",
    title: "B.Tech, Information Technology",
    place: "BVCOE, New Delhi",
    note: "Bharati Vidyapeeth's College of Engineering (GGSIPU)",
  },
];

export const concepts = [
  "Data Structures & Algorithms",
  "DBMS",
  "Operating Systems",
  "Computer Networks",
  "Graph Theory",
  "Functional Programming",
  "OOP",
];

export const certifications = [
  {
    title: "AWS Certified Cloud Practitioner",
    issuer: "Amazon Web Services",
    link: "https://drive.google.com/file/d/1YMcnD68f4GNDlfWZBB25urZ8XGiFpbTs/view?usp=sharing",
  },
  {
    title: "AWS Cloud Foundations",
    issuer: "Amazon Web Services",
    link: "https://drive.google.com/file/d/1KJBG-MkgBSIyZMCNWLt0wcaz7IHqmh_0/view?usp=sharing",
  },
  {
    title: "Machine Learning",
    issuer: "Coding Blocks",
    link: "https://drive.google.com/file/d/1_sHeWpwaezj8KwRLVFx3nnyV9eRz1EI6/view",
  },
  {
    title: "Career Bootcamp",
    issuer: "Coding Blocks",
  },
  {
    title: "Introduction to MAD",
    issuer: "NPTEL",
    link: "https://drive.google.com/file/d/15iTHjPSyBRhpCjt8jSRahVgwT56Gj7Id/view?usp=sharing",
  },
];

export const contact = {
  // Same *asterisk* accent rule as the about headline.
  headline: "Got something *worth building?* Let's talk.",
  links: [
    { label: "GitHub", value: "github.com/chiraggandhi123", href: "https://github.com/chiraggandhi123" },
    {
      label: "LinkedIn",
      value: "linkedin.com/in/chiraggandhi123",
      href: "https://linkedin.com/in/chiraggandhi123",
    },
    { label: "Email", value: "chiraggandhi70726@gmail.com", href: "mailto:chiraggandhi70726@gmail.com" },
    { label: "Resume", value: "resume.pdf", href: "/resume.pdf" },
  ],
};
