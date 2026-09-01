-- Stable public redirect support (additive; does not wipe data)

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- No public read/write via anon; Edge Function uses service_role.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'app_settings' AND policyname = 'service role full access'
  ) THEN
    CREATE POLICY "service role full access" ON public.app_settings
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_settings TO service_role;
