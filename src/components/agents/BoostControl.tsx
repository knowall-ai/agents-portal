'use client';

import { useState } from 'react';
import { AlertTriangle, RefreshCw, Zap, ZapOff } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { LoadingSpinner } from '@/components/common';
import type { AgentBoost } from '@/types';

interface BoostControlProps {
  agentId: string;
  boost: AgentBoost | null;
  isLoading: boolean;
  error?: string | null;
  onChanged: () => void;
}

const HOUR_OPTIONS = [0.5, 1, 2, 4, 8];

function hoursLabel(h: number): string {
  return h < 1 ? `${h * 60} min` : `${h} h`;
}

/**
 * BOOST mode: OpenAI Fast mode on the agent's VM for a fixed number of hours,
 * after which the VM switches the agent back on its own. Every change is a
 * run-command on the VM under the signed-in user's Azure RBAC.
 */
export default function BoostControl({
  agentId,
  boost,
  isLoading,
  error,
  onChanged,
}: BoostControlProps) {
  const [chosenHours, setChosenHours] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'on' | 'off' | 'refresh' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (isLoading && !boost) return <LoadingSpinner className="py-6" message="Loading Boost..." />;
  if (!boost?.supported) return null;

  const hours = chosenHours ?? boost.defaultHours;
  const options = HOUR_OPTIONS.filter((h) => h <= boost.maxHours);
  const untilDate = boost.until ? new Date(boost.until) : null;

  const call = async (action: 'on' | 'off' | 'refresh') => {
    setBusy(action);
    setMessage(null);
    try {
      // every action, refresh included, is a run-command on the VM: always POST
      const response = await fetch(`/api/agents/${agentId}/boost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'refresh' ? { action } : { action, hours }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          response.status === 403
            ? 'Azure refused: you need Virtual Machine Contributor (or higher) on the agent VM.'
            : body.details || body.error || `Request failed (${response.status})`
        );
      }
      setConfirming(false);
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {boost.active ? (
            <Zap size={18} style={{ color: 'var(--warning)' }} />
          ) : (
            <ZapOff size={18} style={{ color: 'var(--text-muted)' }} />
          )}
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {boost.active ? 'Boost is on' : 'Boost is off'}
          </span>
          {boost.active && untilDate && (
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              switches back {formatDistanceToNow(untilDate, { addSuffix: true })} (
              {untilDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
            </span>
          )}
          {boost.model && (
            <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
              {boost.model}
            </span>
          )}
        </div>
        <button
          onClick={() => call('refresh')}
          disabled={busy !== null}
          className="btn-secondary flex items-center gap-1 text-xs"
          title="Ask the VM for the current state (takes about 30 s)"
        >
          <RefreshCw size={12} className={busy === 'refresh' ? 'animate-spin' : ''} /> Check VM
        </button>
      </div>

      <p
        className="flex gap-2 rounded-md border p-3 text-xs"
        style={{
          borderColor: 'var(--warning-border)',
          backgroundColor: 'var(--warning-bg)',
          color: 'var(--text-secondary)',
        }}
      >
        <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
        <span>{boost.warning}</span>
      </p>

      {boost.active ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => call('off')}
            disabled={busy !== null}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <ZapOff size={14} /> {busy === 'off' ? 'Switching back…' : 'Switch back now'}
          </button>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {boost.source === 'cache'
              ? `Last confirmed ${
                  boost.checkedAt
                    ? formatDistanceToNow(new Date(boost.checkedAt), { addSuffix: true })
                    : 'earlier'
                }; use Check VM to be sure.`
              : 'Confirmed by the VM just now.'}
          </span>
        </div>
      ) : confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
            Bill the metered API at Fast-mode rates for {hoursLabel(hours)}?
          </span>
          <button
            onClick={() => call('on')}
            disabled={busy !== null}
            className="btn-boost flex items-center gap-2 text-sm"
          >
            <Zap size={14} />{' '}
            {busy === 'on' ? 'Turning on…' : `Yes, boost for ${hoursLabel(hours)}`}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={busy !== null}
            className="btn-secondary text-sm"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Duration
            <select
              className="input ml-2 text-xs"
              value={hours}
              onChange={(e) => setChosenHours(Number(e.target.value))}
            >
              {options.map((h) => (
                <option key={h} value={h}>
                  {hoursLabel(h)}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => setConfirming(true)}
            disabled={busy !== null}
            className="btn-boost flex items-center gap-2 text-sm"
          >
            <Zap size={14} /> Turn on Boost
          </button>
          {boost.source === 'none' && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              State not checked yet. Use Check VM.
            </span>
          )}
        </div>
      )}

      {(message || error) && (
        <p className="text-xs" style={{ color: 'var(--status-offline)' }}>
          {message ?? error}
        </p>
      )}
    </div>
  );
}
