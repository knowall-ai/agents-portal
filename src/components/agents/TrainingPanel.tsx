'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  FileText,
  GraduationCap,
  Video,
} from 'lucide-react';
import { EmptyState, LoadingSpinner } from '@/components/common';
import { summariseRun } from '@/lib/training';
import type { AgentTraining, OutstandingReason, TrainingRun } from '@/types';

interface TrainingPanelProps {
  training: AgentTraining | null;
  isLoading: boolean;
  error?: string | null;
}

const REASON_LABELS: Record<OutstandingReason, string> = {
  'never-run': 'Never run',
  'last-failed': 'Last run failed',
  overdue: 'Last pass is out of date',
};

const CADENCE_LABELS: Record<string, string> = {
  once: 'once',
  weekly: 'weekly',
  monthly: 'monthly',
  'on-change': 'on change',
};

/** A date as `12 Aug 2026, 14:03`, or an em dash when it is missing or unreadable. */
function when(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : format(date, 'd MMM yyyy, HH:mm');
}

/** Pass/fail as the same pill the status badges use. */
function ResultBadge({ result }: { result?: 'pass' | 'fail' }) {
  if (!result) return <span className="status-badge status-unknown">Unknown</span>;
  return (
    <span className={`status-badge ${result === 'pass' ? 'status-online' : 'status-offline'}`}>
      {result === 'pass' ? 'Pass' : 'Fail'}
    </span>
  );
}

