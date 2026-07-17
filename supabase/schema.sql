-- Run this in Supabase: Project -> SQL Editor -> New query -> paste -> Run.

create table if not exists kv_store (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table kv_store enable row level security;

-- These three policies make kv_store fully readable AND writable by
-- anyone holding your Supabase anon key. That key ships inside your
-- deployed app's JS bundle, so in practice this means: anyone with the
-- app URL can read and modify all fault codes, properties, and job
-- schedules. That is the direct tradeoff for a share-with-anyone,
-- no-login app. See the README "Security tradeoff" section before
-- deciding this is what you want.

create policy "Allow public read" on kv_store
  for select
  using (true);

create policy "Allow public insert" on kv_store
  for insert
  with check (true);

create policy "Allow public update" on kv_store
  for update
  using (true);
