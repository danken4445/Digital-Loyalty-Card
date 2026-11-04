import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    rpc: vi.fn().mockResolvedValue({
      data: { lastRunAt: new Date().toISOString(), stale: false },
      error: null,
    }),
  }),
}));

import { GET } from '@/app/api/health/route';
import { SHOP_CONFIG } from '@/lib/config';
import type { ApiResponse, HealthCheckResponse } from '@/lib/contracts';
// @ts-expect-error TS7016: Untyped .mjs executable script
import { generateCounterQrAssets } from '../../scripts/generate-counter-qr.mjs';

describe('Phase 8: Deployment, Health Probe & Counter QR Assets', () => {
  describe('1. GET /api/health Route Handler', () => {
    it('returns status 200 with ok: true and authoritative health payload', async () => {
      const response = await GET();
      expect(response.status).toBe(200);

      const json = (await response.json()) as ApiResponse<HealthCheckResponse>;
      expect(json.ok).toBe(true);

      if (!json.ok) {
        throw new Error('Expected ok: true from health check probe');
      }

      expect(json.data.status).toBe('ok');
      expect(json.data.service).toBe(SHOP_CONFIG.name);
      expect(json.data.service).toBe('The Caffeine Plug');
      expect(json.data.timezone).toBe(SHOP_CONFIG.timezone);
      expect(json.data.timezone).toBe('Asia/Manila');

      // Verify ISO timestamp is valid
      const parsedTimestamp = new Date(json.data.timestampIso).getTime();
      expect(Number.isNaN(parsedTimestamp)).toBe(false);
      expect(parsedTimestamp).toBeGreaterThan(0);

      // Verify no-cache headers for accurate liveness polling
      expect(response.headers.get('Cache-Control')).toBe(
        'no-store, no-cache, must-revalidate, max-age=0',
      );
    });
  });

  describe('2. scripts/generate-counter-qr.mjs Generator Function', () => {
    it('generates high-contrast SVG QR and printable HTML standee containing required brand content', async () => {
      const tempDir = path.join(os.tmpdir(), `tcp-qr-test-${Date.now()}`);

      try {
        const result = await generateCounterQrAssets({
          siteUrl: 'https://card.thecaffeineplug.ph',
          outputDir: tempDir,
        });

        expect(result.targetUrl).toBe('https://card.thecaffeineplug.ph/card');

        // Verify SVG QR contents
        expect(result.qrSvg).toContain('<svg');
        expect(result.qrSvg).toContain('https://card.thecaffeineplug.ph/card');
        expect(result.qrSvg).toContain('SCAN FOR A DIGITAL LOYALTY CARD');
        expect(result.qrSvg).toContain('THE CAFFEINE PLUG');
        expect(result.qrSvg).toContain('width="360"');
        expect(result.qrSvg).toContain('height="360"');

        // Verify HTML poster contents
        expect(result.posterHtml).toContain('THE CAFFEINE PLUG');
        expect(result.posterHtml).toContain('SCAN FOR A DIGITAL LOYALTY CARD!');
        expect(result.posterHtml).toContain('https://card.thecaffeineplug.ph/card');
        expect(result.posterHtml).toContain('NO APP DOWNLOAD • NO FORM • 10 STAMPS = FREE COFFEE');
        expect(result.posterHtml).toContain('@thecaffeineplug8400');
        expect(result.posterHtml).toContain('<svg');

        // Verify output files were created in tempDir
        expect(fs.existsSync(result.svgPath)).toBe(true);
        expect(fs.statSync(result.svgPath).size).toBeGreaterThan(0);
        expect(fs.existsSync(result.posterPath)).toBe(true);
        expect(fs.statSync(result.posterPath).size).toBeGreaterThan(0);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('normalizes trailing slashes in custom site URLs', async () => {
      const tempDir = path.join(os.tmpdir(), `tcp-qr-slash-test-${Date.now()}`);

      try {
        const result = await generateCounterQrAssets({
          siteUrl: 'http://localhost:3000///',
          outputDir: tempDir,
        });

        expect(result.targetUrl).toBe('http://localhost:3000/card');
        expect(result.qrSvg).toContain('http://localhost:3000/card');
        expect(result.posterHtml).toContain('http://localhost:3000/card');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('3. Public Brand Assets on Disk', () => {
    it('verifies public/brand/counter-qr-card.svg exists on disk and is non-empty', () => {
      const svgPath = path.resolve(process.cwd(), 'public/brand/counter-qr-card.svg');
      expect(fs.existsSync(svgPath)).toBe(true);

      const stats = fs.statSync(svgPath);
      expect(stats.size).toBeGreaterThan(100);

      const content = fs.readFileSync(svgPath, 'utf8');
      expect(content).toContain('<svg');
      expect(content).toContain('https://card.thecaffeineplug.ph/card');
      expect(content).toContain('THE CAFFEINE PLUG');
      expect(content).toContain('SCAN FOR A DIGITAL LOYALTY CARD');
    });

    it('verifies public/brand/counter-qr-poster.html exists on disk and is non-empty', () => {
      const posterPath = path.resolve(process.cwd(), 'public/brand/counter-qr-poster.html');
      expect(fs.existsSync(posterPath)).toBe(true);

      const stats = fs.statSync(posterPath);
      expect(stats.size).toBeGreaterThan(500);

      const content = fs.readFileSync(posterPath, 'utf8');
      expect(content).toContain('THE CAFFEINE PLUG');
      expect(content).toContain('SCAN FOR A DIGITAL LOYALTY CARD!');
      expect(content).toContain('NO APP DOWNLOAD • NO FORM • 10 STAMPS = FREE COFFEE');
      expect(content).toContain('@thecaffeineplug8400');
      expect(content).toContain('https://card.thecaffeineplug.ph/card');
      expect(content).toContain('<svg');
    });
  });
});
