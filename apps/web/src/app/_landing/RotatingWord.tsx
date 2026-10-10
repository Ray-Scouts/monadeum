"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "./hooks";
import s from "./landing.module.css";

const WORDS = [
  ["place", "var(--mint)"],
  ["capital", "var(--sky)"],
  ["keep", "var(--sun)"],
  ["survival", "var(--berry)"],
] as const;

/** Cycles the last word of the hero headline. Screen readers get the first word only, once. */
export function RotatingWord() {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref);
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<"" | "out" | "in">("");

  useEffect(() => {
    if (!inView || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timers: number[] = [];
    const id = window.setInterval(() => {
      setPhase("out");
      timers.push(window.setTimeout(() => {
        setI((v) => (v + 1) % WORDS.length);
        setPhase("in");
        timers.push(window.setTimeout(() => setPhase(""), 500));
      }, 330));
    }, 2600);
    return () => {
      window.clearInterval(id);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [inView]);

  const [word, color] = WORDS[i] ?? WORDS[0];
  const cls = phase === "out" ? s.rotOut : phase === "in" ? s.rotIn : "";
  return (
    <span ref={ref} className={s.rotWrap} style={{ color }}>
      <span className="sr-only">{WORDS[0][0]}</span>
      <span aria-hidden="true" className={`${s.rot} ${cls}`}>{word}</span>
    </span>
  );
}
