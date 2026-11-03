import { Router, Response } from 'express';
import { verifyToken, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { sqlite } from '../db';

const router = Router();

// Whitelist of tables accessible by admin explorer
const ALLOWED_TABLES = ['teams', 'users', 'sessions', 'attendance', 'od_requests'] as const;
type AllowedTable = (typeof ALLOWED_TABLES)[number];

const TIMESTAMP_COLUMNS = ['created_at', 'start_time', 'end_time', 'scanned_at', 'reviewed_at'];

function isAllowedTable(table: string): table is AllowedTable {
  return ALLOWED_TABLES.includes(table as AllowedTable);
}

// 1. List all tables, row counts, and column schemas
router.get('/tables', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tableSummaries = ALLOWED_TABLES.map((table) => {
      const countRow = sqlite.prepare(`SELECT count(*) as count FROM "${table}"`).get() as { count: number };
      const columns = sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: any;
        pk: number;
      }>;

      return {
        name: table,
        rowCount: countRow ? countRow.count : 0,
        columns: columns.map((c) => ({
          name: c.name,
          type: c.type,
          isNullable: c.notnull === 0,
          defaultValue: c.dflt_value,
          isPrimaryKey: c.pk === 1,
          isTimestamp: TIMESTAMP_COLUMNS.includes(c.name),
        })),
      };
    });

    res.json({
      success: true,
      tables: tableSummaries,
    });
  } catch (error: any) {
    console.error('Failed to fetch table schema:', error);
    res.status(500).json({ error: 'Failed to fetch table schema', message: error.message });
  }
});

// 2. Fetch paginated, searchable rows for a specific table
router.get('/tables/:table', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { table } = req.params;
    if (!isAllowedTable(table)) {
      return res.status(400).json({ error: `Invalid table '${table}'. Allowed tables: ${ALLOWED_TABLES.join(', ')}` });
    }

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string, 10) || 25));
    const offset = (page - 1) * limit;
    const search = ((req.query.search as string) || '').trim();
    const sort = (req.query.sort as string) || 'created_at';
    const order = ((req.query.order as string) || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // Verify columns from PRAGMA
    const columns = sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
      name: string;
      type: string;
      pk: number;
    }>;
    const columnNames = columns.map((c) => c.name);

    // Validate sort column
    const safeSort = columnNames.includes(sort) ? sort : columnNames[0];

    // Build search WHERE clause if search string provided
    let whereClause = '';
    const searchParams: any[] = [];

    if (search) {
      // Filter only TEXT columns for LIKE search
      const textColumns = columns.filter((c) => c.type.toUpperCase().includes('TEXT') || c.type.toUpperCase().includes('CHAR'));
      if (textColumns.length > 0) {
        const clauses = textColumns.map((c) => `"${c.name}" LIKE ?`);
        whereClause = `WHERE ${clauses.join(' OR ')}`;
        textColumns.forEach(() => searchParams.push(`%${search}%`));
      }
    }

    // Total matching records count
    const countSql = `SELECT count(*) as total FROM "${table}" ${whereClause}`;
    const totalRow = sqlite.prepare(countSql).get(...searchParams) as { total: number };
    const total = totalRow ? totalRow.total : 0;

    // Fetch paginated data
    const dataSql = `SELECT * FROM "${table}" ${whereClause} ORDER BY "${safeSort}" ${order} LIMIT ? OFFSET ?`;
    const rows = sqlite.prepare(dataSql).all(...searchParams, limit, offset) as Array<Record<string, any>>;

    // Enrich timestamp columns with ISO strings for convenient frontend display
    const enrichedRows = rows.map((row) => {
      const copy: Record<string, any> = { ...row };
      for (const col of columnNames) {
        if (TIMESTAMP_COLUMNS.includes(col) && typeof copy[col] === 'number') {
          copy[`_${col}_iso`] = new Date(copy[col]).toISOString();
        }
      }
      return copy;
    });

    res.json({
      success: true,
      table,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      rows: enrichedRows,
    });
  } catch (error: any) {
    console.error(`Error querying table ${req.params.table}:`, error);
    res.status(500).json({ error: 'Failed to query table rows', message: error.message });
  }
});

