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
