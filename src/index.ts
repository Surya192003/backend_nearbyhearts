import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import { pool } from './db.js'
import { config } from './config.js'
import { registerRoutes } from './routes/index.js'
import { attachUser } from './middleware/auth.js'
import path from 'path'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'fs'

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
  const distPath = path.resolve(process.cwd(), '../dist')
  if (existsSync(distPath)) {
    await app.register(fastifyStatic, {
      root: distPath,
      prefix: '/',
      wildcard: false,
    })

    app.setNotFoundHandler((req, reply) => {
      // API + health keep returning JSON 404s
      if (req.url.startsWith('/api/') || req.url === '/health') {
        return reply.code(404).send({ error: 'Not found' })
      }
      // Everything else gets the SPA shell
      if (req.method === 'GET') {
        return reply.sendFile('index.html')
      }
      reply.code(404).send({ error: 'Not found' })
    })
  }

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