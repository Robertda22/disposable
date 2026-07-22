-- Run once in the Supabase SQL Editor if schema.sql was applied before this fix.
create or replace function public.join_event(event_code text, guest_name text, guest_contact text default null)
returns table (event_id uuid, guest_id uuid, join_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.events;
  joined public.guests;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select e.* into target
  from public.events e
  where e.code = upper(event_code) and e.status in ('live', 'review')
  for update;

  if target.id is null then raise exception 'Event not found'; end if;
  if target.status <> 'live' then raise exception 'Capture is closed'; end if;
  if (
    select count(*)
    from public.guests g
    where g.event_id = target.id and g.status in ('pending', 'approved')
  ) >= target.guest_capacity then
    raise exception 'Event is full';
  end if;

  insert into public.guests (event_id, user_id, display_name, contact)
  values (target.id, auth.uid(), trim(guest_name), nullif(trim(guest_contact), ''))
  on conflict (event_id, user_id) do update
    set display_name = excluded.display_name, contact = excluded.contact
  returning * into joined;

  return query select target.id, joined.id, joined.status;
end;
$$;

grant execute on function public.join_event(text, text, text) to authenticated;
