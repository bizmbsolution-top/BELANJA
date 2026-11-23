create sequence if not exists public.fund_request_code_seq start 1;

create table if not exists public.fund_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('DAN-' || lpad(nextval('public.fund_request_code_seq')::text, 6, '0')),
  project_id uuid not null references public.projects(id) on delete restrict,
  request_amount numeric(18,2) not null check (request_amount > 0),
  purpose text not null check (length(btrim(purpose)) between 1 and 1000),
  status text not null default 'Menunggu Eksekusi' check (status in ('Menunggu Eksekusi','Selesai')),
  requested_at timestamptz not null default now(),
  requested_by uuid not null references auth.users(id) on delete restrict,
  executed_amount numeric(18,2),
  payment_method text check (payment_method in ('Tunai','Transfer')),
  execution_note text,
  executed_at timestamptz,
  executed_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'Menunggu Eksekusi' and executed_amount is null and payment_method is null and executed_at is null and executed_by is null)
    or
    (status = 'Selesai' and executed_amount >= request_amount and payment_method is not null and executed_at is not null and executed_by is not null)
  )
);
create index if not exists fund_requests_project_created_idx on public.fund_requests(project_id, requested_at desc);
create index if not exists fund_requests_status_created_idx on public.fund_requests(status, requested_at desc);

create table if not exists public.fund_request_documents (
  id uuid primary key default gen_random_uuid(),
  fund_request_id uuid not null references public.fund_requests(id) on delete restrict,
  bucket_id text not null default 'cashier-fund-evidence' check (bucket_id = 'cashier-fund-evidence'),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid not null references auth.users(id) on delete restrict
);
create index if not exists fund_request_documents_request_idx on public.fund_request_documents(fund_request_id, uploaded_at);

create table if not exists public.project_cash_ledger (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  fund_request_id uuid not null unique references public.fund_requests(id) on delete restrict,
  entry_type text not null default 'credit' check (entry_type = 'credit'),
  amount numeric(18,2) not null check (amount > 0),
  description text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict
);
create index if not exists project_cash_ledger_project_created_idx on public.project_cash_ledger(project_id, created_at desc);

alter table public.fund_requests enable row level security;
alter table public.fund_request_documents enable row level security;
alter table public.project_cash_ledger enable row level security;
revoke all on public.fund_requests, public.fund_request_documents, public.project_cash_ledger from anon, authenticated;
grant select, insert, update on public.fund_requests to service_role;
grant select, insert on public.fund_request_documents to service_role;
grant select, insert on public.project_cash_ledger to service_role;
grant usage, select on sequence public.fund_request_code_seq to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cashier-fund-evidence','cashier-fund-evidence',false,10485760,array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set public=false, file_size_limit=10485760, allowed_mime_types=array['application/pdf','image/jpeg','image/png'];

create or replace function public.create_fund_request_with_audit(p_actor_user_id uuid,p_project_id uuid,p_request_amount numeric,p_purpose text)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_id uuid; v_code text; v_project_name text;
begin
 if p_actor_user_id is null or p_project_id is null or p_request_amount is null or p_request_amount<=0 then raise exception 'Invalid fund request'; end if;
 if length(btrim(coalesce(p_purpose,''))) not between 1 and 1000 then raise exception 'Invalid purpose'; end if;
 select name into v_project_name from public.projects where id=p_project_id and is_active=true;
 if v_project_name is null then raise exception 'Project is not active'; end if;
 insert into public.fund_requests(project_id,request_amount,purpose,requested_by) values(p_project_id,p_request_amount,btrim(p_purpose),p_actor_user_id) returning id,code into v_id,v_code;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
 values(p_actor_user_id,'fund_request.created','fund_request',v_id::text,jsonb_build_object('code',v_code,'project_id',p_project_id,'project_name',v_project_name,'request_amount',p_request_amount,'purpose',btrim(p_purpose)));
 return v_id;
