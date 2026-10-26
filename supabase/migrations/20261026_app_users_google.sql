-- Usuarios de Google + límite de correos distintos por dispositivo.
-- Un mismo navegador (device_id) no puede registrar más de MAX_EMAILS cuentas.

CREATE TABLE IF NOT EXISTS public.app_user (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text NOT NULL,
  name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_user_email_length CHECK (char_length(email) BETWEEN 3 AND 320)
);

CREATE TABLE IF NOT EXISTS public.app_user_device (
  id bigserial PRIMARY KEY,
  device_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.app_user (id) ON DELETE CASCADE,
  email text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_user_device_device_length CHECK (char_length(device_id) BETWEEN 8 AND 64),
  CONSTRAINT app_user_device_unique UNIQUE (device_id, user_id)
);

CREATE INDEX IF NOT EXISTS app_user_device_device_idx
  ON public.app_user_device (device_id);

CREATE INDEX IF NOT EXISTS app_user_email_idx
  ON public.app_user (lower(email));

-- Registra el login de Google y bloquea el 11.º correo distinto en el mismo dispositivo.
CREATE OR REPLACE FUNCTION public.register_google_login(
  p_device_id text,
  p_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  uemail text;
  device text;
  already boolean;
  other_emails int;
  max_emails constant int := 2;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  device := left(trim(coalesce(p_device_id, '')), 64);
  IF char_length(device) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_device');
  END IF;

  SELECT email INTO uemail FROM auth.users WHERE id = uid;
  uemail := lower(trim(coalesce(uemail, '')));
  IF uemail = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_email');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.app_user_device d
    WHERE d.device_id = device
      AND d.user_id = uid
  ) INTO already;

  IF NOT already THEN
    SELECT COUNT(DISTINCT lower(d.email)) INTO other_emails
    FROM public.app_user_device d
    WHERE d.device_id = device
      AND lower(d.email) <> uemail;

    IF other_emails >= max_emails THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'too_many_accounts',
        'limit', max_emails
      );
    END IF;
  END IF;

  INSERT INTO public.app_user (id, email, name, last_login_at)
  VALUES (
    uid,
    uemail,
    left(trim(coalesce(p_name, '')), 200),
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        name = CASE
          WHEN EXCLUDED.name <> '' THEN EXCLUDED.name
          ELSE public.app_user.name
        END,
        last_login_at = now();

  INSERT INTO public.app_user_device (device_id, user_id, email, last_seen_at)
  VALUES (device, uid, uemail, now())
  ON CONFLICT (device_id, user_id) DO UPDATE
    SET email = EXCLUDED.email,
        last_seen_at = now();

  RETURN jsonb_build_object('ok', true, 'email', uemail, 'user_id', uid);
END;
$$;

REVOKE ALL ON FUNCTION public.register_google_login(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_google_login(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_google_login(text, text) TO service_role;

ALTER TABLE public.app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_user_device ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_user_select_own ON public.app_user;
CREATE POLICY app_user_select_own ON public.app_user
  FOR SELECT TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS app_user_device_select_own ON public.app_user_device;
CREATE POLICY app_user_device_select_own ON public.app_user_device
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_user TO service_role';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_user_device TO service_role';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.app_user_device_id_seq TO service_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT ON TABLE public.app_user TO authenticated';
    EXECUTE 'GRANT SELECT ON TABLE public.app_user_device TO authenticated';
  END IF;
END $$;
