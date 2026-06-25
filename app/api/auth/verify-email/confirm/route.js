import { createAdminClient } from '@/lib/supabase/admin';
import { verifyCode } from '@/lib/verification';

export async function POST(request) {
  const { email, code } = await request.json();

  if (!email || !code) {
    return Response.json({ success: false, error: 'Відсутні дані' }, { status: 400 });
  }

  const supabaseAdmin = createAdminClient();
  const result = await verifyCode(supabaseAdmin, 'email', email, code);
  return Response.json(result);
}
