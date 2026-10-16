import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const token = readFileSync(join(here, '..', '.cf-token'), 'utf8').trim()

const child = spawn('npx', ['wrangler', 'dev', '--port', '8787', '--remote'], {
  stdio: 'inherit',
  cwd: join(here, '..'),
  env: { ...process.env, CLOUDFLARE_API_TOKEN: token },
})

child.on('exit', (code) => process.exit(code ?? 0))
