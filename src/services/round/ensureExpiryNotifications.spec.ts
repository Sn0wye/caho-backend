import { describe, expect, it } from 'vitest';
import { withExpiredKeyEvents } from './ensureExpiryNotifications';

describe('withExpiredKeyEvents', () => {
  it('enables keyevent + expired from nothing', () => {
    expect(withExpiredKeyEvents('')).toBe('Ex');
  });

  it('keeps existing flags and adds only what is missing', () => {
    expect(withExpiredKeyEvents('Kg')).toBe('KgEx');
  });

  it('treats A as already covering expired events', () => {
    expect(withExpiredKeyEvents('AKE')).toBe('AKE');
  });
});
