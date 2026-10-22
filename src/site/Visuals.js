import React from "react";
import { prefersReducedMotion } from "./Reveal";

// Generated, animated thumbnails for projects. Each draws in a 480×270 box.
// Animations live in site.css under the .viz-* selectors.

const MONO = "JetBrains Mono, ui-monospace, monospace";

function Frame({ name, label, fill, children }) {
  return (
    <svg
      className={`viz viz-${name}`}
      viewBox="0 0 480 270"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={label}
    >
      <rect width="480" height="270" fill={fill} />
      {children}
    </svg>
  );
}

function Council() {
  const colors = ["#a78bfa", "#22d3ee", "#ff6a1a", "#f43f5e", "#22c55e"];
  const agents = colors.map((c, i) => {
    const a = (-90 + i * 72) * (Math.PI / 180);
    return { c, x: 240 + 96 * Math.cos(a), y: 138 + 96 * Math.sin(a) };
  });
  return (
    <Frame name="council" label="Five agent personas around a candidate in a voice room" fill="url(#council-bg)">
      <defs>
        <linearGradient id="council-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6defa" />
          <stop offset="1" stopColor="#c8eaf0" />
        </linearGradient>
      </defs>
      {agents.map((a, i) => (
        <line key={`l${i}`} className="flow" x1={a.x} y1={a.y} x2="240" y2="138" stroke="rgba(14,14,19,.28)" strokeDasharray="3 6" />
      ))}
      {agents.map((a, i) => (
        <g key={i} className="agent" style={{ animationDelay: `${i * 1.4}s` }}>
          <circle className="ring" cx={a.x} cy={a.y} r="33" fill="none" stroke={a.c} strokeOpacity=".55" style={{ animationDelay: `${i * 1.4}s` }} />
          <circle cx={a.x} cy={a.y} r="20" fill={a.c} />
        </g>
      ))}
      <circle cx="240" cy="138" r="17" fill="#0e0e13" />
      <text x="240" y="142" textAnchor="middle" fontFamily={MONO} fontSize="9" fill="#fff">YOU</text>
      <text x="22" y="252" fontFamily={MONO} fontSize="10" letterSpacing="2" fill="rgba(14,14,19,.5)">LIVEKIT ROOM · 5 AGENTS</text>
    </Frame>
  );
}

