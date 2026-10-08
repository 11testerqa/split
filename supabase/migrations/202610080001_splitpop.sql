-- SplitPop 2.0: authenticated, transactional collaboration. No service key in the browser.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists splitpop_private;
revoke all on schema splitpop_private from public;

create table public.rooms (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 name text not null check(length(name) between 1 and 100), mode text not null check(mode in ('own','equal','group','travel')),
 currency text not null, destination text not null default '', start_date date, end_date date,
 locked boolean not null default false, expires_at timestamptz not null default now()+interval '30 days',
 created_at timestamptz not null default now(), check(end_date is null or start_date is null or end_date>=start_date)
);
create table public.room_members (
 room_id uuid not null references public.rooms(id) on delete cascade, user_id uuid not null references auth.users(id),
 display_name text not null check(length(display_name) between 1 and 60), joined_at timestamptz not null default now(),
 active boolean not null default true, primary key(room_id,user_id)
);
create table splitpop_private.invitations (
 room_id uuid primary key references public.rooms(id) on delete cascade, token_hash text unique not null,
 expires_at timestamptz not null
);
create table public.expenses (
 id uuid primary key, room_id uuid not null references public.rooms(id) on delete cascade,
 author_id uuid not null references auth.users(id), revision integer not null default 1,
 state text not null check(state in ('claiming','finalized','deleted')),
 document jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(room_id,id)
);
create table public.expense_items (
 id uuid primary key, room_id uuid not null, expense_id uuid not null,
 description text not null, quantity integer not null check(quantity>0), unit_price bigint not null check(unit_price>=0),
 source jsonb not null default '{}', foreign key(room_id,expense_id) references public.expenses(room_id,id) on delete cascade
);
create table public.item_claims (
 room_id uuid not null, item_id uuid not null references public.expense_items(id) on delete cascade,
 user_id uuid not null, weight numeric not null check(weight>=0 and weight<=1000000), revision integer not null default 1,
 primary key(item_id,user_id), foreign key(room_id,user_id) references public.room_members(room_id,user_id)
);
create table public.expense_allocations (
 room_id uuid not null, expense_id uuid not null, user_id uuid not null, amount bigint not null check(amount>=0),
 primary key(expense_id,user_id), foreign key(room_id,expense_id) references public.expenses(room_id,id),
 foreign key(room_id,user_id) references public.room_members(room_id,user_id)
);
create table public.payer_contributions (
 room_id uuid not null, expense_id uuid not null, user_id uuid not null, amount bigint not null check(amount>=0),
 primary key(expense_id,user_id), foreign key(room_id,expense_id) references public.expenses(room_id,id),
 foreign key(room_id,user_id) references public.room_members(room_id,user_id)
);
create table public.payment_confirmations (
 id uuid primary key, room_id uuid not null references public.rooms(id), debtor_id uuid not null, recipient_id uuid not null,
 amount bigint not null check(amount>0 and amount<=9007199254740991),
 status text not null check(status in ('outstanding','sent','confirmed','rejected','cancelled')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(room_id,debtor_id) references public.room_members(room_id,user_id),
 foreign key(room_id,recipient_id) references public.room_members(room_id,user_id), check(debtor_id<>recipient_id)
);
create table public.activity_events (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id),
 actor_id uuid not null references auth.users(id), kind text not null, entity_id uuid, detail jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(),room_id uuid not null references public.rooms(id),
 user_id uuid not null references auth.users(id), event_id uuid not null references public.activity_events(id), read_at timestamptz,
 unique(user_id,event_id)
);
create index events_room_time on public.activity_events(room_id,created_at desc);
create index expenses_room on public.expenses(room_id);
create index notifications_user on public.notifications(user_id,read_at);

create function splitpop_private.member(p_room uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.room_members where room_id=p_room and user_id=auth.uid() and active);
$$;
create function splitpop_private.require_room(p_room uuid, p_owner boolean default false, p_writable boolean default true)
 returns public.rooms language plpgsql security definer set search_path='' as $$
declare r public.rooms;
begin
 select * into r from public.rooms where id=p_room for update;
 if r.id is null or not splitpop_private.member(p_room) then raise exception 'Room access denied'; end if;
 if p_owner and r.owner_id<>auth.uid() then raise exception 'Owner permission required'; end if;
 if p_writable and (r.locked or r.expires_at<=now()) then raise exception 'Room is locked or expired'; end if;
 return r;
end $$;
create function splitpop_private.precision(p_currency text) returns integer language plpgsql immutable set search_path='' as $$
begin
 if p_currency in ('MYR','USD','EUR','GBP','SGD','THB') then return 2;
 elsif p_currency in ('JPY','KRW') then return 0; elsif p_currency='KWD' then return 3;
 else raise exception 'Unsupported currency'; end if;
