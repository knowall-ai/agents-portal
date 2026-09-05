'use client';

import { useEffect, useState } from 'react';

/** Time left until `until` (epoch ms) as h:mm:ss, ticking every second; "0:00" once passed. */
export default function Countdown({ until, className }: { until: number; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.floor((until - now) / 1000));
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const text =
    h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }} aria-live="off">
      {text}
    </span>
  );
}
