/** Teams activities that mean the account is in a call or meeting right now. */
const CALL_ACTIVITIES = new Set(['InACall', 'InAConferenceCall', 'Presenting']);

export function isOnCall(activity?: string): boolean {
  return Boolean(activity && CALL_ACTIVITIES.has(activity));
}

/** Short human label for a Graph availability value. */
export function presenceLabel(availability?: string): string {
  switch (availability) {
    case 'Available':
    case 'AvailableIdle':
      return 'Available';
    case 'Busy':
    case 'BusyIdle':
      return 'Busy';
    case 'DoNotDisturb':
      return 'Do not disturb';
    case 'Away':
    case 'BeRightBack':
      return 'Away';
    case 'Offline':
      return 'Offline';
    default:
      return 'Unknown';
  }
}
