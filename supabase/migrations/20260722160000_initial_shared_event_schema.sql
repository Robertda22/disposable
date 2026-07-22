-- Disposable shared-event MVP schema.
-- Apply to a new Supabase project, then enable Anonymous Sign-Ins in Auth.

create extension if not exists pgcrypto;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{4,10}$'),
  event_type text not null default 'birthday',
  name text not null check (char_length(name) between 1 and 80),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  review_reminder_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'live', 'review', 'revealed')),
  camera_style text not null default 'vintage' check (camera_style in ('vintage', 'original')),
  guest_capacity integer not null default 20 check (guest_capacity between 1 and 20),
  captures_per_guest integer check (captures_per_guest is null or captures_per_guest between 5 and 100),
  invite jsonb not null default '{}'::jsonb,
  host_message text not null default 'Thanks for an amazing night.',
  album_cta_label text,
  revealed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((status = 'revealed' and revealed_at is not null) or status <> 'revealed')
);

create table if not exists public.event_members (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'cohost')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table if not exists public.guests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  contact text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  joined_at timestamptz not null default now(),
  unique (event_id, user_id)
);

create table if not exists public.moments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  guest_id uuid references public.guests(id) on delete set null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('photo', 'clip')),
  storage_path text not null unique,
  width integer,
  height integer,
  duration_ms integer,
  removed boolean not null default false,
  favourite boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.albums (
  event_id uuid primary key references public.events(id) on delete cascade,
  approved_by uuid not null references auth.users(id),
  host_message text not null,
  cta_label text,
  approved_at timestamptz not null default now()
);

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  guest_id uuid references public.guests(id) on delete cascade,
  channel text not null check (channel in ('link', 'email', 'sms')),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists guests_event_status_idx on public.guests(event_id, status);
create index if not exists moments_event_created_idx on public.moments(event_id, created_at);

create or replace function public.is_event_host(target_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.event_members
    where event_id = target_event and user_id = auth.uid()
  );
$$;

create or replace function public.is_approved_guest(target_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.guests
    where event_id = target_event and user_id = auth.uid() and status = 'approved'
  );
$$;

create or replace function public.can_capture(target_event uuid, target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.events e
    where e.id = target_event
      and e.status = 'live'
      and (
        e.captures_per_guest is null
        or (
          select count(*)
          from public.moments m
          where m.event_id = target_event
            and m.owner_user_id = target_user
        ) < e.captures_per_guest
      )
  );
$$;

create or replace function public.add_event_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.event_members (event_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (event_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists add_event_owner_after_insert on public.events;
create trigger add_event_owner_after_insert
after insert on public.events
for each row execute function public.add_event_owner();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_events_updated_at on public.events;
create trigger touch_events_updated_at
before update on public.events
for each row execute function public.touch_updated_at();

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

  select * into target from public.events
  where code = upper(event_code) and status in ('live', 'review')
  for update;

  if target.id is null then raise exception 'Event not found'; end if;
  if target.status <> 'live' then raise exception 'Capture is closed'; end if;
  if (select count(*) from public.guests where public.guests.event_id = target.id and status in ('pending', 'approved')) >= target.guest_capacity then
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

create or replace function public.event_preview(event_code text)
returns table (id uuid, code text, name text, event_type text, starts_at timestamptz, ends_at timestamptz, status text, camera_style text, invite jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.code, e.name, e.event_type, e.starts_at, e.ends_at, e.status, e.camera_style, e.invite
  from public.events e
  where e.code = upper(event_code) and e.status <> 'draft';
$$;

alter table public.events enable row level security;
alter table public.event_members enable row level security;
alter table public.guests enable row level security;
alter table public.moments enable row level security;
alter table public.albums enable row level security;
alter table public.deliveries enable row level security;

create policy "hosts manage events" on public.events
for all to authenticated
using (public.is_event_host(id) or owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "approved members read events" on public.events
for select to authenticated
using (public.is_event_host(id) or public.is_approved_guest(id));

create policy "members read event membership" on public.event_members
for select to authenticated
using (user_id = auth.uid() or public.is_event_host(event_id));

create policy "owners add event membership" on public.event_members
for insert to authenticated
with check (user_id = auth.uid() and role = 'owner');

create policy "guests read own membership" on public.guests
for select to authenticated
using (user_id = auth.uid() or public.is_event_host(event_id));

create policy "hosts update guests" on public.guests
for update to authenticated
using (public.is_event_host(event_id))
with check (public.is_event_host(event_id));

create policy "members read allowed moments" on public.moments
for select to authenticated
using (
  public.is_event_host(event_id)
  or owner_user_id = auth.uid()
  or (
    public.is_approved_guest(event_id)
    and exists (select 1 from public.events e where e.id = event_id and e.status = 'revealed')
    and removed = false
  )
);

create policy "members add own moments" on public.moments
for insert to authenticated
with check (
  owner_user_id = auth.uid()
  and public.can_capture(event_id, auth.uid())
  and (
    (public.is_event_host(event_id) and guest_id is null)
    or (
      public.is_approved_guest(event_id)
      and exists (
        select 1 from public.guests g
        where g.id = guest_id and g.event_id = moments.event_id and g.user_id = auth.uid()
      )
    )
  )
);

create policy "hosts moderate moments" on public.moments
for update to authenticated
using (public.is_event_host(event_id))
with check (public.is_event_host(event_id));

create policy "members read revealed album" on public.albums
for select to authenticated
using (public.is_event_host(event_id) or public.is_approved_guest(event_id));

create policy "hosts manage album" on public.albums
for all to authenticated
using (public.is_event_host(event_id))
with check (public.is_event_host(event_id) and approved_by = auth.uid());

create policy "hosts read deliveries" on public.deliveries
for select to authenticated
using (public.is_event_host(event_id));

grant execute on function public.join_event(text, text, text) to authenticated;
grant execute on function public.event_preview(text) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-media',
  'event-media',
  false,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'video/webm', 'video/mp4']
)
on conflict (id) do nothing;

-- Storage paths must be: {event_id}/{auth_user_id}/{file_name}
create policy "users upload own event media" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'event-media'
  and (storage.foldername(name))[2] = auth.uid()::text
  and (
    public.is_event_host(((storage.foldername(name))[1])::uuid)
    or public.is_approved_guest(((storage.foldername(name))[1])::uuid)
  )
  and exists (
    select 1 from public.events e
    where e.id = ((storage.foldername(name))[1])::uuid and e.status = 'live'
  )
);

create policy "members read allowed event media" on storage.objects
for select to authenticated
using (
  bucket_id = 'event-media'
  and (
    public.is_event_host(((storage.foldername(name))[1])::uuid)
    or (storage.foldername(name))[2] = auth.uid()::text
    or (
      public.is_approved_guest(((storage.foldername(name))[1])::uuid)
      and exists (
        select 1
        from public.events e
        join public.moments m on m.event_id = e.id
        where e.id = ((storage.foldername(name))[1])::uuid
          and e.status = 'revealed'
          and m.storage_path = name
          and m.removed = false
      )
    )
  )
);
