import { expect, test } from '@playwright/test';

test.describe('Caffeine Plug NFC Loyalty - End-to-End Smoke Tests', () => {
  test('1. GET /api/health returns 200 with ok: true and status: "ok"', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.data.status).toBe('ok');
    expect(body.data.service).toBe('The Caffeine Plug');
    expect(body.data.timezone).toBe('Asia/Manila');
    expect(typeof body.data.timestampIso).toBe('string');
    expect(new Date(body.data.timestampIso).getTime()).not.toBeNaN();

    const headers = response.headers();
    expect(headers['cache-control']).toBe('no-store, no-cache, must-revalidate, max-age=0');
  });

  test('2. Visiting /card without a session renders onboarding and verifies security headers', async ({
    page,
  }) => {
    const response = await page.goto('/card');
    expect(response).not.toBeNull();
    expect(response!.status()).toBe(200);

    // Verify security headers
    const headers = response!.headers();
    expect(headers['x-frame-options']?.toUpperCase()).toBe('DENY');
    expect(headers['x-content-type-options']?.toLowerCase()).toBe('nosniff');
    expect(headers['content-security-policy']).toBeDefined();
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");

    // Verify brand identity & onboarding copy
    const heading = page.getByRole('heading', { name: /THE CAFFEINE PLUG/i, level: 1 });
    await expect(heading).toBeVisible();

    // Verify "GET MY CARD" button is rendered
    const getCardButton = page.getByRole('button', { name: /GET MY CARD/i });
    await expect(getCardButton).toBeVisible();

    // Verify link to RA 10173 Privacy Notice
    const privacyLink = page.getByRole('link', { name: /Privacy/i });
    await expect(privacyLink).toBeVisible();
    await expect(privacyLink).toHaveAttribute('href', '/privacy');
  });

  test('3. Visiting /start?t=tag_caffeine_plug_counter_01 without a session renders Turnstile-protected onboarding without creating account on GET', async ({
    page,
    context,
  }) => {
    const response = await page.goto('/start?t=tag_caffeine_plug_counter_01');
    expect(response).not.toBeNull();
    expect(response!.status()).toBe(200);

    // Verify tap detected badge and tag indicator
    await expect(page.getByText('NFC TAP DETECTED').first()).toBeVisible();

    // Verify Turnstile-protected CTA button
    const claimButton = page.getByRole('button', { name: /GET MY CARD & CLAIM STAMP/i });
    await expect(claimButton).toBeVisible();
    await expect(claimButton).toBeDisabled();

    // Verify no customer account or auth cookies were created merely by visiting on GET
    const cookies = await context.cookies();
    const authCookies = cookies.filter(
      (c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'),
    );
    expect(authCookies.length).toBe(0);
  });

  test('4. Visiting /privacy renders RA 10173 Privacy Notice and exercises self-service "DELETE MY CARD & DATA" two-step confirmation flow', async ({
    page,
  }) => {
    const response = await page.goto('/privacy');
    expect(response).not.toBeNull();
    expect(response!.status()).toBe(200);

    // Verify RA 10173 legal disclosure text
    await expect(
      page.getByRole('heading', { name: /PRIVACY & DATA RIGHTS/i, level: 1 }),
    ).toBeVisible();
    await expect(page.getByText(/PHILIPPINES REPUBLIC ACT NO\. 10173/i)).toBeVisible();
    await expect(page.getByText(/DATA PRIVACY ACT OF 2012/i)).toBeVisible();

    // Step 1: Initial "DELETE MY CARD & DATA" button
    const deleteButton = page.getByRole('button', { name: /DELETE MY CARD & DATA/i });
    await expect(deleteButton).toBeVisible();

    // Click to enter step 2 confirmation mode
    await deleteButton.click();

    // Step 2: Two-step confirmation dialogue appears
    await expect(
      page.getByText(/Are you sure\? This permanently erases your loyalty card/i),
    ).toBeVisible();
    const confirmButton = page.getByRole('button', { name: /YES, PERMANENTLY ERASE/i });
    const cancelButton = page.getByRole('button', { name: /CANCEL/i });
    await expect(confirmButton).toBeVisible();
    await expect(cancelButton).toBeVisible();

    // Step 3: Canceling resets back to step 1
    await cancelButton.click();
    await expect(deleteButton).toBeVisible();
    await expect(confirmButton).not.toBeVisible();
  });

  test('5. Visiting /staff unauthenticated redirects to /staff/login', async ({ page }) => {
    await page.goto('/staff');

    // Verify route guard redirection to staff login
    await page.waitForURL(/\/staff\/login/);
    expect(page.url()).toContain('/staff/login');

    // Verify staff login interface is rendered
    await expect(page.getByRole('heading', { name: /Staff Access/i })).toBeVisible();
    await expect(page.getByLabel(/Staff Email Address/i)).toBeVisible();
  });
});
