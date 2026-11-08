import { Router, Response } from 'express';
import { db } from '../db';
import {
  events,
  eventSessions,
  microTeams,
  microTeamMembers,
  microTeamSessions,
  microAttendance,
  users,
} from '../db/schema';
import { eq, and, inArray, desc, sql } from 'drizzle-orm';
import { verifyToken, requireAdmin, isUuid, AuthenticatedRequest } from '../middleware/auth';
import { getAcademicYear } from '../utils/member-helpers';

const router = Router();

// ============================================================================
// 1. EVENTS MANAGEMENT
// ============================================================================

// GET /api/micro/events (List all summit events with session & team stats)
router.get('/events', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const allEvents = await db.select().from(events).orderBy(desc(events.createdAt));
    const allSessions = await db.select().from(eventSessions);
    const allTeams = await db.select().from(microTeams);
    const allMembers = await db.select().from(microTeamMembers);

    const result = allEvents.map((evt) => {
      const eventSessionsList = allSessions.filter((s) => s.eventId === evt.id);
      const eventTeamsList = allTeams.filter((t) => t.eventId === evt.id);
      const eventTeamIds = new Set(eventTeamsList.map((t) => t.id));
      const eventMembersList = allMembers.filter((m) => eventTeamIds.has(m.microTeamId));

      return {
        ...evt,
        sessionCount: eventSessionsList.length,
        teamCount: eventTeamsList.length,
        memberCount: eventMembersList.length,
      };
    });

    return res.json({ events: result });
  } catch (error: any) {
    console.error('Error fetching micro events:', error);
    return res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// GET /api/micro/events/:id (Detailed event overview with sessions and teams)
router.get('/events/:id', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid event ID' });

    const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const sessionsList = await db
      .select()
      .from(eventSessions)
      .where(eq(eventSessions.eventId, id))
      .orderBy(eventSessions.startTime);

    const teamsList = await db
      .select()
      .from(microTeams)
      .where(eq(microTeams.eventId, id));

    return res.json({
      event,
      sessions: sessionsList,
      teams: teamsList,
    });
  } catch (error: any) {
    console.error('Error fetching event details:', error);
    return res.status(500).json({ error: 'Failed to fetch event details' });
  }
});

// POST /api/micro/events (Admin: Create new summit event)
router.post('/events', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, code, description, startDate, endDate, status } = req.body;

    if (!title || !code) {
      return res.status(400).json({ error: 'Event title and code are required.' });
    }

    const trimmedTitle = title.trim();
    const trimmedCode = code.trim().toUpperCase();

    // Check unique code
    const existing = await db.select().from(events).where(eq(events.code, trimmedCode)).limit(1);
    if (existing.length > 0) {
      return res.status(400).json({ error: `Event code "${trimmedCode}" is already in use.` });
    }

    const [newEvent] = await db
      .insert(events)
      .values({
        title: trimmedTitle,
        code: trimmedCode,
        description: description?.trim() || null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        status: status || 'active',
        createdById: req.user?.id || null,
      })
      .returning();

    return res.status(201).json({
      message: 'Event created successfully.',
      event: newEvent,
    });
  } catch (error: any) {
    console.error('Error creating event:', error);
    return res.status(500).json({ error: 'Failed to create event' });
  }
});

// PATCH /api/micro/events/:id (Admin: Update summit event)
router.patch('/events/:id', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid event ID' });

    const { title, code, description, startDate, endDate, status } = req.body;
    const updates: Record<string, any> = {};

    if (title !== undefined) updates.title = title.trim();
    if (description !== undefined) updates.description = description ? description.trim() : null;
    if (startDate !== undefined) updates.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updates.endDate = endDate ? new Date(endDate) : null;
    if (status !== undefined) updates.status = status;

    if (code !== undefined) {
      const trimmedCode = code.trim().toUpperCase();
      const existing = await db
        .select()
        .from(events)
        .where(and(eq(events.code, trimmedCode), sql`${events.id} != ${id}`))
        .limit(1);
      if (existing.length > 0) {
        return res.status(400).json({ error: `Event code "${trimmedCode}" is already in use.` });
      }
      updates.code = trimmedCode;
    }

    const [updated] = await db
      .update(events)
      .set(updates)
      .where(eq(events.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: 'Event not found' });

    return res.json({
      message: 'Event updated successfully.',
      event: updated,
    });
  } catch (error: any) {
    console.error('Error updating event:', error);
    return res.status(500).json({ error: 'Failed to update event' });
  }
});

// DELETE /api/micro/events/:id (Admin: Delete summit event)
router.delete('/events/:id', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid event ID' });

    const [deleted] = await db.delete(events).where(eq(events.id, id)).returning();
    if (!deleted) return res.status(404).json({ error: 'Event not found' });

    return res.json({ message: 'Event deleted successfully.' });
  } catch (error: any) {
    console.error('Error deleting event:', error);
    return res.status(500).json({ error: 'Failed to delete event' });
  }
});

// ============================================================================
// 2. SESSIONS MANAGEMENT
// ============================================================================

