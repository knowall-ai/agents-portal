'use client';

import { useId } from 'react';

interface AgentDashboardIconProps {
  size?: number;
  className?: string;
}

/**
 * Agent Dashboard logo icon.
 *
 * A heartbeat pulse line — every agent's vital signs at a glance — on the same
 * green metallic rounded square used across the KnowAll product family.
 */
export default function AgentDashboardIcon({ size = 32, className = '' }: AgentDashboardIconProps) {
  const id = useId();
  const metalGradientId = `agentdash-metal-${id}`;
  const shineGradientId = `agentdash-shine-${id}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      aria-label="Agent Dashboard"
    >
      <defs>
        <linearGradient id={metalGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4ade80" />
          <stop offset="50%" stopColor="#22c55e" />
          <stop offset="100%" stopColor="#16a34a" />
        </linearGradient>
        <linearGradient id={shineGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.3" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="64" height="64" rx="8" ry="8" fill={`url(#${metalGradientId})`} />
      <rect x="0" y="0" width="64" height="64" rx="8" ry="8" fill={`url(#${shineGradientId})`} />
      <polyline
        points="9,34 19,34 25,18 33,48 40,26 45,34 55,34"
        fill="none"
        stroke="#ffffff"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
