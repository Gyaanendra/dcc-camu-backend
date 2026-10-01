/**
 * Member and Session Business Logic Helpers
 * Handles academic year mapping, head designation, and meeting applicability.
 */

/**
 * Derives academic year from Bennett University roll number:
 * - s26... / e26... -> 1st Year
 * - s25... / e25... -> 2nd Year
 * - s24... / e24... -> 3rd Year
 * - s23... / e23... -> 4th Year
 */
export function getAcademicYear(rollNumber?: string | null): '1st Year' | '2nd Year' | '3rd Year' | '4th Year' | 'Other' {
  if (!rollNumber) return 'Other';
  const clean = rollNumber.trim().toLowerCase();
  const match = clean.match(/^[a-z]*(\d{2})/i);
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
 * Identifies if a user is a Head, Sub Head, Lead, or Officer in the club:
 * 1. Role is 'admin'
 * 2. Position is Head, Sub Head, Associate Lead, President, VP, Secretary, Treasurer, Coordinator, etc.
 * 3. Strictly excludes regular Executives (Senior Executive, Junior Executive), Members, and Advisors.
 */
export function isUserHead(user: { role?: string; position?: string }): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!user.position) return false;

  const pos = user.position.trim().toLowerCase();

  // Explicitly not heads:
  if (
    pos === 'senior executive' ||
    pos === 'junior executive' ||
    pos === 'executive' ||
    pos === 'member' ||
    pos === 'advisor'
  ) {
    return false;
  }

  // Strictly match Heads, Sub Heads, Leads, Co-leads, and Core Club Officers
  const HEAD_REGEX = /\b(head|sub[\s-]?head|lead|co[\s-]?lead|president|vp|vice[\s-]?president|secretary|treasurer|coordinator|convener|convenor|director)\b/i;
  return HEAD_REGEX.test(pos);
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

/**
 * Parses target academic years from a session record.
 * Returns an array of target years (e.g. ['3rd Year'] or ['1st Year', '2nd Year']).
 * Returns empty array if all years are eligible.
 */
export function parseTargetYears(targetYears?: string | null): string[] {
  if (!targetYears || typeof targetYears !== 'string' || !targetYears.trim()) {
    return [];
  }

  const result = new Set<string>();
  try {
    const parsed = JSON.parse(targetYears);
    if (Array.isArray(parsed)) {
      parsed.forEach((y: string) => {
        if (y && typeof y === 'string' && y.trim()) result.add(y.trim());
      });
    }
  } catch {
    targetYears.split(',').forEach((y) => {
      if (y && y.trim()) result.add(y.trim());
    });
  }

  return Array.from(result);
}

export type InapplicabilityReason = 'joined_later' | 'not_in_team' | 'not_a_head' | 'not_in_year' | 'advisor_exempt';

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
    targetYears?: string | null;
    teamId?: string | null;
  },
  user: {
    role?: string;
    position?: string;
    rollNumber?: string | null;
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

  // 2. Check academic year targeting
  const targetYears = parseTargetYears(session.targetYears);
  if (targetYears.length > 0) {
    const userYear = getAcademicYear(user.rollNumber);
    if (!targetYears.includes(userYear)) {
      return { applicable: false, reason: 'not_in_year' };
    }
  }

  const audience = session.targetAudience || 'all';

  // 3. Heads-only meetings check
  if (audience === 'heads_only') {
    if (!isUserHead(user)) {
      return { applicable: false, reason: 'not_a_head' };
    }
  }

  // 4. Teams-only meetings check
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
