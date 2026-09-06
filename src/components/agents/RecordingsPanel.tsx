'use client';

import { useRef, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, ChevronLeft, Download, FileText, Users, Video } from 'lucide-react';
import { EmptyState, LoadingSpinner } from '@/components/common';
import { useApi } from '@/hooks/useApi';
import { formatOffset } from '@/lib/recordings';
import type { AgentRecordings, Recording, RecordingDetail, RecordingStatus } from '@/types';

interface RecordingsPanelProps {
  agentId: string;
  recordings: AgentRecordings | null;
  isLoading: boolean;
  error?: string | null;
  /** The open recording (`?rec=` in the URL) and how to change it */
  selected: string | null;
  onSelect: (id: string | null) => void;
  demo?: boolean;
}

const STATUS_LABELS: Record<RecordingStatus, { label: string; className: string }> = {
  recording: { label: 'Recording', className: 'status-online' },
  processing: { label: 'Processing', className: 'status-planned' },
  ready: { label: 'Ready', className: 'status-online' },
  failed: { label: 'Failed', className: 'status-offline' },
};

function when(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : format(date, 'd MMM yyyy, HH:mm');
}

function duration(seconds?: number): string {
  if (seconds === undefined) return '—';
  const minutes = Math.round(seconds / 60);
  return minutes < 1 ? `${seconds}s` : `${minutes} min`;
}

function StatusPill({ status }: { status: RecordingStatus }) {
  const { label, className } = STATUS_LABELS[status];
  return <span className={`status-badge ${className}`}>{label}</span>;
}

function title(recording: Recording): string {
  return recording.meeting.subject ?? recording.room ?? recording.id;
}

