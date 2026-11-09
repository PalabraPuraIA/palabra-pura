/**
 * panel-rbac.js — CRUD de usuarios, roles y permisos del panel.
 */
import { panelQuery, panelTablesReady } from "./panel-db.js";
import { hashPassword } from "./panel-passwords.js";

function bad(status, error) {
  const err = new Error(error);
  err.status = status;
  return err;
}

function pageParams(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

async function loadUserPermissions(userId) {
  const { rows } = await panelQuery(
    `SELECT DISTINCT p.name
       FROM panel_user_role ur
       JOIN panel_role r ON r.id = ur.role_id AND r.status = 'ACTIVE'
       JOIN panel_role_permission rp ON rp.role_id = r.id
       JOIN panel_permission p ON p.id = rp.permission_id AND p.status = 'ACTIVE'
      WHERE ur.user_id = $1
      ORDER BY p.name`,
    [userId],
  );
  return rows.map((r) => r.name);
}

async function loadUserRoles(userId) {
  const { rows } = await panelQuery(
    `SELECT r.id, r.name, r.type
       FROM panel_user_role ur
       JOIN panel_role r ON r.id = ur.role_id
      WHERE ur.user_id = $1
      ORDER BY r.name`,
    [userId],
  );
  return rows;
}

export async function findUserByLogin(login) {
  const key = String(login || "").trim();
  if (!key) return null;
  if (!(await panelTablesReady())) return null;
  const { rows } = await panelQuery(
    `SELECT id, username, email, full_name, password_hash, status
       FROM panel_user
      WHERE lower(username) = lower($1)
         OR (email IS NOT NULL AND lower(email) = lower($1))
      LIMIT 1`,
    [key],
  );
  return rows[0] || null;
}

export async function countPanelUsers() {
  if (!(await panelTablesReady())) return 0;
  const { rows } = await panelQuery(`SELECT count(*)::int AS n FROM panel_user`);
  return rows[0]?.n || 0;
}

export async function bootstrapSuperadmin({ username, password, fullName }) {
  if (!(await panelTablesReady())) {
    throw bad(503, "Aplica la migración 20261109_panel_rbac.sql primero");
  }
  const n = await countPanelUsers();
  if (n > 0) return null;

  const hash = await hashPassword(password);
  const { rows: users } = await panelQuery(
    `INSERT INTO panel_user (username, email, full_name, password_hash, status, last_login_at)
     VALUES ($1, NULL, $2, $3, 'ACTIVE', now())
     RETURNING id, username, full_name, status`,
    [username, fullName || "Administrador", hash],
  );
  const user = users[0];
  const { rows: roles } = await panelQuery(
    `SELECT id FROM panel_role WHERE name = 'Superadmin' LIMIT 1`,
  );
  if (roles[0]) {
    await panelQuery(
      `INSERT INTO panel_user_role (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [user.id, roles[0].id],
    );
  }
  console.log(`[panel-rbac] Superadmin creado: ${user.username}`);
  return user;
}

export async function touchLogin(userId) {
  await panelQuery(`UPDATE panel_user SET last_login_at = now(), updated_at = now() WHERE id = $1`, [
    userId,
  ]);
}

export async function getAuthProfile(userId) {
  const { rows } = await panelQuery(
    `SELECT id, username, email, full_name, status, last_login_at, created_at
       FROM panel_user WHERE id = $1`,
    [userId],
  );
  const user = rows[0];
  if (!user) return null;
  const roles = await loadUserRoles(userId);
  const permissions = await loadUserPermissions(userId);
  return { ...user, roles, permissions };
}

function mapPermission(row) {
  return {
    id: row.id,
    name: row.name,
    module: row.module,
    action: row.action,
    description: row.description,
    status: row.status,
    rolesCount: Number(row.roles_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRole(row, permissions = []) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    status: row.status,
    permissions,
    permissionsCount: permissions.length,
    usersCount: Number(row.users_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUser(row, roles = []) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    status: row.status,
    roles,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------- Permissions ----------
export async function handleListPermissions(req, res) {
  try {
    const { page, limit, offset } = pageParams(req.query);
    const module = String(req.query.module || "").trim();
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const where = [];
    const params = [];
    if (module) {
      params.push(module);
      where.push(`p.module = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`p.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = await panelQuery(`SELECT count(*)::int AS n FROM panel_permission p ${clause}`, params);
    params.push(limit, offset);
    const { rows } = await panelQuery(
      `SELECT p.*, (SELECT count(*) FROM panel_role_permission rp WHERE rp.permission_id = p.id) AS roles_count
         FROM panel_permission p
         ${clause}
        ORDER BY p.module ASC, p.name ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const total = count.rows[0]?.n || 0;
    res.json({
      data: rows.map(mapPermission),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export async function handleCreatePermission(req, res) {
  try {
    const name = String(req.body?.name || "").trim();
    const module = String(req.body?.module || "").trim();
    const action = String(req.body?.action || "").trim().toUpperCase();
    const description = String(req.body?.description || "").trim();
    const status = String(req.body?.status || "ACTIVE").trim().toUpperCase();
    if (!name || !module || !["READ", "WRITE"].includes(action) || !description) {
      throw bad(400, "name, module, action (READ|WRITE) y description son requeridos");
    }
    const { rows } = await panelQuery(
      `INSERT INTO panel_permission (name, module, action, description, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *, 0 AS roles_count`,
      [name, module, action, description, status === "INACTIVE" ? "INACTIVE" : "ACTIVE"],
    );
    res.status(201).json(mapPermission(rows[0]));
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ ok: false, error: "Ya existe ese permiso" });
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export async function handleUpdatePermission(req, res) {
  try {
    const id = req.params.id;
    const fields = [];
    const params = [];
    for (const [key, col] of [
      ["name", "name"],
      ["module", "module"],
      ["action", "action"],
      ["description", "description"],
      ["status", "status"],
    ]) {
      if (req.body?.[key] !== undefined) {
        params.push(String(req.body[key]).trim());
        fields.push(`${col} = $${params.length}`);
      }
    }
    if (!fields.length) throw bad(400, "Nada para actualizar");
    fields.push("updated_at = now()");
    params.push(id);
    const { rows } = await panelQuery(
      `UPDATE panel_permission SET ${fields.join(", ")}
        WHERE id = $${params.length}
        RETURNING *, (SELECT count(*) FROM panel_role_permission rp WHERE rp.permission_id = panel_permission.id) AS roles_count`,
      params,
    );
    if (!rows[0]) throw bad(404, "Permiso no encontrado");
    res.json(mapPermission(rows[0]));
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ ok: false, error: "Ya existe ese permiso" });
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export async function handleDeletePermission(req, res) {
  try {
    const { rowCount } = await panelQuery(`DELETE FROM panel_permission WHERE id = $1`, [req.params.id]);
    if (!rowCount) throw bad(404, "Permiso no encontrado");
    res.status(204).end();
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

// ---------- Roles ----------
export async function handleListRoles(req, res) {
  try {
    const { page, limit, offset } = pageParams(req.query);
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const where = [];
    const params = [];
    if (status) {
      params.push(status);
      where.push(`r.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(r.name ILIKE $${params.length} OR r.description ILIKE $${params.length})`);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = await panelQuery(`SELECT count(*)::int AS n FROM panel_role r ${clause}`, params);
    params.push(limit, offset);
    const { rows } = await panelQuery(
      `SELECT r.*,
              (SELECT count(*) FROM panel_user_role ur WHERE ur.role_id = r.id) AS users_count
         FROM panel_role r
         ${clause}
        ORDER BY r.type ASC, r.name ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const data = [];
    for (const row of rows) {
      const perms = await panelQuery(
        `SELECT p.id, p.name, p.module
           FROM panel_role_permission rp
           JOIN panel_permission p ON p.id = rp.permission_id
          WHERE rp.role_id = $1
          ORDER BY p.name`,
        [row.id],
      );
      data.push(mapRole(row, perms.rows));
    }
    const total = count.rows[0]?.n || 0;
    res.json({ data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export async function handleGetRole(req, res) {
  try {
    const { rows } = await panelQuery(
      `SELECT r.*,
              (SELECT count(*) FROM panel_user_role ur WHERE ur.role_id = r.id) AS users_count
         FROM panel_role r WHERE r.id = $1`,
      [req.params.id],
    );
    if (!rows[0]) throw bad(404, "Rol no encontrado");
    const perms = await panelQuery(
      `SELECT p.id, p.name, p.module FROM panel_role_permission rp
         JOIN panel_permission p ON p.id = rp.permission_id
        WHERE rp.role_id = $1 ORDER BY p.name`,
      [req.params.id],
    );
    res.json(mapRole(rows[0], perms.rows));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export async function handleCreateRole(req, res) {
  try {
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    const status = String(req.body?.status || "ACTIVE").trim().toUpperCase();
    const permissionIds = Array.isArray(req.body?.permissionIds) ? req.body.permissionIds : [];
    if (!name || !description) throw bad(400, "name y description son requeridos");
    const { rows } = await panelQuery(
      `INSERT INTO panel_role (name, description, type, status)
       VALUES ($1, $2, 'CUSTOM', $3)
       RETURNING *, 0 AS users_count`,
      [name, description, status === "INACTIVE" ? "INACTIVE" : "ACTIVE"],
    );
    const role = rows[0];
    for (const pid of permissionIds) {
      await panelQuery(
        `INSERT INTO panel_role_permission (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [role.id, pid],
      );
    }
    return handleGetRole({ params: { id: role.id } }, res);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ ok: false, error: "Ya existe ese rol" });
    if (err.code === "23503") return res.status(400).json({ ok: false, error: "permissionIds inválidos" });
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export async function handleUpdateRole(req, res) {
  try {
    const id = req.params.id;
    const { rows: existing } = await panelQuery(`SELECT * FROM panel_role WHERE id = $1`, [id]);
    if (!existing[0]) throw bad(404, "Rol no encontrado");

    const fields = [];
    const params = [];
    if (req.body?.name !== undefined) {
      params.push(String(req.body.name).trim());
      fields.push(`name = $${params.length}`);
    }
    if (req.body?.description !== undefined) {
      params.push(String(req.body.description).trim());
      fields.push(`description = $${params.length}`);
    }
    if (req.body?.status !== undefined) {
      params.push(String(req.body.status).trim().toUpperCase());
      fields.push(`status = $${params.length}`);
    }
    if (fields.length) {
      fields.push("updated_at = now()");
      params.push(id);
      await panelQuery(`UPDATE panel_role SET ${fields.join(", ")} WHERE id = $${params.length}`, params);
    }
    if (Array.isArray(req.body?.permissionIds)) {
      await panelQuery(`DELETE FROM panel_role_permission WHERE role_id = $1`, [id]);
      for (const pid of req.body.permissionIds) {
        await panelQuery(
          `INSERT INTO panel_role_permission (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, pid],
        );
      }
    }
    return handleGetRole(req, res);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ ok: false, error: "Ya existe ese rol" });
    if (err.code === "23503") return res.status(400).json({ ok: false, error: "permissionIds inválidos" });
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export async function handleDeleteRole(req, res) {
  try {
    const { rows } = await panelQuery(`SELECT type FROM panel_role WHERE id = $1`, [req.params.id]);
    if (!rows[0]) throw bad(404, "Rol no encontrado");
    if (rows[0].type === "SYSTEM") throw bad(400, "No se puede eliminar un rol del sistema");
    await panelQuery(`DELETE FROM panel_role WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

// ---------- Users ----------
export async function handleListUsers(req, res) {
  try {
    const { page, limit, offset } = pageParams(req.query);
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const roleId = String(req.query.roleId || "").trim();
    const where = [];
    const params = [];
    if (status) {
      params.push(status);
      where.push(`u.status = $${params.length}`);
    }
    if (roleId) {
      params.push(roleId);
      where.push(`EXISTS (SELECT 1 FROM panel_user_role ur WHERE ur.user_id = u.id AND ur.role_id = $${params.length})`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(
        `(u.username ILIKE $${params.length} OR u.full_name ILIKE $${params.length} OR coalesce(u.email,'') ILIKE $${params.length})`,
      );
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = await panelQuery(`SELECT count(*)::int AS n FROM panel_user u ${clause}`, params);
    params.push(limit, offset);
    const { rows } = await panelQuery(
      `SELECT u.id, u.username, u.email, u.full_name, u.status, u.last_login_at, u.created_at, u.updated_at
         FROM panel_user u
         ${clause}
        ORDER BY u.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const data = [];
    for (const row of rows) {
      data.push(mapUser(row, await loadUserRoles(row.id)));
    }
    const total = count.rows[0]?.n || 0;
    res.json({ data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export async function handleGetUser(req, res) {
  try {
    const profile = await getAuthProfile(req.params.id);
    if (!profile) throw bad(404, "Usuario no encontrado");
    res.json(mapUser(profile, profile.roles));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export async function handleCreateUser(req, res) {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const fullName = String(req.body?.fullName || req.body?.name || "").trim();
    const email = req.body?.email != null ? String(req.body.email).trim().toLowerCase() : null;
    const status = String(req.body?.status || "ACTIVE").trim().toUpperCase();
    const roleIds = Array.isArray(req.body?.roleIds) ? req.body.roleIds : [];
    if (!username || !password || !fullName) {
      throw bad(400, "username, password y fullName son requeridos");
    }
    if (!roleIds.length) throw bad(400, "roleIds debe tener al menos un rol");
    const hash = await hashPassword(password);
    const { rows } = await panelQuery(
      `INSERT INTO panel_user (username, email, full_name, password_hash, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, full_name, status, last_login_at, created_at, updated_at`,
      [username, email || null, fullName, hash, ["ACTIVE", "SUSPENDED", "PENDING"].includes(status) ? status : "ACTIVE"],
    );
    const user = rows[0];
    for (const rid of roleIds) {
      await panelQuery(
        `INSERT INTO panel_user_role (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [user.id, rid],
      );
    }
    res.status(201).json(mapUser(user, await loadUserRoles(user.id)));
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ ok: false, error: "Usuario o correo ya existe" });
    if (err.code === "23503") return res.status(400).json({ ok: false, error: "roleIds inválidos" });
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export async function handleUpdateUser(req, res) {
  try {
    const id = req.params.id;
    const { rows: existing } = await panelQuery(`SELECT id FROM panel_user WHERE id = $1`, [id]);
    if (!existing[0]) throw bad(404, "Usuario no encontrado");

    const fields = [];
    const params = [];
    const map = [
      ["username", "username"],
      ["email", "email"],
      ["fullName", "full_name"],
      ["status", "status"],
    ];
    for (const [bodyKey, col] of map) {
      if (req.body?.[bodyKey] !== undefined) {
        let val = req.body[bodyKey];
        if (bodyKey === "email" && val != null) val = String(val).trim().toLowerCase() || null;
        else if (bodyKey === "fullName") val = String(val).trim();
        else if (bodyKey === "username") val = String(val).trim();
        else if (bodyKey === "status") val = String(val).trim().toUpperCase();
        params.push(val);
        fields.push(`${col} = $${params.length}`);
      }
    }
    if (req.body?.password) {
      const hash = await hashPassword(String(req.body.password));
      params.push(hash);
      fields.push(`password_hash = $${params.length}`);
    }
    if (fields.length) {
      fields.push("updated_at = now()");
      params.push(id);
      await panelQuery(`UPDATE panel_user SET ${fields.join(", ")} WHERE id = $${params.length}`, params);
    }
    if (Array.isArray(req.body?.roleIds)) {
      if (!req.body.roleIds.length) throw bad(400, "roleIds no puede quedar vacío");
      await panelQuery(`DELETE FROM panel_user_role WHERE user_id = $1`, [id]);
      for (const rid of req.body.roleIds) {
        await panelQuery(
          `INSERT INTO panel_user_role (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, rid],
        );
      }
    }
    return handleGetUser(req, res);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ ok: false, error: "Usuario o correo ya existe" });
    if (err.code === "23503") return res.status(400).json({ ok: false, error: "roleIds inválidos" });
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export async function handleDeleteUser(req, res) {
  try {
    if (req.admin?.id && req.admin.id === req.params.id) {
      throw bad(400, "No puedes eliminarte a ti mismo");
    }
    const { rowCount } = await panelQuery(`DELETE FROM panel_user WHERE id = $1`, [req.params.id]);
    if (!rowCount) throw bad(404, "Usuario no encontrado");
    res.status(204).end();
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export async function handleUserStats(_req, res) {
  try {
    const { rows } = await panelQuery(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
         count(*) FILTER (WHERE status = 'SUSPENDED')::int AS suspended,
         count(*) FILTER (WHERE status = 'PENDING')::int AS pending
       FROM panel_user`,
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}
