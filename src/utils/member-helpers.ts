/**
 * Member and Session Business Logic Helpers
 * Handles academic year mapping, head designation, and meeting applicability.
 */

/**
 * Derives academic year from Bennett University roll number:
 * - s26... -> 1st Year
 * - s25... -> 2nd Year
 * - s24... -> 3rd Year
 * - s23... -> 4th Year
 */
export function getAcademicYear(rollNumber?: string | null): '1st Year' | '2nd Year' | '3rd Year' | '4th Year' | 'Other' {
  if (!rollNumber) return 'Other';
  const clean = rollNumber.trim().toLowerCase();
  const match = clean.match(/^s(\d{2})/i);
  if (!match) return 'Other';

  const yearCode = match[1];
  switch (yearCode) {
    case '26':
      return '1st Year';
    case '25':
      return '2nd Year';
    case '24':
      return '3rd Year';
    case '23':
      return '4th Year';
    default:
      return 'Other';
  }
}

/**
 * Identifies if a user is a Head or Lead in the club:
 * 1. Role is 'admin'
 * 2. Position contains lead/head keywords (e.g. "Tech Head", "Web Lead", "President", "Vice President", etc.)
 */
export function isUserHead(user: { role?: string; position?: string }): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!user.position) return false;

  const HEAD_POSITION_REGEX = /\b(head|lead|president|vp|vice[\s-]?president|convenor|convener|coordinator|director|executive|exec)\b/i;
  return HEAD_POSITION_REGEX.test(user.position.trim());
}

/**
 * Parses target team UUIDs from a session record.
 */
export function parseTargetTeamIds(targetTeamIds?: string | null, teamId?: string | null): string[] {
  const result = new Set<string>();

  if (targetTeamIds && typeof targetTeamIds === 'string') {
    try {
      const parsed = JSON.parse(targetTeamIds);
      if (Array.isArray(parsed)) {
        parsed.forEach((id: string) => {
          if (id && typeof id === 'string' && id.trim()) result.add(id.trim());
        });
      }
    } catch {
      // If comma-separated
      targetTeamIds.split(',').forEach((id) => {
        if (id && id.trim()) result.add(id.trim());
      });
    }
  }

  if (teamId && typeof teamId === 'string' && teamId.trim()) {
    result.add(teamId.trim());
  }

  return Array.from(result);
}

export type InapplicabilityReason = 'joined_later' | 'not_in_team' | 'not_a_head' | 'advisor_exempt';

/**
 * Determines whether a session counts as a required/eligible session for a given member.
 * If user actually attended (e.g., attended a guest session or prior meeting), it is always applicable.
 */
export function isSessionApplicableToUser(
  session: {
    startTime?: Date | string | null;
    createdAt?: Date | string | null;
    targetAudience?: string | null;
    targetTeamIds?: string | null;
    teamId?: string | null;
  },
  user: {
    role?: string;
    position?: string;
    teamId?: string | null;
    createdAt?: Date | string | null;
  },
  hasAttended: boolean = false
): { applicable: boolean; reason?: InapplicabilityReason } {
  // Advisors are completely exempt from attendance requirements
  if (user.role === 'advisor') {
    return { applicable: false, reason: 'advisor_exempt' };
  }

  // If the user attended, it always counts
  if (hasAttended) {
    return { applicable: true };
  }

  // 1. Check if the meeting took place before the member joined DCC CAMU
  if (session.startTime && user.createdAt) {
    const sessionDate = new Date(session.startTime).getTime();
    const userJoinedDate = new Date(user.createdAt).getTime();
    // 60-second tolerance window for accounts created right before/during session
    if (sessionDate < userJoinedDate - 60 * 1000) {
      return { applicable: false, reason: 'joined_later' };
    }
  }

  const audience = session.targetAudience || 'all';

  // 2. Heads-only meetings check
  if (audience === 'heads_only') {
    if (!isUserHead(user)) {
      return { applicable: false, reason: 'not_a_head' };
    }
  }

  // 3. Teams-only meetings check
  if (audience === 'teams_only' || (audience === 'all' && session.teamId && !session.targetAudience)) {
    const targetTeams = parseTargetTeamIds(session.targetTeamIds, session.teamId);
    if (targetTeams.length > 0) {
      if (!user.teamId || !targetTeams.includes(user.teamId)) {
        return { applicable: false, reason: 'not_in_team' };
      }
    }
  }

  return { applicable: true };
}
