'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Activity, BookOpen, X, Github } from 'lucide-react';
import { AgentsPortalIcon } from '@/components/common';

const mainNavItems = [
  { id: 'home', name: 'Agents', icon: <Home size={20} />, href: '/' },
  { id: 'activity', name: 'Activity', icon: <Activity size={20} />, href: '/activity' },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  counts?: { online: number; degraded: number; offline: number; planned: number };
}

export default function Sidebar({ isOpen = false, onClose, counts }: SidebarProps) {
  const pathname = usePathname();

  const views = [
    { id: 'online', name: 'Online', href: '/?status=online', count: counts?.online },
    { id: 'degraded', name: 'Degraded', href: '/?status=degraded', count: counts?.degraded },
    { id: 'offline', name: 'Offline', href: '/?status=offline', count: counts?.offline },
    { id: 'planned', name: 'Planned', href: '/?status=planned', count: counts?.planned },
  ];

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 flex h-screen w-64 transform flex-col transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0`}
      style={{ backgroundColor: 'var(--sidebar-bg)' }}
    >
      <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2" onClick={() => onClose?.()}>
            <AgentsPortalIcon size={32} />
            <span className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              <span style={{ color: 'var(--primary)' }}>Agent</span> Dashboard
            </span>
          </Link>
          <button
            onClick={() => onClose?.()}
            className="rounded-md p-1 transition-colors hover:bg-[var(--surface-hover)] md:hidden"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      <nav className="py-2">
        {mainNavItems.map((item) => {
          const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              className={`nav-item mx-2 ${isActive ? 'active' : ''}`}
              onClick={() => onClose?.()}
            >
              {item.icon}
              <span className="text-sm">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="p-3">
          <div
            className="mb-2 text-xs font-semibold uppercase"
            style={{ color: 'var(--text-muted)' }}
          >
            Status
          </div>
          <div className="space-y-1">
            {views.map((view) => (
              <Link
                key={view.id}
                href={view.href}
                className="flex items-center justify-between rounded px-2 py-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                onClick={() => onClose?.()}
              >
                <span className="flex items-center gap-2">
                  <span className={`status-dot status-dot-${view.id}`} />
                  {view.name}
                </span>
                {view.count !== undefined && (
                  <span
                    className="rounded px-1.5 py-0.5 text-xs font-medium"
                    style={{
                      backgroundColor: view.count > 0 ? 'rgba(34,197,94,0.15)' : 'var(--surface)',
                      color: view.count > 0 ? 'var(--primary)' : 'var(--text-muted)',
                    }}
                  >
                    {view.count}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>

        <div className="border-t p-3" style={{ borderColor: 'var(--border)' }}>
          <a
            href="https://github.com/knowall-ai/agents-portal/blob/main/docs/ONBOARDING.adoc"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-item"
          >
            <BookOpen size={16} />
            <span className="text-sm">Add an agent</span>
          </a>
          <a
            href="https://github.com/knowall-ai/agents-portal"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-item"
          >
            <Github size={16} />
            <span className="text-sm">Source</span>
          </a>
        </div>
      </div>

      <div className="border-t p-3 text-center" style={{ borderColor: 'var(--border)' }}>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          <div>v{process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0'}</div>
          <div className="mt-1">
            Built by{' '}
            <a
              href="https://knowall.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--primary)]"
              aria-label="KnowAll AI (opens in new tab)"
            >
              KnowAll AI
            </a>
          </div>
        </div>
      </div>
    </aside>
  );
}
