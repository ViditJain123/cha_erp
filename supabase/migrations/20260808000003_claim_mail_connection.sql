-- Atomically claims the next mailbox due for polling.
--
-- `for update skip locked` is what makes two workers safe to run at once: the
-- second skips the row the first is holding rather than blocking on it. The
-- staleness window reclaims connections whose worker was killed mid-poll.
create or replace function public.claim_mail_connection(
  p_worker text,
  p_stale_after interval default '10 minutes'
)
returns setof public.mail_connections
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.mail_connections c
     set locked_at = now(),
         locked_by = p_worker
   where c.id = (
     select inner_c.id
       from public.mail_connections inner_c
      where inner_c.status = 'active'
        and inner_c.next_poll_at <= now()
        and (inner_c.locked_at is null or inner_c.locked_at < now() - p_stale_after)
      order by inner_c.next_poll_at
      for update skip locked
      limit 1
   )
  returning c.*;
end;
$$;

revoke execute on function public.claim_mail_connection(text, interval) from anon, authenticated, public;
grant execute on function public.claim_mail_connection(text, interval) to service_role;
