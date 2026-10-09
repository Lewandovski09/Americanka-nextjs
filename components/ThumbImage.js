'use client';

// A photo through its small copy (lib/thumbs): the ~5 KB avatar or the
// ~60 KB card photo instead of the full original. If the small copy isn't
// there yet (a photo uploaded before copies existed, until the admin's
// «Стиснути фото» has run) it quietly falls back to the original; if the
// original is gone too, `onBroken` is called.

import { useEffect, useState } from 'react';
import { thumbUrl } from '@/lib/thumbs';

export default function ThumbImage({ src, kind = 'sm', alt = '', onBroken, loading = 'lazy', ...rest }) {
  const small = thumbUrl(src, kind);
  const [current, setCurrent] = useState(small);
  useEffect(() => setCurrent(thumbUrl(src, kind)), [src, kind]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...rest}
      src={current || src}
      alt={alt}
      loading={loading}
      decoding="async"
      onError={() => {
        if (current !== src) setCurrent(src);
        else onBroken?.();
      }}
    />
  );
}
