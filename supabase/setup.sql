-- =====================================================================
-- 내가 만드는 경제수학 용어사전 — 수행평가 답안 DB (멱등 아님: 새 프로젝트에 한 번 실행)
--
-- 구조
--   * 모든 데이터는 private 스키마(API에 노출되지 않음)에만 저장한다.
--   * 브라우저는 publishable 키로 public 스키마의 RPC 함수만 부를 수 있다.
--   * 학생: 학번(5자리)+이름 → student_enter() 가 임시 토큰 발급(새로 입장하면 이전 토큰은 무효).
--           저장·사진은 토큰과 접속 가능 시간(open_at ≤ 지금 < close_at)을 서버에서 검사.
--   * 교사: teacher_login(비밀번호) → 12시간 토큰. 비밀번호는 salt+sha256 해시만 저장.
--           같은 IP에서 10분에 8번 틀리면 잠시 막는다.
--
-- 교사 비밀번호 설정/변경 (원문을 SQL·Git·로그에 남기지 말 것)
--   로컬에서 salt 와 sha256(salt || 비밀번호) 를 만든 뒤
--   select private.set_teacher_secret('<salt>', '<sha256 hex>');
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

-- ---------------------------------------------------------------- 테이블
create table private.settings (
  id           int primary key default 1 check (id = 1),
  open_at      timestamptz,
  close_at     timestamptz,
  teacher_salt text,
  teacher_hash text,
  updated_at   timestamptz not null default now(),
  check (open_at is null or close_at is null or close_at > open_at)
);
insert into private.settings (id) values (1);

create table private.students (
  id              uuid primary key default gen_random_uuid(),
  student_id      text not null unique check (student_id ~ '^[0-9]{5}$'),
  name            text not null check (char_length(name) between 1 and 20),
  token_hash      text unique,
  token_issued_at timestamptz,
  content         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  save_count      int not null default 0
);

create table private.images (
  id         uuid primary key default gen_random_uuid(),
  student    uuid not null references private.students(id) on delete cascade,
  data       text not null,
  created_at timestamptz not null default now()
);
create index on private.images (student, created_at);

create table private.teacher_sessions (
  token_hash text primary key,
  expires_at timestamptz not null
);

create table private.login_attempts (
  ip text not null,
  at timestamptz not null default now()
);
create index on private.login_attempts (ip, at);

alter table private.settings enable row level security;
alter table private.students enable row level security;
alter table private.images enable row level security;
alter table private.teacher_sessions enable row level security;
alter table private.login_attempts enable row level security;

-- ---------------------------------------------------------------- 내부 도우미
create or replace function private.sha(t text) returns text
language sql immutable set search_path = '' as
$$ select encode(extensions.digest(t, 'sha256'), 'hex') $$;

create or replace function private.new_token() returns text
language sql volatile set search_path = '' as
$$ select encode(extensions.gen_random_bytes(32), 'hex') $$;

create or replace function private.is_open() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(open_at <= now() and now() < close_at, false) from private.settings where id = 1
$$;

create or replace function private.client_ip() returns text
language sql stable set search_path = '' as $$
  select coalesce(nullif(trim(split_part(
    coalesce(current_setting('request.headers', true), '{}')::json ->> 'x-forwarded-for', ',', 1)), ''), 'unknown')
$$;

create or replace function private.student_by_token(p_token text) returns private.students
language plpgsql stable security definer set search_path = '' as $$
declare s private.students;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'SESSION_EXPIRED'; end if;
  select * into s from private.students where token_hash = private.sha(p_token);
  if not found then raise exception 'SESSION_EXPIRED'; end if;
  return s;
end $$;

create or replace function private.check_teacher(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.teacher_sessions where expires_at < now();
  if p_token is null or not exists (
    select 1 from private.teacher_sessions where token_hash = private.sha(p_token) and expires_at > now()
  ) then
    raise exception 'TEACHER_AUTH';
  end if;
end $$;

create or replace function private.images_json(p_student uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'data', data) order by created_at), '[]'::jsonb)
  from private.images where student = p_student
$$;

create or replace function private.set_teacher_secret(p_salt text, p_hash text) returns void
language sql security definer set search_path = '' as $$
  update private.settings set teacher_salt = p_salt, teacher_hash = lower(p_hash), updated_at = now() where id = 1;
  delete from private.teacher_sessions;
$$;

-- ---------------------------------------------------------------- 공개 RPC: 상태
create or replace function public.app_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('open_at', open_at, 'close_at', close_at, 'now', now(), 'is_open', private.is_open())
  from private.settings where id = 1
$$;

