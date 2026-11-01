-- =====================================================================
-- AWESOME AUTO DETAILING — booking system database
-- NEW Supabase project only. Run ONCE in Supabase > SQL Editor.
-- Then create your admin login and run 02-grant-admin.sql.
-- =====================================================================
begin;

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------
-- Admins
-- ---------------------------------------------------------------------
create table public.shop_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.shop_admins enable row level security;
revoke all on public.shop_admins from anon, authenticated;

create function public.is_shop_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.shop_admins where user_id = auth.uid());
$$;
revoke all on function public.is_shop_admin() from public;
grant execute on function public.is_shop_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Customer profiles (created automatically when an account registers)
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  full_name text check (full_name is null or length(trim(full_name)) between 1 and 80),
  phone text check (phone is null or phone ~ '^\+?[0-9][0-9 ()-]{6,23}$'),
  booking_enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update(full_name, phone) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_shop_admin()));
create policy profiles_edit on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select public.is_shop_admin()))
  with check (id = (select auth.uid()) or (select public.is_shop_admin()));

-- Username accounts sign up as <username>@accounts.awesomeauto.invalid
-- (an internal identifier, never a real mailbox). Accounts you create
-- yourself in the Supabase dashboard with a real email also work.
create function public.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_username text := lower(trim(new.raw_user_meta_data->>'username'));
begin
  if v_username is not null and v_username <> '' then
    if v_username !~ '^[a-z0-9]{3,12}$' or v_username !~ '[a-z]' then
      raise exception 'Username: 3-12 letters/numbers, at least one letter.';
    end if;
    if lower(coalesce(new.email,'')) <> v_username || '@accounts.awesomeauto.invalid' then
      raise exception 'Register through the website.';
    end if;
  else
    v_username := null;
  end if;
  insert into public.profiles(id, username, full_name, phone)
  values (new.id, v_username,
    nullif(left(trim(coalesce(new.raw_user_meta_data->>'full_name','')),80),''),
    case when trim(coalesce(new.raw_user_meta_data->>'phone','')) ~ '^\+?[0-9][0-9 ()-]{6,23}$'
         then trim(new.raw_user_meta_data->>'phone') end);
  return new;
end;
$$;
revoke all on function public.create_profile() from public, anon, authenticated;
create trigger create_profile after insert on auth.users
  for each row execute function public.create_profile();

-- ---------------------------------------------------------------------
-- Business settings (one row)
-- ---------------------------------------------------------------------
create table public.business_settings (
  id integer primary key default 1 check (id = 1),
  bays integer not null default 2 check (bays between 1 and 20),
  slot_step_minutes integer not null default 30 check (slot_step_minutes in (15, 30, 60)),
  lead_minutes integer not null default 60 check (lead_minutes between 0 and 10080),
  max_days_ahead integer not null default 30 check (max_days_ahead between 1 and 180),
  cancel_cutoff_hours integer not null default 12 check (cancel_cutoff_hours between 0 and 168),
  address text not null default '' check (length(address) <= 300),
  maps_url text not null default '' check (maps_url = '' or maps_url ~ '^https://'),
  about text not null default '' check (length(about) <= 1000),
  allow_pay_at_shop boolean not null default true,
  allow_qr boolean not null default true,
  qr_path text,
  payee_name text not null default '' check (length(payee_name) <= 120),
  payment_instructions text not null default '' check (length(payment_instructions) <= 500),
  updated_at timestamptz not null default now()
);
insert into public.business_settings(id) values (1);
alter table public.business_settings enable row level security;
revoke all on public.business_settings from anon, authenticated;
grant select on public.business_settings to anon, authenticated;
grant update(bays, slot_step_minutes, lead_minutes, max_days_ahead, cancel_cutoff_hours, address,
  maps_url, about, allow_pay_at_shop, allow_qr, qr_path, payee_name, payment_instructions, updated_at)
  on public.business_settings to authenticated;
create policy settings_read on public.business_settings for select to anon, authenticated using (true);
create policy settings_edit on public.business_settings for update to authenticated
  using ((select public.is_shop_admin())) with check ((select public.is_shop_admin()));

-- weekday: 0 = Sunday ... 6 = Saturday
create table public.opening_hours (
  weekday smallint primary key check (weekday between 0 and 6),
  is_open boolean not null default true,
  open_time time not null default '09:00',
  close_time time not null default '18:00',
  check (close_time > open_time)
);
insert into public.opening_hours(weekday, is_open)
  select d, true from generate_series(0, 6) d;
alter table public.opening_hours enable row level security;
revoke all on public.opening_hours from anon, authenticated;
grant select on public.opening_hours to anon, authenticated;
grant update(is_open, open_time, close_time) on public.opening_hours to authenticated;
create policy hours_read on public.opening_hours for select to anon, authenticated using (true);
create policy hours_edit on public.opening_hours for update to authenticated
  using ((select public.is_shop_admin())) with check ((select public.is_shop_admin()));

