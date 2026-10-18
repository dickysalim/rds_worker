import bcrypt from 'bcryptjs'
import { getBearerToken, signSession, verifySession } from './auth'

export interface Env {
  DB: D1Database
  JWT_SECRET: string
  ASSETS: R2Bucket
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

interface UserRow {
  user_id: number
  username: string
  name: string
  password_hash: string
  role: string
  is_active: number
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ username?: string; password?: string }>().catch(() => null)
  if (!body?.username || !body.password) {
    return json({ error: 'username and password are required' }, { status: 400 })
  }

  const user = await env.DB.prepare(
    'SELECT user_id, username, name, password_hash, role, is_active FROM user WHERE username = ?',
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

  const token = await signSession(
    {
      sub: user.user_id,
      username: user.username,
      name: user.name,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    },
    env.JWT_SECRET,
  )

  return json({
    token,
    user: { id: user.user_id, username: user.username, name: user.name, role: user.role },
  })
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const token = getBearerToken(request)
  if (!token) return json({ error: 'Missing token' }, { status: 401 })

  const session = await verifySession(token, env.JWT_SECRET)
  if (!session) return json({ error: 'Invalid or expired token' }, { status: 401 })

  return json({
    user: { id: session.sub, username: session.username, name: session.name, role: session.role },
  })
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
  is_active: number
}

async function handleListProducts(request: Request, env: Env): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const { results } = await env.DB.prepare(
    'SELECT sku_id, sku_name, unit, suggested_price, is_active FROM product WHERE is_active = 1 ORDER BY sku_id ASC',
  ).all<ProductRow>()

  return json({ products: results })
}

interface CustomerRow {
  customer_id: number
  company_name: string
  address: string | null
  contact_id: number | null
  contact_name: string | null
  phone_number: string | null
}

async function handleListCustomers(request: Request, env: Env): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const { results } = await env.DB.prepare(
    `SELECT c.customer_id, c.company_name, c.address, cc.contact_id, cc.contact_name, cc.phone_number
     FROM customer c
     LEFT JOIN customer_contact cc ON cc.customer_id = c.customer_id AND cc.is_primary = 1 AND cc.is_active = 1
     WHERE c.is_active = 1
     ORDER BY c.customer_id ASC`,
  ).all<CustomerRow>()

  return json({ customers: results })
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message)
}

async function handleCreateCustomer(request: Request, env: Env): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request
    .json<{
      company_name?: string
      address?: string | null
      contact_name?: string
      phone_number?: string
    }>()
    .catch(() => null)
  if (!body?.company_name || !body.contact_name || !body.phone_number) {
    return json(
      { error: 'company_name, contact_name and phone_number are required' },
      { status: 400 },
    )
  }

  let customerId: number
  try {
    const result = await env.DB.prepare(
      'INSERT INTO customer (company_name, address) VALUES (?, ?)',
    )
      .bind(body.company_name, body.address ?? null)
      .run()
    customerId = result.meta.last_row_id
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return json({ error: 'A customer with this company name already exists' }, { status: 409 })
    }
    throw err
  }

  try {
    await env.DB.prepare(
      'INSERT INTO customer_contact (customer_id, contact_name, phone_number, is_primary) VALUES (?, ?, ?, 1)',
    )
      .bind(customerId, body.contact_name, body.phone_number)
      .run()
  } catch (err) {
    await env.DB.prepare('DELETE FROM customer WHERE customer_id = ?').bind(customerId).run()
    if (isUniqueConstraintError(err)) {
      return json({ error: 'A contact with this phone number already exists' }, { status: 409 })
    }
    throw err
  }

  const customer = await env.DB.prepare(
    `SELECT c.customer_id, c.company_name, c.address, cc.contact_id, cc.contact_name, cc.phone_number
     FROM customer c
     LEFT JOIN customer_contact cc ON cc.customer_id = c.customer_id AND cc.is_primary = 1 AND cc.is_active = 1
     WHERE c.customer_id = ?`,
  )
    .bind(customerId)
    .first<CustomerRow>()

  return json({ customer }, { status: 201 })
}

