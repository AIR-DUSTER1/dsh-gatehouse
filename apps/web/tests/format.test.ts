import { describe, expect, it } from 'vitest';
import { actionLabels, decisionLabels, hasPermission, permissionLabels, riskLabels, shortHash, statusExplain, statusLabels, userStatusLabels } from '../src/lib/format';

describe('console presentation vocabulary', () => {
  it('covers every business status with a Chinese label and explanation', () => {
    for (const status of ['pending_review','info_requested','approved','rejected','superseded','scheduled','executing','completed','failed'] as const) {
      expect(statusLabels[status]).toBeTruthy();
      expect(statusExplain[status]).toBeTruthy();
    }
  });

  it('keeps risk and decision vocabulary explicit', () => {
    expect(riskLabels.critical).toContain('极高');
    expect(decisionLabels.approve).toContain('排期');
    expect(actionLabels['execution.finished']).toBe('执行已完成');
  });

  it('shortens long hashes without losing both ends', () => {
    const value = `sha256:${'a'.repeat(56)}12345678`;
    const short = shortHash(value);
    expect(short.startsWith('sha256:aaaaa')).toBe(true);
    expect(short.endsWith('12345678')).toBe(true);
    expect(short.length).toBeLessThan(value.length);
  });
});
describe('access control vocabulary', () => {
  it('maps permissions and checks the current permission set', () => {
    expect(permissionLabels['user.manage']).toContain('用户');
    expect(userStatusLabels.invited).toContain('激活');
    expect(hasPermission({ permissions: ['review.decide'] }, 'review.decide')).toBe(true);
    expect(hasPermission({ permissions: ['review.decide'] }, 'schedule.control')).toBe(false);
    expect(hasPermission(null, 'workspace.read')).toBe(false);
  });
});
