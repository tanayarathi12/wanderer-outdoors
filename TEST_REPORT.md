# The Wanderer Outdoors — Current Code Review Report

Review date: 12 October 2026  
Scope: static code review and syntax checks of the supplied project package. This is **not** a claim that live Supabase, WhatsApp, Google indexing, or every browser interaction was end-to-end tested.

## Changes made in this package

| Area | Change | Verification status |
|---|---|---|
| Blog detail pages | Added explicit `/blog/:slug` route handling; articles can be found by slug, ID, or slugified title. Added the excerpt to the full article view and improved safe Markdown rendering. | JavaScript syntax checked; live click-through still needs local browser test. |
| Booking confirmation | Removed automatic WhatsApp pop-up on form submission. Customer now sees the confirmation card and can choose the WhatsApp action or receipt option. | JavaScript syntax checked; live booking flow still needs test. |
| Updated receipt | Receipt display now normalizes the actual `bookings` row fields (`trip_title`, `trip_kind`, `travel_date`, `created_at`, `special_req`) and reads payment/amount/transaction/token metadata from `special_req`. Control Room View Receipt now extracts the stored token. | JavaScript syntax checked. Public lookup requires the included receipt migration to be run once in Supabase. |
| Receipt migration | Secure lookup function accepts only a 48-character hex token and matches both `receipt_token` and existing `ReceiptToken` metadata in `special_req`. This preserves receipts created before the migration. | SQL reviewed, not executed against the live project. |
| SEO settings | Confirmed Control Room `Save to site` writes the whole state, including `seo`, into Supabase `site_content`; the public app reads that state and applies supported metadata on load. Updated help text to explain recrawling/social-preview limitations. | Code-path review; live save/reload should still be tested in Control Room. |
| Sitemap & robots | Corrected sitemap to list the canonical homepage only; hash-based SPA sections are not separate sitemap URLs. Updated Control Room text so it does not imply that opening the files verifies Google indexing. | XML sitemap parsed successfully. Google Search Console verification/submission is a separate manual step after domain launch. |
| Mobile layouts | Added responsive rules for blog cards/articles, booking confirmation, receipt actions/table, and Control Room navigation/table overflow. | CSS reviewed; actual device/browser testing remains required. |
| Supabase backend | Kept existing connection and booking schema strategy; no live database was modified by this package review. | `app.js`, `assets/js/backend.js`, and `admin/assets/js/app.js` passed `node --check`. |

## Required before public launch

1. Extract this package to a **new working copy**; do not overwrite the backup.
2. Run `supabase/migration_receipts_payments_v2.sql` once in the existing Supabase project's SQL Editor. It is additive/non-destructive, but any live SQL change should be reviewed before running. Do not run `supabase/schema.sql` over the existing database.
3. Test one booking on localhost, confirm it appears in Control Room, mark its payment as received, then open the **same token-based receipt link** in a private/incognito window and confirm the receipt now says `PAID`.
4. Test blog card → full article, SEO edit → Save to site → public refresh, enquiry submission, payment choices, receipt download/print, and desktop/mobile widths.
5. Deploy to a Vercel preview and repeat the core tests before connecting the GoDaddy domain.

## Known SEO limitation

The current public site is a JavaScript single-page app with hash-based sections. Control Room SEO fields are persisted in Supabase and applied client-side, but social preview crawlers may not execute JavaScript, and hash routes are not separate crawlable URLs. For stronger per-page SEO and dependable social previews, a later phase should add clean URLs and server-rendered/static metadata. `robots.txt` and `sitemap.xml` do not themselves verify a site in Google Search Console.
