export default function PlayerAvatar({ player, size = 34 }) {
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

  if (player.photo_url) {
    return (
      <div style={style}>
        <img src={player.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