// POST /api/micro/events/:id/sessions (Admin: Create session for event)
router.post('/events/:id/sessions', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid event ID' });

    const { title, location, startTime, endTime, isActive } = req.body;

    if (!title || !startTime || !endTime) {
      return res.status(400).json({ error: 'Session title, start time, and end time are required.' });
    }

    const [newSession] = await db
      .insert(eventSessions)
      .values({
        eventId: id,
        title: title.trim(),
        location: location?.trim() || 'Auditorium / Main Hall',
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        isActive: isActive !== undefined ? String(isActive) : 'true',
      })
      .returning();

    return res.status(201).json({
      message: 'Session created successfully.',
      session: newSession,
    });
  } catch (error: any) {
    console.error('Error creating event session:', error);
    return res.status(500).json({ error: 'Failed to create session' });
  }
});

// PATCH /api/micro/sessions/:sessionId (Admin: Update session)
router.patch('/sessions/:sessionId', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    if (!isUuid(sessionId)) return res.status(400).json({ error: 'Invalid session ID' });

    const { title, location, startTime, endTime, isActive } = req.body;
    const updates: Record<string, any> = {};

    if (title !== undefined) updates.title = title.trim();
    if (location !== undefined) updates.location = location ? location.trim() : null;
    if (startTime !== undefined) updates.startTime = new Date(startTime);
    if (endTime !== undefined) updates.endTime = new Date(endTime);
    if (isActive !== undefined) updates.isActive = String(isActive);

    const [updated] = await db
      .update(eventSessions)
      .set(updates)
      .where(eq(eventSessions.id, sessionId))
      .returning();

    if (!updated) return res.status(404).json({ error: 'Session not found' });

    return res.json({
      message: 'Session updated successfully.',
      session: updated,
    });
  } catch (error: any) {
    console.error('Error updating session:', error);
    return res.status(500).json({ error: 'Failed to update session' });
  }
});

// DELETE /api/micro/sessions/:sessionId (Admin: Delete session)
router.delete('/sessions/:sessionId', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    if (!isUuid(sessionId)) return res.status(400).json({ error: 'Invalid session ID' });

    const [deleted] = await db.delete(eventSessions).where(eq(eventSessions.id, sessionId)).returning();
    if (!deleted) return res.status(404).json({ error: 'Session not found' });

    return res.json({ message: 'Session deleted successfully.' });
  } catch (error: any) {
    console.error('Error deleting session:', error);
    return res.status(500).json({ error: 'Failed to delete session' });
  }
});

// ============================================================================
// 3. MICRO-TEAMS MANAGEMENT
// ============================================================================

// GET /api/micro/events/:id/teams (List all micro-teams for an event with members and sessions)
router.get('/events/:id/teams', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid event ID' });

    const teamsList = await db.select().from(microTeams).where(eq(microTeams.eventId, id));
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map((u) => [u.id, u]));

    const teamIds = teamsList.map((t) => t.id);

    let membersList: any[] = [];
    let teamSessionsList: any[] = [];

    if (teamIds.length > 0) {
      membersList = await db
        .select()
        .from(microTeamMembers)
        .where(inArray(microTeamMembers.microTeamId, teamIds));

      teamSessionsList = await db
        .select()
        .from(microTeamSessions)
        .where(inArray(microTeamSessions.microTeamId, teamIds));
    }

    const allSessions = await db.select().from(eventSessions).where(eq(eventSessions.eventId, id));
    const sessionMap = new Map(allSessions.map((s) => [s.id, s]));

    const result = teamsList.map((t) => {
      const leader = t.leaderId ? userMap.get(t.leaderId) : null;
      const tMembers = membersList
        .filter((m) => m.microTeamId === t.id)
        .map((m) => {
          const u = userMap.get(m.userId);
          return {
            id: m.id,
            userId: m.userId,
            roleInTeam: m.roleInTeam,
            assignedAt: m.assignedAt,
            name: u?.name || 'Unknown',
            rollNumber: u?.rollNumber || 'N/A',
            academicYear: u ? getAcademicYear(u.rollNumber) : 'N/A',
            email: u?.email || '',
            avatarUrl: u?.avatarUrl || null,
            position: u?.position || 'Member',
          };
        });

      const tSessionIds = teamSessionsList.filter((ts) => ts.microTeamId === t.id).map((ts) => ts.sessionId);
      const tSessions = tSessionIds.map((sid) => sessionMap.get(sid)).filter(Boolean);

      return {
        ...t,
        leader: leader
          ? {
              id: leader.id,
              name: leader.name,
              rollNumber: leader.rollNumber,
              email: leader.email,
              avatarUrl: leader.avatarUrl,
            }
          : null,
        members: tMembers,
        memberCount: tMembers.length,
        assignedSessionIds: tSessionIds,
        assignedSessions: tSessions,
      };
    });

    return res.json({ teams: result });
  } catch (error: any) {
    console.error('Error fetching micro teams:', error);
    return res.status(500).json({ error: 'Failed to fetch micro teams' });
  }
});

