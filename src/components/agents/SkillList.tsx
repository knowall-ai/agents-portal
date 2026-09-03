'use client';

import { Brain, Github, Sparkles } from 'lucide-react';
import { EmptyState, LoadingSpinner } from '@/components/common';
import type { Skill } from '@/types';

interface SkillListProps {
  skills: Skill[] | null;
  isLoading: boolean;
  error?: string | null;
}

export default function SkillList({ skills, isLoading, error }: SkillListProps) {
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
    <ul className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
      {skills.map((skill) => (
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
  );
}
