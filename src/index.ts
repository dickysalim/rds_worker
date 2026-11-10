import bcrypt from 'bcryptjs'
import { getBearerToken, signSession, verifySession } from './auth'

export interface Env {
  DB: D1Database
  DB_STAGING: D1Database
  USER_DB: D1Database
  JWT_SECRET: string
  ASSETS: R2Bucket
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Db-Target',
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      ...init.headers,
    },
  })
}

// created_by/updated_by columns store the user's UUID, not a displayable
// name -- USER_DB is a separate D1 database (no cross-DB SQL join), so
// hydration is a second query + in-memory map, applied per response.
async function hydrateUserNames<T extends object>(env: Env, rows: T[], fields: (keyof T)[]): Promise<T[]> {
  const ids = new Set<string>()
  for (const row of rows) {
    for (const field of fields) {
      const value = row[field]
      if (typeof value === 'string') ids.add(value)
    }
  }
  if (ids.size === 0) return rows

  const idList = [...ids]
  const placeholders = idList.map(() => '?').join(',')
  const { results } = await env.USER_DB.prepare(
    `SELECT user_id, name FROM user WHERE user_id IN (${placeholders})`,
  )
    .bind(...idList)
    .all<{ user_id: string; name: string }>()
  const nameById = new Map(results.map((u) => [u.user_id, u.name]))

  return rows.map((row) => {
    const hydrated = { ...row }
    for (const field of fields) {
      const value = row[field]
      if (typeof value === 'string') {
        hydrated[field] = (nameById.get(value) ?? value) as T[keyof T]
      }
    }
    return hydrated
  })
}

interface UserRow {
  user_id: string
  username: string
  name: string
  password_hash: string
  role: string
  is_active: number
  must_change_password: number
}

function userToSession(user: Pick<UserRow, 'user_id' | 'username' | 'name' | 'role' | 'must_change_password'>) {
  return {
    sub: user.user_id,
    username: user.username,
    name: user.name,
    role: user.role,
    must_change_password: !!user.must_change_password,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  }
}

function userToResponse(user: Pick<UserRow, 'user_id' | 'username' | 'name' | 'role' | 'must_change_password'>) {
  return {
    id: user.user_id,
    username: user.username,
    name: user.name,
    role: user.role,
    must_change_password: !!user.must_change_password,
  }
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ username?: string; password?: string }>().catch(() => null)
  if (!body?.username || !body.password) {
    return json({ error: 'username and password are required' }, { status: 400 })
  }

  const user = await env.USER_DB.prepare(
    'SELECT user_id, username, name, password_hash, role, is_active, must_change_password FROM user WHERE username = ?',
  )
    .bind(body.username)
    .first<UserRow>()

  if (!user || !user.is_active) {
    return json({ error: 'Invalid username or password' }, { status: 401 })
  }

  const valid = await bcrypt.compare(body.password, user.password_hash)
  if (!valid) {
    return json({ error: 'Invalid username or password' }, { status: 401 })
  }

  const token = await signSession(userToSession(user), env.JWT_SECRET)

  return json({ token, user: userToResponse(user) })
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const token = getBearerToken(request)
  if (!token) return json({ error: 'Missing token' }, { status: 401 })

  const session = await verifySession(token, env.JWT_SECRET)
  if (!session) return json({ error: 'Invalid or expired token' }, { status: 401 })

  return json({
    user: {
      id: session.sub,
      username: session.username,
      name: session.name,
      role: session.role,
      must_change_password: session.must_change_password,
    },
  })
}

async function handleUpdateAccount(request: Request, env: Env): Promise<Response> {
  const token = getBearerToken(request)
  if (!token) return json({ error: 'Missing token' }, { status: 401 })
  const session = await verifySession(token, env.JWT_SECRET)
  if (!session) return json({ error: 'Invalid or expired token' }, { status: 401 })

  const body = await request.json<{ name?: string }>().catch(() => null)
  if (!body?.name?.trim()) return json({ error: 'name is required' }, { status: 400 })

  const user = await env.USER_DB.prepare(
    'UPDATE user SET name = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? RETURNING user_id, username, name, role, must_change_password',
  )
    .bind(body.name.trim(), session.sub, session.sub)
    .first<Pick<UserRow, 'user_id' | 'username' | 'name' | 'role' | 'must_change_password'>>()
  if (!user) return json({ error: 'User not found' }, { status: 404 })

  const newToken = await signSession(userToSession(user), env.JWT_SECRET)
  return json({ token: newToken, user: userToResponse(user) })
}

async function handleUpdatePassword(request: Request, env: Env): Promise<Response> {
  const token = getBearerToken(request)
  if (!token) return json({ error: 'Missing token' }, { status: 401 })
  const session = await verifySession(token, env.JWT_SECRET)
  if (!session) return json({ error: 'Invalid or expired token' }, { status: 401 })

  const body = await request.json<{ current_password?: string; new_password?: string }>().catch(() => null)
  if (!body?.current_password || !body.new_password) {
    return json({ error: 'current_password and new_password are required' }, { status: 400 })
  }
  if (body.new_password.length < 8) {
    return json({ error: 'New password must be at least 8 characters' }, { status: 400 })
  }

  const existing = await env.USER_DB.prepare('SELECT user_id, password_hash FROM user WHERE user_id = ?')
    .bind(session.sub)
    .first<{ user_id: string; password_hash: string }>()
  if (!existing) return json({ error: 'User not found' }, { status: 404 })

  const valid = await bcrypt.compare(body.current_password, existing.password_hash)
  if (!valid) return json({ error: 'Current password is incorrect' }, { status: 401 })

  const newHash = await bcrypt.hash(body.new_password, 10)
  const user = await env.USER_DB.prepare(
    'UPDATE user SET password_hash = ?, must_change_password = 0, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? RETURNING user_id, username, name, role, must_change_password',
  )
    .bind(newHash, existing.user_id, existing.user_id)
    .first<Pick<UserRow, 'user_id' | 'username' | 'name' | 'role' | 'must_change_password'>>()
  if (!user) return json({ error: 'User not found' }, { status: 404 })

  const newToken = await signSession(userToSession(user), env.JWT_SECRET)
  return json({ token: newToken, user: userToResponse(user) })
}

const ASSIGNABLE_ROLES = ['admin', 'owner']

function generateNumericPassword(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => b % 10).join('')
}

async function handleListUsers(request: Request, env: Env): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return json({ error: 'Forbidden' }, { status: 403 })

  const { results } = await env.USER_DB.prepare(
    "SELECT user_id, username, name, role FROM user WHERE role NOT IN ('super_admin', 'staging_admin') AND is_active = 1 ORDER BY username",
  ).all<Pick<UserRow, 'user_id' | 'username' | 'name' | 'role'>>()

  return json({ users: results })
}

async function handleCreateUser(request: Request, env: Env): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json<{ username?: string; name?: string; role?: string }>().catch(() => null)
  if (!body?.username?.trim() || !body.name?.trim() || !body.role) {
    return json({ error: 'username, name, and role are required' }, { status: 400 })
  }
  if (!ASSIGNABLE_ROLES.includes(body.role)) {
    return json({ error: 'Invalid role' }, { status: 400 })
  }

  const password = generateNumericPassword()
  const passwordHash = await bcrypt.hash(password, 10)
  const userId = crypto.randomUUID()

  let user: Pick<UserRow, 'user_id' | 'username' | 'name' | 'role'> | null
  try {
    user = await env.USER_DB.prepare(
      `INSERT INTO user (user_id, username, name, password_hash, role, is_active, must_change_password, created_by, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, CURRENT_TIMESTAMP)
       RETURNING user_id, username, name, role`,
    )
      .bind(userId, body.username.trim(), body.name.trim(), passwordHash, body.role, session.sub, session.sub)
      .first<Pick<UserRow, 'user_id' | 'username' | 'name' | 'role'>>()
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return json({ error: 'A user with this username already exists' }, { status: 409 })
    }
    throw err
  }

  return json({ user, temporary_password: password }, { status: 201 })
}

// Shared by edit/reset-password/deactivate -- all three only ever act on a
// non-super_admin user, even if the frontend already filters the list.
async function requireManageableUser(env: Env, userId: string): Promise<UserRow | null> {
  const user = await env.USER_DB.prepare(
    'SELECT user_id, username, name, password_hash, role, is_active, must_change_password FROM user WHERE user_id = ?',
  )
    .bind(userId)
    .first<UserRow>()
  if (!user || user.role === 'super_admin' || user.role === 'staging_admin') return null
  return user
}

