-- ============================================================
-- AMERICANKA — Seed: 48 test players (test1 … test48)
-- ============================================================
-- Creates 48 approved test accounts for trying out tournaments.
--   login / full_name : test1 … test48
--   email             : testN@example.com
--   phone             : +380990000001 … (unique per account)
--   gender            : odd N → M, even N → F  (24 men / 24 women)
--   elo               : 1020 … 1960  (spread so Elo bands differ)
--   approval_status   : approved  (can be distributed right away)
--
-- Because players.id references auth.users(id), each account is created
-- in BOTH auth.users and public.players with the same id. Password is
-- 'test1234' for every account (login isn't needed for admin testing).
--
-- Safe to run once in the Supabase SQL Editor. Re-running will fail on
-- the unique login/email/phone — clean up first (see bottom).

do $$
declare
  uid uuid;
  n int;
begin
  for n in 1..48 loop
    uid := uuid_generate_v4();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000',
      uid,
      'authenticated',
      'authenticated',
      'test' || n || '@example.com',
      crypt('test1234', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    );

    insert into public.players (
      id, login, full_name, email, phone, gender, elo,
      approval_status, approved_at
    ) values (
      uid,
      'test' || n,
      'test' || n,
      'test' || n || '@example.com',
      '+38099' || lpad(n::text, 7, '0'),
      (case when n % 2 = 0 then 'F' else 'M' end)::gender_type,
      1000 + n * 20,
      'approved',
      now()
    );
  end loop;
end $$;

-- ── Cleanup (run to remove all test accounts) ───────────────
-- Deleting from auth.users cascades to public.players.
--
--   delete from auth.users where email like 'test%@example.com';
