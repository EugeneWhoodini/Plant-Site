-- PLANTOVIA Supabase setup
-- Run this entire file in the Supabase SQL Editor.
-- Admin email: e.koblitsky@gmail.com

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  blocked boolean not null default false,
  blocked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists blocked boolean not null default false;
alter table public.profiles add column if not exists blocked_at timestamptz;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

insert into public.profiles (user_id, email, created_at, updated_at)
select id, lower(coalesce(email, '')), created_at, now()
from auth.users
on conflict (user_id) do update
set email = excluded.email,
    updated_at = now();

create or replace function public.handle_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email, created_at, updated_at)
  values (new.id, lower(coalesce(new.email, '')), coalesce(new.created_at, now()), now())
  on conflict (user_id) do update
  set email = excluded.email,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists plantovia_auth_user_profile on auth.users;
create trigger plantovia_auth_user_profile
after insert or update of email on auth.users
for each row execute function public.handle_auth_user_profile();

create table if not exists public.plants (
  id text primary key,
  name text not null,
  price numeric(10, 2) not null default 0 check (price >= 0),
  description text not null default '',
  requirements text[] not null default '{}',
  images text[] not null default '{}',
  status text not null default 'good' check (status in ('good', 'low')),
  categories text[] not null default '{}',
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.plants
add column if not exists categories text[] not null default '{}';

create table if not exists public.featured_plants (
  plant_id text primary key references public.plants(id) on delete cascade,
  position integer not null default 0
);

create table if not exists public.plant_categories (
  name text primary key,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create sequence if not exists public.order_number_seq start with 1000;

create table if not exists public.orders (
  order_number text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_email text not null default '',
  items jsonb not null default '[]'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  delivery_info jsonb not null default '{}'::jsonb,
  confirmation jsonb not null default '{}'::jsonb,
  status text not null default 'Order submitted',
  payment_method text not null default 'E-transfer',
  payment_status text not null default 'Awaiting e-transfer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders add column if not exists customer_email text not null default '';
alter table public.orders add column if not exists confirmation jsonb not null default '{}'::jsonb;
alter table public.orders add column if not exists payment_method text not null default 'E-transfer';
alter table public.orders add column if not exists payment_status text not null default 'Awaiting e-transfer';
alter table public.orders add column if not exists updated_at timestamptz not null default now();

create index if not exists orders_user_created_idx
on public.orders (user_id, created_at desc);

create index if not exists orders_created_idx
on public.orders (created_at desc);

alter table public.plants enable row level security;
alter table public.featured_plants enable row level security;
alter table public.plant_categories enable row level security;
alter table public.site_settings enable row level security;
alter table public.orders enable row level security;
alter table public.profiles enable row level security;

drop policy if exists "Customers can read their own profile" on public.profiles;
create policy "Customers can read their own profile"
on public.profiles for select
to authenticated
using (
  (select auth.uid()) = user_id
  or lower((select auth.jwt() ->> 'email')) = 'e.koblitsky@gmail.com'
);

drop policy if exists "Admin can update account blocks" on public.profiles;
create policy "Admin can update account blocks"
on public.profiles for update
to authenticated
using (lower((select auth.jwt() ->> 'email')) = 'e.koblitsky@gmail.com')
with check (
  lower((select auth.jwt() ->> 'email')) = 'e.koblitsky@gmail.com'
  and not (lower(email) = 'e.koblitsky@gmail.com' and blocked)
);

revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (blocked, blocked_at, updated_at) on public.profiles to authenticated;

drop policy if exists "Public can read plants" on public.plants;
create policy "Public can read plants"
on public.plants for select
to anon, authenticated
using (true);

drop policy if exists "Admin can manage plants" on public.plants;
create policy "Admin can manage plants"
on public.plants for all
to authenticated
using (lower((select auth.jwt() ->> 'email')) = 'e.koblitsky@gmail.com')
with check (lower((select auth.jwt() ->> 'email')) = 'e.koblitsky@gmail.com');

drop policy if exists "Public can read featured plants" on public.featured_plants;
create policy "Public can read featured plants"
on public.featured_plants for select
to anon, authenticated
using (true);

drop policy if exists "Admin can manage featured plants" on public.featured_plants;
create policy "Admin can manage featured plants"
on public.featured_plants for all
to authenticated
using (lower((select auth.jwt() ->> 'email')) = 'e.koblitsky@gmail.com')
with check (lower((select auth.jwt() ->> 'email')) = 'e.koblitsky@gmail.com');

drop policy if exists "Public can read plant categories" on public.plant_categories;
create policy "Public can read plant categories"
on public.plant_categories for select
to anon, authenticated
using (true);

drop policy if exists "Admin can manage plant categories" on public.plant_categories;
create policy "Admin can manage plant categories"
on public.plant_categories for all
to authenticated
using (lower((select auth.jwt() ->> 'email')) = 'e.koblitsky@gmail.com')
with check (lower((select auth.jwt() ->> 'email')) = 'e.koblitsky@gmail.com');

drop policy if exists "Public can read site settings" on public.site_settings;
create policy "Public can read site settings"
on public.site_settings for select
to anon, authenticated
using (true);

drop policy if exists "Admin can manage site settings" on public.site_settings;
create policy "Admin can manage site settings"
on public.site_settings for all
to authenticated
using (lower((select auth.jwt() ->> 'email')) = 'e.koblitsky@gmail.com')
with check (lower((select auth.jwt() ->> 'email')) = 'e.koblitsky@gmail.com');

insert into public.site_settings (key, value)
values ('shipping', '{"freeMississaugaShippingThreshold": 50, "mississaugaDeliveryFee": 5}'::jsonb)
on conflict (key) do nothing;

update public.site_settings
set value = value || '{"mississaugaDeliveryFee": 5}'::jsonb
where key = 'shipping'
and not (value ? 'mississaugaDeliveryFee');

drop policy if exists "Customers can read their own orders" on public.orders;
create policy "Customers can read their own orders"
on public.orders for select
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and not exists (
    select 1 from public.profiles profile
    where profile.user_id = (select auth.uid()) and profile.blocked
  )
);

drop policy if exists "Admin can read all orders" on public.orders;
create policy "Admin can read all orders"
on public.orders for select
to authenticated
using (lower((select auth.jwt() ->> 'email')) = 'e.koblitsky@gmail.com');

drop policy if exists "Admin can update orders" on public.orders;
create policy "Admin can update orders"
on public.orders for update
to authenticated
using (lower((select auth.jwt() ->> 'email')) = 'e.koblitsky@gmail.com')
with check (lower((select auth.jwt() ->> 'email')) = 'e.koblitsky@gmail.com');

drop policy if exists "Customers can create their own orders" on public.orders;
drop policy if exists "Customers can update their own orders" on public.orders;

revoke insert, delete on public.orders from anon, authenticated;
grant select, update on public.orders to authenticated;

create or replace function public.place_order(p_items jsonb, p_delivery_info jsonb)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_customer_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
  v_order_number text;
  v_items jsonb;
  v_delivery_info jsonb;
  v_subtotal numeric(10, 2);
  v_tax numeric(10, 2);
  v_shipping numeric(10, 2);
  v_total numeric(10, 2);
  v_threshold numeric(10, 2) := 50;
  v_delivery_fee numeric(10, 2) := 5;
  v_requested_count integer;
  v_priced_count integer;
  v_order public.orders;
begin
  if v_user_id is null or v_customer_email = '' then
    raise exception 'Sign in before placing an order.';
  end if;

  if exists (
    select 1 from public.profiles profile
    where profile.user_id = v_user_id and profile.blocked
  ) then
    raise exception 'This Plantovia account has been blocked. Contact plantovia.shop@gmail.com for help.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 50 then
    raise exception 'Your cart must contain between 1 and 50 plant lines.';
  end if;

  if p_delivery_info is null or jsonb_typeof(p_delivery_info) <> 'object' then
    raise exception 'Delivery information is required.';
  end if;

  if length(trim(coalesce(p_delivery_info ->> 'name', ''))) not between 2 and 120
     or length(trim(coalesce(p_delivery_info ->> 'phone', ''))) not between 7 and 30
     or length(trim(coalesce(p_delivery_info ->> 'address', ''))) not between 5 and 180
     or length(trim(coalesce(p_delivery_info ->> 'city', ''))) not between 2 and 80
     or length(trim(coalesce(p_delivery_info ->> 'postal', ''))) not between 3 and 12 then
    raise exception 'Complete all delivery fields before placing the order.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as requested(id text, quantity integer)
    where requested.id is null
       or requested.quantity is null
       or requested.quantity < 1
       or requested.quantity > 99
  ) then
    raise exception 'Each plant quantity must be between 1 and 99.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as requested(id text, quantity integer)
    group by requested.id
    having sum(requested.quantity) > 99
  ) then
    raise exception 'The combined quantity for one plant cannot exceed 99.';
  end if;

  with requested as (
    select id, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as row_data(id text, quantity integer)
    group by id
  )
  select count(*) into v_requested_count from requested;

  with requested as (
    select id, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as row_data(id text, quantity integer)
    group by id
  ), priced as (
    select p.id, p.name, p.price, p.images, p.sort_order, requested.quantity
    from requested
    join public.plants p on p.id = requested.id
  )
  select
    count(*),
    coalesce(sum(round(price * quantity, 2)), 0),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'name', name,
          'price', round(price, 2),
          'quantity', quantity,
          'lineTotal', round(price * quantity, 2),
          'image', coalesce(images[1], '')
        ) order by sort_order, name
      ),
      '[]'::jsonb
    )
  into v_priced_count, v_subtotal, v_items
  from priced;

  if v_requested_count <> v_priced_count or v_priced_count = 0 then
    raise exception 'One or more plants are no longer available. Refresh your cart.';
  end if;

  if exists (
    select 1
    from public.orders
    where user_id = v_user_id
      and created_at > now() - interval '5 seconds'
  ) then
    raise exception 'Please wait a few seconds before placing another order.';
  end if;

  if (
    select count(*)
    from public.orders
    where user_id = v_user_id
      and created_at > now() - interval '1 hour'
  ) >= 20 then
    raise exception 'Order limit reached. Please contact Plantovia for help.';
  end if;

  select
    coalesce((value ->> 'freeMississaugaShippingThreshold')::numeric, 50),
    coalesce((value ->> 'mississaugaDeliveryFee')::numeric, 5)
  into v_threshold, v_delivery_fee
  from public.site_settings
  where key = 'shipping';

  v_subtotal := round(v_subtotal, 2);
  v_tax := round(v_subtotal * 0.13, 2);
  v_shipping := case when v_subtotal >= v_threshold then 0 else round(v_delivery_fee, 2) end;
  v_total := round(v_subtotal + v_tax + v_shipping, 2);
  v_order_number := 'PLV-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-' ||
    lpad(nextval('public.order_number_seq')::text, 6, '0');

  v_delivery_info := jsonb_build_object(
    'name', left(trim(p_delivery_info ->> 'name'), 120),
    'phone', left(trim(p_delivery_info ->> 'phone'), 30),
    'email', v_customer_email,
    'address', left(trim(p_delivery_info ->> 'address'), 180),
    'city', left(trim(p_delivery_info ->> 'city'), 80),
    'postal', upper(left(trim(p_delivery_info ->> 'postal'), 12))
  );

  insert into public.orders (
    order_number, user_id, customer_email, items, totals, delivery_info,
    confirmation, status, payment_method, payment_status
  ) values (
    v_order_number,
    v_user_id,
    v_customer_email,
    v_items,
    jsonb_build_object(
      'subtotal', v_subtotal,
      'tax', v_tax,
      'shipping', v_shipping,
      'total', v_total,
      'currency', 'CAD'
    ),
    v_delivery_info,
    '{}'::jsonb,
    'Order submitted',
    'E-transfer',
    'Awaiting e-transfer'
  )
  returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.confirm_order_received(
  p_order_number text,
  p_signature text,
  p_user_agent text default ''
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_signer_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
  v_signed_at timestamptz := clock_timestamp();
  v_signature text := regexp_replace(trim(coalesce(p_signature, '')), '\s+', ' ', 'g');
  v_order public.orders;
  v_proof_hash text;
begin
  if v_user_id is null then
    raise exception 'Sign in before confirming delivery.';
  end if;

  if exists (
    select 1 from public.profiles profile
    where profile.user_id = v_user_id and profile.blocked
  ) then
    raise exception 'This Plantovia account has been blocked. Contact plantovia.shop@gmail.com for help.';
  end if;

  if length(v_signature) not between 2 and 120 then
    raise exception 'Type your full name as the electronic signature.';
  end if;

  select * into v_order
  from public.orders
  where order_number = p_order_number
    and user_id = v_user_id;

  if v_order.order_number is null then
    raise exception 'Order not found.';
  end if;

  if coalesce(v_order.confirmation ->> 'signed_at', '') <> ''
     or coalesce(v_order.confirmation ->> 'confirmedAt', '') <> '' then
    raise exception 'Delivery was already confirmed for this order.';
  end if;

  v_proof_hash := encode(
    extensions.digest(
      concat_ws('|', v_order.order_number, v_user_id::text, v_signer_email,
        v_signature, v_signed_at::text, v_order.totals::text),
      'sha256'
    ),
    'hex'
  );

  update public.orders
  set
    confirmation = jsonb_build_object(
      'signature', v_signature,
      'signed_at', v_signed_at,
      'signed_by_email', v_signer_email,
      'statement', 'I confirm that I received this order in acceptable condition.',
      'user_agent', left(coalesce(p_user_agent, ''), 300),
      'proof_hash', v_proof_hash
    ),
    status = 'Delivered',
    updated_at = v_signed_at
  where order_number = p_order_number
    and user_id = v_user_id
  returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.place_order(jsonb, jsonb) from public, anon;
revoke all on function public.confirm_order_received(text, text, text) from public, anon;
grant execute on function public.place_order(jsonb, jsonb) to authenticated;
grant execute on function public.confirm_order_received(text, text, text) to authenticated;

insert into storage.buckets (id, name, public)
values ('plant-images', 'plant-images', true)
on conflict (id) do update set public = true;

drop policy if exists "Public can view plant images" on storage.objects;
create policy "Public can view plant images"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'plant-images');

drop policy if exists "Admin can upload plant images" on storage.objects;
create policy "Admin can upload plant images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'plant-images'
  and lower((select auth.jwt() ->> 'email')) = 'e.koblitsky@gmail.com'
);

drop policy if exists "Admin can delete plant images" on storage.objects;
create policy "Admin can delete plant images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'plant-images'
  and lower((select auth.jwt() ->> 'email')) = 'e.koblitsky@gmail.com'
);