// POST /api/micro/events/:id/teams (Admin: Create micro-team)
router.post('/events/:id/teams', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid event ID' });

    const { name, code, leaderId, isLeadershipManaged, description, memberIds, sessionIds } = req.body;

    if (!name || !code) {
      return res.status(400).json({ error: 'Team name and code are required.' });
    }

    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();

    // Check code in event
    const existing = await db
      .select()
      .from(microTeams)
      .where(and(eq(microTeams.eventId, id), eq(microTeams.code, trimmedCode)))
      .limit(1);

    if (existing.length > 0) {
      return res.status(400).json({ error: `Team code "${trimmedCode}" already exists in this event.` });
    }

    const [newTeam] = await db
      .insert(microTeams)
      .values({
        eventId: id,
        name: trimmedName,
        code: trimmedCode,
        leaderId: leaderId && isUuid(leaderId) ? leaderId : null,
        isLeadershipManaged: isLeadershipManaged ? 1 : 0,
        description: description?.trim() || null,
      })
      .returning();

    // If leaderId is provided, automatically add leader to microTeamMembers with role 'leader'
    if (leaderId && isUuid(leaderId)) {
      await db.insert(microTeamMembers).values({
        microTeamId: newTeam.id,
        userId: leaderId,
        roleInTeam: 'leader',
      });
    }

    // Add initial members if provided
    if (Array.isArray(memberIds) && memberIds.length > 0) {
      const toInsert = memberIds
        .filter((uid: string) => isUuid(uid) && uid !== leaderId)
        .map((uid: string) => ({
          microTeamId: newTeam.id,
          userId: uid,
          roleInTeam: 'member' as const,
        }));

      if (toInsert.length > 0) {
        await db.insert(microTeamMembers).values(toInsert);
      }
    }

    // Assign initial sessions if provided
    if (Array.isArray(sessionIds) && sessionIds.length > 0) {
      const validSessions = sessionIds.filter((sid: string) => isUuid(sid));
      if (validSessions.length > 0) {
        await db.insert(microTeamSessions).values(
          validSessions.map((sid: string) => ({
            microTeamId: newTeam.id,
            sessionId: sid,
          }))
        );
      }
    }

    return res.status(201).json({
      message: 'Micro-team created successfully.',
      team: newTeam,
    });
  } catch (error: any) {
    console.error('Error creating micro-team:', error);
    return res.status(500).json({ error: 'Failed to create micro-team' });
  }
});

// PATCH /api/micro/teams/:teamId (Admin: Update micro-team)
router.patch('/teams/:teamId', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { teamId } = req.params;
    if (!isUuid(teamId)) return res.status(400).json({ error: 'Invalid team ID' });

    const { name, code, leaderId, isLeadershipManaged, description } = req.body;
    const updates: Record<string, any> = {};

    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description ? description.trim() : null;
    if (isLeadershipManaged !== undefined) updates.isLeadershipManaged = isLeadershipManaged ? 1 : 0;
    if (leaderId !== undefined) {
      updates.leaderId = leaderId && isUuid(leaderId) ? leaderId : null;
    }

    if (code !== undefined) {
      const trimmedCode = code.trim().toUpperCase();
      const current = await db.select().from(microTeams).where(eq(microTeams.id, teamId)).limit(1);
      if (current.length > 0) {
        const existing = await db
          .select()
          .from(microTeams)
          .where(
            and(
              eq(microTeams.eventId, current[0].eventId),
              eq(microTeams.code, trimmedCode),
              sql`${microTeams.id} != ${teamId}`
            )
          )
          .limit(1);
        if (existing.length > 0) {
          return res.status(400).json({ error: `Team code "${trimmedCode}" already exists in this event.` });
        }
      }
      updates.code = trimmedCode;
    }

    const [updated] = await db
      .update(microTeams)
      .set(updates)
      .where(eq(microTeams.id, teamId))
      .returning();

    if (!updated) return res.status(404).json({ error: 'Team not found' });

    // If leader changed, ensure new leader is in microTeamMembers
    if (leaderId && isUuid(leaderId)) {
      const existingMember = await db
        .select()
        .from(microTeamMembers)
        .where(and(eq(microTeamMembers.microTeamId, teamId), eq(microTeamMembers.userId, leaderId)))
        .limit(1);

      if (existingMember.length === 0) {
        await db.insert(microTeamMembers).values({
          microTeamId: teamId,
          userId: leaderId,
          roleInTeam: 'leader',
        });
      } else {
        await db
          .update(microTeamMembers)
          .set({ roleInTeam: 'leader' })
          .where(eq(microTeamMembers.id, existingMember[0].id));
      }
    }

    return res.json({
      message: 'Team updated successfully.',
      team: updated,
    });
  } catch (error: any) {
    console.error('Error updating micro team:', error);
    return res.status(500).json({ error: 'Failed to update micro team' });
  }
});

