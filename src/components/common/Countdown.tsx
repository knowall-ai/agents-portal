'use client';

import { useEffect, useState } from 'react';

/**
 * Time left until `until` (epoch ms), ticking every second: h:mm:ss with an
 * hour or more to go, m:ss below that, "0:00" once passed. `onDone` fires once
 * when the deadline passes while mounted.
 */
export default function Countdown({
  until,
  className,
  onDone,
}: {
  until: number;
  className?: string;
  onDone?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const done = now >= until;
  useEffect(() => {
    if (done) onDone?.();
    // Fire once per deadline, not on every re-render of the parent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, until]);
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
