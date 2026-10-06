BEGIN;

CREATE TABLE IF NOT EXISTS public.ministry_fact (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category text NOT NULL DEFAULT 'general'
    CHECK (category IN (
      'horario', 'persona', 'terminologia', 'lugar', 'contacto',
      'redes', 'evento', 'general'
    )),
  title text NOT NULL,
  content text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  embedding halfvec(3072),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ministry_fact_title_length CHECK (char_length(title) BETWEEN 2 AND 200),
  CONSTRAINT ministry_fact_content_length CHECK (char_length(content) BETWEEN 2 AND 8000)
);

CREATE INDEX IF NOT EXISTS ministry_fact_status_idx ON public.ministry_fact (status);
CREATE INDEX IF NOT EXISTS ministry_fact_category_idx ON public.ministry_fact (category);
CREATE INDEX IF NOT EXISTS ministry_fact_aliases_gin ON public.ministry_fact USING gin (aliases);

CREATE TABLE IF NOT EXISTS public.knowledge_document (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  content text NOT NULL,
  source_name text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  chunk_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_document_title_length CHECK (char_length(title) BETWEEN 2 AND 200),
  CONSTRAINT knowledge_document_content_length CHECK (char_length(content) BETWEEN 2 AND 200000)
);

CREATE TABLE IF NOT EXISTS public.knowledge_doc_chunk (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES public.knowledge_document(id) ON DELETE CASCADE,
  chunk_pos integer NOT NULL,
  content text NOT NULL,
  embedding halfvec(3072) NOT NULL,
  UNIQUE (document_id, chunk_pos)
);

CREATE INDEX IF NOT EXISTS knowledge_doc_chunk_doc_idx
  ON public.knowledge_doc_chunk (document_id);

CREATE TABLE IF NOT EXISTS public.content_offer (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  youtube_id text NOT NULL UNIQUE,
  video_id bigint,
  title text,
  access_mode text NOT NULL DEFAULT 'free'
    CHECK (access_mode IN ('free', 'paid')),
  offer_url text,
  offer_label text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ingest_job (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_type text NOT NULL CHECK (source_type IN ('youtube', 'audio', 'video', 'document')),
  source_url text,
  local_path text,
  title text,
  youtube_id text,
  video_id bigint,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'done', 'error')),
  progress text,
  error text,
  fragments_created integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS ingest_job_status_idx ON public.ingest_job (status);
CREATE INDEX IF NOT EXISTS ingest_job_created_idx ON public.ingest_job (created_at DESC);

CREATE OR REPLACE FUNCTION public.video_fragment_counts()
RETURNS TABLE(video_id bigint, fragments integer)
LANGUAGE sql
STABLE
AS $$
  SELECT video_id, count(*)::int AS fragments
  FROM public.fragment
  GROUP BY video_id;
$$;

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding text,
  match_count integer DEFAULT 5
)
RETURNS TABLE(
  content text,
  document_id bigint,
  title text,
  category text,
  chunk_pos integer,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    c.content,
    d.id AS document_id,
    d.title,
    d.category,
    c.chunk_pos,
    1 - (c.embedding <=> query_embedding::halfvec(3072)) AS similarity
  FROM public.knowledge_doc_chunk c
  JOIN public.knowledge_document d ON d.id = c.document_id
  WHERE d.status = 'active'
  ORDER BY c.embedding <=> query_embedding::halfvec(3072)
  LIMIT match_count;
$$;

ALTER TABLE public.ministry_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_doc_chunk ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_offer ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_job ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ministry_fact' AND policyname = 'service role ministry_fact') THEN
    CREATE POLICY "service role ministry_fact" ON public.ministry_fact FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'knowledge_document' AND policyname = 'service role knowledge_document') THEN
    CREATE POLICY "service role knowledge_document" ON public.knowledge_document FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'knowledge_doc_chunk' AND policyname = 'service role knowledge_doc_chunk') THEN
    CREATE POLICY "service role knowledge_doc_chunk" ON public.knowledge_doc_chunk FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'content_offer' AND policyname = 'service role content_offer') THEN
    CREATE POLICY "service role content_offer" ON public.content_offer FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ingest_job' AND policyname = 'service role ingest_job') THEN
    CREATE POLICY "service role ingest_job" ON public.ingest_job FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ministry_fact' AND policyname = 'anon select ministry_fact') THEN
    CREATE POLICY "anon select ministry_fact" ON public.ministry_fact FOR SELECT TO anon, authenticated USING (status = 'active');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'content_offer' AND policyname = 'anon select content_offer') THEN
    CREATE POLICY "anon select content_offer" ON public.content_offer FOR SELECT TO anon, authenticated USING (true);
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE 'GRANT SELECT ON TABLE public.ministry_fact TO anon, authenticated';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ministry_fact TO service_role';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_document TO service_role';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_doc_chunk TO service_role';
  EXECUTE 'GRANT SELECT ON TABLE public.content_offer TO anon, authenticated';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.content_offer TO service_role';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ingest_job TO service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(text, integer) TO anon, authenticated, service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.video_fragment_counts() TO anon, authenticated, service_role';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ministry_fact TO palabra';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_document TO palabra';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_doc_chunk TO palabra';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.content_offer TO palabra';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ingest_job TO palabra';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