async function handleUpdateUserRole(request: Request, env: Env, userId: string): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json<{ role?: string }>().catch(() => null)
  if (!body?.role || !ASSIGNABLE_ROLES.includes(body.role)) {
    return json({ error: 'Invalid role' }, { status: 400 })
  }

  const existing = await requireManageableUser(env, userId)
  if (!existing) return json({ error: 'User not found' }, { status: 404 })

  const user = await env.USER_DB.prepare(
    'UPDATE user SET role = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? RETURNING user_id, username, name, role',
  )
    .bind(body.role, session.sub, userId)
    .first<Pick<UserRow, 'user_id' | 'username' | 'name' | 'role'>>()

  return json({ user })
}

async function handleResetUserPassword(request: Request, env: Env, userId: string): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return json({ error: 'Forbidden' }, { status: 403 })

  const existing = await requireManageableUser(env, userId)
  if (!existing) return json({ error: 'User not found' }, { status: 404 })

  const password = generateNumericPassword()
  const passwordHash = await bcrypt.hash(password, 10)
  await env.USER_DB.prepare(
    'UPDATE user SET password_hash = ?, must_change_password = 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
  )
    .bind(passwordHash, session.sub, userId)
    .run()

  return json({ temporary_password: password })
}

async function handleDeactivateUser(request: Request, env: Env, userId: string): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return json({ error: 'Forbidden' }, { status: 403 })

  const existing = await requireManageableUser(env, userId)
  if (!existing) return json({ error: 'User not found' }, { status: 404 })

  await env.USER_DB.prepare(
    'UPDATE user SET is_active = 0, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
  )
    .bind(session.sub, userId)
    .run()

  return json({ success: true })
}

async function requireAuth(request: Request, env: Env) {
  const token = getBearerToken(request)
  if (!token) return null
  return verifySession(token, env.JWT_SECRET)
}

interface ProductRow {
  sku_id: number
  sku_name: string
  unit: string
  suggested_price: number | null
  cost_price: number | null
  updated_by: string | null
  updated_at: string
}

const PRODUCT_COLUMNS = 'sku_id, sku_name, unit, suggested_price, cost_price, updated_by, updated_at'

// total_revenue is a correlated subquery, not a plain column, so it's kept out of
// PRODUCT_COLUMNS (which is reused for INSERT/UPDATE ... RETURNING elsewhere).
async function handleListProducts(request: Request, env: Env): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const limitParam = new URL(request.url).searchParams.get('limit')
  const limit = limitParam ? Math.max(1, Math.min(500, Number(limitParam) || 0)) : null

  const base = `SELECT ${PRODUCT_COLUMNS},
      (SELECT COALESCE(SUM(ni.total_price), 0) FROM nota_item ni
       JOIN nota n ON n.nota_id = ni.nota_id
       WHERE ni.sku_id = product.sku_id AND n.is_void = 0) AS total_revenue,
      (SELECT COALESCE(SUM(ni.cost_price_snapshot * ni.qty), 0) FROM nota_item ni
       JOIN nota n ON n.nota_id = ni.nota_id
       WHERE ni.sku_id = product.sku_id AND n.is_void = 0) AS total_cost,
      (
        (SELECT COALESCE(SUM(sl.qty), 0) FROM stock_ledger sl WHERE sl.sku_id = product.sku_id AND sl.is_active = 1)
        -
        (SELECT COALESCE(SUM(ni.qty), 0) FROM nota_item ni
         JOIN nota n ON n.nota_id = ni.nota_id
         WHERE ni.sku_id = product.sku_id AND n.is_void = 0)
      ) AS current_stock
     FROM product WHERE is_active = 1`
  const stmt = limit
    ? env.DB.prepare(`${base} ORDER BY sku_id DESC LIMIT ?`).bind(limit)
    : env.DB.prepare(`${base} ORDER BY sku_id ASC`)
  const { results } = await stmt.all<
    ProductRow & { total_revenue: number; total_cost: number; current_stock: number | null }
  >()

  return json({ products: results })
}

const MOVEMENT_TYPES = [
  'production_in',
  'shipment_return',
  'adjust_up',
  'stock_loss',
  'stock_out',
  'stock_defect',
  'adjust_down',
  'initial_stock',
]
const MOVEMENT_MINUS_TYPES = ['stock_loss', 'stock_out', 'stock_defect', 'adjust_down']

interface StockLedgerRow {
  kind: 'ledger' | 'sale'
  id: number
  sku_id: number
  item_name: string
  date: string
  movement_type: string
  qty: number
  note: string | null
  created_by: string | null
  created_at: string
  updated_by: string | null
  updated_at: string | null
  invoice_number: string | null
}

// A sale never writes to stock_ledger -- current_stock is computed live as
// SUM(stock_ledger.qty) - SUM(nota_item.qty) (see handleListProducts), so
// a sale is unioned in here from nota_item for display only, not stored, and
// is never editable/deletable. A soft-deleted ledger row (is_active = 0) is
// excluded here -- it still exists in the table for the audit trail
// (updated_by/updated_at record who deleted it) but never shown again.
async function handleListStockLedger(request: Request, env: Env): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const limitParam = new URL(request.url).searchParams.get('limit')
  const limit = limitParam ? Math.max(1, Math.min(2000, Number(limitParam) || 0)) : null

  const base = `SELECT 'ledger' AS kind, sl.id, sl.sku_id,
      (SELECT sku_name FROM product WHERE sku_id = sl.sku_id AND is_active = 1) AS item_name,
      sl.date, sl.movement_type, sl.qty, sl.note, sl.created_by, sl.created_at,
      sl.updated_by, sl.updated_at,
      NULL AS invoice_number
     FROM stock_ledger sl
     WHERE sl.is_active = 1
     UNION ALL
     SELECT 'sale' AS kind, ni.nota_item_id AS id, ni.sku_id,
      (SELECT sku_name FROM product WHERE sku_id = ni.sku_id AND is_active = 1) AS item_name,
      n.nota_date AS date, 'sale' AS movement_type, -ni.qty AS qty,
      ('Penjualan ke ' || n.customer_company_name_snapshot || ' - No. Invoce: ' || n.nota_number) AS note,
      n.created_by,
      n.created_at, NULL AS updated_by, NULL AS updated_at, n.nota_number AS invoice_number
     FROM nota_item ni
     JOIN nota n ON n.nota_id = ni.nota_id
     WHERE n.is_void = 0`
  const stmt = limit
    ? env.DB.prepare(`${base} ORDER BY date DESC, created_at DESC LIMIT ?`).bind(limit)
    : env.DB.prepare(`${base} ORDER BY date DESC, created_at DESC`)
  const { results } = await stmt.all<StockLedgerRow>()
  const entries = await hydrateUserNames(env, results, ['created_by', 'updated_by'])

  return json({ entries })
}

async function handleCreateStockMovement(request: Request, env: Env): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request
    .json<{
      sku_id?: number
      date?: string
      movement_type?: string
      qty?: number
      note?: string | null
    }>()
    .catch(() => null)

  if (!body?.sku_id || !body.date || !body.movement_type || body.qty == null) {
    return json({ error: 'sku_id, date, movement_type, and qty are required' }, { status: 400 })
  }
  if (!MOVEMENT_TYPES.includes(body.movement_type)) {
    return json({ error: 'Invalid movement_type' }, { status: 400 })
  }
  const magnitude = Math.abs(Number(body.qty))
  if (!magnitude) {
    return json({ error: 'qty must be non-zero' }, { status: 400 })
  }
  // Every movement_type carries a fixed sign (table CHECK enforces it); the
  // caller sends an unsigned magnitude, so sign it here.
  const signedQty = MOVEMENT_MINUS_TYPES.includes(body.movement_type) ? -magnitude : magnitude

  const entry = await env.DB.prepare(
    `INSERT INTO stock_ledger (sku_id, date, movement_type, qty, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING id, sku_id, date, movement_type, qty, note, created_by, created_at, updated_by, updated_at`,
  )
    .bind(body.sku_id, body.date, body.movement_type, signedQty, body.note || null, session.sub)
    .first<Omit<StockLedgerRow, 'item_name'>>()

  return json({ entry }, { status: 201 })
}

async function handleUpdateStockMovement(request: Request, env: Env, id: number): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request
    .json<{ date?: string; movement_type?: string; qty?: number; note?: string | null }>()
    .catch(() => null)

  if (!body?.date || !body.movement_type || body.qty == null) {
    return json({ error: 'date, movement_type, and qty are required' }, { status: 400 })
  }
  if (!MOVEMENT_TYPES.includes(body.movement_type)) {
    return json({ error: 'Invalid movement_type' }, { status: 400 })
  }
  const magnitude = Math.abs(Number(body.qty))
  if (!magnitude) {
    return json({ error: 'qty must be non-zero' }, { status: 400 })
  }
  const signedQty = MOVEMENT_MINUS_TYPES.includes(body.movement_type) ? -magnitude : magnitude

  const entry = await env.DB.prepare(
    `UPDATE stock_ledger
     SET date = ?, movement_type = ?, qty = ?, note = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND is_active = 1
     RETURNING id, sku_id, date, movement_type, qty, note, created_by, created_at, updated_by, updated_at`,
  )
    .bind(body.date, body.movement_type, signedQty, body.note || null, session.sub, id)
    .first<Omit<StockLedgerRow, 'item_name'>>()

  if (!entry) return json({ error: 'Stock ledger entry not found' }, { status: 404 })
  return json({ entry })
}

