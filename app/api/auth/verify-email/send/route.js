import { createAdminClient } from '@/lib/supabase/admin';
import { createVerificationCode } from '@/lib/verification';
import { sendVerificationEmail } from '@/lib/emailSender';

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request) {
  try {
    const { email } = await request.json();

    if (!email || !isValidEmail(email)) {
      return Response.json({ success: false, error: 'Невірний формат email' }, { status: 400 });
    }

    const supabaseAdmin = createAdminClient();
    const { code, error } = await createVerificationCode(supabaseAdmin, 'email', email);

    if (error) {
      return Response.json({ success: false, error }, { status: 429 });
    }

    await sendVerificationEmail(email, code);

    return Response.json({ success: true, message: 'Код надіслано на email' });
  } catch (err) {
    console.error('[send-email-code] error:', err.message);
    return Response.json(
      { success: false, error: 'Не вдалося надіслати email. Спробуйте пізніше.' },
      { status: 500 }
    );
  }
}
