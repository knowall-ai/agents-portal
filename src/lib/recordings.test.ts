import { describe, expect, it } from 'vitest';
import {
  formatOffset,
  isValidRecordingId,
  parseRecording,
  parseRecordingDetail,
  parseRecordingList,
  parseRecordingsStatus,
  parseTurn,
} from './recordings';

const wire = {
  v: 1,
  id: 'rec_20260904T093012Z',
  agent: 'sallie',
  room: 'sallie-call-4f2a',
  started_at: '2026-09-04T09:30:12Z',
  stopped_at: '2026-09-04T10:02:40Z',
  duration_s: 1948.4,
  status: 'ready',
  meeting: {
    threadId: '19:meeting_abc@thread.v2',
    meetingId: 'MSpiZW4',
    subject: 'Weekly pipeline review',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/x',
  },
  organizer: { name: 'Sam Ortiz' },
  participants: [{ name: 'Sam Ortiz' }, { name: 'Priya Nair' }, { name: 'sam@example.com' }],
  participant_count: 3,
  transcript: { turns: true, vtt: true },
  teams: { recording_id: 'r1', transcript_id: 't1' },
};

describe('parseRecording', () => {
  it('maps the bridge item to the portal shape, dropping anything that looks like an address', () => {
    expect(parseRecording(wire, 'sallie')).toEqual({
      id: 'rec_20260904T093012Z',
      agent: 'sallie',
      room: 'sallie-call-4f2a',
      startedAt: '2026-09-04T09:30:12Z',
      stoppedAt: '2026-09-04T10:02:40Z',
      durationSeconds: 1948,
      status: 'ready',
      error: undefined,
      meeting: {
        subject: 'Weekly pipeline review',
        joinUrl: 'https://teams.microsoft.com/l/meetup-join/x',
        meetingId: 'MSpiZW4',
        threadId: '19:meeting_abc@thread.v2',
      },
      organizer: 'Sam Ortiz',
      participants: ['Sam Ortiz', 'Priya Nair'],
      participantCount: 3,
      transcript: { turns: true, vtt: true },
    });
  });

  it('rejects an item without a usable id or start time', () => {
    expect(parseRecording({ started_at: '2026-09-04T09:30:12Z' }, 'a')).toBeNull();
    expect(parseRecording({ id: 'rec_1' }, 'a')).toBeNull();
    expect(parseRecording({ id: '../x', started_at: '2026-09-04T09:30:12Z' }, 'a')).toBeNull();
    expect(parseRecording(null, 'a')).toBeNull();
    expect(parseRecording('rec_1', 'a')).toBeNull();
  });

  it('defaults an unknown status to processing, ignores non-https join links and counts participants itself', () => {
    const parsed = parseRecording(
      {
        id: 'rec_1',
        started_at: '2026-09-04T09:30:12Z',
        status: 'weird',
        meeting: { joinUrl: 'javascript:alert(1)' },
        participants: ['Ann', 42, { name: '' }],
        duration_s: -5,
      },
      'poppie'
    );
    expect(parsed).toMatchObject({
      agent: 'poppie',
      status: 'processing',
      participants: ['Ann'],
      participantCount: 1,
      transcript: { turns: false, vtt: false },
    });
    expect(parsed?.meeting.joinUrl).toBeUndefined();
    expect(parsed?.durationSeconds).toBeUndefined();
  });
});

describe('parseRecordingList', () => {
  it('sorts newest first and skips unparseable items', () => {
    const list = parseRecordingList(
      {
        items: [
          { id: 'rec_old', started_at: '2026-09-01T00:00:00Z' },
          { id: 'rec_new', started_at: '2026-09-04T00:00:00Z' },
          { nope: true },
        ],
      },
      'sallie'
    );
    expect(list.map((r) => r.id)).toEqual(['rec_new', 'rec_old']);
  });

  it('returns nothing for a body without items', () => {
    expect(parseRecordingList({}, 'a')).toEqual([]);
    expect(parseRecordingList([], 'a')).toEqual([]);
  });
});

describe('parseRecordingDetail', () => {
  it('attaches the transcript turns in time order and drops empty ones', () => {
    const detail = parseRecordingDetail(
      {
        ...wire,
        turns: [
          { t: 9, speaker: 'Priya Nair', text: 'Which two?' },
          { t: 2, speaker: null, text: 'Morning.' },
          { t: 4, speaker: 'x@y.z', text: '' },
          { t: -1, speaker: 'ann@example.com', text: 'Hi' },
        ],
      },
      'sallie'
    );
    expect(detail?.turns).toEqual([
      { t: 0, speaker: null, text: 'Hi' },
      { t: 2, speaker: null, text: 'Morning.' },
      { t: 9, speaker: 'Priya Nair', text: 'Which two?' },
    ]);
  });

  it('is null when the recording itself does not parse', () => {
    expect(parseRecordingDetail({ turns: [] }, 'a')).toBeNull();
  });
});

describe('parseTurn', () => {
  it('needs text', () => {
    expect(parseTurn({ t: 1 })).toBeNull();
    expect(parseTurn({ t: '1', text: 'x' })).toEqual({ t: 0, speaker: null, text: 'x' });
  });
});

describe('parseRecordingsStatus', () => {
  it('reads an active recording', () => {
    expect(
      parseRecordingsStatus(
        { active: true, since: '2026-09-04T09:30:12Z', room: 'r', id: 'rec_1' },
        '2026-09-04T09:31:00Z'
      )
    ).toEqual({
      active: true,
      since: '2026-09-04T09:30:12Z',
      room: 'r',
      id: 'rec_1',
      checkedAt: '2026-09-04T09:31:00Z',
    });
  });

  it('treats anything but active: true as not recording and drops the details', () => {
    expect(parseRecordingsStatus({ active: 'yes', since: 'x' }, 'now')).toEqual({
      active: false,
      since: undefined,
      room: undefined,
      id: undefined,
      checkedAt: 'now',
    });
    expect(parseRecordingsStatus(null, 'now').active).toBe(false);
  });
});

describe('isValidRecordingId', () => {
  it('accepts the bridge ids and refuses path tricks', () => {
    expect(isValidRecordingId('rec_20260904T093012Z')).toBe(true);
    expect(isValidRecordingId('rec_1-a')).toBe(true);
    expect(isValidRecordingId('')).toBe(false);
    expect(isValidRecordingId('../x')).toBe(false);
    expect(isValidRecordingId('a/b')).toBe(false);
    expect(isValidRecordingId('a?b=1')).toBe(false);
    expect(isValidRecordingId('x'.repeat(81))).toBe(false);
  });
});

describe('formatOffset', () => {
  it('renders m:ss and h:mm:ss', () => {
    expect(formatOffset(0)).toBe('0:00');
    expect(formatOffset(65.9)).toBe('1:05');
    expect(formatOffset(3725)).toBe('1:02:05');
    expect(formatOffset(-3)).toBe('0:00');
  });
});
