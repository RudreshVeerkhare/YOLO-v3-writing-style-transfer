-- ============================================================
-- Supabase Database Setup for YOLOv3-Style Paper Gallery
-- Run this in your Supabase SQL editor
-- ============================================================

-- Create the papers table
create table if not exists papers (
  id              uuid primary key default gen_random_uuid(),
  arxiv_id        text not null,
  title           text not null,
  authors         text[] not null default '{}',
  original_abstract text not null default '',
  file_path       text not null,
  public_url      text not null,
  version         integer not null default 1,
  parent_version_id uuid references papers(id),
  contributor_name text,
  contributor_twitter text,
  tags            text[] not null default '{}',
  view_count      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Create indexes for common queries
create index if not exists papers_arxiv_id_idx on papers(arxiv_id);
create index if not exists papers_created_at_idx on papers(created_at desc);
create index if not exists papers_view_count_idx on papers(view_count desc);
create index if not exists papers_tags_idx on papers using gin(tags);

-- Enable Row Level Security
alter table papers enable row level security;

-- Policy: Anyone can read papers (public gallery)
create policy "Anyone can read papers"
  on papers for select
  to public
  using (true);

-- Policy: Anyone can insert papers (anonymous contributions allowed)
-- In production, you might want to require authentication
create policy "Anyone can insert papers"
  on papers for insert
  to public
  with check (true);

-- Policy: Anyone can update view_count (for analytics)
create policy "Anyone can update view count"
  on papers for update
  to public
  using (true)
  with check (true);

-- Create updated_at trigger
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_papers_updated_at
  before update on papers
  for each row
  execute function update_updated_at_column();

-- ============================================================
-- Storage Bucket Setup
-- ============================================================
-- 
-- After running this SQL, go to Storage in Supabase dashboard:
-- 1. Create a new bucket named: yolo-papers
-- 2. Set it as PUBLIC (allows anyone to read files)
-- 3. Set the following policy for uploads:
--
-- For INSERT (upload):
--   - Allow: public (anonymous uploads) OR authenticated only
--   - Expression: true (or auth.role() = 'authenticated' for auth-only)
--
-- For SELECT (download/read):
--   - Allow: public
--   - Expression: true
--
-- For DELETE:
--   - Allow: none (or authenticated with owner check)
--   - Expression: false (or custom logic)
-- ============================================================
