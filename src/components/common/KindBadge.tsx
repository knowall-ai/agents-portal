'use client';

import { Bot, Brain, Feather, HelpCircle, Server } from 'lucide-react';
import type { AgentKind } from '@/types';

export const kindLabels: Record<AgentKind, string> = {
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  foundry: 'AI Foundry',
  botframework: 'Bot Framework',
  unknown: 'Unknown',
};

const icons: Record<AgentKind, React.ReactNode> = {
  openclaw: <Server size={12} />,
  hermes: <Feather size={12} />,
  foundry: <Brain size={12} />,
  botframework: <Bot size={12} />,
  unknown: <HelpCircle size={12} />,
};

export default function KindBadge({ kind }: { kind: AgentKind }) {
  return (
    <span className="kind-badge" style={{ color: `var(--kind-${kind})` }}>
      {icons[kind]}
      {kindLabels[kind]}
    </span>
  );
}
