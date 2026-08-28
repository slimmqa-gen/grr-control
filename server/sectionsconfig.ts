/**
 * Состав программы: хранение настроек разделов в базе, расчёт доступных ролям разделов,
 * пользовательские разделы-журналы и очистка данных одного раздела.
 * Модуль не зависит от auth.ts, чтобы не было кольцевых импортов.
 */
import { pdb, clearPbkData } from "./pbkdb";
import { storage } from "./storage";
import { ROLES, ROLE_KEYS } from "@shared/schema";
import {
  SECTION_CATALOG, CATALOG_KEYS, LOCKED_KEYS, DEFAULT_GROUPS, PRESETS,
  defaultConfig, type SectionsConfig, type SectionSetting, type CustomColumn,
} from "@shared/sections";

const KEY = "sections.config";

pdb.exec(`
CREATE TABLE IF NOT EXISTS custom_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  descr TEXT NOT NULL DEFAULT '',
  group_key TEXT NOT NULL DEFAULT 'prod',
  visible INTEGER NOT NULL DEFAULT 1,
  ord INTEGER NOT NULL DEFAULT 90,
  roles TEXT NOT NULL DEFAULT '[]',
  columns TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS custom_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  author TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '');
`);

const roleSectionsMap = (): Record<string, readonly string[]> =>
  Object.fromEntries(ROLE_KEYS.map((r) => [r, ROLES[r].sections as readonly string[]]));

/** Текущая конфигурация: дополняется значениями по умолчанию для новых разделов */
export function getConfig(): SectionsConfig {
  const base = defaultConfig(roleSectionsMap());
  let saved: Partial<SectionsConfig> = {};
  try { saved = JSON.parse(storage.getSetting(KEY, "") || "{}"); } catch { saved = {}; }
  const groups = (saved.groups?.length ? saved.groups : base.groups).map((g) => ({
    key: g.key, title: String(g.title ?? g.key), order: Number(g.order ?? 0), collapsed: !!g.collapsed,
  }));
  for (const g of DEFAULT_GROUPS) if (!groups.find((x) => x.key === g.key)) groups.push({ ...g });
  const items: Record<string, SectionSetting> = {};
  for (const key of CATALOG_KEYS) {
    const d = base.items[key];
    const s = saved.items?.[key];
    items[key] = {
      title: String(s?.title ?? d.title) || d.title,
      visible: s?.visible === undefined ? d.visible : !!s.visible,
      order: Number(s?.order ?? d.order),
      group: groups.find((g) => g.key === s?.group) ? String(s!.group) : d.group,
      roles: Array.isArray(s?.roles) ? s!.roles.filter((r) => ROLE_KEYS.includes(r)) : d.roles,
    };
  }
  return { groups, items, preset: String(saved.preset ?? "all") };
}

export function saveConfig(cfg: SectionsConfig) {
  storage.setSetting(KEY, JSON.stringify(cfg));
  return getConfig();
}

export function resetConfig() {
  storage.setSetting(KEY, "");
  return getConfig();
}

/** Применить готовый набор разделов */
export function applyPreset(name: string): SectionsConfig {
  const preset = PRESETS[name];
  if (!preset) throw new Error("Неизвестный набор разделов");
  const cfg = getConfig();
  for (const key of CATALOG_KEYS) {
    cfg.items[key].visible = preset.visible === "all" ? true : preset.visible.includes(key);
  }
  // пользовательские разделы в наборе «Всё включено» тоже показываем
  if (preset.visible === "all") pdb.prepare("UPDATE custom_sections SET visible = 1").run();
  cfg.preset = name;
  return saveConfig(cfg);
}

/* ==================== Пользовательские разделы ==================== */

export type CustomSection = {
  id: number; key: string; title: string; descr: string; group: string;
  visible: boolean; order: number; roles: string[]; columns: CustomColumn[]; createdAt: string;
};

const rowToCustom = (r: any): CustomSection => ({
  id: r.id, key: r.key, title: r.title, descr: r.descr, group: r.group_key,
  visible: !!r.visible, order: r.ord, createdAt: r.created_at,
  roles: safeJson(r.roles, []) as string[],
  columns: safeJson(r.columns, []) as CustomColumn[],
});

