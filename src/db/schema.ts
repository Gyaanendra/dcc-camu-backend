import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// Teams Table
export const teams = sqliteTable('teams', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull().unique(),
  code: text('code').notNull().unique(),
  description: text('description'),
  color: text('color').default('#3b82f6'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Users Table (Admins, Advisors & Members)
// role: 'admin' = full access, 'advisor' = read-only view access, 'user' = member self-service
export const users = sqliteTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  password: text('password').notNull(), // Plain text password column
  rollNumber: text('roll_number').notNull().unique(),
  position: text('position').default('Member').notNull(),
  role: text('role').$type<'admin' | 'advisor' | 'user'>().default('user').notNull(),
  teamId: text('team_id').references(() => teams.id, { onDelete: 'set null' }),
  avatarUrl: text('avatar_url'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Attendance Sessions Table
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text('title').notNull(),
  type: text('type').$type<'regular' | 'workshop' | 'hackathon' | 'standup'>().default('regular').notNull(),
  description: text('description'),
  teamId: text('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  targetAudience: text('target_audience').$type<'all' | 'heads_only' | 'teams_only'>().default('all').notNull(),
  targetTeamIds: text('target_team_ids'),
  targetYears: text('target_years'),
  qrCodeToken: text('qr_code_token').notNull(),
  location: text('location').default('DCC Hub / Auditorium'),
  createdById: text('created_by_id').references(() => users.id, { onDelete: 'cascade' }),
  startTime: integer('start_time', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  endTime: integer('end_time', { mode: 'timestamp_ms' }).notNull(),
  isActive: text('is_active').default('true').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Attendance Records Table
export const attendance = sqliteTable('attendance', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  status: text('status').$type<'present' | 'late' | 'not_in_club'>().default('present').notNull(),
  scanMethod: text('scan_method').$type<'user_scanner' | 'admin_scanner' | 'manual'>().default('user_scanner').notNull(),
  scannedAt: integer('scanned_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  metadata: text('metadata'),
});

// On Duty (OD) Requests Table
export const odRequests = sqliteTable('od_requests', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  date: text('date').notNull(), // YYYY-MM-DD
  reason: text('reason').notNull(),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  lectures: text('lectures').notNull(), // JSON stringified array of lectures
  status: text('status').$type<'pending' | 'approved' | 'rejected'>().default('pending').notNull(),
  adminNotes: text('admin_notes'),
  reviewedById: text('reviewed_by_id').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ==========================================
// Micro-Team Management & Summit System
// ==========================================

// Events Table (e.g. Global AI Summit 2026)
export const events = sqliteTable('events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text('title').notNull(),
  code: text('code').notNull().unique(),
  description: text('description'),
  startDate: integer('start_date', { mode: 'timestamp_ms' }),
  endDate: integer('end_date', { mode: 'timestamp_ms' }),
  status: text('status').$type<'draft' | 'active' | 'completed'>().default('active').notNull(),
  createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Event Sessions Table (Summit specific time slots & sessions)
export const eventSessions = sqliteTable('event_sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  eventId: text('event_id').references(() => events.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  location: text('location').default('Auditorium / Main Hall'),
  startTime: integer('start_time', { mode: 'timestamp_ms' }).notNull(),
  endTime: integer('end_time', { mode: 'timestamp_ms' }).notNull(),
  isActive: text('is_active').default('true').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Micro Teams Table (~5 member teams or Dignitary Coordination Team)
export const microTeams = sqliteTable('micro_teams', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  eventId: text('event_id').references(() => events.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  leaderId: text('leader_id').references(() => users.id, { onDelete: 'set null' }),
  isLeadershipManaged: integer('is_leadership_managed').default(0).notNull(), // 1 for Dignitary Coordination Team (Admin managed)
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Micro Team Members Table (Assigning members & volunteers to teams)
export const microTeamMembers = sqliteTable('micro_team_members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  microTeamId: text('micro_team_id').references(() => microTeams.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  roleInTeam: text('role_in_team').$type<'leader' | 'member' | 'volunteer'>().default('member').notNull(),
  assignedAt: integer('assigned_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Micro Team Sessions Mapping Table (Which sessions a team is deployed to)
export const microTeamSessions = sqliteTable('micro_team_sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  microTeamId: text('micro_team_id').references(() => microTeams.id, { onDelete: 'cascade' }).notNull(),
  sessionId: text('session_id').references(() => eventSessions.id, { onDelete: 'cascade' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Micro Attendance Records Table (Strict audit trail & attendance log)
export const microAttendance = sqliteTable('micro_attendance', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text('session_id').references(() => eventSessions.id, { onDelete: 'cascade' }).notNull(),
  microTeamId: text('micro_team_id').references(() => microTeams.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  status: text('status').$type<'present' | 'late' | 'absent' | 'excused'>().default('present').notNull(),
  markedById: text('marked_by_id').references(() => users.id, { onDelete: 'set null' }).notNull(),
  markedAt: integer('marked_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  notes: text('notes'),
  updatedById: text('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
});

// Relations Definitions
export const teamsRelations = relations(teams, ({ many }) => ({
  members: many(users),
  sessions: many(sessions),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  team: one(teams, {
    fields: [users.teamId],
    references: [teams.id],
  }),
  attendanceRecords: many(attendance),
  createdSessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  team: one(teams, {
    fields: [sessions.teamId],
    references: [teams.id],
  }),
  createdBy: one(users, {
    fields: [sessions.createdById],
    references: [users.id],
  }),
  attendanceRecords: many(attendance),
}));

export const attendanceRelations = relations(attendance, ({ one }) => ({
  session: one(sessions, {
    fields: [attendance.sessionId],
    references: [sessions.id],
  }),
  user: one(users, {
    fields: [attendance.userId],
    references: [users.id],
  }),
}));

export const odRequestsRelations = relations(odRequests, ({ one }) => ({
  user: one(users, {
    fields: [odRequests.userId],
    references: [users.id],
  }),
  session: one(sessions, {
    fields: [odRequests.sessionId],
    references: [sessions.id],
  }),
  reviewedBy: one(users, {
    fields: [odRequests.reviewedById],
    references: [users.id],
  }),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [events.createdById],
    references: [users.id],
  }),
  sessions: many(eventSessions),
  teams: many(microTeams),
}));

export const eventSessionsRelations = relations(eventSessions, ({ one, many }) => ({
  event: one(events, {
    fields: [eventSessions.eventId],
    references: [events.id],
  }),
  teamSessions: many(microTeamSessions),
  attendanceRecords: many(microAttendance),
}));

export const microTeamsRelations = relations(microTeams, ({ one, many }) => ({
  event: one(events, {
    fields: [microTeams.eventId],
    references: [events.id],
  }),
  leader: one(users, {
    fields: [microTeams.leaderId],
    references: [users.id],
  }),
  members: many(microTeamMembers),
  teamSessions: many(microTeamSessions),
  attendanceRecords: many(microAttendance),
}));

export const microTeamMembersRelations = relations(microTeamMembers, ({ one }) => ({
  team: one(microTeams, {
    fields: [microTeamMembers.microTeamId],
    references: [microTeams.id],
  }),
  user: one(users, {
    fields: [microTeamMembers.userId],
    references: [users.id],
  }),
}));

export const microTeamSessionsRelations = relations(microTeamSessions, ({ one }) => ({
  team: one(microTeams, {
    fields: [microTeamSessions.microTeamId],
    references: [microTeams.id],
  }),
  session: one(eventSessions, {
    fields: [microTeamSessions.sessionId],
    references: [eventSessions.id],
  }),
}));

export const microAttendanceRelations = relations(microAttendance, ({ one }) => ({
  session: one(eventSessions, {
    fields: [microAttendance.sessionId],
    references: [eventSessions.id],
  }),
  team: one(microTeams, {
    fields: [microAttendance.microTeamId],
    references: [microTeams.id],
  }),
  user: one(users, {
    fields: [microAttendance.userId],
    references: [users.id],
  }),
  markedBy: one(users, {
    fields: [microAttendance.markedById],
    references: [users.id],
  }),
  updatedBy: one(users, {
    fields: [microAttendance.updatedById],
    references: [users.id],
  }),
}));
