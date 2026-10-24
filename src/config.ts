const isProd = process.env.NODE_ENV === 'production'

function normaliseOrigin(value: string): string {
  return value.replace(/\/+$/, '')
}

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  host: '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL ?? '',
  databaseSsl: process.env.DATABASE_SSL === 'true',
  frontendOrigin: normaliseOrigin(
    process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  ),
  sessionCookie: {
    name: 'nh_session',
    httpOnly: true,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    secure: isProd,
    path: '/',
  },
}