'use client';

import { useEffect, useRef, useState } from 'react';
import { signIn } from 'next-auth/react';
import { Building2, Check, ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useApi } from '@/hooks';
import type { Tenant } from '@/types';

/**
 * Shows the Entra tenant the user is signed in to and lets them switch to any
 * other tenant they belong to. Switching re-runs sign-in against that tenant's
 * authority, so the ARM token (and therefore the visible agents) is scoped to it.
 */
export default function TenantSwitcher() {
  const { data, isLoading } = useApi<{ tenants: Tenant[]; current: string }>('/api/tenants');
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const tenants = data?.tenants ?? [];
  const current = tenants.find((t) => t.current);
  const label = current?.displayName ?? current?.defaultDomain ?? data?.current ?? 'Tenant';

  if (isLoading && tenants.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md px-3 py-1.5">
        <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
      </div>
    );
  }

  const switchTenant = async (tenant: Tenant) => {
    setSwitching(true);
    try {
      const response = await fetch('/api/tenants/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant.tenantId }),
      });
      if (!response.ok) throw new Error('Could not select tenant');
      await signIn('azure-ad', { callbackUrl: '/' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Tenant switch failed');
      setSwitching(false);
    }
  };

  if (tenants.length <= 1) {
    return (
      <div
        className="flex items-center gap-2 rounded-md px-3 py-1.5"
        style={{ color: 'var(--text-primary)' }}
        aria-label="Current tenant"
        title={data?.current}
      >
        <Building2 size={16} style={{ color: 'var(--primary)' }} />
        <span className="hidden max-w-[180px] truncate text-sm font-medium sm:inline">{label}</span>
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-md px-3 py-1.5 transition-colors hover:bg-[var(--surface-hover)]"
        style={{ color: 'var(--text-primary)' }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Switch tenant"
        disabled={switching}
      >
        {switching ? (
          <Loader2 size={16} className="animate-spin" style={{ color: 'var(--primary)' }} />
        ) : (
          <Building2 size={16} style={{ color: 'var(--primary)' }} />
        )}
        <span className="hidden max-w-[180px] truncate text-sm font-medium sm:inline">{label}</span>
        <ChevronDown
          size={14}
          style={{ color: 'var(--text-muted)' }}
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Tenants"
          className="absolute top-full right-0 z-20 mt-1 min-w-[260px] rounded-lg py-1 shadow-lg"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div
            className="border-b px-3 py-2 text-xs font-semibold tracking-wider uppercase"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            Entra tenants
          </div>
          {tenants.map((tenant) => (
            <button
              key={tenant.tenantId}
              role="option"
              aria-selected={tenant.current}
              onClick={() => {
                setOpen(false);
                if (!tenant.current) switchTenant(tenant);
              }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: 'var(--text-primary)' }}
            >
              <Building2 size={14} style={{ color: 'var(--text-muted)' }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{tenant.displayName ?? tenant.tenantId}</span>
                {tenant.defaultDomain && (
                  <span className="block truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                    {tenant.defaultDomain}
                  </span>
                )}
              </span>
              {tenant.current && <Check size={14} style={{ color: 'var(--primary)' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
