'use client';

import { signIn } from 'next-auth/react';
import { Activity, Bot, Building2, Share2, Sparkles, CheckCircle } from 'lucide-react';
import { AgentsPortalIcon } from '@/components/common';

const features = [
  {
    icon: <Bot size={24} />,
    title: 'Every Agent in One Place',
    description:
      'OpenClaw agents on VMs, Azure AI Foundry assistants and Bot Framework bots — discovered from your Azure subscriptions automatically.',
  },
  {
    icon: <Activity size={24} />,
    title: 'Status & Recent Activity',
    description:
      'Live compute state, reachability checks, Azure Activity Log events, GitHub commits and AI Foundry runs in a single feed.',
  },
  {
    icon: <Sparkles size={24} />,
    title: 'Skills at a Glance',
    description:
      'See what each agent can do: skills from its repo and the tools wired into its Foundry assistants.',
  },
  {
    icon: <Share2 size={24} />,
    title: 'Multi-tenant by Design',
    description:
      'Sign in with your own tenant to see your agents. Customer subscriptions delegated through Azure Lighthouse appear alongside your own.',
  },
];

const benefits = [
  'Seamless Microsoft Entra ID authentication',
  'No database — reads Azure Resource Graph as you',
  'Tag a resource group and the agent appears',
  'Works with existing Azure RBAC permissions',
  'Open source, built by KnowAll AI',
];

export default function LandingPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      <header className="border-b px-4 py-4" style={{ borderColor: 'var(--border)' }}>
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-2">
            <AgentsPortalIcon size={32} />
            <span className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              <span style={{ color: 'var(--primary)' }}>Agents</span> Portal
            </span>
          </div>
          <button
            onClick={() => signIn('azure-ad', { callbackUrl: '/' })}
            className="btn-primary px-4 py-2 text-sm"
          >
            Sign in with Microsoft
          </button>
        </div>
      </header>

      <section className="px-4 py-16">
        <div className="mx-auto max-w-4xl text-center">
          <h1
            className="mb-4 text-3xl font-bold sm:text-4xl lg:text-5xl"
            style={{ color: 'var(--text-primary)' }}
          >
            Monitor Your AI Agents Across Azure Tenants
          </h1>
          <p
            className="mx-auto max-w-2xl text-base sm:text-lg"
            style={{ color: 'var(--text-secondary)' }}
          >
            Status, skills and recent activity for the agents you build and run for your customers —
            Sallie, Zaplie, Winnie and the next one.
          </p>
        </div>
      </section>

      <section className="px-4 py-8">
        <div className="mx-auto max-w-4xl">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {features.map((feature) => (
              <div key={feature.title} className="card p-6">
                <div
                  className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg"
                  style={{ backgroundColor: 'rgba(34, 197, 94, 0.15)', color: 'var(--primary)' }}
                >
                  {feature.icon}
                </div>
                <h3 className="mb-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {feature.title}
                </h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-16" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="mx-auto max-w-4xl">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
            <div>
              <h2
                className="mb-4 text-2xl font-bold sm:text-3xl"
                style={{ color: 'var(--text-primary)' }}
              >
                Open Source by <span style={{ color: 'var(--primary)' }}>KnowAll.ai</span>
              </h2>
              <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
                Agents Portal is the operations view for the agents KnowAll builds. It shares its
                stack and look with ZapDesk and Thyme, and is free for anyone running agents on
                Azure.
              </p>
              <ul className="space-y-3">
                {benefits.map((benefit) => (
                  <li key={benefit} className="flex items-center gap-3">
                    <CheckCircle size={18} style={{ color: 'var(--primary)' }} />
                    <span style={{ color: 'var(--text-secondary)' }}>{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card p-6">
              <div className="mb-4 flex items-center gap-2">
                <Building2 size={18} style={{ color: 'var(--primary)' }} />
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                  Who sees what
                </span>
              </div>
              <ul className="space-y-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li>
                  <strong style={{ color: 'var(--text-primary)' }}>Your tenant:</strong> every agent
                  in the subscriptions you can read.
                </li>
                <li>
                  <strong style={{ color: 'var(--text-primary)' }}>Customer tenants:</strong> agents
                  in subscriptions delegated to you via Azure Lighthouse show up with a Lighthouse
                  badge.
                </li>
                <li>
                  <strong style={{ color: 'var(--text-primary)' }}>Customers themselves:</strong>{' '}
                  sign in to their own tenant and see only their agents.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t px-4 py-8" style={{ borderColor: 'var(--border)' }}>
        <div
          className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-4 text-sm sm:flex-row"
          style={{ color: 'var(--text-muted)' }}
        >
          <span>© {new Date().getFullYear()} KnowAll AI · MIT licensed</span>
          <a
            href="https://github.com/knowall-ai/agents-portal"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--primary)]"
          >
            github.com/knowall-ai/agents-portal
          </a>
        </div>
      </footer>
    </div>
  );
}
