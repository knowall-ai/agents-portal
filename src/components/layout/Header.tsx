'use client';

import { useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Search, ChevronDown, LogOut, Menu } from 'lucide-react';
import { Avatar } from '@/components/common';
import { useProfilePhoto } from '@/hooks';
import TenantSwitcher from './TenantSwitcher';

interface HeaderProps {
  onMenuClick?: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { data: session, status } = useSession();
  const { photoUrl } = useProfilePhoto(status === 'authenticated');
  const router = useRouter();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [query, setQuery] = useState('');

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(query.trim() ? `/?q=${encodeURIComponent(query.trim())}` : '/');
  };

  return (
    <header
      className="flex h-14 items-center justify-between border-b px-2 sm:px-4"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <button
        onClick={() => onMenuClick?.()}
        className="mr-2 rounded-md p-2 transition-colors hover:bg-[var(--surface-hover)] md:hidden"
        style={{ color: 'var(--text-secondary)' }}
        aria-label="Toggle menu"
      >
        <Menu size={20} />
      </button>

      <form onSubmit={submitSearch} className="flex max-w-xl flex-1 items-center">
        <div className="relative w-full">
          <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
            <Search size={18} style={{ color: 'var(--text-muted)' }} />
          </div>
          <input
            type="search"
            placeholder="Search agents, customers, resource groups..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input w-full py-2 pr-4 text-sm"
            style={{ paddingLeft: '2.75rem' }}
            aria-label="Search agents"
          />
        </div>
      </form>

      <div className="ml-2 flex items-center gap-1 sm:ml-4 sm:gap-2">
        <TenantSwitcher />

        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 rounded-md p-1 transition-colors hover:bg-[var(--surface-hover)]"
            aria-label="User menu"
          >
            <Avatar name={session?.user?.name || 'User'} image={photoUrl ?? undefined} size="sm" />
            <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />
          </button>

          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowUserMenu(false)} />
              <div
                className="absolute top-full right-0 z-20 mt-1 w-64 rounded-lg py-2 shadow-lg"
                style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <div className="border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {session?.user?.name || 'User'}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {session?.user?.email || ''}
                  </p>
                </div>
                <div className="py-1">
                  <button
                    onClick={() => signOut({ callbackUrl: '/' })}
                    className="flex w-full items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-[var(--surface-hover)]"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <LogOut size={16} />
                    Sign out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
