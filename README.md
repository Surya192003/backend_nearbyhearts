# NearbyHearts Backend

Fastify + Postgres. Routes to be written incrementally.

## Setup

    createdb nearbyhearts
    psql -d nearbyhearts -f ../db/schema.sql
    psql -d nearbyhearts -f ../db/seed.sql

    cp .env.example .env
    # edit .env if your DB isn't localhost
    npm install
    npm run dev

Server on http://localhost:4000.

## Verify

    curl http://localhost:4000/health
    # {"ok":true,"db":true,"time":"..."}

`"db": false` means the server is up but Postgres isn't reachable —
check DATABASE_URL.

## Adding a route

1. Write the handler in `src/routes/index.ts`
2. It runs a query via `pool.query(...)` from `src/db.ts`
3. In the frontend, update the matching `src/services/*.ts` to call
   `apiPost('/your/route', payload)` — signature stays identical

## Not here

Photos, strips, and partner photos stay in IndexedDB. Live calls use
PeerJS. Neither goes through this server.