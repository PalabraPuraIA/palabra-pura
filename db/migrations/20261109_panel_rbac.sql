-- RBAC del panel admin (usuarios, roles, permisos).
-- Independiente de auth.users de Supabase / Google.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.panel_permission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  module text NOT NULL,
  action text NOT NULL CHECK (action IN ('READ', 'WRITE')),
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT panel_permission_name_format CHECK (name ~ '^[a-z0-9_-]+:[a-z0-9_.-]+$')
);

CREATE INDEX IF NOT EXISTS panel_permission_module_idx ON public.panel_permission (module);
CREATE INDEX IF NOT EXISTS panel_permission_status_idx ON public.panel_permission (status);

CREATE TABLE IF NOT EXISTS public.panel_role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'CUSTOM' CHECK (type IN ('SYSTEM', 'CUSTOM')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS panel_role_status_idx ON public.panel_role (status);

CREATE TABLE IF NOT EXISTS public.panel_role_permission (
  role_id uuid NOT NULL REFERENCES public.panel_role (id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.panel_permission (id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS public.panel_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  email text,
  full_name text NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'PENDING')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT panel_user_username_length CHECK (char_length(username) BETWEEN 2 AND 80),
  CONSTRAINT panel_user_email_length CHECK (email IS NULL OR char_length(email) BETWEEN 3 AND 320)
);

CREATE INDEX IF NOT EXISTS panel_user_status_idx ON public.panel_user (status);
CREATE INDEX IF NOT EXISTS panel_user_email_idx ON public.panel_user (lower(email));

CREATE TABLE IF NOT EXISTS public.panel_user_role (
  user_id uuid NOT NULL REFERENCES public.panel_user (id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.panel_role (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- Permisos semilla (módulos del panel)
INSERT INTO public.panel_permission (name, module, action, description)
VALUES
  ('dashboard:read', 'Dashboard', 'READ', 'Ver el panel de inicio'),
  ('analytics:read', 'Analytics', 'READ', 'Ver estadísticas de consultas'),
  ('users:read', 'Usuarios', 'READ', 'Ver usuarios del panel'),
  ('users:write', 'Usuarios', 'WRITE', 'Crear y editar usuarios'),
  ('roles:read', 'Roles', 'READ', 'Ver roles'),
  ('roles:write', 'Roles', 'WRITE', 'Crear y editar roles'),
  ('permissions:read', 'Permisos', 'READ', 'Ver permisos'),
  ('permissions:write', 'Permisos', 'WRITE', 'Crear y editar permisos'),
  ('knowledge:read', 'Conocimiento', 'READ', 'Ver base de conocimiento'),
  ('knowledge:write', 'Conocimiento', 'WRITE', 'Editar conocimiento y hechos'),
  ('ingest:read', 'Enseñanzas', 'READ', 'Ver trabajos de ingesta'),
  ('ingest:write', 'Enseñanzas', 'WRITE', 'Subir y procesar enseñanzas'),
  ('corpus:read', 'Corpus', 'READ', 'Ver estadísticas del corpus')
ON CONFLICT (name) DO NOTHING;

-- Roles sistema
INSERT INTO public.panel_role (name, description, type)
VALUES
  ('Superadmin', 'Acceso total al panel', 'SYSTEM'),
  ('Editor', 'Sube enseñanzas y gestiona conocimiento', 'SYSTEM'),
  ('Viewer', 'Solo lectura de dashboard y analytics', 'SYSTEM')
ON CONFLICT (name) DO NOTHING;

-- Superadmin → todos los permisos
INSERT INTO public.panel_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM public.panel_role r
CROSS JOIN public.panel_permission p
WHERE r.name = 'Superadmin'
ON CONFLICT DO NOTHING;

-- Editor → dashboard, analytics, knowledge, ingest, corpus
INSERT INTO public.panel_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM public.panel_role r
JOIN public.panel_permission p ON p.name IN (
  'dashboard:read', 'analytics:read',
  'knowledge:read', 'knowledge:write',
  'ingest:read', 'ingest:write',
  'corpus:read'
)
WHERE r.name = 'Editor'
ON CONFLICT DO NOTHING;

-- Viewer → solo lectura
INSERT INTO public.panel_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM public.panel_role r
JOIN public.panel_permission p ON p.name IN (
  'dashboard:read', 'analytics:read', 'knowledge:read', 'ingest:read', 'corpus:read'
)
WHERE r.name = 'Viewer'
ON CONFLICT DO NOTHING;

-- Grants usuario Docker local
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'palabra') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.panel_permission TO palabra';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.panel_role TO palabra';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.panel_role_permission TO palabra';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.panel_user TO palabra';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.panel_user_role TO palabra';
  END IF;
END $$;
