import React, { useEffect, useRef, useState } from "react";
import { profile, marquee } from "../data";
import { prefersReducedMotion } from "./Reveal";

const NAV = [
  { label: "Work", href: "#work" },
  { label: "Experience", href: "#experience" },
  { label: "About", href: "#about" },
  { label: "Notes", href: profile.notes, external: true },
  { label: "Resume", href: profile.resume, external: true },
];

export function Nav() {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > window.innerHeight - 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    if (open) window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <header className={`nav${solid ? " nav--solid" : ""}${open ? " nav--open" : ""}`}>
        <a className="nav-brand" href="#top" onClick={close}>
          ◆ {profile.short}
        </a>
        <nav className="nav-links" aria-label="Primary">
          {NAV.map((item) => (
            <a
              key={item.label}
              href={item.href}
              {...(item.external ? { target: "_blank", rel: "noreferrer" } : {})}
            >
              {item.label}
              {item.external ? " ↗" : ""}
            </a>
          ))}
        </nav>
        <a className="nav-cta" href="#contact">
          {"// Hire me"} <span className="nav-cta-dot">↗</span>
        </a>
        <button
          className="nav-burger"
          type="button"
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen(!open)}
        >
          {open ? "Close" : "Menu"}
        </button>
      </header>
      <div id="mobile-menu" className={`menu${open ? " menu--open" : ""}`} aria-hidden={!open}>
        {[...NAV, { label: "Contact", href: "#contact" }].map((item, i) => (
          <a
            key={item.label}
            href={item.href}
            onClick={close}
            tabIndex={open ? 0 : -1}
            style={{ transitionDelay: open ? `${80 + i * 50}ms` : "0ms" }}
            {...(item.external ? { target: "_blank", rel: "noreferrer" } : {})}
          >
            {item.label}
          </a>
        ))}
      </div>
    </>
  );
}

const SCRIPT = [
  { t: "cmd", s: "whoami" },
  { t: "out", s: "chirag gandhi — lead engineer @ naukri campus" },
  { t: "cmd", s: "./gd-sim --agents 5 --voice livekit" },
  { t: "log", k: "dispatcher", s: '{"next":"agent_3","why":"counterpoint"}' },
  { t: "log", k: "guardrail", s: "pass ✓", tone: "ok" },
  { t: "log", k: "agent_3", s: "speaking", bars: true },
  { t: "log", k: "candidate", s: "unmuted → agents yield", tone: "accent" },
];

function useTyping(script) {
  const reduced = prefersReducedMotion();
  const [state, setState] = useState(reduced ? { line: script.length, chars: 0 } : { line: 0, chars: 0 });

  useEffect(() => {
    if (reduced) return undefined;
    const { line, chars } = state;
    let delay;
    let next;
    if (line >= script.length) {
      delay = 5200;
      next = { line: 0, chars: 0 };
    } else {
      const item = script[line];
      if (item.t === "cmd" && chars < item.s.length) {
        delay = chars === 0 ? 650 : 34 + Math.random() * 46;
        next = { line, chars: chars + 1 };
      } else {
        delay = item.t === "cmd" ? 260 : 480;
        next = { line: line + 1, chars: 0 };
      }
    }
    const id = setTimeout(() => setState(next), delay);
    return () => clearTimeout(id);
  }, [state, reduced, script]);

  return state;
}

function Terminal() {
  const { line, chars } = useTyping(SCRIPT);
  const typingCmd = line < SCRIPT.length && SCRIPT[line].t === "cmd";

  return (
    <div className="term" aria-hidden="true">
      <div className="term-bar">
        <span className="term-dot" />
        <span className="term-dot" />
        <span className="term-dot" />
        <span className="term-title">~/chirag — zsh</span>
      </div>
      <div className="term-body">
        {SCRIPT.map((item, i) => {
          if (i > line || (i === line && !typingCmd)) return null;
          if (item.t === "cmd") {
            const text = i === line ? item.s.slice(0, chars) : item.s;
            return (
              <div className="term-line" key={i}>
                <span className="term-prompt">$</span> {text}
                {i === line && <span className="term-caret" />}
              </div>
            );
          }
          if (item.t === "out") {
            return (
              <div className="term-line term-out" key={i}>
                {item.s}
              </div>
            );
          }
          return (
            <div className={`term-line term-log${item.tone ? " is-" + item.tone : ""}`} key={i}>
              <span className="term-arrow">▸</span>
              <span className="term-key">{item.k}</span>
              <span className="term-val">{item.s}</span>
              {item.bars && (
                <span className="term-bars">
                  {[0, 1, 2, 3, 4, 5].map((b) => (
                    <i key={b} style={{ animationDelay: `${b * 0.11}s` }} />
                  ))}
                </span>
              )}
            </div>
          );
        })}
        {line >= SCRIPT.length && (
          <div className="term-line">
            <span className="term-prompt">$</span> <span className="term-caret" />
          </div>
        )}
      </div>
    </div>
  );
}

export function Hero() {
  const heroRef = useRef(null);
  const ghostRef = useRef(null);
  const tiltRef = useRef(null);

  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    const hero = heroRef.current;
    let frame = 0;

    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = Math.min(window.scrollY, window.innerHeight);
        if (ghostRef.current) ghostRef.current.style.setProperty("--py", `${Math.round(y * 0.28)}px`);
      });
    };
    const onMove = (e) => {
      if (!tiltRef.current) return;
      const r = hero.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      tiltRef.current.style.transform = `rotateX(${(-y * 8).toFixed(2)}deg) rotateY(${(x * 10).toFixed(2)}deg)`;
    };
    const onLeave = () => {
      if (tiltRef.current) tiltRef.current.style.transform = "";
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    hero.addEventListener("mousemove", onMove);
    hero.addEventListener("mouseleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      hero.removeEventListener("mousemove", onMove);
      hero.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  const letters = profile.heroTitle.split("");
  const ticker = [...marquee, ...marquee];

  return (
    <section className="hero" id="top" ref={heroRef}>
      <h1
        className="hero-title"
        aria-label={`${profile.name} — ${profile.heroTitle.toLowerCase()} ${profile.role.toLowerCase()}`}
      >
        {letters.map((ch, i) =>
          ch === " " ? (
            <span className="hero-space" key={i} />
          ) : (
            <span className="hero-char" key={i} style={{ animationDelay: `${120 + i * 55}ms` }} aria-hidden="true">
              {ch}
            </span>
          )
        )}
      </h1>

      <div className="hero-stage">
        <div className="hero-ghost" ref={ghostRef} aria-hidden="true">
          {profile.ghost}
        </div>

        <div className="hero-center">
          <div className="hero-tilt" ref={tiltRef}>
            {profile.photo ? (
              <img className="hero-photo" src={profile.photo} alt={profile.name} />
            ) : (
              <Terminal />
            )}
          </div>
        </div>

        <p className="hero-caption hero-caption--left">
          {profile.heroLeft.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </p>
        <p className="hero-caption hero-caption--right">
          {profile.heroRight.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </p>
      </div>

      <div className="marquee" aria-label={`Tech: ${marquee.join(", ")}`}>
        <div className="marquee-track" aria-hidden="true">
          {ticker.map((t, i) => (
            <span className="marquee-item" key={i}>
              <i>◆</i>
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
