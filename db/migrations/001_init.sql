-- Applied by the API on startup. The website never connects to this database.
-- Ids are text so sample records can keep stable ids such as biz_abc.

create extension if not exists postgis;
create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text,
  city text,
  created_at timestamptz not null default now()
);

create table if not exists businesses (
  id text primary key,
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

create index if not exists businesses_location_idx on businesses using gist (location);

create table if not exists jobs (
  id text primary key,
  business_id text not null references businesses (id),
  title text not null,
  job_type text not null,
  category text not null,
  description_summary text not null,
  salary_min double precision,
  salary_max double precision,
  salary_period text,
  hours_min double precision,
  hours_max double precision,
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

create index if not exists jobs_location_idx on jobs using gist (location);
create index if not exists jobs_status_idx on jobs (status);
create unique index if not exists jobs_source_external_idx on jobs (source_name, external_id)
  where external_id is not null;

create table if not exists community_leads (
  id text primary key,
  business_id text references businesses (id),
  business_name text not null,
  title text not null,
  description text not null,
  job_type text not null,
  category text not null,
  address text not null,
  city text not null,
  area text,
  latitude double precision not null,
  longitude double precision not null,
  location geography(Point, 4326) not null,
  reported_by uuid references users (id),
  photo_url text,
  source_url text,
  status text not null default 'ACTIVE',
  confirm_yes integer not null default 0,
  confirm_no integer not null default 0,
  confirm_unsure integer not null default 0,
  salary_min double precision,
  salary_period text,
  hours_min double precision,
  hours_max double precision,
  language_requirements jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists community_leads_location_idx on community_leads using gist (location);

create table if not exists lead_confirmations (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null references community_leads (id),
  user_id uuid not null references users (id),
  status text not null,
  created_at timestamptz not null default now(),
  unique (lead_id, user_id)
);

create table if not exists saved_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id),
  job_id text not null references jobs (id),
  created_at timestamptz not null default now(),
  unique (user_id, job_id)
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users (id),
  target_type text not null,
  target_id text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_url text not null,
  source_type text not null,
  active boolean not null default true,
  last_checked_at timestamptz
);
