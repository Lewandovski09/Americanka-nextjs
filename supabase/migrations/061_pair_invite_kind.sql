-- ============================================================
-- AMERICANKA — Migration 061: invitations for a named partner too
-- ============================================================
-- Naming a partner in an application no longer pairs them up on the
-- spot: the application is filed alone and the named partner gets an
-- invitation; on «Прийняти» they join it. «kind» says who joins whom:
--   join_seeker  — the inviter joins the invitee's application
--                  (from a «Шукаю пару» notice, migration 058);
--   join_inviter — the invitee joins the inviter's application.
--
-- Also: users columns added in the future are NOT readable from the
-- browser until granted (migration 058 grants column by column). When a
-- column is added to users, add it to the grant in 058 and to
-- lib/userColumns.js.
--
-- Idempotent.

alter table pair_invites add column if not exists kind text not null default 'join_seeker';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pair_invites_kind_check') then
    alter table pair_invites add constraint pair_invites_kind_check check (kind in ('join_seeker', 'join_inviter'));
  end if;
end $$;

notify pgrst, 'reload schema';