// DELETE /api/micro/teams/:teamId (Admin: Delete micro-team)
router.delete('/teams/:teamId', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { teamId } = req.params;
    if (!isUuid(teamId)) return res.status(400).json({ error: 'Invalid team ID' });

    const [deleted] = await db.delete(microTeams).where(eq(microTeams.id, teamId)).returning();
    if (!deleted) return res.status(404).json({ error: 'Team not found' });

    return res.json({ message: 'Team deleted successfully.' });
  } catch (error: any) {
    console.error('Error deleting micro-team:', error);
    return res.status(500).json({ error: 'Failed to delete micro-team' });
  }
});

// POST /api/micro/teams/:teamId/members (Admin: Add member(s) to micro-team)
router.post('/teams/:teamId/members', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { teamId } = req.params;
    if (!isUuid(teamId)) return res.status(400).json({ error: 'Invalid team ID' });

    const { members } = req.body;
    // Expected: members: Array<{ userId: string, roleInTeam?: 'leader' | 'member' | 'volunteer' }>
    if (!Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: 'Members array is required.' });
    }

    const inserted: any[] = [];
    for (const m of members) {
      if (!m.userId || !isUuid(m.userId)) continue;

      // Check if already in this team
      const existing = await db
        .select()
        .from(microTeamMembers)
        .where(and(eq(microTeamMembers.microTeamId, teamId), eq(microTeamMembers.userId, m.userId)))
        .limit(1);

      if (existing.length > 0) {
        // Update role if changed
        if (m.roleInTeam && m.roleInTeam !== existing[0].roleInTeam) {
          const [upd] = await db
            .update(microTeamMembers)
            .set({ roleInTeam: m.roleInTeam })
            .where(eq(microTeamMembers.id, existing[0].id))
            .returning();
          inserted.push(upd);
        } else {
          inserted.push(existing[0]);
        }
      } else {
        const [row] = await db
          .insert(microTeamMembers)
          .values({
            microTeamId: teamId,
            userId: m.userId,
            roleInTeam: m.roleInTeam || 'member',
          })
          .returning();
        inserted.push(row);
      }
    }

    return res.json({
      message: `Successfully processed ${inserted.length} member(s).`,
      members: inserted,
    });
  } catch (error: any) {
    console.error('Error adding team members:', error);
    return res.status(500).json({ error: 'Failed to add team members' });
  }
});

// DELETE /api/micro/teams/:teamId/members/:userId (Admin: Remove member from micro-team)
router.delete('/teams/:teamId/members/:userId', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { teamId, userId } = req.params;
    if (!isUuid(teamId) || !isUuid(userId)) {
      return res.status(400).json({ error: 'Invalid team or user ID' });
    }

    const [deleted] = await db
      .delete(microTeamMembers)
      .where(and(eq(microTeamMembers.microTeamId, teamId), eq(microTeamMembers.userId, userId)))
      .returning();

    if (!deleted) {
      return res.status(404).json({ error: 'Member is not assigned to this team.' });
    }

    // If member was the team leader, remove leaderId from team
    const [team] = await db.select().from(microTeams).where(eq(microTeams.id, teamId)).limit(1);
    if (team?.leaderId === userId) {
      await db.update(microTeams).set({ leaderId: null }).where(eq(microTeams.id, teamId));
    }

    return res.json({ message: 'Member removed from team successfully.' });
  } catch (error: any) {
    console.error('Error removing team member:', error);
    return res.status(500).json({ error: 'Failed to remove member from team' });
  }
});

// POST /api/micro/teams/:teamId/sessions (Admin: Map sessions to team)
router.post('/teams/:teamId/sessions', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { teamId } = req.params;
    if (!isUuid(teamId)) return res.status(400).json({ error: 'Invalid team ID' });

    const { sessionIds } = req.body;
    if (!Array.isArray(sessionIds)) {
      return res.status(400).json({ error: 'sessionIds must be an array of session IDs.' });
    }

    // Clear existing mapped sessions for this team
    await db.delete(microTeamSessions).where(eq(microTeamSessions.microTeamId, teamId));

    // Insert new mappings
    const validSessionIds = sessionIds.filter((sid: string) => isUuid(sid));
    if (validSessionIds.length > 0) {
      await db.insert(microTeamSessions).values(
        validSessionIds.map((sid: string) => ({
          microTeamId: teamId,
          sessionId: sid,
        }))
      );
    }

    return res.json({
      message: `Assigned ${validSessionIds.length} session(s) to team.`,
      sessionIds: validSessionIds,
    });
  } catch (error: any) {
    console.error('Error mapping team sessions:', error);
    return res.status(500).json({ error: 'Failed to map team sessions' });
  }
});

