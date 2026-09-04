'use client';

import type { KeyboardEvent, ReactNode } from 'react';

export interface TabDef {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Shown after the label, e.g. number of items */
  count?: number;
}

interface TabsProps {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
  /** Used for aria-controls / ids */
  idPrefix?: string;
}

/**
 * Horizontal tab list. Arrow keys move between tabs; the active tab is the
 * only one in the tab order (WAI-ARIA tabs pattern).
 */
export default function Tabs({ tabs, active, onChange, idPrefix = 'tab' }: TabsProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.id === active);
    if (index === -1) return;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    onChange(tabs[next].id);
    document.getElementById(`${idPrefix}-${tabs[next].id}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className="tablist mb-6 flex flex-wrap gap-1 border-b"
      style={{ borderColor: 'var(--border)' }}
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            id={`${idPrefix}-${tab.id}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            className="tab"
            onClick={() => onChange(tab.id)}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined && <span className="tab-count">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
