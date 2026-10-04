-- ============================================================
-- AMERICANKA — Migration 054: a photo of the tournament
-- ============================================================
-- During or after a tournament the admin (or a judge of it) uploads a
-- group photo of the participants. It is shown on the finished
-- tournament (list «Завершені» and the tournament page), and for one day
-- after the end on the home page in «Найближчий турнір».
--
-- The file lives in the existing public bucket «player-photos» under
-- events/<event id>.jpg; the server writes it with the service key.
--
-- Idempotent.

alter table tournament_events add column if not exists photo_url text;

notify pgrst, 'reload schema';
