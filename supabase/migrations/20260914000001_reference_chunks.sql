-- The CBIC reference corpus as a searchable knowledge base.
--
-- data/customs-corpus holds every Customs notification, circular, instruction,
-- order, regulation section, rule and form CBIC publishes on
-- taxinformation.cbic.gov.in (fetch-corpus.py). packages/library extracts their
-- page text and embeds it here with OpenAI text-embedding-3-small, so that a
-- question ("IGCR condition 3", "read notification 50/2017") comes back with
-- the page it is answered on.
--
-- This is global reference data, not tenant data: there is no company_id. Any
-- signed-in user may read it; only the service role (the indexer) writes.
--
-- The embedding is stored as halfvec (float16). text-embedding-3-small's
-- vectors lose nothing measurable at half precision for cosine ranking, and it
-- halves the table and the HNSW index -- which matters at ~100k chunks on a
-- small instance.

create extension if not exists vector with schema extensions;

create table public.reference_chunks (
  id           bigint generated always as identity primary key,

  -- Which CBIC table the document came from, and its id there. Together with
  -- page and chunk_no this is the natural key the indexer upserts on.
  source_type  text not null
               check (source_type in ('notification', 'circular', 'instruction',
                                      'order', 'regulation', 'rule', 'form')),
  source_id    bigint not null,

  -- As CBIC prints it ("72/2026-Customs (N.T.)"), and normalised ("72/2026")
  -- for exact lookups, since the same number is written a dozen ways.
  number       text,
  number_key   text,
  doc_date     date,
  category     text,
  title        text not null,
  source_url   text,

  page         integer not null,
  chunk_no     integer not null,
  text         text not null,
  -- md5 of text: an unchanged chunk is not re-embedded on a re-run.
  text_hash    text not null,

  -- Omitted (rescinded) or superseded documents stay searchable, but search
  -- can prefer current law.
  is_current   boolean not null default true,
  is_amended   boolean not null default false,

  embedding    extensions.halfvec(1536) not null,
  indexed_at   timestamptz not null default now(),

  unique (source_type, source_id, page, chunk_no)
);

create index reference_chunks_embedding_idx
  on public.reference_chunks
  using hnsw (embedding extensions.halfvec_cosine_ops);

create index reference_chunks_number_idx
  on public.reference_chunks (source_type, number);

create index reference_chunks_number_key_idx
  on public.reference_chunks (number_key)
  where number_key is not null;

-- ------------------------------------------------------- grants and RLS ----

alter table public.reference_chunks enable row level security;
revoke all on public.reference_chunks from anon, authenticated;
grant select, insert, update, delete on public.reference_chunks to service_role;
grant usage, select on sequence public.reference_chunks_id_seq to service_role;
grant select on public.reference_chunks to authenticated;

create policy reference_chunks_select on public.reference_chunks
  for select to authenticated
  using (true);

-- ------------------------------------------------------------- search ----

-- Nearest chunks by cosine similarity. security invoker, so RLS applies: the
-- caller must be authenticated (or the service role).
create or replace function public.match_reference_chunks(
  query_embedding extensions.halfvec(1536),
  match_count     integer default 8,
  source_types    text[] default null,
  only_current    boolean default false
)
returns table (
  id          bigint,
  source_type text,
  source_id   bigint,
  number      text,
  doc_date    date,
  category    text,
  title       text,
  source_url  text,
  page        integer,
  chunk_no    integer,
  text        text,
  is_current  boolean,
  similarity  double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select c.id, c.source_type, c.source_id, c.number, c.doc_date, c.category,
         c.title, c.source_url, c.page, c.chunk_no, c.text, c.is_current,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.reference_chunks c
  where (source_types is null or c.source_type = any (source_types))
    and (not only_current or c.is_current)
  order by c.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 100);
$$;

revoke all on function public.match_reference_chunks(extensions.halfvec, integer, text[], boolean) from public, anon;
grant execute on function public.match_reference_chunks(extensions.halfvec, integer, text[], boolean)
  to authenticated, service_role;

-- What the indexer checks before it spends: rows per type and the database's
-- size, so a run can stop short of the plan's disk limit. Service role only.
create or replace function public.reference_chunks_stats()
returns table (source_type text, chunks bigint, documents bigint, database_bytes bigint)
language sql
stable
security definer
set search_path = public
as $$
  select t.source_type, t.chunks, t.documents, pg_database_size(current_database())
  from (
    select source_type, count(*) as chunks, count(distinct source_id) as documents
    from public.reference_chunks
    group by source_type
    union all
    select '_all', count(*), count(distinct (source_type, source_id))
    from public.reference_chunks
  ) t;
$$;

revoke all on function public.reference_chunks_stats() from public, anon, authenticated;
grant execute on function public.reference_chunks_stats() to service_role;