// POST /api/micro/events/:id/auto-distribute (Admin: Auto-distribute members into micro-teams)
router.post('/events/:id/auto-distribute', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid event ID' });

    const { teamPrefix = 'Micro-Team', teamSize = 5, userIds } = req.body;

    // Fetch pool of users: either supplied userIds or all non-advisor users
    let memberPool: any[] = [];
    if (Array.isArray(userIds) && userIds.length > 0) {
      memberPool = await db.select().from(users).where(inArray(users.id, userIds.filter(isUuid)));
    } else {
      memberPool = await db.select().from(users);
    }

    // Exclude advisors
    memberPool = memberPool.filter((u) => u.role !== 'advisor');

    if (memberPool.length === 0) {
      return res.status(400).json({ error: 'No members available for distribution.' });
    }

    // Separate into 2nd/3rd-year candidates (leaders) and junior/core members
    const leadersPool: any[] = [];
    const corePool: any[] = [];

    for (const m of memberPool) {
      const year = getAcademicYear(m.rollNumber);
      if (year.includes('3rd Year') || year.includes('2nd Year') || m.position.toLowerCase().includes('lead') || m.position.toLowerCase().includes('head')) {
        leadersPool.push(m);
      } else {
        corePool.push(m);
      }
    }

    // Calculate number of teams needed
    const targetTeamSize = Math.max(3, Math.min(10, Number(teamSize) || 5));
    const totalTeams = Math.ceil(memberPool.length / targetTeamSize);

    // Shuffle helper
    const shuffle = <T>(arr: T[]): T[] => arr.sort(() => Math.random() - 0.5);
    shuffle(leadersPool);
    shuffle(corePool);

    const createdTeams: any[] = [];

    // All available event sessions to map by default
    const eventSessionsList = await db.select().from(eventSessions).where(eq(eventSessions.eventId, id));
    const allSessionIds = eventSessionsList.map((s) => s.id);

    // Combine remaining leaders and core into a single general pool
    const combinedMembers = [...leadersPool, ...corePool];

    for (let i = 0; i < totalTeams; i++) {
      const teamNumber = String(i + 1).padStart(2, '0');
      const teamName = `${teamPrefix} ${teamNumber}`;
      const teamCode = `MT-${teamNumber}`;

      // Take next batch of members
      const batch = combinedMembers.splice(0, targetTeamSize);
      if (batch.length === 0) break;

      // Pick the highest year member in this batch as leader
      const teamLeader = batch[0];

      const [newTeam] = await db
        .insert(microTeams)
        .values({
          eventId: id,
          name: teamName,
          code: teamCode,
          leaderId: teamLeader.id,
          isLeadershipManaged: 0,
          description: `Auto-generated micro-team of ${batch.length} members.`,
        })
        .returning();

      // Insert members
      await db.insert(microTeamMembers).values(
        batch.map((m, idx) => ({
          microTeamId: newTeam.id,
          userId: m.id,
          roleInTeam: idx === 0 ? ('leader' as const) : ('member' as const),
        }))
      );

      // Assign all event sessions by default
      if (allSessionIds.length > 0) {
        await db.insert(microTeamSessions).values(
          allSessionIds.map((sid) => ({
            microTeamId: newTeam.id,
            sessionId: sid,
          }))
        );
      }

      createdTeams.push({
        team: newTeam,
        leader: teamLeader.name,
        memberCount: batch.length,
      });
    }

    return res.json({
      message: `Successfully generated ${createdTeams.length} micro-teams.`,
      teams: createdTeams,
    });
  } catch (error: any) {
    console.error('Error auto-distributing teams:', error);
    return res.status(500).json({ error: 'Failed to auto-distribute teams' });
  }
});

// ============================================================================
// 4. POC CHECK-IN PORTAL API
// ============================================================================

