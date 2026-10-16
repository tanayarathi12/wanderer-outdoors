-- The Wanderer Outdoors — least-privilege Data API grants
-- Run this in the EXISTING Supabase project's SQL Editor only after reviewing.
-- This does NOT change tables, rows, constraints, or RLS policies.
-- RLS remains responsible for restricting rows to is_admin() users.

GRANT SELECT, UPDATE ON TABLE public.bookings TO authenticated;
GRANT SELECT ON TABLE public.enquiries TO authenticated;
