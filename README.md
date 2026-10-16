# The Wanderer Outdoors — Complete Website, Control Room & Deployment Guide

Welcome to the production deployment guide for **The Wanderer Outdoors** (`https://www.wandereroutdoors.in`).

This project is a modern, responsive website featuring hand-crafted Himalayan & Sahyadri treks, winter & summer camps, tours, day outings, corporate offsites, trail blogs, traveller reviews, an interactive booking system with WhatsApp confirmation, branded PDF receipts, and an administrative **Control Room** (`/admin/`).

Everything runs on clean modern HTML5/CSS3/JavaScript with zero compulsory build steps, pre-configured for instant deployment on **GitHub + Vercel**, and connected to your custom **GoDaddy domain**.

---

## 1. Quick Summary of Project Architecture

- **Public Website (`index.html`, `app.js`, `styles.css`):**
  - Starts strictly in visitor mode by default on every page load and refresh.
  - Full client-side routing with clean URLs and hash fallback (`/treks`, `/winter-camps`, `/summer-camps`, `/tours`, `/outings`, `/corporate`, `/gallery`, `/reviews`, `/blog`, `/faq`, `/contact`, `/booking`).
  - No public Edit link or public-page editing interface.
  - Universal "Book Now" buttons on all trip cards and detail pages across every category.
  - Dynamic payment engine: displays configured UPI ID, UPI QR code, payment link, instructions, and respects per-activity Cash / Pay Later settings.
  - Branded PDF receipt generation (jsPDF) with honest payment status tracking and secure tokenized receipts.
- **Control Room (`admin/`):**
  - Protected admin panel for managing site content, trips, itineraries, gear, pricing, image uploads to Supabase Storage, default & per-trip payment rules, booking inbox, and SEO settings.
- **Database & Storage (`assets/js/backend.js`, `supabase/`):**
  - Directly connects to your existing Supabase project. **Your existing Supabase schema, data, authentication, storage, and security policies are completely preserved and unharmed.**
- **Serverless API (`api/google-reviews.js` & `vercel.json`):**
  - Native Vercel Serverless Function proxying Google Places API reviews while keeping your secret API key safely server-side.

---

## 2. GitHub Deployment (Step-by-Step for Beginners)

If you are new to GitHub, follow these exact steps:

