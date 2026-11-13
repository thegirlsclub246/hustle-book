-- Hustle Book database. Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once.

create extension if not exists pgcrypto;

-- One row per business. profile is public (name, services, prices, specials, hours).
-- data is private to the owner (bookings, clients, walk-in queue).
create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  profile jsonb not null default '{}'::jsonb,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.businesses enable row level security;

drop policy if exists "owners manage their own business" on public.businesses;
create policy "owners manage their own business" on public.businesses
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Booking requests sent by customers from the public booking page.
create table if not exists public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  phone text check (char_length(phone) <= 30),
  service text not null check (char_length(service) between 1 and 80),
  date date not null,
  time text not null check (time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  price numeric check (price >= 0 and price < 100000),
  special text check (char_length(special) <= 80),
  note text check (char_length(note) <= 500),
  status text not null default 'new' check (status in ('new', 'accepted', 'declined')),
  created_at timestamptz not null default now()
);
create index if not exists booking_requests_business_idx on public.booking_requests (business_id, status, date);
alter table public.booking_requests enable row level security;

drop policy if exists "anyone can send a booking request" on public.booking_requests;
create policy "anyone can send a booking request" on public.booking_requests
  for insert to anon, authenticated
  with check (status = 'new' and date >= current_date - 1 and date <= current_date + 120);

drop policy if exists "owners see their requests" on public.booking_requests;
create policy "owners see their requests" on public.booking_requests
  for select to authenticated
  using (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()));

drop policy if exists "owners update their requests" on public.booking_requests;
create policy "owners update their requests" on public.booking_requests
  for update to authenticated
  using (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()));

drop policy if exists "owners delete their requests" on public.booking_requests;
create policy "owners delete their requests" on public.booking_requests
  for delete to authenticated
  using (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()));

-- Public: a business's profile by its booking link name. Never returns private data.
create or replace function public.public_business(p_slug text)
returns table (id uuid, slug text, profile jsonb)
language sql stable security definer set search_path = public as $$
  select b.id, b.slug, b.profile from public.businesses b where b.slug = lower(p_slug);
$$;

-- Public: which times are taken on a day (start time and length only, no names).
create or replace function public.busy_slots(p_slug text, p_date date)
returns table (slot_time text, mins int)
language sql stable security definer set search_path = public as $$
  with b as (select * from public.businesses where slug = lower(p_slug)),
  svc as (
    select s->>'name' as name, coalesce((s->>'mins')::int, 30) as mins
    from b, jsonb_array_elements(coalesce(b.profile->'services', '[]'::jsonb)) s
  )
  select i->>'time', coalesce((select mins from svc where svc.name = i->>'service' limit 1), 30)
  from b, jsonb_array_elements(coalesce(b.data->'items', '[]'::jsonb)) i
  where i->>'date' = to_char(p_date, 'YYYY-MM-DD') and i->>'status' = 'booked'
  union all
  select r.time, coalesce((select mins from svc where svc.name = r.service limit 1), 30)
  from b join public.booking_requests r on r.business_id = b.id
  where r.date = p_date and r.status in ('new', 'accepted');
$$;