// Soft delete only -- is_active flips to 0, row stays for the audit trail
// (updated_by records who deleted it). Never a real DELETE.
async function handleDeleteStockMovement(request: Request, env: Env, id: number): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })

  const entry = await env.DB.prepare(
    `UPDATE stock_ledger
     SET is_active = 0, updated_by = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND is_active = 1
     RETURNING id`,
  )
    .bind(session.sub, id)
    .first()

  if (!entry) return json({ error: 'Stock ledger entry not found' }, { status: 404 })
  return json({ success: true })
}

interface CustomerRow {
  customer_id: number
  company_name: string
  address: string | null
  contact_person: string | null
  phone_number: string | null
  updated_by: string | null
  updated_at: string
}

const CUSTOMER_COLUMNS =
  'customer_id, company_name, address, contact_person, phone_number, updated_by, updated_at'

async function handleListCustomers(request: Request, env: Env): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const limitParam = new URL(request.url).searchParams.get('limit')
  const limit = limitParam ? Math.max(1, Math.min(500, Number(limitParam) || 0)) : null

  const base = `SELECT ${CUSTOMER_COLUMNS},
      (SELECT COALESCE(SUM(n.total_price), 0) FROM nota n
       WHERE n.customer_id = customer.customer_id AND n.is_void = 0) AS total_revenue,
      (SELECT COALESCE(SUM(ni.cost_price_snapshot * ni.qty), 0) FROM nota_item ni
       JOIN nota n ON n.nota_id = ni.nota_id
       WHERE n.customer_id = customer.customer_id AND n.is_void = 0) AS total_cost
     FROM customer WHERE is_active = 1`
  const stmt = limit
    ? env.DB.prepare(`${base} ORDER BY customer_id DESC LIMIT ?`).bind(limit)
    : env.DB.prepare(`${base} ORDER BY customer_id ASC`)
  const { results } = await stmt.all<CustomerRow & { total_revenue: number; total_cost: number }>()

  return json({ customers: results })
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message)
}

async function handleCreateCustomer(request: Request, env: Env): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request
    .json<{
      company_name?: string
      address?: string | null
      contact_person?: string
      phone_number?: string
    }>()
    .catch(() => null)
  if (!body?.company_name) {
    return json({ error: 'company_name is required' }, { status: 400 })
  }

  let customer: CustomerRow | null
  try {
    // RETURNING reads back the just-written row instead of a follow-up SELECT,
    // which can race against D1's read replicas and see a stale (missing) row.
    customer = await env.DB.prepare(
      `INSERT INTO customer (customer_id, company_name, address, contact_person, phone_number, updated_by, updated_at, is_active)
       SELECT COALESCE(MAX(customer_id), 0) + 1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1 FROM customer
       RETURNING ${CUSTOMER_COLUMNS}`,
    )
      .bind(
        body.company_name,
        body.address ?? null,
        body.contact_person || null,
        body.phone_number || null,
        session.sub,
      )
      .first<CustomerRow>()
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return json(
        { error: 'A customer with this company name or phone number already exists' },
        { status: 409 },
      )
    }
    throw err
  }

  return json({ customer }, { status: 201 })
}

async function handleUpdateCustomer(
  request: Request,
  env: Env,
  customerId: number,
): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request
    .json<{
      company_name?: string
      address?: string | null
      contact_person?: string
      phone_number?: string
    }>()
    .catch(() => null)
  if (!body?.company_name) {
    return json({ error: 'company_name is required' }, { status: 400 })
  }

  let customer: CustomerRow | null
  try {
    // RETURNING reads back the just-written row instead of a follow-up SELECT,
    // which can race against D1's read replicas and see a stale (missing) row.
    // The customer_history trigger captures this update, so this is a plain
    // in-place UPDATE, not an append.
    customer = await env.DB.prepare(
      `UPDATE customer SET company_name = ?, address = ?, contact_person = ?, phone_number = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE customer_id = ? AND is_active = 1
       RETURNING ${CUSTOMER_COLUMNS}`,
    )
      .bind(
        body.company_name,
        body.address ?? null,
        body.contact_person || null,
        body.phone_number || null,
        session.sub,
        customerId,
      )
      .first<CustomerRow>()
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return json(
        { error: 'A customer with this company name or phone number already exists' },
        { status: 409 },
      )
    }
    throw err
  }

  if (!customer) return json({ error: 'Not found' }, { status: 404 })
  return json({ customer })
}

async function handleGetCustomerHistory(
  request: Request,
  env: Env,
  customerId: number,
): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const { results } = await env.DB.prepare(
    `SELECT history_id AS row_increment, customer_id, company_name, address, contact_person, phone_number,
            changed_by AS updated_by, changed_at AS updated_at, is_active
     FROM customer_history WHERE customer_id = ? ORDER BY history_id DESC`,
  )
    .bind(customerId)
    .all<CustomerRow & { row_increment: number; is_active: number }>()
  const history = await hydrateUserNames(env, results, ['updated_by'])

  return json({ history })
}

async function handleDeleteCustomer(
  request: Request,
  env: Env,
  customerId: number,
): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })

  await env.DB.prepare(
    'UPDATE customer SET is_active = 0, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE customer_id = ? AND is_active = 1',
  )
    .bind(session.sub, customerId)
    .run()

  return json({ ok: true })
}

async function handleCreateProduct(request: Request, env: Env): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request
    .json<{
      sku_name?: string
      unit?: string
      suggested_price?: number | null
      cost_price?: number | null
      initial_stock?: number | null
    }>()
    .catch(() => null)
  if (!body?.sku_name || !body.unit) {
    return json({ error: 'sku_name and unit are required' }, { status: 400 })
  }
  if (body.cost_price != null && body.suggested_price != null && body.cost_price > body.suggested_price) {
    return json({ error: 'Cost cannot exceed the price' }, { status: 400 })
  }

  const initialStock = body.initial_stock ?? 0

  let product: ProductRow | null
  try {
    // RETURNING reads back the just-written row instead of a follow-up SELECT,
    // which can race against D1's read replicas and see a stale (missing) row.
    const insertProduct = env.DB.prepare(
      `INSERT INTO product (sku_id, sku_name, unit, suggested_price, cost_price, updated_by, updated_at, is_active)
       SELECT COALESCE(MAX(sku_id), 0) + 1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1 FROM product
       RETURNING ${PRODUCT_COLUMNS}`,
    ).bind(body.sku_name, body.unit, body.suggested_price ?? null, body.cost_price ?? null, session.sub)

    if (initialStock > 0) {
      const [productResult] = await env.DB.batch<ProductRow>([insertProduct])
      product = productResult.results[0] ?? null
      if (product) {
        await env.DB.prepare(
          `INSERT INTO stock_ledger (sku_id, date, movement_type, qty, note, created_by)
           VALUES (?, date('now'), 'initial_stock', ?, 'Initial stock on product creation', ?)`,
        )
          .bind(product.sku_id, initialStock, session.sub)
          .run()
      }
    } else {
      product = await insertProduct.first<ProductRow>()
    }
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return json({ error: 'A product with this SKU name already exists' }, { status: 409 })
    }
    throw err
  }

  return json({ product }, { status: 201 })
}

async function handleUpdateProduct(
  request: Request,
  env: Env,
  skuId: number,
): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request
    .json<{
      sku_name?: string
      unit?: string
      suggested_price?: number | null
      cost_price?: number | null
    }>()
    .catch(() => null)
  if (!body?.sku_name || !body.unit) {
    return json({ error: 'sku_name and unit are required' }, { status: 400 })
  }
  if (body.cost_price != null && body.suggested_price != null && body.cost_price > body.suggested_price) {
    return json({ error: 'Cost cannot exceed the price' }, { status: 400 })
  }

  let product: ProductRow | null
  try {
    // RETURNING reads back the just-written row instead of a follow-up SELECT,
    // which can race against D1's read replicas and see a stale (missing) row.
    // The product_history trigger captures this update, so this is a plain
    // in-place UPDATE, not an append.
    product = await env.DB.prepare(
      `UPDATE product SET sku_name = ?, unit = ?, suggested_price = ?, cost_price = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE sku_id = ? AND is_active = 1
       RETURNING ${PRODUCT_COLUMNS}`,
    )
      .bind(
        body.sku_name,
        body.unit,
        body.suggested_price ?? null,
        body.cost_price ?? null,
        session.sub,
        skuId,
      )
      .first<ProductRow>()
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return json({ error: 'A product with this SKU name already exists' }, { status: 409 })
    }
    throw err
  }

  if (!product) return json({ error: 'Not found' }, { status: 404 })
  return json({ product })
}