async function handleUpdateCustomer(
  request: Request,
  env: Env,
  customerId: number,
): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request
    .json<{
      company_name?: string
      address?: string | null
      contact_name?: string
      phone_number?: string
    }>()
    .catch(() => null)
  if (!body?.company_name || !body.contact_name || !body.phone_number) {
    return json(
      { error: 'company_name, contact_name and phone_number are required' },
      { status: 400 },
    )
  }

  try {
    await env.DB.prepare(
      'UPDATE customer SET company_name = ?, address = ? WHERE customer_id = ? AND is_active = 1',
    )
      .bind(body.company_name, body.address ?? null, customerId)
      .run()
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return json({ error: 'A customer with this company name already exists' }, { status: 409 })
    }
    throw err
  }

  try {
    await env.DB.prepare(
      'UPDATE customer_contact SET contact_name = ?, phone_number = ? WHERE customer_id = ? AND is_primary = 1 AND is_active = 1',
    )
      .bind(body.contact_name, body.phone_number, customerId)
      .run()
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return json({ error: 'A contact with this phone number already exists' }, { status: 409 })
    }
    throw err
  }

  const customer = await env.DB.prepare(
    `SELECT c.customer_id, c.company_name, c.address, cc.contact_id, cc.contact_name, cc.phone_number
     FROM customer c
     LEFT JOIN customer_contact cc ON cc.customer_id = c.customer_id AND cc.is_primary = 1 AND cc.is_active = 1
     WHERE c.customer_id = ?`,
  )
    .bind(customerId)
    .first<CustomerRow>()

  if (!customer) return json({ error: 'Not found' }, { status: 404 })
  return json({ customer })
}

async function handleDeleteCustomer(
  request: Request,
  env: Env,
  customerId: number,
): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  await env.DB.prepare('UPDATE customer SET is_active = 0 WHERE customer_id = ?')
    .bind(customerId)
    .run()
  await env.DB.prepare('UPDATE customer_contact SET is_active = 0 WHERE customer_id = ?')
    .bind(customerId)
    .run()

  return json({ ok: true })
}

async function handleCreateProduct(request: Request, env: Env): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request
    .json<{ sku_name?: string; unit?: string; suggested_price?: number | null }>()
    .catch(() => null)
  if (!body?.sku_name || !body.unit) {
    return json({ error: 'sku_name and unit are required' }, { status: 400 })
  }

  let result
  try {
    result = await env.DB.prepare(
      'INSERT INTO product (sku_name, unit, suggested_price) VALUES (?, ?, ?)',
    )
      .bind(body.sku_name, body.unit, body.suggested_price ?? null)
      .run()
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return json({ error: 'A product with this SKU name already exists' }, { status: 409 })
    }
    throw err
  }

  const product = await env.DB.prepare(
    'SELECT sku_id, sku_name, unit, suggested_price, is_active FROM product WHERE sku_id = ?',
  )
    .bind(result.meta.last_row_id)
    .first<ProductRow>()

  return json({ product }, { status: 201 })
}

async function handleUpdateProduct(
  request: Request,
  env: Env,
  skuId: number,
): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request
    .json<{ sku_name?: string; unit?: string; suggested_price?: number | null }>()
    .catch(() => null)
  if (!body?.sku_name || !body.unit) {
    return json({ error: 'sku_name and unit are required' }, { status: 400 })
  }

  try {
    await env.DB.prepare(
      'UPDATE product SET sku_name = ?, unit = ?, suggested_price = ? WHERE sku_id = ? AND is_active = 1',
    )
      .bind(body.sku_name, body.unit, body.suggested_price ?? null, skuId)
      .run()
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return json({ error: 'A product with this SKU name already exists' }, { status: 409 })
    }
    throw err
  }

  const product = await env.DB.prepare(
    'SELECT sku_id, sku_name, unit, suggested_price, is_active FROM product WHERE sku_id = ?',
  )
    .bind(skuId)
    .first<ProductRow>()

  if (!product) return json({ error: 'Not found' }, { status: 404 })
  return json({ product })
}

