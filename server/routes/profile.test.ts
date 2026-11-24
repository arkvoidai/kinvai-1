import { describe, expect, it } from 'vitest';
import { safeGoogleProfileMetadata } from './profile';

describe('safeGoogleProfileMetadata', () => {
  it('extracts only display name and HTTPS avatar fields', () => {
    expect(safeGoogleProfileMetadata({
      full_name: '  Kinvai Owner  ',
      picture: 'https://lh3.googleusercontent.com/avatar.png',
      is_admin: true,
      role: 'admin',
    })).toEqual({
      display_name: 'Kinvai Owner',
      avatar_url: 'https://lh3.googleusercontent.com/avatar.png',
    });
  });

  it('ignores unsafe avatar URLs and caps names to the profile column limit', () => {
    const result = safeGoogleProfileMetadata({
      name: 'A'.repeat(150),
      avatar_url: 'javascript:alert(1)',
    });
    expect(result.display_name).toHaveLength(120);
    expect(result).not.toHaveProperty('avatar_url');
    expect(result).not.toHaveProperty('is_admin');
  });

  it('does not synthesize role fields from untrusted user metadata', () => {
    expect(safeGoogleProfileMetadata({ is_admin: true, role: 'owner' })).toEqual({});
  });
});
