import React, { useEffect, useState } from "react";
import "./site/site.css";
import { Nav, Hero } from "./site/Hero";
import { About, Stack, Experience, Featured, Projects, Awards, Education, Contact } from "./site/Sections";

function ScrollProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setProgress(max > 0 ? window.scrollY / max : 0);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return <div className="progress" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />;
}

function App() {
  return (
    <>
      <ScrollProgress />
      <Nav />
      <main>
        <Hero />
        <About />
        <Stack />
        <Experience />
        <Featured />
        <Projects />
        <Awards />
        <Education />
        <Contact />
      </main>
    </>
  );
}

export default App;
