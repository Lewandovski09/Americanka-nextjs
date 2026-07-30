-- ============================================================
-- AMERICANKA — collapse telegram_chat_id into telegram_user_id
-- ============================================================
-- In a private chat Telegram defines the chat id as the user's own id,
-- so message.chat.id === message.from.id and these two columns always
-- held the same number — with two unique indexes over it.
--
-- They were kept apart because chat_id doubled as a state flag: it was
-- nulled when someone blocked the bot, while user_id stayed so we still
-- knew who they were. But telegram_linked_at already carries exactly
-- that state, so the split earns nothing.
--
-- After this migration:
--   telegram_user_id              — identity AND send target (unique)
--   telegram_linked_at not null   — linked and reachable
--
-- The equality only holds for private chats, so the webhook now refuses
-- to link from any other chat type.

alter table players drop column if exists telegram_chat_id;

-- Same reasoning for the audit copy kept on the link row.
alter table telegram_links drop column if exists chat_id;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'players'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) like '%(telegram_user_id)%'
  ) then
    raise exception 'players.telegram_user_id is missing its UNIQUE constraint — run 004 first';
  end if;
end $$;
