'use client';

import { useState } from 'react';
import ThumbImage from '@/components/ThumbImage';

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
    return (
      <div style={{ ...style, background: '#eee', color: '#888' }} role="img" aria-label="Гравець невідомий">
        ?
      </div>
    );
  }

  if (player.photo_url && brokenUrl !== player.photo_url) {
    return (
      <div style={style}>
        <ThumbImage
          src={player.photo_url}
          kind="sm"
          alt={player.full_name || ''}
          width={size}
          height={size}
          // the 128 px copy (~5 KB), not the ~1024 px original (lib/thumbs)
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onBroken={() => setBrokenUrl(player.photo_url)}
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

  // No photo yet: the visible initials are a fine stand-in for sighted
  // users, but a screen reader would otherwise read out one or two bare
  // letters with no context — role="img" + the full name fixes that
  // without changing anything on screen.
  return (
    <div style={style} role="img" aria-label={player.full_name || 'Гравець без фото'}>
      {initials}
    </div>
  );
}
