import { Router, Response } from 'express';
import { db } from '../db';
import { odRequests, users, sessions, teams } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { verifyToken, requireAdmin, requireViewer, isUuid, AuthenticatedRequest } from '../middleware/auth';
import { getAcademicYear } from '../utils/member-helpers';
import { generateCsv, CsvColumn } from '../utils/csv';

const router = Router();

// Standard Bennett University Time Periods for validation
export const BENNETT_TIME_SLOTS = [
  '08:20 AM - 09:20 AM',
  '09:25 AM - 10:25 AM',
  '10:30 AM - 11:30 AM',
  '11:35 AM - 12:35 PM',
  '12:40 PM - 01:40 PM',
  '02:50 PM - 03:50 PM',
  '03:55 PM - 04:55 PM',
  '05:00 PM - 06:00 PM',
] as const;

export interface LectureItem {
  timeSlot: string;
  subjectName: string;
  subjectCode: string;
  classType: 'lecture' | 'practical' | 'tutorial';
  facultyName: string;
  room?: string;
  remarks?: string;
}

// POST /api/od (Member: Submit a new OD request with N lectures for a date)
router.post('/', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { date, reason, sessionId, lectures } = req.body;
    const userId = req.user!.id;

    if (!date || typeof date !== 'string' || !date.trim()) {
      return res.status(400).json({ error: 'Please provide a valid date for this OD request.' });
    }

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return res.status(400).json({ error: 'Please provide an event name or reason for the OD.' });
    }

    if (!Array.isArray(lectures) || lectures.length === 0) {
      return res.status(400).json({ error: 'Please add at least one lecture/period for this OD.' });
    }

    // Validate each lecture row
    const validatedLectures: LectureItem[] = [];
    for (let i = 0; i < lectures.length; i++) {
      const l = lectures[i];
      if (!l.timeSlot || typeof l.timeSlot !== 'string') {
        return res.status(400).json({ error: `Lecture #${i + 1} is missing a time slot.` });
      }
      if (!l.subjectName || typeof l.subjectName !== 'string') {
        return res.status(400).json({ error: `Lecture #${i + 1} is missing a subject name.` });
      }

      validatedLectures.push({
        timeSlot: l.timeSlot.trim(),
        subjectName: l.subjectName.trim(),
        subjectCode: (l.subjectCode || 'N/A').trim(),
        classType: l.classType === 'practical' || l.classType === 'tutorial' ? l.classType : 'lecture',
        facultyName: (l.facultyName || 'Faculty').trim(),
        room: (l.room || 'Campus Room').trim(),
        remarks: (l.remarks || '').trim(),
      });
    }

    let linkedSessionId: string | null = null;
    if (sessionId && isUuid(sessionId)) {
      linkedSessionId = sessionId;
    }

    const [newOd] = await db
      .insert(odRequests)
      .values({
        userId,
        date: date.trim(),
        reason: reason.trim(),
        sessionId: linkedSessionId,
        lectures: JSON.stringify(validatedLectures),
        status: 'pending',
      })
      .returning();

    return res.status(201).json({
      message: 'On Duty (OD) request submitted successfully.',
      odRequest: {
        ...newOd,
        lectures: validatedLectures,
      },
    });
  } catch (error: any) {
    console.error('Error submitting OD request:', error);
    return res.status(500).json({ error: 'Failed to submit OD request.' });
  }
});

// GET /api/od/my (Member: Fetch personal OD requests)
router.get('/my', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const list = await db
      .select()
      .from(odRequests)
      .where(eq(odRequests.userId, userId))
      .orderBy(desc(odRequests.createdAt));

    const formatted = list.map((item) => {
      let parsedLectures: LectureItem[] = [];
      try {
        parsedLectures = JSON.parse(item.lectures);
      } catch {}
      return {
        ...item,
        lectures: parsedLectures,
        lectureCount: parsedLectures.length,
      };
    });

    return res.json({ odRequests: formatted });
  } catch (error: any) {
    console.error('Error fetching personal OD requests:', error);
    return res.status(500).json({ error: 'Failed to fetch OD requests.' });
  }
});

