import { describe, it, expect } from 'vitest';
import { photoPath, thumbPath, thumbUrl } from './thumbs';

const BASE = 'https://abc.supabase.co/storage/v1/object/public/player-photos/';

describe('thumbs', () => {
  it('avatar → thumbs/<id>.sm.webp, cache-buster kept', () => {
    const url = `${BASE}6f1c2a3b-1234.jpeg?t=171`;
    expect(photoPath(url)).toBe('6f1c2a3b-1234.jpeg');
    expect(thumbUrl(url, 'sm')).toBe(`${BASE}thumbs/6f1c2a3b-1234.sm.webp?t=171`);
  });
  it('tournament photo in events/', () => {
    const url = `${BASE}events/e1.jpg?t=5`;
    expect(thumbPath(photoPath(url) as string, 'md')).toBe('thumbs/events/e1.md.webp');
    expect(thumbUrl(url, 'md')).toBe(`${BASE}thumbs/events/e1.md.webp?t=5`);
  });
  it('no cache-buster (photos saved at registration)', () => {
    expect(thumbUrl(`${BASE}u1.png`, 'sm')).toBe(`${BASE}thumbs/u1.sm.webp`);
  });
  it('foreign / empty URLs stay as they are', () => {
    expect(thumbUrl('https://t.me/i/userpic/320/x.jpg', 'sm')).toBe('https://t.me/i/userpic/320/x.jpg');
    expect(thumbUrl(null, 'sm')).toBe(null);
    expect(photoPath(`${BASE}thumbs/u1.sm.webp`)).toBe(null);
  });
});
