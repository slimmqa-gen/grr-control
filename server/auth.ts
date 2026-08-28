import type { Express, Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { storage } from "./storage";
import { ROLES, DEMO_USERS, insertUserSchema, type User, type Section } from "@shared/schema";
import { visibleSectionsFor, moneyEnabled } from "./sectionsconfig";

export type AuthUser = User & { objects: number[]; perm: (typeof ROLES)[string] };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

const nowIso = () => new Date().toISOString();

/**
 * Аварийное восстановление доступа.
 * Если в программе не осталось ни одной активной учётной записи директора
 * (например, её случайно удалили или отключили), она восстанавливается
 * при запуске программы с логином director и паролем director.
 * Остальные данные при этом не затрагиваются.
 */
export function ensureDirector() {
  const users = storage.users();
  const activeDirector = users.find((u) => u.role === "director" && u.active === 1);
  if (activeDirector) return;

  const existing = users.find((u) => u.login === "director");
  if (existing) {
    // Учётная запись есть, но отключена или ей сменили роль — возвращаем.
    storage.updateUser(existing.id, {
      role: "director",
      active: 1,
      passwordHash: bcrypt.hashSync("director", 10),
    });
    console.log("[Восстановление доступа] Учётная запись director включена заново, пароль сброшен на director. Смените пароль после входа.");
    return;
  }

  storage.createUser({
    login: "director",
    passwordHash: bcrypt.hashSync("director", 10),
    fio: "Генеральный директор",
    role: "director",
    objectIds: JSON.stringify([]),
    active: 1,
    createdAt: nowIso(),
    lastLogin: "",
  });
  console.log("[Восстановление доступа] Учётная запись директора создана заново: логин director, пароль director. Смените пароль после входа.");
}

/** Создание демо-пользователей при первом запуске */
export function seedUsers() {
  if (storage.users().length > 0) { ensureDirector(); return; }
  const objs = storage.objects();
  DEMO_USERS.forEach((u) => {
    const objectIds = u.role === "geolog" && objs.length ? [objs[0].id] : [];
    storage.createUser({
      login: u.login,
      passwordHash: bcrypt.hashSync(u.password, 10),
      fio: u.fio,
      role: u.role,
      objectIds: JSON.stringify(objectIds),
      active: 1,
      createdAt: nowIso(),
      lastLogin: "",
    });
  });
}

export function toAuthUser(u: User): AuthUser {
  let objects: number[] = [];
  try { objects = JSON.parse(u.objectIds || "[]"); } catch { objects = []; }
  const base = ROLES[u.role] ?? ROLES.viewer;
  // Состав программы (экран «Разделы программы») сужает права роли:
  // скрытый раздел недоступен и в меню, и по API.
  const perm = {
    ...base,
    sections: visibleSectionsFor(u.role) as unknown as Section[],
    // Денежные показатели показываем, только если раздел «Экономика» включён
    finance: base.finance && moneyEnabled(),
  };
  return { ...u, objects: perm.allObjects ? [] : objects, perm };
}

export function publicUser(u: AuthUser) {
  return {
    id: u.id, login: u.login, fio: u.fio, role: u.role,
    roleLabel: u.perm.label, roleHint: u.perm.hint,
    objects: u.objects, perm: u.perm, lastLogin: u.lastLogin,
  };
}

export function audit(req: Request, action: string, entity = "", details = "", ok = true) {
  const u = req.authUser;
  try {
    storage.addAudit({
      at: nowIso(), userId: u?.id ?? 0, login: u?.login ?? "—", role: u?.role ?? "",
      action, entity, details: String(details).slice(0, 400), ok: ok ? 1 : 0,
    });
  } catch { /* журнал не должен ломать основной сценарий */ }
}

/* ==================== Чувствительные данные ==================== */

const MONEY_KEYS = new Set([
  "pricePerMeter", "plannedCostPerMeter", "planCostPerMeter", "factCostPerMeter",
  "costPerMeter", "costDeviationPct", "costs", "cost", "amount", "revenue", "margin",
  "profitability", "lostMoney", "money", "salary", "totalCost", "price", "pricePerSample",
  "estimateTotal", "breakEvenMeters", "idleHourCost", "planCost", "factCost",
  "costPerMeterByObject", "costsByCategory", "estimateAnalytics", "spendPct",
  "analysisCost", "analysisCostTotal",
  "planCostPerMeterByDepth", "avgRate", "idleLoss", "forecastCost", "forecastResult",
  // целиком денежные наборы для графиков
  "costStructure", "costTrend", "revenueVsCost", "marginByObject",
]);

/** Рекурсивно вычищает денежные показатели из ответа для ролей без прав */
export function stripMoney(value: any): any {
  if (Array.isArray(value)) return value.map(stripMoney);
  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      if (MONEY_KEYS.has(k)) continue;
      out[k] = stripMoney(v);
    }
    return out;
  }
  if (typeof value === "string" && value.includes("₽")) return "—";
  return value;
}

