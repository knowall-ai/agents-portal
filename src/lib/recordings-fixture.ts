/**
 * Built-in recordings for development and the demo toggle (RECORDINGS_FIXTURE=1
 * or ?demo=1): the shape the Presence bridge serves, with invented meetings.
 * There is no video to play back here; the detail view says so.
 */
import type { Recording, RecordingDetail, RecordingsStatus } from '@/types';

const SAMPLE: RecordingDetail[] = [
  {
    id: 'rec_20260904T093012Z',
    agent: 'demo',
    room: 'demo-call-4f2a',
    startedAt: '2026-09-04T09:30:12Z',
    stoppedAt: '2026-09-04T10:02:40Z',
    durationSeconds: 1948,
    status: 'ready',
    meeting: { subject: 'Weekly pipeline review', meetingId: 'demo-meeting-1' },
    organizer: 'Sam Ortiz',
    participants: ['Sam Ortiz', 'Priya Nair', 'Demo agent'],
    participantCount: 3,
    transcript: { turns: true, vtt: true },
    turns: [
      { t: 4, speaker: 'Sam Ortiz', text: 'Morning everyone. Shall we start with the pipeline?' },
      {
        t: 11,
        speaker: 'Demo agent',
        text: 'Three proposals went out this week and two are awaiting signature.',
      },
      { t: 24, speaker: 'Priya Nair', text: 'Which two?' },
      {
        t: 27,
        speaker: 'Demo agent',
        text: 'The warehouse automation pilot and the accounts review.',
      },
      { t: 40, speaker: null, text: 'Can we push the accounts review to next month?' },
      { t: 46, speaker: 'Sam Ortiz', text: 'Let us keep it and chase on Thursday.' },
    ],
  },
  {
    id: 'rec_20260903T140501Z',
    agent: 'demo',
    room: 'demo-call-9c11',
    startedAt: '2026-09-03T14:05:01Z',
    stoppedAt: '2026-09-03T14:21:33Z',
    durationSeconds: 992,
    status: 'processing',
    meeting: { subject: 'Onboarding call' },
    organizer: 'Priya Nair',
    participants: ['Priya Nair', 'Demo agent'],
    participantCount: 2,
    transcript: { turns: true, vtt: false },
    turns: [
      {
        t: 2,
        speaker: 'Priya Nair',
        text: 'Thanks for joining. I wanted to walk through the setup.',
      },
      { t: 9, speaker: 'Demo agent', text: 'Happy to. I have the checklist open.' },
    ],
  },
  {
    id: 'rec_20260901T081500Z',
    agent: 'demo',
    startedAt: '2026-09-01T08:15:00Z',
    stoppedAt: '2026-09-01T08:15:20Z',
    durationSeconds: 20,
    status: 'failed',
    error: 'Teams did not produce a recording (the organiser left before it started)',
    meeting: { subject: 'Stand-up' },
    participants: ['Demo agent'],
    participantCount: 1,
    transcript: { turns: false, vtt: false },
    turns: [],
  },
];

export function fixtureRecordings(agentId: string): Recording[] {
  return SAMPLE.map((recording) => {
    const { turns, ...item } = recording;
    void turns;
    return { ...item, agent: agentId };
  });
}

export function fixtureRecording(agentId: string, id: string): RecordingDetail | null {
  const found = SAMPLE.find((recording) => recording.id === id);
  return found ? { ...found, agent: agentId } : null;
}

export function fixtureRecordingsStatus(): RecordingsStatus {
  return { active: false, checkedAt: new Date().toISOString() };
}
