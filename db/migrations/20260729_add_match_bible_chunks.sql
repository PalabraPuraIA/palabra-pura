-- Additive sync from Supabase (2026-07-29)
-- Does NOT drop or truncate existing data.

CREATE OR REPLACE FUNCTION public.match_bible_chunks(
  query_embedding public.halfvec,
  match_count integer DEFAULT 5
)
RETURNS TABLE(
  id integer,
  book_id integer,
  chapter integer,
  start_verse bigint,
  end_verse integer,
  chunk_text text,
  parent_id integer,
  distance double precision
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  select c.id, c.book_id, c.chapter, c.start_verse, c.end_verse,
         c.chunk_text, c.parent_id,
         (c.embedding <=> query_embedding) as distance
  from public.bible_chunks c
  where c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- Optional public read on books (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'books' AND policyname = 'lectura publica books'
  ) THEN
    CREATE POLICY "lectura publica books" ON public.books FOR SELECT USING (true);
  END IF;
END $$;
