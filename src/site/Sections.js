import React, { useState } from "react";
import {
  profile,
  about,
  stack,
  experience,
  featured,
  projects,
  awards,
  education,
  concepts,
  certifications,
  contact,
} from "../data";
import { Reveal, Headline, CountUp } from "./Reveal";
import Visual from "./Visuals";

const external = { target: "_blank", rel: "noreferrer" };

function SectionHead({ num, title, label, outline, right, stamp }) {
  return (
    <div className="sec-head">
      <Reveal as="h2" className={`sec-title${outline ? " sec-title--outline" : ""}`}>
        {title}
      </Reveal>
      <div className="sec-meta">
        <div className="sec-label">
          <span className="sec-num">{num}</span>
          <span className="sec-rule" />
          <span>{label}</span>
        </div>
        {right}
      </div>
      {stamp && <span className="stamp stamp--head">{stamp}</span>}
    </div>
  );
}

function Tags({ items, small }) {
  return (
    <ul className={`tags${small ? " tags--small" : ""}`}>
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

export function About() {
  return (
    <section className="section" id="about">
      <div className="wrap">
        <SectionHead num="01" title="§ ABOUT — ME" label="About" stamp={about.stamps[0]} />
        <div className="about-grid">
          <div className="about-left">
            <Headline as="h3" className="about-headline" text={about.headline} />
            <span className="stamp stamp--tilt">{about.stamps[1]}</span>
          </div>
          <div className="about-right">
            {about.paragraphs.map((p, i) => (
              <Reveal as="p" className="lede" key={i} delay={i * 120}>
                {p}
              </Reveal>
            ))}
            <Reveal className="stats" delay={240}>
              {about.stats.map((s) => (
                <div className="stat" key={s.label}>
                  <div className="stat-value">
                    <CountUp value={s.value} suffix={s.suffix} />
                  </div>
                  <div className="stat-label">{s.label}</div>
                </div>
              ))}
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Stack() {
  return (
    <section className="section" id="stack">
      <div className="wrap">
        <SectionHead num="02" title="STACK · TOOLS" label="Stack" stamp="// production-tested" />
        <div className="stack-grid">
          {stack.map((g, i) => (
            <Reveal className="stack-group" key={g.group} delay={(i % 4) * 70}>
              <div className="mini-label">{g.group}</div>
              <ul className="chips">
                {g.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Experience() {
  return (
    <section className="section" id="experience">
      <div className="wrap">
        <SectionHead num="03" title="EXPERIENCE" label="Experience" outline />
        <div className="xp">
          {experience.map((job) => (
            <Reveal className="xp-row" key={job.company}>
              <div className="xp-when">{job.period}</div>
              <div className="xp-rail">
                <span className="xp-dot" />
              </div>
              <div className="xp-body">
                <div className="xp-co">
                  <span className="xp-mark" style={{ background: job.markColor }}>
                    {job.mark}
                  </span>
                  <div>
                    <h3 className="xp-name">
                      {job.link ? (
                        <a href={job.link} {...external}>
                          {job.company}
                        </a>
                      ) : (
                        job.company
                      )}
                    </h3>
                    <div className="xp-meta">
                      {job.meta}
                      <span className="xp-meta-when"> · {job.period}</span>
                    </div>
                  </div>
                </div>

                {job.roles.length > 1 ? (
                  <ol className="xp-roles">
                    {job.roles.map((r) => (
                      <li className="xp-role" key={r.title}>
                        <h4 className="xp-title">{r.title}</h4>
                        <div className="xp-period">{r.period}</div>
                        <ul className="xp-points xp-points--hollow">
                          {r.points.map((pt) => (
                            <li key={pt}>{pt}</li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ol>
                ) : (
                  job.roles.map((r) => (
                    <div className="xp-single" key={r.title}>
                      <h4 className="xp-title">{r.title}</h4>
                      <ul className="xp-points">
                        {r.points.map((pt) => (
                          <li key={pt}>{pt}</li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
                <Tags items={job.tags} small />
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Featured() {
  return (
    <section className="section" id="work">
      <div className="wrap">
        <SectionHead
          num="04"
          title="FEATURED · WORK"
          label="Featured work"
          outline
          right={
            <a className="sec-link" href="#projects">
              All projects →
            </a>
          }
        />
        <div className="feat">
          {featured.map((f, i) => (
            <Reveal className="feat-row" key={f.title}>
              <div className="feat-num">{String(i + 1).padStart(2, "0")}</div>
              <div className="feat-text">
                <div className="feat-period">{f.period}</div>
                <h3 className="feat-title">{f.title}</h3>
                <p className="feat-tagline">{f.tagline}</p>
                <p className="feat-desc">{f.desc}</p>
                <Tags items={f.tags} small />
              </div>
              <div className="feat-visual">
                <Visual name={f.visual} />
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "work", label: "At work" },
  { key: "side", label: "Side projects" },
];

export function Projects() {
  const [filter, setFilter] = useState("all");
  const shown = projects.filter((p) => filter === "all" || p.kind === filter);

  return (
    <section className="section" id="projects">
      <div className="wrap">
        <SectionHead
          num="05"
          title="MORE · MORE · MORE"
          label="More projects"
          right={
            <div className="filters" role="group" aria-label="Filter projects">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={filter === f.key ? "is-active" : ""}
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  <sup>{f.key === "all" ? projects.length : projects.filter((p) => p.kind === f.key).length}</sup>
                </button>
              ))}
            </div>
          }
        />
        <div className="cards">
          {shown.map((p, i) => (
            <Reveal
              as={p.link ? "a" : "div"}
              className={`card${p.link ? " card--link" : ""}`}
              key={p.title}
              delay={(i % 3) * 80}
              {...(p.link ? { href: p.link, ...external } : {})}
            >
              <div className="card-visual">
                <Visual name={p.visual} />
              </div>
              <div className="card-body">
                <div className="card-date">
                  <span>{p.date}</span>
                  {p.link && <span className="card-arrow">GitHub ↗</span>}
                </div>
                <h3 className="card-title">{p.title}</h3>
                <p className="card-tagline">{p.tagline}</p>
                <Tags items={p.tags} small />
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Awards() {
  return (
    <section className="section" id="awards">
      <div className="wrap">
        <SectionHead num="06" title="WINS · AWARDS" label="Recognition" outline />
        <div className="awards">
          {awards.map((a, i) => (
            <Reveal className={`award${i === 0 ? " award--wide" : ""}`} key={a.title} delay={(i % 3) * 80}>
              <div className="award-top">
                <span className="award-date">{a.date}</span>
                <span className="award-badge">{a.badge}</span>
              </div>
              <h3 className="award-title">{a.title}</h3>
              <p className="award-detail">{a.detail}</p>
              {a.link && (
                <a className="award-link" href={a.link} {...external}>
                  Certificate →
                </a>
              )}
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Education() {
  return (
    <section className="section" id="education">
      <div className="wrap">
        <SectionHead num="07" title="EDU · CERTS" label="Education & certs" />
        <div className="edu-grid">
          <div>
            <div className="mini-label mini-label--accent">Education</div>
            {education.map((e) => (
              <Reveal className="edu-item" key={e.title}>
                <div className="edu-when">{e.period}</div>
                <h3 className="edu-title">{e.title}</h3>
                <div className="edu-place">{e.place}</div>
                <div className="edu-note">{e.note}</div>
              </Reveal>
            ))}
            <Reveal className="edu-concepts">
              <div className="mini-label">Core concepts</div>
              <ul className="chips">
                {concepts.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </Reveal>
          </div>
          <div>
            <div className="mini-label mini-label--accent">Certifications</div>
            {certifications.map((c, i) => {
              const inner = (
                <>
                  <div>
                    <h3 className="edu-title">{c.title}</h3>
                    <div className="edu-place">{c.issuer}</div>
                  </div>
                  {c.link && <span className="edu-arrow">↗</span>}
                </>
              );
              return c.link ? (
                <Reveal as="a" className="cert cert--link" key={c.title} href={c.link} delay={i * 60} {...external}>
                  {inner}
                </Reveal>
              ) : (
                <Reveal className="cert" key={c.title} delay={i * 60}>
                  {inner}
                </Reveal>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export function Contact() {
  const year = new Date().getFullYear();
  return (
    <section className="section contact" id="contact">
      <div className="wrap contact-grid">
        <div>
          <div className="sec-label">
            <span className="sec-num">08</span>
            <span className="sec-rule" />
            <span>Contact</span>
          </div>
          <Headline as="h2" className="contact-headline" text={contact.headline} />
          <a className="contact-mail" href={`mailto:${profile.email}`}>
            {profile.email} <span>→</span>
          </a>
        </div>
        <Reveal className="elsewhere" delay={150}>
          <div className="mini-label mini-label--accent">Elsewhere</div>
          {contact.links.map((l) => (
            <a
              className="else-row"
              key={l.label}
              href={l.href}
              {...(l.href.startsWith("mailto:") ? {} : external)}
            >
              <span className="else-label">{l.label}</span>
              <span className="else-value">{l.value}</span>
              <span className="else-arrow">↗</span>
            </a>
          ))}
        </Reveal>
      </div>
      <footer className="wrap">
        <div className="footer">
          <span>
            © {year} · {profile.name}
          </span>
          <span className="footer-right">Built with React · chai · ◆</span>
        </div>
      </footer>
    </section>
  );
}