async function handleGetProductHistory(
  request: Request,
  env: Env,
  skuId: number,
): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const { results } = await env.DB.prepare(
    `SELECT history_id AS row_increment, sku_id, sku_name, unit, suggested_price, cost_price,
            changed_by AS updated_by, changed_at AS updated_at, is_active
     FROM product_history WHERE sku_id = ? ORDER BY history_id DESC`,
  )
    .bind(skuId)
    .all<ProductRow & { row_increment: number; is_active: number }>()
  const history = await hydrateUserNames(env, results, ['updated_by'])

  return json({ history })
}

async function handleDeleteProduct(
  request: Request,
  env: Env,
  skuId: number,
): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })

  await env.DB.prepare(
    'UPDATE product SET is_active = 0, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE sku_id = ? AND is_active = 1',
  )
    .bind(session.sub, skuId)
    .run()

  return json({ ok: true })
}

interface BusinessRow {
  business_id: number
  business_name: string
  business_address: string | null
  business_contact_person: string | null
  business_contact_number: string | null
  business_email: string | null
  business_logo_key: string | null
  payment_bank_name: string | null
  payment_account_name: string | null
  payment_account_number: string | null
}

const BUSINESS_COLUMNS =
  'business_id, business_name, business_address, business_contact_person, business_contact_number, business_email, business_logo_key, payment_bank_name, payment_account_name, payment_account_number'

async function handleGetBusiness(request: Request, env: Env): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const business = await env.DB.prepare(
    `SELECT ${BUSINESS_COLUMNS} FROM business ORDER BY business_id ASC LIMIT 1`,
  ).first<BusinessRow>()

  return json({ business })
}

async function handleUpdateBusiness(request: Request, env: Env): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request
    .json<{
      business_name?: string
      business_address?: string | null
      business_contact_person?: string | null
      business_contact_number?: string | null
      business_email?: string | null
      payment_bank_name?: string | null
      payment_account_name?: string | null
      payment_account_number?: string | null
    }>()
    .catch(() => null)
  if (!body?.business_name) {
    return json({ error: 'business_name is required' }, { status: 400 })
  }

  const existing = await env.DB.prepare(
    'SELECT business_id FROM business ORDER BY business_id ASC LIMIT 1',
  ).first<{ business_id: number }>()

  // RETURNING reads back the just-written row instead of a follow-up SELECT,
  // which can race against D1's read replicas and see a stale (missing) row.
  let business: BusinessRow | null
  if (existing) {
    business = await env.DB.prepare(
      `UPDATE business SET business_name = ?, business_address = ?, business_contact_person = ?, business_contact_number = ?, business_email = ?, payment_bank_name = ?, payment_account_name = ?, payment_account_number = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE business_id = ?
       RETURNING ${BUSINESS_COLUMNS}`,
    )
      .bind(
        body.business_name,
        body.business_address ?? null,
        body.business_contact_person ?? null,
        body.business_contact_number ?? null,
        body.business_email ?? null,
        body.payment_bank_name ?? null,
        body.payment_account_name ?? null,
        body.payment_account_number ?? null,
        session.sub,
        existing.business_id,
      )
      .first<BusinessRow>()
  } else {
    business = await env.DB.prepare(
      `INSERT INTO business (business_name, business_address, business_contact_person, business_contact_number, business_email, payment_bank_name, payment_account_name, payment_account_number, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       RETURNING ${BUSINESS_COLUMNS}`,
    )
      .bind(
        body.business_name,
        body.business_address ?? null,
        body.business_contact_person ?? null,
        body.business_contact_number ?? null,
        body.business_email ?? null,
        body.payment_bank_name ?? null,
        body.payment_account_name ?? null,
        body.payment_account_number ?? null,
        session.sub,
      )
      .first<BusinessRow>()
  }

  return json({ business })
}

interface BusinessAliasBody {
  business_name?: string
  business_address?: string | null
  business_contact_person?: string | null
  business_contact_number?: string | null
  business_email?: string | null
  payment_bank_name?: string | null
  payment_account_name?: string | null
  payment_account_number?: string | null
}

// Aliases are extra rows in the same `business` table (alternate identities
// for the company, e.g. a different legal entity name on some notas). The
// first row by business_id is always the primary; every other row is an
// alias.
async function handleListBusinessAliases(request: Request, env: Env): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const { results } = await env.DB.prepare(
    `SELECT ${BUSINESS_COLUMNS} FROM business WHERE is_active = 1 ORDER BY business_id ASC LIMIT -1 OFFSET 1`,
  ).all<BusinessRow>()

  return json({ aliases: results })
}

async function handleCreateBusinessAlias(request: Request, env: Env): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json<BusinessAliasBody>().catch(() => null)
  if (!body?.business_name) {
    return json({ error: 'business_name is required' }, { status: 400 })
  }

  const business = await env.DB.prepare(
    `INSERT INTO business (business_name, business_address, business_contact_person, business_contact_number, business_email, payment_bank_name, payment_account_name, payment_account_number, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     RETURNING ${BUSINESS_COLUMNS}`,
  )
    .bind(
      body.business_name,
      body.business_address ?? null,
      body.business_contact_person ?? null,
      body.business_contact_number ?? null,
      body.business_email ?? null,
      body.payment_bank_name ?? null,
      body.payment_account_name ?? null,
      body.payment_account_number ?? null,
      session.sub,
    )
    .first<BusinessRow>()

  return json({ business })
}

async function handleUpdateBusinessAlias(request: Request, env: Env, businessId: number): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json<BusinessAliasBody>().catch(() => null)
  if (!body?.business_name) {
    return json({ error: 'business_name is required' }, { status: 400 })
  }

  const primary = await env.DB.prepare('SELECT business_id FROM business ORDER BY business_id ASC LIMIT 1').first<{
    business_id: number
  }>()
  if (primary?.business_id === businessId) {
    return json({ error: 'Not an alias' }, { status: 400 })
  }

  const business = await env.DB.prepare(
    `UPDATE business SET business_name = ?, business_address = ?, business_contact_person = ?, business_contact_number = ?, business_email = ?, payment_bank_name = ?, payment_account_name = ?, payment_account_number = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE business_id = ? AND is_active = 1
     RETURNING ${BUSINESS_COLUMNS}`,
  )
    .bind(
      body.business_name,
      body.business_address ?? null,
      body.business_contact_person ?? null,
      body.business_contact_number ?? null,
      body.business_email ?? null,
      body.payment_bank_name ?? null,
      body.payment_account_name ?? null,
      body.payment_account_number ?? null,
      session.sub,
      businessId,
    )
    .first<BusinessRow>()

  if (!business) return json({ error: 'Alias not found' }, { status: 404 })

  return json({ business })
}

// Soft delete only -- is_active flips to 0, row stays so past nota/payment
// PDFs issued under this alias keep working.
async function handleDeleteBusinessAlias(request: Request, env: Env, businessId: number): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })

  const primary = await env.DB.prepare('SELECT business_id FROM business ORDER BY business_id ASC LIMIT 1').first<{
    business_id: number
  }>()
  if (primary?.business_id === businessId) {
    return json({ error: 'Cannot delete the primary business' }, { status: 400 })
  }

  const result = await env.DB.prepare(
    'UPDATE business SET is_active = 0, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE business_id = ? AND is_active = 1',
  )
    .bind(session.sub, businessId)
    .run()

  if (result.meta.changes === 0) return json({ error: 'Alias not found' }, { status: 404 })

  return json({ ok: true })
}

const LOGO_CONTENT_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

async function handleUploadBusinessLogo(
  request: Request,
  env: Env,
  lookup: string,
  binds: (number | string)[] = [],
): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const contentType = request.headers.get('Content-Type') ?? ''
  const ext = LOGO_CONTENT_TYPES[contentType]
  if (!ext) {
    return json({ error: 'Unsupported image type' }, { status: 400 })
  }

  const existing = await env.DB.prepare(
    `SELECT business_id, business_logo_key FROM business WHERE ${lookup}`,
  )
    .bind(...binds)
    .first<{ business_id: number; business_logo_key: string | null }>()

  if (!existing) {
    return json({ error: 'Business not found' }, { status: 400 })
  }

  const key = `business-logos/${existing.business_id}-${Date.now()}.${ext}`
  await env.ASSETS.put(key, request.body, { httpMetadata: { contentType } })

  if (existing.business_logo_key) {
    await env.ASSETS.delete(existing.business_logo_key).catch(() => {})
  }

  await env.DB.prepare('UPDATE business SET business_logo_key = ? WHERE business_id = ?')
    .bind(key, existing.business_id)
    .run()

  return json({ business_logo_key: key })
}

