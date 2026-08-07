'use client';

import { useState } from 'react';
import Image from 'next/image';

export default function PlayerAvatar({ player, size = 34 }) {
  // A photo_url can outlive its file (an upload that never landed, a
  // deleted object). Falling back to the initials beats showing an
  // empty box that reads as "this photo is broken". Remembering WHICH
  // url failed means a new photo is tried again instead of inheriting
  // the previous one's verdict.
  const [brokenUrl, setBrokenUrl] = useState(null);

  const style = {
    width: size,
    height: size,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    flexShrink: 0,
    overflow: 'hidden',
    background: '#dde3ee',
    color: '#0d2347',
    fontSize: Math.round(size * 0.32),
  };

  if (!player) {
    return <div style={{ ...style, background: '#eee', color: '#888' }}>?</div>;
  }

  if (player.photo_url && brokenUrl !== player.photo_url) {
    return (
      <div style={style}>
        <Image
          src={player.photo_url}
          alt=""
          width={size}
          height={size}
          // Avatars render at 26-44px all over the app; requesting the
          // display size (instead of the ~1024px original the upload
          // stores) is what actually cuts egress — Next resizes and
          // re-encodes to WebP server-side and caches the result.
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={() => setBrokenUrl(player.photo_url)}
        />
      </div>
    );
  }

  const initials = (player.full_name || '?')
    .split(' ')
    .map((w) => w[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return <div style={style}>{initials}</div>;
}
