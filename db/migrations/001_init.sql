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

alter table businesses add column if not exists postal_code text;
alter table businesses add column if not exists source_id text;
alter table businesses add column if not exists hiring_checked_at timestamptz;

update businesses
set postal_code = substring(address from '([0-9]{5})')
where postal_code is null
  and address ~ '[0-9]{5}';

create unique index if not exists businesses_source_id_idx
  on businesses (source, source_id)
  where source_id is not null;

create table if not exists place_fetches (
  id text primary key,
  latitude double precision not null,
  longitude double precision not null,
  radius_km double precision not null,
  categories text not null,
  fetched_at timestamptz not null default now(),
  place_count integer not null default 0
);

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

alter table community_leads add column if not exists device_id text;
alter table community_leads add column if not exists account_id text;
alter table community_leads add column if not exists confirm_done integer not null default 0;

create table if not exists lead_confirmations (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null references community_leads (id),
  user_id uuid not null references users (id),
  status text not null,
  created_at timestamptz not null default now(),
  unique (lead_id, user_id)
);

alter table lead_confirmations alter column user_id drop not null;
alter table lead_confirmations add column if not exists device_id text;
alter table lead_confirmations add column if not exists account_id text;
create unique index if not exists lead_confirmations_device_idx on lead_confirmations (lead_id, device_id) where device_id is not null;
create unique index if not exists lead_confirmations_account_idx on lead_confirmations (lead_id, account_id) where account_id is not null;

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

create table if not exists wall_notes (
  id text primary key,
  user_id uuid not null,
  display_name text not null,
  body text not null,
  color text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create unique index if not exists wall_notes_user_idx on wall_notes (user_id);

alter table wall_notes alter column user_id drop not null;
alter table wall_notes add column if not exists device_id text;
create unique index if not exists wall_notes_device_idx on wall_notes (device_id) where device_id is not null;

update wall_notes set status = 'approved' where status = 'pending';

create table if not exists wall_reactions (
  note_id text not null references wall_notes (id) on delete cascade,
  device_id text not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (note_id, device_id)
);

insert into wall_notes (id, display_name, body, color, status)
values
  ('wall_ex_01', 'jobrador', 'I opened another listing page and missed the café nearby', '#c6f56e', 'approved'),
  ('wall_ex_02', 'jobrador', 'I kept ten open tabs for one Minijob and never saw how far it was', '#ff8ad4', 'approved'),
  ('wall_ex_03', 'jobrador', 'I sorted newest first and lost the job two stops away', '#6eb8f5', 'approved'),
  ('wall_ex_04', 'jobrador', 'Nothing was posted, so I walked over and asked', '#ffb56b', 'approved'),
  ('wall_ex_05', 'jobrador', 'I found it on a list and opened the posting from the map', '#ffe56a', 'approved'),
  ('wall_ex_06', 'jobrador', 'I knew the job title and still had no distance from where I was', '#e2b0f6', 'approved'),
  ('wall_ex_07', 'jobrador', 'It was just another tab until the pin sat on my route', '#8ee0cf', 'approved')
on conflict (id) do nothing;

update wall_reactions set emoji = '❤️' where emoji = '💛';

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_url text not null,
  source_type text not null,
  active boolean not null default true,
  last_checked_at timestamptz
);
