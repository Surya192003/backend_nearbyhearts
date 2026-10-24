import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import { pool } from './db.js'
import { config } from './config.js'
import { registerRoutes } from './routes/index.js'
import { attachUser } from './middleware/auth.js'

async function main(): Promise<void> {
  const app = Fastify({
    logger: true,
    trustProxy: true, // Render terminates TLS in front of you
  })

  await app.register(cookie)
  await app.register(cors, {
    origin: [config.frontendOrigin],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })

  app.addHook('preHandler', attachUser)
  await registerRoutes(app)

  app.addHook('onClose', async () => {
    await pool.end()
  })

  try {
    await app.listen({ port: config.port, host: config.host })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main()