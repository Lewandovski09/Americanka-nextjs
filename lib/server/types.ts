// Shared types for lib/server/. Kept loose by design: without generated
// Supabase types (no `supabase gen types` available in this pass), a
// row shape here is only as precise as the columns each function
// actually selects — enough to catch a typo'd property name or a
// forgotten null check, not a full schema mirror.

import type { createAdminClient } from '../supabase/admin';

/** The service-role client every server/ function receives as its first arg. */
export type SupabaseAdmin = ReturnType<typeof createAdminClient>;

export interface JudgeRole {
  isAdmin: boolean;
  isJudge: boolean;
  isHeadJudge: boolean;
}