/** Убирает строки текстовых сводок с денежными показателями */
function stripMoneyText(payload: any) {
  if (!payload || typeof payload !== "object") return payload;
  if (payload.summaries) {
    for (const key of Object.keys(payload.summaries)) {
      const s = payload.summaries[key];
      if (!s) continue;
      const clean = (arr: any) => (Array.isArray(arr) ? arr.filter((x) => !String(x).includes("₽")) : arr);
      s.essence = clean(s.essence); s.conclusions = clean(s.conclusions);
      s.risks = clean(s.risks); s.actions = clean(s.actions);
      if (typeof s.text === "string")
        s.text = s.text.split("\n").filter((l: string) => !l.includes("₽")).join("\n");
    }
  }
  if (Array.isArray(payload.flags))
    payload.flags = payload.flags.filter((f: any) =>
      !String(f?.value ?? "").includes("₽")
      && !String(f?.title ?? "").toLowerCase().includes("себестоимост")
      && !String(f?.title ?? "").toLowerCase().includes("смет"));
  return payload;
}

/** Фильтрация массивов по разрешённым объектам пользователя */
function scopeArrays(value: any, allowed: number[], allowedNames: Set<string> = new Set()): any {
  if (!allowed.length) return value;
  if (Array.isArray(value)) {
    const filtered = value.filter((v) => {
      if (!v || typeof v !== "object") return true;
      if (typeof v.objectId === "number") return allowed.includes(v.objectId);
      // записи без objectId, но с названием объекта (флаги, сводки)
      if (typeof v.object === "string" && v.object && allowedNames.size)
        return allowedNames.has(v.object);
      return true;
    });
    return filtered.map((v) => scopeArrays(v, allowed, allowedNames));
  }
  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      if ((k === "objects" || k === "byObject") && Array.isArray(v))
        out[k] = (v as any[]).filter((o: any) => {
          if (typeof o?.id === "number") return allowed.includes(o.id);
          if (typeof o?.objectId === "number") return allowed.includes(o.objectId);
          const nm = o?.object ?? o?.name;
          if (typeof nm === "string" && allowedNames.size) return allowedNames.has(nm);
          return true;
        });
      else out[k] = scopeArrays(v, allowed, allowedNames);
    }
    return out;
  }
  return value;
}

/** Убирает из текстовых сводок строки про чужие объекты */
function scopeText(value: any, allowedNames: Set<string>, allNames: string[]): any {
  if (!allowedNames.size) return value;
  const foreign = allNames.filter((n) => !allowedNames.has(n));
  if (!foreign.length) return value;
  const drop = (t: string) => foreign.some((n) => t.includes(n)) && !Array.from(allowedNames).some((n) => t.includes(n));
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.filter((x) => !(typeof x === "string" && drop(x))).map(walk);
    if (v && typeof v === "object") {
      const out: any = {};
      for (const [k, x] of Object.entries(v)) out[k] = typeof x === "string" && drop(x) ? "" : walk(x);
      return out;
    }
    return v;
  };
  return walk(value);
}

/* ==================== Соответствие адресов API и разделов ==================== */

type Rule = { prefix: string; section: Section; readGuard: boolean };