-- ---------------------------------------------------------------- 학생 RPC
create or replace function public.student_enter(p_student_id text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sid  text := trim(coalesce(p_student_id, ''));
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_tok  text := private.new_token();
  s private.students;
begin
  if v_sid !~ '^[0-9]{5}$' then raise exception 'BAD_STUDENT_ID'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 20 then raise exception 'BAD_NAME'; end if;
  if not private.is_open() then raise exception 'CLOSED'; end if;

  select * into s from private.students where student_id = v_sid for update;
  if found then
    if s.name <> v_name then raise exception 'NAME_MISMATCH'; end if;
    update private.students set token_hash = private.sha(v_tok), token_issued_at = now()
      where id = s.id returning * into s;
  else
    insert into private.students (student_id, name, token_hash, token_issued_at)
      values (v_sid, v_name, private.sha(v_tok), now()) returning * into s;
  end if;

  return jsonb_build_object(
    'token', v_tok, 'student_id', s.student_id, 'name', s.name,
    'content', s.content, 'updated_at', s.updated_at, 'images', private.images_json(s.id));
end $$;

create or replace function public.student_load(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s private.students := private.student_by_token(p_token);
begin
  return jsonb_build_object(
    'student_id', s.student_id, 'name', s.name, 'content', s.content,
    'updated_at', s.updated_at, 'images', private.images_json(s.id), 'is_open', private.is_open());
end $$;

create or replace function public.student_save(p_token text, p_content jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s private.students := private.student_by_token(p_token); v_at timestamptz;
begin
  if not private.is_open() then raise exception 'CLOSED'; end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then raise exception 'BAD_CONTENT'; end if;
  if octet_length(p_content::text) > 400000 then raise exception 'TOO_LARGE'; end if;
  update private.students set content = p_content, updated_at = now(), save_count = save_count + 1
    where id = s.id returning updated_at into v_at;
  return jsonb_build_object('updated_at', v_at);
end $$;

create or replace function public.student_add_image(p_token text, p_data text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s private.students := private.student_by_token(p_token); v_id uuid; v_at timestamptz;
begin
  if not private.is_open() then raise exception 'CLOSED'; end if;
  if p_data is null or length(p_data) > 1500000
     or p_data !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then
    raise exception 'BAD_IMAGE';
  end if;
  if (select count(*) from private.images where student = s.id) >= 4 then raise exception 'TOO_MANY_IMAGES'; end if;
  insert into private.images (student, data) values (s.id, p_data) returning id into v_id;
  update private.students set updated_at = now(), save_count = save_count + 1 where id = s.id returning updated_at into v_at;
  return jsonb_build_object('id', v_id, 'updated_at', v_at);
end $$;

create or replace function public.student_delete_image(p_token text, p_image uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s private.students := private.student_by_token(p_token); v_at timestamptz;
begin
  if not private.is_open() then raise exception 'CLOSED'; end if;
  delete from private.images where id = p_image and student = s.id;
  update private.students set updated_at = now(), save_count = save_count + 1 where id = s.id returning updated_at into v_at;
  return jsonb_build_object('updated_at', v_at);
end $$;

-- ---------------------------------------------------------------- 교사 RPC
create or replace function public.teacher_login(p_password text) returns text
language plpgsql security definer set search_path = '' as $$
declare st private.settings; v_ip text := private.client_ip(); v_tok text;
begin
  delete from private.login_attempts where at < now() - interval '1 day';
  if (select count(*) from private.login_attempts where ip = v_ip and at > now() - interval '10 minutes') >= 8 then
    raise exception 'TOO_MANY_ATTEMPTS';
  end if;
  select * into st from private.settings where id = 1;
  if st.teacher_hash is null or p_password is null
     or private.sha(st.teacher_salt || p_password) <> st.teacher_hash then
    insert into private.login_attempts (ip) values (v_ip);
    raise exception 'WRONG_PASSWORD';
  end if;
  delete from private.login_attempts where ip = v_ip;
  v_tok := private.new_token();
  insert into private.teacher_sessions (token_hash, expires_at) values (private.sha(v_tok), now() + interval '12 hours');
  return v_tok;
end $$;

create or replace function public.teacher_logout(p_token text) returns void
language sql security definer set search_path = '' as $$
  delete from private.teacher_sessions where token_hash = private.sha(p_token)
$$;

create or replace function public.teacher_set_window(p_token text, p_open timestamptz, p_close timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_teacher(p_token);
  if p_open is null or p_close is null or p_close <= p_open then raise exception 'BAD_WINDOW'; end if;
  update private.settings set open_at = p_open, close_at = p_close, updated_at = now() where id = 1;
  return public.app_status();
end $$;

create or replace function public.teacher_list(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_teacher(p_token);
  return jsonb_build_object(
    'status', public.app_status(),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_id', s.student_id, 'name', s.name, 'content', s.content,
        'created_at', s.created_at, 'updated_at', s.updated_at, 'save_count', s.save_count,
        'image_count', (select count(*) from private.images i where i.student = s.id))
        order by s.student_id)
      from private.students s), '[]'::jsonb));
end $$;

create or replace function public.teacher_get_images(p_token text, p_student_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.check_teacher(p_token);
  select id into v_id from private.students where student_id = p_student_id;
  if v_id is null then return '[]'::jsonb; end if;
  return private.images_json(v_id);
end $$;

create or replace function public.teacher_delete_student(p_token text, p_student_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_teacher(p_token);
  delete from private.students where student_id = p_student_id;
end $$;

-- ---------------------------------------------------------------- 권한
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

revoke execute on function
  public.app_status(), public.student_enter(text, text), public.student_load(text),
  public.student_save(text, jsonb), public.student_add_image(text, text), public.student_delete_image(text, uuid),
  public.teacher_login(text), public.teacher_logout(text), public.teacher_set_window(text, timestamptz, timestamptz),
  public.teacher_list(text), public.teacher_get_images(text, text), public.teacher_delete_student(text, text)
from public;

grant execute on function
  public.app_status(), public.student_enter(text, text), public.student_load(text),
  public.student_save(text, jsonb), public.student_add_image(text, text), public.student_delete_image(text, uuid),
  public.teacher_login(text), public.teacher_logout(text), public.teacher_set_window(text, timestamptz, timestamptz),
  public.teacher_list(text), public.teacher_get_images(text, text), public.teacher_delete_student(text, text)
to anon, authenticated;
