export interface SessionPayload {
  sub: string
  username: string
  name: string
  role: string
  must_change_password: boolean
  exp: number
}

function base64url(data: ArrayBuffer | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(str.length / 4) * 4, '=')
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const signingInput = `${header}.${body}`
  const key = await hmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${base64url(signature)}`
}

export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, signature] = parts
  const key = await hmacKey(secret)
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64urlDecode(signature),
    new TextEncoder().encode(`${header}.${body}`),
  )
  if (!valid) return null

  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(body))) as SessionPayload
  if (payload.exp < Date.now() / 1000) return null
  return payload
}

export function getBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization')
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length)
}