// GET /api/micro/my-teams (Get teams where the current user is POC or has access)
router.get('/my-teams', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const isAdmin = req.user?.role === 'admin';
    const { eventId, sessionId } = req.query;

    let targetEventId = eventId as string | undefined;

    // If no eventId specified, pick active event or latest event
    if (!targetEventId || !isUuid(targetEventId)) {
      const activeEvt = await db
        .select()
        .from(events)
        .where(eq(events.status, 'active'))
        .orderBy(desc(events.createdAt))
        .limit(1);
      targetEventId = activeEvt[0]?.id;
    }

    if (!targetEventId) {
      return res.json({ event: null, teams: [], sessions: [] });
    }

    const [event] = await db.select().from(events).where(eq(events.id, targetEventId)).limit(1);
    const sessionsList = await db
      .select()
      .from(eventSessions)
      .where(eq(eventSessions.eventId, targetEventId))
      .orderBy(eventSessions.startTime);

    // Fetch teams where user is leader, or user has role 'leader' in microTeamMembers, or user is Admin
    let teamsList: any[] = [];
    if (isAdmin) {
      // Admins see all teams in event
      teamsList = await db.select().from(microTeams).where(eq(microTeams.eventId, targetEventId));
    } else {
      // Find teams led by user
      const ledTeams = await db
        .select()
        .from(microTeams)
        .where(and(eq(microTeams.eventId, targetEventId), eq(microTeams.leaderId, userId!)));

      const leaderMemberships = await db
        .select()
        .from(microTeamMembers)
        .where(and(eq(microTeamMembers.userId, userId!), eq(microTeamMembers.roleInTeam, 'leader')));

      const additionalTeamIds = leaderMemberships.map((m) => m.microTeamId);
      let additionalTeams: any[] = [];
      if (additionalTeamIds.length > 0) {
        additionalTeams = await db
          .select()
          .from(microTeams)
          .where(and(eq(microTeams.eventId, targetEventId), inArray(microTeams.id, additionalTeamIds)));
      }

      const teamMap = new Map();
      [...ledTeams, ...additionalTeams].forEach((t) => teamMap.set(t.id, t));
      teamsList = Array.from(teamMap.values());
    }

    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map((u) => [u.id, u]));

    const teamIds = teamsList.map((t) => t.id);

    let membersList: any[] = [];
    let teamSessionsList: any[] = [];
    let attendanceRecords: any[] = [];

    if (teamIds.length > 0) {
      membersList = await db
        .select()
        .from(microTeamMembers)
        .where(inArray(microTeamMembers.microTeamId, teamIds));

      teamSessionsList = await db
        .select()
        .from(microTeamSessions)
        .where(inArray(microTeamSessions.microTeamId, teamIds));

      if (sessionId && isUuid(sessionId as string)) {
        attendanceRecords = await db
          .select()
          .from(microAttendance)
          .where(and(eq(microAttendance.sessionId, sessionId as string), inArray(microAttendance.microTeamId, teamIds)));
      }
    }

    const attendanceMap = new Map(attendanceRecords.map((a) => [`${a.microTeamId}_${a.userId}`, a]));

    const result = teamsList.map((t) => {
      const leader = t.leaderId ? userMap.get(t.leaderId) : null;
      const tMembers = membersList
        .filter((m) => m.microTeamId === t.id)
        .map((m) => {
          const u = userMap.get(m.userId);
          const att = attendanceMap.get(`${t.id}_${m.userId}`);
          return {
            id: m.id,
            userId: m.userId,
            roleInTeam: m.roleInTeam,
            name: u?.name || 'Unknown',
            rollNumber: u?.rollNumber || 'N/A',
            academicYear: u ? getAcademicYear(u.rollNumber) : 'N/A',
            email: u?.email || '',
            avatarUrl: u?.avatarUrl || null,
            position: u?.position || 'Member',
            attendance: att
              ? {
                  id: att.id,
                  status: att.status,
                  notes: att.notes,
                  markedById: att.markedById,
                  markedAt: att.markedAt,
                  updatedById: att.updatedById,
                  updatedAt: att.updatedAt,
                }
              : null,
          };
        });

      const tSessionIds = teamSessionsList.filter((ts) => ts.microTeamId === t.id).map((ts) => ts.sessionId);

      return {
        ...t,
        leader: leader
          ? {
              id: leader.id,
              name: leader.name,
              rollNumber: leader.rollNumber,
              avatarUrl: leader.avatarUrl,
            }
          : null,
        members: tMembers,
        memberCount: tMembers.length,
        assignedSessionIds: tSessionIds,
      };
    });

    return res.json({
      event,
      sessions: sessionsList,
      teams: result,
      isAdmin,
    });
  } catch (error: any) {
    console.error('Error fetching POC teams:', error);
    return res.status(500).json({ error: 'Failed to fetch POC teams' });
  }
});

// POST /api/micro/attendance/batch (POC & Admin: Batch mark team attendance for a session)
router.post('/attendance/batch', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId, microTeamId, records } = req.body;
    const currentUserId = req.user?.id;
    const isAdmin = req.user?.role === 'admin';

    if (!sessionId || !isUuid(sessionId) || !microTeamId || !isUuid(microTeamId)) {
      return res.status(400).json({ error: 'Valid sessionId and microTeamId are required.' });
    }

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'records array is required.' });
    }

    // Verify session exists
    const [session] = await db.select().from(eventSessions).where(eq(eventSessions.id, sessionId)).limit(1);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Verify micro team exists
    const [team] = await db.select().from(microTeams).where(eq(microTeams.id, microTeamId)).limit(1);
    if (!team) return res.status(404).json({ error: 'Micro team not found' });

    // 1. DIGNITARY TEAM CHECK:
    // If team has isLeadershipManaged === 1, attendance CAN ONLY be marked by DCC Leadership (Admins)!
    if (team.isLeadershipManaged === 1 && !isAdmin) {
      return res.status(403).json({
        error: 'Access denied. The Dignitary Coordination Team attendance is strictly managed by DCC Leadership (Admins).',
      });
    }

    // 2. POC AUTHORIZATION CHECK:
    // If not Admin, user MUST be the assigned team leader
    if (!isAdmin) {
      const isLeader = team.leaderId === currentUserId;
      if (!isLeader) {
        // Also check if user is assigned as 'leader' in microTeamMembers
        const leaderMember = await db
          .select()
          .from(microTeamMembers)
          .where(
            and(
              eq(microTeamMembers.microTeamId, microTeamId),
              eq(microTeamMembers.userId, currentUserId!),
              eq(microTeamMembers.roleInTeam, 'leader')
            )
          )
          .limit(1);

        if (leaderMember.length === 0) {
          return res.status(403).json({
            error: 'Access denied. You are not authorized to mark attendance for this team.',
          });
        }
      }

      // Check if session is assigned to this team
      const assignedSession = await db
        .select()
        .from(microTeamSessions)
        .where(and(eq(microTeamSessions.microTeamId, microTeamId), eq(microTeamSessions.sessionId, sessionId)))
        .limit(1);

      if (assignedSession.length === 0) {
        return res.status(403).json({
          error: 'This session is not assigned to your micro-team.',
        });
      }
    }

    const savedRecords: any[] = [];
    const validStatuses = new Set(['present', 'late', 'absent', 'excused']);

    for (const item of records) {
      if (!item.userId || !isUuid(item.userId)) continue;
      const status = validStatuses.has(item.status) ? item.status : 'present';
      const notes = item.notes?.trim() || null;

      // Check if attendance record already exists for (sessionId, userId)
      const existing = await db
        .select()
        .from(microAttendance)
        .where(and(eq(microAttendance.sessionId, sessionId), eq(microAttendance.userId, item.userId)))
        .limit(1);

      if (existing.length > 0) {
        // Update existing record with audit info
        const [updated] = await db
          .update(microAttendance)
          .set({
            status,
            notes,
            microTeamId,
            updatedById: currentUserId,
            updatedAt: new Date(),
          })
          .where(eq(microAttendance.id, existing[0].id))
          .returning();
        savedRecords.push(updated);
      } else {
        // Insert new record with markedById audit info
        const [inserted] = await db
          .insert(microAttendance)
          .values({
            sessionId,
            microTeamId,
            userId: item.userId,
            status,
            notes,
            markedById: currentUserId!,
            markedAt: new Date(),
          })
          .returning();
        savedRecords.push(inserted);
      }
    }

    return res.json({
      message: `Successfully recorded attendance for ${savedRecords.length} member(s).`,
      count: savedRecords.length,
      records: savedRecords,
    });
  } catch (error: any) {
    console.error('Error saving micro attendance:', error);
    return res.status(500).json({ error: 'Failed to record attendance' });
  }
});

