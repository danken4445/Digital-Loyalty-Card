# The Caffeine Plug — NFC Digital Loyalty Card

A mobile-first digital stamp card system built for **The Caffeine Plug**, an urban specialty coffee brand based in the Philippines. Customers tap a physical NFC card or scan an acrylic counter QR standee on their phone to collect stamps and earn free coffee rewards.

There is no native app to download from an app store. When a customer taps the card or scans the QR code, an anonymous loyalty wallet is created in their mobile browser instantly.

---

## 1. Project Overview

- **Brand:** The Caffeine Plug
- **Tagline:** YOUR DAILY DOSE, STRAIGHT FROM THE PLUG
- **Location:** Philippines
- **Currency:** Philippine Peso (`PHP`, ₱)
- **Timezone:** `Asia/Manila` (UTC+8)
- **Production Domain:** `https://card.thecaffeineplug.ph`
- **Visual Aesthetic:** High-contrast monochrome streetwear palette (`#0A0A0A` black and `#FFFFFF` white) inspired by KAWS-style mascot artwork
- **Core Rules:**
  - 10 stamps = 1 free coffee reward of choice
  - 30-minute cooldown between stamps for the same customer
  - Maximum 2 stamps per calendar day per customer in `Asia/Manila` timezone
  - 5-second anti-spam throttle per physical NFC tag
- **Tech Stack:** Next.js 15 (App Router, TypeScript strict, Tailwind CSS), Supabase (PostgreSQL 15, Auth, Row Level Security, pg_cron), Upstash Redis (edge rate limiting), Cloudflare Turnstile (invisible bot protection), Vitest (unit tests), and pgTAP (database tests).

---

## 2. Operational Documentation & Guides

Comprehensive step-by-step documentation for Dan (Owner) and shop baristas is located in the `docs/` directory:

- 🚀 **[Deployment & Operations Runbook](docs/DEPLOYMENT_AND_OPS.md):** Complete guide to deploying to hosted Supabase, Vercel, Cloudflare Turnstile, and Upstash Redis; creating owner/staff accounts; running SQL migrations; scheduling automated 30-day stale account cleanups; and executing 5-second Vercel instant rollbacks.
- 🏷️ **[NFC & Counter QR Provisioning Guide](docs/NFC_AND_QR_PROVISIONING.md):** How to generate and print counter QR standees (`npm run qr:counter`), encode physical NXP NTAG215 cards using NFC Tools, password-lock tags against tampering, and rotate lost or compromised NFC cards in under 10 seconds.
- ☕ **[Barista Counter Cheatsheet](docs/STAFF_COUNTER_CHEATSHEET.md):** A 1-page printable reference card designed to be laminated beside the cash register. Explains how to onboard first-time customers, how to tap iPhones vs Android phones, what tap status banners mean, how to redeem free drinks at 10 stamps, and how to issue manual fallback stamps.
- 🔒 **[Privacy & Data Protection (`/privacy`)](app/privacy/page.tsx):** Implements the Philippines Data Privacy Act of 2012 (RA 10173), explaining data minimization, 30-day retention policies, and customer self-service data erasure.
- 🔮 **[Future Upgrades & Migration Blueprints](docs/FUTURE_UPGRADES.md):** Architectural specifications and migration blueprints for Phase 9 roadmap items: upgrading physical cards to cryptographic NXP NTAG 424 DNA (SUN) chips, tracking customer retention cohorts and busy hours in Manila time, implementing RA 10173-compliant opt-in messaging, and activating Slot #5 (50% OFF) as a redeemable mid-tier reward.
- 📋 **[Product Backlog & Deferred Scope](BACKLOG.md):** Evaluates post-v1 feature evolution, mid-tier milestones, and future phase integrations.

---

## 3. Architecture & User Journey

```
                        [ Customer Phone ]
                                |
               +----------------+----------------+
               |                                 |
         (First Visit)                    (Drink Purchase)
               |                                 |
     Scan Acrylic Counter QR             Tap Staff NTAG215 Card
     `https://.../card`                   `https://.../t/[tagId]`
               |                                 |
       Instant Anonymous                 Anti-Fraud Verification:
       Supabase Session                   - 30-min cooldown
               |                          - 2 stamps/day cap
               +----------------+         - 5-sec tag throttle
                                |                |
                                v                v
                      [ Active Digital Pass ] <--+
                      10 Stamps = Free Coffee
                                |
                         "CLAIM REWARD"
                                |
                      5-Minute Signed QR Token
                                |
                                v
                      Barista Scans Token
                      `/staff/redeem` (Atomic)
