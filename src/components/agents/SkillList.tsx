'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Github, Search, Sparkles, X } from 'lucide-react';
import { EmptyState, LoadingSpinner } from '@/components/common';
import { ALL_SOURCES, filterSkills, sourceCounts } from '@/lib/skills-filter';
import type { Skill } from '@/types';

interface SkillListProps {
  skills: Skill[] | null;
  isLoading: boolean;
  error?: string | null;
  /** Search text, from the URL */
  query?: string;
  /** Selected `sourceLabel`, or `all` */
  source?: string;
  /** The agent's own repo, so its chip sorts first */
  primaryLabel?: string;
  onQueryChange?: (q: string) => void;
  onSourceChange?: (source: string) => void;
  /** Clears search and source together in one URL update */
  onClear?: () => void;
}

export default function SkillList({
  skills,
  isLoading,
  error,
  query = '',
  source = ALL_SOURCES,
  primaryLabel,
  onQueryChange,
  onSourceChange,
  onClear,
}: SkillListProps) {
  // The input is driven locally so typing never waits on the URL round-trip;
  // the prop wins whenever the URL changes from elsewhere (a shared link, the
  // clear-filters action).
  const [text, setText] = useState(query);
  const [lastQuery, setLastQuery] = useState(query);
  if (query !== lastQuery) {
    // adjusting state during render, as React prescribes for a prop the state mirrors
    setLastQuery(query);
    setText(query);
  }
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses the box while the Skills tab is mounted, unless the user is
  // already typing somewhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const all = useMemo(() => skills ?? [], [skills]);
  const sources = useMemo(() => sourceCounts(all, primaryLabel), [all, primaryLabel]);
  const visible = useMemo(() => filterSkills(all, { q: text, source }), [all, text, source]);

  const setQuery = (next: string) => {
    setText(next);
    onQueryChange?.(next);
  };
  const clearAll = () => {
    setText('');
    if (onClear) onClear();
    else {
      onQueryChange?.('');
      onSourceChange?.(ALL_SOURCES);
    }
  };
  const filtering = text.trim() !== '' || (source !== ALL_SOURCES && source !== '');

  if (isLoading && !skills) return <LoadingSpinner className="py-8" message="Loading skills..." />;
  if (error && !skills) return <EmptyState title="Could not load skills" description={error} />;
  if (!skills || skills.length === 0) {
    return (
      <EmptyState
        icon={<Sparkles size={28} />}
        title="No skills found"
        description="Add a GitHub repo with a skills folder (SKILL.md per skill) to the registry, or deploy an AI Foundry assistant with tools."
      />
    );
  }

  return (
    <div>
      <div
        className="flex flex-col gap-3 border-b p-4"
        style={{ borderColor: 'var(--border)' }}
        role="search"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[14rem] flex-1">
            <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
              <Search size={16} style={{ color: 'var(--text-muted)' }} />
            </div>
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && text !== '') {
                  e.preventDefault();
                  setQuery('');
                }
              }}
              placeholder="Search skills (press / to focus)"
              aria-label="Search skills by name or description"
              className="input w-full py-2 text-sm"
              style={{ paddingLeft: '2.25rem', paddingRight: text ? '2.25rem' : undefined }}
            />
            {text && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
                className="absolute inset-y-0 right-2 flex items-center rounded p-1"
                style={{ color: 'var(--text-muted)' }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <p
            className="text-xs whitespace-nowrap"
            style={{ color: 'var(--text-muted)' }}
            aria-live="polite"
          >
            {filtering ? `${visible.length} of ${all.length}` : `${all.length} skills`}
          </p>
        </div>

        {sources.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <SourceChip
              label="All"
              count={all.length}
              selected={source === ALL_SOURCES || source === ''}
              onClick={() => onSourceChange?.(ALL_SOURCES)}
            />
            {sources.map((entry) => (
              <SourceChip
                key={entry.label}
                label={entry.label}
                count={entry.count}
                selected={source === entry.label}
                icon={entry.source === 'github' ? <Github size={12} /> : <Brain size={12} />}
                onClick={() => onSourceChange?.(entry.label)}
              />
            ))}
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Search size={28} />}
          title={text.trim() ? `No skills match “${text.trim()}”` : 'No skills match these filters'}
          description={
            <button
              type="button"
              onClick={clearAll}
              className="underline underline-offset-2"
              style={{ color: 'var(--primary)' }}
            >
              Clear filters
            </button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
          {visible.map((skill) => (
            <li
              key={skill.id}
              className="rounded-md border p-3"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                  {skill.url ? (
                    <a
                      href={skill.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {skill.name}
                    </a>
                  ) : (
                    skill.name
                  )}
                </span>
                <span
                  className="flex items-center gap-1 text-[11px]"
                  style={{ color: 'var(--text-muted)' }}
                  title={skill.sourceLabel}
                >
                  {skill.source === 'github' ? <Github size={12} /> : <Brain size={12} />}
                  <span className="max-w-[160px] truncate">{skill.sourceLabel}</span>
                </span>
              </div>
              {skill.description && (
                <p className="line-clamp-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {skill.description}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface SourceChipProps {
  label: string;
  count: number;
  selected: boolean;
  icon?: React.ReactNode;
  onClick: () => void;
}

/** A single-select filter pill, borrowing the tab's selected/count idiom. */
function SourceChip({ label, count, selected, icon, onClick }: SourceChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={label}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors"
      style={{
        borderColor: selected ? 'var(--primary)' : 'var(--border)',
        backgroundColor: selected ? 'var(--surface-hover)' : 'var(--background)',
        color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}
    >
      {icon}
      <span className="max-w-[180px] truncate">{label}</span>
      <span className="tab-count">{count}</span>
    </button>
  );
}
