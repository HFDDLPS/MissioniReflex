-- Missioni Reflex MVP — Supabase schema
-- Run this entire file in Supabase SQL Editor using the project owner/admin role.
-- Do not put the service_role key in the Android app.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default 'Fotografo',
  role text not null default 'student' check (role in ('student','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.mission_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_id integer not null check (mission_id between 1 and 12),
  status text not null check (status in ('in_progress','pending','approved','retry')),
  review_note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, mission_id)
);

create table if not exists public.mission_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_id integer not null check (mission_id between 1 and 12),
  storage_path text not null,
  status text not null default 'pending' check (status in ('pending','approved','retry')),
  review_note text not null default '',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);


-- Expand the initial three-mission test catalogue to the 12-mission learning path.
-- Drop and recreate the generated constraints so this script also upgrades an existing MVP database.
alter table public.mission_progress drop constraint if exists mission_progress_mission_id_check;
alter table public.mission_progress add constraint mission_progress_mission_id_check check (mission_id between 1 and 12);
alter table public.mission_submissions drop constraint if exists mission_submissions_mission_id_check;
alter table public.mission_submissions add constraint mission_submissions_mission_id_check check (mission_id between 1 and 12);

create index if not exists mission_submissions_status_created_idx
  on public.mission_submissions(status, created_at desc);
create index if not exists mission_submissions_user_idx
  on public.mission_submissions(user_id, created_at desc);

create table if not exists public.user_cosmetics (
  user_id uuid primary key references auth.users(id) on delete cascade,
  equipped_item text not null default 'none'
    check (equipped_item in ('none','camera_hat','wrapped_scarf','moka_pot')),
  updated_at timestamptz not null default now()
);

-- Upgrade existing installations from the previous prototype cosmetics.
-- Old accessory identifiers are removed and the player returns to the plain camera.
alter table public.user_cosmetics drop constraint if exists user_cosmetics_equipped_item_check;
update public.user_cosmetics
set equipped_item = 'none', updated_at = now()
where equipped_item in ('scout_hat','red_scarf','leather_strap')
   or equipped_item not in ('none','camera_hat','wrapped_scarf','moka_pot');
alter table public.user_cosmetics
  add constraint user_cosmetics_equipped_item_check
  check (equipped_item in ('none','camera_hat','wrapped_scarf','moka_pot'));

-- Create a profile automatically after each signup. Role is never taken from user metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(user_id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(coalesce(new.email,''),'@',1), 'Fotografo'),
    'student'
  )
  on conflict (user_id) do update
    set email = excluded.email,
        full_name = coalesce(nullif(public.profiles.full_name,''), excluded.full_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  );
$$;

