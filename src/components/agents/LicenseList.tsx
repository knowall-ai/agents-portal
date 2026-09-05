'use client';

import { BadgeCheck, CreditCard, UserCheck, UserX } from 'lucide-react';
import { EmptyState, LoadingSpinner } from '@/components/common';
import { formatMoney } from '@/lib/format';
import type { AgentLicensing } from '@/types';

interface LicenseListProps {
  licensing: AgentLicensing | null;
  isLoading: boolean;
  error?: string | null;
}

export default function LicenseList({ licensing, isLoading, error }: LicenseListProps) {
  if (isLoading && !licensing) {
    return <LoadingSpinner className="py-8" message="Loading licences..." />;
  }
  if (error && !licensing)
    return <EmptyState title="Could not load licences" description={error} />;
  if (!licensing || (!licensing.upn && licensing.subscriptions.length === 0)) {
    return (
      <EmptyState
        icon={<BadgeCheck size={28} />}
        title="No licences to show"
        description="Set teamsUpn (the agent's own Entra account) and/or fixedCosts in the registry."
      />
    );
  }

  const { licenses, subscriptions, licenseError } = licensing;

  return (
    <div className="divide-y">
      {licensing.upn && (
        <div className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {licensing.displayName ?? licensing.upn}
            </span>
            <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
              {licensing.upn}
            </span>
            {licensing.accountEnabled !== undefined && (
              <span
                className="flex items-center gap-1 text-xs"
                style={{
                  color: licensing.accountEnabled
                    ? 'var(--status-online)'
                    : 'var(--status-offline)',
                }}
              >
                {licensing.accountEnabled ? <UserCheck size={12} /> : <UserX size={12} />}
                {licensing.accountEnabled ? 'Account enabled' : 'Account disabled'}
              </span>
            )}
            {licensing.usageLocation && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Usage location {licensing.usageLocation}
              </span>
            )}
          </div>
          {licenseError ? (
            <p className="text-xs" style={{ color: 'var(--status-degraded)' }}>
              Microsoft licences unavailable: {licenseError}
            </p>
          ) : licenses.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              No Microsoft licences assigned.
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {licenses.map((license) => (
                <li
                  key={license.skuId}
                  className="rounded-md border p-3"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
                  title={license.skuPartNumber}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <BadgeCheck size={14} style={{ color: 'var(--primary)' }} />
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {license.name}
                    </span>
                  </div>
                  {(license.capabilities.length > 0 || license.otherPlans > 0) && (
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {license.capabilities.join(' · ')}
                      {license.otherPlans > 0 && (
                        <span style={{ color: 'var(--text-muted)' }}>
                          {license.capabilities.length > 0 ? ' · ' : ''}+{license.otherPlans} more
                          plans
                        </span>
                      )}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {subscriptions.length > 0 && (
        <div className="p-4">
          <p className="mb-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            Subscriptions (flat monthly fees from the registry)
          </p>
          <ul className="space-y-1">
            {subscriptions.map((sub) => (
              <li
                key={sub.label}
                className="flex items-center justify-between gap-2 text-sm"
                style={{ color: 'var(--text-primary)' }}
              >
                <span className="flex items-center gap-2">
                  <CreditCard size={14} style={{ color: 'var(--text-muted)' }} /> {sub.label}
                </span>
                <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {formatMoney(sub.amount, sub.currency)}/month
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
