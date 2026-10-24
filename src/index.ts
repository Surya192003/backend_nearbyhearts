import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import { pool } from './db.js'
import { config } from './config.js'
import { registerRoutes } from './routes/index.js'
import { attachUser } from './middleware/auth.js'

const allowedOrigins = [
  config.frontendOrigin,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'https://nearbyhearts.onrender.com',
].filter((v, i, a): v is string => Boolean(v) && a.indexOf(v) === i)

async function main(): Promise<void> {
  const app = Fastify({
    logger: true,
    trustProxy: true,
  })

  await app.register(cookie)

  await app.register(cors, {
    origin: (origin, cb) => {
      // No Origin header = same-origin or non-browser client (curl, Postman)
      if (!origin) {
        cb(null, true)
        return
      }
      const allowed = allowedOrigins.includes(origin)
      if (!allowed) {
        app.log.warn({ origin, allowedOrigins }, 'CORS: rejected unknown origin')
      }
      cb(null, allowed)
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  })

  app.addHook('preHandler', attachUser)
  await registerRoutes(app)

  app.addHook('onClose', async () => {
    await pool.end()
  })

  try {
    await app.listen({ port: config.port, host: config.host })
    app.log.info(
      { allowedOrigins, isProd: config.isProd },
      'CORS origins configured',
    )
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main()