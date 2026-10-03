-- ============================================================
-- AMERICANKA — Migration 044: drop tournament_categories.location
-- ============================================================
-- RUN ONLY AFTER THE CODE FROM THE SAME PATCH AS 043 IS DEPLOYED.
-- The previous code still writes this column when it creates a
-- category; the new code neither writes nor reads it.
--
-- Why it goes: a category was stamped with its event's venue once, at
-- creation, and never again — moving the event (basics route) left every
-- category pointing at the old venue. The venue belongs to the event;
-- a category reaches it through event_id. One place, no drift.

alter table if exists tournament_categories drop column if exists location;