end $$;
create function splitpop_private.minor(p_value text,p_currency text) returns bigint language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
 if p_value is null or length(p_value)>40 or p_value !~ '^\d+(\.\d+)?$' then raise exception 'Invalid money'; end if;
 n:=p_value::numeric*power(10::numeric,splitpop_private.precision(p_currency));
 if n<>trunc(n) or n>9007199254740991 then raise exception 'Invalid money precision or amount'; end if;
 return n::bigint;
end $$;
create function splitpop_private.distribute(p_total bigint,p_weights jsonb,p_order jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb; total_weight numeric; entries integer;
begin
 if p_total<0 or p_total>9007199254740991 then raise exception 'Invalid allocation amount';end if;
 if jsonb_typeof(p_weights)<>'object' or jsonb_typeof(p_order)<>'array' then raise exception 'Invalid weights';end if;
 select count(*),sum(value::numeric) into entries,total_weight from jsonb_each_text(p_weights);
 if entries=0 or total_weight<=0 or entries<>jsonb_array_length(p_order) or exists(select 1 from jsonb_each_text(p_weights) where value !~ '^\d+(\.\d+)?$' or value::numeric<0) then raise exception 'Invalid weights';end if;
 if (select count(distinct value) from jsonb_array_elements_text(p_order))<>entries or exists(select 1 from jsonb_array_elements_text(p_order) p where not p_weights ? p.value) then raise exception 'Invalid participant order';end if;
 with exact as (
 select p.value as person,p.ordinality as position,p_total*(p_weights->>p.value)::numeric/total_weight as amount
 from jsonb_array_elements_text(p_order) with ordinality p(value,ordinality)
 ), ranked as (
 select *,row_number() over(order by amount-floor(amount) desc,position) as rank,p_total-sum(floor(amount)) over() as remainder from exact
 ) select jsonb_object_agg(person,to_jsonb((floor(amount)+case when rank<=remainder then 1 else 0 end)::bigint)) into result from ranked;
 return result;
end $$;
create function splitpop_private.add_shares(a jsonb,b jsonb,sign integer default 1) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,to_jsonb(coalesce((a->>key)::bigint,0)+sign*coalesce((b->>key)::bigint,0))),'{}')
 from (select jsonb_object_keys(a) as key union select jsonb_object_keys(b)) keys;
