'use client';

import { AppWindow, Check, ChevronRight, ShieldCheck, UserRound, X } from 'lucide-react';
import { EmptyState, LoadingSpinner } from '@/components/common';
import type { AgentPermissions, PermissionItem, PermissionKind } from '@/types';

interface PermissionsPanelProps {
  permissions: AgentPermissions | null;
  isLoading: boolean;
  error?: string | null;
}

const KIND_LABELS: Record<PermissionKind, string> = {
  delegated: 'Delegated',
  application: 'Application',
  'directory-role': 'Directory role',
  group: 'Group',
  'azure-role': 'Azure role',
};

const KIND_HELP: Record<PermissionKind, string> = {
  delegated:
    'Used when the app acts on behalf of a signed-in user. The app can do no more than that user could.',
  application:
    'Used when the app runs on its own, with no user signed in. Applies across the whole tenant, so treat these with care.',
  'directory-role': 'An Entra ID admin role held by the account itself.',
  group:
    'Group membership. Anything granted to the group (Teams, SharePoint, licences, apps) applies to the account.',
  'azure-role': 'Azure RBAC role. Grants the listed actions on everything under the scope shown.',
};

function PermissionRow({ item }: { item: PermissionItem }) {
  const description = item.description ?? 'No description published for this permission.';
  return (
    <details className="group border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm hover:bg-[var(--surface-hover)]">
        <ChevronRight
          size={14}
          className="shrink-0 transition-transform group-open:rotate-90"
          style={{ color: 'var(--text-muted)' }}
        />
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs"
          style={{ color: 'var(--text-primary)' }}
        >
          {item.name}
        </span>
        {item.scope && (
          <span
            className="hidden max-w-[220px] truncate text-xs md:inline"
            style={{ color: 'var(--text-muted)' }}
          >
            {item.scope}
          </span>
        )}
        <span className="kind-badge text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          {KIND_LABELS[item.kind]}
        </span>
        {item.granted !== undefined && (
          <span
            className="flex items-center gap-1 text-[11px]"
            style={{ color: item.granted ? 'var(--status-online)' : 'var(--status-degraded)' }}
            title={
              item.granted ? 'Consented in this tenant' : 'Requested by the app but not consented'
            }
          >
            {item.granted ? <Check size={12} /> : <X size={12} />}
            {item.granted ? 'Granted' : 'Not granted'}
          </span>
        )}
      </summary>
      <div className="space-y-1 px-10 pb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <p>{description}</p>
        <p style={{ color: 'var(--text-muted)' }}>{KIND_HELP[item.kind]}</p>
        {(item.resource || item.scope) && (
          <p style={{ color: 'var(--text-muted)' }}>
            {item.resource && <>API: {item.resource}</>}
            {item.resource && item.scope && ' · '}
            {item.scope && <>Scope: {item.scope}</>}
          </p>
        )}
      </div>
    </details>
  );
}

function Group({ title, items, empty }: { title: string; items: PermissionItem[]; empty: string }) {
  return (
    <div>
      <p
        className="px-4 pt-3 pb-1 text-[11px] font-medium tracking-wide uppercase"
        style={{ color: 'var(--text-muted)' }}
      >
        {title} {items.length > 0 && `(${items.length})`}
      </p>
      {items.length === 0 ? (
        <p className="px-4 pb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          {empty}
        </p>
      ) : (
        <div className="rounded-md border" style={{ borderColor: 'var(--border)' }}>
          {items.map((item) => (
            <PermissionRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <details open className="group/section">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 hover:bg-[var(--surface-hover)]">
        <ChevronRight
          size={16}
          className="shrink-0 transition-transform group-open/section:rotate-90"
          style={{ color: 'var(--text-muted)' }}
        />
        {icon}
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {title}
        </span>
        {subtitle && (
          <span className="truncate font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
            {subtitle}
          </span>
        )}
      </summary>
      <div className="space-y-2 px-4 pb-4">{children}</div>
    </details>
  );
}

export default function PermissionsPanel({ permissions, isLoading, error }: PermissionsPanelProps) {
  if (isLoading && !permissions) {
    return <LoadingSpinner className="py-8" message="Loading permissions..." />;
  }
  if (error && !permissions) {
    return <EmptyState title="Could not load permissions" description={error} />;
  }
  if (!permissions || (!permissions.account && permissions.apps.length === 0)) {
    return (
      <EmptyState
        icon={<ShieldCheck size={28} />}
        title="Nothing to show"
        description="Set teamsUpn and/or appRegistrations in the registry. Bot Service app IDs are picked up automatically."
      />
    );
  }

  return (
    <div className="divide-y">
      {permissions.error && (
        <p className="px-4 py-3 text-xs" style={{ color: 'var(--status-degraded)' }}>
          Directory data unavailable: {permissions.error}
        </p>
      )}
      {permissions.account && (
        <Section
          icon={<UserRound size={16} style={{ color: 'var(--primary)' }} />}
          title="Account"
          subtitle={permissions.account.upn}
        >
          <Group
            title="Directory roles"
            items={permissions.account.directoryRoles}
            empty="No Entra admin roles."
          />
          <Group title="Groups" items={permissions.account.groups} empty="No group memberships." />
          <Group
            title="Azure roles"
            items={permissions.account.azureRoles}
            empty="No Azure RBAC assignments in the subscriptions you can see."
          />
        </Section>
      )}
      {permissions.apps.map((app) => (
        <Section
          key={app.appId}
          icon={<AppWindow size={16} style={{ color: 'var(--primary)' }} />}
          title={app.displayName}
          subtitle={app.appId}
        >
          {app.error ? (
            <p className="text-xs" style={{ color: 'var(--status-degraded)' }}>
              {app.error}
            </p>
          ) : (
            <>
              <Group
                title="API permissions"
                items={app.permissions}
                empty="No API permissions requested."
              />
              <Group
                title="Azure roles"
                items={app.azureRoles}
                empty="No Azure RBAC assignments for this app's service principal."
              />
            </>
          )}
        </Section>
      ))}
    </div>
  );
}
