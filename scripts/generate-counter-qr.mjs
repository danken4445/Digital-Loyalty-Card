import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_PRODUCTION_URL = 'https://card.thecaffeineplug.ph';
export const DEFAULT_BRAND_OUTPUT_DIR = path.resolve(__dirname, '../public/brand');

/**
 * Builds the printable monochrome streetwear counter standee HTML page.
 *
 * @param {object} params
 * @param {string} params.targetUrl
 * @param {string} params.qrSvg
 * @returns {string}
 */
export function buildCounterStandeeHtml({ targetUrl, qrSvg }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>THE CAFFEINE PLUG — Counter Loyalty Standee</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background-color: #0A0A0A;
      color: #FFFFFF;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px 16px;
    }
    .standee-card {
      width: 100%;
      max-width: 440px;
      background: #121214;
      border: 2px solid #27272A;
      border-radius: 24px;
      padding: 36px 28px;
      text-align: center;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.9);
      position: relative;
      overflow: hidden;
    }
    .corner-tick {
      position: absolute;
      top: 14px;
      right: -32px;
      background: #FFFFFF;
      color: #0A0A0A;
      font-family: monospace;
      font-weight: 900;
      font-size: 9px;
      letter-spacing: 2px;
      padding: 4px 32px;
      transform: rotate(45deg);
      text-transform: uppercase;
    }
    .eyebrow {
      font-family: monospace;
      font-size: 11px;
      letter-spacing: 3px;
      color: #A1A1AA;
      text-transform: uppercase;
      margin-bottom: 8px;
      display: inline-block;
    }
    h1.brand-name {
      font-size: 28px;
      font-weight: 900;
      letter-spacing: 2px;
      text-transform: uppercase;
      margin-bottom: 6px;
      color: #FFFFFF;
    }
    p.tagline {
      font-size: 11px;
      letter-spacing: 2px;
      color: #A1A1AA;
      text-transform: uppercase;
      margin-bottom: 24px;
      font-weight: 600;
    }
    .cta-banner {
      background: #FFFFFF;
      color: #0A0A0A;
      border-radius: 12px;
      padding: 12px 16px;
      font-weight: 900;
      font-size: 14px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      margin-bottom: 24px;
      box-shadow: 0 0 25px rgba(255, 255, 255, 0.15);
    }
    .qr-container {
      background: #FFFFFF;
      border-radius: 20px;
      padding: 16px;
      display: inline-block;
      margin-bottom: 16px;
      border: 3px solid #27272A;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
    }
    .qr-container svg {
      display: block;
      width: 280px;
      height: 280px;
      margin: 0 auto;
    }
    .qr-url {
      font-family: monospace;
      font-size: 11px;
      letter-spacing: 1px;
      color: #A1A1AA;
      margin-bottom: 22px;
      word-break: break-all;
    }
    .value-props {
      background: #1C1C1F;
      border: 1px solid #27272A;
      border-radius: 14px;
      padding: 14px;
      font-family: monospace;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1px;
      color: #FFFFFF;
      text-transform: uppercase;
      margin-bottom: 24px;
      line-height: 1.6;
    }
    .footer-social {
      font-family: monospace;
      font-size: 11px;
      letter-spacing: 2px;
      color: #A1A1AA;
      text-transform: uppercase;
      border-top: 1px solid #27272A;
      padding-top: 18px;
    }
    .footer-social .handle {
      color: #FFFFFF;
      font-weight: 700;
    }
    @media print {
      body {
        background: #FFFFFF !important;
        color: #0A0A0A !important;
        padding: 0;
      }
      .standee-card {
        border: 2px solid #0A0A0A;
        background: #FFFFFF;
        box-shadow: none;
        max-width: 100%;
        border-radius: 0;
      }
      .corner-tick {
        background: #0A0A0A;
        color: #FFFFFF;
      }
      h1.brand-name {
        color: #0A0A0A;
      }
      .eyebrow, p.tagline, .qr-url, .footer-social {
        color: #555555;
      }
      .cta-banner {
        background: #0A0A0A;
        color: #FFFFFF;
      }
      .qr-container {
        border-color: #0A0A0A;
      }
      .value-props {
        background: #F4F4F5;
        border-color: #0A0A0A;
        color: #0A0A0A;
      }
      .footer-social .handle {
        color: #0A0A0A;
      }
    }
  </style>
