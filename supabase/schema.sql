-- ============================================================
--  The Wanderer Outdoors — Supabase schema
--  ------------------------------------------------------------
--  REPLACES server.js's content.json / bookings.json / admin.json.
--  Run this ONCE in your Supabase project: SQL Editor -> paste ->
--  Run. Then fill assets/js/config.js with your URL + anon key.
--
--  Security model:
--    * Visitors (anon) can READ the site content + SUBMIT bookings.
--    * Only EDITORS can WRITE content / READ bookings.
--    * An editor = the site OWNER (first person to sign up) OR an
--      email the owner added via the admin "Invite editor" button.
--  The anon key ships in the browser but Row Level Security above
--  is what actually enforces this — the key alone cannot write.
-- ============================================================

-- ---------- helpers ----------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin
  );
$$;

create or replace function public.can_edit()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select true from public.profiles p where p.id = auth.uid() and p.is_admin),
    (select auth.jwt() ->> 'email' = any(s.editors)
       from public.site_settings s where s.id = 'main'),
    false
  );
$$;

-- ---------- profiles (mirrors auth.users; first user = owner) ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles readable"        on public.profiles;
drop policy if exists "own profile updatable"    on public.profiles;
drop policy if exists "own profile insertable"   on public.profiles;

create policy "profiles readable"      on public.profiles for select using (true);
create policy "own profile updatable"  on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "own profile insertable" on public.profiles
  for insert with check (auth.uid() = id);

-- auto-create a profile on signup; the FIRST user becomes the owner
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, is_admin, created_at)
  values (
    new.id,
    new.email,
    (select count(*) from public.profiles) = 0,   -- true only for the very first user
    now()
  );
  return new;
end;
$$;

drop trigger if exists on_new_user on auth.users;
create trigger on_new_user
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- site_settings (editors list + optional view lock) ----------
create table if not exists public.site_settings (
  id            text primary key default 'main',
  editors       text[] not null default '{}',
  view_passcode text,
  updated_at    timestamptz not null default now()
);

alter table public.site_settings enable row level security;

drop policy if exists "settings public read"  on public.site_settings;
drop policy if exists "settings owner write"  on public.site_settings;

create policy "settings public read" on public.site_settings for select using (true);
create policy "settings owner write" on public.site_settings
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.site_settings (id, editors, view_passcode)
values ('main', '{}', null)
on conflict (id) do nothing;

-- ---------- site_content (the whole editable site state) ----------
-- The legacy app saved one big JSON blob; we keep that exact shape here
-- so the front-end code is unchanged. Images are stored as base64 inside
-- `data`, so no separate file storage is required.
create table if not exists public.site_content (
  id         text primary key default 'main',
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.site_content enable row level security;

drop policy if exists "content public read" on public.site_content;
drop policy if exists "content editor write" on public.site_content;

create policy "content public read" on public.site_content for select using (true);
create policy "content editor write" on public.site_content
  for all using (public.can_edit()) with check (public.can_edit());

-- ---------- bookings (public enquiry submissions) ----------
create table if not exists public.bookings (
  id         uuid primary key default gen_random_uuid(),
  ref        text,
  received_at timestamptz,
  name       text,
  age        text,
  email      text,
  phone      text,
  date       text,
  people     text,
  type       text,
  package    text,
  notes      text,
  payment    text,
  source     text default 'web'
);

alter table public.bookings enable row level security;

drop policy if exists "bookings public submit" on public.bookings;
drop policy if exists "bookings editor read"   on public.bookings;

-- anyone (logged out visitor) may submit a booking enquiry
create policy "bookings public submit" on public.bookings for insert with check (true);
-- only editors may read the enquiry inbox
create policy "bookings editor read" on public.bookings
  for select using (public.can_edit());

-- ---------- image storage (recommended) ----------
-- The Control Room uploads images here. The bucket is PUBLIC so the site can
-- display them; only SIGNED-IN EDITORS may upload/delete (via can_edit()).
insert into storage.buckets (id, name, public)
values ('site-images', 'site-images', true)
on conflict (id) do nothing;

drop policy if exists "site-images public read"  on storage.objects;
drop policy if exists "site-images editor write" on storage.objects;

create policy "site-images public read"
  on storage.objects for select using (bucket_id = 'site-images');
create policy "site-images editor write"
  on storage.objects for all to authenticated
  using  (bucket_id = 'site-images' and public.can_edit())
  with check (bucket_id = 'site-images' and public.can_edit());

-- ============================================================
--  Done. Next:
--   1. Authentication -> Settings -> enable "Allow new users to sign up"
--      (or add users manually). The first sign-up becomes the owner.
--   2. Put your Project URL + anon key into assets/js/config.js.
--   3. Open the site, click "Edit", sign in — your edits now save to
--      Supabase and update the live site for everyone.
--   4. Storage: this SQL creates the "site-images" bucket. If it errors,
--      create it manually in Dashboard -> Storage -> New bucket
--      (name exactly "site-images", set Public).
-- ============================================================