create table public.closed_dates (
  day date primary key,
  reason text not null default '' check (length(reason) <= 120)
);
alter table public.closed_dates enable row level security;
revoke all on public.closed_dates from anon, authenticated;
grant select on public.closed_dates to anon, authenticated;
grant insert, update, delete on public.closed_dates to authenticated;
create policy closed_read on public.closed_dates for select to anon, authenticated using (true);
create policy closed_manage on public.closed_dates for all to authenticated
  using ((select public.is_shop_admin())) with check ((select public.is_shop_admin()));

-- ---------------------------------------------------------------------
-- Catalogue: vehicle sizes, services (packages + add-ons), prices
-- ---------------------------------------------------------------------
create table public.vehicle_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 40),
  description text not null default '' check (length(description) <= 120),
  sort_order integer not null default 0,
  active boolean not null default true
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 600),
  kind text not null check (kind in ('package', 'addon')),
  duration_minutes integer not null check (duration_minutes between 15 and 720 and duration_minutes % 15 = 0),
  image_path text,
  active boolean not null default true,
  popular boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- No price row = service not offered for that vehicle size.
create table public.service_prices (
  service_id uuid not null references public.services(id) on delete cascade,
  vehicle_type_id uuid not null references public.vehicle_types(id) on delete cascade,
  price_cents integer not null check (price_cents between 0 and 10000000),
  primary key (service_id, vehicle_type_id)
);

alter table public.vehicle_types enable row level security;
alter table public.services enable row level security;
alter table public.service_prices enable row level security;
revoke all on public.vehicle_types, public.services, public.service_prices from anon, authenticated;
grant select on public.vehicle_types, public.services, public.service_prices to anon, authenticated;
grant insert, update, delete on public.vehicle_types, public.services to authenticated;
create policy types_read on public.vehicle_types for select to anon, authenticated
  using (active or (select public.is_shop_admin()));
create policy types_manage on public.vehicle_types for all to authenticated
  using ((select public.is_shop_admin())) with check ((select public.is_shop_admin()));
create policy services_read on public.services for select to anon, authenticated
  using (active or (select public.is_shop_admin()));
create policy services_manage on public.services for all to authenticated
  using ((select public.is_shop_admin())) with check ((select public.is_shop_admin()));
create policy prices_read on public.service_prices for select to anon, authenticated using (true);

-- Admin saves a service and its whole price list in one step.
create function public.admin_save_service(
  p_id uuid, p_name text, p_description text, p_kind text, p_duration integer,
  p_image text, p_active boolean, p_popular boolean, p_sort integer, p_prices jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_row jsonb;
begin
  if not public.is_shop_admin() then raise exception 'Admin access required.'; end if;
  if p_prices is null or jsonb_typeof(p_prices) <> 'array' then raise exception 'Invalid price list.'; end if;
  if p_id is null then
    insert into public.services(name, description, kind, duration_minutes, image_path, active, popular, sort_order)
    values (trim(p_name), coalesce(p_description,''), p_kind, p_duration, p_image,
      coalesce(p_active,true), coalesce(p_popular,false), coalesce(p_sort,0))
    returning id into v_id;
  else
    update public.services set name = trim(p_name), description = coalesce(p_description,''), kind = p_kind,
      duration_minutes = p_duration, image_path = p_image, active = coalesce(p_active,true),
      popular = coalesce(p_popular,false), sort_order = coalesce(p_sort,0)
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Service not found.'; end if;
    delete from public.service_prices where service_id = v_id;
  end if;
  for v_row in select value from jsonb_array_elements(p_prices) loop
    if v_row->>'price_cents' is not null and v_row->>'price_cents' <> '' then
      insert into public.service_prices(service_id, vehicle_type_id, price_cents)
      values (v_id, (v_row->>'vehicle_type_id')::uuid, (v_row->>'price_cents')::integer);
    end if;
  end loop;
  return v_id;
end;
$$;
revoke all on function public.admin_save_service(uuid,text,text,text,integer,text,boolean,boolean,integer,jsonb) from public, anon;
grant execute on function public.admin_save_service(uuid,text,text,text,integer,text,boolean,boolean,integer,jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Customer garage (saved cars)
-- ---------------------------------------------------------------------
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plate text not null check (plate ~ '^[A-Z0-9 ]{2,12}$'),
  make_model text not null check (length(trim(make_model)) between 1 and 60),
  color text not null default '' check (length(color) <= 30),
  vehicle_type_id uuid references public.vehicle_types(id) on delete set null,
  created_at timestamptz not null default now()
);
create index vehicles_owner on public.vehicles(owner_id);
alter table public.vehicles enable row level security;
revoke all on public.vehicles from anon, authenticated;
grant select, delete on public.vehicles to authenticated;
grant insert(plate, make_model, color, vehicle_type_id) on public.vehicles to authenticated;
grant update(plate, make_model, color, vehicle_type_id) on public.vehicles to authenticated;
create policy vehicles_read on public.vehicles for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_shop_admin()));
create policy vehicles_add on public.vehicles for insert to authenticated
  with check (owner_id = (select auth.uid()));