const RULES: Rule[] = [
  { prefix: "/api/costs", section: "economics", readGuard: true },
  { prefix: "/api/estimates", section: "economics", readGuard: true },
  { prefix: "/api/estimate-lines", section: "economics", readGuard: true },
  { prefix: "/api/depth-rates", section: "economics", readGuard: true },
  { prefix: "/api/calendar", section: "economics", readGuard: true },
  { prefix: "/api/economics", section: "economics", readGuard: true },
  { prefix: "/api/users", section: "users", readGuard: true },
  { prefix: "/api/audit", section: "users", readGuard: true },
  { prefix: "/api/profiles", section: "profiles", readGuard: true },
  { prefix: "/api/templates", section: "templates", readGuard: true },
  { prefix: "/api/branding", section: "settings", readGuard: false },
  { prefix: "/api/synonyms", section: "profiles", readGuard: true },
  { prefix: "/api/smart", section: "import", readGuard: true },
  { prefix: "/api/import", section: "import", readGuard: true },
  { prefix: "/api/samples", section: "sampleprep", readGuard: true },
  { prefix: "/api/batches", section: "sampleprep", readGuard: true },
  { prefix: "/api/assays", section: "sampleprep", readGuard: true },
  { prefix: "/api/corelogs", section: "core", readGuard: true },
  { prefix: "/api/corecuts", section: "core", readGuard: true },
  { prefix: "/api/reports", section: "drilling", readGuard: true },
  { prefix: "/api/fuel", section: "fuel", readGuard: true },
  { prefix: "/api/inventory", section: "fuel", readGuard: true },
  { prefix: "/api/employees", section: "crew", readGuard: true },
  { prefix: "/api/shifts", section: "crew", readGuard: true },
  { prefix: "/api/pbk", section: "pbk", readGuard: true },
  { prefix: "/api/ref", section: "references", readGuard: false },
  { prefix: "/api/settings", section: "settings", readGuard: false },
  { prefix: "/api/maintenance", section: "settings", readGuard: true },
];

/** Раздел, к которому относится выгрузка Excel */
const EXPORT_SECTIONS: Record<string, Section> = {
  reports: "drilling", economics: "economics", fuel: "fuel", crew: "crew",
  summary: "summary", sampleprep: "sampleprep", core: "core", all: "summary",
};

export function sectionOf(path: string): { section: Section; readGuard: boolean } | null {
  if (path.startsWith("/api/export/")) {
    const key = path.split("/")[3]?.split("?")[0] ?? "";
    const section = EXPORT_SECTIONS[key] ?? EXPORT_SECTIONS[key.replace(/\/.*$/, "")];
    return section ? { section, readGuard: true } : null;
  }
  const r = RULES.find((x) => path === x.prefix || path.startsWith(x.prefix + "/"));
  return r ? { section: r.section, readGuard: r.readGuard } : null;
}

const PUBLIC = ["/api/auth/login", "/api/auth/demo-users"];

