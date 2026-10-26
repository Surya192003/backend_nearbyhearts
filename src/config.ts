const isProd = process.env.NODE_ENV === 'production'

function normaliseOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

const rawFrontendOrigin = normaliseOrigin(
  process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
)

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  host: '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL ?? '',
  databaseSsl: process.env.DATABASE_SSL === 'true',
  frontendOrigin: rawFrontendOrigin,
  sessionCookie: {
    name: 'nh_session',
    httpOnly: true,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    secure: isProd,
    path: '/',
  },
}

// Always log — this is the single most useful debugging line when cookies
// go missing. Never gate it on isProd.
console.log('[config] FRONTEND_ORIGIN =', JSON.stringify(rawFrontendOrigin))
console.log('[config] origin is HTTPS  =', originIsHttps)
console.log('[config] NODE_ENV         =', process.env.NODE_ENV ?? '(unset)')
console.log('[config] cookie sameSite   =', config.sessionCookie.sameSite)
console.log('[config] cookie secure     =', config.sessionCookie.secure)
console.log('[config] DATABASE_SSL      =', config.databaseSsl)