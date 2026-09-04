'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Heart } from 'lucide-react';
import { EmptyState, LoadingSpinner } from '@/components/common';
import type { AgentSoul } from '@/types';

interface SoulPanelProps {
  soul: AgentSoul | null;
  /** false when the agent has no registry repo, so there is nothing to read */
  configured?: boolean;
  isLoading: boolean;
  error?: string | null;
}

/** Renders the agent's SOUL.md. HTML in the markdown is escaped, not rendered. */
export default function SoulPanel({ soul, configured = true, isLoading, error }: SoulPanelProps) {
  if (isLoading && !soul) return <LoadingSpinner className="py-8" message="Loading SOUL.md..." />;
  if (error && !soul) return <EmptyState title="Could not load SOUL.md" description={error} />;
  if (!soul && !configured) {
    return (
      <EmptyState
        icon={<Heart size={28} />}
        title="No repo configured"
        description="Set repo on this agent's registry entry; SOUL.md is only read from registry-configured repos."
      />
    );
  }
  if (!soul) {
    return (
      <EmptyState
        icon={<Heart size={28} />}
        title="No SOUL.md"
        description="Add workspace/SOUL.md to the repo named by the agent's registry entry (repo), or point soulPath at it. Only registry-configured repos are read."
      />
    );
  }

  return (
    <div className="markdown max-h-[32rem] overflow-y-auto p-4">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{soul.markdown}</ReactMarkdown>
    </div>
  );
}