async function handleGetBusinessLogo(
  _request: Request,
  env: Env,
  lookup: string,
  binds: (number | string)[] = [],
): Promise<Response> {
  const business = await env.DB.prepare(`SELECT business_logo_key FROM business WHERE ${lookup}`)
    .bind(...binds)
    .first<{ business_logo_key: string | null }>()

  if (!business?.business_logo_key) {
    return json({ error: 'Not found' }, { status: 404 })
  }

  const object = await env.ASSETS.get(business.business_logo_key)
  if (!object) {
    return json({ error: 'Not found' }, { status: 404 })
  }

  return new Response(object.body, {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=300',
    },
  })
}

interface NotaListRow {
  nota_id: number
  nota_number: string
  nota_date: string
  customer_id: number
  customer_company_name_snapshot: string
  contact_name_snapshot: string | null
  total_price: number
  total_cost: number
  notes: string | null
  paid_amount: number
  status: string
  pajak_name: string | null
  pajak_percentage: number | null
}

// Payment is scoped to the bill (customer + month), so every nota in a bill shows the
// bill's status rather than its own slice of the FIFO allocation in nota_summary.
const BILL_JOINS = `JOIN nota_summary s ON s.nota_id = n.nota_id
     LEFT JOIN (
       SELECT customer_id, substr(nota_date, 1, 7) AS ym, SUM(total_price) AS bill_total
       FROM nota WHERE is_void = 0 GROUP BY customer_id, substr(nota_date, 1, 7)
     ) bt ON bt.customer_id = n.customer_id AND bt.ym = substr(n.nota_date, 1, 7)
     LEFT JOIN (
       SELECT customer_id, printf('%04d-%02d', bill_year, bill_month) AS ym, SUM(amount) AS bill_paid
       FROM payment WHERE is_void = 0 GROUP BY customer_id, bill_year, bill_month
     ) bp ON bp.customer_id = n.customer_id AND bp.ym = substr(n.nota_date, 1, 7)`
const BILL_STATUS = `CASE
       WHEN n.is_void = 1 THEN 'void'
       WHEN COALESCE(bp.bill_paid, 0) >= COALESCE(bt.bill_total, 0) AND COALESCE(bt.bill_total, 0) > 0 THEN 'paid'
       WHEN COALESCE(bp.bill_paid, 0) > 0 THEN 'partial'
       ELSE 'unpaid'
     END`

async function handleListNota(request: Request, env: Env): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const limitParam = url.searchParams.get('limit')
  const offsetParam = url.searchParams.get('offset')
  const limit = limitParam ? Math.min(Math.max(1, Number(limitParam)), 500) : null
  const offset = offsetParam ? Math.max(0, Number(offsetParam)) : 0

  const q = url.searchParams.get('q')?.trim() || null
  const status = url.searchParams.get('status')?.trim() || null
  const startDate = url.searchParams.get('start_date')?.trim() || null
  const endDate = url.searchParams.get('end_date')?.trim() || null
  const sort = url.searchParams.get('sort')?.trim() || null

  const conditions = ['n.is_void = 0']
  const params: (string | number)[] = []

  if (q) {
    const orParts = [
      'n.customer_company_name_snapshot LIKE ?',
      'n.contact_name_snapshot LIKE ?',
      'n.nota_number LIKE ?',
    ]
    const orParams: (string | number)[] = [`%${q}%`, `%${q}%`, `%${q}%`]
    if (/^\d+$/.test(q)) {
      // Bare digits also match the nota's trailing global sequence number
      // (nota_number ends "/<seq>") and the bill's total price.
      orParts.push('n.nota_number LIKE ?')
      orParams.push(`%/${q}`)
      orParts.push('CAST(s.total_price AS TEXT) LIKE ?')
      orParams.push(`%${q}%`)
    }
    conditions.push(`(${orParts.join(' OR ')})`)
    params.push(...orParams)
  }
  if (status && ['unpaid', 'partial', 'paid', 'void'].includes(status)) {
    conditions.push(`${BILL_STATUS} = ?`)
    params.push(status)
  }
  if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    conditions.push('n.nota_date >= ?')
    params.push(startDate)
  }
  if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    conditions.push('n.nota_date <= ?')
    params.push(endDate)
  }

  const whereClause = conditions.join(' AND ')

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM nota n
     ${BILL_JOINS}
     WHERE ${whereClause}`,
  )
    .bind(...params)
    .first<{ count: number }>()

  const baseQuery = `SELECT n.nota_id, n.nota_number, n.nota_date, n.customer_id, n.customer_company_name_snapshot,
            n.contact_name_snapshot, n.notes, n.pajak_name, n.pajak_percentage, s.total_price, s.paid_amount, ${BILL_STATUS} AS status,
            (SELECT COALESCE(SUM(ni.cost_price_snapshot * ni.qty), 0) FROM nota_item ni WHERE ni.nota_id = n.nota_id) AS total_cost
     FROM nota n
     ${BILL_JOINS}
     WHERE ${whereClause}
     ORDER BY ${sort === 'created' ? 'n.nota_id DESC' : 'n.nota_date DESC, n.nota_id DESC'}`

  const stmt = limit
    ? env.DB.prepare(`${baseQuery} LIMIT ? OFFSET ?`).bind(...params, limit, offset)
    : env.DB.prepare(baseQuery).bind(...params)
  const { results } = await stmt.all<NotaListRow>()

  return json({ nota: results, total: totalRow?.count ?? results.length })
}

async function handleGetNotaDateRange(request: Request, env: Env): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const row = await env.DB.prepare(
    `SELECT MIN(nota_date) AS minDate, MAX(nota_date) AS maxDate FROM nota WHERE is_void = 0`,
  ).first<{ minDate: string | null; maxDate: string | null }>()

  if (!row?.minDate || !row?.maxDate) {
    return json({ minYear: null, minMonth: null, maxYear: null, maxMonth: null })
  }

  return json({
    minYear: Number(row.minDate.slice(0, 4)),
    minMonth: Number(row.minDate.slice(5, 7)),
    maxYear: Number(row.maxDate.slice(0, 4)),
    maxMonth: Number(row.maxDate.slice(5, 7)),
  })
}

async function handleVoidNota(request: Request, env: Env, notaId: number): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  // Best-effort: pdf_r2_key only exists once migration 0013 has been applied.
  // Voiding the nota must still succeed even if it hasn't been run yet.
  const existing = await env.DB.prepare('SELECT pdf_r2_key FROM nota WHERE nota_id = ?')
    .bind(notaId)
    .first<{ pdf_r2_key: string | null }>()
    .catch(() => null)

  const result = await env.DB.prepare('UPDATE nota SET is_void = 1 WHERE nota_id = ?')
    .bind(notaId)
    .run()

  if (result.meta.changes === 0) return json({ error: 'Nota not found' }, { status: 404 })

  if (existing?.pdf_r2_key) {
    await env.ASSETS.delete(existing.pdf_r2_key).catch(() => {})
    await env.DB.prepare('UPDATE nota SET pdf_r2_key = NULL WHERE nota_id = ?')
      .bind(notaId)
      .run()
      .catch(() => {})
  }

  return json({ ok: true })
}

async function handleClearNotaPdfCache(request: Request, env: Env): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  // Logo (or other letterhead data) changed — every cached PDF has the old
  // one baked in. Just drop the pointers; orphaned R2 objects are harmless
  // and not worth a bucket listing+delete pass here.
  await env.DB.prepare('UPDATE nota SET pdf_r2_key = NULL WHERE pdf_r2_key IS NOT NULL').run()
  return json({ ok: true })
}

async function handleGetNotaPdf(_request: Request, env: Env, notaId: number): Promise<Response> {
  const nota = await env.DB.prepare('SELECT pdf_r2_key FROM nota WHERE nota_id = ?')
    .bind(notaId)
    .first<{ pdf_r2_key: string | null }>()

  if (!nota?.pdf_r2_key) return json({ error: 'Not cached' }, { status: 404 })

  const object = await env.ASSETS.get(nota.pdf_r2_key)
  if (!object) return json({ error: 'Not cached' }, { status: 404 })

  return new Response(object.body, {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/pdf',
      'Cache-Control': 'private, max-age=86400',
    },
  })
}

async function handlePutNotaPdf(request: Request, env: Env, notaId: number): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const nota = await env.DB.prepare('SELECT nota_number, pdf_r2_key FROM nota WHERE nota_id = ?')
    .bind(notaId)
    .first<{ nota_number: string; pdf_r2_key: string | null }>()
  if (!nota) return json({ error: 'Nota not found' }, { status: 404 })

  const key = `nota-pdf/${notaId}-${Date.now()}.pdf`
  await env.ASSETS.put(key, request.body, { httpMetadata: { contentType: 'application/pdf' } })

  if (nota.pdf_r2_key) {
    await env.ASSETS.delete(nota.pdf_r2_key).catch(() => {})
  }

  await env.DB.prepare('UPDATE nota SET pdf_r2_key = ? WHERE nota_id = ?').bind(key, notaId).run()

  return json({ ok: true })
}

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'QRIS', 'Giro', 'Other'] as const

interface PaymentRow {
  payment_id: number
  payment_number: string | null
  payment_date: string
  amount: number
  method: string | null
  reference: string | null
  evidence_key: string | null
  customer_id: number
  bill_year: number
  bill_month: number
  bill_settled: number
}

// A payment belongs to the bill (customer + month), not a single nota —
// customer_id/bill_year/bill_month live directly on the row. bill_settled
// compares the whole bill period's nota total against everything paid.
const PAYMENT_SELECT = `
  SELECT p.payment_id, p.payment_number, p.payment_date, p.amount, p.method, p.reference, p.evidence_key,
    p.customer_id, p.bill_year, p.bill_month,
    (
      (SELECT COALESCE(SUM(n.total_price), 0) FROM nota n
       WHERE n.customer_id = p.customer_id AND n.is_void = 0
         AND CAST(substr(n.nota_date, 1, 4) AS INTEGER) = p.bill_year
         AND CAST(substr(n.nota_date, 6, 2) AS INTEGER) = p.bill_month)
      <=
      (SELECT COALESCE(SUM(p2.amount), 0) FROM payment p2
       WHERE p2.customer_id = p.customer_id AND p2.bill_year = p.bill_year
         AND p2.bill_month = p.bill_month AND p2.is_void = 0)
    ) AS bill_settled
  FROM payment p