end; $$;

create or replace function public.register_fund_request_document_with_audit(p_fund_request_id uuid,p_actor_user_id uuid,p_storage_path text,p_file_name text,p_mime_type text,p_file_size bigint)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_id uuid; v_code text; v_status text;
begin
 select code,status into v_code,v_status from public.fund_requests where id=p_fund_request_id for update;
 if v_code is null then raise exception 'Fund request not found'; end if;
 if v_status<>'Menunggu Eksekusi' then raise exception 'Evidence upload is closed'; end if;
 if p_mime_type not in ('application/pdf','image/jpeg','image/png') or p_file_size<=0 or p_file_size>10485760 then raise exception 'Invalid file'; end if;
 insert into public.fund_request_documents(fund_request_id,storage_path,file_name,mime_type,file_size,uploaded_by)
 values(p_fund_request_id,p_storage_path,left(p_file_name,255),p_mime_type,p_file_size,p_actor_user_id) returning id into v_id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
 values(p_actor_user_id,'fund_request_document.uploaded','fund_request_document',v_id::text,jsonb_build_object('fund_request_id',p_fund_request_id,'fund_request_code',v_code,'file_name',left(p_file_name,255),'mime_type',p_mime_type,'file_size',p_file_size));
 return v_id;
end; $$;

create or replace function public.execute_fund_request_with_audit(p_fund_request_id uuid,p_actor_user_id uuid,p_executed_amount numeric,p_payment_method text,p_execution_note text default null)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_request public.fund_requests%rowtype; v_project_name text;
begin
 select * into v_request from public.fund_requests where id=p_fund_request_id for update;
 if not found then raise exception 'Fund request not found'; end if;
 if v_request.status<>'Menunggu Eksekusi' then raise exception 'Fund request already executed'; end if;
 if p_executed_amount is null or p_executed_amount<v_request.request_amount then raise exception 'Executed amount cannot be less than requested amount'; end if;
 if p_payment_method not in ('Tunai','Transfer') then raise exception 'Invalid payment method'; end if;
 if length(coalesce(p_execution_note,''))>500 then raise exception 'Execution note too long'; end if;
 select name into v_project_name from public.projects where id=v_request.project_id;
 update public.fund_requests set status='Selesai',executed_amount=p_executed_amount,payment_method=p_payment_method,execution_note=nullif(btrim(p_execution_note),''),executed_at=now(),executed_by=p_actor_user_id,updated_at=now() where id=p_fund_request_id;
 insert into public.project_cash_ledger(project_id,fund_request_id,amount,description,created_by) values(v_request.project_id,p_fund_request_id,p_executed_amount,'Penambahan saldo dari '||v_request.code,p_actor_user_id);
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data)
 values(p_actor_user_id,'fund_request.executed','fund_request',p_fund_request_id::text,
 jsonb_build_object('status',v_request.status,'request_amount',v_request.request_amount),
 jsonb_build_object('code',v_request.code,'project_id',v_request.project_id,'project_name',v_project_name,'request_amount',v_request.request_amount,'executed_amount',p_executed_amount,'payment_method',p_payment_method,'execution_note',nullif(btrim(p_execution_note),''),'executed_at',now()));
end; $$;

revoke all on function public.create_fund_request_with_audit(uuid,uuid,numeric,text) from public,anon,authenticated;
revoke all on function public.register_fund_request_document_with_audit(uuid,uuid,text,text,text,bigint) from public,anon,authenticated;
revoke all on function public.execute_fund_request_with_audit(uuid,uuid,numeric,text,text) from public,anon,authenticated;
grant execute on function public.create_fund_request_with_audit(uuid,uuid,numeric,text) to service_role;
grant execute on function public.register_fund_request_document_with_audit(uuid,uuid,text,text,text,bigint) to service_role;
grant execute on function public.execute_fund_request_with_audit(uuid,uuid,numeric,text,text) to service_role;
