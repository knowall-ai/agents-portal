/**
 * Pure parsing of the recordings API (agent-presence docs/RECORDINGS.md):
 * every field is optional on the wire, and the bridge is a peer service, so
 * nothing is trusted to have the right shape. Names that look like addresses
 * are dropped: the portal never renders an email address.
 */
import type {
  Recording,
  RecordingDetail,
  RecordingStatus,
  RecordingTurn,
  RecordingsStatus,
} from '@/types';

const STATUSES: readonly RecordingStatus[] = ['recording', 'processing', 'ready', 'failed'];
/** A recording id as the bridge mints it (`rec_<startedAtCompactUTC>`): one URL path segment. */
export const RECORDING_ID = /^[A-Za-z0-9_-]{1,80}$/;

export function isValidRecordingId(id: string): boolean {
  return RECORDING_ID.test(id);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function obj(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A display name, or nothing when it is missing or looks like an address. */
function personName(value: unknown): string | undefined {
  const name = str(typeof value === 'string' ? value : obj(value).name);
  return name && !name.includes('@') ? name : undefined;
}

/** One item of `GET /recordings`, or null when it has no usable id or start time. */
export function parseRecording(raw: unknown, agentId: string): Recording | null {
  const item = obj(raw);
  const id = str(item.id);
  const startedAt = str(item.started_at);
  if (!id || !isValidRecordingId(id) || !startedAt) return null;
  const status = str(item.status);
  const meeting = obj(item.meeting);
  const transcript = obj(item.transcript);
  const participants = (Array.isArray(item.participants) ? item.participants : [])
    .map(personName)
    .filter((name): name is string => name !== undefined);
  const durationSeconds = num(item.duration_s);
  return {
    id,
    agent: str(item.agent) ?? agentId,
    room: str(item.room),
    startedAt,
    stoppedAt: str(item.stopped_at),
    durationSeconds:
      durationSeconds !== undefined && durationSeconds >= 0
        ? Math.round(durationSeconds)
        : undefined,
    status: STATUSES.includes(status as RecordingStatus)
      ? (status as RecordingStatus)
      : 'processing',
    error: str(item.error),
    meeting: {
      subject: str(meeting.subject),
      joinUrl: httpsUrl(meeting.joinUrl),
      meetingId: str(meeting.meetingId),
      threadId: str(meeting.threadId),
    },
    organizer: personName(item.organizer),
    participants,
    participantCount: num(item.participant_count) ?? (participants.length || undefined),
    transcript: { turns: transcript.turns === true, vtt: transcript.vtt === true },
  };
}

function httpsUrl(value: unknown): string | undefined {
  const url = str(value);
  return url && /^https:\/\//i.test(url) ? url : undefined;
}

/** `GET /recordings` body → items newest first, unparseable ones skipped. */
export function parseRecordingList(body: unknown, agentId: string): Recording[] {
  const items = Array.isArray(obj(body).items) ? (obj(body).items as unknown[]) : [];
  return items
    .map((item) => parseRecording(item, agentId))
    .filter((item): item is Recording => item !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** One transcript turn; a turn with no text is dropped. */
export function parseTurn(raw: unknown): RecordingTurn | null {
  const turn = obj(raw);
  const text = str(turn.text);
  if (!text) return null;
  const t = num(turn.t);
  return { t: t !== undefined && t >= 0 ? t : 0, speaker: personName(turn.speaker) ?? null, text };
}

/** `GET /recordings/{id}` body → the recording with its per-turn transcript. */
export function parseRecordingDetail(body: unknown, agentId: string): RecordingDetail | null {
  const recording = parseRecording(body, agentId);
  if (!recording) return null;
  const turns = (Array.isArray(obj(body).turns) ? (obj(body).turns as unknown[]) : [])
    .map(parseTurn)
    .filter((turn): turn is RecordingTurn => turn !== null)
    .sort((a, b) => a.t - b.t);
  return { ...recording, turns };
}

/** `GET /recordings/status` body. Anything but `active: true` means not recording. */
export function parseRecordingsStatus(body: unknown, checkedAt: string): RecordingsStatus {
  const status = obj(body);
  const active = status.active === true;
  return {
    active,
    since: active ? str(status.since) : undefined,
    room: active ? str(status.room) : undefined,
    id: active ? str(status.id) : undefined,
    checkedAt,
  };
}

/** `t` seconds as `m:ss` or `h:mm:ss`. */
export function formatOffset(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}
