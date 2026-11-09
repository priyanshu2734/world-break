import { describe, expect, it } from 'vitest';
import {
  EventLimiter, KeyedLimiter, VIOLATION_KICK, clientIp, contentSecurityPolicy, normalizeOrigin, originAllowed, parseOrigins, securityHeaders,
} from '../../src/security';

describe('P7 origins', () => {
  it('normalises plain http(s) origins and refuses wildcards, null, paths-as-origins and other schemes', () => {
    expect(normalizeOrigin('https://Play.Example.com/')).toBe('https://play.example.com');
    expect(normalizeOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(normalizeOrigin('*')).toBeNull();
    expect(normalizeOrigin('null')).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull();
    expect(normalizeOrigin('ftp://example.com')).toBeNull();
    expect(normalizeOrigin('not a url')).toBeNull();
  });
  it('parses a comma separated list, drops bad entries and duplicates', () => {
    expect(parseOrigins('https://a.example, https://b.example/ ,*, https://a.example')).toEqual(['https://a.example', 'https://b.example']);
    expect(parseOrigins('')).toEqual([]);
  });
  it('allows a configured origin and a missing header, refuses everything else', () => {
    const allowed = ['https://play.example.com'];
    expect(originAllowed('https://play.example.com', allowed)).toBe(true);
    expect(originAllowed(undefined, allowed)).toBe(true);
    expect(originAllowed('https://evil.example', allowed)).toBe(false);
    expect(originAllowed('http://play.example.com', allowed)).toBe(false);
    expect(originAllowed('https://play.example.com.evil.example', allowed)).toBe(false);
    expect(originAllowed('null', allowed)).toBe(false);
  });
});

describe('P7 client address behind a proxy', () => {
  it('ignores X-Forwarded-For unless proxies are trusted (a client cannot pick its own address)', () => {
    expect(clientIp({ 'x-forwarded-for': '9.9.9.9' }, '::ffff:10.0.0.1', 0)).toBe('10.0.0.1');
  });
  it('takes the address the N-th trusted proxy from the right appended', () => {
    const h = { 'x-forwarded-for': '6.6.6.6, 1.2.3.4, 10.0.0.5' };
    expect(clientIp(h, '10.0.0.9', 1)).toBe('10.0.0.5');
    expect(clientIp(h, '10.0.0.9', 2)).toBe('1.2.3.4');
    expect(clientIp(h, '10.0.0.9', 3)).toBe('6.6.6.6');
    expect(clientIp(h, '10.0.0.9', 4)).toBe('10.0.0.9'); // more hops than entries: fall back to the socket
    expect(clientIp({}, undefined, 1)).toBe('unknown');
  });
});

describe('P7 rate limiters', () => {
  it('KeyedLimiter: a burst, then the refill rate, per key, and it forgets old keys', () => {
    let t = 0;
    const l = new KeyedLimiter({ perSecond: 2, burst: 3 }, 2, () => t);
    expect([l.take('a'), l.take('a'), l.take('a'), l.take('a')]).toEqual([true, true, true, false]);
    expect(l.take('b')).toBe(true); // another key has its own bucket
    t = 500; // one token back
    expect(l.take('a')).toBe(true);
    expect(l.take('a')).toBe(false);
    l.take('c'); l.take('d');
    expect(l.size).toBeLessThanOrEqual(2);
  });
  it('EventLimiter: a known event has its own budget; unknown event names share one small bucket', () => {
    let t = 0;
    const l = new EventLimiter({ 'chat:send': { perSecond: 1, burst: 2 } }, { perSecond: 1, burst: 2 }, { perSecond: 1000, burst: 1000 }, () => t);
    expect([l.check('chat:send'), l.check('chat:send'), l.check('chat:send')]).toEqual(['ok', 'ok', 'drop']);
    expect(l.check('other-a')).toBe('ok');
    expect(l.check('other-b')).toBe('ok');
    expect(l.check('other-c')).toBe('drop'); // different made-up names, one bucket
    t = 1000;
    expect(l.check('chat:send')).toBe('ok');
  });
  it('EventLimiter: the whole-socket budget applies across events', () => {
    const l = new EventLimiter({ a: { perSecond: 100, burst: 100 }, b: { perSecond: 100, burst: 100 } }, { perSecond: 1, burst: 1 }, { perSecond: 1, burst: 3 }, () => 0);
    expect([l.check('a'), l.check('b'), l.check('a'), l.check('b')]).toEqual(['ok', 'ok', 'ok', 'drop']);
  });
  it('EventLimiter: a sustained flood ends in a kick', () => {
    const l = new EventLimiter({}, { perSecond: 0, burst: 1 }, { perSecond: 1000, burst: 1000 }, () => 0);
    expect(l.check('x')).toBe('ok');
    let last = 'drop';
    for (let i = 0; i < VIOLATION_KICK + 5; i++) last = l.check('x');
    expect(last).toBe('kick');
  });
});

describe('P7 response headers', () => {
  it('the policy has no inline script, no eval, no framing, and only Google as a third party', () => {
    const csp = contentSecurityPolicy(['https://play.example.com']);
    const script = csp.split('; ').find((d) => d.startsWith('script-src')) ?? '';
    expect(script).toBe("script-src 'self' https://accounts.google.com/gsi/client");
    expect(csp).not.toMatch(/unsafe-eval/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/connect-src 'self' wss:\/\/play\.example\.com/);
  });
  it('CSP mode picks the header; HSTS only when asked', () => {
    const base = { origins: ['https://a.example'] };
    expect(securityHeaders({ ...base, csp: 'enforce', hsts: false })['Content-Security-Policy']).toBeDefined();
    const ro = securityHeaders({ ...base, csp: 'report-only', hsts: true });
    expect(ro['Content-Security-Policy']).toBeUndefined();
    expect(ro['Content-Security-Policy-Report-Only']).toBeDefined();
    expect(ro['Strict-Transport-Security']).toMatch(/max-age=/);
    const off = securityHeaders({ ...base, csp: 'off', hsts: false });
    expect(off['Content-Security-Policy']).toBeUndefined();
    expect(off['Strict-Transport-Security']).toBeUndefined();
    expect(off['X-Content-Type-Options']).toBe('nosniff');
    expect(off['X-Frame-Options']).toBe('DENY');
  });
});
