import pg from "pg";

let pool;

export function panelDbConfig() {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  if (!process.env.PGHOST) return null;
  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "palabra_pura",
    user: process.env.PGUSER || "palabra",
    password: process.env.PGPASSWORD || "",
  };
}

export function getPanelPool() {
  if (pool) return pool;
  const config = panelDbConfig();
  if (!config) return null;
  pool = new pg.Pool({
    ...config,
    max: 4,
    idleTimeoutMillis: 30000,
  });
  pool.on("error", (err) => console.error("[panel-rbac] pg pool", err.message));
  return pool;
}

export async function panelQuery(text, params = []) {
  const db = getPanelPool();
  if (!db) throw Object.assign(new Error("Base de datos no configurada"), { status: 503 });
  return db.query(text, params);
}

export async function panelTablesReady() {
  try {
    await panelQuery("SELECT 1 FROM public.panel_user LIMIT 1");
    return true;
  } catch {
    return false;
  }
}