```

1. **Tap Route (`/t/[tagId]`):** Customers tap the barista's NTAG215 card. The server validates the tag ID in the database and records the stamp via PostgreSQL `SECURITY DEFINER` RPC (`record_stamp()`).
2. **Anti-Fraud & Cooldown Engine:** Enforced at the database transaction level using Postgres advisory locks (`pg_advisory_xact_lock`). Stamping is strictly bounded by a 30-minute customer cooldown and a 2 stamps/day cap in Manila time.
3. **Signed 5-Minute Redemption Tokens:** When a customer earns 10 stamps, the server issues a cryptographically signed HMAC-SHA256 token (`tcp1.<payload>.<sig>`) rendered as an inline vector QR code. The token expires in 300 seconds and is consumed atomically with single-use nonce tracking to eliminate screenshot fraud.
4. **Account Recovery & Atomic Merge:** Customers can link their anonymous wallet to Google or Email at any time. If an existing account already exists, an atomic merge RPC (`merge_anonymous_customer()`) combines stamp balances using ascending UUID locking to prevent deadlocks.

---

## 4. Prerequisites

Before running the application locally, ensure you have installed:

1. **Node.js 20+**: The JavaScript runtime. Download from [nodejs.org](https://nodejs.org).
2. **Docker Desktop**: Required to run the local Supabase PostgreSQL database and Auth containers. Download and start Docker Desktop from [docker.com](https://www.docker.com).
3. **npm**: Included automatically with Node.js.

---

## 5. Quick-Start Guide

Follow these numbered steps to get the app running on your local machine:

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Start the local Supabase services:**

   ```bash
   npx supabase start
   ```

   _What this does:_ Boots a local PostgreSQL 15 database and Auth server in Docker containers, applies all SQL migrations, and outputs your local credentials (`API URL`, `anon key`, `service_role key`).

3. **Configure your local environment:**
   - Copy `.env.example` to `.env.local`:
     ```bash
     cp .env.example .env.local
     ```
     _(On Windows PowerShell: `Copy-Item .env.example .env.local`)_
   - Open `.env.local` in your editor.
   - Run `npx supabase status` to inspect your local keys.
   - Paste the local `API URL` into `NEXT_PUBLIC_SUPABASE_URL`.
   - Paste the local `anon key` into `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - Paste the local `service_role key` into `SUPABASE_SERVICE_ROLE_KEY`.
   - For `REDEEM_TOKEN_SECRET`, set a random secret string of at least 32 characters.
   - For Cloudflare Turnstile, the test keys in `.env.example` work out of the box locally.

4. **Start the development server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 6. Project NPM Scripts

All available scripts defined in `package.json`:

| Command                | Description                                                                                                    |
| :--------------------- | :------------------------------------------------------------------------------------------------------------- |
| `npm run dev`          | Starts the Next.js development server with hot-reloading at `http://localhost:3000`.                           |
| `npm run build`        | Compiles and builds the production Next.js application bundle.                                                 |
| `npm run start`        | Boots the Next.js production server locally after running `build`.                                             |
| `npm run lint`         | Runs Next.js ESLint to verify code style and adherence to framework rules.                                     |
| `npm run typecheck`    | Runs the TypeScript compiler (`tsc --noEmit`) to verify strict static typing.                                  |
| `npm run format`       | Automatically formats all TypeScript, TSX, CSS, and Markdown files using Prettier.                             |
| `npm run format:check` | Verifies that all repository files conform to Prettier formatting standards.                                   |
| `npm run test`         | Executes the Vitest unit and integration test suite once.                                                      |
| `npm run test:unit`    | Alias for `npm run test`, running all unit tests in `tests/unit/`.                                             |
| `npm run test:watch`   | Runs Vitest in interactive watch mode for instant feedback during coding.                                      |
| `npm run test:db`      | Runs Supabase pgTAP database tests (`supabase test db`) against the local schema.                              |
| `npm run test:e2e`     | Runs Playwright end-to-end browser tests across customer and staff workflows.                                  |
| `npm run qr:counter`   | Generates the printable counter onboarding QR SVG and HTML poster (`public/brand/`).                           |
| `npm run db:types`     | Generates TypeScript database interfaces from the local Supabase schema into `lib/supabase/database.types.ts`. |

---

## 7. Plain-Language Glossary

If you know frontend development but are new to backend security, SQL, and cryptography, here is a quick guide to key terms used in this project:

### 1. TypeScript `strict`

- **What it means:** A setting in `tsconfig.json` that turns on all strict type-checking rules.
- **Why we use it:** In standard JavaScript, a variable can turn out to be `null` or `undefined` while a customer is tapping their phone at the counter, crashing the screen. `strict` mode forces us to handle missing data before the code ever compiles.

### 2. Row Level Security (RLS)

- **What it means:** Security rules written directly into the PostgreSQL database.
- **Why we use it:** In regular databases, any user who can connect can often query any table. RLS acts like a bouncer on every table row. Even if someone discovers our Supabase API URL and public key, RLS blocks them from reading or modifying another customer's stamps.

### 3. `SECURITY DEFINER`

- **What it means:** A special setting for a SQL database function.
- **Why we use it:** Normally, a function runs with the permissions of the person calling it. A `SECURITY DEFINER` function runs with the elevated permissions of the database administrator. We use this so customer actions (like adding a stamp or redeeming a free coffee) run through locked, pre-approved rules on the server without giving customers direct write access to database tables.

### 4. `supabase.auth.getUser()` vs. `getSession()`

- **What it means:** Two different ways to check who is signed in.
- **Why the difference matters:** `getSession()` reads data stored in the user's browser cookie without asking the server if it is still valid. An attacker could tamper with that cookie. `getUser()` contacts the Supabase authentication server directly and verifies the user's security token. For every sensitive server action, we always call `getUser()`.

### 5. `server-only`

- **What it means:** A small safety tool imported into server-side files (`import 'server-only'`).
- **Why we use it:** In Next.js, it is easy to accidentally import a server helper into a React client component. If that helper uses a secret key like `SUPABASE_SERVICE_ROLE_KEY`, that secret could leak into the customer's browser. Adding `import 'server-only'` makes the build fail immediately if a server file is ever imported into client code.

### 6. Transaction-Scoped Advisory Locks (`pg_advisory_xact_lock`)

- **What it means:** Lightweight mutex locks inside PostgreSQL tied to specific IDs (like customer UUID or tag ID).
- **Why we use it:** If a customer or an attacker attempts to send 20 stamp requests simultaneously, advisory locks queue the requests one by one. The first request succeeds, and subsequent requests immediately hit the 30-minute cooldown rule, completely preventing race conditions and double-counting.
