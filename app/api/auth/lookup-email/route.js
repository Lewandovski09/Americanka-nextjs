import { createAdminClient } from '@/lib/supabase/admin';

// This MUST use the admin client (bypasses RLS) because the
// players_select_approved RLS policy only allows anonymous reads
// of APPROVED players. Without this, anyone who is still pending
// (or an admin checking their own login before being authenticated)
// would never be found, and login would always fail with "wrong
// login or password" even though the password is correct.
export async function POST(request) {
  try {
    const { login } = await request.json();

    if (!login || typeof login !== 'string') {
      return Response.json({ success: false, error: 'Вкажіть логін' }, { status: 400 });
    }

    const supabaseAdmin = createAdminClient();

    const { data: playerRow, error } = await supabaseAdmin
      .from('players')
      .select('email')
      .eq('login', login.trim().toLowerCase())
      .maybeSingle();

    if (error || !playerRow) {
      // Deliberately vague error — don't reveal whether the login
      // exists or not, for basic security hygiene.
      return Response.json({ success: false, error: 'Невірний логін або пароль' }, { status: 401 });
    }

    return Response.json({ success: true, email: playerRow.email });
  } catch (err) {
    console.error('[lookup-email] Unexpected error:', err.message);
    return Response.json({ success: false, error: 'Помилка сервера' }, { status: 500 });
  }
}
