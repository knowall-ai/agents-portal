'use client';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && (
        <div className="mb-4" style={{ color: 'var(--text-muted)' }}>
          {icon}
        </div>
      )}
      <h3 className="mb-1 text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
        {title}
      </h3>
      {description && (
        <p className="max-w-md text-sm" style={{ color: 'var(--text-secondary)' }}>
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
