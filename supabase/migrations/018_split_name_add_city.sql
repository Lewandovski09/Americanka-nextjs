-- ============================================================
-- 018 — Split full_name into first_name + last_name, add city
-- ============================================================
-- Registration now collects the first and last name separately plus the
-- player's city. Existing rows are backfilled by splitting full_name on
-- the first space (single-word names get an empty last name).
--
-- full_name is kept as a GENERATED column so every existing read path
-- (profile, rating, brackets, RPCs, joins) keeps working unchanged —
-- only the write paths switch to first_name/last_name.

alter table players
  add column first_name text,
  add column last_name text,
  add column city text;

update players
set
  first_name = split_part(full_name, ' ', 1),
  last_name  = btrim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1));

alter table players
  alter column first_name set not null,
  alter column last_name set not null,
  alter column last_name set default '';

alter table players drop column full_name;

alter table players
  add column full_name text generated always as (
    case when last_name = '' then first_name
         else first_name || ' ' || last_name
    end
  ) stored;
