import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeIdentifier } from '@/lib/authIdentity';

// The sign-in form lets someone type their login OR their Telegram
// handle (any format — @name, t.me/name, or bare). Two separate .eq()
// lookups rather than one .or() filter: building an .or() string from
// raw user input risks the identifier itself containing characters
// PostgREST's filter syntax treats specially (commas, parentheses);
// .eq() parameterizes properly and sidesteps that entirely, at the
// cost of a second cheap indexed lookup only when the first misses.
export async function POST(request) {
  try {
    const { identifier } = await request.json();
    const normalized = normalizeIdentifier(identifier);

    if (!normalized) {
      return Response.json({ success: false, error: 'Введіть логін або Telegram' }, { status: 400 });
    }

    const supabaseAdmin = createAdminClient();

    const { data: byLogin } = await supabaseAdmin
      .from('users')
      .select('login')
      .eq('login', normalized)
      .maybeSingle();

    if (byLogin) {
      return Response.json({ success: true, login: byLogin.login });
    }

    const { data: byTelegram } = await supabaseAdmin
      .from('users')
      .select('login')
      .eq('telegram_username', normalized)
      .maybeSingle();

    if (byTelegram) {
      return Response.json({ success: true, login: byTelegram.login });
    }

    return Response.json({ success: false, error: 'Гравця не знайдено' }, { status: 404 });
  } catch (err) {
    console.error('[resolve-login] Unexpected error:', err.message);
    return Response.json({ success: false, error: 'Помилка сервера' }, { status: 500 });
  }
}
