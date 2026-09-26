-- Base de conocimiento: respuestas recurrentes bien valoradas (FAQ cache).
-- Aplicar en Postgres del server Y en Supabase (misma migración).

CREATE TABLE IF NOT EXISTS public.knowledge_entry (
  id bigserial PRIMARY KEY,
  question_norm text NOT NULL,
  question_display text NOT NULL,
  answer text NOT NULL,
  excerpt text,
  source text,
  video_title text,
  video_episode integer,
  video_youtube_id text,
  video_start_second integer,
  passage jsonb,
  passages jsonb,
  articles jsonb,
  useful_count integer NOT NULL DEFAULT 0,
  not_useful_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending', 'approved', 'stale', 'rejected')),
  index_fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_entry_question_norm_uidx
  ON public.knowledge_entry (question_norm);

CREATE INDEX IF NOT EXISTS knowledge_entry_status_idx
  ON public.knowledge_entry (status);

CREATE TABLE IF NOT EXISTS public.knowledge_feedback (
  id bigserial PRIMARY KEY,
  entry_id bigint REFERENCES public.knowledge_entry(id) ON DELETE SET NULL,
  question_norm text,
  vote text NOT NULL CHECK (vote IN ('useful', 'not_useful')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_feedback_entry_idx
  ON public.knowledge_feedback (entry_id);

ALTER TABLE public.knowledge_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_feedback ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'knowledge_entry'
      AND policyname = 'service role full access knowledge_entry'
  ) THEN
    CREATE POLICY "service role full access knowledge_entry"
      ON public.knowledge_entry FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'knowledge_feedback'
      AND policyname = 'service role full access knowledge_feedback'
  ) THEN
    CREATE POLICY "service role full access knowledge_feedback"
      ON public.knowledge_feedback FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_entry TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_feedback TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.knowledge_entry_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.knowledge_feedback_id_seq TO service_role;

-- Usuario local Docker (palabra)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'palabra') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_entry TO palabra';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_feedback TO palabra';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.knowledge_entry_id_seq TO palabra';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.knowledge_feedback_id_seq TO palabra';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    EXECUTE 'GRANT ALL ON TABLE public.knowledge_entry TO postgres';
    EXECUTE 'GRANT ALL ON TABLE public.knowledge_feedback TO postgres';
  END IF;
END $$;

-- Lectura pública opcional (anon) solo de entradas aprobadas — útil para Edge Function con anon si hiciera falta.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'knowledge_entry'
      AND policyname = 'public read approved knowledge'
  ) THEN
    CREATE POLICY "public read approved knowledge"
      ON public.knowledge_entry FOR SELECT
      USING (status = 'approved' AND useful_count >= not_useful_count);
  END IF;
END $$;

GRANT SELECT ON TABLE public.knowledge_entry TO anon, authenticated;
