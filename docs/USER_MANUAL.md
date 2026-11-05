# Digital Loyalty Platform — User Manual

**Covers:** branch `feat/multi-tenant-db` as of 2026-11-05 (Phase 14 + billing plans).
**Written from the code itself.** Where an older guide in `docs/` says something different, this manual follows the code. Section 11 lists the gaps found while writing it; several steps below include a workaround for one of them.

---

## Contents

1. [Who uses the system](#1-who-uses-the-system)
2. [Address map](#2-address-map)
3. [One-time platform setup](#3-one-time-platform-setup)
4. [Create the platform admin account](#4-create-the-platform-admin-account)
5. [Onboard a client (a new shop)](#5-onboard-a-client-a-new-shop)
6. [Owner first-day setup](#6-owner-first-day-setup)
7. [NFC tags and the counter QR](#7-nfc-tags-and-the-counter-qr)
8. [Daily counter operations (baristas)](#8-daily-counter-operations-baristas)
9. [What the customer sees](#9-what-the-customer-sees)
10. [Monitoring](#10-monitoring)
11. [Known gaps and workarounds](#11-known-gaps-and-workarounds)
12. [Appendix: SQL snippets and result codes](#12-appendix-sql-snippets-and-result-codes)

---

## 1. Who uses the system

| Role | Who | Where they work | What they can do |
| :-- | :-- | :-- | :-- |
| **Platform admin** | You (the operator running the platform) | `/platform` | Create shops, change shop status (trial / active / suspended), set a shop's billing plan, open read-only support sessions. Needs an authenticator app (TOTP). |
| **Owner** | The shop's owner | `/staff` and `/staff/<slug>/settings` | Everything a manager can do, plus: save stamp rules, invite staff and change their roles, manage branches, split a branch into its own shop, pick the billing plan. |
| **Manager** | Shop manager | Same as owner | View rules and preview changes, edit branding, create, rotate and switch off NFC tags, export CSVs, view billing. |
| **Staff** | Barista | `/staff` | Redeem rewards, give manual stamps, view tag URLs, view activity. |
| **Customer** | Anyone with a phone | `/s/<slug>`, `/wallet` | Get a card with no download or form, collect stamps by NFC tap, claim rewards, back up the card, delete their data. |

The roles rank owner > manager > staff, and each page checks the minimum role it needs. One login can belong to several shops; the **Shop** switcher in the staff header picks which shop you're working in.

---

## 2. Address map

Replace `<site>` with your domain (production default: `https://card.thecaffeineplug.ph`, local: `http://localhost:3000`).

| Address | Who | Purpose |
| :-- | :-- | :-- |
| `/staff/login` | All staff, platform admins | Sign in (password or magic link, with a Turnstile check) |
| `/platform` | Platform admin | List of all shops |
| `/platform/new` | Platform admin | Create a shop |
| `/platform/<slug>` | Platform admin | Shop status, billing plan, link to support |
| `/platform/<slug>/support` | Platform admin | 30-minute read-only support session |
| `/platform/mfa` | Platform admin | Authenticator enrolment and challenge |
| `/staff` | Staff+ | Operations hub |
| `/staff/redeem` | Staff+ | Redeem a reward or the Instagram upsize |
| `/staff/stamp` | Staff+ | Manual stamp |
| `/staff/tags` | Staff+ (managing tags: manager+) | Simple tag list and creation |
| `/staff/activity` | Staff+ | Recent stamps, redemptions, audit log, anomaly flags |
| `/staff/billing` | Manager+ (changing the plan: owner) | Plan and this month's usage |
| `/staff/<slug>/settings` | Manager+ (saving: owner) | Owner console: **Rules** tab |
| `/staff/<slug>/settings/brand` | Manager+ | Colours, logo, card art, tagline |
| `/staff/<slug>/settings/staff` | Staff+ (changes: owner) | Team and invitations |
| `/staff/<slug>/settings/tags` | Manager+ | Tags grouped by branch, plus the leak warning banner |
| `/staff/<slug>/settings/export` | Manager+ | CSV downloads |
| `/staff/<slug>/settings/locations` | Owner | Branches |
| `/s/<slug>` | Customer | The shop's loyalty card |
| `/s/<slug>/privacy` | Customer | The shop's privacy notice |
| `/t/<tagId>` | Customer (via NFC) | Tap endpoint, which records a stamp |
| `/start` | Customer | Get a card |
| `/card` | Customer | Redirect: goes to the shop (if the domain or the customer's only card points to one) or to the wallet |
| `/wallet` | Customer | All of the customer's shop cards |
| `/privacy` | Customer | Platform privacy notice, delete everything |
| `/api/health` | Uptime monitor | Health check |

---

## 3. One-time platform setup

This is covered in detail in [DEPLOYMENT_AND_OPS.md](DEPLOYMENT_AND_OPS.md) sections 2–7 and 10. In short:

1. **Supabase project** (region Singapore). Apply every file in `supabase/migrations/` in order (`npx supabase db push` on a fresh project). Never run `seed.sql` in production.
2. **Supabase Auth settings:**
   - Turn on **Anonymous sign-ins**. Customers depend on it.
   - Set the **Site URL** and add `<site>/auth/callback` to **Redirect URLs**.
   - Turn on **Google** (optional, for "Back up with Google").
   - Turn on **CAPTCHA protection → Turnstile** with your Turnstile secret.
   - Make sure **TOTP MFA** is enabled. Platform admins can't sign in without it.
   - Set up **custom SMTP**. The default limit of about 30 emails an hour breaks magic links on a busy day.
   - Paste the templates from `supabase/templates/`.
3. **Cloudflare Turnstile** site plus **Upstash Redis** database.
4. **Deploy:** put the public values in the `wrangler.jsonc` vars, set the secrets with `npx wrangler secret put …`, then:

   ```bash
   npm run deploy:cf
   ```

5. **Check:** `<site>/api/health` returns `"status":"ok"`.

The weekly stale-account cleanup is now scheduled by migration `20261106040000_phase14_ops.sql`. You no longer need to run `cron.schedule` by hand, but the `pg_cron` extension must be enabled.

**Running locally:** `npx supabase start`, then `npm run dev`. Before you start, set `enroll_enabled = true` and `verify_enabled = true` under `[auth.mfa.totp]` in `supabase/config.toml`. Both are `false` today, which makes `/platform` unusable locally. `seed.sql` creates local test accounts for tenant #1.

---

## 4. Create the platform admin account

There is no sign-up page for platform admins. You create the first one by hand.

1. **Create the login.** In Supabase, open **Authentication → Users → Add user → Create user**. Enter your email and a strong password, and tick **Auto-confirm**.
2. **Copy the User UID** from the users table.
3. **Grant platform admin.** In the Supabase **SQL Editor**, run:

   ```sql
   insert into public.platform_admins (user_id)
   values ('<YOUR-USER-UID>')
   on conflict (user_id) do nothing;
   ```

4. **Sign in.** Go to `<site>/staff/login`, choose **Password**, enter your email and password, wait for the security check, then click **Sign In with Password**.
   - You'll land on an **"Access denied: This account does not have active staff permissions"** message. That's expected: a platform admin isn't a member of any shop (see gap G3). **Don't** click "Sign Out & Switch Account".
5. **Go to `<site>/platform`** by typing it into the address bar. You're sent to the MFA page.
6. **Enrol your authenticator** on the **Enroll TOTP Authenticator** screen:
   - Scan the QR with Google Authenticator, 1Password or Authy, or type in the secret shown under it.
   - Enter the 6-digit code and click **Complete MFA Enrollment & Sign In**.
7. You're now on **Tenant Management** and the header shows **MFA AAL2 Active**. On later visits you'll see **Two-Factor Challenge**: enter the code and click **Verify Code**.

To add more platform admins, repeat steps 1–3 for each person. Each of them enrols their own authenticator.

---

## 5. Onboard a client (a new shop)

### 5.1 Create the shop

1. Go to `/platform` and click **+ Create New Tenant**.
2. Fill in the form:
   - **Merchant Shop Name:** the name customers see, up to 80 characters.
   - **Workspace Slug:** filled in from the name. It must be 3–40 characters, lowercase letters, digits and hyphens, and can't start or end with a hyphen. It becomes the customer URL `/s/<slug>` and **can't be changed later** from the UI.
   - **Owner Email Address:** the email the owner will sign in with.
3. Click **Create Tenant Workspace**. Behind the scenes the system:
   - creates the shop with status **trial**;
   - fills in default rules (30-minute cooldown, 2 stamps a day, 10 stamps per reward, 5-second tag throttle, Asia/Manila, PHP, "FREE COFFEE");
   - creates one branch named after the shop;
   - creates an **owner invite** for the email, valid for 14 days;
   - writes an audit entry.
4. You land on `/platform/<slug>`.

### 5.2 Give the owner a login and activate the invite

> ⚠️ **Read this.** The invite is stored, but **no email is sent, and no screen accepts the invite** (gap G1). The owner can't get into `/staff` until you do step 3 below.

1. **Owner creates their login.** Ask the owner to:
   - open `<site>/staff/login`;
   - choose **Magic Link** and enter **exactly the invited email**;
   - click **Send Magic Link** and open the link in the email.

   This creates and confirms their account. They'll see "Access denied" for now, which is expected. Alternatively, you can create the account in **Supabase → Authentication → Add user**, tick Auto-confirm, and share a temporary password with the owner.
2. **Check the account exists and is confirmed** in Supabase → Authentication → Users.
3. **Accept the invite on their behalf** in the SQL Editor. Replace the email and the slug:

   ```sql
   select public.accept_invite(
     (select id from auth.users where lower(email) = lower('owner@example.com')),
     (select i.id from public.tenant_invites i
        join public.tenants t on t.id = i.tenant_id
       where t.slug = 'kape-manila'
         and lower(i.email) = lower('owner@example.com')
         and i.accepted_at is null
       order by i.created_at desc limit 1),
     'Owner Display Name'
   );
   ```

   The query should return `accepted`. If it returns something else:
   - `email-mismatch`: the account email differs from the invite, or the account isn't confirmed yet.
   - `expired`: more than 14 days have passed, so create a new invite (Appendix A3).
   - `invalid-invite`: the invite was already accepted, or the lookup found nothing.
4. The owner signs in again at `/staff/login` and now reaches **Operations Console**.

### 5.3 Make the shop live

1. On `/platform/<slug>`, look at **Status Management**.
2. Choose **active**, type a reason of at least 5 characters (for example `Contract signed 2026-11-05`), and click **Apply Status Change**.
   - **trial:** fully working, but not billed. The billing card shows "Would cost".
   - **active:** billed according to the chosen plan.
3. Under **Billing Plan**, choose a plan for the shop, or let the owner choose one (section 6.6). Tick **Apply to the current month** to override the usual "starts next month" rule.

### 5.4 Optional settings that need SQL

None of these have a screen yet. The snippets are in the Appendix.

- **Custom domain** (for example `loyalty.kapemanila.ph`): add a row to `tenant_domains` (A5). Do this **before** writing any NFC tags, because tag URLs use the alias host and a written tag is permanent.
- **Instagram "follow us, size up" perk:** set `tenant_settings.perks` (A6).
- **Timezone or currency other than Asia/Manila / PHP:** update `tenant_settings` (A6).

---

## 6. Owner first-day setup

The owner signs in at `/staff/login`. There is **no button from `/staff` to the console**, so the owner types `<site>/staff/<slug>/settings` (gap G2). Bookmark it.

### 6.1 Rules tab (`/staff/<slug>/settings`)

Managers can view this tab and run a preview. Only owners can save.

| Field | Range | Meaning |
| :-- | :-- | :-- |
| Reward Threshold | 3–50 | Stamps needed for one reward |
| Reward Label | 1–40 characters | Name customers see, for example `FREE COFFEE` |
| Cooldown Period (Minutes) | 0–1440 | Minimum gap between two stamps for one customer |
| Daily Cap | 1–20 | Most stamps one customer can get per day, in the shop's timezone |
| Tag Anti-Burst Throttle (Seconds) | 0–60 | Minimum gap between taps on the same NFC tag |

1. Change the values and run the **preview**. **Customer Impact Preview** shows how many cards become eligible for a reward straight away, and how many are still collecting toward the new target.
2. Save. You should see "Rules successfully updated." The new rules apply to the next tap.

### 6.2 Brand tab

1. Set **Primary Card Color** (background) and **Accent Color** (ink and stamps) as hex values. The system checks contrast and falls back to safe colours if the pair is hard to read.
2. Set **Shop Tagline**.
3. Upload **Shop Logo** and **Card Art**: PNG, JPEG or WebP, 512 KB or less, no SVG. You can also paste an image URL.
4. Check the **Live Card Preview**, then save. Saving only changes the fields you edited.

### 6.3 Branches tab (owner only)

1. **Add New Branch Location:** enter a name (for example `Ayala Malls Manila Bay`) and, optionally, an address.
2. **Edit Details:** rename the branch, change its address, or untick **Active** to stop stamping there.
3. By default, all branches **share one card**: the same stamps, cooldown and daily cap everywhere.
4. **Give this branch its own card** turns the branch into a separate child shop. **This can't be undone.**
   - Customers keep their existing stamps on the brand card and start a new card at this branch.
   - Owners and managers are copied to the new shop once. After that, team changes don't sync.
   - The child shop is billed and suspended on its own.
   - To confirm, enter the new slug, tick the "I understand…" box, and confirm. Then click **Open Branch Console**.

### 6.4 Staff tab

1. Under **Invite New Team Member** (owner only), enter the email and choose **Staff**, **Manager** or **Owner**, then click **Send Invite**.
   - ⚠️ Despite the message "Invite sent to …", **no email goes out and the invitee can't accept it on their own** (gap G1). Tell your platform admin, who activates it with the SQL in 5.2 step 3. The invitee first creates their login with a magic link at `/staff/login`.
2. Under **Team Members**, change a person's role from the dropdown, or click **Deactivate** / **Reactivate**. Their history is kept.
3. Under **Invitations**, each invite shows **Pending**, **Accepted** or **Expired** (after 14 days).

### 6.5 Tags tab

See [section 7](#7-nfc-tags-and-the-counter-qr).

### 6.6 Plan & Billing (`/staff/billing`, owners and managers)

- **This month's usage** shows the number of active customers and "Bill so far", or "Would cost" while the shop is on trial. An **active customer** is anyone who collected at least one stamp this month. Customers who only hold the card are free.
- Use the **"If I had ___ active customers"** box to compare plans.

| Plan | Monthly fee | Per active customer | Notes |
| :-- | :-- | :-- | :-- |
| Pay as you go | ₱0 | ₱10 | |
| Starter 50 | ₱350 | ₱7 | Fee covers the first 50 active customers; ₱7 each after that |
| Growth 200 | ₱1,000 | ₱5 | Fee covers the first 200 active customers; ₱5 each after that |
| Worry-free cap | ₱0 | ₱8 | Never more than ₱1,200 a month |

- Only owners can choose. A shop's first choice starts now. Any later change says **Switch next month**, so each month has one price.
- These are **estimates**. The system doesn't collect payment; you invoice the shop yourself.

### 6.7 Export tab

- **Download Cards CSV:** pseudonymous card IDs, join date, branch, total and available stamps.
- **Download Stamps CSV:** the full stamp ledger, with tag, branch and reason.
- The files contain no emails or phone numbers, and cells that could run as spreadsheet formulas are neutralised.

---

## 7. NFC tags and the counter QR

**Equipment:** NXP **NTAG215** cards or stickers (not NTAG213, not Mifare Classic), a phone with the free **NFC Tools** app (or NXP TagWriter), and an acrylic standee for the QR.

### 7.1 Create a tag (manager or owner)

1. Go to `/staff/<slug>/settings/tags`. The simpler `/staff/tags` page works too, but has no branch picker and no leak banner.
2. Under **Provision New NFC Tag**:
   - type a **Tag Label** (for example `Counter Register #1`);
   - choose **Assign Branch Location**;
   - click create.
3. The new tag appears under its branch with an ID like `tcp_tag_a9f3k2m8x1p7q4w6`. Click **Copy** on its **Production Tap URL**, which looks like `<site-or-alias>/t/tcp_tag_…`.

### 7.2 Write the tag

1. In NFC Tools, open **Write**, tap **Add a record**, choose **URL/URI**, paste the URL, and tap **OK**.
2. Tap **Write** and hold the card against the phone: the top of the back on an iPhone, the centre of the back on Android.
3. **Lock it.** If you skip this, anyone at the counter can rewrite the card.
   - **Other → Set Password** (recommended): the card can be rewritten later with the password. Store the password safely.
   - **Other → Lock tag**: the card becomes permanently read-only.
4. **Test it.** Close NFC Tools and tap the card with a phone. You should see the shop card with **STAMP COLLECTED**. Using the same phone again within the cooldown shows **COOLDOWN ACTIVE**, which proves the cooldown works.

Each tag belongs to one shop and one branch. A tap always credits the tag's shop, whatever the customer's phone sends.

### 7.3 Rotate or deactivate a tag

- **Rotate** (when a tag is lost, photographed, or shows a leak warning): the old URL stops working at once, and a new tag ID is issued with the same label. Write the new URL onto a fresh or unlocked card.
- **Deactivate**: switches the tag off with no replacement.
- If someone taps a dead tag, their phone shows **INACTIVE NFC TAG**. Use a manual stamp for that customer.

### 7.4 Counter QR (for first-time customers)

- For **The Caffeine Plug**, run:

  ```bash
  npm run qr:counter
  ```

  It writes `public/brand/counter-qr-poster.html` and `public/brand/counter-qr-card.svg`, pointing to `<site>/card`. Print the poster at 100% scale.
- For **any other shop**, the script's URL and artwork are fixed to The Caffeine Plug (gap G5). Make a QR code that points to `<site>/s/<slug>`, or to the shop's alias domain, using any QR generator, and print it.

---

## 8. Daily counter operations (baristas)

Keep [STAFF_COUNTER_CHEATSHEET.md](STAFF_COUNTER_CHEATSHEET.md) at the till. The numbers in it (10 stamps, 30 minutes, 2 a day) are only the defaults; each shop's own rules apply.

### 8.1 New customer

- **Easiest:** just tap the NFC card on their phone. A first-timer is sent to **"Claim your first stamp"**. They tap the get-card button and their first stamp is added automatically.
- **Or:** they scan the counter QR and tap **GET MY CARD**, which creates a card with 0 stamps.
- They don't download an app or fill in a form.

### 8.2 Give a stamp

Tap the shop's NFC card on the customer's phone, then read the banner on their screen:

| Banner | Meaning |
| :-- | :-- |
| STAMP COLLECTED | Success |
| COOLDOWN ACTIVE | Too soon after the last stamp (the shop's cooldown) |
| DAILY CAP REACHED | The customer has hit today's limit |
| TAP THROTTLED | The same tag was tapped twice within the throttle window. Wait and tap again. |
| INACTIVE NFC TAG | The tag was rotated or switched off. Tell a manager and give a manual stamp. |
| Shop paused | The shop is suspended, so no stamps can be given |

### 8.3 Redeem a reward

1. When the customer has enough stamps, they tap the claim button on their card. A **5-minute QR** appears with a code like `XXXX-XXXX`.
2. On the shop device, go to `/staff/redeem`.
3. Get the token into the **Customer Redemption Token** box:
   - use a USB or Bluetooth 2D barcode scanner, which types into the box; or
   - use any QR-reader app on the shop device, then copy and paste the text; or
   - have the customer tap copy on their card and send it to you.

   There's no in-browser camera scanner (gap G6). The 8-character code is only for checking by eye; you can't type it in instead of the token.
4. Click **Verify Token & Check Balance**. Check that the code matches the one on the customer's phone and that the screen says **ELIGIBLE FOR …**.
5. Confirm. The stamps are deducted, the redemption is logged, and the token can't be used again. Click **Scan Next Customer**.
   - An expired QR: the customer refreshes their code.
   - **INSUFFICIENT STAMPS**: the customer doesn't have enough stamps yet.

### 8.4 Instagram upsize (only for shops with the perk turned on)

1. The customer follows the shop on Instagram, then taps **CLAIM UPSIZE**.
2. Scan or paste the token and verify it, the same way as 8.3.
3. Ask the customer to show the shop's profile on their phone reading **Following**.
4. Click **Follow Checked — Grant Free Upsize**. No stamps are used. If the screen says **UPSIZE ALREADY USED**, that card has already had its upsize.

### 8.5 Manual stamp (the phone has no NFC, or the tag is dead)

1. Go to `/staff/stamp`.
2. Enter the customer's **full Customer UUID**.
   - ⚠️ The card only shows `Card #` plus the first 8 characters (gap G7). Until that's fixed, a manager can find the full ID in **Export → Cards CSV** or in `/staff/activity`, by matching the first 8 characters.
3. Enter a **Reason**. It's required and goes into the audit log.
4. Click submit and check for **STAMP RECORDED — RESULT: STAMPED**. Cooldown and daily-cap rules still apply.
5. Three or more manual stamps for one customer raise an anomaly flag.

---

## 9. What the customer sees

| Action | How |
| :-- | :-- |
| See one shop's card | `/s/<slug>`. It shows the stamp grid, available and total stamps, "Card #XXXXXXXX", the reward panel and the backup panel. |
| See all cards | `/wallet`: every shop card, with a count of completed cards for each |
| Back up the card | **Back up with Google** or **Back up with Email**. The anonymous card is linked to that login, and stamps survive clearing the browser or changing phones. |
| Recover on a new phone | Use **Recover** with the same Google account or email. Wallets are merged, and stamps from both are combined. |
| Remove one shop's card | **Remove this card** on `/s/<slug>`. This deletes only that shop's card and history. |
| Delete everything | **Delete my wallet & data** on `/wallet` or `/privacy`. This erases every card and the account. |
| Privacy notice | `/s/<slug>/privacy` (shop) and `/privacy` (platform) |

Anonymous visitors who never collect a stamp are deleted automatically after 30 days.

---

## 10. Monitoring

### 10.1 Shop level (owners, managers, staff)

| What | Where | What to look for |
| :-- | :-- | :-- |
| **Recent activity** | `/staff/activity` | The last 50 stamps (manual ones are labelled **MANUAL**), the last 50 redemptions, the last 50 audit events |
| **Anomaly flags** | Top of `/staff/activity` | **Repeated Daily Cap / Cooldown Activity** (a customer hitting the cap on several days, or with 3 or more blocked taps); **High NFC Tag Volume / Rapid Taps** (10 or more recent stamps, or 3 or more throttle blocks, on one tag); **Frequent Manual Stamp Overrides** (3 or more manual stamps for one customer). Severity is *warning* or *high*. |
| **Tag-leak banner** | `/staff/<slug>/settings/tags` | A yellow banner when a tag has **more than 8 different customers in 15 minutes** or **more than 25 throttle rejections in 1 hour**. Click **Rotate** in the banner, then rewrite the physical tag. |
| **Usage and cost** | `/staff/billing` | Active customers this month, cost so far, whether the cap applied, any plan change waiting |
| **Raw data** | Export tab | CSVs for your own analysis |

**Suggested routine:**
- **Daily:** a manager glances at the anomaly flags.
- **Weekly:** check the tags tab for leak banners.
- **Monthly:** check billing and export the CSVs.

### 10.2 Platform level (platform admin)

| What | Where | How |
| :-- | :-- | :-- |
| **All shops and their status** | `/platform` | Coloured badges: Active, Trial, Suspended, Closed |
| **One shop** | `/platform/<slug>` | Status, when it was created, suspension date, billing estimate |
| **Read-only support** | `/platform/<slug>` → **Launch Support Session →** | Enter a ticket justification (at least 10 characters) and click **Start 30-Minute Support Session**. You see customer card count, active staff, stamps in the last 7 days, status, and pseudonymous recent activity, with a live countdown. Click **End Session** when you're done. Starting and ending are both audited. You never sign in as shop staff. |
| **Health** | `GET <site>/api/health` | Point an uptime monitor at it every 60 seconds. Alert when the status code isn't 200 **or** the body contains `"status":"degraded"`, which means the weekly cleanup hasn't run in 8 days. |
| **Cleanup job** | Supabase → Database → Cron | Job `weekly-stale-anonymous-cleanup` runs Sundays at 03:00 UTC (11:00 Manila) |
| **Audit trail** | SQL Editor | See Appendix A7. Platform-level events, such as wallet erasures, merges and cleanup, have `tenant_id` set to null. |
| **App logs** | Cloudflare → Workers → `digital-loyalty-card` → Logs | Security events are tagged with `tenantId` |

### 10.3 Common incidents

| Situation | Steps |
| :-- | :-- |
| NFC card lost or leaked | Manager: Tags tab → **Rotate** → write the new URL onto a new card → lock it |
| Customer says stamps are missing | Platform admin: start a support session and check recent activity. Shop: check `/staff/activity` and the Stamps CSV. |
| Shop stops paying or pauses | `/platform/<slug>` → **suspended** with a reason. Stamping stops at once. Customers can still **redeem** rewards they've already earned for **30 days**, after which their card shows a closed notice. |
| Shop comes back | Set it to **active** or **trial**. Stamping resumes immediately. |
| Shop closes for good | Suspend it first. When the 30 days are up, set it to `closed` with SQL (A4). The UI doesn't offer `closed`. A closed shop's page returns 404 and its staff lose access. |
| Staff member leaves | Owner: Staff tab → **Deactivate** |
| Bad deployment | Run `npx wrangler rollback`. See DEPLOYMENT_AND_OPS §8. |

---

## 11. Known gaps and workarounds

These came up while tracing the code for this manual. The ones marked **blocker** stop a normal flow from working without SQL.

| # | Gap | Impact | Workaround now |
| :-- | :-- | :-- | :-- |
| **G1** | **Invites are never emailed and nothing in the UI accepts them.** `POST /auth/accept-invite` exists, but no page calls it. The staff screen says "Invite sent" and "sign in … to join", but signing in gives *Access denied*. | **Blocker** for onboarding every owner and staff member | Run the `accept_invite` SQL in 5.2 step 3 |
| **G2** | No link from `/staff` to the owner console | Owners can't find Rules, Brand, Tags, Export or Branches | Type and bookmark `/staff/<slug>/settings` |
| **G3** | `/staff/login` only redirects to `/staff/*`. A platform admin with no shop membership lands on *Access denied*. | Confusing | Ignore it and type `/platform` |
| **G4** | TOTP MFA is turned off in local `supabase/config.toml` | `/platform` is unusable locally | Turn on `[auth.mfa.totp]` and restart Supabase |
| **G5** | `npm run qr:counter` always points to `/card` and uses The Caffeine Plug's artwork | Other shops have no ready-made QR | Generate a QR for `/s/<slug>` with any QR tool |
| **G6** | `/staff/redeem` has no camera scanner, and the 8-character code can't be typed in instead of the token | Needs extra hardware or an extra app | Use a 2D scanner, or a QR app plus copy and paste |
| **G7** | Manual stamp needs the full customer UUID, but the card shows only 8 characters | The manual-stamp fallback is hard to use | Look up the full ID in the CSV export or the activity page |
| **G8** | Perks, timezone, currency, custom domains and the `closed` status have no screen | Platform admin needs SQL | Appendix A4–A6 |
| **G9** | Billing is an estimate only, with no payment collection | Revenue is collected outside the system | Invoice by hand from `/platform/<slug>` |
| **G10** | `STAFF_COUNTER_CHEATSHEET.md`, `NFC_AND_QR_PROVISIONING.md` and parts of `DEPLOYMENT_AND_OPS.md` were written for one shop (fixed rules, `/staff/tags` only, cron set by hand, "invites are auto-accepted") | Staff may follow outdated steps | Use this manual; update those docs later |

---

## 12. Appendix: SQL snippets and result codes

Run these in **Supabase → SQL Editor**. Replace the values in angle brackets.

**A1. Make someone a platform admin**

```sql
insert into public.platform_admins (user_id) values ('<USER-UID>') on conflict do nothing;
```

**A2. Accept a pending invite** (see 5.2 step 3)

**A3. Create an invite by hand.** Owner invites from the console go through `invite_member`. An actor that isn't an owner of the shop gets `unauthorized`.

```sql
insert into public.tenant_invites (tenant_id, email, role, invited_by)
select id, lower('<email>'), 'owner', '<YOUR-PLATFORM-ADMIN-UID>' from public.tenants where slug = '<slug>';
```

Or skip invites and add the member directly. Their login must already exist.

```sql
insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
select t.id, u.id, 'staff', 'Barista Name', true
from public.tenants t, auth.users u
where t.slug = '<slug>' and lower(u.email) = lower('<email>')
on conflict (tenant_id, user_id) do update set role = excluded.role, active = true;
```

**A4. Close a shop permanently**

```sql
update public.tenants set status = 'closed' where slug = '<slug>';
```

**A5. Custom domain for a shop**

```sql
insert into public.tenant_domains (host, tenant_id)
select 'loyalty.example.ph', id from public.tenants where slug = '<slug>';
```

**A6. Perk, timezone and currency**

```sql
update public.tenant_settings
set perks = jsonb_build_object('instagram_follow_upsize',
              jsonb_build_object('label', 'FREE UPSIZE', 'handle', '@yourshop')),
    timezone = 'Asia/Manila',
    currency = 'PHP'
where tenant_id = (select id from public.tenants where slug = '<slug>');
```

**A7. Platform monitoring queries**

```sql
-- Activity per shop, last 7 days
select t.slug,
       (select count(*) from public.stamps s where s.tenant_id = t.id and s.created_at > now() - interval '7 days') as stamps_7d,
       (select count(*) from public.redemptions r where r.tenant_id = t.id and r.created_at > now() - interval '7 days') as redemptions_7d,
       (select count(*) from public.customer_cards c where c.tenant_id = t.id) as cards
from public.tenants t order by stamps_7d desc;

-- Latest audit events for one shop
select created_at, action, target, detail
from public.audit_log
where tenant_id = (select id from public.tenants where slug = '<slug>')
order by created_at desc limit 100;

-- Cleanup job status (the same check /api/health uses)
select public.ops_cleanup_status();
```

**A8. Result codes you may see**

- **Stamp:**
  - `stamped`: success
  - `cooldown`: too soon after the last stamp
  - `daily-limit`: the customer hit today's cap
  - `tag-throttled`: the same tag was tapped too quickly
  - `invalid-tag`: unknown or inactive tag
  - `no-card`: the customer has no card at this shop; they're sent to add one
  - `tenant-unavailable`: the shop is suspended or closed
- **Redeem:**
  - `redeemed`: success
  - `insufficient-stamps`: not enough stamps
  - `invalid-token`: the token can't be verified
  - `expired-token`: more than 5 minutes old
  - `already-claimed`: the token has already been used
  - `wrong-tenant`: the token was scanned at another shop
  - `tenant-unavailable`: the shop is suspended and the 30-day window has ended
  - `invalid-perk`: the token's perk doesn't apply here