`

async function handleListBillPayments(
  request: Request,
  env: Env,
  customerId: number,
): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const year = Number(url.searchParams.get('year'))
  const month = Number(url.searchParams.get('month'))
  if (!year || !month) return json({ error: 'year and month are required' }, { status: 400 })

  const { results } = await env.DB.prepare(
    `${PAYMENT_SELECT} WHERE p.customer_id = ? AND p.bill_year = ? AND p.bill_month = ? AND p.is_void = 0
     ORDER BY p.payment_date DESC, p.payment_id DESC`,
  )
    .bind(customerId, year, month)
    .all<PaymentRow>()

  return json({ payments: results })
}

interface CreateBillPaymentBody {
  year?: number
  month?: number
  payment_date?: string
  amount?: number
  method?: string
  reference?: string | null
}

// Bill-level payment: the connection point is customer + month (same as the
// bill number, e.g. BIL/2610/1), not a single nota. Each nota's own
// paid_amount/status (nota_summary) is a live waterfall allocation across
// the bill period, computed at read time — not stored per nota here.
async function handleCreateBillPayment(
  request: Request,
  env: Env,
  customerId: number,
): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json<CreateBillPaymentBody>().catch(() => null)
  if (!body?.payment_date || !body.amount || body.amount <= 0) {
    return json({ error: 'payment_date and a positive amount are required' }, { status: 400 })
  }
  if (!body.method || !PAYMENT_METHODS.includes(body.method as (typeof PAYMENT_METHODS)[number])) {
    return json({ error: 'A valid payment method is required' }, { status: 400 })
  }
  if (!body.year || !body.month) {
    return json({ error: 'year and month are required' }, { status: 400 })
  }

  const customer = await env.DB.prepare('SELECT customer_id FROM customer WHERE customer_id = ?')
    .bind(customerId)
    .first<{ customer_id: number }>()
  if (!customer) return json({ error: 'Customer not found' }, { status: 404 })

  const billPaymentCountRow = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM payment WHERE customer_id = ? AND bill_year = ? AND bill_month = ? AND is_void = 0',
  )
    .bind(customerId, body.year, body.month)
    .first<{ count: number }>()

  const paymentNumber = `PAY/${String(body.year).slice(-2)}${String(body.month).padStart(2, '0')}/${customerId}-${(billPaymentCountRow?.count ?? 0) + 1}`

  const created = await env.DB.prepare(
    'INSERT INTO payment (payment_number, payment_date, amount, method, reference, customer_id, bill_year, bill_month) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      paymentNumber,
      body.payment_date,
      body.amount,
      body.method,
      body.reference ?? null,
      customerId,
      body.year,
      body.month,
    )
    .run()

  const payment = await env.DB.prepare(`${PAYMENT_SELECT} WHERE p.payment_id = ?`)
    .bind(created.meta.last_row_id)
    .first<PaymentRow>()

  return json({ payment }, { status: 201 })
}

async function handleVoidPayment(request: Request, env: Env, paymentId: number): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const result = await env.DB.prepare('UPDATE payment SET is_void = 1 WHERE payment_id = ?')
    .bind(paymentId)
    .run()
  if (result.meta.changes === 0) return json({ error: 'Payment not found' }, { status: 404 })

  return json({ ok: true })
}

const EVIDENCE_CONTENT_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

async function handleUploadPaymentEvidence(
  request: Request,
  env: Env,
  paymentId: number,
): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const contentType = request.headers.get('Content-Type') ?? ''
  const ext = EVIDENCE_CONTENT_TYPES[contentType]
  if (!ext) return json({ error: 'Unsupported file type' }, { status: 400 })

  const payment = await env.DB.prepare('SELECT payment_id, evidence_key FROM payment WHERE payment_id = ?')
    .bind(paymentId)
    .first<{ payment_id: number; evidence_key: string | null }>()
  if (!payment) return json({ error: 'Payment not found' }, { status: 404 })

  const key = `payment-evidence/${paymentId}-${Date.now()}.${ext}`
  await env.ASSETS.put(key, request.body, { httpMetadata: { contentType } })

  if (payment.evidence_key) {
    await env.ASSETS.delete(payment.evidence_key).catch(() => {})
  }

  await env.DB.prepare('UPDATE payment SET evidence_key = ? WHERE payment_id = ?')
    .bind(key, paymentId)
    .run()

  return json({ evidence_key: key })
}

async function handleGetPaymentEvidence(
  _request: Request,
  env: Env,
  paymentId: number,
): Promise<Response> {
  const payment = await env.DB.prepare('SELECT evidence_key FROM payment WHERE payment_id = ?')
    .bind(paymentId)
    .first<{ evidence_key: string | null }>()

  if (!payment?.evidence_key) return json({ error: 'Not found' }, { status: 404 })

  const object = await env.ASSETS.get(payment.evidence_key)
  if (!object) return json({ error: 'Not found' }, { status: 404 })

  return new Response(object.body, {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=300',
    },
  })
}

interface NotaDetailRow {
  nota_id: number
  nota_number: string
  nota_date: string
  customer_company_name_snapshot: string
  customer_address_snapshot: string | null
  contact_name_snapshot: string | null
  contact_phone_number_snapshot: string | null
  total_price: number
  paid_amount: number
  status: string
  notes: string | null
  business_id: number | null
  pajak_name: string | null
  pajak_percentage: number | null
}

interface NotaItemRow {
  nota_item_id: number
  sku_id: number
  item_name_snapshot: string
  unit_snapshot: string
  qty: number
  price: number
  discount_amount: number
  discount_percent: number
  total_price: number
  cost_price_snapshot: number | null
}

async function handleGetNota(
  request: Request,
  env: Env,
  notaId: number,
): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const nota = await env.DB.prepare(
    `SELECT n.nota_id, n.nota_number, n.nota_date, n.customer_company_name_snapshot,
            n.customer_address_snapshot, n.contact_name_snapshot, n.contact_phone_number_snapshot,
            n.notes, n.business_id, n.pajak_name, n.pajak_percentage, s.total_price, s.paid_amount, s.status
     FROM nota n
     JOIN nota_summary s ON s.nota_id = n.nota_id
     WHERE n.nota_id = ?`,
  )
    .bind(notaId)
    .first<NotaDetailRow>()

  if (!nota) return json({ error: 'Nota not found' }, { status: 404 })

  const { results: items } = await env.DB.prepare(
    `SELECT nota_item_id, sku_id, item_name_snapshot, unit_snapshot, qty, price, discount_amount, discount_percent, total_price, cost_price_snapshot
     FROM nota_item
     WHERE nota_id = ?
     ORDER BY nota_item_id`,
  )
    .bind(notaId)
    .all<NotaItemRow>()

  return json({ nota: { ...nota, items } })
}

interface UpdateNotaBody {
  notes?: string | null
  business_id?: number | null
  pajak_name?: string | null
  pajak_percentage?: number | null
}

async function handleUpdateNota(request: Request, env: Env, notaId: number): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json<UpdateNotaBody>().catch(() => null)
  if (!body) return json({ error: 'Invalid body' }, { status: 400 })

  if (body.notes && body.notes.length > 200) {
    return json({ error: 'notes must be 200 characters or fewer' }, { status: 400 })
  }
  if (body.pajak_percentage != null && (body.pajak_percentage < 0 || body.pajak_percentage > 100)) {
    return json({ error: 'pajak_percentage must be between 0 and 100' }, { status: 400 })
  }
  if (body.business_id != null) {
    const businessExists = await env.DB.prepare('SELECT 1 FROM business WHERE business_id = ?')
      .bind(body.business_id)
      .first()
    if (!businessExists) {
      return json({ error: 'business_id does not exist' }, { status: 400 })
    }
  }

  const result = await env.DB.prepare(
    `UPDATE nota SET notes = ?, business_id = ?, pajak_name = ?, pajak_percentage = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE nota_id = ?`,
  )
    .bind(
      body.notes?.trim() || null,
      body.business_id ?? null,
      body.pajak_name?.trim() || null,
      body.pajak_percentage ?? null,
      session.sub,
      notaId,
    )
    .run()

  if (result.meta.changes === 0) return json({ error: 'Nota not found' }, { status: 404 })

  return json({ ok: true })
}

interface NotaItemInput {
  sku_id?: number | null
  sku_name?: string
  unit?: string
  price?: number
  qty?: number
  discount_amount?: number
  discount_percent?: number
}

interface CreateNotaBody {
  nota_date?: string
  company_name?: string
  company_address?: string | null
  contact_name?: string | null
  phone_number?: string | null
  notes?: string | null
  business_id?: number | null
  pajak_name?: string | null
  pajak_percentage?: number | null
  items?: NotaItemInput[]
}

async function handleCreateNota(request: Request, env: Env): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json<CreateNotaBody>().catch(() => null)
  if (!body?.nota_date || !body.company_name || !body.items?.length) {
    return json(
      { error: 'nota_date, company_name and at least one item are required' },
      { status: 400 },
    )
  }
  if (body.notes && body.notes.length > 200) {
    return json({ error: 'notes must be 200 characters or fewer' }, { status: 400 })
  }

  if (body.pajak_percentage != null && (body.pajak_percentage < 0 || body.pajak_percentage > 100)) {
    return json({ error: 'pajak_percentage must be between 0 and 100' }, { status: 400 })
  }

  if (body.business_id != null) {
    const businessExists = await env.DB.prepare('SELECT 1 FROM business WHERE business_id = ?')
      .bind(body.business_id)
      .first()
    if (!businessExists) {
      return json({ error: 'business_id does not exist' }, { status: 400 })
    }
  }

  const contactName = body.contact_name?.trim() || null
  const phoneNumber = body.phone_number?.trim() || null

  let customer = await env.DB.prepare(
    'SELECT customer_id, company_name, address, contact_person, phone_number FROM customer WHERE company_name = ? AND is_active = 1',
  )
    .bind(body.company_name)
    .first<{
      customer_id: number
      company_name: string
      address: string | null
      contact_person: string | null
      phone_number: string | null
    }>()

  try {
    if (!customer) {
      const created = await env.DB.prepare(
        `INSERT INTO customer (customer_id, company_name, address, contact_person, phone_number, updated_by, updated_at, is_active)
         SELECT COALESCE(MAX(customer_id), 0) + 1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1 FROM customer`,
      )
        .bind(body.company_name, body.company_address ?? null, contactName, phoneNumber, session.sub)
        .run()
      customer = {
        customer_id: created.meta.last_row_id,
        company_name: body.company_name,
        address: body.company_address ?? null,
        contact_person: contactName,
        phone_number: phoneNumber,
      }
    } else if (customer.contact_person !== contactName || customer.phone_number !== phoneNumber) {
      await env.DB.batch([
        env.DB.prepare(
          'UPDATE customer SET is_active = 0 WHERE customer_id = ? AND is_active = 1',
        ).bind(customer.customer_id),
        env.DB.prepare(
          `INSERT INTO customer (customer_id, company_name, address, contact_person, phone_number, updated_by, updated_at, is_active)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1)`,
        ).bind(
          customer.customer_id,
          customer.company_name,
          customer.address,
          contactName,
          phoneNumber,
          session.sub,
        ),
      ])
      customer = { ...customer, contact_person: contactName, phone_number: phoneNumber }
    }
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return json(
        { error: 'This phone number is already registered to another customer' },
        { status: 409 },
      )
    }
    throw err
  }

  const items: Array<{
    sku_id: number
    item_name_snapshot: string
    unit_snapshot: string
    qty: number
    price: number
    discount_amount: number
    discount_percent: number
    total_price: number
    cost_price_snapshot: number | null
  }> = []

  for (const raw of body.items) {
    if (!raw.sku_name || !raw.unit || raw.price == null || raw.qty == null) {
      return json({ error: 'Each item requires sku_name, unit, price and qty' }, { status: 400 })
    }

    let skuId = raw.sku_id ?? null
    if (skuId == null) {
      const existingProduct = await env.DB.prepare(
        'SELECT sku_id FROM product WHERE sku_name = ? AND is_active = 1',
      )
        .bind(raw.sku_name)
        .first<{ sku_id: number }>()

      if (existingProduct) {
        skuId = existingProduct.sku_id
      } else {
        const created = await env.DB.prepare(
          `INSERT INTO product (sku_id, sku_name, unit, suggested_price, updated_by, updated_at, is_active)
           SELECT COALESCE(MAX(sku_id), 0) + 1, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1 FROM product`,
        )
          .bind(raw.sku_name, raw.unit, raw.price, session.sub)
          .run()
        skuId = created.meta.last_row_id
      }
    }

    const qty = raw.qty
    const price = raw.price
    const discountAmount = raw.discount_amount ?? 0
    const discountPercent = raw.discount_percent ?? 0
    const lineTotal = Math.round(qty * price - discountAmount)

    const productRow = await env.DB.prepare(
      'SELECT cost_price FROM product WHERE sku_id = ? AND is_active = 1',
    )
      .bind(skuId)
      .first<{ cost_price: number | null }>()

    items.push({
      sku_id: skuId,
      item_name_snapshot: raw.sku_name,
      unit_snapshot: raw.unit,
      qty,
      price,
      discount_amount: discountAmount,
      discount_percent: discountPercent,
      total_price: lineTotal,
      cost_price_snapshot: productRow?.cost_price ?? null,
    })
  }

  const totalPrice = items.reduce((sum, item) => sum + item.total_price, 0)

  const countRow = await env.DB.prepare('SELECT COUNT(*) AS count FROM nota').first<{
    count: number
  }>()
  const customerCountRow = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM nota WHERE customer_id = ?',
  )
    .bind(customer.customer_id)
    .first<{ count: number }>()

  const yymm = body.nota_date.slice(2, 4) + body.nota_date.slice(5, 7)
  const customerSeq = (customerCountRow?.count ?? 0) + 1
  const globalSeq = (countRow?.count ?? 0) + 1
  const notaNumber = `INV/${yymm}/${customer.customer_id}-${customerSeq}/${globalSeq}`

  const notaResult = await env.DB.prepare(
    `INSERT INTO nota (
       nota_number, nota_date, customer_id, customer_company_name_snapshot, customer_address_snapshot,
       contact_name_snapshot, contact_phone_number_snapshot, total_price, created_by, notes, business_id,
       pajak_name, pajak_percentage
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      notaNumber,
      body.nota_date,
      customer.customer_id,
      customer.company_name,
      customer.address,
      contactName,
      phoneNumber,
      totalPrice,
      session.sub,
      body.notes?.trim() || null,
      body.business_id ?? null,
      body.pajak_name?.trim() || null,
      body.pajak_percentage ?? null,
    )
    .run()

  const notaId = notaResult.meta.last_row_id

  const itemInsert = env.DB.prepare(
    `INSERT INTO nota_item (
       nota_id, sku_id, item_name_snapshot, unit_snapshot, qty, price, discount_amount, discount_percent, total_price, cost_price_snapshot
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  await env.DB.batch(
    items.map((item) =>
      itemInsert.bind(
        notaId,
        item.sku_id,
        item.item_name_snapshot,
        item.unit_snapshot,
        item.qty,
        item.price,
        item.discount_amount,
        item.discount_percent,
        item.total_price,
        item.cost_price_snapshot,
      ),
    ),
  )

  const nota = await env.DB.prepare(
    `SELECT n.nota_id, n.nota_number, n.nota_date, n.customer_company_name_snapshot,
            n.contact_name_snapshot, s.total_price, s.paid_amount, s.status
     FROM nota n
     JOIN nota_summary s ON s.nota_id = n.nota_id
     WHERE n.nota_id = ?`,
  )
    .bind(notaId)
    .first<NotaListRow>()

  return json({ nota }, { status: 201 })
}

export default {
  async fetch(request, env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS })
    }

    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return json({ status: 'ok' })
    }

    // Super admins can flip Business Settings to point every DB-backed route
    // (everything below) at the staging clone instead of production. Only
    // auth (USER_DB) and JWT_SECRET are unaffected, since those live outside
    // the swapped `DB` binding.
    const sessionToken = getBearerToken(request)
    const session = sessionToken ? await verifySession(sessionToken, env.JWT_SECRET) : null
    const useStaging =
      (session?.role === 'super_admin' || session?.role === 'staging_admin') &&
      request.headers.get('X-Db-Target') === 'staging'
    const effectiveEnv: Env = useStaging ? { ...env, DB: env.DB_STAGING } : env

    if (url.pathname === '/auth/login' && request.method === 'POST') {
      return handleLogin(request, effectiveEnv)
    }

    if (url.pathname === '/auth/me' && request.method === 'GET') {
      return handleMe(request, effectiveEnv)
    }

    if (url.pathname === '/auth/account' && request.method === 'PUT') {
      return handleUpdateAccount(request, effectiveEnv)
    }

    if (url.pathname === '/auth/password' && request.method === 'PUT') {
      return handleUpdatePassword(request, effectiveEnv)
    }

    if (url.pathname === '/users' && request.method === 'GET') {
      return handleListUsers(request, effectiveEnv)
    }

    if (url.pathname === '/users' && request.method === 'POST') {
      return handleCreateUser(request, effectiveEnv)
    }

    const userIdMatch = url.pathname.match(/^\/users\/([0-9a-f-]+)$/)
    if (userIdMatch && request.method === 'PUT') {
      return handleUpdateUserRole(request, effectiveEnv, userIdMatch[1])
    }
    if (userIdMatch && request.method === 'DELETE') {
      return handleDeactivateUser(request, effectiveEnv, userIdMatch[1])
    }

    const userResetPasswordMatch = url.pathname.match(/^\/users\/([0-9a-f-]+)\/reset-password$/)
    if (userResetPasswordMatch && request.method === 'POST') {
      return handleResetUserPassword(request, effectiveEnv, userResetPasswordMatch[1])
    }

    if (url.pathname === '/customers' && request.method === 'GET') {
      return handleListCustomers(request, effectiveEnv)
    }

    if (url.pathname === '/customers' && request.method === 'POST') {
      return handleCreateCustomer(request, effectiveEnv)
    }

    const customerMatch = url.pathname.match(/^\/customers\/(\d+)$/)
    if (customerMatch) {
      const customerId = Number(customerMatch[1])
      if (request.method === 'PUT') return handleUpdateCustomer(request, effectiveEnv, customerId)
      if (request.method === 'DELETE') return handleDeleteCustomer(request, effectiveEnv, customerId)
    }

    const customerHistoryMatch = url.pathname.match(/^\/customers\/(\d+)\/history$/)
    if (customerHistoryMatch && request.method === 'GET') {
      return handleGetCustomerHistory(request, effectiveEnv, Number(customerHistoryMatch[1]))
    }

    const billPaymentMatch = url.pathname.match(/^\/customers\/(\d+)\/bill-payments$/)
    if (billPaymentMatch) {
      const customerId = Number(billPaymentMatch[1])
      if (request.method === 'GET') return handleListBillPayments(request, effectiveEnv, customerId)
      if (request.method === 'POST') return handleCreateBillPayment(request, effectiveEnv, customerId)
    }

    const paymentMatch = url.pathname.match(/^\/payments\/(\d+)$/)
    if (paymentMatch && request.method === 'DELETE') {
      return handleVoidPayment(request, effectiveEnv, Number(paymentMatch[1]))
    }

    const paymentEvidenceMatch2 = url.pathname.match(/^\/payments\/(\d+)\/evidence$/)
    if (paymentEvidenceMatch2) {
      const paymentId = Number(paymentEvidenceMatch2[1])
      if (request.method === 'PUT') return handleUploadPaymentEvidence(request, effectiveEnv, paymentId)
      if (request.method === 'GET') return handleGetPaymentEvidence(request, effectiveEnv, paymentId)
    }

    if (url.pathname === '/products' && request.method === 'GET') {
      return handleListProducts(request, effectiveEnv)
    }

    if (url.pathname === '/products' && request.method === 'POST') {
      return handleCreateProduct(request, effectiveEnv)
    }

    const productMatch = url.pathname.match(/^\/products\/(\d+)$/)
    if (productMatch) {
      const skuId = Number(productMatch[1])
      if (request.method === 'PUT') return handleUpdateProduct(request, effectiveEnv, skuId)
      if (request.method === 'DELETE') return handleDeleteProduct(request, effectiveEnv, skuId)
    }

    const productHistoryMatch = url.pathname.match(/^\/products\/(\d+)\/history$/)
    if (productHistoryMatch && request.method === 'GET') {
      return handleGetProductHistory(request, effectiveEnv, Number(productHistoryMatch[1]))
    }

    if (url.pathname === '/nota' && request.method === 'GET') {
      return handleListNota(request, effectiveEnv)
    }

    if (url.pathname === '/nota' && request.method === 'POST') {
      return handleCreateNota(request, effectiveEnv)
    }

    if (url.pathname === '/nota/date-range' && request.method === 'GET') {
      return handleGetNotaDateRange(request, effectiveEnv)
    }

    const notaMatch = url.pathname.match(/^\/nota\/(\d+)$/)
    if (notaMatch && request.method === 'GET') {
      return handleGetNota(request, effectiveEnv, Number(notaMatch[1]))
    }

    if (notaMatch && request.method === 'PUT') {
      return handleUpdateNota(request, effectiveEnv, Number(notaMatch[1]))
    }

    const notaVoidMatch = url.pathname.match(/^\/nota\/(\d+)\/void$/)
    if (notaVoidMatch && request.method === 'PUT') {
      return handleVoidNota(request, effectiveEnv, Number(notaVoidMatch[1]))
    }

    if (url.pathname === '/nota/pdf-cache' && request.method === 'DELETE') {
      return handleClearNotaPdfCache(request, effectiveEnv)
    }

    const notaPdfMatch = url.pathname.match(/^\/nota\/(\d+)\/pdf$/)
    if (notaPdfMatch) {
      const notaId = Number(notaPdfMatch[1])
      if (request.method === 'GET') return handleGetNotaPdf(request, effectiveEnv, notaId)
      if (request.method === 'PUT') return handlePutNotaPdf(request, effectiveEnv, notaId)
    }


    if (url.pathname === '/stock-ledger' && request.method === 'GET') {
      return handleListStockLedger(request, effectiveEnv)
    }

    if (url.pathname === '/stock-ledger' && request.method === 'POST') {
      return handleCreateStockMovement(request, effectiveEnv)
    }

    const stockLedgerIdMatch = url.pathname.match(/^\/stock-ledger\/(\d+)$/)
    if (stockLedgerIdMatch) {
      const id = Number(stockLedgerIdMatch[1])
      if (request.method === 'PUT') return handleUpdateStockMovement(request, effectiveEnv, id)
      if (request.method === 'DELETE') return handleDeleteStockMovement(request, effectiveEnv, id)
    }

    if (url.pathname === '/business' && request.method === 'GET') {
      return handleGetBusiness(request, effectiveEnv)
    }

    if (url.pathname === '/business' && request.method === 'PUT') {
      return handleUpdateBusiness(request, effectiveEnv)
    }

    if (url.pathname === '/business/logo' && request.method === 'PUT') {
      return handleUploadBusinessLogo(request, effectiveEnv, 'business_id = (SELECT business_id FROM business ORDER BY business_id ASC LIMIT 1)')
    }

    if (url.pathname === '/business/logo' && request.method === 'GET') {
      return handleGetBusinessLogo(request, effectiveEnv, 'business_id = (SELECT business_id FROM business ORDER BY business_id ASC LIMIT 1)')
    }

    if (url.pathname === '/business/aliases' && request.method === 'GET') {
      return handleListBusinessAliases(request, effectiveEnv)
    }

    if (url.pathname === '/business/aliases' && request.method === 'POST') {
      return handleCreateBusinessAlias(request, effectiveEnv)
    }

    const businessAliasMatch = url.pathname.match(/^\/business\/aliases\/(\d+)$/)
    if (businessAliasMatch && request.method === 'PUT') {
      return handleUpdateBusinessAlias(request, effectiveEnv, Number(businessAliasMatch[1]))
    }
    if (businessAliasMatch && request.method === 'DELETE') {
      return handleDeleteBusinessAlias(request, effectiveEnv, Number(businessAliasMatch[1]))
    }

    const businessAliasLogoMatch = url.pathname.match(/^\/business\/aliases\/(\d+)\/logo$/)
    if (businessAliasLogoMatch && request.method === 'PUT') {
      return handleUploadBusinessLogo(request, effectiveEnv, 'business_id = ?', [Number(businessAliasLogoMatch[1])])
    }
    if (businessAliasLogoMatch && request.method === 'GET') {
      return handleGetBusinessLogo(request, effectiveEnv, 'business_id = ?', [Number(businessAliasLogoMatch[1])])
    }

    return json({ error: 'Not found' }, { status: 404 })
  },
} satisfies ExportedHandler<Env>
