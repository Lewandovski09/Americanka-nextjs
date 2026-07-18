-- ============================================================
-- AMERICANKA — Seed: 128 test players (male1…male64, female1…female64)
-- ============================================================
-- Creates 128 approved test accounts for trying out tournaments:
-- 64 men + 64 women = enough for 32 male pairs + 32 female pairs.
--   login / full_name : maleN / femaleN  (N = 1…64)
--   email             : maleN@example.com / femaleN@example.com
--   phone             : males +38096XXXXXXX, females +38095XXXXXXX
--   elo               : 1015 … 1960  (spread so Elo bands differ)
--   approval_status   : approved  (can be distributed right away)
--
-- Because players.id references auth.users(id), each account is created
-- in BOTH auth.users and public.players with the same id. Password is
-- 'test1234' for every account (login isn't needed for admin testing).
--
-- Idempotent: re-running only fills in whatever is missing. If the
-- auth.users account already exists it is reused (and its players row
-- re-created when it was deleted); nothing existing is overwritten.
-- For a truly fresh start run the cleanup at the bottom first.

do $$
declare
  uid uuid;
  n int;
  g text;
  lname text;
begin
  for n in 1..64 loop
    foreach g in array array['M', 'F'] loop
      lname := (case when g = 'M' then 'male' else 'female' end) || n;

      -- Reuse the auth account if it survived an earlier cleanup;
      -- otherwise create it. Either way the players insert below
      -- restores a missing profile (no-op when it already exists).
      select id into uid from auth.users where email = lname || '@example.com';
      if uid is null then
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
          lname || '@example.com',
          crypt('test1234', gen_salt('bf')),
          now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          '{}'::jsonb,
          now(),
          now()
        );
      end if;

      insert into public.players (
        id, login, first_name, last_name, city, email, phone, gender, elo,
        approval_status, approved_at
      ) values (
        uid,
        lname,
        lname,
        '',      -- empty last name → generated full_name stays just "maleN"
        'Одеса',
        lname || '@example.com',
        (case when g = 'M' then '+38096' else '+38095' end) || lpad(n::text, 7, '0'),
        g::gender_type,
        1000 + n * 15,
        'approved',
        now()
      )
      on conflict (id) do nothing;
    end loop;
  end loop;
end $$;

-- ── Cleanup (run to remove all test accounts) ───────────────
-- Deleting from auth.users cascades to public.players.
--
--   delete from auth.users where email like 'male%@example.com'
--                             or email like 'female%@example.com';
