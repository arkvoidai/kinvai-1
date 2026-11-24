import { describe, expect, it } from 'vitest';
import { buildOAuthRedirectUrl, validateNextPath } from './authHelpers';

describe('validateNextPath', () => {
  it('keeps a same-origin route including query and hash', () => {
    expect(validateNextPath('/account?tab=orders#latest')).toBe('/account?tab=orders#latest');
  });

  it('uses the fallback for absolute and protocol-relative URLs', () => {
    expect(validateNextPath('https://attacker.example/path')).toBe('/account');
    expect(validateNextPath('//attacker.example/path')).toBe('/account');
  });

  it('blocks callback loops and control characters', () => {
    expect(validateNextPath('/auth/callback?next=/account')).toBe('/account');
    expect(validateNextPath('/account\nhttps://attacker.example')).toBe('/account');
  });
});

describe('buildOAuthRedirectUrl', () => {
  it('uses the configured production origin on the production host', () => {
    expect(
      buildOAuthRedirectUrl(
        'https://kinvai.arkvoid.com',
        '/account?tab=profile',
        'https://kinvai.arkvoid.com'
      )
    ).toBe(
      'https://kinvai.arkvoid.com/auth/callback?next=%2Faccount%3Ftab%3Dprofile'
    );
  });

  it('keeps the active preview origin and validates the return path', () => {
    expect(
      buildOAuthRedirectUrl(
        'https://kinvai.arkvoid.com',
        '//attacker.example',
        'https://preview.run.app'
      )
    ).toBe('https://preview.run.app/auth/callback?next=%2Faccount');
  });
});


describe('validateNextPath rejects malformed and script-like paths', () => {
  it.each(['//evil.com', 'https://evil.com', 'javascript:alert(1)', '/\\\\evil.com', '/auth/callback?code=abc'])(
    'rejects %s',
    (path) => expect(validateNextPath(path)).toBe('/account')
  );

  it('preserves an approved route query and hash', () => {
    expect(validateNextPath('/account?tab=library#downloads')).toBe('/account?tab=library#downloads');
  });
});
