import { describe, expect, it } from 'vitest';
import { judgeKey, parseDeadlineKey, playKey } from './deadlineKeys';

describe('CAHO deadline namespace', () => {
  it('prefixes both deadline types', () => {
    expect(playKey('abc')).toBe('caho:round:abc:play');
    expect(judgeKey('abc')).toBe('caho:round:abc:judge');
  });

  it.each(['play', 'judge'] as const)('decodes a prefixed %s expiry', kind => {
    expect(parseDeadlineKey(`caho:round:abc:${kind}`)).toEqual({
      roundId: 'abc',
      kind
    });
  });

  it.each([
    'round:abc:play',
    'other:round:abc:play',
    'caho:round:abc:unknown',
    'caho:round::play',
    'caho:round:abc:play:extra'
  ])('ignores foreign or malformed key %s', key => {
    expect(parseDeadlineKey(key)).toBeNull();
  });
});