create function public.limit_vehicles() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.vehicles where owner_id = new.owner_id) >= 10 then
    raise exception 'You can save up to 10 cars.';
  end if;
  new.plate := upper(regexp_replace(trim(new.plate), '\s+', ' ', 'g'));
  return new;
end;
$$;
revoke all on function public.limit_vehicles() from public, anon, authenticated;
create trigger limit_vehicles before insert on public.vehicles
  for each row execute function public.limit_vehicles();
create policy vehicles_edit on public.vehicles for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy vehicles_remove on public.vehicles for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  customer_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  request_key uuid not null,
  source text not null check (source in ('customer', 'admin')),
  customer_name text not null check (length(trim(customer_name)) between 1 and 80),
  customer_phone text not null check (customer_phone ~ '^\+?[0-9][0-9 ()-]{6,23}$'),
  vehicle_type_id uuid references public.vehicle_types(id) on delete set null,
  vehicle_type_name text not null,
  plate text not null,
  make_model text not null,
  color text not null default '',
  start_at timestamptz not null,
  end_at timestamptz not null,
  bay integer not null check (bay >= 1),
  duration_minutes integer not null,
  total_cents integer not null check (total_cents >= 0),
  payment_method text not null check (payment_method in ('shop', 'qr')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'submitted', 'paid', 'refunded')),
  payment_reference text check (length(payment_reference) <= 120),
  receipt_path text,
  paid_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),
  customer_notes text not null default '' check (length(customer_notes) <= 500),
  admin_notes text not null default '' check (length(admin_notes) <= 1000),
  cancel_reason text check (length(cancel_reason) <= 300),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at),
  unique (created_by, request_key),
  -- A bay can never hold two active bookings at the same time.
  constraint bookings_no_overlap exclude using gist (
    bay with =, (tstzrange(start_at, end_at, '[)')) with &&
  ) where (status in ('pending', 'confirmed', 'in_progress'))
);
create index bookings_start on public.bookings(start_at);
create index bookings_customer on public.bookings(customer_id, start_at desc);

create table public.booking_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  service_name text not null,
  kind text not null,
  duration_minutes integer not null,
  price_cents integer not null
);
create index booking_items_booking on public.booking_items(booking_id);

alter table public.bookings enable row level security;
alter table public.booking_items enable row level security;
revoke all on public.bookings, public.booking_items from anon, authenticated;
grant select on public.bookings, public.booking_items to authenticated;
create policy bookings_read on public.bookings for select to authenticated
  using (customer_id = (select auth.uid()) or (select public.is_shop_admin()));
create policy booking_items_read on public.booking_items for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id
    and (b.customer_id = (select auth.uid()) or (select public.is_shop_admin()))));

-- ---------------------------------------------------------------------
-- Availability engine
-- ---------------------------------------------------------------------
create function public.minute_of_day(p time) returns integer
language sql immutable set search_path = '' as $$
  select (extract(hour from p) * 60 + extract(minute from p))::integer;
$$;

-- Returns an error message, or null when the start time is bookable.
create function public.slot_check(p_date date, p_time time, p_duration integer, p_is_admin boolean)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  s public.business_settings%rowtype;
  h public.opening_hours%rowtype;
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_start_min integer; v_open integer; v_close integer; v_start timestamptz;
begin
  select * into s from public.business_settings where id = 1;
  if p_date is null or p_time is null then return 'Choose a date and time.'; end if;
  if p_duration is null or p_duration < 15 then return 'Choose at least one service.'; end if;
  if p_date < v_today then return 'That date has already passed.'; end if;
  if not p_is_admin and p_date > v_today + s.max_days_ahead then
    return format('Bookings open up to %s days ahead.', s.max_days_ahead);
  end if;
  if exists (select 1 from public.closed_dates c where c.day = p_date) then return 'We are closed on that date.'; end if;
  select * into h from public.opening_hours where weekday = extract(dow from p_date)::integer;
  if not found or not h.is_open then return 'We are closed on that day.'; end if;
  v_start_min := public.minute_of_day(p_time);
  v_open := public.minute_of_day(h.open_time);
  v_close := public.minute_of_day(h.close_time);
  if v_start_min < v_open or v_start_min + p_duration > v_close then
    return 'Your selected services do not fit in our opening hours at that time.';
  end if;
  if (v_start_min - v_open) % s.slot_step_minutes <> 0 then return 'Choose one of the listed start times.'; end if;
  v_start := (p_date + p_time) at time zone 'Asia/Kuala_Lumpur';
  if not p_is_admin and v_start < now() + make_interval(mins => s.lead_minutes) then
    return 'That time is too soon. Please choose a later slot.';
  end if;
  return null;
end;
$$;
revoke all on function public.slot_check(date,time,integer,boolean) from public, anon, authenticated;