// GET /api/od (Admin + Advisor: View all submitted OD requests)
router.get('/', verifyToken, requireViewer, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [allOds, allUsers, allTeams, allSessions] = await Promise.all([
      db.select().from(odRequests).orderBy(desc(odRequests.createdAt)),
      db.select().from(users),
      db.select().from(teams),
      db.select().from(sessions),
    ]);

    const userMap = new Map(allUsers.map((u) => [u.id, u]));
    const teamMap = new Map(allTeams.map((t) => [t.id, t]));
    const sessionMap = new Map(allSessions.map((s) => [s.id, s]));

    const enriched = allOds.map((item) => {
      const member = userMap.get(item.userId);
      const reviewer = item.reviewedById ? userMap.get(item.reviewedById) : null;
      const team = member?.teamId ? teamMap.get(member.teamId) : null;
      const session = item.sessionId ? sessionMap.get(item.sessionId) : null;

      let parsedLectures: LectureItem[] = [];
      try {
        parsedLectures = JSON.parse(item.lectures);
      } catch {}

      return {
        ...item,
        lectures: parsedLectures,
        lectureCount: parsedLectures.length,
        memberName: member ? member.name : 'Unknown Member',
        memberRollNumber: member ? member.rollNumber : 'N/A',
        memberEmail: member ? member.email : '',
        academicYear: member ? getAcademicYear(member.rollNumber) : 'Other',
        memberPosition: member ? member.position : 'Member',
        teamName: team ? team.name : 'Unassigned',
        sessionTitle: session ? session.title : null,
        reviewedByName: reviewer ? reviewer.name : null,
      };
    });

    return res.json({ odRequests: enriched });
  } catch (error: any) {
    console.error('Error fetching admin OD list:', error);
    return res.status(500).json({ error: 'Failed to fetch OD requests.' });
  }
});

// PATCH /api/od/:id/status (Admin: Approve or Reject an OD request)
router.patch('/:id/status', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid OD request ID.' });
    }

    if (status !== 'approved' && status !== 'rejected') {
      return res.status(400).json({ error: 'Status must be either approved or rejected.' });
    }

    const [updated] = await db
      .update(odRequests)
      .set({
        status,
        adminNotes: adminNotes ? String(adminNotes).trim() : null,
        reviewedById: req.user!.id,
        reviewedAt: new Date(),
      })
      .where(eq(odRequests.id, id))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: 'OD request not found.' });
    }

    return res.json({
      message: `OD request has been ${status}.`,
      odRequest: updated,
    });
  } catch (error: any) {
    console.error('Error updating OD status:', error);
    return res.status(500).json({ error: 'Failed to update OD status.' });
  }
});

// DELETE /api/od/:id (Member: Cancel pending OD, or Admin: Delete any)
router.delete('/:id', verifyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid ID.' });

    const existing = await db.select().from(odRequests).where(eq(odRequests.id, id)).limit(1);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'OD request not found.' });
    }

    const record = existing[0];
    const isOwner = record.userId === req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized to delete this OD request.' });
    }

    if (isOwner && !isAdmin && record.status !== 'pending') {
      return res.status(400).json({ error: 'Cannot delete an already reviewed OD request.' });
    }

    await db.delete(odRequests).where(eq(odRequests.id, id));

    return res.json({ message: 'OD request cancelled successfully.' });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to delete OD request.' });
  }
});

