BEGIN;

CREATE TABLE IF NOT EXISTS public.chat_interactions (
  id text PRIMARY KEY,
  question text NOT NULL,
  answer text,
  excerpt text,
  source text,
  mode text,
  topics text[] NOT NULL DEFAULT '{}',
  video jsonb,
  passages jsonb,
  retrieval_meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector(
      'spanish',
      coalesce(question, '') || ' ' ||
      coalesce(answer, '') || ' ' ||
      coalesce(excerpt, '')
    )
  ) STORED,
  CONSTRAINT chat_interactions_question_length
    CHECK (char_length(question) BETWEEN 2 AND 500)
);

CREATE INDEX IF NOT EXISTS idx_chat_interactions_created_at
  ON public.chat_interactions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_interactions_topics
  ON public.chat_interactions USING gin (topics);

CREATE INDEX IF NOT EXISTS idx_chat_interactions_search
  ON public.chat_interactions USING gin (search_vector);

-- El modo asistida/búsqueda usa FTS. Sin este índice hacía Seq Scan.
CREATE INDEX IF NOT EXISTS idx_fragment_content_fts
  ON public.fragment
  USING gin (to_tsvector('spanish', content));

CREATE INDEX IF NOT EXISTS idx_video_title_fts
  ON public.video
  USING gin (to_tsvector('spanish', title));

COMMIT;
