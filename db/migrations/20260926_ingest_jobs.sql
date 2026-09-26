-- Cola de ingesta: links YouTube / archivos audio-video para transcribir e indexar.

CREATE TABLE IF NOT EXISTS public.ingest_job (
  id bigserial PRIMARY KEY,
  source_type text NOT NULL CHECK (source_type IN ('youtube', 'audio', 'video')),
  source_url text,
  local_path text,
  title text,
  youtube_id text,
  video_id bigint REFERENCES public.video(id) ON DELETE SET NULL,
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'palabra') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ingest_job TO palabra';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.ingest_job_id_seq TO palabra';
  END IF;
END $$;
