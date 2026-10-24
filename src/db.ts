import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Check backend/.env or the Render env.',
  )
}

const useSsl = process.env.DATABASE_SSL === 'true'
const caPath = join(__dirname, '..', 'certs', 'aiven-ca.pem')

export const pool = new Pool({
  connectionString,
  ssl: useSsl
    ? { rejectUnauthorized: true, ca: readFileSync(caPath, 'utf8') }
    : false,
  max: 10,
})

export async function pingDb(): Promise<boolean> {
  const r = await pool.query<{ ok: number }>('SELECT 1 AS ok')
  return r.rows[0]?.ok === 1
}