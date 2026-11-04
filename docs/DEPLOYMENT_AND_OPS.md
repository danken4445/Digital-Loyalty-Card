# The Caffeine Plug — Deployment & Operations Runbook

**Audience:** Dan (Owner) and shop operations team  
**Target Production Domain:** `https://card.thecaffeineplug.ph`  
**Store Location:** Philippines  
**Store Timezone:** `Asia/Manila` (UTC+8)  
**Store Currency:** Philippine Peso (`PHP`, ₱)

---

## 1. Overview & Architecture Summary

The Caffeine Plug NFC Loyalty Card is a mobile-first digital stamp card system. Customers tap an in-store NXP NTAG215 NFC card or scan an acrylic counter QR standee to collect stamps and earn free coffee rewards.

Key architectural highlights:

- **Zero App Download:** Customers do not download anything from an app store. An anonymous wallet session is created in their mobile browser in under two seconds.
- **Append-Only Tamper-Proof Ledger:** Loyalty stamps and redemptions are stored in PostgreSQL tables protected by Row Level Security (RLS) and transaction-scoped advisory locks. Customers cannot edit their stamp counts.
- **Bot and Fraud Protection:** Cloudflare Turnstile blocks automated bots, Upstash Redis enforces rate limits, and 5-minute single-use HMAC tokens prevent redemption replay attacks.
- **Philippine Privacy Compliance:** Full compliance with the Philippines Data Privacy Act of 2012 (RA 10173), including customer self-service data erasure and automatic 30-day cleanup of stale anonymous accounts.

---

## 2. Pre-Flight Checklist: Accounts & Services

Before starting your production deployment, make sure you have access to these external services:

