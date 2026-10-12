import bcrypt from 'bcryptjs'
import { getBearerToken, signSession, verifySession } from './auth'

export interface Env {
  DB: D1Database
  JWT_SECRET: string
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
    'SELECT sku_id, sku_name, unit, suggested_price, is_active FROM product WHERE is_active = 1 ORDER BY sku_name',
  ).all<ProductRow>()

  return json({ products: results })
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message)
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

    return json({ error: 'Not found' }, { status: 404 })
  },
} satisfies ExportedHandler<Env>
