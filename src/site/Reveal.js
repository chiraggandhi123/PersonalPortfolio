import React, { useEffect, useRef, useState } from "react";

// One shared IntersectionObserver for every revealed element on the page.
const callbacks = new Map();
let observer = null;

function getObserver() {
  if (!observer && typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const cb = callbacks.get(entry.target);
          if (cb) cb();
          observer.unobserve(entry.target);
          callbacks.delete(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0 }
    );
  }
  return observer;
}

export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useInView() {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    const io = getObserver();
    if (!el || !io) {
      setInView(true);
      return undefined;
    }
    callbacks.set(el, () => setInView(true));
    io.observe(el);
    return () => {
      io.unobserve(el);
      callbacks.delete(el);
    };
  }, []);

  return [ref, inView];
}

export function Reveal({ as: Tag = "div", className = "", delay = 0, style, children, ...rest }) {
  const [ref, inView] = useInView();
  return (
    <Tag
      ref={ref}
      className={`reveal${inView ? " is-in" : ""}${className ? " " + className : ""}`}
      style={{ ...style, transitionDelay: delay ? `${delay}ms` : undefined }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

// Renders text where *wrapped words* become the orange italic accent,
// with each word animating in on its own beat.
export function Headline({ as: Tag = "h2", text, className = "" }) {
  const [ref, inView] = useInView();
  let i = 0;
  const parts = text.split(/(\*[^*]+\*)/).filter(Boolean);

  return (
    <Tag ref={ref} className={`headline${inView ? " is-in" : ""} ${className}`} aria-label={text.replace(/\*/g, "")}>
      {parts.map((part, p) => {
        const accent = part.startsWith("*");
        const words = (accent ? part.slice(1, -1) : part).split(/\s+/).filter(Boolean);
        const spans = words.map((w) => {
          const k = i++;
          return (
            <React.Fragment key={k}>
              <span className="w" style={{ transitionDelay: `${k * 45}ms` }} aria-hidden="true">
                {w}
              </span>{" "}
            </React.Fragment>
          );
        });
        return accent ? (
          <em className="accent" key={p}>
            {spans}
          </em>
        ) : (
          <React.Fragment key={p}>{spans}</React.Fragment>
        );
      })}
    </Tag>
  );
}

export function CountUp({ value, suffix = "" }) {
  const [ref, inView] = useInView();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!inView) return undefined;
    if (prefersReducedMotion()) {
      setShown(value);
      return undefined;
    }
    let frame;
    const start = performance.now();
    const duration = 1400;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, value]);

  return (
    <span ref={ref}>
      {shown}
      {suffix}
    </span>
  );
}