1. **GitHub Account:** To host the private code repository.
2. **Supabase Account:** [supabase.com](https://supabase.com) — Provides hosted PostgreSQL, authentication, and database backups.
3. **Cloudflare Account:** [cloudflare.com](https://cloudflare.com) — Hosts the Next.js app on Cloudflare Workers (built with OpenNext) and provides Turnstile CAPTCHA bot protection.
4. **Upstash Account (Recommended):** [upstash.com](https://upstash.com) — Provides serverless Redis for rate limiting across multiple server instances.
5. **Domain Registrar / DNS:** Where `thecaffeineplug.ph` is managed, with access to create a `card` CNAME record.

---

## 3. Step 1: Prepare Hosted Supabase

Follow these numbered steps to set up your hosted Supabase database:

1. **Create a Supabase Project:**
   - Log in to your Supabase dashboard at [supabase.com/dashboard](https://supabase.com/dashboard).
   - Click **New project**.
   - Choose your organization, enter project name `caffeine-plug-loyalty`, and enter a strong database password.
   - **Region:** Select **Singapore (`ap-southeast-1`)** for the lowest network latency to customers in the Philippines.
   - Wait 1-2 minutes for the database cluster to finish provisioning.

2. **Run Database Migrations (In Chronological Order):**
   - The repository includes 5 SQL migration scripts inside `supabase/migrations/`. They must be executed in order:
     1. `20261102000000_phase1_schema_rls_functions.sql` — Creates tables (`customers`, `tags`, `staff`, `stamps`, `redemptions`, `audit_log`), indexes, RLS policies, and the `is_staff()` helper.
     2. `20261102010000_phase3_record_stamp_refinement.sql` — Sets up `record_stamp()` with 30-minute cooldowns, 2 stamps/day Manila daily cap, and advisory locking.
     3. `20261102020000_phase5_atomic_redeem_nonce.sql` — Sets up atomic single-use nonce consumption and `redeem_reward()` for 10-stamp free coffee redemptions.
     4. `20261102030000_phase6_merge_anonymous_customer.sql` — Sets up `merge_anonymous_customer()` with deadlock-free ascending UUID lock ordering.
     5. `20261102040000_phase7_compliance_and_cleanup.sql` — Sets up RA 10173 data erasure (`delete_customer_data()`) and 30-day stale account cleanup (`cleanup_stale_anonymous_customers()`).
   - **How to apply the migrations:**
     - **Option A (Supabase SQL Editor — Easiest):**
       1. In the Supabase left navigation, click **SQL Editor**.
       2. Open each file on your computer, copy the full text, paste it into the editor, and click **Run**.
       3. Repeat for all 5 files in exact order.
     - **Option B (Supabase CLI):**
       1. Link your local project: `npx supabase link --project-ref <your-project-ref>`
       2. Push all migrations: `npx supabase db push`
   - _CRITICAL WARNING:_ Never run `supabase/seed.sql` on your production database. `seed.sql` is strictly for local Docker development and contains mock testing accounts.

3. **Enable Anonymous Sign-Ins:**
   - In the Supabase left navigation, click **Authentication**.
   - Click **Providers** (`TO VERIFY` exact menu label in current Supabase UI).
   - Find the **Anonymous** provider row.
   - Switch the toggle to **Enabled** / **ON**.
   - Click **Save**.
   - _Why this is needed:_ When a customer taps an NFC card or scans the counter QR, Supabase immediately creates an anonymous identity so they can collect stamps without filling out forms.

4. **Configure Redirect URLs & Site URL:**
   - In Supabase, go to **Authentication** -> **URL Configuration** (`TO VERIFY` exact menu label in current Supabase UI).
   - Set **Site URL** to:
     ```text
     https://card.thecaffeineplug.ph
     ```
   - In the **Redirect URLs** list, click **Add URL** and add:
     ```text
     https://card.thecaffeineplug.ph/auth/callback
     http://localhost:3000/auth/callback
     ```
   - Click **Save**.

5. **Configure Google OAuth ("Back Up With Google"):**
   - In [Google Cloud Console -> Credentials](https://console.cloud.google.com/apis/credentials), create an **OAuth 2.0 Client ID** (Web application).
   - Under **Authorized redirect URIs**, add your Supabase callback URL:
     ```text
     https://<your-project-ref>.supabase.co/auth/v1/callback
     ```
   - In the Supabase dashboard, go to **Authentication** -> **Sign In / Providers** -> **Google**:
     - Switch **Enable Sign in with Google** to **ON**.
     - Paste your **Client ID** and **Client Secret** from Google Cloud Console.
     - Click **Save**.

6. **Customize Supabase Email Templates ("Back Up with Email" & "Recover Card"):**
   - When an anonymous customer chooses **"Back Up with Email"**, Supabase sends the **Change Email Address** template (`email_change`). When a customer chooses **"Recover Existing Card"**, Supabase sends the **Magic Link** template (`magic_link`).
   - In the Supabase dashboard, go to **Authentication** -> **Emails** (or **Email Templates**):
     - **Template 1 — Change Email Address (`Back Up with Email`):**
       - **Subject:** `Back up your Loyalty Card — The Caffeine Plug`
       - **Body (Source HTML):** Copy and paste the contents of `supabase/templates/email_change.html`.
     - **Template 2 — Magic Link (`Recover Existing Card`):**
       - **Subject:** `Recover your Loyalty Card — The Caffeine Plug`
       - **Body (Source HTML):** Copy and paste the contents of `supabase/templates/magic_link.html`.
     - **Template 3 — Confirm sign up:**
       - **Subject:** `Confirm your Loyalty Card — The Caffeine Plug`
       - **Body (Source HTML):** Copy and paste the contents of `supabase/templates/confirmation.html`.
     - Click **Save** on each template.

7. **Copy Your Supabase Connection Keys:**
   - In Supabase, click the gear icon (**Project Settings**) at the bottom of the left sidebar.
   - Click **API** (`TO VERIFY` exact menu location).
   - Copy and save these three values into a private notepad for Step 4:
     - **Project URL:** Looks like `https://abcdefghijklm.supabase.co` (this will be `NEXT_PUBLIC_SUPABASE_URL`).
     - **anon / public key:** Long key starting with `eyJ...` (this will be `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
     - **service_role key:** Click **Reveal** to display this key. (This will be `SUPABASE_SERVICE_ROLE_KEY`). Keep this secret. Never share it or commit it to GitHub.

---

## 4. Step 2: Create Your First Owner / Staff Account

To manage NFC tags and approve coffee redemptions at the counter, Dan must have an owner account in the database:

1. **Create Dan's Auth User:**
   - In the Supabase dashboard, click **Authentication** -> **Users** (`TO VERIFY` exact menu label).
   - Click **Add user** -> **Create user**.
   - Enter Dan's email address (e.g., `dan@thecaffeineplug.ph`) and a secure password.
   - Ensure the toggle **Auto Confirm User?** is enabled (`TO VERIFY` exact checkbox name).
   - Click **Create user**.

2. **Copy the New User UID:**
   - In the users table, find the row you just created.
   - Copy the value from the **User UID** column (a 36-character UUID like `a1b2c3d4-e5f6-7890-abcd-ef1234567890`).

3. **Promote the User to Owner in the Staff Table:**
   - In the Supabase left navigation, click **SQL Editor**.
   - Paste and run the following SQL command (replace `<YOUR-AUTH-USER-UUID>` with the UID copied above):
     ```sql
     insert into public.staff (user_id, display_name, role, active)
     values ('<YOUR-AUTH-USER-UUID>', 'Dan (Owner)', 'owner', true);
     ```
   - Click **Run**.
   - Verify the query returns `SUCCESS 1 rows affected`.
   - Dan is now registered as an `owner`. He can log in at `https://card.thecaffeineplug.ph/staff/login` to access all staff and management features.

---

## 5. Step 3: Configure Cloudflare Turnstile & Upstash Redis

### 5.1 Cloudflare Turnstile (Bot & Abuse Protection)

Cloudflare Turnstile protects customer card generation from spam bots while keeping the experience invisible and friction-free for genuine customers.

1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com).
2. In the navigation sidebar, click **Turnstile** (`TO VERIFY` exact menu location).
3. Click **Add Site**.
4. Set **Site name:** `The Caffeine Plug Loyalty Card`.
5. Set **Domain:** `card.thecaffeineplug.ph` (you can also add `localhost` for local testing).
6. Set **Widget Mode:** **Managed** (recommended by Cloudflare for mobile browsers).
7. Click **Create**.
8. Copy the **Site Key** (this will be `NEXT_PUBLIC_TURNSTILE_SITE_KEY`).
9. Copy the **Secret Key** (this will be `TURNSTILE_SECRET_KEY`).
10. In the Supabase dashboard, open **Authentication → Attack Protection**, enable **CAPTCHA protection**, choose **Turnstile**, and paste the same Secret Key. Supabase Auth is the only Turnstile verifier: the token is single-use, so the app's own routes no longer verify it.

### 5.2 Upstash Redis (Distributed Rate Limiting)

Upstash Redis enforces per-IP and per-customer rate limits across Cloudflare Worker instances to prevent card provisioning floods.

1. Log in to [console.upstash.com](https://console.upstash.com).
2. Click **Create Database**.
3. Set **Name:** `tcp-loyalty-prod`.
4. Set **Region:** **Southeast Asia / Singapore (`ap-southeast-1`)** for closest proximity to Manila.
5. Set **Type:** Regional (Pay-as-you-go or Free tier).
6. Click **Create**.
7. Once created, scroll down to the **REST API** section (`TO VERIFY` exact tab name).
8. Select the **.env** tab.
9. Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

---

## 6. Step 4: Deploy Frontend to Cloudflare Workers

The app runs on Cloudflare Workers, built with OpenNext (`@opennextjs/cloudflare`). The Worker is named `digital-loyalty-card`; the name in `wrangler.jsonc` must match the Worker name in the Cloudflare dashboard.

1. **Set public variables in `wrangler.jsonc` (`vars`):**
   - `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
   - These values are public and are built into the browser bundle.

2. **Set server secrets with Wrangler.** Run once per secret, then paste the value when prompted:
   ```bash
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   ```
   Repeat for `REDEEM_TOKEN_SECRET`, `TURNSTILE_SECRET_KEY`, `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

| Environment Variable             | Where                 | Purpose / Source                                                    | Example Value                     |
| :------------------------------- | :-------------------- | :------------------------------------------------------------------ | :-------------------------------- |
| `NEXT_PUBLIC_SITE_URL`           | `wrangler.jsonc` vars | Production domain                                                   | `https://card.thecaffeineplug.ph` |
| `NEXT_PUBLIC_SUPABASE_URL`       | `wrangler.jsonc` vars | Hosted Supabase project URL                                         | `https://xyzcompany.supabase.co`  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | `wrangler.jsonc` vars | Hosted Supabase publishable key                                     | `sb_publishable_...`              |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `wrangler.jsonc` vars | Cloudflare Turnstile public site key                                | `0x4AAAAAA...`                    |
| `SUPABASE_SERVICE_ROLE_KEY`      | **Wrangler secret**   | Privileged database admin key                                       | `eyJhbGciOi...`                   |
| `REDEEM_TOKEN_SECRET`            | **Wrangler secret**   | 64-character random hex secret for signed 5-minute reward QR tokens | _Generate using step below_       |
| `TURNSTILE_SECRET_KEY`           | **Wrangler secret**   | Cloudflare Turnstile secret key                                     | `0x4AAAAAA...`                    |
| `UPSTASH_REDIS_REST_URL`         | **Wrangler secret**   | Upstash Redis REST URL                                              | `https://...upstash.io`           |
| `UPSTASH_REDIS_REST_TOKEN`       | **Wrangler secret**   | Upstash Redis REST Token                                            | `AX...=`                          |

3. **How to Generate `REDEEM_TOKEN_SECRET`:**
   - Open a terminal on your computer and run this command:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
   - It outputs a 64-character random string (e.g., `8f7b3a1c9e2d...`).
   - Store it with `npx wrangler secret put REDEEM_TOKEN_SECRET`.

4. **Preview, then deploy:**

   ```bash
   npm run preview:cf
   ```

   ```bash
   npm run deploy:cf
   ```

   `deploy:cf` builds the app with OpenNext and uploads a new Worker version.

5. **Connect Your Custom Domain (`card.thecaffeineplug.ph`):**
   - The domain's DNS must be managed by Cloudflare.
   - In the Cloudflare dashboard, open **Workers & Pages** -> `digital-loyalty-card` -> **Settings** -> **Domains & Routes**, and add `card.thecaffeineplug.ph` as a custom domain (`TO VERIFY` exact labels).
   - Cloudflare creates the DNS record and issues the TLS certificate.

---

## 7. Step 5: Post-Launch Verification & Operations

Run these verification tests immediately after deployment:

1. **Verify System Health Probe:**
   - Visit: `https://card.thecaffeineplug.ph/api/health`
   - It must return HTTP `200 OK` with JSON:
     ```json
     {
       "ok": true,
       "data": {
         "status": "ok",
         "service": "The Caffeine Plug",
         "timezone": "Asia/Manila"
       }
     }
     ```

2. **Verify Customer Onboarding:**
   - Open an incognito/private browser window on your phone.
   - Go to `https://card.thecaffeineplug.ph/card`.
   - Click the white button: **"GET MY CARD"**.
   - Verify that your card loads showing:
     - 0 of 10 stamps
     - The Caffeine Plug mascot
     - High-contrast black and white streetwear theme
     - Badge reading `ANONYMOUS PASS`

3. **Verify Staff Login & Operations:**
   - Open `https://card.thecaffeineplug.ph/staff/login`.
   - Log in with Dan's email and password.
   - Verify you can view:
     - `/staff` — Main staff navigation hub
     - `/staff/tags` — Tag provisioning and rotation table
     - `/staff/redeem` — Barista QR code scanner and preview
     - `/staff/stamp` — Manual stamp fallback form
     - `/staff/activity` — Store audit log and anomaly tracker

4. **Verify Privacy & Data Rights Page:**
   - Visit `https://card.thecaffeineplug.ph/privacy`.
   - Verify that data retention, anonymization, and customer self-service account deletion details are clearly displayed.

5. **Schedule 30-Day Stale Anonymous Account Cleanup (RA 10173):**
   - To comply with the Philippines Data Privacy Act of 2012, anonymous visitors who never earned any stamps must not be kept indefinitely.
   - In the Supabase **SQL Editor**, schedule the automated cleanup job using `pg_cron`:
     ```sql
     -- Enable pg_cron if not already enabled (Supabase Dashboard -> Database -> Extensions -> pg_cron)
     create extension if not exists pg_cron;

     -- Run cleanup every Sunday at 3:00 AM UTC (11:00 AM Manila Time)
     select cron.schedule(
       'weekly-stale-anonymous-cleanup',
       '0 3 * * 0',
       $$select public.cleanup_stale_anonymous_customers();$$
     );
     ```
   - _What this does:_ Once a week, this job searches for anonymous visitor accounts older than 30 days that have zero stamps and permanently removes them, recording only an anonymized count in the audit log.

---

## 8. Emergency Rollback Plan

If a bad code commit or styling regression occurs in production, follow these steps to restore service in under 60 seconds:

### Method 1: Wrangler Rollback (No Rebuild — Recommended)

1. On your computer terminal, roll the Worker back to its previous version:
   ```bash
   npx wrangler rollback
   ```
2. Wrangler asks for a reason and confirmation, then serves the previous version without a new build. You can also pick an older version from the Worker's **Deployments** tab in the Cloudflare dashboard (`TO VERIFY` exact labels).

### Method 2: Git Revert (Clean Code History)

1. On your computer terminal, revert the problematic commit and redeploy:
   ```bash
   git revert HEAD
   ```
   ```bash
   npm run deploy:cf
   ```

### Database migrations are not rolled back by either method

Rolling back the Worker doesn't undo SQL migrations. The Phase 10–11 multi-tenant migrations are additive, so the previous app version keeps working on the newer schema (see section 9).

---

## 9. Multi-Tenant Transition (Phases 10–12)

Phases 10–11 make the database multi-tenant while the deployed single-shop app keeps working unchanged (decision D-012 in `DECISIONS.md`):

- The Caffeine Plug is tenant #1 (`caffeine-plug`). Rows written by the current app get tenant #1 automatically through column defaults.
- **Adding and removing staff:** keep using `public.staff` as described in section 4. A transition-only trigger copies each insert or update into `public.tenant_members` for tenant #1, and deleting a `staff` row (or moving it to another user) deactivates the old membership.
- **Wallet cards:** customers created by the current app have no `customer_cards` row yet. The Phase 12 migration creates them by re-running `private.backfill_tenant1()` before the app switches to the new functions.
- **Phase 12** switches the app to the tenant-aware functions, then removes the legacy objects: `public.staff`, `public.is_staff()`, the mirror trigger, the single-tenant guard, `public.customer_balances`, the legacy stamp/redeem/merge/perk functions and the `tenant_id` column defaults.
- **Second tenant:** the database refuses to create any tenant other than tenant #1 (`additional tenants are blocked until Phase 12`). Only the pgTAP tests and the local seed opt in with `set_config('app.allow_multi_tenant', 'on', …)`; never set it in production before Phase 12.
