# jobrador-b

API for Student Job Map. The website in `jobrador-f` is the only client. This service owns search, labels, and stored facts.

The current data is an in-memory Berlin sample. Every payload includes `"dataSource": "mock"`. Nothing here is a live vacancy.

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
src/data        sample Berlin places
src/lib         distance and labels
db/migrations   Postgres + PostGIS schema for later
api/index.ts    Vercel serverless entry
```

`src/workers/` is intentionally absent until a permitted job source needs scheduled checks. Add that folder here. Do not start a third repo for it.

## Database

`db/migrations/001_init.sql` is the future Supabase schema. The dev server does not connect to it yet. New leads and confirmation votes live in memory and reset when the process restarts.

## Deploy

Vercel can host this repo as serverless functions. `vercel.json` rewrites every path to the Hono app in `api/index.ts`. Set `FRONTEND_ORIGIN` to the deployed website URL.
