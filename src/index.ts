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

    return json({ error: 'Not found' }, { status: 404 })
  },
} satisfies ExportedHandler<Env>
