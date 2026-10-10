import { describe, it, expect } from 'vitest';
import { isForeignError, dropForeignErrors } from './sentryFilter';

const ev = (...files: string[]) => ({ exception: { values: [{ stacktrace: { frames: files.map((filename) => ({ filename })) } }] } });

describe('sentry filter', () => {
  it('drops extension / injected scripts', () => {
    expect(isForeignError(ev('app:///executors/200.js', 'app:///executors/200.js'))).toBe(true);
    expect(isForeignError(ev('chrome-extension://abcdef/content.js'))).toBe(true);
    expect(isForeignError(ev('safari-web-extension://x/script.js'))).toBe(true);
    expect(isForeignError(ev('moz-extension://x/a.js'))).toBe(true);
    expect(dropForeignErrors(ev('chrome-extension://abc/a.js'))).toBe(null);
  });
  it('keeps the app’s own errors, also when an extension is in the stack', () => {
    expect(isForeignError(ev('https://americanka-nextjs-fiqe.vercel.app/_next/static/chunks/app/page-1.js'))).toBe(false);
    expect(isForeignError(ev('chrome-extension://abc/a.js', 'https://x.vercel.app/_next/static/chunks/9.js'))).toBe(false);
    expect(isForeignError({ message: 'no stack' })).toBe(false);
    const e = ev('https://x.vercel.app/_next/static/chunks/9.js');
    expect(dropForeignErrors(e)).toBe(e);
  });
});
