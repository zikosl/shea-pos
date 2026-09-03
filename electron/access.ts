import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { PosDatabase } from "./database";

export const permissions = [
  "POS_SELL",
  "REGISTER_MANAGE",
  "ORDERS_VIEW",
  "INVOICES_VIEW",
  "INVENTORY_VIEW",
  "INVENTORY_MANAGE",
  "STOCK_RECEIVE",
  "CATALOG_REQUEST",
  "REPORTS_VIEW",
  "SETTINGS_MANAGE",
  "SYNC_MANAGE",
  "USERS_MANAGE",
  "CUSTOM_ORDERS_VIEW",
  "CUSTOM_ORDERS_MANAGE",
] as const;

export type Permission = (typeof permissions)[number];
export type LocalRole = "OWNER" | "MANAGER" | "CASHIER" | "STOCK_CLERK" | "CUSTOM";

export const rolePermissions: Record<LocalRole, Permission[]> = {
  OWNER: [...permissions],
  MANAGER: permissions.filter((permission) => permission !== "USERS_MANAGE"),
  CASHIER: ["POS_SELL", "REGISTER_MANAGE", "ORDERS_VIEW", "INVOICES_VIEW"],
  STOCK_CLERK: ["INVENTORY_VIEW", "INVENTORY_MANAGE", "STOCK_RECEIVE", "CATALOG_REQUEST"],
  CUSTOM: [],
};