export function installAuth(app: Express) {
  seedUsers();

  app.post("/api/auth/login", (req, res) => {
    const login = String(req.body?.login ?? "").trim();
    const password = String(req.body?.password ?? "");
    const u = storage.userByLogin(login);
    if (!u || !bcrypt.compareSync(password, u.passwordHash)) {
      storage.addAudit({
        at: nowIso(), userId: 0, login: login || "—", role: "", action: "Неудачный вход",
        entity: "Вход", details: "Неверный логин или пароль", ok: 0,
      });
      return res.status(401).json({ error: "Неверный логин или пароль" });
    }
    if (!u.active) return res.status(403).json({ error: "Учётная запись отключена. Обратитесь к директору." });
    const token = crypto.randomUUID();
    storage.createSession(token, u.id);
    storage.updateUser(u.id, { lastLogin: nowIso() });
    const au = toAuthUser({ ...u, lastLogin: nowIso() });
    storage.addAudit({
      at: nowIso(), userId: u.id, login: u.login, role: u.role, action: "Вход в программу",
      entity: "Вход", details: au.perm.label, ok: 1,
    });
    res.json({ token, user: publicUser(au) });
  });

  // Подсказка с демо-доступами показывается ТОЛЬКО пока пароли остались стандартными.
  // Как только пароль сменили хотя бы у одной учётной записи — она исчезает из подсказки.
  app.get("/api/auth/demo-users", (_req, res) => {
    const stillDefault = DEMO_USERS.filter((d) => {
      const u = storage.userByLogin(d.login);
      if (!u) return false;
      try { return bcrypt.compareSync(d.password, u.passwordHash); } catch { return false; }
    });
    res.json({
      demo: stillDefault.map((d) => ({ login: d.login, password: d.password, role: d.role, label: ROLES[d.role].label })),
      note: stillDefault.length
        ? "Демо-доступы. Смените пароли перед рабочим запуском — после смены они здесь больше не показываются."
        : "Пароли изменены. Войдите под своими логином и паролем.",
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = tokenOf(req);
    if (token) {
      const s = storage.sessionByToken(token);
      if (s) {
        const u = storage.userById(s.userId);
        if (u) storage.addAudit({
          at: nowIso(), userId: u.id, login: u.login, role: u.role,
          action: "Выход из программы", entity: "Вход", details: "", ok: 1,
        });
      }
      storage.deleteSession(token);
    }
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req, res) => {
    const u = currentUser(req);
    if (!u) return res.status(401).json({ error: "Требуется вход в программу" });
    res.json(publicUser(u));
  });

  app.use(guard);
}

function tokenOf(req: Request): string {
  return String(req.headers["x-auth-token"] ?? req.query.token ?? "").trim();
}

export function currentUser(req: Request): AuthUser | null {
  if (req.authUser) return req.authUser;
  const token = tokenOf(req);
  if (!token) return null;
  const s = storage.sessionByToken(token);
  if (!s) return null;
  const u = storage.userById(s.userId);
  if (!u || !u.active) return null;
  const au = toAuthUser(u);
  req.authUser = au;
  return au;
}

/** Главный сторож: проверка входа, раздела, права записи и объектов */
function guard(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api")) return next();
  if (PUBLIC.includes(req.path) || req.path.startsWith("/api/auth/")) return next();

  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "Требуется вход в программу" });

  const isWrite = req.method !== "GET" && req.method !== "HEAD";
  const rule = sectionOf(req.path);

  if (rule && (isWrite || rule.readGuard) && !user.perm.sections.includes(rule.section)) {
    audit(req, "Отказано в доступе", rule.section, `${req.method} ${req.path}`, false);
    return res.status(403).json({
      error: `Раздел недоступен для роли «${user.perm.label}»`,
      section: rule.section, role: user.role,
    });
  }

  if (isWrite && !user.perm.write) {
    audit(req, "Отказано в изменении", rule?.section ?? "", `${req.method} ${req.path}`, false);
    return res.status(403).json({ error: `Роль «${user.perm.label}» работает только на чтение` });
  }

  // Привязка к объектам: запрет писать в чужой объект
  if (isWrite && user.objects.length) {
    const objId = Number((req.body as any)?.objectId ?? 0);
    if (objId && !user.objects.includes(objId)) {
      audit(req, "Отказано в доступе к объекту", String(objId), `${req.method} ${req.path}`, false);
      return res.status(403).json({ error: "Этот объект не закреплён за вашей учётной записью" });
    }
  }

  // Выгрузки с деньгами закрыты для ролей без финансовых прав
  // Здесь важны именно права роли, а не режим «без рублей»: в режиме контроля работ
  // директор по-прежнему выгружает всё в Excel.
  if (req.path.startsWith("/api/export/") && !(ROLES[user.role]?.finance ?? false)) {
    const key = req.path.split("/")[3] ?? "";
    if (["economics", "summary", "all"].includes(key)) {
      audit(req, "Отказано в выгрузке", key, "нет прав на денежные показатели", false);
      return res.status(403).json({
        error: `Выгрузка «${key}» содержит денежные показатели и недоступна для роли «${user.perm.label}»`,
      });
    }
  }

  // Журналирование значимых действий
  if (isWrite) audit(req, `${req.method} ${req.path}`, rule?.section ?? "", JSON.stringify(req.body ?? {}).slice(0, 200));
  if (req.method === "GET" && req.path.startsWith("/api/export/"))
    audit(req, "Выгрузка в Excel", req.path.replace("/api/export/", ""), "");

  // Фильтрация ответа
  const originalJson = res.json.bind(res);
  (res as any).json = (body: any) => {
    let out = body;
    if (user.objects.length) {
      const names = new Set(storage.objects().filter((o) => user.objects.includes(o.id)).map((o) => o.name));
      out = scopeArrays(out, user.objects, names);
      out = scopeText(out, names, storage.objects().map((o) => o.name));
    }
    if (!user.perm.finance) out = stripMoneyText(stripMoney(out));
    return originalJson(out);
  };
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const u = currentUser(req);
    if (!u) return res.status(401).json({ error: "Требуется вход в программу" });
    if (!roles.includes(u.role))
      return res.status(403).json({ error: "Действие доступно только генеральному директору" });
    next();
  };
}