</head>
<body>
  <div class="standee-card">
    <div class="corner-tick">TCP 2026</div>
    <div class="eyebrow">NFC &bull; QR COUNTER STANDEE</div>
    <h1 class="brand-name">THE CAFFEINE PLUG</h1>
    <p class="tagline">YOUR DAILY DOSE, STRAIGHT FROM THE PLUG</p>

    <div class="cta-banner">
      SCAN FOR A DIGITAL LOYALTY CARD!
    </div>

    <div class="qr-container">
      ${qrSvg}
    </div>

    <div class="qr-url">
      ${targetUrl}
    </div>

    <div class="value-props">
      NO APP DOWNLOAD • NO FORM • 10 STAMPS = FREE COFFEE
    </div>

    <div class="footer-social">
      INSTAGRAM <span class="handle">@thecaffeineplug8400</span> &bull; CEBU PH
    </div>
  </div>
</body>
</html>
`;
}

/**
 * Generates high-contrast counter QR code assets for The Caffeine Plug.
 *
 * @param {object} [options]
 * @param {string} [options.siteUrl] - Base site URL (defaults to NEXT_PUBLIC_SITE_URL or https://card.thecaffeineplug.ph)
 * @param {string} [options.outputDir] - Destination directory (defaults to public/brand)
 * @returns {Promise<{ targetUrl: string, qrSvg: string, posterHtml: string, svgPath: string, posterPath: string }>}
 */
export async function generateCounterQrAssets({ siteUrl, outputDir } = {}) {
  const effectiveBaseUrl = (
    siteUrl ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    DEFAULT_PRODUCTION_URL
  ).replace(/\/+$/, '');

  const targetUrl = `${effectiveBaseUrl}/card`;
  const effectiveOutputDir = outputDir ? path.resolve(outputDir) : DEFAULT_BRAND_OUTPUT_DIR;

  const rawSvg = await QRCode.toString(targetUrl, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 360,
    color: {
      dark: '#0A0A0A',
      light: '#FFFFFF',
    },
  });

  // Inject semantic title & description for accessibility and explicit verification
  const metadata = `<title>THE CAFFEINE PLUG - SCAN FOR A DIGITAL LOYALTY CARD</title><desc>${targetUrl}</desc>`;
  const qrSvg = rawSvg.replace(
    /<svg([^>]*)>/,
    `<svg$1 aria-label="THE CAFFEINE PLUG Loyalty Card QR">${metadata}`,
  );

  const posterHtml = buildCounterStandeeHtml({ targetUrl, qrSvg });

  await fs.mkdir(effectiveOutputDir, { recursive: true });

  const svgPath = path.join(effectiveOutputDir, 'counter-qr-card.svg');
  const posterPath = path.join(effectiveOutputDir, 'counter-qr-poster.html');

  await fs.writeFile(svgPath, qrSvg, 'utf8');
  await fs.writeFile(posterPath, posterHtml, 'utf8');

  return {
    targetUrl,
    qrSvg,
    posterHtml,
    svgPath,
    posterPath,
  };
}

// Auto-run when executed directly via node scripts/generate-counter-qr.mjs
const isDirectExecution =
  Boolean(process.argv[1]) &&
  (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('generate-counter-qr.mjs'));

if (isDirectExecution) {
  generateCounterQrAssets()
    .then(({ targetUrl, svgPath, posterPath }) => {
      console.log(`[TCP QR Generator] Successfully generated counter assets for "${targetUrl}":`);
      console.log(`  SVG Card QR : ${svgPath}`);
      console.log(`  HTML Poster : ${posterPath}`);
    })
    .catch((err) => {
      console.error('[TCP QR Generator] Generation failed:', err);
      process.exit(1);
    });
}
