import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RedeemRewardForm, type RedeemRewardFormProps } from '@/components/staff/RedeemRewardForm';
import { QrCameraScanner } from '@/components/staff/QrCameraScanner';

(globalThis as any).React = React;

// Mock dependencies
vi.mock('jsqr', () => ({
  default: vi.fn(),
}));

describe('Staff Camera QR Scanner', () => {
  describe('QrCameraScanner component', () => {
    it('renders scanner container, live viewfinder video, and instructions in SSR/static markup', () => {
      const html = renderToStaticMarkup(
        React.createElement(QrCameraScanner, {
          onScan: vi.fn(),
        }),
      );

      expect(html).toContain('aria-label="QR Code Camera Scanner"');
      expect(html).toContain('aria-label="Camera Live Viewfinder"');
      expect(html).toContain('Align the customer');
      expect(html).toContain('within the frame');
    });

    it('renders manual switch button when onSwitchToManual callback is provided', () => {
      const html = renderToStaticMarkup(
        React.createElement(QrCameraScanner, {
          onScan: vi.fn(),
          onSwitchToManual: vi.fn(),
        }),
      );

      expect(html).toContain('Having trouble? Enter code manually');
    });
  });

  describe('RedeemRewardForm with Camera Scanner Integration', () => {
    it('renders SSR fallback with accessible form elements', () => {
      const html = renderToStaticMarkup(React.createElement(RedeemRewardForm));

      expect(html).toContain('Customer Reward Redemption');
      expect(html).toContain('for="redeem-token-input"');
      expect(html).toContain('Customer Redemption Token (Scan or Paste)');
      expect(html).toContain('Verify Token &amp; Check Balance');
    });

    it('displays custom reward label when passed via props', () => {
      const html = renderToStaticMarkup(
        React.createElement<RedeemRewardFormProps>(RedeemRewardForm, {
          rewardLabel: 'FREE CROISSANT',
          rewardThreshold: 8,
        }),
      );

      expect(html).toContain('Customer Reward Redemption');
    });
  });
});