$$;
create function splitpop_private.compute(p_room uuid,p_doc jsonb,p_own boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.rooms; c text; base_precision integer; participants jsonb; weights jsonb; shares jsonb:='{}';
 item jsonb; charge jsonb; contribution jsonb; amount bigint; total bigint; base_total bigint; charge_people jsonb; part text;
 calculated jsonb; payments jsonb:='{}'; rate numeric; method text; converted jsonb;
begin
 select * into r from public.rooms where id=p_room;
 if jsonb_typeof(p_doc) is distinct from 'object' or jsonb_typeof(p_doc->'title') is distinct from 'string' or length(trim(p_doc->>'title')) not between 1 and 200 or jsonb_typeof(p_doc->'date') is distinct from 'string' or jsonb_typeof(p_doc->'amount') is distinct from 'number' or jsonb_typeof(p_doc->'baseAmount') is distinct from 'number' or jsonb_typeof(p_doc->'participantIds') is distinct from 'array' or jsonb_typeof(p_doc->'items') is distinct from 'array' or jsonb_typeof(p_doc->'charges') is distinct from 'array' or jsonb_typeof(p_doc->'payments') is distinct from 'array' then raise exception 'Malformed expense document';end if;
 perform (p_doc->>'date')::date;
 if (p_doc ? 'category' and jsonb_typeof(p_doc->'category') is distinct from 'string') or (p_doc ? 'notes' and jsonb_typeof(p_doc->'notes') is distinct from 'string') then raise exception 'Invalid expense metadata';end if;
 c:=p_doc->>'currency';perform splitpop_private.precision(c);base_precision:=splitpop_private.precision(r.currency);
 participants:=p_doc->'participantIds';
 if jsonb_typeof(participants)<>'array' or jsonb_array_length(participants)=0 or
 (select count(distinct value) from jsonb_array_elements_text(participants))<>jsonb_array_length(participants) then raise exception 'Select valid participants';end if;
 for part in select jsonb_array_elements_text(participants) loop
 if not exists(select 1 from public.room_members where room_id=p_room and user_id=part::uuid and active) then raise exception 'Unknown participant';end if;
 shares:=shares||jsonb_build_object(part,0);
 end loop;
 for item in select value from jsonb_array_elements(p_doc->'items') loop
 if jsonb_typeof(item->'name') is distinct from 'string' or jsonb_typeof(item->'quantity') is distinct from 'number' or jsonb_typeof(item->'price') is distinct from 'string' or jsonb_typeof(item->'assignments') is distinct from 'array' or (item ? 'notes' and jsonb_typeof(item->'notes') is distinct from 'string') then raise exception 'Malformed item';end if;
 end loop;
 if p_own then
 if jsonb_array_length(p_doc->'items')=0 then raise exception 'No items';end if;
 for item in select value from jsonb_array_elements(p_doc->'items') loop
 if jsonb_typeof(item->'name') is distinct from 'string' or jsonb_typeof(item->'quantity') is distinct from 'number' or jsonb_typeof(item->'price') is distinct from 'string' or jsonb_typeof(item->'assignments') is distinct from 'array' or length(trim(item->>'name'))=0 or (item->>'quantity')::numeric<>trunc((item->>'quantity')::numeric) or (item->>'quantity')::integer<1 then raise exception 'Invalid item';end if;
 amount:=splitpop_private.minor(item->>'price',c)*(item->>'quantity')::integer;
 select jsonb_object_agg(value->>'personId',value->>'weight'),jsonb_agg(value->>'personId') into weights,charge_people from jsonb_array_elements(item->'assignments');
 if weights is null or (select count(distinct value->>'personId') from jsonb_array_elements(item->'assignments'))<>jsonb_array_length(item->'assignments') then raise exception 'Unallocated or duplicate item claims';end if;
 if exists(select 1 from jsonb_array_elements_text(charge_people) where not participants ? value) then raise exception 'Unknown item participant';end if;
 shares:=splitpop_private.add_shares(shares,splitpop_private.distribute(amount,weights,charge_people));
 end loop;
 else
 amount:=splitpop_private.minor(p_doc->>'inputAmount',c);method:=p_doc->'split'->>'method';
 weights:='{}';for part in select jsonb_array_elements_text(participants) loop
 if method<>'equal' and coalesce(p_doc->'split'->'values'->>part,'0') !~ '^\d+(\.\d+)?$' then raise exception 'Invalid split value';end if;
 weights:=weights||jsonb_build_object(part,case when method='equal' then '1' else coalesce(p_doc->'split'->'values'->>part,'0') end);
 end loop;
 if method='exact' then
 for part in select jsonb_array_elements_text(participants) loop shares:=shares||jsonb_build_object(part,splitpop_private.minor(weights->>part,c));end loop;
 if (select sum(value::bigint) from jsonb_each_text(shares))<>amount then raise exception 'Exact allocations do not balance';end if;
 elsif method in ('equal','weight','percent') then
 if method='percent' and (select sum(value::numeric) from jsonb_each_text(weights))<>100 then raise exception 'Percentages must total 100';end if;
 shares:=splitpop_private.distribute(amount,weights,participants);
 else raise exception 'Unsupported split method';end if;
 end if;
 for charge in select value from jsonb_array_elements(coalesce(p_doc->'charges','[]')) loop
 if jsonb_typeof(charge->'discount') is distinct from 'boolean' or jsonb_typeof(charge->'name') is distinct from 'string' or jsonb_typeof(charge->'value') is distinct from 'string' or charge->>'allocation' not in ('proportional','equal','selected') then raise exception 'Malformed charge';end if;
 select sum(value::bigint) into total from jsonb_each_text(shares);
 if charge->>'kind'='fixed' then amount:=splitpop_private.minor(charge->>'value',c);
 elsif charge->>'kind'='percent' and charge->>'value' ~ '^\d+(\.\d+)?$' then amount:=round(total*(charge->>'value')::numeric/100);
 else raise exception 'Invalid charge';end if;
 charge_people:=case when charge->>'allocation'='selected' then charge->'participants' else participants end;
 weights:='{}';for part in select jsonb_array_elements_text(charge_people) loop
 if not participants ? part then raise exception 'Invalid charge participant';end if;
 weights:=weights||jsonb_build_object(part,case when charge->>'allocation'='proportional' or (charge->>'discount')::boolean then shares->>part else '1' end);
 end loop;
 if (select sum(value::numeric) from jsonb_each_text(weights))=0 then for part in select jsonb_array_elements_text(charge_people) loop weights:=weights||jsonb_build_object(part,'1');end loop;end if;
 shares:=splitpop_private.add_shares(shares,splitpop_private.distribute(amount,weights,charge_people),case when (charge->>'discount')::boolean then -1 else 1 end);
 if exists(select 1 from jsonb_each_text(shares) where value::bigint<0) then raise exception 'Discount exceeds share';end if;
 end loop;
 select sum(value::bigint) into total from jsonb_each_text(shares);
 if total<=0 or total>9007199254740991 then raise exception 'Invalid total';end if;
 base_total:=total;
 if c<>r.currency then
 if r.mode<>'travel' or p_doc->'exchange'->>'originalCurrency'<>c or p_doc->'exchange'->>'baseCurrency'<>r.currency or
 p_doc->'exchange'->>'rate' is null or p_doc->'exchange'->>'rate' !~ '^\d+(\.\d+)?$' or (p_doc->'exchange'->>'rate')::numeric<=0 then raise exception 'Invalid manual exchange rate';end if;
 perform (p_doc->'exchange'->>'capturedAt')::timestamptz;
 rate:=(p_doc->'exchange'->>'rate')::numeric;
 base_total:=round(total/power(10::numeric,splitpop_private.precision(c))*rate*power(10::numeric,base_precision));
 shares:=splitpop_private.distribute(base_total,shares,participants);
 end if;
 if p_doc->'allocations' is not null and shares<>p_doc->'allocations' then raise exception 'Allocations differ from server calculation';end if;
 if (p_doc->>'amount')::bigint is distinct from total or (p_doc->>'baseAmount')::bigint is distinct from base_total then raise exception 'Totals differ from server calculation';end if;
 for contribution in select value from jsonb_array_elements(p_doc->'payments') loop
 if jsonb_typeof(contribution->'amount') is distinct from 'number' then raise exception 'Invalid contribution amount';end if;
 part:=contribution->>'personId';amount:=(contribution->>'amount')::bigint;
 if amount<0 or amount>9007199254740991 or payments ? part or not exists(select 1 from public.room_members where room_id=p_room and user_id=part::uuid and active) then raise exception 'Invalid payer contribution';end if;
 payments:=payments||jsonb_build_object(part,amount);
 end loop;
 if (select sum(value::bigint) from jsonb_each_text(payments)) is distinct from base_total then raise exception 'Expense must be fully funded';end if;
 return p_doc||jsonb_build_object('allocations',shares,'amount',total,'baseAmount',base_total);
end $$;
create function splitpop_private.event(p_room uuid,p_kind text,p_entity uuid default null,p_detail jsonb default '{}') returns void language plpgsql security definer set search_path='' as $$
declare event_id uuid;
begin
 insert into public.activity_events(room_id,actor_id,kind,entity_id,detail) values(p_room,auth.uid(),p_kind,p_entity,p_detail) returning id into event_id;
 insert into public.notifications(room_id,user_id,event_id) select p_room,user_id,event_id from public.room_members where room_id=p_room and active and user_id<>auth.uid();
end $$;
create function public.create_room(p_name text,p_display_name text,p_mode text default 'own',p_currency text default 'MYR',p_destination text default '',p_start date default null,p_end date default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid;token text;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 perform splitpop_private.precision(p_currency);
 insert into public.rooms(owner_id,name,mode,currency,destination,start_date,end_date) values(auth.uid(),trim(p_name),p_mode,p_currency,p_destination,p_start,p_end) returning id into rid;
 insert into public.room_members(room_id,user_id,display_name) values(rid,auth.uid(),trim(p_display_name));
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into splitpop_private.invitations values(rid,encode(extensions.digest(token,'sha256'),'hex'),now()+interval '7 days');
 perform splitpop_private.event(rid,'room_created',rid);
 return jsonb_build_object('roomId',rid,'token',token,'expiresAt',now()+interval '7 days');
end $$;
create function public.join_room(p_token text,p_display_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid; r public.rooms; already boolean;
begin
 if auth.uid() is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation';end if;
 select room_id into rid from splitpop_private.invitations where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and expires_at>now();
 select * into r from public.rooms where id=rid for update;
 if rid is null or r.expires_at<=now() or r.locked then raise exception 'Invitation is expired or unavailable';end if;
 if exists(select 1 from public.room_members where room_id=rid and user_id=auth.uid() and not active) then raise exception 'Membership revoked';end if;
 select exists(select 1 from public.room_members where room_id=rid and user_id=auth.uid()) into already;
 if not already then
 insert into public.room_members(room_id,user_id,display_name) values(rid,auth.uid(),trim(p_display_name));
 perform splitpop_private.event(rid,'member_joined',auth.uid());
 end if;
 return rid;
end $$;
create function public.rotate_invitation(p_room uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.rooms;token text;
begin
 r:=splitpop_private.require_room(p_room,true);token:=encode(extensions.gen_random_bytes(32),'hex');
 update splitpop_private.invitations set token_hash=encode(extensions.digest(token,'sha256'),'hex'),expires_at=now()+interval '7 days' where room_id=p_room;
 return jsonb_build_object('roomId',p_room,'token',token,'expiresAt',now()+interval '7 days');
end $$;
create function public.set_room_access(p_room uuid,p_user uuid,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
declare r public.rooms;
begin
 r:=splitpop_private.require_room(p_room,true);
 if p_user=r.owner_id then raise exception 'Owner cannot be removed';end if;
 if not p_active then update public.item_claims set weight=0,revision=revision+1 where room_id=p_room and user_id=p_user;end if;
 update public.room_members set active=p_active where room_id=p_room and user_id=p_user;
 perform splitpop_private.event(p_room,'membership_changed',p_user);
end $$;
create function splitpop_private.persist_expense(p_room uuid,p_document jsonb,p_revision integer,p_state text) returns uuid language plpgsql security definer set search_path='' as $$
declare eid uuid; existing public.expenses;item jsonb;pair record;
begin
 if p_revision is null or p_revision<0 then raise exception 'Expense revision required';end if;
 eid:=(p_document->>'id')::uuid;
 if coalesce((select sum((document->>'baseAmount')::numeric) from public.expenses where room_id=p_room and id<>eid and state<>'deleted'),0)+(p_document->>'baseAmount')::numeric>9007199254740991 then raise exception 'Room total exceeds supported safe amount';end if;
 select * into existing from public.expenses where id=eid for update;
 if existing.id is not null then
 if p_revision=0 and existing.revision=1 and existing.room_id=p_room and existing.author_id=auth.uid() and existing.state=p_state and (existing.document-'createdAt'-'updatedAt')=(p_document-'createdAt'-'updatedAt') then return eid;end if;
 if existing.room_id<>p_room or existing.state='deleted' or existing.revision<>p_revision or (existing.author_id<>auth.uid() and (select owner_id from public.rooms where id=p_room)<>auth.uid()) then raise exception 'Stale expense or unauthorized edit';end if;
 delete from public.expense_allocations where expense_id=eid;delete from public.payer_contributions where expense_id=eid;delete from public.expense_items where expense_id=eid;
 update public.expenses set document=p_document,revision=revision+1,state=p_state,updated_at=now() where id=eid;
 else
 if p_revision<>0 then raise exception 'Expense revision conflict';end if;
 insert into public.expenses(id,room_id,author_id,state,document) values(eid,p_room,auth.uid(),p_state,p_document);
 end if;
 for item in select value from jsonb_array_elements(coalesce(p_document->'items','[]')) loop
 insert into public.expense_items(id,room_id,expense_id,description,quantity,unit_price,source) values((item->>'id')::uuid,p_room,eid,item->>'name',(item->>'quantity')::integer,splitpop_private.minor(item->>'price',p_document->>'currency'),item);
 end loop;
 if p_state='finalized' then
 for pair in select key,value from jsonb_each_text(p_document->'allocations') loop insert into public.expense_allocations values(p_room,eid,pair.key::uuid,pair.value::bigint);end loop;
 for item in select value from jsonb_array_elements(p_document->'payments') loop insert into public.payer_contributions values(p_room,eid,(item->>'personId')::uuid,(item->>'amount')::bigint);end loop;
 end if;
 perform splitpop_private.ensure_balance_bounds(p_room);
 perform splitpop_private.event(p_room,case when existing.id is null then 'expense_added' else 'expense_edited' end,eid,jsonb_build_object('before',existing.document,'after',p_document));
 return eid;
end $$;
create function public.save_shared_expense(p_room uuid,p_document jsonb,p_revision integer default 0) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.rooms;doc jsonb;
begin
 r:=splitpop_private.require_room(p_room);
 if p_revision is null or p_revision<0 then raise exception 'Expense revision required';end if;
 if r.mode='own' then raise exception 'Use the claim and finalize workflow';end if;
 if length(trim(p_document->>'title')) not between 1 and 200 then raise exception 'Expense title required';end if;
 perform (p_document->>'date')::date;
 doc:=splitpop_private.compute(p_room,p_document,false);
 return splitpop_private.persist_expense(p_room,doc,p_revision,'finalized');
end $$;
create function public.publish_receipt(p_room uuid,p_document jsonb,p_reviewed boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.rooms;doc jsonb;items jsonb;parts jsonb;dummy_payments jsonb;computed jsonb;eid uuid;
begin
 r:=splitpop_private.require_room(p_room,true);
 if r.mode<>'own' or p_reviewed is distinct from true then raise exception 'Owner receipt review is required';end if;
 select jsonb_agg(user_id::text order by joined_at,user_id) into parts from public.room_members where room_id=p_room and active;
 select jsonb_agg(value||jsonb_build_object('assignments',jsonb_build_array(jsonb_build_object('personId',r.owner_id,'weight','1')))) into items from jsonb_array_elements(p_document->'items');
 -- Validate the receipt using temporary owner allocation, never saving this as a claim.
 doc:=p_document||jsonb_build_object('participantIds',parts,'items',items,'payments',jsonb_build_array(jsonb_build_object('personId',r.owner_id,'amount',(p_document->>'baseAmount')::bigint)));
 doc:=doc-'allocations';computed:=splitpop_private.compute(p_room,doc,true);
 if splitpop_private.minor(p_document->>'printedTotal',r.currency)<>(computed->>'amount')::bigint then raise exception 'Receipt total mismatch';end if;
 doc:=p_document||jsonb_build_object('allocations','{}'::jsonb,'payments','[]'::jsonb,'participantIds',parts);
 eid:=splitpop_private.persist_expense(p_room,doc,0,'claiming');
 if not exists(select 1 from public.activity_events where room_id=p_room and entity_id=eid and kind='receipt_ready') then perform splitpop_private.event(p_room,'receipt_ready',eid);end if;
 return eid;
end $$;
create function public.set_item_claim(p_room uuid,p_item uuid,p_user uuid,p_weight numeric,p_revision integer default 0) returns void language plpgsql security definer set search_path='' as $$
declare r public.rooms;current_revision integer;ex public.expenses;
begin
 r:=splitpop_private.require_room(p_room);
 if p_revision is null or p_revision<0 then raise exception 'Claim revision required';end if;
 if p_user<>auth.uid() and auth.uid()<>r.owner_id then raise exception 'Only your own claim may be changed';end if;
 if not exists(select 1 from public.room_members where room_id=p_room and user_id=p_user and active) then raise exception 'Unknown participant';end if;
 select e.* into ex from public.expenses e join public.expense_items i on i.expense_id=e.id where i.id=p_item and i.room_id=p_room;
 if ex.id is null or ex.state<>'claiming' then raise exception 'Item is unavailable or finalized';end if;
 select revision into current_revision from public.item_claims where item_id=p_item and user_id=p_user;
 if coalesce(current_revision,0)<>p_revision then raise exception 'Claim changed. Refresh and try again';end if;
 if p_weight is null or p_weight<0 or p_weight>1000000 then raise exception 'Invalid claim weight';end if;
 if p_weight=0 then update public.item_claims set weight=0,revision=revision+1 where item_id=p_item and user_id=p_user;
 else insert into public.item_claims values(p_room,p_item,p_user,p_weight,1) on conflict(item_id,user_id) do update set weight=excluded.weight,revision=public.item_claims.revision+1;end if;
 perform splitpop_private.event(p_room,'item_claim_changed',p_item);
end $$;
create function public.finalize_receipt(p_room uuid,p_expense uuid,p_revision integer,p_payments jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r public.rooms;ex public.expenses;items jsonb;parts jsonb;doc jsonb;pair record;contribution jsonb;
begin
 r:=splitpop_private.require_room(p_room,true);
 if p_revision is null or p_revision<1 then raise exception 'Receipt revision required';end if;
 select * into ex from public.expenses where id=p_expense and room_id=p_room for update;
 if ex.state='finalized' and ex.revision=p_revision+1 and ex.document->'payments'=p_payments then return;end if;
 if ex.state is distinct from 'claiming' or ex.revision<>p_revision then raise exception 'Receipt is unavailable or changed';end if;
 select jsonb_agg(user_id::text order by joined_at,user_id) into parts from public.room_members where room_id=p_room and active;
 select jsonb_agg(i.source||jsonb_build_object('assignments',coalesce((select jsonb_agg(jsonb_build_object('personId',c.user_id,'weight',c.weight::text) order by m.joined_at,c.user_id) from public.item_claims c join public.room_members m on m.room_id=c.room_id and m.user_id=c.user_id where c.item_id=i.id and c.weight>0),'[]'))) into items from public.expense_items i where expense_id=p_expense;
 doc:=ex.document||jsonb_build_object('items',items,'participantIds',parts,'payments',p_payments);doc:=doc-'allocations';
 doc:=splitpop_private.compute(p_room,doc,true);
 update public.expenses set document=doc,state='finalized',revision=revision+1,updated_at=now() where id=p_expense;
 for pair in select key,value from jsonb_each_text(doc->'allocations') loop insert into public.expense_allocations values(p_room,p_expense,pair.key::uuid,pair.value::bigint);end loop;
 for contribution in select value from jsonb_array_elements(p_payments) loop insert into public.payer_contributions values(p_room,p_expense,(contribution->>'personId')::uuid,(contribution->>'amount')::bigint);end loop;
 perform splitpop_private.ensure_balance_bounds(p_room);
 perform splitpop_private.event(p_room,'receipt_finalized',p_expense);
end $$;
create function splitpop_private.room_balances(p_room uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(user_id,balance),'{}') from (
 select m.user_id,
 coalesce((select sum(p.amount) from public.payer_contributions p join public.expenses e on e.id=p.expense_id where p.room_id=p_room and p.user_id=m.user_id and e.state='finalized'),0)
 -coalesce((select sum(a.amount) from public.expense_allocations a join public.expenses e on e.id=a.expense_id where a.room_id=p_room and a.user_id=m.user_id and e.state='finalized'),0)
 +coalesce((select sum(amount) from public.payment_confirmations where room_id=p_room and debtor_id=m.user_id and status='confirmed'),0)
 -coalesce((select sum(amount) from public.payment_confirmations where room_id=p_room and recipient_id=m.user_id and status='confirmed'),0) as balance
 from public.room_members m where room_id=p_room) balances;
$$;
create function splitpop_private.ensure_balance_bounds(p_room uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from jsonb_each_text(splitpop_private.room_balances(p_room)) where abs(value::numeric)>9007199254740991) then raise exception 'Balance exceeds supported safe amount';end if;
end $$;
create function public.report_payment(p_room uuid,p_id uuid,p_recipient uuid,p_amount bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.rooms;existing public.payment_confirmations;b jsonb;reserved_debt bigint;reserved_credit bigint;
begin
 r:=splitpop_private.require_room(p_room,false,false);
 select * into existing from public.payment_confirmations where id=p_id;
 if existing.id is not null then
 if existing.room_id=p_room and existing.debtor_id=auth.uid() and existing.recipient_id=p_recipient and existing.amount=p_amount then return p_id;end if;
 raise exception 'Payment id conflict';end if;
 b:=splitpop_private.room_balances(p_room);
 select coalesce(sum(amount),0) into reserved_debt from public.payment_confirmations where room_id=p_room and debtor_id=auth.uid() and status in ('outstanding','sent');
 select coalesce(sum(amount),0) into reserved_credit from public.payment_confirmations where room_id=p_room and recipient_id=p_recipient and status in ('outstanding','sent');
 if p_amount<=0 or p_amount>least(-coalesce((b->>auth.uid()::text)::bigint,0)-reserved_debt,coalesce((b->>p_recipient::text)::bigint,0)-reserved_credit) then raise exception 'Amount exceeds outstanding balance or pending payments';end if;
 insert into public.payment_confirmations(id,room_id,debtor_id,recipient_id,amount,status) values(p_id,p_room,auth.uid(),p_recipient,p_amount,'sent');
 perform splitpop_private.event(p_room,'payment_sent',p_id);
 return p_id;
end $$;
create function public.respond_payment(p_room uuid,p_id uuid,p_action text) returns void language plpgsql security definer set search_path='' as $$
declare r public.rooms;p public.payment_confirmations;
begin
 r:=splitpop_private.require_room(p_room,false,false);
 select * into p from public.payment_confirmations where id=p_id and room_id=p_room for update;
 if p.id is null then raise exception 'Payment unavailable';end if;
 if p_action in ('confirmed','rejected') then
 if p.recipient_id<>auth.uid() then raise exception 'Only the recipient can respond';end if;
 if p.status=p_action then return;end if;
 if p.status<>'sent' then raise exception 'Payment cannot be confirmed twice or changed after resolution';end if;
 elsif p_action='cancelled' then
 if p.debtor_id<>auth.uid() or p.status not in ('sent','outstanding') then raise exception 'Only the debtor can cancel a pending payment';end if;
 else raise exception 'Invalid payment action';end if;
 update public.payment_confirmations set status=p_action,updated_at=now() where id=p_id;
 perform splitpop_private.ensure_balance_bounds(p_room);
 perform splitpop_private.event(p_room,'payment_'||p_action,p_id);
 if p_action='confirmed' and not exists(select 1 from jsonb_each_text(splitpop_private.room_balances(p_room)) where value::bigint<>0) then perform splitpop_private.event(p_room,'settlement_completed',p_room);end if;
end $$;
create function public.delete_shared_expense(p_room uuid,p_expense uuid,p_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare r public.rooms;ex public.expenses;
begin
 r:=splitpop_private.require_room(p_room);if p_revision is null or p_revision<1 then raise exception 'Expense revision required';end if;select * into ex from public.expenses where id=p_expense and room_id=p_room for update;
 if ex.id is null or ex.revision<>p_revision or ex.state='deleted' or (ex.author_id<>auth.uid() and r.owner_id<>auth.uid()) then raise exception 'Stale expense or unauthorized deletion';end if;
 update public.expenses set state='deleted',revision=revision+1 where id=p_expense;
 perform splitpop_private.ensure_balance_bounds(p_room);
 perform splitpop_private.event(p_room,'expense_deleted',p_expense,jsonb_build_object('before',ex.document));
end $$;
create function public.lock_room(p_room uuid,p_locked boolean) returns void language plpgsql security definer set search_path='' as $$
declare r public.rooms;
begin
 r:=splitpop_private.require_room(p_room,true,false);
 if p_locked and exists(select 1 from public.expenses where room_id=p_room and state='claiming') then raise exception 'Finish allocating receipts before locking';end if;
 update public.rooms set locked=p_locked where id=p_room;
 perform splitpop_private.event(p_room,'room_lock_changed',p_room);
end $$;
create function public.read_notifications(p_room uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform splitpop_private.require_room(p_room,false,false);
 update public.notifications set read_at=now() where room_id=p_room and user_id=auth.uid() and read_at is null;
end $$;
create function public.room_snapshot(p_room uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not splitpop_private.member(p_room) then raise exception 'Room access denied';end if;
 return jsonb_build_object(
 'room',(select to_jsonb(r) from public.rooms r where id=p_room),
 'members',(select coalesce(jsonb_agg(m order by joined_at,user_id),'[]') from public.room_members m where room_id=p_room),
 'expenses',(select coalesce(jsonb_agg(e order by created_at),'[]') from public.expenses e where room_id=p_room and state<>'deleted'),
 'items',(select coalesce(jsonb_agg(i),'[]') from public.expense_items i join public.expenses e on e.id=i.expense_id where i.room_id=p_room and e.state='claiming'),
 'claims',(select coalesce(jsonb_agg(c),'[]') from public.item_claims c join public.expense_items i on i.id=c.item_id join public.expenses e on e.id=i.expense_id where c.room_id=p_room and e.state='claiming'),
 'payments',(select coalesce(jsonb_agg(p order by created_at),'[]') from public.payment_confirmations p where room_id=p_room),
 'events',(select coalesce(jsonb_agg(ev order by created_at desc),'[]') from (select id,room_id,actor_id,kind,entity_id,created_at from public.activity_events where room_id=p_room order by created_at desc limit 100) ev),
 'notifications',(select coalesce(jsonb_agg(n),'[]') from public.notifications n where room_id=p_room and user_id=auth.uid() and read_at is null),
 'balances',splitpop_private.room_balances(p_room));
end $$;

-- Only member reads and explicitly authorized RPC writes. No client table writes.
do $$ declare t text;begin
 foreach t in array array['rooms','room_members','expenses','expense_items','item_claims','expense_allocations','payer_contributions','payment_confirmations','activity_events','notifications'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 if t='rooms' then execute 'create policy member_read on public.rooms for select to authenticated using (splitpop_private.member(id))';
 elsif t='notifications' then execute 'create policy member_read on public.notifications for select to authenticated using (user_id=auth.uid() and splitpop_private.member(room_id))';
 else execute format('create policy member_read on public.%I for select to authenticated using (splitpop_private.member(room_id))',t);end if;
 end loop;
end $$;
grant usage on schema splitpop_private to authenticated;
grant execute on function splitpop_private.member(uuid) to authenticated;
-- Revoke PostgreSQL's default PUBLIC execution on every new helper and RPC.
do $$ declare f record;begin
 for f in select p.oid::regprocedure as signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('splitpop_private','public') and p.proname in ('member','require_room','precision','minor','distribute','add_shares','compute','event','persist_expense','room_balances','ensure_balance_bounds','create_room','join_room','rotate_invitation','set_room_access','save_shared_expense','publish_receipt','set_item_claim','finalize_receipt','report_payment','respond_payment','delete_shared_expense','lock_room','read_notifications','room_snapshot') loop
 execute format('revoke execute on function %s from public, anon, authenticated',f.signature);
 if f.nspname='public' or f.signature::text='splitpop_private.member(uuid)' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
-- RLS-protected postgres_changes and private presence topics.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
 alter publication supabase_realtime add table public.activity_events;
 end if;
 if to_regclass('realtime.messages') is not null then
 execute 'create policy splitpop_presence_read on realtime.messages for select to authenticated using (extension=''presence'' and split_part(realtime.topic(), '':'',1)=''room'' and splitpop_private.member(nullif(split_part(realtime.topic(), '':'',2),'''')::uuid))';
 execute 'create policy splitpop_presence_write on realtime.messages for insert to authenticated with check (extension=''presence'' and split_part(realtime.topic(), '':'',1)=''room'' and splitpop_private.member(nullif(split_part(realtime.topic(), '':'',2),'''')::uuid))';
 end if;
end $$;
