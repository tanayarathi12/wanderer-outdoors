-- ============================================================
--  The Wanderer Outdoors — ADD-ON MIGRATION (run AFTER schema.sql)
--  ------------------------------------------------------------
--  Adds columns + a SECURE per-booking lookup function so the
--  public "View receipt online" link can fetch ONE booking by an
--  unguessable token WITHOUT exposing every booking to the world.
--
--  This migration is NON-DESTRUCTIVE:
--    * only ADDs columns (all with safe defaults),
--    * uses a PARTIAL unique index so existing rows are untouched,
--    * does not drop or reset any data,
--    * does not disable Row Level Security.
--
--  HOW TO RUN:  Supabase Dashboard -> SQL Editor -> paste -> Run.
--  (Safe to run more than once — every statement is idempotent.)
-- ============================================================

-- ---------- 1. New columns on bookings (all optional / defaulted) ----------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='status') then
    alter table public.bookings add column status text not null default 'NEW';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='payment_status') then
    alter table public.bookings add column payment_status text not null default 'NOT REQUIRED';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='txn_ref') then
    alter table public.bookings add column txn_ref text;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='amount') then
    alter table public.bookings add column amount text;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='receipt_token') then
    alter table public.bookings add column receipt_token text;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='verified') then
    alter table public.bookings add column verified boolean not null default false;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='receipt_sent') then
    alter table public.bookings add column receipt_sent boolean not null default false;
  end if;
end $$;

-- ---------- 2. Partial unique index on receipt_token (nulls ignored) ----------
-- Uniqueness is only enforced when a token is present, so this never
-- fails on legacy rows that have no token.
create unique index if not exists bookings_receipt_token_uidx
  on public.bookings (receipt_token)
  where receipt_token is not null;

-- ---------- 3. SECURE per-booking lookup by unguessable token ----------
-- SECURITY DEFINER => runs with owner privileges and BYPASSES RLS, but
-- the function body only ever returns the single row whose token matches.
-- Visitors (anon) are granted EXECUTE, yet they can never list all rows
-- or read a row whose token they do not already possess.
create or replace function public.get_booking_by_token(p_token text)
returns setof public.bookings
language sql
stable
security definer
set search_path = public
as $$
  select * from public.bookings
  where p_token ~ '^[0-9a-fA-F]{48}$'
    and (
      receipt_token = p_token
      or position('ReceiptToken: ' || p_token in coalesce(special_req, '')) > 0
    )
  limit 1;
$$;

-- Allow the public website (anonymous visitors) to call the function.
-- (EXECUTE is granted to PUBLIC by default, but we make it explicit & safe.)
grant execute on function public.get_booking_by_token(text) to anon;
grant execute on function public.get_booking_by_token(text) to authenticated;

-- ---------- 4. Keep RLS intact (no changes, documented for clarity) ----------
-- The original policies remain:
--   "bookings public submit"  -> anon may INSERT a booking enquiry
--   "bookings editor read"    -> only editors (can_edit()) may SELECT *
-- Visitors reach a single receipt ONLY through get_booking_by_token(),
-- which returns at most one row and requires the secret token. The function
-- also checks the ReceiptToken metadata in special_req so receipts created
-- before this migration continue to work without data loss.
-- ============================================================
--  Done. No data was deleted or altered. Only new, empty-by-default
--  columns and one read-scoped function were added.
-- ============================================================
