'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  FileText,
  GraduationCap,
  Video,
} from 'lucide-react';
import { EmptyState, LoadingSpinner } from '@/components/common';
import { scenarioAppliesTo, summariseRun } from '@/lib/training';
import type {
  AgentTraining,
  CurriculumScenario,
  OutstandingReason,
  TrainingQuestion,
  TrainingRun,
} from '@/types';

interface TrainingPanelProps {
  agentId: string;
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
  'on-demand': 'on demand',
  daily: 'daily',
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

/**
 * An artefact link, shown only when the harness published one. Artefacts are
 * either absolute https URLs or paths inside the training repo, which are only
 * resolvable once we know which repo the records came from.
 */
function ArtefactLink({
  href,
  repo,
  label,
  icon,
}: {
  href?: string;
  repo?: string;
  label: string;
  icon: React.ReactNode;
}) {
  if (!href) return null;
  const absolute = /^https?:\/\//.test(href);
  if (!absolute && !repo) return null;
  const url = absolute ? href : `https://github.com/${repo}/blob/main/${href.replace(/^\/+/, '')}`;
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

/**
 * What each scenario does, in the curriculum's own words, with the agent's
 * latest result for it. This is the "what happens in these tests" the tab
 * would otherwise leave to the reader's imagination.
 */
function CurriculumList({
  scenarios,
  runs,
}: {
  scenarios: CurriculumScenario[];
  runs: TrainingRun[];
}) {
  const [open, setOpen] = useState(true);
  if (scenarios.length === 0) return null;
  const latest = (id: string): TrainingRun | undefined =>
    runs.find((run) => run.scenario?.toLowerCase() === id.toLowerCase());
  return (
    <div className="border-b p-4" style={{ borderColor: 'var(--border)' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mb-2 flex items-center gap-2 text-xs font-medium uppercase"
        style={{ color: 'var(--text-muted)' }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <BookOpen size={14} /> What each test does
      </button>
      {open && (
        <ul className="grid gap-2 md:grid-cols-2">
          {scenarios.map((scenario) => {
            const run = latest(scenario.id);
            return (
              <li
                key={scenario.id}
                className="rounded-md border px-3 py-2"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {scenario.title || scenario.id}
                    <span
                      className="ml-2 text-xs font-normal"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {CADENCE_LABELS[scenario.cadence] ?? scenario.cadence}
                    </span>
                  </span>
                  {run ? (
                    <span
                      className="flex shrink-0 items-center gap-1.5 text-xs"
                      style={{ color: 'var(--text-muted)' }}
                      title={`Latest run ${when(run.startedAt)}`}
                    >
                      {when(run.startedAt)} <ResultBadge result={run.result} />
                    </span>
                  ) : (
                    <span className="status-badge status-unknown shrink-0">Never run</span>
                  )}
                </div>
                {scenario.note && (
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {scenario.note}
                  </p>
                )}
                {scenario.requires && (
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    Requires: {scenario.requires}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The harness's headline numbers, labelled; unknown counters are left out rather than guessed at. */
const MEASUREMENTS: [key: string, label: string, unit?: string][] = [
  ['questions', 'Questions'],
  ['answered', 'Answered'],
  ['latency_p50_s', 'Reply time (median)', 's'],
  ['latency_p90_s', 'Reply time (p90)', 's'],
  ['latency_max_s', 'Reply time (worst)', 's'],
  ['glitches', 'Glitches'],
  ['chop_index', 'Chop (gaps per 10 s)'],
  ['cut_offs', 'Cut-offs'],
  ['inaudible', 'Inaudible replies'],
  ['missed', 'Missed questions'],
  ['wrong_answers', 'Wrong answers'],
  ['failed_actions', 'Failed actions'],
  ['actions_verified', 'Actions verified'],
  ['departure_rows', 'Asked to leave'],
  ['departures_verified', 'Left the call'],
  ['longest_dead_air_s', 'Longest silence', 's'],
];

function Measurements({ totals, mode }: { totals?: Record<string, number>; mode?: string }) {
  const rows = MEASUREMENTS.filter(([key]) => totals?.[key] !== undefined);
  if (rows.length === 0 && !mode) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
        Measurements{mode ? ` · ${mode}` : ''}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs md:grid-cols-4">
        {rows.map(([key, label, unit]) => (
          <div key={key} className="flex justify-between gap-2">
            <dt style={{ color: 'var(--text-muted)' }}>{label}</dt>
            <dd className="font-mono" style={{ color: 'var(--text-primary)' }}>
              {Number.isInteger(totals![key]) ? totals![key] : totals![key].toFixed(2)}
              {unit ?? ''}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Every exchange in the run: what was asked, whether the check passed, and what it saw. */
function QuestionTable({ questions }: { questions: TrainingQuestion[] }) {
  if (questions.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
        What was asked
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left uppercase" style={{ color: 'var(--text-muted)' }}>
            <th className="py-1 pr-3 font-medium">#</th>
            <th className="py-1 pr-3 font-medium">Question</th>
            <th className="py-1 pr-3 font-medium">Result</th>
            <th className="py-1 pr-3 font-medium">Lag</th>
            <th className="py-1 font-medium">What the check saw</th>
          </tr>
        </thead>
        <tbody>
          {questions.map((question, index) => (
            <tr
              key={question.id ?? index}
              className="border-t align-top"
              style={{ borderColor: 'var(--border)' }}
            >
              <td className="py-1 pr-3 font-mono" style={{ color: 'var(--text-muted)' }}>
                {index + 1}
              </td>
              <td className="py-1 pr-3" style={{ color: 'var(--text-primary)' }}>
                {question.prompt ?? question.id ?? '—'}
              </td>
              <td className="py-1 pr-3">
                {question.status === 'skipped' ? (
                  <span className="status-badge status-unknown">Skipped</span>
                ) : (
                  <ResultBadge result={question.status} />
                )}
                {question.verify?.kind && (
                  <span className="mt-0.5 block" style={{ color: 'var(--text-muted)' }}>
                    verified: {question.verify.kind}
                  </span>
                )}
              </td>
              <td className="py-1 pr-3 font-mono" style={{ color: 'var(--text-secondary)' }}>
                {question.lag !== undefined ? `${question.lag.toFixed(1)}s` : '—'}
              </td>
              <td className="py-1" style={{ color: 'var(--text-secondary)' }}>
                {question.detail ?? ''}
                {question.notes?.map((note, i) => (
                  <span key={i} className="block" style={{ color: 'var(--text-muted)' }}>
                    {note}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

export default function TrainingPanel({ agentId, training, isLoading, error }: TrainingPanelProps) {
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
                  {scenario.note && (
                    <p
                      className="mt-1 line-clamp-2 max-w-xs text-xs"
                      style={{ color: 'var(--text-muted)' }}
                      title={scenario.note}
                    >
                      {scenario.note}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {training.curriculum.length > 0 && (
        <CurriculumList
          scenarios={training.curriculum.filter((s) => scenarioAppliesTo(s, agentId))}
          runs={training.runs}
        />
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
                    repo={training.repo}
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
  repo?: string;
  open: boolean;
  hasNotes: boolean;
  onToggle: () => void;
  scenarioName: string;
  summary: { checksRun: number; passed: number; failed: number; breaches: number };
}

function ExpandableRow({
  run,
  repo,
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
              repo={repo}
              label="Report"
              icon={<FileText size={14} />}
            />
            <ArtefactLink
              href={run.artefacts?.recording}
              repo={repo}
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
              <Measurements totals={run.totals} mode={run.mode} />
              <DetailList title="Breaches" items={run.breaches} />
              <DetailList title="Limitations" items={run.limitations} />
              <DetailList title="Change requests" items={run.changeRequests} />
              <QuestionTable questions={run.questions} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
