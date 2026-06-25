// Verification code generation/checking, backed by the
// `verification_codes` table — this survives server restarts,
// unlike the old in-memory Map approach.

const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds between resends

function generateCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// Identifiers are compared as plain strings, exactly as given —
// no case-folding. This matters for Telegram chat_id (a number
// stringified) where .toLowerCase() is a no-op anyway, but keeping
// the normalization IDENTICAL between create and verify is what
// actually matters here.
function normalizeIdentifier(identifier) {
  return String(identifier).trim();
}

/**
 * Create and store a new verification code for a given channel +
 * identifier (telegram chat_id or email address).
 * Returns { code } on success, or { error } if rate-limited.
 */
export async function createVerificationCode(supabaseAdmin, channel, identifier) {
  const normalizedId = normalizeIdentifier(identifier);

  const { data: recent } = await supabaseAdmin
    .from('verification_codes')
    .select('id, created_at')
    .eq('channel', channel)
    .eq('identifier', normalizedId)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent) {
    const elapsed = Date.now() - new Date(recent.created_at).getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      const waitSec = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
      return { error: `Зачекайте ${waitSec} сек. перед повторною відправкою` };
    }
    // Invalidate the previous unconsumed code so there's never more
    // than one "live" code per identifier — this removes any
    // ambiguity about which code is the "real" current one.
    await supabaseAdmin
      .from('verification_codes')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', recent.id);
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  const { error, data: inserted } = await supabaseAdmin
    .from('verification_codes')
    .insert({
      channel,
      identifier: normalizedId,
      code,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) {
    console.error('[verification] Failed to store code:', error.message);
    return { error: 'Помилка сервера. Спробуйте ще раз.' };
  }

  console.log('[verification] Code created:', { channel, identifier: normalizedId, codeId: inserted?.id });

  return { code };
}

/**
 * Verify a submitted code against the most recent unconsumed code
 * for this channel + identifier.
 */
export async function verifyCode(supabaseAdmin, channel, identifier, submittedCode) {
  const normalizedId = normalizeIdentifier(identifier);

  const { data: entry, error } = await supabaseAdmin
    .from('verification_codes')
    .select('*')
    .eq('channel', channel)
    .eq('identifier', normalizedId)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  console.log('[verification] Lookup for verify:', { channel, identifier: normalizedId, found: !!entry, error: error?.message });

  if (error || !entry) {
    return { success: false, error: 'Код не знайдено. Спочатку запросіть новий код.' };
  }

  if (new Date(entry.expires_at).getTime() < Date.now()) {
    return { success: false, error: 'Код застарів. Запросіть новий.' };
  }

  if (entry.attempts >= entry.max_attempts) {
    return { success: false, error: 'Забагато спроб. Запросіть новий код.' };
  }

  if (entry.code !== String(submittedCode).trim()) {
    await supabaseAdmin
      .from('verification_codes')
      .update({ attempts: entry.attempts + 1 })
      .eq('id', entry.id);
    return { success: false, error: 'Невірний код' };
  }

  await supabaseAdmin
    .from('verification_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', entry.id);

  return { success: true };
}