// ============================================================================
// 5. LEADERSHIP DASHBOARD & REPORTS
// ============================================================================

// GET /api/micro/events/:id/dashboard (Leadership oversight dashboard)
router.get('/events/:id/dashboard', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid event ID' });

    const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const sessionsList = await db
      .select()
      .from(eventSessions)
      .where(eq(eventSessions.eventId, id))
      .orderBy(eventSessions.startTime);

    const teamsList = await db.select().from(microTeams).where(eq(microTeams.eventId, id));
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map((u) => [u.id, u]));

    const teamIds = teamsList.map((t) => t.id);
    const sessionIds = sessionsList.map((s) => s.id);

    let membersList: any[] = [];
    let attendanceList: any[] = [];

    if (teamIds.length > 0) {
      membersList = await db
        .select()
        .from(microTeamMembers)
        .where(inArray(microTeamMembers.microTeamId, teamIds));
    }

    if (sessionIds.length > 0) {
      attendanceList = await db
        .select()
        .from(microAttendance)
        .where(inArray(microAttendance.sessionId, sessionIds));
    }

    // Overall metrics
    const totalMembersAssigned = new Set(membersList.map((m) => m.userId)).size;
    const totalAttendanceEntries = attendanceList.length;
    const presentEntries = attendanceList.filter((a) => a.status === 'present').length;
    const lateEntries = attendanceList.filter((a) => a.status === 'late').length;
    const absentEntries = attendanceList.filter((a) => a.status === 'absent').length;
    const excusedEntries = attendanceList.filter((a) => a.status === 'excused').length;

    const overallRate = totalAttendanceEntries > 0
      ? Math.round(((presentEntries + lateEntries) / totalAttendanceEntries) * 100)
      : 0;

    // Team-wise metrics
    const teamStats = teamsList.map((t) => {
      const leader = t.leaderId ? userMap.get(t.leaderId) : null;
      const tMembers = membersList.filter((m) => m.microTeamId === t.id);
      const tAttendance = attendanceList.filter((a) => a.microTeamId === t.id);

      const tPresent = tAttendance.filter((a) => a.status === 'present').length;
      const tLate = tAttendance.filter((a) => a.status === 'late').length;
      const tAbsent = tAttendance.filter((a) => a.status === 'absent').length;
      const tExcused = tAttendance.filter((a) => a.status === 'excused').length;
      const tTotal = tAttendance.length;

      const rate = tTotal > 0 ? Math.round(((tPresent + tLate) / tTotal) * 100) : 0;

      return {
        id: t.id,
        name: t.name,
        code: t.code,
        isLeadershipManaged: t.isLeadershipManaged,
        leaderName: leader?.name || 'Unassigned',
        leaderRoll: leader?.rollNumber || 'N/A',
        memberCount: tMembers.length,
        presentCount: tPresent,
        lateCount: tLate,
        absentCount: tAbsent,
        excusedCount: tExcused,
        totalMarked: tTotal,
        attendanceRate: rate,
      };
    });

    // Absentee list with member & session details
    const absentMembers = attendanceList
      .filter((a) => a.status === 'absent')
      .map((a) => {
        const u = userMap.get(a.userId);
        const s = sessionsList.find((ses) => ses.id === a.sessionId);
        const t = teamsList.find((tm) => tm.id === a.microTeamId);
        return {
          id: a.id,
          userId: a.userId,
          name: u?.name || 'Unknown',
          rollNumber: u?.rollNumber || 'N/A',
          academicYear: u ? getAcademicYear(u.rollNumber) : 'N/A',
          sessionTitle: s?.title || 'Unknown Session',
          teamName: t?.name || 'Unknown Team',
          notes: a.notes,
          markedAt: a.markedAt,
        };
      });

    return res.json({
      event,
      sessions: sessionsList,
      stats: {
        totalMembersAssigned,
        totalSessions: sessionsList.length,
        totalTeams: teamsList.length,
        totalAttendanceEntries,
        presentEntries,
        lateEntries,
        absentEntries,
        excusedEntries,
        overallRate,
      },
      teamStats,
      absentMembers,
    });
  } catch (error: any) {
    console.error('Error fetching micro dashboard:', error);
    return res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

// GET /api/micro/events/:id/export/csv (RFC 4180 compliant CSV export for leadership)
router.get('/events/:id/export/csv', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid event ID' });

    const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const sessionsList = await db.select().from(eventSessions).where(eq(eventSessions.eventId, id));
    const teamsList = await db.select().from(microTeams).where(eq(microTeams.eventId, id));
    const allUsers = await db.select().from(users);

    const sessionMap = new Map(sessionsList.map((s) => [s.id, s]));
    const teamMap = new Map(teamsList.map((t) => [t.id, t]));
    const userMap = new Map(allUsers.map((u) => [u.id, u]));

    const sessionIds = sessionsList.map((s) => s.id);
    let attendanceList: any[] = [];
    if (sessionIds.length > 0) {
      attendanceList = await db
        .select()
        .from(microAttendance)
        .where(inArray(microAttendance.sessionId, sessionIds));
    }

    const membersList = await db
      .select()
      .from(microTeamMembers)
      .where(inArray(microTeamMembers.microTeamId, teamsList.map((t) => t.id)));

    const memberRoleMap = new Map(membersList.map((m) => [`${m.microTeamId}_${m.userId}`, m.roleInTeam]));

    // RFC 4180 CSV escaping helper
    const escapeCsv = (str: any) => {
      if (str === null || str === undefined) return '""';
      const text = String(str).replace(/"/g, '""');
      return `"${text}"`;
    };

    const headers = [
      'Event Title',
      'Event Code',
      'Session Title',
      'Session Location',
      'Session Start',
      'Session End',
      'Team Name',
      'Team Code',
      'Team Type',
      'Member Name',
      'Roll Number',
      'Academic Year',
      'Team Role',
      'Attendance Status',
      'Marked By',
      'Marked At',
      'Updated By',
      'Updated At',
      'Notes',
    ];

    const rows = [headers.join(',')];

    for (const record of attendanceList) {
      const ses = sessionMap.get(record.sessionId);
      const tm = teamMap.get(record.microTeamId);
      const usr = userMap.get(record.userId);
      const marker = userMap.get(record.markedById);
      const updater = record.updatedById ? userMap.get(record.updatedById) : null;
      const roleInTeam = memberRoleMap.get(`${record.microTeamId}_${record.userId}`) || 'member';

      rows.push(
        [
          escapeCsv(event.title),
          escapeCsv(event.code),
          escapeCsv(ses?.title || 'Unknown Session'),
          escapeCsv(ses?.location || ''),
          escapeCsv(ses ? new Date(ses.startTime).toLocaleString('en-IN') : ''),
          escapeCsv(ses ? new Date(ses.endTime).toLocaleString('en-IN') : ''),
          escapeCsv(tm?.name || 'Unknown Team'),
          escapeCsv(tm?.code || ''),
          escapeCsv(tm?.isLeadershipManaged === 1 ? 'Dignitary Protocol' : 'Micro-Team'),
          escapeCsv(usr?.name || 'Unknown'),
          escapeCsv(usr?.rollNumber || ''),
          escapeCsv(usr ? getAcademicYear(usr.rollNumber) : ''),
          escapeCsv(roleInTeam.toUpperCase()),
          escapeCsv(record.status.toUpperCase()),
          escapeCsv(marker?.name || record.markedById),
          escapeCsv(new Date(record.markedAt).toLocaleString('en-IN')),
          escapeCsv(updater?.name || record.updatedById || ''),
          escapeCsv(record.updatedAt ? new Date(record.updatedAt).toLocaleString('en-IN') : ''),
          escapeCsv(record.notes || ''),
        ].join(',')
      );
    }

    const csvContent = rows.join('\r\n');
    const sanitizedFilename = `micro_attendance_${event.code.toLowerCase()}_${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);
    return res.status(200).send(csvContent);
  } catch (error: any) {
    console.error('Error generating CSV export:', error);
    return res.status(500).json({ error: 'Failed to export CSV' });
  }
});

export default router;