// 3. Update any row in a table by primary key ID
router.patch('/tables/:table/:id', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { table, id } = req.params;
    if (!isAllowedTable(table)) {
      return res.status(400).json({ error: `Invalid table '${table}'. Allowed: ${ALLOWED_TABLES.join(', ')}` });
    }

    // Verify row exists
    const existing = sqlite.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id) as Record<string, any> | undefined;
    if (!existing) {
      return res.status(404).json({ error: `Record with id '${id}' not found in table '${table}'.` });
    }

    const updates = req.body;
    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No update payload provided.' });
    }

    // Get valid columns
    const columns = sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
      name: string;
      type: string;
      pk: number;
    }>;
    const validCols = new Set(columns.map((c) => c.name));

    const setClauses: string[] = [];
    const setValues: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
      // Skip primary key id and helper fields starting with '_'
      if (key === 'id' || key.startsWith('_')) continue;

      if (!validCols.has(key)) {
        return res.status(400).json({ error: `Column '${key}' does not exist in table '${table}'.` });
      }

      setClauses.push(`"${key}" = ?`);

      // Convert date/ISO string values to timestamp_ms if column is a timestamp
      if (TIMESTAMP_COLUMNS.includes(key) && value !== null && value !== undefined) {
        if (typeof value === 'string' || value instanceof Date) {
          const parsed = new Date(value).getTime();
          setValues.push(isNaN(parsed) ? null : parsed);
        } else {
          setValues.push(value);
        }
      } else {
        setValues.push(value);
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No valid columns provided to update.' });
    }

    const updateSql = `UPDATE "${table}" SET ${setClauses.join(', ')} WHERE id = ?`;
    sqlite.prepare(updateSql).run(...setValues, id);

    // Fetch updated row
    const updatedRow = sqlite.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id);

    console.log(`[Admin DB Explorer] Admin ${req.user?.name} (${req.user?.email}) updated row ${id} in ${table}`);

    res.json({
      success: true,
      message: `Row ${id} updated successfully in ${table}.`,
      row: updatedRow,
    });
  } catch (error: any) {
    console.error(`Failed to update row in ${req.params.table}:`, error);
    res.status(500).json({ error: 'Failed to update row', message: error.message });
  }
});

// 4. Delete any row from a table by primary key ID
router.delete('/tables/:table/:id', verifyToken, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { table, id } = req.params;
    if (!isAllowedTable(table)) {
      return res.status(400).json({ error: `Invalid table '${table}'. Allowed: ${ALLOWED_TABLES.join(', ')}` });
    }

    // Verify row exists
    const existing = sqlite.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id);
    if (!existing) {
      return res.status(404).json({ error: `Record with id '${id}' not found in table '${table}'.` });
    }

    // Safety check: Don't allow admin to delete their own user account via this endpoint
    if (table === 'users' && id === req.user?.id) {
      return res.status(400).json({ error: 'You cannot delete your own admin account.' });
    }

    sqlite.prepare(`DELETE FROM "${table}" WHERE id = ?`).run(id);

    console.log(`[Admin DB Explorer] Admin ${req.user?.name} (${req.user?.email}) deleted row ${id} from ${table}`);

    res.json({
      success: true,
      message: `Row with id '${id}' was permanently deleted from '${table}'.`,
      deletedId: id,
    });
  } catch (error: any) {
    console.error(`Failed to delete row from ${req.params.table}:`, error);
    // Handle foreign key constraint failure
    if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return res.status(409).json({
        error: 'Cannot delete record: other records reference this item.',
        message: 'Please delete or unlink referencing records first.',
      });
    }
    res.status(500).json({ error: 'Failed to delete row', message: error.message });
  }
});

export default router;

