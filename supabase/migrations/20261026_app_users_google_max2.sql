-- Baja el tope a 2 correos distintos por dispositivo.
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