function safeJson(v: string, fallback: any) {
  try { return JSON.parse(v || ""); } catch { return fallback; }
}

export function customSections(): CustomSection[] {
  return pdb.prepare("SELECT * FROM custom_sections ORDER BY ord, id").all().map(rowToCustom);
}

export function customByKey(key: string): CustomSection | null {
  const r = pdb.prepare("SELECT * FROM custom_sections WHERE key = ?").get(key);
  return r ? rowToCustom(r) : null;
}

export function slugify(title: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  const base = title.toLowerCase().split("").map((c) => map[c] ?? c).join("")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "razdel";
  let key = base;
  let i = 2;
  while (customByKey(key)) key = `${base}-${i++}`;
  return key;
}

export function createCustomSection(v: {
  title: string; descr?: string; group?: string; roles?: string[]; columns: CustomColumn[];
}): CustomSection {
  const title = String(v.title ?? "").trim();
  if (!title) throw new Error("Укажите название раздела");
  const columns = normalizeColumns(v.columns);
  if (!columns.length) throw new Error("Добавьте хотя бы одну колонку");
  const key = slugify(title);
  const maxOrd = Number((pdb.prepare("SELECT MAX(ord) m FROM custom_sections").get() as any)?.m ?? 89);
  pdb.prepare(
    `INSERT INTO custom_sections (key, title, descr, group_key, visible, ord, roles, columns, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
  ).run(
    key, title, String(v.descr ?? ""), String(v.group ?? "prod"), maxOrd + 1,
    JSON.stringify((v.roles?.length ? v.roles : ["director"]).filter((r) => ROLE_KEYS.includes(r))),
    JSON.stringify(columns), new Date().toISOString(),
  );
  return customByKey(key)!;
}

export function normalizeColumns(cols: any[]): CustomColumn[] {
  const used = new Set<string>();
  return (cols ?? [])
    .filter((c) => String(c?.label ?? "").trim())
    .map((c, i) => {
      let key = `c${i + 1}`;
      while (used.has(key)) key = `${key}x`;
      used.add(key);
      const type = ["text", "number", "date", "list", "bool"].includes(c.type) ? c.type : "text";
      return {
        key,
        label: String(c.label).trim(),
        type,
        options: type === "list"
          ? String(c.options ?? "").split(/[;,\n]/).map((s: string) => s.trim()).filter(Boolean)
          : undefined,
        required: !!c.required,
      } as CustomColumn;
    });
}

export function updateCustomSection(key: string, patch: any): CustomSection {
  const cur = customByKey(key);
  if (!cur) throw new Error("Раздел не найден");
  const title = patch.title !== undefined ? String(patch.title).trim() || cur.title : cur.title;
  const visible = patch.visible === undefined ? cur.visible : !!patch.visible;
  const group = patch.group === undefined ? cur.group : String(patch.group);
  const order = patch.order === undefined ? cur.order : Number(patch.order);
  const roles = Array.isArray(patch.roles) ? patch.roles.filter((r: string) => ROLE_KEYS.includes(r)) : cur.roles;
  const columns = patch.columns ? normalizeColumns(patch.columns) : cur.columns;
  pdb.prepare(
    `UPDATE custom_sections SET title = ?, descr = ?, group_key = ?, visible = ?, ord = ?, roles = ?, columns = ?
     WHERE key = ?`,
  ).run(title, String(patch.descr ?? cur.descr), group, visible ? 1 : 0, order,
    JSON.stringify(roles), JSON.stringify(columns), key);
  return customByKey(key)!;
}

export function deleteCustomSection(key: string) {
  const cur = customByKey(key);
  if (!cur) throw new Error("Раздел не найден");
  pdb.prepare("DELETE FROM custom_records WHERE section_id = ?").run(cur.id);
  pdb.prepare("DELETE FROM custom_sections WHERE id = ?").run(cur.id);
  return { ok: true };
}

export type CustomRecord = { id: number; data: Record<string, any>; author: string; createdAt: string };

export function customRecords(sectionId: number): CustomRecord[] {
  return pdb.prepare("SELECT * FROM custom_records WHERE section_id = ? ORDER BY id DESC").all(sectionId)
    .map((r: any) => ({ id: r.id, data: safeJson(r.data, {}), author: r.author, createdAt: r.created_at }));
}

export function addCustomRecord(sec: CustomSection, data: Record<string, any>, author: string): CustomRecord {
  const clean: Record<string, any> = {};
  for (const c of sec.columns) {
    const raw = data?.[c.key];
    if (c.required && (raw === undefined || raw === null || String(raw).trim() === ""))
      throw new Error(`Заполните поле «${c.label}»`);
    if (c.type === "number") clean[c.key] = raw === "" || raw === undefined || raw === null ? null : Number(String(raw).replace(",", "."));
    else if (c.type === "bool") clean[c.key] = raw === true || raw === "да" || raw === "Да" || raw === 1 || raw === "1";
    else clean[c.key] = raw === undefined || raw === null ? "" : String(raw);
    if (c.type === "number" && clean[c.key] !== null && Number.isNaN(clean[c.key]))
      throw new Error(`Поле «${c.label}»: нужно число`);
  }
  const info = pdb.prepare(
    "INSERT INTO custom_records (section_id, data, author, created_at) VALUES (?, ?, ?, ?)",
  ).run(sec.id, JSON.stringify(clean), author, new Date().toISOString());
  return { id: Number(info.lastInsertRowid), data: clean, author, createdAt: new Date().toISOString() };
}

export function deleteCustomRecord(sectionId: number, id: number) {
  return pdb.prepare("DELETE FROM custom_records WHERE section_id = ? AND id = ?").run(sectionId, id);
}

export function clearCustomRecords(sectionId: number) {
  return pdb.prepare("DELETE FROM custom_records WHERE section_id = ?").run(sectionId).changes;
}

/* ==================== Доступ ==================== */

/** Разделы, реально доступные роли: матрица ролей ∩ настройка состава программы */
export function visibleSectionsFor(role: string): string[] {
  const cfg = getConfig();
  const base = (ROLES[role]?.sections ?? []) as readonly string[];
  const out: string[] = [];
  for (const key of CATALOG_KEYS) {
    const it = cfg.items[key];
    const allowedByRole = base.includes(key === "sections" ? "settings" : key) && it.roles.includes(role);
    const locked = role === "director" && LOCKED_KEYS.includes(key);
    if (locked || (it.visible && allowedByRole)) out.push(key);
  }
  for (const c of customSections()) {
    if (c.visible && c.roles.includes(role)) out.push(`custom:${c.key}`);
  }
  return out;
}

/** Денежные показатели показываем, только если раздел «Экономика» включён */
export function moneyEnabled(): boolean {
  return !!getConfig().items.economics?.visible;
}

/* ==================== Очистка данных раздела ==================== */

const SQL_TABLES = new Set(
  pdb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name),
);

export function clearSectionData(key: string): { section: string; deleted: Record<string, number>; total: number } {
  if (key.startsWith("custom:")) {
    const sec = customByKey(key.slice(7));
    if (!sec) throw new Error("Раздел не найден");
    const n = clearCustomRecords(sec.id);
    return { section: sec.title, deleted: { записей: n }, total: n };
  }
  const item = SECTION_CATALOG.find((s) => s.key === key);
  if (!item) throw new Error("Раздел не найден");
  if (!item.tables.length) throw new Error("У этого раздела нет собственных данных для очистки");
  const deleted: Record<string, number> = {};
  let total = 0;
  for (const t of item.tables) {
    if (t === "pbk") {
      clearPbkData();
      deleted["данные ПБК"] = 1;
      total += 1;
      continue;
    }
    const names: Set<string> = new Set(
      pdb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name),
    );
    if (!names.has(t) && !SQL_TABLES.has(t)) continue;
    const n = pdb.prepare(`DELETE FROM ${t}`).run().changes;
    deleted[t] = n;
    total += n;
  }
  return { section: item.title, deleted, total };
}
