// The columns of `users` the browser may read (migration 058 grants
// exactly these to signed-in users — the Telegram id is server-only).
// Use this instead of select('*') on users from client code: '*' would
// ask for the hidden column too and the whole request would be refused.
export const USER_COLUMNS =
  'id, login, telegram_username, photo_url, gender, is_admin, elo, category, approval_status, approved_at, approved_by, ' +
  'just_registered_notified, rating_approved_notified, tournaments_played, tournaments_won, created_at, updated_at, ' +
  'requested_category, telegram_linked_at, first_name, last_name, city, full_name';
