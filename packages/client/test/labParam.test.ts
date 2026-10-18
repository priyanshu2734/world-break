import { describe, expect, it } from 'vitest';
import { labRequested } from '../src/net/labParam';

describe('?lab=1 dev flag', () => {
  it('is on only for lab=1', () => {
    expect(labRequested('?lab=1')).toBe(true);
    expect(labRequested('?foo=2&lab=1')).toBe(true);
  });
  it('is off for everything else', () => {
    for (const s of ['', '?', '?lab=0', '?lab=true', '?lab', '?Lab=1', '?lab=11', '?labs=1']) expect(labRequested(s)).toBe(false);
  });
});
