'use client';

import { useState } from 'react';

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
        <img
          src={player.photo_url}
          alt=""
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
