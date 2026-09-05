'use client';

import { useEffect, useState } from 'react';
import type { AgentStatus } from '@/types';

interface AgentAvatarProps {
  name: string;
  image?: string;
  status?: AgentStatus;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeClasses = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-lg',
  xl: 'w-20 h-20 text-2xl',
};

const dotClasses = {
  sm: 'w-2.5 h-2.5 border',
  md: 'w-3 h-3 border-2',
  lg: 'w-3.5 h-3.5 border-2',
  xl: 'w-4 h-4 border-2',
};

/** One first try plus two retries: a slow avatar fetch should not mean initials forever. */
const MAX_ATTEMPTS = 3;
const RETRY_MS = 8_000;

/** Cache-bust each retry, so the browser really asks again. */
function attemptUrl(image: string, attempt: number): string {
  if (attempt === 0) return image;
  return `${image}${image.includes('?') ? '&' : '?'}retry=${attempt}`;
}

/** Agent profile picture with initials fallback and an optional status dot. */
export default function AgentAvatar({
  name,
  image,
  status,
  size = 'md',
  className = '',
}: AgentAvatarProps) {
  // Kept in one object keyed on `image`, so a new avatar URL starts over.
  // Adjusting state during render is React's own answer to a prop change
  // (react.dev/reference/react/useState); an effect would show the old image first.
  const [tries, setTries] = useState({ image, attempt: 0, failed: false });
  if (tries.image !== image) setTries({ image, attempt: 0, failed: false });

  // Initials are shown while we wait; then the image is asked for again.
  useEffect(() => {
    if (!tries.failed || tries.attempt + 1 >= MAX_ATTEMPTS) return;
    const timer = setTimeout(
      () => setTries((t) => ({ ...t, attempt: t.attempt + 1, failed: false })),
      RETRY_MS
    );
    return () => clearTimeout(timer);
  }, [tries.failed, tries.attempt]);

  const initials = name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <span className={`relative inline-block shrink-0 ${className}`}>
      {image && !tries.failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={tries.attempt}
          src={attemptUrl(image, tries.attempt)}
          alt={name}
          className={`${sizeClasses[size]} rounded-full object-cover`}
          style={{ border: '1px solid var(--border)' }}
          onError={() => setTries((t) => ({ ...t, failed: true }))}
        />
      ) : (
        <span
          className={`${sizeClasses[size]} flex items-center justify-center rounded-full font-semibold`}
          style={{
            background: 'linear-gradient(135deg, #4ade80 0%, #22c55e 50%, #16a34a 100%)',
            color: '#ffffff',
          }}
          aria-label={name}
        >
          {initials}
        </span>
      )}
      {status && (
        <span
          className={`status-dot absolute right-0 bottom-0 ${dotClasses[size]}`}
          style={{
            backgroundColor: `var(--status-${status})`,
            borderColor: 'var(--surface)',
          }}
          aria-hidden="true"
        />
      )}
    </span>
  );
}