create function public.find_free_bay(p_start timestamptz, p_end timestamptz, p_ignore uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select b from generate_series(1, (select bays from public.business_settings where id = 1)) b
  where not exists (
    select 1 from public.bookings k
    where k.bay = b and k.status in ('pending', 'confirmed', 'in_progress')
      and k.id is distinct from p_ignore and k.start_at < p_end and k.end_at > p_start)
  order by b limit 1;
$$;
revoke all on function public.find_free_bay(timestamptz,timestamptz,uuid) from public, anon, authenticated;

-- Public: start times for one day, with how many bays are still free.
create function public.get_day_availability(p_date date, p_duration integer, p_ignore uuid default null)
returns table (slot_time time, free_bays integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.business_settings%rowtype;
  h public.opening_hours%rowtype;
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_min integer; v_close integer; v_start timestamptz; v_end timestamptz; v_busy integer;
begin
  if p_duration is null or p_duration not between 15 and 720 then
    raise exception 'Choose a package or add-on first.';
  end if;
  select * into s from public.business_settings where id = 1;
  if p_date is null or p_date < v_today or p_date > v_today + s.max_days_ahead then return; end if;
  if exists (select 1 from public.closed_dates c where c.day = p_date) then return; end if;
  select * into h from public.opening_hours o where o.weekday = extract(dow from p_date)::integer;
  if not found or not h.is_open then return; end if;
  v_min := public.minute_of_day(h.open_time);
  v_close := public.minute_of_day(h.close_time);
  while v_min + p_duration <= v_close loop
    v_start := (p_date + make_interval(mins => v_min)) at time zone 'Asia/Kuala_Lumpur';
    if v_start >= now() + make_interval(mins => s.lead_minutes) then
      v_end := v_start + make_interval(mins => p_duration);
      select count(distinct k.bay) into v_busy from public.bookings k
      where k.bay <= s.bays and k.status in ('pending', 'confirmed', 'in_progress')
        and k.id is distinct from p_ignore and k.start_at < v_end and k.end_at > v_start;
      slot_time := make_time(v_min / 60, v_min % 60, 0);
      free_bays := greatest(s.bays - v_busy, 0);
      return next;
    end if;
    v_min := v_min + s.slot_step_minutes;
  end loop;
end;
$$;
revoke all on function public.get_day_availability(date,integer,uuid) from public;
grant execute on function public.get_day_availability(date,integer,uuid) to anon, authenticated;

-- Public: a calendar overview (how many start times are open each day).
create function public.get_availability_calendar(p_from date, p_days integer, p_duration integer, p_ignore uuid default null)
returns table (cal_date date, open_slots integer, is_closed boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  d date; s public.business_settings%rowtype;
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  select * into s from public.business_settings where id = 1;
  for d in select g::date from generate_series(p_from, p_from + least(greatest(coalesce(p_days,14),1),62) - 1, interval '1 day') g loop
    cal_date := d;
    is_closed := d < v_today or d > v_today + s.max_days_ahead
      or exists (select 1 from public.closed_dates c where c.day = d)
      or not exists (select 1 from public.opening_hours o where o.weekday = extract(dow from d)::integer and o.is_open);
    if is_closed then open_slots := 0;
    else select count(*) into open_slots from public.get_day_availability(d, p_duration, p_ignore) a where a.free_bays > 0;
    end if;
    return next;
  end loop;
end;
$$;
revoke all on function public.get_availability_calendar(date,integer,integer,uuid) from public;
grant execute on function public.get_availability_calendar(date,integer,integer,uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Place a booking. Prices, duration, bay and code are decided here,
-- never trusted from the browser.
-- ---------------------------------------------------------------------
create function public.place_booking(
  p_request_key uuid, p_vehicle_type uuid, p_services uuid[], p_date date, p_time time,
  p_plate text, p_make_model text, p_color text, p_name text, p_phone text, p_notes text,
  p_payment text, p_receipt text, p_reference text, p_expected_total integer,
  p_customer_id uuid default null, p_walk_in boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_admin boolean := public.is_shop_admin();
  v_customer uuid; v_id uuid; v_enabled boolean;
  s public.business_settings%rowtype;
  v_type public.vehicle_types%rowtype;
  r record;
  v_total integer := 0; v_duration integer := 0; v_packages integer := 0;
  v_err text; v_start timestamptz; v_end timestamptz; v_bay integer; v_code text;
  v_plate text := upper(regexp_replace(trim(coalesce(p_plate, '')), '\s+', ' ', 'g'));
begin
  if v_actor is null then raise exception 'Please log in to confirm your booking.'; end if;
  if p_request_key is null then raise exception 'Missing booking request key.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || p_request_key::text, 0));
  select id into v_id from public.bookings where created_by = v_actor and request_key = p_request_key;
  if found then return v_id; end if;

  if coalesce(p_walk_in, false) then
    if not v_admin then raise exception 'Admin access required.'; end if;
    v_customer := null;
  elsif p_customer_id is not null and p_customer_id <> v_actor then
    if not v_admin then raise exception 'Admin access required.'; end if;
    v_customer := p_customer_id;
  else
    v_customer := v_actor;
  end if;
  if v_customer is not null then
    select booking_enabled into v_enabled from public.profiles where id = v_customer;
    if not found then raise exception 'Customer account not found.'; end if;
    if not v_enabled then raise exception 'Online booking is paused for this account. Please WhatsApp us.'; end if;
  end if;
  if not v_admin and (select count(*) from public.bookings
      where customer_id = v_actor and status in ('pending', 'confirmed') and start_at > now()) >= 3 then
    raise exception 'You already have 3 upcoming bookings. Please complete or cancel one first.';
  end if;

  if p_name is null or length(trim(p_name)) not between 1 and 80
     or p_phone is null or trim(p_phone) !~ '^\+?[0-9][0-9 ()-]{6,23}$' then
    raise exception 'Enter your name and a valid WhatsApp number.';
  end if;
  if v_plate !~ '^[A-Z0-9 ]{2,12}$' then raise exception 'Enter a valid plate number (letters and numbers only).'; end if;
  if p_make_model is null or length(trim(p_make_model)) not between 1 and 60 then raise exception 'Enter your car make and model.'; end if;
  if length(coalesce(p_color, '')) > 30 then raise exception 'Colour is too long.'; end if;
  if length(coalesce(p_notes, '')) > 500 then raise exception 'Notes must be 500 characters or fewer.'; end if;

  select * into v_type from public.vehicle_types where id = p_vehicle_type and active;
  if not found then raise exception 'Choose your vehicle size.'; end if;
  if p_services is null or cardinality(p_services) not between 1 and 15 then
    raise exception 'Choose a package or at least one add-on.';
  end if;
  if (select count(distinct x) from unnest(p_services) x) <> cardinality(p_services) then
    raise exception 'A service was selected twice.';
  end if;
  for r in
    select u.sid, sv.name, sv.kind, sv.duration_minutes, sv.active, sp.price_cents
    from unnest(p_services) as u(sid)
    left join public.services sv on sv.id = u.sid
    left join public.service_prices sp on sp.service_id = u.sid and sp.vehicle_type_id = v_type.id
  loop
    if r.name is null or not r.active then raise exception 'A service is no longer available. Please refresh.'; end if;
    if r.price_cents is null then raise exception '% is not offered for %.', r.name, v_type.name; end if;
    if r.kind = 'package' then v_packages := v_packages + 1; end if;
    v_total := v_total + r.price_cents;
    v_duration := v_duration + r.duration_minutes;
  end loop;
  if v_packages > 1 then raise exception 'Choose only one main package.'; end if;
  if v_duration > 720 then raise exception 'That is more than 12 hours of work. Please split it into two bookings.'; end if;
  if p_expected_total is distinct from v_total then
    raise exception 'Prices were just updated. Please review your total and confirm again.';
  end if;

  select * into s from public.business_settings where id = 1;
  if p_payment is null or p_payment not in ('shop', 'qr') then raise exception 'Choose a payment method.'; end if;
  if p_payment = 'shop' and not s.allow_pay_at_shop and not v_admin then
    raise exception 'Pay at shop is not available right now. Please choose QR payment.';
  end if;
  if p_payment = 'qr' then
    if not v_admin and (not s.allow_qr or s.qr_path is null or trim(s.payee_name) = '') then
      raise exception 'QR payment is not available right now.';
    end if;
    if p_receipt is not null then
      if split_part(p_receipt, '/', 1) <> v_actor::text or split_part(p_receipt, '/', 2) <> p_request_key::text
         or not exists (select 1 from storage.objects where bucket_id = 'payment-receipts' and name = p_receipt) then
        raise exception 'Receipt upload not found. Please upload it again.';
      end if;
    elsif not v_admin then
      raise exception 'Upload your payment receipt screenshot to confirm a QR booking.';
    end if;
  end if;
  if length(coalesce(p_reference, '')) > 120 then raise exception 'Reference is too long.'; end if;

  v_err := public.slot_check(p_date, p_time, v_duration, v_admin);
  if v_err is not null then raise exception '%', v_err; end if;

  -- Serialise bookings for the same day so two people cannot take the last bay together.
  perform pg_advisory_xact_lock(hashtextextended('aad-day:' || p_date::text, 0));
  v_start := (p_date + p_time) at time zone 'Asia/Kuala_Lumpur';
  v_end := v_start + make_interval(mins => v_duration);
  v_bay := public.find_free_bay(v_start, v_end, null);
  if v_bay is null then raise exception 'Sorry, that time was just taken. Please pick another slot.'; end if;

  loop
    v_code := 'AAD-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.bookings where code = v_code);
  end loop;

  insert into public.bookings(code, customer_id, created_by, request_key, source, customer_name, customer_phone,
    vehicle_type_id, vehicle_type_name, plate, make_model, color, start_at, end_at, bay, duration_minutes,
    total_cents, payment_method, payment_status, payment_reference, receipt_path, status, customer_notes)
  values (v_code, v_customer, v_actor, p_request_key, case when v_admin then 'admin' else 'customer' end,
    trim(p_name), trim(p_phone), v_type.id, v_type.name, v_plate, trim(p_make_model), trim(coalesce(p_color, '')),
    v_start, v_end, v_bay, v_duration, v_total, p_payment,
    case when p_payment = 'qr' and p_receipt is not null then 'submitted' else 'unpaid' end,
    nullif(trim(coalesce(p_reference, '')), ''), case when p_payment = 'qr' then p_receipt end,
    case when v_admin then 'confirmed' else 'pending' end, trim(coalesce(p_notes, '')))
  returning id into v_id;

  insert into public.booking_items(booking_id, service_id, service_name, kind, duration_minutes, price_cents)
  select v_id, sv.id, sv.name, sv.kind, sv.duration_minutes, sp.price_cents
  from unnest(p_services) as u(sid)
  join public.services sv on sv.id = u.sid
  join public.service_prices sp on sp.service_id = sv.id and sp.vehicle_type_id = v_type.id
  order by case when sv.kind = 'package' then 0 else 1 end, sv.sort_order;

  if v_customer is not null then
    update public.profiles set full_name = trim(p_name), phone = trim(p_phone) where id = v_customer;
  end if;
  return v_id;
end;
$$;
revoke all on function public.place_booking(uuid,uuid,uuid[],date,time,text,text,text,text,text,text,text,text,text,integer,uuid,boolean) from public, anon;
grant execute on function public.place_booking(uuid,uuid,uuid[],date,time,text,text,text,text,text,text,text,text,text,integer,uuid,boolean) to authenticated;

-- Customer (or admin) cancels a booking.
create function public.cancel_booking(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.bookings%rowtype; v_admin boolean := public.is_shop_admin(); v_cutoff integer;
begin
  select * into b from public.bookings where id = p_id for update;
  if not found or (b.customer_id is distinct from auth.uid() and not v_admin) then raise exception 'Booking not found.'; end if;
  if b.status not in ('pending', 'confirmed') then raise exception 'This booking can no longer be cancelled.'; end if;
  select cancel_cutoff_hours into v_cutoff from public.business_settings where id = 1;
  if not v_admin and b.start_at < now() + make_interval(hours => v_cutoff) then
    raise exception 'Online cancellation closes % hours before your slot. Please WhatsApp us.', v_cutoff;
  end if;
  if length(coalesce(p_reason, '')) > 300 then raise exception 'Reason is too long.'; end if;
  update public.bookings set status = 'cancelled', cancelled_at = now(),
    cancel_reason = nullif(trim(coalesce(p_reason, '')), ''), updated_at = now()
  where id = p_id;
end;
$$;
revoke all on function public.cancel_booking(uuid,text) from public, anon;
grant execute on function public.cancel_booking(uuid,text) to authenticated;

-- Customer (or admin) moves a booking to another time.
create function public.reschedule_booking(p_id uuid, p_date date, p_time time) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.bookings%rowtype; v_admin boolean := public.is_shop_admin(); v_cutoff integer;
  v_err text; v_start timestamptz; v_end timestamptz; v_bay integer;
begin
  select * into b from public.bookings where id = p_id for update;
  if not found or (b.customer_id is distinct from auth.uid() and not v_admin) then raise exception 'Booking not found.'; end if;
  if b.status not in ('pending', 'confirmed') then raise exception 'This booking can no longer be changed.'; end if;
  select cancel_cutoff_hours into v_cutoff from public.business_settings where id = 1;
  if not v_admin and b.start_at < now() + make_interval(hours => v_cutoff) then
    raise exception 'Online changes close % hours before your slot. Please WhatsApp us.', v_cutoff;
  end if;
  v_err := public.slot_check(p_date, p_time, b.duration_minutes, v_admin);
  if v_err is not null then raise exception '%', v_err; end if;
  perform pg_advisory_xact_lock(hashtextextended('aad-day:' || p_date::text, 0));
  v_start := (p_date + p_time) at time zone 'Asia/Kuala_Lumpur';
  v_end := v_start + make_interval(mins => b.duration_minutes);
  v_bay := public.find_free_bay(v_start, v_end, p_id);
  if v_bay is null then raise exception 'Sorry, that time is fully booked. Please pick another slot.'; end if;
  update public.bookings set start_at = v_start, end_at = v_end, bay = v_bay,
    status = case when v_admin then status else 'pending' end, updated_at = now()
  where id = p_id;
end;
$$;
revoke all on function public.reschedule_booking(uuid,date,time) from public, anon;
grant execute on function public.reschedule_booking(uuid,date,time) to authenticated;

-- Customer uploads / replaces a QR payment receipt after booking.
create function public.submit_booking_receipt(p_id uuid, p_receipt text, p_reference text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.bookings%rowtype; s public.business_settings%rowtype;
begin
  select * into b from public.bookings where id = p_id for update;
  if not found or b.customer_id is distinct from auth.uid() then raise exception 'Booking not found.'; end if;
  if b.status in ('cancelled', 'no_show') or b.payment_status not in ('unpaid', 'submitted') then
    raise exception 'Payment can no longer be submitted for this booking.';
  end if;
  select * into s from public.business_settings where id = 1;
  if not s.allow_qr or s.qr_path is null then raise exception 'QR payment is not available right now.'; end if;
  if p_receipt is null or split_part(p_receipt, '/', 1) <> auth.uid()::text or split_part(p_receipt, '/', 2) <> p_id::text
     or not exists (select 1 from storage.objects where bucket_id = 'payment-receipts' and name = p_receipt) then
    raise exception 'Upload your receipt screenshot first.';
  end if;
  if length(coalesce(p_reference, '')) > 120 then raise exception 'Reference is too long.'; end if;
  update public.bookings set payment_method = 'qr', receipt_path = p_receipt,
    payment_reference = nullif(trim(coalesce(p_reference, '')), ''), payment_status = 'submitted', updated_at = now()
  where id = p_id;
end;
$$;
revoke all on function public.submit_booking_receipt(uuid,text,text) from public, anon;
grant execute on function public.submit_booking_receipt(uuid,text,text) to authenticated;

-- Admin changes status / payment / notes.
create function public.admin_update_booking(p_id uuid, p_status text, p_payment_status text, p_admin_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings%rowtype;
begin
  if not public.is_shop_admin() then raise exception 'Admin access required.'; end if;
  if p_status is null or p_status not in ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')
     or p_payment_status is null or p_payment_status not in ('unpaid', 'submitted', 'paid', 'refunded') then
    raise exception 'Invalid status.';
  end if;
  if length(coalesce(p_admin_notes, '')) > 1000 then raise exception 'Notes are too long.'; end if;
  select * into b from public.bookings where id = p_id for update;
  if not found then raise exception 'Booking not found.'; end if;
  if b.status in ('cancelled', 'no_show') and p_status in ('pending', 'confirmed', 'in_progress') then
    raise exception 'A cancelled or no-show booking cannot be reopened. Create a new booking instead.';
  end if;
  update public.bookings set status = p_status, payment_status = p_payment_status,
    admin_notes = coalesce(p_admin_notes, ''),
    paid_at = case when p_payment_status = 'paid' then coalesce(paid_at, now()) else null end,
    verified_by = case when p_payment_status = 'paid' then coalesce(verified_by, auth.uid()) else null end,
    cancelled_at = case when p_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end,
    updated_at = now()
  where id = p_id;
end;
$$;
revoke all on function public.admin_update_booking(uuid,text,text,text) from public, anon;
grant execute on function public.admin_update_booking(uuid,text,text,text) to authenticated;

create function public.admin_set_booking_access(p_customer uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_shop_admin() then raise exception 'Admin access required.'; end if;
  if p_enabled is null then raise exception 'Choose a status.'; end if;
  update public.profiles set booking_enabled = p_enabled where id = p_customer;
  if not found then raise exception 'Customer not found.'; end if;
end;
$$;
revoke all on function public.admin_set_booking_access(uuid,boolean) from public, anon;
grant execute on function public.admin_set_booking_access(uuid,boolean) to authenticated;

-- Revenue report (paid bookings, Malaysia time).
create function public.admin_revenue_report(p_period text, p_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_local timestamp; v_start timestamptz; v_end timestamptz; v_summary jsonb; v_buckets jsonb; v_services jsonb; v_status jsonb;
begin
  if not public.is_shop_admin() then raise exception 'Admin access required.'; end if;
  if p_period is null or p_period not in ('day', 'month', 'year') or p_date is null then raise exception 'Choose a report period.'; end if;
  v_local := date_trunc(p_period, p_date::timestamp);
  v_start := v_local at time zone 'Asia/Kuala_Lumpur';
  v_end := (v_local + case p_period when 'day' then interval '1 day' when 'month' then interval '1 month' else interval '1 year' end)
    at time zone 'Asia/Kuala_Lumpur';

  select jsonb_build_object('paid_bookings', count(*), 'revenue_cents', coalesce(sum(total_cents), 0))
  into v_summary from public.bookings
  where payment_status = 'paid' and status not in ('cancelled', 'no_show')
    and coalesce(paid_at, start_at) >= v_start and coalesce(paid_at, start_at) < v_end;

  select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'bookings', n, 'revenue_cents', total) order by bucket), '[]'::jsonb)
  into v_buckets from (
    select to_char(coalesce(paid_at, start_at) at time zone 'Asia/Kuala_Lumpur',
      case p_period when 'day' then 'HH24:00' when 'month' then 'YYYY-MM-DD' else 'YYYY-MM' end) as bucket,
      count(*) as n, sum(total_cents) as total
    from public.bookings
    where payment_status = 'paid' and status not in ('cancelled', 'no_show')
      and coalesce(paid_at, start_at) >= v_start and coalesce(paid_at, start_at) < v_end
    group by 1) g;

  select coalesce(jsonb_agg(jsonb_build_object('service_name', service_name, 'kind', kind, 'count', n, 'revenue_cents', total)
    order by total desc), '[]'::jsonb)
  into v_services from (
    select i.service_name, i.kind, count(*) as n, sum(i.price_cents) as total
    from public.bookings b join public.booking_items i on i.booking_id = b.id
    where b.payment_status = 'paid' and b.status not in ('cancelled', 'no_show')
      and coalesce(b.paid_at, b.start_at) >= v_start and coalesce(b.paid_at, b.start_at) < v_end
    group by i.service_name, i.kind) g;

  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into v_status from (
    select status, count(*) as n from public.bookings
    where start_at >= v_start and start_at < v_end group by status) g;

  return jsonb_build_object('summary', v_summary, 'buckets', v_buckets, 'services', v_services,
    'status_counts', v_status, 'start', v_start, 'end', v_end);
end;
$$;
revoke all on function public.admin_revenue_report(text,date) from public, anon;
grant execute on function public.admin_revenue_report(text,date) to authenticated;

-- ---------------------------------------------------------------------
-- Promotions shown on the home page
-- ---------------------------------------------------------------------
create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 120),
  caption text not null default '' check (length(caption) <= 500),
  image_path text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.promotions enable row level security;
revoke all on public.promotions from anon, authenticated;
grant select on public.promotions to anon, authenticated;
grant insert, update, delete on public.promotions to authenticated;
create policy promotions_read on public.promotions for select to anon, authenticated
  using (active or (select public.is_shop_admin()));
create policy promotions_manage on public.promotions for all to authenticated
  using ((select public.is_shop_admin())) with check ((select public.is_shop_admin()));

-- ---------------------------------------------------------------------
-- Storage: public site images (services, promos, QR) + private receipts
-- ---------------------------------------------------------------------
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('site-images', 'site-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('payment-receipts', 'payment-receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false;

create policy site_images_add on storage.objects for insert to authenticated
  with check (bucket_id = 'site-images' and (select public.is_shop_admin()));
create policy site_images_read on storage.objects for select to authenticated
  using (bucket_id = 'site-images' and (select public.is_shop_admin()));
create policy site_images_remove on storage.objects for delete to authenticated
  using (bucket_id = 'site-images' and (select public.is_shop_admin()));

-- Receipts live at <user id>/<booking request key or booking id>/<file>.
create policy receipts_add on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-receipts'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and split_part(name, '/', 2) ~ '^[0-9a-f-]{36}$');
create policy receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'payment-receipts'
    and (split_part(name, '/', 1) = (select auth.uid())::text or (select public.is_shop_admin())));

-- ---------------------------------------------------------------------
-- Starter catalogue — SAMPLE prices. Edit everything in Admin > Services.
-- ---------------------------------------------------------------------
insert into public.vehicle_types(name, description, sort_order) values
  ('Small / Hatchback', 'Axia, Myvi, Bezza, Jazz, Yaris', 1),
  ('Sedan', 'Saga, Vios, City, Civic, Camry', 2),
  ('SUV / MPV', 'X50, X70, HR-V, CR-V, Alza, Aruz', 3),
  ('Large / 4x4 / Van', 'Hilux, Ranger, Alphard, Vellfire, Starex', 4);

insert into public.services(name, description, kind, duration_minutes, popular, sort_order) values
  ('Express Wash', 'Snow foam pre-wash, hand wash, rim & tyre clean, quick dry and tyre dressing.', 'package', 45, false, 1),
  ('Premium Wash & Wax', 'Everything in Express plus interior vacuum, dashboard wipe, glass clean and spray wax protection.', 'package', 90, true, 2),
  ('Interior Deep Clean', 'Full vacuum, seat & carpet shampoo, plastics and leather treatment, door jambs and odour treatment.', 'package', 180, true, 3),
  ('Full Detailing', 'Premium wash, clay bar, one-step paint polish, full interior deep clean and 3-month sealant.', 'package', 300, true, 4),
  ('Engine Bay Clean', 'Safe degrease and dressing of the engine bay.', 'addon', 30, false, 10),
  ('Rim & Tyre Detail', 'Iron fallout removal on rims plus long-lasting tyre shine.', 'addon', 30, false, 11),
  ('Odour Removal (Ozone)', 'Ozone treatment to remove smoke, food and damp smells.', 'addon', 30, false, 12),
  ('Headlight Restoration', 'Sand, polish and UV-coat both headlights.', 'addon', 45, false, 13),
  ('Glass Watermark Removal', 'Remove water spots from all windows and apply glass coating.', 'addon', 45, false, 14),
  ('Seat Shampoo', 'Deep shampoo of fabric seats (included in Interior Deep Clean).', 'addon', 60, false, 15);

insert into public.service_prices(service_id, vehicle_type_id, price_cents)
select s.id, t.id,
  (case s.name
    when 'Express Wash' then 1500 when 'Premium Wash & Wax' then 3500 when 'Interior Deep Clean' then 15000
    when 'Full Detailing' then 38000 when 'Engine Bay Clean' then 3000 when 'Rim & Tyre Detail' then 2500
    when 'Odour Removal (Ozone)' then 4000 when 'Headlight Restoration' then 6000
    when 'Glass Watermark Removal' then 8000 else 5000 end)
  * (case t.sort_order when 1 then 1.0 when 2 then 1.15 when 3 then 1.35 else 1.6 end)::numeric
  / 100 * 100
from public.services s cross join public.vehicle_types t;
update public.service_prices set price_cents =
  case when price_cents >= 5000 then round(price_cents / 500.0) * 500 else round(price_cents / 100.0) * 100 end;

commit;