function Gate() {
  const lanes = [78, 104, 130, 156, 182];
  const dots = [
    [0, 0, false], [1, 0.6, true], [2, 1.1, false], [3, 1.7, true], [4, 2.3, false],
    [0, 2.0, true], [2, 2.9, true], [1, 3.4, false], [3, 3.9, false], [4, 0.4, true],
  ];
  return (
    <Frame name="gate" label="Decisions flowing through a guardrail gate; adversarial ones are blocked" fill="#0d1117">
      {lanes.map((y) => (
        <line key={y} x1="30" y1={y} x2="450" y2={y} stroke="rgba(255,255,255,.06)" />
      ))}
      {dots.map(([lane, delay, bad], i) => (
        <circle
          key={i}
          className={bad ? "dot bad" : "dot"}
          cx="30"
          cy={lanes[lane]}
          r="5"
          fill={bad ? "#f43f5e" : "#22d3ee"}
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
      <rect className="bar" x="296" y="56" width="7" height="150" rx="3.5" fill="#ff6a1a" />
      <text x="300" y="44" textAnchor="middle" fontFamily={MONO} fontSize="10" letterSpacing="2" fill="#ff6a1a">GUARDRAIL</text>
      <text x="30" y="240" fontFamily={MONO} fontSize="11" fill="#7d8590">{'{ "next": "agent_3" }'}</text>
      <text x="450" y="240" textAnchor="end" fontFamily={MONO} fontSize="11" letterSpacing="1" fill="#ff8a4c">47K / 47K BLOCKED</text>
    </Frame>
  );
}

function Judge({ still }) {
  const cx = 150;
  const cy = 135;
  const shape = (t, r, b, l) => `${cx},${cy - t} ${cx + r},${cy} ${cx},${cy + b} ${cx - l},${cy}`;
  const a = shape(78, 60, 70, 52);
  const b = shape(58, 82, 52, 74);
  const c = shape(84, 70, 80, 62);
  return (
    <Frame name="judge" label="Radar chart of a four-dimension rubric with a JSON verdict" fill="#1a1410">
      {[30, 60, 90].map((r) => (
        <polygon key={r} points={shape(r, r, r, r)} fill="none" stroke="rgba(255,255,255,.12)" />
      ))}
      <line x1={cx} y1={cy - 90} x2={cx} y2={cy + 90} stroke="rgba(255,255,255,.1)" />
      <line x1={cx - 90} y1={cy} x2={cx + 90} y2={cy} stroke="rgba(255,255,255,.1)" />
      <polygon points={a} fill="rgba(255,106,26,.32)" stroke="#ff6a1a" strokeWidth="2">
        {!still && <animate attributeName="points" dur="7s" repeatCount="indefinite" values={`${a};${b};${c};${a}`} />}
      </polygon>
      <g fontFamily={MONO} fontSize="12" fill="#e9d8c8">
        <text x="285" y="78">{"{"}</text>
        <text x="300" y="100"><tspan fill="#ff8a4c">"rubric"</tspan>: 4,</text>
        <text x="300" y="122"><tspan fill="#ff8a4c">"output"</tspan>: "json",</text>
        <text x="300" y="144"><tspan fill="#ff8a4c">"fallback"</tspan>: "heuristic"</text>
        <text x="285" y="166">{"}"}</text>
      </g>
      <polyline points="290,232 320,224 350,226 380,212 410,206 440,192" fill="none" stroke="#ff6a1a" strokeWidth="2" />
      <text x="290" y="200" fontFamily={MONO} fontSize="9" letterSpacing="2" fill="rgba(233,216,200,.55)">SCORE TREND</text>
    </Frame>
  );
}

function Router() {
  const targets = [
    { y: 62, label: "GEMINI", note: "stream", color: "#22d3ee" },
    { y: 135, label: "CLAUDE", note: "judge", color: "#ff6a1a" },
    { y: 208, label: "OPENAI", note: "fallback", color: "#8b5cf6" },
  ];
  return (
    <Frame name="router" label="A dispatcher routing work to Gemini, Claude and OpenAI" fill="#120d22">
      {targets.map((t) => (
        <path
          key={t.label}
          className="flow"
          d={`M156 135 C 230 135, 250 ${t.y}, 312 ${t.y}`}
          fill="none"
          stroke={t.color}
          strokeWidth="2"
          strokeDasharray="5 7"
          opacity={t.note === "fallback" ? 0.55 : 1}
        />
      ))}
      <rect x="46" y="114" width="110" height="42" rx="9" fill="#241a44" stroke="#8b5cf6" />
      <text x="101" y="139" textAnchor="middle" fontFamily={MONO} fontSize="11" letterSpacing="1.5" fill="#e4dcff">DISPATCH</text>
      {targets.map((t) => (
        <g key={t.label}>
          <rect x="312" y={t.y - 19} width="120" height="38" rx="9" fill="#1b1433" stroke={t.color} />
          <text x="372" y={t.y + 4} textAnchor="middle" fontFamily={MONO} fontSize="11" letterSpacing="1.5" fill="#fff">{t.label}</text>
          <text x="300" y={t.y - 26} textAnchor="end" fontFamily={MONO} fontSize="9" letterSpacing="1" fill={t.color} opacity=".85">{t.note}</text>
        </g>
      ))}
    </Frame>
  );
}

function Speed() {
  return (
    <Frame name="speed" label="Page load time cut by 40 percent" fill="#0b1020">
      <text x="60" y="104" fontFamily="Anton, Impact, sans-serif" fontSize="76" fill="#fff">−40%</text>
      <text x="64" y="130" fontFamily={MONO} fontSize="10" letterSpacing="2" fill="#8b93a7">PAGE LOAD TIME</text>
      <rect x="64" y="160" width="352" height="14" rx="7" fill="#5b6478" />
      <rect x="64" y="196" width="352" height="14" rx="7" fill="#232a3d" />
      <rect className="grow" x="64" y="196" width="211" height="14" rx="7" fill="#22d3ee" />
      <text x="416" y="152" textAnchor="end" fontFamily={MONO} fontSize="9" letterSpacing="1.5" fill="#8b93a7">REACT 17</text>
      <text x="416" y="230" textAnchor="end" fontFamily={MONO} fontSize="9" letterSpacing="1.5" fill="#22d3ee">REACT 18</text>
    </Frame>
  );
}

function Gauge({ x, label, value }) {
  const r = 62;
  const arc = (from, to) => {
    const p = (deg) => [x + r * Math.cos((deg * Math.PI) / 180), 170 - r * Math.sin((deg * Math.PI) / 180)];
    const [x1, y1] = p(from);
    const [x2, y2] = p(to);
    return `M${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  return (
    <g>
      <path d={arc(180, 122)} stroke="#22c55e" strokeWidth="12" fill="none" />
      <path d={arc(118, 62)} stroke="#f59e0b" strokeWidth="12" fill="none" />
      <path d={arc(58, 0)} stroke="#f43f5e" strokeWidth="12" fill="none" />
      <line className="needle" x1={x} y1="170" x2={x} y2="118" stroke="#0e0e13" strokeWidth="3" strokeLinecap="round" style={{ transformOrigin: `${x}px 170px` }} />
      <circle cx={x} cy="170" r="6" fill="#0e0e13" />
      <text x={x} y="212" textAnchor="middle" fontFamily="Anton, Impact, sans-serif" fontSize="30" fill="#0e0e13">{value}</text>
      <text x={x} y="232" textAnchor="middle" fontFamily={MONO} fontSize="10" letterSpacing="2" fill="#5b5d69">{label}</text>
    </g>
  );
}

function Vitals() {
  return (
    <Frame name="vitals" label="Gauges showing INP down 38 percent and CLS down 95 percent" fill="#eef6f0">
      <Gauge x={140} label="INP" value="−38%" />
      <Gauge x={340} label="CLS" value="−95%" />
    </Frame>
  );
}

function Resume() {
  const lines = [0, 1, 2, 3];
  return (
    <Frame name="resume" label="A resume with an AI-written summary" fill="#fbf1df">
      <rect x="150" y="26" width="180" height="222" rx="8" fill="#fff" stroke="rgba(14,14,19,.08)" />
      <circle cx="180" cy="58" r="14" fill="#ead9bd" />
      <rect x="204" y="48" width="92" height="8" rx="4" fill="#2b2b33" />
      <rect x="204" y="62" width="60" height="6" rx="3" fill="#cdbb9c" />
      <text x="168" y="98" fontFamily={MONO} fontSize="8" letterSpacing="1.5" fill="#ff6a1a">✦ AI SUMMARY</text>
      {lines.map((i) => (
        <rect key={i} className="write" x="168" y={108 + i * 13} width={i === 3 ? 90 : 144} height="6" rx="3" fill="#ffb78f" style={{ animationDelay: `${i * 0.5}s` }} />
      ))}
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x="168" y={176 + i * 13} width={i % 2 ? 110 : 144} height="5" rx="2.5" fill="#ece5d8" />
      ))}
      <g className="badge">
        <rect x="292" y="188" width="76" height="34" rx="17" fill="#ff6a1a" />
        <text x="330" y="212" textAnchor="middle" fontFamily="Anton, Impact, sans-serif" fontSize="20" fill="#fff">+20%</text>
      </g>
    </Frame>
  );
}

function Bench() {
  return (
    <Frame name="bench" label="React Native using 2.7 times the CPU of Flutter" fill="#0f1411">
      {[80, 120, 160, 200].map((y) => (
        <line key={y} x1="60" y1={y} x2="420" y2={y} stroke="rgba(255,255,255,.06)" />
      ))}
      <rect className="cpu" x="130" y="72" width="70" height="150" rx="4" fill="#ff6a1a" />
      <rect className="cpu slow" x="250" y="166" width="70" height="56" rx="4" fill="#22d3ee" />
      <text x="165" y="244" textAnchor="middle" fontFamily={MONO} fontSize="10" letterSpacing="2" fill="#9aa59c">REACT NATIVE</text>
      <text x="285" y="244" textAnchor="middle" fontFamily={MONO} fontSize="10" letterSpacing="2" fill="#9aa59c">FLUTTER</text>
      <text x="430" y="92" textAnchor="end" fontFamily="Anton, Impact, sans-serif" fontSize="44" fill="#fff">2.7×</text>
      <text x="430" y="112" textAnchor="end" fontFamily={MONO} fontSize="9" letterSpacing="2" fill="#9aa59c">CPU</text>
    </Frame>
  );
}

function Graph() {
  const nodes = [
    [240, 135, 24, "#ff6a1a"],
    [138, 78, 16, "#fbbf24"],
    [124, 190, 18, "#a78bfa"],
    [342, 72, 18, "#22d3ee"],
    [356, 188, 15, "#f43f5e"],
    [240, 42, 12, "#22c55e"],
    [246, 232, 13, "#60a5fa"],
  ];
  const edges = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [1, 5], [3, 5], [2, 6], [4, 6], [1, 2], [3, 4]];
  return (
    <Frame name="graph" label="A social graph of friends with likes floating up" fill="#fff1e6">
      {edges.map(([a, b], i) => (
        <line key={i} x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]} stroke="rgba(14,14,19,.16)" />
      ))}
      {nodes.map(([x, y, r, c], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill={c} />
      ))}
      {[0, 1, 2].map((i) => (
        <text key={i} className="heart" x={252 + i * 10} y="108" fontSize="14" fill="#f43f5e" style={{ animationDelay: `${i * 0.9}s` }}>♥</text>
      ))}
    </Frame>
  );
}

function Chat() {
  return (
    <Frame name="chat" label="Chat bubbles arriving in real time" fill="#14102a">
      <g className="bubble" style={{ animationDelay: "0s" }}>
        <rect x="50" y="40" width="200" height="36" rx="18" fill="#2b2550" />
        <rect x="70" y="55" width="140" height="6" rx="3" fill="#6f66a8" />
      </g>
      <g className="bubble" style={{ animationDelay: ".8s" }}>
        <rect x="230" y="92" width="200" height="36" rx="18" fill="#ff6a1a" />
        <rect x="250" y="107" width="120" height="6" rx="3" fill="#ffd2b8" />
      </g>
      <g className="bubble" style={{ animationDelay: "1.6s" }}>
        <rect x="50" y="144" width="160" height="36" rx="18" fill="#2b2550" />
        <rect x="70" y="159" width="96" height="6" rx="3" fill="#6f66a8" />
      </g>
      <g className="bubble" style={{ animationDelay: "2.4s" }}>
        <rect x="350" y="196" width="80" height="34" rx="17" fill="#ff6a1a" />
        {[0, 1, 2].map((i) => (
          <circle key={i} className="typing" cx={374 + i * 16} cy="213" r="4" fill="#fff" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </g>
    </Frame>
  );
}

function Feed() {
  return (
    <Frame name="feed" label="A feed of posts with likes" fill="#e8f3fb">
      {[24, 102, 180].map((y, i) => (
        <g key={y} className={i === 0 ? "post new" : "post"}>
          <rect x="100" y={y} width="280" height="66" rx="12" fill="#fff" stroke="rgba(14,14,19,.06)" />
          <circle cx="126" cy={y + 24} r="12" fill={["#60a5fa", "#fbbf24", "#a78bfa"][i]} />
          <rect x="148" y={y + 16} width="70" height="7" rx="3.5" fill="#1f2937" />
          <rect x="148" y={y + 30} width="190" height="6" rx="3" fill="#d6e2ec" />
          <rect x="148" y={y + 42} width="140" height="6" rx="3" fill="#d6e2ec" />
          <text className="like" x="352" y={y + 56} fontSize="13" fill="#f43f5e" style={{ animationDelay: `${i * 0.7}s` }}>♥</text>
        </g>
      ))}
    </Frame>
  );
}

function Siamese() {
  const ribs = (cx) =>
    [92, 110, 128, 146].map((y) => (
      <path key={y} d={`M${cx} ${y} q -30 4 -38 20 M${cx} ${y} q 30 4 38 20`} fill="none" stroke="rgba(255,255,255,.28)" />
    ));
  return (
    <Frame name="siamese" label="Twin networks comparing two chest X-rays" fill="#0c1119">
      {[90, 112, 134, 156].map((y, i) => (
        <line key={y} className="flow" x1="205" y1={y + 10} x2="275" y2={y + 10} stroke="#22d3ee" strokeDasharray="4 5" style={{ animationDelay: `${i * 0.2}s` }} />
      ))}
      {[150, 330].map((cx) => (
        <g key={cx}>
          <rect x={cx - 55} y="62" width="110" height="132" rx="12" fill="none" stroke="#ff6a1a" strokeWidth="1.5" />
          <line x1={cx} y1="76" x2={cx} y2="182" stroke="rgba(255,255,255,.35)" />
          {ribs(cx)}
        </g>
      ))}
      <text x="240" y="232" textAnchor="middle" fontFamily={MONO} fontSize="10" letterSpacing="2" fill="#7d8590">SIAMESE RESNET · 4 CLASSES</text>
    </Frame>
  );
}

const VISUALS = {
  council: Council,
  gate: Gate,
  judge: Judge,
  router: Router,
  speed: Speed,
  vitals: Vitals,
  resume: Resume,
  bench: Bench,
  graph: Graph,
  chat: Chat,
  feed: Feed,
  siamese: Siamese,
};

export default function Visual({ name }) {
  const Component = VISUALS[name];
  return Component ? <Component still={prefersReducedMotion()} /> : null;
}