revoke all on function public.public_business(text) from public;
revoke all on function public.busy_slots(text, date) from public;
grant execute on function public.public_business(text) to anon, authenticated;
grant execute on function public.busy_slots(text, date) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Subscribers only. A new email can only sign up if it's on this list, and a
-- business only works while its owner's subscription is paid up.
-- Rows are added by the hustle-subscribe Edge Function after a PayPal
-- subscription is checked with PayPal. status 'free' never runs out (for your
-- own business, friends and testers).
-- ---------------------------------------------------------------------------
create table if not exists public.subscribers (
  email text primary key check (email = lower(email)),
  status text not null,
  paypal_subscription_id text unique,
  paypal_email text,
  plan_id text,
  paid_until timestamptz,
  checked_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
-- No policies on purpose: nobody can read or change this list from the website.
alter table public.subscribers enable row level security;

-- Everyone who already has a business keeps it, free of charge.
insert into public.subscribers (email, status, note)
select lower(u.email), 'free', 'Had a business before sign-up was limited to subscribers'
from public.businesses b join auth.users u on u.id = b.owner_id
where u.email is not null
on conflict (email) do nothing;

create or replace function public.email_has_access(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.subscribers s
    where s.email = lower(p_email) and (s.status = 'free' or s.paid_until > now())
  );
$$;

create or replace function public.owner_has_access(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.email_has_access((select u.email from auth.users u where u.id = p_owner));
$$;

-- For the signed-in owner's app: is my subscription paid up?
create or replace function public.my_access()
returns table (has_access boolean, status text, paid_until timestamptz, checked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select public.owner_has_access(auth.uid()), s.status, s.paid_until, s.checked_at
  from (select 1) one
  left join public.subscribers s on s.email = lower((select u.email from auth.users u where u.id = auth.uid()));
$$;

-- Used only by the Edge Function: has this email ever signed in?
create or replace function public.email_signed_up(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from auth.users u where lower(u.email) = lower(p_email));
$$;

revoke all on function public.email_has_access(text) from public, anon, authenticated;
revoke all on function public.owner_has_access(uuid) from public, anon;
revoke all on function public.my_access() from public, anon;
revoke all on function public.email_signed_up(text) from public, anon, authenticated;
grant execute on function public.owner_has_access(uuid) to authenticated;
grant execute on function public.my_access() to authenticated;
grant execute on function public.email_signed_up(text) to service_role;
grant execute on function public.email_has_access(text) to service_role;

-- Block new accounts for emails that haven't subscribed.
-- The sign-in page shows "Database error saving new user" from Supabase as a friendly message.
create or replace function public.only_subscribers_sign_up()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.email_has_access(new.email) then
    raise exception 'Hustle Book is for Hustle Kit subscribers only';
  end if;
  return new;
end;
$$;
drop trigger if exists only_subscribers_sign_up on auth.users;
create trigger only_subscribers_sign_up before insert on auth.users
  for each row execute function public.only_subscribers_sign_up();

-- Owners can only use their book while subscribed.
drop policy if exists "owners manage their own business" on public.businesses;
create policy "owners manage their own business" on public.businesses
  for all to authenticated
  using (auth.uid() = owner_id and public.owner_has_access(owner_id))
  with check (auth.uid() = owner_id and public.owner_has_access(owner_id));

-- Booking links only take requests while the owner is subscribed.
create or replace function public.business_taking_bookings(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.businesses b where b.id = p_business and public.owner_has_access(b.owner_id));
$$;
revoke all on function public.business_taking_bookings(uuid) from public;
grant execute on function public.business_taking_bookings(uuid) to anon, authenticated;

drop policy if exists "anyone can send a booking request" on public.booking_requests;
create policy "anyone can send a booking request" on public.booking_requests
  for insert to anon, authenticated
  with check (
    status = 'new' and date >= current_date - 1 and date <= current_date + 120
    and public.business_taking_bookings(business_id)
  );

create or replace function public.public_business(p_slug text)
returns table (id uuid, slug text, profile jsonb)
language sql stable security definer set search_path = public as $$
  select b.id, b.slug, b.profile from public.businesses b
  where b.slug = lower(p_slug) and public.owner_has_access(b.owner_id);
$$;

-- ---------------------------------------------------------------------------
-- Clients can change or cancel their own booking, and leave reviews.
-- ---------------------------------------------------------------------------

-- A request can now be cancelled by the client. 'cancel_seen' means the owner's app has dealt with it.
alter table public.booking_requests drop constraint if exists booking_requests_status_check;
alter table public.booking_requests add constraint booking_requests_status_check
  check (status in ('new', 'accepted', 'declined', 'cancelled', 'cancel_seen'));
-- When a client moves their booking, the new request points at the old one.
alter table public.booking_requests add column if not exists moved_from uuid;

-- Bookings the client cancelled no longer block the time on the booking page.
create or replace function public.busy_slots(p_slug text, p_date date)
returns table (slot_time text, mins int)
language sql stable security definer set search_path = public as $$
  with b as (select * from public.businesses where slug = lower(p_slug)),
  svc as (
    select s->>'name' as name, coalesce((s->>'mins')::int, 30) as mins
    from b, jsonb_array_elements(coalesce(b.profile->'services', '[]'::jsonb)) s
  )
  select i->>'time', coalesce((select mins from svc where svc.name = i->>'service' limit 1), 30)
  from b, jsonb_array_elements(coalesce(b.data->'items', '[]'::jsonb)) i
  where i->>'date' = to_char(p_date, 'YYYY-MM-DD') and i->>'status' = 'booked'
    and not exists (
      select 1 from public.booking_requests c
      where c.id::text = i->>'req' and c.status in ('cancelled', 'cancel_seen'))
  union all
  select r.time, coalesce((select mins from svc where svc.name = r.service limit 1), 30)
  from b join public.booking_requests r on r.business_id = b.id
  where r.date = p_date and r.status in ('new', 'accepted');
$$;

-- Can this booking still be changed? Not once it's within the owner's notice period
-- (Setup → "Clients can change or cancel up to … hours before", 24 by default). Times are Barbados time.
create or replace function public.booking_changeable(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.booking_requests r join public.businesses b on b.id = r.business_id
    where r.id = p_id and r.status in ('new', 'accepted') and public.owner_has_access(b.owner_id)
      and ((r.date + r.time::time) at time zone 'America/Barbados')
          - coalesce(nullif(b.profile->'settings'->>'changeHours', '')::numeric, 24) * interval '1 hour' > now()
  );
$$;

-- Public, but only for someone who has the booking's private link (its id is unguessable).
create or replace function public.my_booking(p_id uuid)
returns table (service text, "date" date, "time" text, price numeric, status text, can_change boolean, moved_to uuid)
language sql stable security definer set search_path = public as $$
  select r.service, r.date, r.time, r.price, r.status, public.booking_changeable(r.id),
    (select n.id from public.booking_requests n where n.moved_from = r.id order by n.created_at desc limit 1)
  from public.booking_requests r join public.businesses b on b.id = r.business_id
  where r.id = p_id and public.owner_has_access(b.owner_id);
$$;

create or replace function public.cancel_my_booking(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.booking_changeable(p_id) then return false; end if;
  update public.booking_requests set status = 'cancelled' where id = p_id;
  return true;
end;
$$;

-- Moves a booking: the old one is cancelled and a new request is made for the new day and time.
create or replace function public.move_my_booking(p_id uuid, p_date date, p_time text)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.booking_requests; new_id uuid;
begin
  if not public.booking_changeable(p_id) then return null; end if;
  if p_date < current_date or p_date > current_date + 120 or p_time !~ '^[0-2][0-9]:[0-5][0-9]$' then return null; end if;
  select * into r from public.booking_requests where id = p_id;
  insert into public.booking_requests (business_id, name, phone, service, date, time, price, special, note, moved_from)
  values (r.business_id, r.name, r.phone, r.service, p_date, p_time, r.price, r.special,
          left('Moved from ' || to_char(r.date, 'Dy DD Mon') || ' at ' || r.time || coalesce('. ' || r.note, ''), 500), r.id)
  returning id into new_id;
  update public.booking_requests set status = 'cancelled' where id = p_id;
  return new_id;
end;
$$;

revoke all on function public.booking_changeable(uuid) from public;
revoke all on function public.my_booking(uuid) from public;
revoke all on function public.cancel_my_booking(uuid) from public;
revoke all on function public.move_my_booking(uuid, date, text) from public;
grant execute on function public.my_booking(uuid) to anon, authenticated;
grant execute on function public.cancel_my_booking(uuid) to anon, authenticated;
grant execute on function public.move_my_booking(uuid, date, text) to anon, authenticated;

-- Reviews. Clients leave them from the review link; the owner picks which ones show on the booking page.
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  stars int not null check (stars between 1 and 5),
  body text check (char_length(body) <= 600),
  status text not null default 'new' check (status in ('new', 'shown', 'hidden')),
  created_at timestamptz not null default now()
);
create index if not exists reviews_business_idx on public.reviews (business_id, status, created_at desc);
alter table public.reviews enable row level security;

drop policy if exists "anyone can leave a review" on public.reviews;
create policy "anyone can leave a review" on public.reviews
  for insert to anon, authenticated
  with check (status = 'new' and public.business_taking_bookings(business_id));

drop policy if exists "owners manage their reviews" on public.reviews;
create policy "owners manage their reviews" on public.reviews
  for all to authenticated
  using (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid()));

create or replace function public.public_reviews(p_slug text)
returns table (name text, stars int, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.name, r.stars, r.body, r.created_at
  from public.reviews r join public.businesses b on b.id = r.business_id
  where b.slug = lower(p_slug) and r.status = 'shown' and public.owner_has_access(b.owner_id)
  order by r.created_at desc limit 30;
$$;
revoke all on function public.public_reviews(text) from public;
grant execute on function public.public_reviews(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- No double bookings. The database refuses a booking for a time that's already
-- taken (including the length of each service), a time that's already gone, or a
-- day the business is closed or the owner has marked as a day off. Bookings for
-- the same business are checked one at a time, so two clients tapping the same
-- time at the same moment can't both get it.
-- ---------------------------------------------------------------------------

-- A JSON list, or an empty list if it's missing or not a list.
create or replace function public.hb_arr(j jsonb) returns jsonb
language sql immutable as $$
  select case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end;
$$;

-- "14:30" -> 870 (minutes from midnight). Null if it isn't a time.
create or replace function public.hb_minutes(t text) returns int
language sql immutable as $$
  select case when t ~ '^[0-9]{1,2}:[0-5][0-9]$' then split_part(t, ':', 1)::int * 60 + split_part(t, ':', 2)::int end;
$$;

-- How long a service or bundle takes, in minutes. 30 if it can't be found (same as the app).
create or replace function public.hb_service_mins(p_profile jsonb, p_name text) returns int
language sql immutable as $$
  with svc as (
    select s->>'name' as name,
      nullif(case when s->>'mins' ~ '^[0-9]+(\.[0-9]+)?$' then round((s->>'mins')::numeric)::int end, 0) as mins
    from jsonb_array_elements(public.hb_arr(p_profile->'services')) s
  )
  select coalesce(
    (select mins from svc where name = p_name and mins is not null limit 1),
    (select sum(coalesce((select mins from svc where name = inc and mins is not null limit 1), 30))::int
       from (select x->'includes' as incs from jsonb_array_elements(public.hb_arr(p_profile->'specials')) x
             where x->>'kind' = 'bundle' and x->>'name' = p_name limit 1) bdl,
            jsonb_array_elements_text(public.hb_arr(bdl.incs)) inc),
    30);
$$;

-- Every taken time on a day: the owner's own bookings plus clients' requests that are waiting or accepted.
-- p_skip leaves out one booking (the one a client is moving, so it doesn't clash with itself).
create or replace function public.hb_taken(p_business uuid, p_date date, p_skip uuid)
returns table (start_min int, mins int)
language sql stable security definer set search_path = public as $$
  with b as (select * from public.businesses where id = p_business)
  select public.hb_minutes(i->>'time'), public.hb_service_mins(b.profile, i->>'service')
  from b, jsonb_array_elements(public.hb_arr(b.data->'items')) i
  where i->>'date' = to_char(p_date, 'YYYY-MM-DD')
    and i->>'status' in ('booked', 'paid', 'owed')
    and public.hb_minutes(i->>'time') is not null
    and (p_skip is null or coalesce(i->>'req', '') <> p_skip::text)
    and not exists (
      select 1 from public.booking_requests c
      where c.id::text = i->>'req' and c.status in ('cancelled', 'cancel_seen', 'declined'))
  union all
  select public.hb_minutes(r.time), public.hb_service_mins(b.profile, r.service)
  from b join public.booking_requests r on r.business_id = b.id
  where r.date = p_date and r.status in ('new', 'accepted')
    and (p_skip is null or r.id <> p_skip)
    and public.hb_minutes(r.time) is not null;
$$;
revoke all on function public.hb_taken(uuid, date, uuid) from public, anon, authenticated;

-- Public: which times are taken on a day (start time and length only, no names).
-- Bundles now block their full length, and bookings already marked paid still hold their time.
create or replace function public.busy_slots(p_slug text, p_date date)
returns table (slot_time text, mins int)
language sql stable security definer set search_path = public as $$
  select lpad((t.start_min / 60)::text, 2, '0') || ':' || lpad((t.start_min % 60)::text, 2, '0'), t.mins
  from public.businesses b, public.hb_taken(b.id, p_date, null) t
  where b.slug = lower(p_slug) and public.owner_has_access(b.owner_id);
$$;

-- The same, but leaving out the client's own booking while they move it (needs its private id).
create or replace function public.busy_slots(p_slug text, p_date date, p_skip uuid)
returns table (slot_time text, mins int)
language sql stable security definer set search_path = public as $$
  select lpad((t.start_min / 60)::text, 2, '0') || ':' || lpad((t.start_min % 60)::text, 2, '0'), t.mins
  from public.businesses b, public.hb_taken(b.id, p_date, p_skip) t
  where b.slug = lower(p_slug) and public.owner_has_access(b.owner_id);
$$;
revoke all on function public.busy_slots(text, date) from public;
revoke all on function public.busy_slots(text, date, uuid) from public;
grant execute on function public.busy_slots(text, date) to anon, authenticated;
grant execute on function public.busy_slots(text, date, uuid) to anon, authenticated;

-- Checks every new booking (from the booking page, or a client moving theirs) before it's saved.
-- The booking page reads the code at the start of the message (HB_TAKEN, HB_PAST, HB_CLOSED).
create or replace function public.hb_check_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  b public.businesses;
  s jsonb;
  days jsonb;
  dow int;
  ds text;
  st int;
  len int;
begin
  if new.status <> 'new' then return new; end if;
  -- One booking at a time per business, so two people can't grab the same time together.
  perform pg_advisory_xact_lock(hashtext('hustle-book:' || new.business_id::text));
  select * into b from public.businesses where id = new.business_id;
  if not found then return new; end if;
  s := coalesce(b.profile->'settings', '{}'::jsonb);
  st := public.hb_minutes(new.time);
  if st is null then raise exception 'HB_TAKEN: That time isn''t available.'; end if;

  if (new.date + new.time::time) at time zone 'America/Barbados' <= now() then
    raise exception 'HB_PAST: That time has already gone. Pick a later time.';
  end if;

  dow := extract(dow from new.date)::int;
  days := case when jsonb_typeof(s->'openDays') = 'array' then s->'openDays' else '[1,2,3,4,5,6]'::jsonb end;
  if not (days @> to_jsonb(dow) or days @> to_jsonb(dow::text)) then
    raise exception 'HB_CLOSED: They''re closed that day. Pick another day.';
  end if;

  ds := to_char(new.date, 'YYYY-MM-DD');
  if exists (
    select 1 from jsonb_array_elements(public.hb_arr(s->'daysOff')) o
    where o->>'from' <= ds and ds <= coalesce(nullif(o->>'to', ''), o->>'from')
  ) then
    raise exception 'HB_CLOSED: They''re off that day. Pick another day.';
  end if;

  len := public.hb_service_mins(b.profile, new.service);
  if exists (
    select 1 from public.hb_taken(new.business_id, new.date, new.moved_from) t
    where t.start_min < st + len and st < t.start_min + t.mins
  ) then
    raise exception 'HB_TAKEN: Sorry, that time was just booked. Pick another time.';
  end if;
  return new;
end;
$$;
revoke all on function public.hb_check_booking() from public, anon, authenticated;

drop trigger if exists hb_check_booking on public.booking_requests;
create trigger hb_check_booking before insert on public.booking_requests
  for each row execute function public.hb_check_booking();