/** The list: one row per recording, newest first. */
function RecordingList({
  items,
  onSelect,
}: {
  items: Recording[];
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
      {items.map((recording) => (
        <li key={recording.id}>
          <button
            type="button"
            onClick={() => onSelect(recording.id)}
            className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-[var(--surface-hover)]"
          >
            <Video size={18} style={{ color: 'var(--primary)' }} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {title(recording)}
              </p>
              <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                {when(recording.startedAt)} · {duration(recording.durationSeconds)}
                {recording.organizer ? ` · ${recording.organizer}` : ''}
              </p>
            </div>
            {recording.participantCount !== undefined && (
              <span
                className="flex items-center gap-1 text-xs"
                style={{ color: 'var(--text-muted)' }}
                title="Participants"
              >
                <Users size={12} /> {recording.participantCount}
              </span>
            )}
            <StatusPill status={recording.status} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** One recording: the player, then the transcript with click-to-seek. */
function RecordingView({
  agentId,
  id,
  onBack,
  demo,
}: {
  agentId: string;
  id: string;
  onBack: () => void;
  demo?: boolean;
}) {
  const detail = useApi<{ recording: RecordingDetail }>(
    `/api/agents/${agentId}/recordings/${id}${demo ? '?demo=1' : ''}`
  );
  const video = useRef<HTMLVideoElement>(null);
  const [position, setPosition] = useState(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const recording = detail.data?.recording;
  const playable = recording?.status === 'ready' && !demo;

  const seek = (seconds: number) => {
    const element = video.current;
    if (!element) return;
    element.currentTime = seconds;
    void element.play().catch(() => undefined);
  };

  if (detail.isLoading && !recording)
    return <LoadingSpinner className="py-8" message="Loading recording..." />;
  if (!recording)
    return (
      <EmptyState
        title="Could not load recording"
        description={detail.error ?? 'Not found'}
        action={<BackButton onClick={onBack} />}
      />
    );

  const current = recording.turns.reduce((index, turn, i) => (turn.t <= position ? i : index), -1);

  return (
    <div>
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <BackButton onClick={onBack} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {title(recording)}
            </p>
            <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
              {when(recording.startedAt)} · {duration(recording.durationSeconds)}
              {recording.participants.length > 0 ? ` · ${recording.participants.join(', ')}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={recording.status} />
          {recording.transcript.vtt && !demo && (
            <a
              href={`/api/agents/${agentId}/recordings/${id}/transcript`}
              className="inline-flex items-center gap-1 text-xs hover:underline"
              style={{ color: 'var(--primary)' }}
              title="Download the Teams transcript (WebVTT)"
            >
              <Download size={12} /> Teams transcript
            </a>
          )}
          {recording.meeting.joinUrl && (
            <a
              href={recording.meeting.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs hover:underline"
              style={{ color: 'var(--primary)' }}
            >
              Meeting
            </a>
          )}
        </div>
      </div>

      {recording.status === 'failed' && (
        <p
          className="flex items-center gap-2 px-4 py-3 text-sm"
          style={{ color: 'var(--status-offline)' }}
        >
          <AlertTriangle size={14} /> {recording.error ?? 'Teams did not produce this recording'}
        </p>
      )}

      {playable ? (
        <div className="bg-black">
          <video
            ref={video}
            controls
            preload="metadata"
            className="mx-auto max-h-[60vh] w-full"
            src={`/api/agents/${agentId}/recordings/${id}/video`}
            onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
            onError={() =>
              setPlaybackError('The video could not be played. Teams may still be processing it.')
            }
          />
        </div>
      ) : (
        recording.status !== 'failed' && (
          <p className="px-4 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
            {demo
              ? 'Sample recording: there is no video to play.'
              : recording.status === 'recording'
                ? 'Still recording. The video appears once the call ends and Teams has processed it.'
                : 'Teams is still processing this recording. The video appears when it is ready.'}
          </p>
        )
      )}
      {playbackError && (
        <p
          className="flex items-center gap-2 px-4 py-2 text-xs"
          style={{ color: 'var(--status-offline)' }}
        >
          <AlertTriangle size={12} /> {playbackError}
        </p>
      )}

      <div className="border-t" style={{ borderColor: 'var(--border)' }}>
        <p
          className="flex items-center gap-2 px-4 pt-3 pb-1 text-xs font-medium"
          style={{ color: 'var(--text-secondary)' }}
        >
          <FileText size={12} /> Transcript
        </p>
        {recording.turns.length === 0 ? (
          <p className="px-4 pb-4 text-sm" style={{ color: 'var(--text-muted)' }}>
            {recording.transcript.turns
              ? 'The transcript is empty.'
              : 'No transcript for this recording yet.'}
          </p>
        ) : (
          <ol className="max-h-[50vh] overflow-y-auto px-2 pb-3">
            {recording.turns.map((turn, index) => (
              <li key={`${turn.t}-${index}`}>
                <button
                  type="button"
                  onClick={() => seek(turn.t)}
                  disabled={!playable}
                  aria-current={index === current ? 'true' : undefined}
                  className="flex w-full gap-3 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-hover)] disabled:cursor-default"
                  style={{
                    background: index === current ? 'var(--surface-hover)' : undefined,
                    color: 'var(--text-primary)',
                  }}
                >
                  <span
                    className="w-12 shrink-0 font-mono text-xs"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {formatOffset(turn.t)}
                  </span>
                  <span
                    className="w-28 shrink-0 truncate text-xs font-medium"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {turn.speaker ?? 'Unknown'}
                  </span>
                  <span>{turn.text}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-[var(--surface-hover)]"
      style={{ color: 'var(--text-secondary)' }}
    >
      <ChevronLeft size={14} /> All recordings
    </button>
  );
}

export default function RecordingsPanel({
  agentId,
  recordings,
  isLoading,
  error,
  selected,
  onSelect,
  demo,
}: RecordingsPanelProps) {
  if (selected)
    return (
      // keyed by id so a different recording starts with fresh player state
      <RecordingView
        key={selected}
        agentId={agentId}
        id={selected}
        onBack={() => onSelect(null)}
        demo={demo}
      />
    );
  if (isLoading && !recordings)
    return <LoadingSpinner className="py-8" message="Loading recordings..." />;
  if (error && !recordings)
    return <EmptyState title="Could not load recordings" description={error} />;
  if (!recordings) return null;
  if (!recordings.available)
    return (
      <EmptyState
        icon={<Video size={28} />}
        title="Recordings not available"
        description={recordings.error}
      />
    );
  if (recordings.error)
    return <EmptyState title="Could not load recordings" description={recordings.error} />;
  if (recordings.items.length === 0)
    return (
      <EmptyState
        icon={<Video size={28} />}
        title="No recordings yet"
        description="Recordings appear here once the agent records a Teams call."
      />
    );
  return <RecordingList items={recordings.items} onSelect={onSelect} />;
}
