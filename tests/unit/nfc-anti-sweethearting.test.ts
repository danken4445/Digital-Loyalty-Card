import { describe, it, expect, vi } from 'vitest';
import { detectActivityAnomalies } from '@/lib/auth/staff';
import type { StampRow, RedemptionRow, AuditLogRow, TagRow } from '@/lib/contracts';

vi.mock('server-only', () => ({}));

function mockStamp(
  partial: Partial<StampRow> & {
    id: string;
    customer_id: string;
    source: StampRow['source'];
    created_at: string;
  },
): StampRow {
  return {
    staff_id: null,
    reason: null,
    tag_id: null,
    ...partial,
  };
}

describe('NFC Anti-Sweethearting & Anomaly Detection Test Suite', () => {
  const baseRules = {
    dailyCap: 5,
    timezone: 'Asia/Manila',
    cooldownMinutes: 30,
  };

  describe('1. Cooldown-Hugging Anomaly Detection', () => {
    it('flags customer who collects consecutive same-day NFC stamps right after cooldown expires (30-45 min)', () => {
      const customerId = 'cust-hugger-1111';
      // 3 stamps on 2026-11-06 spaced by 32 minutes and 31 minutes
      const stamps: StampRow[] = [
        mockStamp({
          id: 's1',
          customer_id: customerId,
          source: 'nfc',
          tag_id: 'tag_barista_1',
          created_at: '2026-11-06T08:00:00.000Z',
        }),
        mockStamp({
          id: 's2',
          customer_id: customerId,
          source: 'nfc',
          tag_id: 'tag_barista_1',
          created_at: '2026-11-06T08:32:00.000Z', // +32 mins (30 <= 32 <= 45)
        }),
        mockStamp({
          id: 's3',
          customer_id: customerId,
          source: 'nfc',
          tag_id: 'tag_barista_1',
          created_at: '2026-11-06T09:03:00.000Z', // +31 mins
        }),
      ];

      const anomalies = detectActivityAnomalies(
        { stamps, redemptions: [], auditLogs: [] },
        baseRules,
      );

      const hugFlag = anomalies.find((a) => a.category === 'cooldown-hugging');
      expect(hugFlag).toBeDefined();
      expect(hugFlag?.targetId).toBe(customerId);
      expect(hugFlag?.severity).toBe('high'); // >= 2 intervals
      expect(hugFlag?.title).toBe('Suspicious Cooldown-Hugging Activity');
    });

    it('does NOT flag customers whose stamps are naturally spaced hours apart', () => {
      const customerId = 'cust-normal-2222';
      // Morning coffee at 8am, afternoon coffee at 2pm (+6 hours)
      const stamps: StampRow[] = [
        mockStamp({
          id: 's1',
          customer_id: customerId,
          source: 'nfc',
          tag_id: 'tag_barista_1',
          created_at: '2026-11-06T08:00:00.000Z',
        }),
        mockStamp({
          id: 's2',
          customer_id: customerId,
          source: 'nfc',
          tag_id: 'tag_barista_1',
          created_at: '2026-11-06T14:00:00.000Z', // +6 hours
        }),
      ];

      const anomalies = detectActivityAnomalies(
        { stamps, redemptions: [], auditLogs: [] },
        baseRules,
      );

      const hugFlag = anomalies.find((a) => a.category === 'cooldown-hugging');
      expect(hugFlag).toBeUndefined();
    });

    it('does NOT flag manual staff stamps for cooldown hugging', () => {
      const customerId = 'cust-manual-3333';
      const stamps: StampRow[] = [
        mockStamp({
          id: 's1',
          customer_id: customerId,
          source: 'manual',
          staff_id: 'staff-1',
          created_at: '2026-11-06T08:00:00.000Z',
        }),
        mockStamp({
          id: 's2',
          customer_id: customerId,
          source: 'manual',
          staff_id: 'staff-1',
          created_at: '2026-11-06T08:32:00.000Z',
        }),
      ];

      const anomalies = detectActivityAnomalies(
        { stamps, redemptions: [], auditLogs: [] },
        baseRules,
      );

      const hugFlag = anomalies.find((a) => a.category === 'cooldown-hugging');
      expect(hugFlag).toBeUndefined();
    });
  });

  describe('2. Buddy-Tag Concentration Anomaly Detection', () => {
    it('flags customer with repeated rejections on a single named tag and surfaces tag label', () => {
      const customerId = 'cust-buddy-4444';
      const tagId = 'tag_barista_mark';
      const tags: TagRow[] = [
        {
          id: tagId,
          label: 'Barista - Mark',
          active: true,
          created_at: '2026-11-01T00:00:00.000Z',
          deactivated_at: null,
          last_tap_counter: 25,
          hardware_uid: '04930D01590F13',
        },
      ];

      const auditLogs: AuditLogRow[] = [
        {
          id: 'a1',
          actor: customerId,
          action: 'stamp_rejected_cooldown',
          target: customerId,
          detail: { tag_id: tagId },
          created_at: '2026-11-06T08:10:00.000Z',
        },
        {
          id: 'a2',
          actor: customerId,
          action: 'stamp_rejected_daily_limit',
          target: customerId,
          detail: { tag_id: tagId },
          created_at: '2026-11-06T08:20:00.000Z',
        },
      ];

      const anomalies = detectActivityAnomalies(
        { stamps: [], redemptions: [], auditLogs, tags },
        baseRules,
      );

      const buddyFlag = anomalies.find((a) => a.category === 'buddy-tag-concentration');
      expect(buddyFlag).toBeDefined();
      expect(buddyFlag?.targetId).toBe(customerId);
      expect(buddyFlag?.description).toContain('Barista - Mark');
      expect(buddyFlag?.title).toBe('Buddy-Tag / Sweethearting Concentration');
    });

    it('falls back to tagId when tag label is missing', () => {
      const customerId = 'cust-buddy-5555';
      const tagId = 'tag_unnamed_01';

      const auditLogs: AuditLogRow[] = [
        {
          id: 'a1',
          actor: customerId,
          action: 'stamp_rejected_cooldown',
          target: customerId,
          detail: { tag_id: tagId },
          created_at: '2026-11-06T08:10:00.000Z',
        },
        {
          id: 'a2',
          actor: customerId,
          action: 'stamp_rejected_cooldown',
          target: customerId,
          detail: { tag_id: tagId },
          created_at: '2026-11-06T08:15:00.000Z',
        },
      ];

      const anomalies = detectActivityAnomalies(
        { stamps: [], redemptions: [], auditLogs, tags: [] },
        baseRules,
      );

      const buddyFlag = anomalies.find((a) => a.category === 'buddy-tag-concentration');
      expect(buddyFlag).toBeDefined();
      expect(buddyFlag?.description).toContain(tagId);
    });
  });
});