// GET /api/od/export/csv (Admin + Advisor: Export OD requests with optional filters)
router.get('/export/csv', verifyToken, requireViewer, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, startDate, endDate, teamId } = req.query;

    const [allODs, allUsers, allTeams] = await Promise.all([
      db.select().from(odRequests).orderBy(desc(odRequests.createdAt)),
      db.select().from(users),
      db.select().from(teams),
    ]);

    const userMap = new Map(allUsers.map((u) => [u.id, u]));
    const teamMap = new Map(allTeams.map((t) => [t.id, t]));

    let filtered = allODs;

    // Filter by Status
    if (status && typeof status === 'string' && status !== 'all') {
      filtered = filtered.filter((od) => od.status === status);
    }

    // Filter by Date (od.date or createdAt)
    if (startDate && typeof startDate === 'string') {
      filtered = filtered.filter((od) => od.date >= startDate);
    }

    if (endDate && typeof endDate === 'string') {
      filtered = filtered.filter((od) => od.date <= endDate);
    }

    // Filter by Member Team
    if (teamId && typeof teamId === 'string' && teamId !== 'all') {
      filtered = filtered.filter((od) => {
        const u = userMap.get(od.userId);
        return u && u.teamId === teamId;
      });
    }

    const exportRows = filtered.map((od) => {
      const u = userMap.get(od.userId);
      const reviewer = od.reviewedById ? userMap.get(od.reviewedById) : null;
      const userTeam = u?.teamId ? teamMap.get(u.teamId) : null;

      let lectureItems: LectureItem[] = [];
      try {
        lectureItems = JSON.parse(od.lectures || '[]');
      } catch {
        lectureItems = [];
      }

      const lecturesSummary = lectureItems
        .map((l, idx) => `[P${idx + 1}: ${l.timeSlot}] ${l.subjectName} (${l.subjectCode}) - ${l.facultyName}`)
        .join('; ');

      const createdDate = od.createdAt instanceof Date ? od.createdAt : new Date(od.createdAt);
      const reviewedDate = od.reviewedAt ? (od.reviewedAt instanceof Date ? od.reviewedAt : new Date(od.reviewedAt)) : null;

      return {
        id: od.id,
        userName: u?.name || 'Unknown',
        rollNumber: u?.rollNumber || 'N/A',
        email: u?.email || 'N/A',
        teamName: userTeam?.name || 'Unassigned',
        academicYear: u?.rollNumber ? getAcademicYear(u.rollNumber) : 'N/A',
        odDate: od.date,
        reason: od.reason,
        lecturesCount: lectureItems.length,
        lecturesSummary: lecturesSummary || 'No lectures listed',
        status: od.status.toUpperCase(),
        adminNotes: od.adminNotes || '',
        reviewedBy: reviewer?.name || (od.status === 'pending' ? 'Pending Review' : 'System / Advisor'),
        reviewedAtFormatted: reviewedDate ? reviewedDate.toLocaleString('en-IN') : 'N/A',
        createdAtFormatted: createdDate.toLocaleString('en-IN'),
      };
    });

    const columns: CsvColumn[] = [
      { key: 'id', label: 'OD Request ID' },
      { key: 'userName', label: 'Member Name' },
      { key: 'rollNumber', label: 'Roll Number' },
      { key: 'email', label: 'Email' },
      { key: 'teamName', label: 'Team / Wing' },
      { key: 'academicYear', label: 'Academic Year' },
      { key: 'odDate', label: 'OD Date' },
      { key: 'reason', label: 'Reason / Event' },
      { key: 'lecturesCount', label: 'Total Periods' },
      { key: 'lecturesSummary', label: 'Lectures Details' },
      { key: 'status', label: 'Status' },
      { key: 'adminNotes', label: 'Admin Remarks' },
      { key: 'reviewedBy', label: 'Reviewed By' },
      { key: 'reviewedAtFormatted', label: 'Reviewed At (IST)' },
      { key: 'createdAtFormatted', label: 'Submitted At (IST)' },
    ];

    const csvData = generateCsv(columns, exportRows);
    const dateStamp = new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="dcc_od_requests_${dateStamp}.csv"`);
    return res.status(200).send(csvData);
  } catch (error: any) {
    console.error('Failed to export OD requests CSV:', error);
    return res.status(500).json({ error: 'Failed to generate OD CSV.', message: error.message });
  }
});

export default router;
