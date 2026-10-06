BEGIN;

CREATE TABLE IF NOT EXISTS public.chat_ratings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  interaction_id text NOT NULL,
  question text,
  vote text NOT NULL CHECK (vote IN ('useful', 'not_useful')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_ratings_interaction
  ON public.chat_ratings (interaction_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_ratings_vote
  ON public.chat_ratings (vote, created_at DESC);

ALTER TABLE public.chat_ratings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_ratings'
      AND policyname = 'anon insert chat_ratings'
  ) THEN
    CREATE POLICY "anon insert chat_ratings"
      ON public.chat_ratings FOR INSERT
      TO anon, authenticated
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_ratings'
      AND policyname = 'anon select chat_ratings'
  ) THEN
    CREATE POLICY "anon select chat_ratings"
      ON public.chat_ratings FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_ratings'
      AND policyname = 'service role full access chat_ratings'
  ) THEN
    CREATE POLICY "service role full access chat_ratings"
      ON public.chat_ratings FOR ALL
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE 'GRANT SELECT, INSERT ON TABLE public.chat_ratings TO anon, authenticated';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_ratings TO service_role';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  EXECUTE 'GRANT SELECT, INSERT ON TABLE public.chat_ratings TO palabra';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.chat_interactions
    ADD COLUMN IF NOT EXISTS rating text,
    ADD COLUMN IF NOT EXISTS rated_at timestamptz;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'No se pudieron agregar columnas rating en chat_interactions; el dashboard usará chat_ratings.';
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chat_interactions' AND column_name = 'rating'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_interactions_rating_check'
  ) THEN
    ALTER TABLE public.chat_interactions
      ADD CONSTRAINT chat_interactions_rating_check
      CHECK (rating IS NULL OR rating IN ('useful', 'not_useful'));
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Sin permiso para constraint de rating.';
END $$;

CREATE OR REPLACE FUNCTION public.apply_chat_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    UPDATE public.chat_interactions
       SET rating = NEW.vote,
           rated_at = NEW.created_at
     WHERE id = NEW.interaction_id
       AND rating IS NULL;
  EXCEPTION
    WHEN undefined_column THEN NULL;
    WHEN insufficient_privilege THEN NULL;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_chat_rating ON public.chat_ratings;
CREATE TRIGGER trg_apply_chat_rating
  AFTER INSERT ON public.chat_ratings
  FOR EACH ROW
  EXECUTE PROCEDURE public.apply_chat_rating();

NOTIFY pgrst, 'reload schema';

COMMIT;