async function handleDeleteProduct(
  request: Request,
  env: Env,
  skuId: number,
): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  await env.DB.prepare('UPDATE product SET is_active = 0 WHERE sku_id = ?').bind(skuId).run()

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
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

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

  if (existing) {
    await env.DB.prepare(
      'UPDATE business SET business_name = ?, business_address = ?, business_contact_person = ?, business_contact_number = ?, business_email = ?, payment_bank_name = ?, payment_account_name = ?, payment_account_number = ? WHERE business_id = ?',
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
        existing.business_id,
      )
      .run()
  } else {
    await env.DB.prepare(
      'INSERT INTO business (business_name, business_address, business_contact_person, business_contact_number, business_email, payment_bank_name, payment_account_name, payment_account_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
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
      )
      .run()
  }

  const business = await env.DB.prepare(
    `SELECT ${BUSINESS_COLUMNS} FROM business ORDER BY business_id ASC LIMIT 1`,
  ).first<BusinessRow>()

  return json({ business })
}

const LOGO_CONTENT_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

async function handleUploadBusinessLogo(request: Request, env: Env): Promise<Response> {
  if (!(await requireAuth(request, env))) return json({ error: 'Unauthorized' }, { status: 401 })

  const contentType = request.headers.get('Content-Type') ?? ''
  const ext = LOGO_CONTENT_TYPES[contentType]
  if (!ext) {
    return json({ error: 'Unsupported image type' }, { status: 400 })
  }

  const existing = await env.DB.prepare(
    'SELECT business_id, business_logo_key FROM business ORDER BY business_id ASC LIMIT 1',
  ).first<{ business_id: number; business_logo_key: string | null }>()

  if (!existing) {
    return json({ error: 'Business not set up yet' }, { status: 400 })
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

async function handleGetBusinessLogo(_request: Request, env: Env): Promise<Response> {
  const business = await env.DB.prepare(
    'SELECT business_logo_key FROM business ORDER BY business_id ASC LIMIT 1',
  ).first<{ business_logo_key: string | null }>()

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
  contact_name_snapshot: string
  total_price: number
  paid_amount: number
  status: string
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
  const year = url.searchParams.get('year')?.trim() || null
  const month = url.searchParams.get('month')?.trim() || null

  const conditions = ['n.is_void = 0']
  const params: (string | number)[] = []

  if (q) {
    conditions.push('(n.customer_company_name_snapshot LIKE ? OR n.contact_name_snapshot LIKE ?)')
    params.push(`%${q}%`, `%${q}%`)
  }
  if (status && ['unpaid', 'partial', 'paid', 'void'].includes(status)) {
    conditions.push(`${BILL_STATUS} = ?`)
    params.push(status)
  }
  if (year && /^\d{4}$/.test(year)) {
    conditions.push('substr(n.nota_date, 1, 4) = ?')
    params.push(year)
  }
  if (month && /^\d{2}$/.test(month)) {
    conditions.push('substr(n.nota_date, 6, 2) = ?')
    params.push(month)
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
            n.contact_name_snapshot, s.total_price, s.paid_amount, ${BILL_STATUS} AS status
     FROM nota n
     ${BILL_JOINS}
     WHERE ${whereClause}
     ORDER BY n.nota_id DESC`

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

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'QRIS', 'Check', 'Other'] as const

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
  contact_name_snapshot: string
  contact_phone_number_snapshot: string
  total_price: number
  paid_amount: number
  status: string
}

interface NotaItemRow {
  nota_item_id: number
  item_name_snapshot: string
  unit_snapshot: string
  qty: number
  price: number
  discount_amount: number
  discount_percent: number
  total_price: number
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
            s.total_price, s.paid_amount, s.status
     FROM nota n
     JOIN nota_summary s ON s.nota_id = n.nota_id
     WHERE n.nota_id = ?`,
  )
    .bind(notaId)
    .first<NotaDetailRow>()

  if (!nota) return json({ error: 'Nota not found' }, { status: 404 })

  const { results: items } = await env.DB.prepare(
    `SELECT nota_item_id, item_name_snapshot, unit_snapshot, qty, price, discount_amount, discount_percent, total_price
     FROM nota_item
     WHERE nota_id = ?
     ORDER BY nota_item_id`,
  )
    .bind(notaId)
    .all<NotaItemRow>()

  return json({ nota: { ...nota, items } })
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
  contact_name?: string
  phone_number?: string
  items?: NotaItemInput[]
}

async function handleCreateNota(request: Request, env: Env): Promise<Response> {
  const session = await requireAuth(request, env)
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json<CreateNotaBody>().catch(() => null)
  if (
    !body?.nota_date ||
    !body.company_name ||
    !body.contact_name ||
    !body.phone_number ||
    !body.items?.length
  ) {
    return json(
      {
        error:
          'nota_date, company_name, contact_name, phone_number and at least one item are required',
      },
      { status: 400 },
    )
  }

  let customer = await env.DB.prepare(
    'SELECT customer_id, company_name, address FROM customer WHERE company_name = ? AND is_active = 1',
  )
    .bind(body.company_name)
    .first<{ customer_id: number; company_name: string; address: string | null }>()

  if (!customer) {
    const created = await env.DB.prepare(
      'INSERT INTO customer (company_name, address) VALUES (?, ?)',
    )
      .bind(body.company_name, body.company_address ?? null)
      .run()
    customer = {
      customer_id: created.meta.last_row_id,
      company_name: body.company_name,
      address: body.company_address ?? null,
    }
  }

  let contact = await env.DB.prepare(
    'SELECT contact_id, contact_name, phone_number FROM customer_contact WHERE customer_id = ? AND is_primary = 1 AND is_active = 1',
  )
    .bind(customer.customer_id)
    .first<{ contact_id: number; contact_name: string; phone_number: string }>()

  try {
    if (contact) {
      if (contact.contact_name !== body.contact_name || contact.phone_number !== body.phone_number) {
        await env.DB.prepare(
          'UPDATE customer_contact SET contact_name = ?, phone_number = ? WHERE contact_id = ?',
        )
          .bind(body.contact_name, body.phone_number, contact.contact_id)
          .run()
      }
      contact = {
        contact_id: contact.contact_id,
        contact_name: body.contact_name,
        phone_number: body.phone_number,
      }
    } else {
      const created = await env.DB.prepare(
        'INSERT INTO customer_contact (customer_id, contact_name, phone_number, is_primary) VALUES (?, ?, ?, 1)',
      )
        .bind(customer.customer_id, body.contact_name, body.phone_number)
        .run()
      contact = {
        contact_id: created.meta.last_row_id,
        contact_name: body.contact_name,
        phone_number: body.phone_number,
      }
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
          'INSERT INTO product (sku_name, unit, suggested_price) VALUES (?, ?, ?)',
        )
          .bind(raw.sku_name, raw.unit, raw.price)
          .run()
        skuId = created.meta.last_row_id
      }
    }

    const qty = raw.qty
    const price = raw.price
    const discountAmount = raw.discount_amount ?? 0
    const discountPercent = raw.discount_percent ?? 0
    const lineTotal = Math.round(qty * price - discountAmount)

    items.push({
      sku_id: skuId,
      item_name_snapshot: raw.sku_name,
      unit_snapshot: raw.unit,
      qty,
      price,
      discount_amount: discountAmount,
      discount_percent: discountPercent,
      total_price: lineTotal,
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
       contact_id, contact_name_snapshot, contact_phone_number_snapshot, total_price, created_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      notaNumber,
      body.nota_date,
      customer.customer_id,
      customer.company_name,
      customer.address,
      contact.contact_id,
      contact.contact_name,
      contact.phone_number,
      totalPrice,
      session.sub,
    )
    .run()

  const notaId = notaResult.meta.last_row_id

  for (const item of items) {
    await env.DB.prepare(
      `INSERT INTO nota_item (
         nota_id, sku_id, item_name_snapshot, unit_snapshot, qty, price, discount_amount, discount_percent, total_price
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        notaId,
        item.sku_id,
        item.item_name_snapshot,
        item.unit_snapshot,
        item.qty,
        item.price,
        item.discount_amount,
        item.discount_percent,
        item.total_price,
      )
      .run()
  }

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

    if (url.pathname === '/auth/login' && request.method === 'POST') {
      return handleLogin(request, env)
    }

    if (url.pathname === '/auth/me' && request.method === 'GET') {
      return handleMe(request, env)
    }

    if (url.pathname === '/customers' && request.method === 'GET') {
      return handleListCustomers(request, env)
    }

    if (url.pathname === '/customers' && request.method === 'POST') {
      return handleCreateCustomer(request, env)
    }

    const customerMatch = url.pathname.match(/^\/customers\/(\d+)$/)
    if (customerMatch) {
      const customerId = Number(customerMatch[1])
      if (request.method === 'PUT') return handleUpdateCustomer(request, env, customerId)
      if (request.method === 'DELETE') return handleDeleteCustomer(request, env, customerId)
    }

    const billPaymentMatch = url.pathname.match(/^\/customers\/(\d+)\/bill-payments$/)
    if (billPaymentMatch) {
      const customerId = Number(billPaymentMatch[1])
      if (request.method === 'GET') return handleListBillPayments(request, env, customerId)
      if (request.method === 'POST') return handleCreateBillPayment(request, env, customerId)
    }

    const paymentMatch = url.pathname.match(/^\/payments\/(\d+)$/)
    if (paymentMatch && request.method === 'DELETE') {
      return handleVoidPayment(request, env, Number(paymentMatch[1]))
    }

    const paymentEvidenceMatch2 = url.pathname.match(/^\/payments\/(\d+)\/evidence$/)
    if (paymentEvidenceMatch2) {
      const paymentId = Number(paymentEvidenceMatch2[1])
      if (request.method === 'PUT') return handleUploadPaymentEvidence(request, env, paymentId)
      if (request.method === 'GET') return handleGetPaymentEvidence(request, env, paymentId)
    }

    if (url.pathname === '/products' && request.method === 'GET') {
      return handleListProducts(request, env)
    }

    if (url.pathname === '/products' && request.method === 'POST') {
      return handleCreateProduct(request, env)
    }

    const productMatch = url.pathname.match(/^\/products\/(\d+)$/)
    if (productMatch) {
      const skuId = Number(productMatch[1])
      if (request.method === 'PUT') return handleUpdateProduct(request, env, skuId)
      if (request.method === 'DELETE') return handleDeleteProduct(request, env, skuId)
    }

    if (url.pathname === '/nota' && request.method === 'GET') {
      return handleListNota(request, env)
    }

    if (url.pathname === '/nota' && request.method === 'POST') {
      return handleCreateNota(request, env)
    }

    if (url.pathname === '/nota/date-range' && request.method === 'GET') {
      return handleGetNotaDateRange(request, env)
    }

    const notaMatch = url.pathname.match(/^\/nota\/(\d+)$/)
    if (notaMatch && request.method === 'GET') {
      return handleGetNota(request, env, Number(notaMatch[1]))
    }

    const notaVoidMatch = url.pathname.match(/^\/nota\/(\d+)\/void$/)
    if (notaVoidMatch && request.method === 'PUT') {
      return handleVoidNota(request, env, Number(notaVoidMatch[1]))
    }

    if (url.pathname === '/nota/pdf-cache' && request.method === 'DELETE') {
      return handleClearNotaPdfCache(request, env)
    }

    const notaPdfMatch = url.pathname.match(/^\/nota\/(\d+)\/pdf$/)
    if (notaPdfMatch) {
      const notaId = Number(notaPdfMatch[1])
      if (request.method === 'GET') return handleGetNotaPdf(request, env, notaId)
      if (request.method === 'PUT') return handlePutNotaPdf(request, env, notaId)
    }


    if (url.pathname === '/business' && request.method === 'GET') {
      return handleGetBusiness(request, env)
    }

    if (url.pathname === '/business' && request.method === 'PUT') {
      return handleUpdateBusiness(request, env)
    }

    if (url.pathname === '/business/logo' && request.method === 'PUT') {
      return handleUploadBusinessLogo(request, env)
    }

    if (url.pathname === '/business/logo' && request.method === 'GET') {
      return handleGetBusinessLogo(request, env)
    }

    return json({ error: 'Not found' }, { status: 404 })
  },
} satisfies ExportedHandler<Env>
