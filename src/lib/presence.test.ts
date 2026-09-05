import { describe, expect, it } from 'vitest';
import { isOnCall, presenceLabel } from './presence';

describe('isOnCall', () => {
  it('is true only for call and meeting activities', () => {
    expect(isOnCall('InACall')).toBe(true);
    expect(isOnCall('InAConferenceCall')).toBe(true);
    expect(isOnCall('Presenting')).toBe(true);
    expect(isOnCall('Available')).toBe(false);
    expect(isOnCall('InAMeeting')).toBe(false);
    expect(isOnCall(undefined)).toBe(false);
  });
});

describe('presenceLabel', () => {
  it('folds Graph availabilities into a few words', () => {
    expect(presenceLabel('AvailableIdle')).toBe('Available');
    expect(presenceLabel('BeRightBack')).toBe('Away');
    expect(presenceLabel('DoNotDisturb')).toBe('Do not disturb');
    expect(presenceLabel('PresenceUnknown')).toBe('Unknown');
    expect(presenceLabel(undefined)).toBe('Unknown');
  });
});
