-- Datos puntuales del ministerio: horarios, nombres, terminología, etc.
-- El chat los consulta antes de RAG / FAQ.

CREATE TABLE IF NOT EXISTS public.knowledge_fact (
  id bigserial PRIMARY KEY,
  category text NOT NULL DEFAULT 'general'
    CHECK (category IN (
      'horario', 'persona', 'terminologia', 'lugar', 'contacto', 'general'
    )),
  title text NOT NULL,
  content text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_fact_title_length CHECK (char_length(title) BETWEEN 2 AND 200),
  CONSTRAINT knowledge_fact_content_length CHECK (char_length(content) BETWEEN 2 AND 4000)
);

CREATE INDEX IF NOT EXISTS knowledge_fact_status_idx
  ON public.knowledge_fact (status);

CREATE INDEX IF NOT EXISTS knowledge_fact_category_idx
  ON public.knowledge_fact (category);

CREATE INDEX IF NOT EXISTS knowledge_fact_aliases_gin
  ON public.knowledge_fact USING gin (aliases);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'palabra') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_fact TO palabra';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.knowledge_fact_id_seq TO palabra';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_fact TO service_role';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.knowledge_fact_id_seq TO service_role';
  END IF;
END $$;