### Option A: Using GitHub Desktop (Easiest)
1. Download and install [GitHub Desktop](https://desktop.github.com/).
2. Log in with your GitHub account.
3. Click **File** → **Add Local Repository...**
4. Choose this project folder: `c:\Users\tanay\OneDrive\Desktop\wanderer-outdoors-rewired - newAGclaude-FINAL`.
5. If it asks to create a repository, click **Create a Repository here**. Name it `wanderer-outdoors`.
6. Click **Publish repository** to push it to your GitHub account (you can make it Public or Private).

### Option B: Using the GitHub Website (Drag-and-Drop)
1. Log in to [github.com](https://github.com) and click **New Repository**.
2. Name it `wanderer-outdoors` and click **Create repository**.
3. Under "Quick setup", click **uploading an existing file**.
4. Drag and drop all the files from this folder and click **Commit changes**.

> 💡 **Notice:** Your `.gitignore` is already set up to ensure temporary files, cache, and secrets (`.env`) are never uploaded to GitHub.

---

## 3. Vercel Deployment (Step-by-Step)

Vercel provides blazing-fast global edge hosting with free SSL, automatic serverless functions, and zero configuration for this project.

1. Sign up or log in at [vercel.com](https://vercel.com).
2. Click **Add New...** → **Project**.
3. Under **Import Git Repository**, find your `wanderer-outdoors` repository and click **Import**.
4. Configure Project Settings:
   - **Framework Preset:** `Other` (or leave default auto-detected).
   - **Root Directory:** `./` (default).
   - **Build Command:** Leave blank (no build step required).
   - **Output Directory:** Leave blank (served directly from repository root).
5. **Environment Variables:**
   - Under the **Environment Variables** section, add the following (see `.env.example`):
     - `GOOGLE_PLACES_API_KEY`: *(Your Google Cloud Places API key — only required if using live Google Reviews)*
     - `SITE_ORIGIN`: `https://www.wandereroutdoors.in`
6. Click **Deploy**.
7. Vercel will deploy your website in less than 30 seconds! It will provide you with a `.vercel.app` preview URL where you can immediately test everything.

---

## 4. GoDaddy Domain & DNS Configuration (`www.wandereroutdoors.in`)

Your production website uses the canonical domain `https://www.wandereroutdoors.in`, with apex redirect from `https://wandereroutdoors.in`.

### Step 1: Add Domain in Vercel
1. In your Vercel Project dashboard, go to **Settings** → **Domains**.
2. Type `www.wandereroutdoors.in` and click **Add**.
3. Vercel will ask if you want to redirect `wandereroutdoors.in` to `www.wandereroutdoors.in` (Recommended). Select **Redirect to www.wandereroutdoors.in** and click **Add**.

### Step 2: Configure DNS in GoDaddy
1. Log in to your [GoDaddy Account](https://account.godaddy.com/).
2. Go to **My Products** → scroll to **Domains** → click **Manage DNS** next to `wandereroutdoors.in`.
3. Check your existing records first:
   - ⚠️ **DO NOT modify, edit, or delete any MX, TXT (SPF, DKIM, DMARC), or email-related records** — doing so would disrupt your email!
4. Add or update only the following two website records:

| Type | Name / Host | Value / Target | TTL |
| :--- | :--- | :--- | :--- |
| **CNAME** | `www` | `cname.vercel-dns.com` | 1 Hour (or 3600 / Default) |
| **A** | `@` | `76.76.21.21` | 1 Hour (or 3600 / Default) |

5. Save the records.
6. DNS propagation typically takes between 5 minutes and a couple of hours. Once propagated, Vercel will automatically issue a free, auto-renewing SSL certificate. Both `wandereroutdoors.in` and `www.wandereroutdoors.in` will securely load your website!

---

## 5. Control Room & SEO Management

You can manage all content, trips, bookings, and SEO from the Control Room:
- Access URL: `https://www.wandereroutdoors.in/admin/`. There is deliberately no public footer Edit link. If Supabase is not configured, the Control Room remains locked; offline editing is disabled.
- Sign in with your registered admin credentials.

### SEO Management:
Under the **SEO & Metadata** tab in the Control Room:
1. **Website Title & Meta Description**: Update the title and snippet shown on Google search results.
2. **Canonical Domain URL**: Pre-configured to `https://www.wandereroutdoors.in/`.
3. **Open Graph Title, Description & Social Share Image**: Customize how links preview when shared on WhatsApp, Facebook, iMessage, and Twitter.
4. **Keywords & Indexing Directives**: Manage indexing tags (`index, follow`).
5. Click **Save to site** in the top bar to persist your settings in the `site_content` row in Supabase. The public app applies these values when it loads/refreshed. Search engines still need to recrawl the site; JavaScript-updated metadata may not update social preview bots immediately.

### Google Search Console Setup (Free):
1. Visit [Google Search Console](https://search.google.com/search-console).
2. Choose **URL prefix** and enter `https://www.wandereroutdoors.in/`.
3. Verify ownership (via HTML tag or DNS TXT record).
4. Go to **Sitemaps** on the left menu, enter `sitemap.xml`, and click **Submit**. The current sitemap lists the canonical homepage only. The website uses hash-based SPA sections, which are not separate crawlable URLs in a sitemap; clean URLs/server-rendered page metadata would be a later SEO enhancement.

---

## 6. Google Reviews Setup (Optional)

The website supports both curated manual testimonials and live Google Reviews via serverless proxy:
1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project and enable **Places API**.
3. Create an API key under **Credentials** and restrict it to the Places API.
4. In Vercel Project Settings → Environment Variables, add:
   - `GOOGLE_PLACES_API_KEY`: `<your_google_api_key>`
5. In your Control Room → **Reviews & Google Reviews**:
   - Enter your **Google Place ID** (obtainable via Google's Place ID Finder).
   - Enable Google Reviews and click **Save to site**.
6. The website will automatically fetch the latest 5-star ratings and reviews via `/api/google-reviews`.

---

## 7. Supabase Database Preservation Note

This codebase connects directly to your existing Supabase project configured in `assets/js/config.js`.

- **Zero database schema modifications were forced on your live project.**
- **No data was deleted, overwritten, or modified.**
- All queries and storage operations strictly reuse your existing tables (`site_content`, `bookings`, `site_settings`, `profiles`) and bucket (`site-images`).

### ⚠️ IMPORTANT: Run the Receipts & Payments Migration

The booking system expects additional columns (`amount`, `status`, `payment_status`, `txn_ref`, `receipt_token`, `verified`, `receipt_sent`) and a secure lookup function (`get_booking_by_token`) that were added by the migration file `supabase/migration_receipts_payments_v2.sql`.

**If you see the error "Could not find the 'amount' column of 'bookings' in the schema cache", the migration has not been run yet.**

The code stores the receipt token and payment details in the existing `special_req` metadata field, so ordinary booking submission can work with the current schema. For public receipt links to resolve securely after coordinator payment verification, run the migration below once. It adds optional columns and a token-only lookup function, and the function also supports tokens stored in existing `special_req` metadata:

1. Go to your Supabase Dashboard → **SQL Editor**.
2. Open the file `supabase/migration_receipts_payments_v2.sql` from this project.
3. Copy the entire contents and paste into the SQL Editor.
4. Click **Run**.
5. The migration is **non-destructive** — it only ADDS columns (all with safe defaults), creates a partial unique index, and adds a read-scoped function. It does not drop, reset, or modify any existing data.
6. After running, go to **Settings → API** and click **Refresh schema cache** (or it auto-refreshes within a few minutes).

---

## 8. Booking System & Coordinator Payment Verification

### How Bookings Work
1. A visitor selects an adventure, fills the booking form, selects a payment method (UPI/QR or Cash), and submits.
2. The booking is saved to the Supabase `bookings` table with a unique reference and a secure receipt token.
3. The customer first sees the booking confirmation screen and can choose to open WhatsApp from there; WhatsApp is not opened automatically.
4. A branded PDF receipt is available with the correct payment status (Verification Pending for UPI, Payment Pending for Cash).

### Coordinator: Marking Payment as Received
In the Control Room → **Booking Enquiries Inbox**:
1. Find the booking row.
2. Click **✓ Mark Payment as Received** — this updates `payment_status` to "Paid" and `status` to "Confirmed" in the database.
3. A **💬 Notify Customer on WhatsApp** button appears — click it to open WhatsApp addressed to the customer's saved phone number with a prefilled confirmation message.
4. **Press Send in WhatsApp** — the coordinator must manually send the message; the system only opens WhatsApp with the message ready.

The WhatsApp message includes: customer name, verified amount, adventure name, travel date, booking reference, and a link to the updated receipt (if a secure token is available).

> The coordinator must press Send. The system never claims the message was sent merely because WhatsApp opened. If the database update fails, the payment confirmation button is not offered.

---

## 9. Environment Variables Summary

| Variable | Where | Required? | Purpose |
| :--- | :--- | :--- | :--- |
| `GOOGLE_PLACES_API_KEY` | Vercel Project Settings | Only for live Google Reviews | Server-side API key for Google Places, used by `/api/google-reviews` |
| `SITE_ORIGIN` | Vercel Project Settings | Optional | Canonical site origin (defaults to `https://www.wandereroutdoors.in`) |

> The Supabase URL and anon key live in `assets/js/config.js` and are safe to commit (protected by Row Level Security). **Never commit a `.env` file with real secrets to GitHub.**

---

## 10. DNS Records Reference (GoDaddy)

Only add or update these two records for the website. **Do NOT touch MX, TXT (SPF/DKIM/DMARC), or any email-related records.**

| Type | Name/Host | Value/Target | Purpose |
| :--- | :--- | :--- | :--- |
| **CNAME** | `www` | `cname.vercel-dns.com` | Points `www.wandereroutdoors.in` to Vercel |
| **A** (optional) | `@` | `76.76.21.21` | Points apex `wandereroutdoors.in` to Vercel (for redirect only) |

> The apex (`@`) A record is optional — it enables the redirect from `wandereroutdoors.in` to `www.wandereroutdoors.in`. The `www` CNAME is the primary record that makes your website work.
#   w a n d e r e r - o u t d o o r s  
 