-- ============================================================
-- Разовое исправление: микс 1 августа 2026
--   Pro           → AVP 500
--   Medium, Light → AVP 250
-- ============================================================
-- Что делает:
--   1. находит ОДНО событие формата «Мікс» с датой 1 августа 2026
--      (если их 0 или больше одного — останавливается, ничего не меняя);
--   2. ставит уровень AVP каждой категории этого события;
--   3. пересчитывает уже начисленные очки AVP этих категорий по новому
--      уровню. Места игроков не меняются — меняются только очки за место.
--
-- Таблица очков (новая, та же, что в lib/avp/tiers.ts и миграции 046):
--   место      1    2    3    4   5-6  7-8  9-12  13-16
--   AVP 250   250  200  175  150  125  100   75    50
--   AVP 500   500  400  350  300  275  250  150   100
--
-- Всё в одной транзакции: при любой ошибке ничего не сохранится.
-- Запускать в Supabase → SQL Editor целиком.

begin;

do $$
declare
  ev record;
  n_events int;
  r record;
  n_pts int;
begin
  select count(*) into n_events
  from tournament_events
  where format_kind::text = 'mix'
    and scheduled_at >= timestamptz '2026-08-01 00:00+03' and scheduled_at < timestamptz '2026-08-02 00:00+03';

  if n_events <> 1 then
    raise exception 'Ожидалось ровно 1 событие «Мікс» на 01.08.2026, найдено: %. Ничего не изменено.', n_events;
  end if;

  select * into ev
  from tournament_events
  where format_kind::text = 'mix'
    and scheduled_at >= timestamptz '2026-08-01 00:00+03' and scheduled_at < timestamptz '2026-08-02 00:00+03';

  raise notice 'Событие: «%» (id %), уровень события: %', ev.name, ev.id, coalesce(ev.avp_tier::text, 'нет');

  -- 2. Уровень AVP по категориям
  update tournament_categories
  set avp_tier = case when category_label = 'Pro' then 500 else 250 end
  where event_id = ev.id
    and category_label in ('Pro', 'Medium', 'Light');

  -- 3. Пересчёт уже начисленных очков по сохранённым местам
  update avp_points p
  set tier = c.avp_tier,
      points = coalesce(
        (case c.avp_tier
           when 500 then array[500, 400, 350, 300, 275, 250, 150, 100]
           else          array[250, 200, 175, 150, 125, 100, 75, 50]
         end)[
          case
            when p.place = 1 then 1
            when p.place = 2 then 2
            when p.place = 3 then 3
            when p.place = 4 then 4
            when p.place between 5 and 6 then 5
            when p.place between 7 and 8 then 6
            when p.place between 9 and 12 then 7
            when p.place between 13 and 16 then 8
          end
        ],
        0)  -- места за пределами таблицы — 0 очков, как в приложении
  from tournament_categories c
  where p.category_id = c.id
    and c.event_id = ev.id;

  for r in
    select c.category_label, c.avp_tier, count(p.id) as players, coalesce(sum(p.points), 0) as total
    from tournament_categories c
    left join avp_points p on p.category_id = c.id
    where c.event_id = ev.id
    group by c.category_label, c.avp_tier
    order by c.avp_tier desc, c.category_label
  loop
    raise notice '  % → AVP %: строк очков %, всего очков %', r.category_label, r.avp_tier, r.players, r.total;
  end loop;

  select count(*) into n_pts
  from avp_points p join tournament_categories c on c.id = p.category_id
  where c.event_id = ev.id;
  if n_pts = 0 then
    raise notice 'ВНИМАНИЕ: по этому событию ещё не было начислено ни одного очка AVP — уровни выставлены, но очки нужно пересчитать через приложение (см. инструкцию).';
  end if;
end;
$$;

-- Итог для проверки глазами:
select c.category_label as "категория",
       c.avp_tier       as "AVP",
       u.full_name      as "игрок",
       p.place          as "место",
       p.points         as "очки"
from avp_points p
join tournament_categories c on c.id = p.category_id
join tournament_events e on e.id = c.event_id
join users u on u.id = p.user_id
where e.format_kind::text = 'mix'
  and e.scheduled_at >= timestamptz '2026-08-01 00:00+03' and e.scheduled_at < timestamptz '2026-08-02 00:00+03'
order by c.avp_tier desc, c.category_label, p.place, u.full_name;

commit;
