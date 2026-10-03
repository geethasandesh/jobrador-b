# jobrador-b

API for jobrador. The website in `jobrador-f` is the only client. This service owns search, labels, and stored facts.

Places live only in Supabase Postgres with PostGIS. The API does not keep a copy of the listings in the repo. The current rows are still the Berlin sample, so every payload includes `"dataSource": "mock"`. Nothing here is a live vacancy.

Copy `.env.example` to `.env` and set `DATABASE_URL` to the URI from Supabase: Project Settings → Database → Connection string. Use the session pooler or the direct connection. The API creates the tables on startup if they are missing.

## Run

```bash
npm install
npm run dev
```

The API listens on [http://localhost:4000](http://localhost:4000).

```bash
curl "http://localhost:4000/v1/opportunities?lat=52.497&lng=13.423&radiusKm=5"
```

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/health` | Process is up |
| GET | `/v1/opportunities` | Map and list search |
| GET | `/v1/jobs/:id` | Job listing detail |
| GET | `/v1/businesses/:id` | Business, its jobs, and its leads |
| GET | `/v1/leads/:id` | Community lead detail |
| POST | `/v1/leads` | Submit a community lead |
| POST | `/v1/leads/:id/confirmations` | Vote yes, no, or unsure |

Search accepts `lat`, `lng`, `radiusKm`, `q`, `jobType`, `category`, `kinds`, `language`, `salary`, and `sort` (`distance` or `newest`).

Salary and language lines are omitted when the source did not provide them. Expired jobs stay out of map results.

## Layout

```text
src/http        request parsing and routes
src/modules     search and record rules
src/db          Supabase connection, migration, and queries
src/lib         distance and labels
src/ingest      listing ingest
db/migrations   Postgres + PostGIS schema
src/index.ts    local server. Its timer runs only while this process stays up.
api/index.ts    Vercel entry
```

On your own machine, `npm start` schedules ingest at 07:00 and 19:00 Berlin time. That timer stops when the process stops.

## Database

`db/migrations/001_init.sql` runs when the API starts. New leads and confirmation votes stay in Supabase.

## Deploy

Deploy this repo on Vercel. `vercel.json` sends every request to the Hono app and schedules `GET /v1/ingest` once a day at 05:00 UTC. On the free plan that is the limit: one run a day, sometime during that hour. In summer that is about 07:00 in Berlin. In winter it is about 06:00. A second run the same day is rejected on the free plan.

In the Vercel project settings, set `DATABASE_URL`, `FRONTEND_ORIGIN`, and `CRON_SECRET`. Vercel attaches `CRON_SECRET` to the cron request. Without that value, the ingest route refuses to run. Do not commit the secret.

The website in `jobrador-f` calls this API through `NEXT_PUBLIC_API_URL`.
