"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders the final value on the server and at rest. The first time it scrolls into view,
 * it counts up from zero once. Reduced motion keeps the final value.
 */
export function CountUp({ to, prefix = "", className = "" }: { to: number; prefix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(to);

  useEffect(() => {
    const el = ref.current;
    if (!el || !to || !("IntersectionObserver" in window)) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const frame = (t: number) => {
        const p = Math.min(1, (t - t0) / 1100);
        setValue(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }, { threshold: 0.15 });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      setValue(to);
    };
  }, [to]);

  return (
    <span ref={ref} className={className}>
      <span className="sr-only">{prefix}{to}</span>
      <span aria-hidden="true">{prefix}{value}</span>
    </span>
  );
}