/* ==================== Управление пользователями ==================== */

export function registerUserRoutes(app: Express) {
  app.get("/api/users", requireRole("director"), (_req, res) => {
    res.json(storage.users().map((u) => {
      const au = toAuthUser(u);
      return {
        id: u.id, login: u.login, fio: u.fio, role: u.role, roleLabel: au.perm.label,
        objectIds: au.objects, active: !!u.active, lastLogin: u.lastLogin, createdAt: u.createdAt,
      };
    }));
  });

  app.post("/api/users", requireRole("director"), (req, res) => {
    try {
      const v = insertUserSchema.parse(req.body);
      if (!v.password) throw new Error("Задайте пароль для нового пользователя");
      if (storage.userByLogin(v.login)) throw new Error("Пользователь с таким логином уже есть");
      const u = storage.createUser({
        login: v.login, passwordHash: bcrypt.hashSync(v.password, 10), fio: v.fio,
        role: v.role, objectIds: JSON.stringify(v.objectIds ?? []), active: v.active ? 1 : 0,
        createdAt: nowIso(), lastLogin: "",
      });
      audit(req, "Создан пользователь", u.login, `${ROLES[u.role].label}`);
      res.json({ id: u.id, login: u.login });
    } catch (e: any) {
      res.status(400).json({ error: e?.issues?.[0]?.message ?? e?.message ?? "Не удалось сохранить" });
    }
  });

  app.patch("/api/users/:id", requireRole("director"), (req, res) => {
    try {
      const id = Number(req.params.id);
      const cur = storage.userById(id);
      if (!cur) throw new Error("Пользователь не найден");
      const patch: any = {};
      if (req.body.fio !== undefined) patch.fio = String(req.body.fio);
      if (req.body.role !== undefined) {
        if (!ROLES[req.body.role]) throw new Error("Неизвестная роль");
        patch.role = req.body.role;
      }
      if (req.body.objectIds !== undefined)
        patch.objectIds = JSON.stringify((req.body.objectIds as any[]).map(Number));
      if (req.body.active !== undefined) patch.active = req.body.active ? 1 : 0;
      // Защита от самоблокировки: нельзя отключить или перевести в другую роль
      // единственную активную учётную запись директора — иначе войти будет некому.
      if (cur.role === "director" && cur.active === 1) {
        const otherActiveDirectors = storage
          .users()
          .filter((x) => x.id !== id && x.role === "director" && x.active === 1).length;
        const losesDirector =
          (patch.role !== undefined && patch.role !== "director") || patch.active === 0;
        if (losesDirector && otherActiveDirectors === 0) {
          throw new Error(
            "Нельзя отключить или сменить роль единственного директора — иначе в программу никто не сможет войти. Сначала создайте второго директора."
          );
        }
      }
      if (req.body.password) patch.passwordHash = bcrypt.hashSync(String(req.body.password), 10);
      if (patch.active === 0 || patch.passwordHash) storage.deleteSessionsOfUser(id);
      const u = storage.updateUser(id, patch);
      audit(req, "Изменён пользователь", u.login, Object.keys(patch).join(", "));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e?.message ?? "Не удалось сохранить" });
    }
  });

  app.delete("/api/users/:id", requireRole("director"), (req, res) => {
    const id = Number(req.params.id);
    const u = storage.userById(id);
    if (!u) return res.status(404).json({ error: "Пользователь не найден" });
    if (u.role === "director" && storage.users().filter((x) => x.role === "director" && x.active === 1).length < 2)
      return res.status(400).json({
        error:
          "Нельзя удалить единственного директора — иначе в программу никто не сможет войти. Сначала создайте второго директора.",
      });
    storage.deleteSessionsOfUser(id);
    storage.deleteUser(id);
    audit(req, "Удалён пользователь", u.login, "");
    res.json({ ok: true });
  });

  app.get("/api/audit", requireRole("director"), (req, res) => {
    res.json(storage.audit(Number(req.query.limit ?? 400)));
  });
}