/** An artefact link, shown only when the harness published one. */
function ArtefactLink({
  href,
  label,
  icon,
}: {
  href?: string;
  label: string;
  icon: React.ReactNode;
}) {
  if (!href) return null;
  const url = /^https?:\/\//.test(href)
    ? href
    : `https://github.com/knowall-ai/agent-training/blob/main/${href.replace(/^\/+/, '')}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      className="inline-flex items-center gap-1 text-xs hover:underline"
      style={{ color: 'var(--primary)' }}
    >
      {icon}
    </a>
  );
}

/** Breaches, limitations and change requests as one labelled list each. */
function DetailList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
        {title}
      </p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs" style={{ color: 'var(--text-secondary)' }}>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export default function TrainingPanel({ training, isLoading, error }: TrainingPanelProps) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const scenario of training?.curriculum ?? [])
      if (scenario.title) map.set(scenario.id.toLowerCase(), scenario.title);
    return map;
  }, [training?.curriculum]);

  if (isLoading && !training)
    return <LoadingSpinner className="py-8" message="Loading training..." />;
  if (error && !training) return <EmptyState title="Could not load training" description={error} />;
  if (!training) return null;

  if (!training.configured)
    return (
      <EmptyState
        icon={<GraduationCap size={28} />}
        title="No training records"
        description="Training records live in the agent-training repo; this agent has no trusted registry entry."
      />
    );

  if (training.error)
    return <EmptyState title="Could not load training" description={training.error} />;

  const scenarioName = (run: TrainingRun): string =>
    (run.scenario && titles.get(run.scenario.toLowerCase())) || run.scenario || '—';

  const toggle = (path: string) =>
    setExpanded((current) =>
      current.includes(path) ? current.filter((p) => p !== path) : [...current, path]
    );

  return (
    <div>
      {training.curriculum.length > 0 && (
        <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
          <p
            className="mb-2 flex items-center gap-2 text-xs font-medium uppercase"
            style={{ color: 'var(--text-muted)' }}
          >
            <ClipboardList size={14} /> Outstanding
          </p>
          {training.outstanding.length === 0 ? (
            <p
              className="flex items-center gap-2 text-sm"
              style={{ color: 'var(--status-online)' }}
            >
              <CircleCheck size={14} /> Nothing outstanding — the curriculum is satisfied.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {training.outstanding.map(({ scenario, reason, lastPassAt }) => (
                <li
                  key={scenario.id}
                  className="rounded-md border px-3 py-2"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
                >
                  <span
                    className="flex items-center gap-1.5 text-sm font-medium"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    <AlertTriangle size={13} style={{ color: 'var(--status-degraded)' }} />
                    {scenario.title || scenario.id}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {REASON_LABELS[reason]}
                    {' · '}
                    {CADENCE_LABELS[scenario.cadence] ?? scenario.cadence}
                    {reason === 'overdue' && lastPassAt ? ` · last pass ${when(lastPassAt)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {training.runs.length === 0 ? (
        <EmptyState
          icon={<GraduationCap size={28} />}
          title="No training runs recorded yet"
          description={
            training.curriculum.length > 0
              ? 'The curriculum above is what this agent is due. Runs appear here once the training harness publishes them.'
              : 'Runs appear here once the training harness publishes them to the agent-training repo.'
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-header">
              <tr className="text-left text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
                <th className="px-4 py-2 font-medium" />
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Scenario</th>
                <th className="px-4 py-2 font-medium">Job</th>
                <th className="px-4 py-2 font-medium">Result</th>
                <th className="px-4 py-2 font-medium">Checks</th>
                <th className="px-4 py-2 font-medium">Breaches</th>
                <th className="px-4 py-2 font-medium">Operator</th>
                <th className="px-4 py-2 font-medium">Links</th>
              </tr>
            </thead>
            <tbody>
              {training.runs.map((run) => {
                const summary = summariseRun(run);
                const notes =
                  run.breaches.length + run.limitations.length + run.changeRequests.length;
                const open = expanded.includes(run.path);
                return (
                  <ExpandableRow
                    key={run.path}
                    run={run}
                    open={open}
                    hasNotes={notes > 0}
                    onToggle={() => toggle(run.path)}
                    scenarioName={scenarioName(run)}
                    summary={summary}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface ExpandableRowProps {
  run: TrainingRun;
  open: boolean;
  hasNotes: boolean;
  onToggle: () => void;
  scenarioName: string;
  summary: { checksRun: number; passed: number; failed: number; breaches: number };
}

function ExpandableRow({
  run,
  open,
  hasNotes,
  onToggle,
  scenarioName,
  summary,
}: ExpandableRowProps) {
  const rowId = `training-detail-${run.path.replace(/[^A-Za-z0-9]+/g, '-')}`;
  return (
    <>
      <tr className="table-row">
        <td className="px-2 py-2">
          {hasNotes && (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-controls={rowId}
              aria-label={
                open ? `Hide details of ${scenarioName}` : `Show details of ${scenarioName}`
              }
              className="rounded p-1"
              style={{ color: 'var(--text-muted)' }}
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          )}
        </td>
        <td className="px-4 py-2 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
          {run.url ? (
            <a href={run.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {when(run.startedAt)}
            </a>
          ) : (
            when(run.startedAt)
          )}
        </td>
        <td className="px-4 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>
          {scenarioName}
        </td>
        <td className="px-4 py-2" style={{ color: 'var(--text-secondary)' }}>
          {run.job ?? '—'}
        </td>
        <td className="px-4 py-2">
          <ResultBadge result={run.result} />
        </td>
        <td className="px-4 py-2 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
          {summary.checksRun === 0 ? '—' : `${summary.passed}/${summary.checksRun}`}
          {summary.failed > 0 && (
            <span style={{ color: 'var(--status-offline)' }}> ({summary.failed} failed)</span>
          )}
        </td>
        <td
          className="px-4 py-2 font-mono text-xs"
          style={{
            color: summary.breaches > 0 ? 'var(--status-degraded)' : 'var(--text-muted)',
          }}
        >
          {summary.breaches}
        </td>
        <td className="px-4 py-2" style={{ color: 'var(--text-secondary)' }}>
          {run.operator ?? '—'}
        </td>
        <td className="px-4 py-2">
          <span className="flex items-center gap-2">
            <ArtefactLink
              href={run.artefacts?.reportMd}
              label="Report"
              icon={<FileText size={14} />}
            />
            <ArtefactLink
              href={run.artefacts?.recording}
              label="Recording"
              icon={<Video size={14} />}
            />
          </span>
        </td>
      </tr>
      {open && (
        <tr id={rowId}>
          <td colSpan={9} className="px-4 pt-1 pb-3">
            <div
              className="space-y-3 rounded-md border p-3"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
            >
              <DetailList title="Breaches" items={run.breaches} />
              <DetailList title="Limitations" items={run.limitations} />
              <DetailList title="Change requests" items={run.changeRequests} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
