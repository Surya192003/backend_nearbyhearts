# NearbyHearts — Database

PostgreSQL 14+. Tested against 16.

## Setup

    createdb nearbyhearts
    psql -d nearbyhearts -f db/schema.sql
    psql -d nearbyhearts -f db/seed.sql

## Connection

Add to `.env`:

    DATABASE_URL=postgres://localhost:5432/nearbyhearts

Never commit `.env`.

## What lives here

| Table | Wired to | Notes |
|---|---|---|
| users | authService | bcrypt hashes; app hashes, DB stores |
| sessions | authService | opaque token hashes; app generates |
| couples | (all) | one row per couple, canonical user order |
| feed_items | feedService.list/create | |
| feed_reactions | feedService.react | toggle = INSERT/DELETE |
| messages | chatService | read_at = NULL means unread |
| gifts | giftService.catalog | seeded, not user-editable |
| sent_gifts | giftService.send/listSent | |
| donations | donationService.submit | `provider_ref` for real Stripe later |
| photo_quota | photoboothService | **server-enforced**, changes client behavior |

## What does NOT live here

- **Photos / strips** — stay in IndexedDB. Adding them requires client-side E2E encryption first.
- **Video call sessions** — ephemeral by design; PeerJS handles signaling.
- **Partner photos** — per-device, stays in IndexedDB.

## Backend still needed

This schema is the persistence layer. It does not include an API. The
existing frontend currently talks to mock services. To connect:

1. Stand up a Node/Express (or Fastify) server with `pg` or `postgres`
2. Implement one route per service method (matching payloads in `src/types/index.ts`)
3. Update `src/services/*.ts` to `fetch` those routes instead of returning mocks
4. For chat real-time: `LISTEN/NOTIFY` on a `messages` channel + WebSocket, or Supabase Realtime

## Production checklist

- [ ] Rotate `secret123` seed password
- [ ] Use a managed Postgres (RDS / Neon / Supabase) with connection pooling
- [ ] Add `sslmode=require` to `DATABASE_URL`
- [ ] Move `password_hash` from bcrypt to argon2id (use app-level hashing)
- [ ] Enable Row-Level Security once a real auth layer issues session tokens
- [ ] Set `photo_quota` retention policy (e.g. drop rows older than 30 days)
- [ ] Backups + PITR enabled