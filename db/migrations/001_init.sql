-- Schema for the real database. The running API still uses in-memory sample data.
-- Apply this in Supabase (or any Postgres with PostGIS) when live data starts.
-- The frontend must keep talking to this API, not to the database directly.

create extension if not exists postgis;
create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text,
  city text,
  created_at timestamptz not null default now()
);

create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  address text not null,
  city text not null,
  area text,
  latitude double precision not null,
  longitude double precision not null,
  location geography(Point, 4326) not null,
  phone text,
  website text,
  opening_hours text,
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index businesses_location_idx on businesses using gist (location);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id),
  title text not null,
  job_type text not null,
  category text not null,
  description_summary text not null,
  salary_min numeric,
  salary_max numeric,
  salary_period text,
  hours_min numeric,
  hours_max numeric,
  language_requirements jsonb,
  latitude double precision not null,
  longitude double precision not null,
  location geography(Point, 4326) not null,
  source_name text not null,
  source_url text not null,
  external_id text,
  posted_at timestamptz,
  expires_at timestamptz,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_location_idx on jobs using gist (location);
create index jobs_status_idx on jobs (status);
create unique index jobs_source_external_idx on jobs (source_name, external_id)
  where external_id is not null;

create table community_leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses (id),
  title text not null,
  description text not null,
  job_type text not null,
  category text not null,
  address text not null,
  latitude double precision not null,
  longitude double precision not null,
  location geography(Point, 4326) not null,
  reported_by uuid references users (id),
  photo_url text,
  source_url text,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);

create index community_leads_location_idx on community_leads using gist (location);

create table lead_confirmations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references community_leads (id),
  user_id uuid not null references users (id),
  status text not null,
  created_at timestamptz not null default now(),
  unique (lead_id, user_id)
);

create table saved_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id),
  job_id uuid not null references jobs (id),
  created_at timestamptz not null default now(),
  unique (user_id, job_id)
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users (id),
  target_type text not null,
  target_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_url text not null,
  source_type text not null,
  active boolean not null default true,
  last_checked_at timestamptz
);