type SafeUser = {
  id: string;
  name: string;
  username: string;
  role: LocalRole;
  permissions: Permission[];
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function hashSecret(secret: string) {
  const salt = randomBytes(16);
  const digest = scryptSync(secret, salt, 64);
  return `scrypt:${salt.toString("hex")}:${digest.toString("hex")}`;
}

function verifySecret(secret: string, encoded: string) {
  const [algorithm, saltHex, digestHex] = encoded.split(":");
  if (algorithm !== "scrypt" || !saltHex || !digestHex) return false;
  const expected = Buffer.from(digestHex, "hex");
  const actual = scryptSync(secret, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export class LocalAccessService {
  private currentUserId: string | null = null;
  private lastActivityAt = 0;

  constructor(private readonly database: PosDatabase) {}

  private rowToUser(row: any): SafeUser {
    return {
      id: row.id,
      name: row.name,
      username: row.username,
      role: row.role,
      permissions: row.role === "CUSTOM" ? JSON.parse(row.permissions_json || "[]") : rolePermissions[row.role as LocalRole],
      active: Boolean(row.active),
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at ?? null,
    };
  }

  private currentRow() {
    if (!this.currentUserId) return null;
    const timeout = Math.max(1, Number(this.database.getSetting("localSessionTimeout") || 15));
    if (Date.now() - this.lastActivityAt > timeout * 60_000) {
      this.currentUserId = null;
      return null;
    }
    const row = this.database.db.prepare("SELECT * FROM local_users WHERE id=? AND active=1").get(this.currentUserId) as any;
    if (!row) this.currentUserId = null;
    return row ?? null;
  }

  state() {
    const count = (this.database.db.prepare("SELECT COUNT(*) count FROM local_users").get() as any).count as number;
    const row = this.currentRow();
    return {
      setupRequired: count === 0,
      authenticated: Boolean(row),
      user: row ? this.rowToUser(row) : null,
      permissions: row ? this.rowToUser(row).permissions : [],
    };
  }

  setupOwner(input: { name: string; username: string; secret: string }) {
    const count = (this.database.db.prepare("SELECT COUNT(*) count FROM local_users").get() as any).count as number;
    if (count) throw new Error("Local owner already exists");
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.db.prepare(
      `INSERT INTO local_users(id,name,username,password_hash,role,permissions_json,active,created_at,updated_at)
       VALUES (?,?,?,?,?,?,1,?,?)`,
    ).run(id, input.name.trim(), normalizeUsername(input.username), hashSecret(input.secret), "OWNER", JSON.stringify(rolePermissions.OWNER), now, now);
    this.currentUserId = id;
    this.lastActivityAt = Date.now();
    this.audit("OWNER_CREATED", "LocalUser", id);
    return this.state();
  }

  login(username: string, secret: string) {
    const row = this.database.db.prepare("SELECT * FROM local_users WHERE username=?").get(normalizeUsername(username)) as any;
    const now = Date.now();
    if (!row || !row.active) throw new Error("Invalid local credentials");
    if (row.locked_until && new Date(row.locked_until).getTime() > now)
      throw new Error("Account temporarily locked. Try again later");
    if (!verifySecret(secret, row.password_hash)) {
      const attempts = Number(row.failed_attempts || 0) + 1;
      const lockedUntil = attempts >= 5 ? new Date(now + 5 * 60_000).toISOString() : null;
      this.database.db.prepare("UPDATE local_users SET failed_attempts=?,locked_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(attempts >= 5 ? 0 : attempts, lockedUntil, row.id);
      throw new Error(lockedUntil ? "Account locked for 5 minutes" : "Invalid local credentials");
    }
    this.currentUserId = row.id;
    this.lastActivityAt = now;
    this.database.db.prepare("UPDATE local_users SET failed_attempts=0,locked_until=NULL,last_login_at=?,updated_at=? WHERE id=?")
      .run(new Date(now).toISOString(), new Date(now).toISOString(), row.id);
    this.audit("LOCAL_LOGIN", "LocalUser", row.id);
    return this.state();
  }

  logout() {
    if (this.currentUserId) this.audit("LOCAL_LOGOUT", "LocalUser", this.currentUserId);
    this.currentUserId = null;
  }

  touch() {
    this.require();
    this.lastActivityAt = Date.now();
  }

  require(required?: Permission | Permission[]) {
    const row = this.currentRow();
    if (!row) throw new Error("LOCAL_SESSION_REQUIRED");
    this.lastActivityAt = Date.now();
    if (!required) return this.rowToUser(row);
    const granted = new Set<Permission>(this.rowToUser(row).permissions);
    const accepted = Array.isArray(required) ? required.some((permission) => granted.has(permission)) : granted.has(required);
    if (!accepted) throw new Error("PERMISSION_DENIED");
    return this.rowToUser(row);
  }

  listUsers() {
    return (this.database.db.prepare("SELECT * FROM local_users ORDER BY active DESC,name").all() as any[]).map((row) => this.rowToUser(row));
  }

  createUser(input: { name: string; username: string; secret: string; role: LocalRole; permissions?: Permission[] }) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const granted = input.role === "CUSTOM" ? input.permissions ?? [] : rolePermissions[input.role];
    this.database.db.prepare(
      `INSERT INTO local_users(id,name,username,password_hash,role,permissions_json,active,created_at,updated_at)
       VALUES (?,?,?,?,?,?,1,?,?)`,
    ).run(id, input.name.trim(), normalizeUsername(input.username), hashSecret(input.secret), input.role, JSON.stringify(granted), now, now);
    this.audit("USER_CREATED", "LocalUser", id, { role: input.role });
    return this.listUsers().find((user) => user.id === id);
  }

  updateUser(input: { id: string; name: string; username: string; role: LocalRole; permissions?: Permission[]; active: boolean }) {
    const existing = this.database.db.prepare("SELECT * FROM local_users WHERE id=?").get(input.id) as any;
    if (!existing) throw new Error("Local user not found");
    if (existing.role === "OWNER" && (!input.active || input.role !== "OWNER")) {
      const owners = (this.database.db.prepare("SELECT COUNT(*) count FROM local_users WHERE role='OWNER' AND active=1").get() as any).count;
      if (owners <= 1) throw new Error("At least one active owner is required");
    }
    const granted = input.role === "CUSTOM" ? input.permissions ?? [] : rolePermissions[input.role];
    this.database.db.prepare(
      "UPDATE local_users SET name=?,username=?,role=?,permissions_json=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).run(input.name.trim(), normalizeUsername(input.username), input.role, JSON.stringify(granted), input.active ? 1 : 0, input.id);
    this.audit("USER_UPDATED", "LocalUser", input.id, { role: input.role, active: input.active });
    return this.listUsers().find((user) => user.id === input.id);
  }

  resetSecret(id: string, secret: string) {
    const result = this.database.db.prepare("UPDATE local_users SET password_hash=?,failed_attempts=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(hashSecret(secret), id);
    if (!result.changes) throw new Error("Local user not found");
    this.audit("ACCESS_CODE_RESET", "LocalUser", id);
  }

  listAudit() {
    return this.database.db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500").all();
  }

  audit(action: string, entityType?: string, entityId?: string, details?: unknown) {
    const user = this.currentUserId
      ? (this.database.db.prepare("SELECT name FROM local_users WHERE id=?").get(this.currentUserId) as any)
      : null;
    this.database.db.prepare(
      "INSERT INTO audit_logs(id,user_id,user_name,action,entity_type,entity_id,details_json,created_at) VALUES (?,?,?,?,?,?,?,?)",
    ).run(randomUUID(), this.currentUserId, user?.name ?? "System", action, entityType ?? null, entityId ?? null, details ? JSON.stringify(details) : null, new Date().toISOString());
  }
}