-- The client cannot directly set mission statuses. Accepting a mission goes through this RPC.
create or replace function public.start_mission(p_mission_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
begin
  if auth.uid() is null then
    raise exception 'Autenticazione richiesta';
  end if;
  if p_mission_id not between 1 and 12 then
    raise exception 'Missione non valida';
  end if;

  select status into current_status
  from public.mission_progress
  where user_id = auth.uid() and mission_id = p_mission_id
  for update;

  if current_status in ('pending','approved') then
    raise exception 'Questa missione non può essere avviata adesso';
  elsif current_status = 'retry' then
    update public.mission_progress
      set status = 'in_progress', review_note = '', updated_at = now()
      where user_id = auth.uid() and mission_id = p_mission_id;
  elsif current_status = 'in_progress' then
    return;
  else
    insert into public.mission_progress(user_id, mission_id, status)
      values (auth.uid(), p_mission_id, 'in_progress')
      on conflict (user_id, mission_id) do nothing;
  end if;
end;
$$;

-- Keep user-facing progress in sync with a newly submitted or reviewed photo.
create or replace function public.sync_submission_to_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.mission_progress(user_id, mission_id, status, review_note, updated_at)
      values (new.user_id, new.mission_id, 'pending', '', now())
      on conflict (user_id, mission_id) do update
        set status = 'pending', review_note = '', updated_at = now();
  elsif new.status is distinct from old.status then
    if new.status in ('approved','retry') then
      insert into public.mission_progress(user_id, mission_id, status, review_note, updated_at)
        values (new.user_id, new.mission_id, new.status, coalesce(new.review_note,''), now())
        on conflict (user_id, mission_id) do update
          set status = excluded.status, review_note = excluded.review_note, updated_at = now();
    elsif new.status = 'pending' then
      insert into public.mission_progress(user_id, mission_id, status, review_note, updated_at)
        values (new.user_id, new.mission_id, 'pending', '', now())
        on conflict (user_id, mission_id) do update
          set status = 'pending', review_note = '', updated_at = now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists mission_submission_sync_progress on public.mission_submissions;
create trigger mission_submission_sync_progress
after insert or update of status, review_note on public.mission_submissions
for each row execute procedure public.sync_submission_to_progress();

-- Enforce accessory unlocks on the server as well as in the client UI.
create or replace function public.can_equip_cosmetic(p_item text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  required_ids integer[];
  approved_count integer;
begin
  if auth.uid() is null then
    return false;
  end if;
  case p_item
    when 'none' then return true;
    when 'camera_hat' then required_ids := array[4,5,6,7];
    when 'wrapped_scarf' then required_ids := array[8,9,10,11];
    when 'moka_pot' then required_ids := array[2,1,3,12];
    else return false;
  end case;
  select count(distinct mission_id) into approved_count
  from public.mission_progress
  where user_id = auth.uid()
    and mission_id = any(required_ids)
    and status = 'approved';
  return approved_count = cardinality(required_ids);
end;
$$;
revoke all on function public.can_equip_cosmetic(text) from public, anon;
grant execute on function public.can_equip_cosmetic(text) to authenticated;

alter table public.profiles enable row level security;
alter table public.mission_progress enable row level security;
alter table public.mission_submissions enable row level security;
alter table public.user_cosmetics enable row level security;

drop policy if exists "profiles own or admin read" on public.profiles;
create policy "profiles own or admin read"
on public.profiles for select to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "progress own or admin read" on public.mission_progress;
create policy "progress own or admin read"
on public.mission_progress for select to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "submissions own or admin read" on public.mission_submissions;
create policy "submissions own or admin read"
on public.mission_submissions for select to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "users submit own pending photos" on public.mission_submissions;
create policy "users submit own pending photos"
on public.mission_submissions for insert to authenticated
with check (
  user_id = auth.uid()
  and status = 'pending'
  and storage_path like auth.uid()::text || '/%'
  and exists (
    select 1 from public.mission_progress mp
    where mp.user_id = auth.uid()
      and mp.mission_id = mission_submissions.mission_id
      and mp.status = 'in_progress'
  )
);

drop policy if exists "admins review pending submissions" on public.mission_submissions;
create policy "admins review pending submissions"
on public.mission_submissions for update to authenticated
using (public.is_admin() and status = 'pending')
with check (public.is_admin() and status in ('approved','retry') and reviewed_by = auth.uid());

drop policy if exists "cosmetics own read" on public.user_cosmetics;
create policy "cosmetics own read"
on public.user_cosmetics for select to authenticated
using (user_id = auth.uid());

drop policy if exists "cosmetics own insert" on public.user_cosmetics;
create policy "cosmetics own insert"
on public.user_cosmetics for insert to authenticated
with check (user_id = auth.uid() and public.can_equip_cosmetic(equipped_item));

drop policy if exists "cosmetics own update" on public.user_cosmetics;
create policy "cosmetics own update"
on public.user_cosmetics for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and public.can_equip_cosmetic(equipped_item));

-- Private bucket: users can upload only in their own folder; only owner or admins can read.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('mission-photos', 'mission-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = false, file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "users upload own mission photos" on storage.objects;
create policy "users upload own mission photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'mission-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "users and admins read mission photos" on storage.objects;
create policy "users and admins read mission photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'mission-photos'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);

-- No client-side delete/update policies are intentionally added for stored photos.

-- Explicit least-privilege Data API grants. RLS remains the row-level gate.
grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant select on public.mission_progress to authenticated;
grant select, insert, update on public.mission_submissions to authenticated;
grant select, insert, update on public.user_cosmetics to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.start_mission(integer) to authenticated;

revoke all on function public.start_mission(integer) from anon;
revoke all on function public.handle_new_user() from anon, authenticated;
