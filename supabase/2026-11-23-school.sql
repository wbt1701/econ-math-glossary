-- 2026-11-23 학교명 추가: 같은 학교명 + 학번 + 이름이면 같은 답안을 이어서 수정
-- 학교명은 앞뒤·중간 공백을 모두 지운 값으로 비교한다("풍산 고등학교" = "풍산고등학교").
-- 실행 전 기록: private.students 1행(학번 99999, 교사 시험 입력). 이 행은 학교명 '' 로 남는다.
-- 교사 화면의 사진 보기·삭제는 학번 대신 행 id 로 찾는다(학교가 달라 학번이 겹칠 수 있으므로).

alter table private.students add column school text not null default '';
alter table private.students drop constraint students_student_id_key;
alter table private.students add constraint students_school_student_key unique (school, student_id);

create or replace function private.norm_school(p text) returns text
language sql immutable set search_path = '' as $$ select regexp_replace(coalesce(p, ''), '\s+', '', 'g') $$;

drop function public.student_enter(text, text);
create function public.student_enter(p_school text, p_student_id text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_school text := private.norm_school(p_school);
  v_sid  text := trim(coalesce(p_student_id, ''));
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_tok  text := private.new_token();
  s private.students;
begin
  if char_length(v_school) < 2 or char_length(v_school) > 30 then raise exception 'BAD_SCHOOL'; end if;
  if v_sid !~ '^[0-9]{5}$' then raise exception 'BAD_STUDENT_ID'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 20 then raise exception 'BAD_NAME'; end if;
  if not private.is_open() then raise exception 'CLOSED'; end if;

  select * into s from private.students where school = v_school and student_id = v_sid for update;
  if found then
    if s.name <> v_name then raise exception 'NAME_MISMATCH'; end if;
    update private.students set token_hash = private.sha(v_tok), token_issued_at = now()
      where id = s.id returning * into s;
  else
    insert into private.students (school, student_id, name, token_hash, token_issued_at)
      values (v_school, v_sid, v_name, private.sha(v_tok), now()) returning * into s;
  end if;

  return jsonb_build_object(
    'token', v_tok, 'school', s.school, 'student_id', s.student_id, 'name', s.name,
    'content', s.content, 'updated_at', s.updated_at, 'images', private.images_json(s.id));
end $$;

create or replace function public.student_load(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s private.students := private.student_by_token(p_token);
begin
  return jsonb_build_object(
    'school', s.school, 'student_id', s.student_id, 'name', s.name, 'content', s.content,
    'updated_at', s.updated_at, 'images', private.images_json(s.id), 'is_open', private.is_open());
end $$;

create or replace function public.teacher_list(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_teacher(p_token);
  return jsonb_build_object(
    'status', public.app_status(),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'school', s.school, 'student_id', s.student_id, 'name', s.name, 'content', s.content,
        'created_at', s.created_at, 'updated_at', s.updated_at, 'save_count', s.save_count,
        'image_count', (select count(*) from private.images i where i.student = s.id))
        order by s.school, s.student_id)
      from private.students s), '[]'::jsonb));
end $$;

drop function public.teacher_get_images(text, text);
create function public.teacher_get_images(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_teacher(p_token);
  return private.images_json(p_id);
end $$;

drop function public.teacher_delete_student(text, text);
create function public.teacher_delete_student(p_token text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_teacher(p_token);
  delete from private.students where id = p_id;
end $$;

revoke all on function private.norm_school(text) from public, anon, authenticated;
revoke execute on function public.student_enter(text, text, text), public.teacher_get_images(text, uuid), public.teacher_delete_student(text, uuid) from public;
grant execute on function public.student_enter(text, text, text), public.teacher_get_images(text, uuid), public.teacher_delete_student(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------- 되돌리기 (필요할 때만)
-- 같은 학번이 두 학교에 있으면 먼저 정리해야 unique(student_id) 를 다시 걸 수 있다.
-- drop function public.student_enter(text, text, text);
-- drop function public.teacher_get_images(text, uuid);
-- drop function public.teacher_delete_student(text, uuid);
-- alter table private.students drop constraint students_school_student_key;
-- alter table private.students add constraint students_student_id_key unique (student_id);
-- alter table private.students drop column school;
-- drop function private.norm_school(text);
-- 그 뒤 setup.sql 의 student_enter(text,text)·student_load·teacher_list·teacher_get_images(text,text)·
-- teacher_delete_student(text,text) 정의와 권한 부분을 다시 실행한다.
