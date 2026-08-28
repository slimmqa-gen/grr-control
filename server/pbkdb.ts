/**
 * Хранилище данных по реальным файлам ООО «Производственно-Буровая Компания».
 * Отдельный модуль: не затрагивает существующие таблицы демо-контура.
 */
import Database from "better-sqlite3";
import { DB_PATH } from "./paths";

export const pdb = new Database(DB_PATH);
pdb.pragma("journal_mode = WAL");

pdb.exec(`
CREATE TABLE IF NOT EXISTS pbk_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, sheet TEXT NOT NULL DEFAULT '', object TEXT NOT NULL DEFAULT '',
  contract TEXT NOT NULL DEFAULT '', master TEXT NOT NULL DEFAULT '', rig TEXT NOT NULL DEFAULT '',
  shift_master TEXT NOT NULL DEFAULT '', hole TEXT NOT NULL DEFAULT '', hole_project TEXT NOT NULL DEFAULT '',
  from_m REAL NOT NULL DEFAULT 0, to_m REAL NOT NULL DEFAULT 0, meters REAL NOT NULL DEFAULT 0,
  plan_depth REAL NOT NULL DEFAULT 0, comment TEXT NOT NULL DEFAULT '',
  loss_category TEXT NOT NULL DEFAULT '', incident INTEGER NOT NULL DEFAULT 0,
  source_file TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS pbk_geo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,              -- документация | опробование | распиловка
  date TEXT NOT NULL, sheet TEXT NOT NULL DEFAULT '', hole TEXT NOT NULL DEFAULT '',
  from_m REAL NOT NULL DEFAULT 0, to_m REAL NOT NULL DEFAULT 0, length_m REAL NOT NULL DEFAULT 0,
  executor TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  object TEXT NOT NULL DEFAULT '', source_file TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS pbk_holes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hole_pro TEXT NOT NULL DEFAULT '', td_pro REAL NOT NULL DEFAULT 0,
  hole TEXT NOT NULL DEFAULT '', tdepth REAL NOT NULL DEFAULT 0,
  azimuth REAL NOT NULL DEFAULT 0, dip REAL NOT NULL DEFAULT 0,
  x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0, z REAL NOT NULL DEFAULT 0,
  site TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '', year TEXT NOT NULL DEFAULT '',
  date_begin TEXT NOT NULL DEFAULT '', date_end TEXT NOT NULL DEFAULT '',
  geolog TEXT NOT NULL DEFAULT '', company TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '', contract TEXT NOT NULL DEFAULT '',
  planned INTEGER NOT NULL DEFAULT 0, source_file TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS pbk_geo_summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract TEXT NOT NULL DEFAULT '', object TEXT NOT NULL DEFAULT '',
  rig TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '',
  hole_project TEXT NOT NULL DEFAULT '', hole TEXT NOT NULL DEFAULT '',
  proj_depth REAL NOT NULL DEFAULT 0, proj_azimuth REAL NOT NULL DEFAULT 0, proj_dip REAL NOT NULL DEFAULT 0,
  fact_depth REAL NOT NULL DEFAULT 0, fact_azimuth REAL NOT NULL DEFAULT 0, fact_dip REAL NOT NULL DEFAULT 0,
  date_begin TEXT NOT NULL DEFAULT '', date_end TEXT NOT NULL DEFAULT '',
  doc_m REAL NOT NULL DEFAULT 0, doc_gap_m REAL NOT NULL DEFAULT 0,
  core_m REAL NOT NULL DEFAULT 0, core_samples REAL NOT NULL DEFAULT 0,
  chip_m REAL NOT NULL DEFAULT 0, chip_samples REAL NOT NULL DEFAULT 0,
  control_samples REAL NOT NULL DEFAULT 0, blank_samples REAL NOT NULL DEFAULT 0,
  standard_samples REAL NOT NULL DEFAULT 0, unsampled_note TEXT NOT NULL DEFAULT '',
  water_level REAL NOT NULL DEFAULT 0, documenter TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT '', zone TEXT NOT NULL DEFAULT '',
  source_file TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS pbk_litho (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hole TEXT NOT NULL DEFAULT '', from_m REAL NOT NULL DEFAULT 0, to_m REAL NOT NULL DEFAULT 0,
  thickness REAL NOT NULL DEFAULT 0, code TEXT NOT NULL DEFAULT '',
  v_sulf REAL NOT NULL DEFAULT 0, v_qz_sulf REAL NOT NULL DEFAULT 0, v_qz REAL NOT NULL DEFAULT 0,
  descr TEXT NOT NULL DEFAULT '', ore INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'скважина', source_file TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS pbk_prep (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, sheet TEXT NOT NULL DEFAULT '', shift TEXT NOT NULL DEFAULT '',
  crushed REAL NOT NULL DEFAULT 0, milled REAL NOT NULL DEFAULT 0,
  sample_type TEXT NOT NULL DEFAULT '', holes TEXT NOT NULL DEFAULT '',
  shipped REAL NOT NULL DEFAULT 0, received REAL NOT NULL DEFAULT 0, xrf REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '', source_file TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS pbk_prep_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet TEXT NOT NULL, queue INTEGER NOT NULL DEFAULT 0, days REAL NOT NULL DEFAULT 0,
  source_file TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS pbk_trenches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract TEXT NOT NULL DEFAULT '', site TEXT NOT NULL DEFAULT '', agr TEXT NOT NULL DEFAULT '',
  plan_len REAL NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT '',
  clean_m REAL NOT NULL DEFAULT 0, clean_pct REAL NOT NULL DEFAULT 0,
  doc_m REAL NOT NULL DEFAULT 0, doc_pct REAL NOT NULL DEFAULT 0,
  groove_n REAL NOT NULL DEFAULT 0, groove_m REAL NOT NULL DEFAULT 0,
  chip_n REAL NOT NULL DEFAULT 0, chip_m REAL NOT NULL DEFAULT 0,
  ctl1_n REAL NOT NULL DEFAULT 0, ctl2_n REAL NOT NULL DEFAULT 0,
  blank_n REAL NOT NULL DEFAULT 0, std_n REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '', source_file TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS pbk_trench_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, sheet TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL,
  agr TEXT NOT NULL DEFAULT '', from_m REAL NOT NULL DEFAULT 0, to_m REAL NOT NULL DEFAULT 0,
  length_m REAL NOT NULL DEFAULT 0, executor TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '', source_file TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS pbk_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'скважина', code TEXT NOT NULL DEFAULT '',
  core_n REAL NOT NULL DEFAULT 0, groove_n REAL NOT NULL DEFAULT 0, chip_n REAL NOT NULL DEFAULT 0,
  ctl1_n REAL NOT NULL DEFAULT 0, ctl2_n REAL NOT NULL DEFAULT 0,
  blank_n REAL NOT NULL DEFAULT 0, std_n REAL NOT NULL DEFAULT 0,
  total_n REAL NOT NULL DEFAULT 0, weight_kg REAL NOT NULL DEFAULT 0, bags REAL NOT NULL DEFAULT 0,
  ship_date TEXT NOT NULL DEFAULT '', ship_status TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '', source_file TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS pbk_plan_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract TEXT NOT NULL DEFAULT '', object TEXT NOT NULL DEFAULT '',
  no TEXT NOT NULL DEFAULT '', section TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '', rate REAL NOT NULL DEFAULT 0,
  total_qty REAL NOT NULL DEFAULT 0, total_cost REAL NOT NULL DEFAULT 0,
  is_group INTEGER NOT NULL DEFAULT 0, work_kind TEXT NOT NULL DEFAULT '',
  sheet TEXT NOT NULL DEFAULT '', source_file TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS pbk_plan_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_id INTEGER NOT NULL, period TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS pbk_cost_calc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '', qty REAL NOT NULL DEFAULT 0, price REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0, per_meter REAL NOT NULL DEFAULT 0,
  source_file TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS pbk_reasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL, keyword TEXT NOT NULL, builtin INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS pbk_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL, file TEXT NOT NULL, profile TEXT NOT NULL DEFAULT '',
  sheets TEXT NOT NULL DEFAULT '', rows_loaded INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '[]');

CREATE TABLE IF NOT EXISTS pbk_profiles_state (
  code TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '');
`);

/** Словарь причин потерянных смен — значения по умолчанию (редактируются в интерфейсе) */
export const DEFAULT_REASONS: Array<[string, string[]]> = [
  ["Подготовка площадки", ["готим площадку", "готовим площадку", "подготовка площадки", "площадку под бу", "планировка площадки", "подготовка буровой площадки"]],
  ["Перевозка и монтаж БУ", ["перевозка", "перегон", "переезд", "монтаж", "мобилизац", "передвижка"]],
  ["Демонтаж БУ", ["демонтаж", "разборка буровой"]],
  ["ГИС и каротаж", ["гис", "каротаж", "геофизик"]],
  ["Замер воды", ["замер воды", "уровень воды", "замер уровня"]],
  ["Ремонт и техника", ["ремонт", "поломк", "неисправ", "обрыв гидравлической", "замена п.р.и", "нехватка мощности", "то и тр", "чистка скважины"]],
  ["Прихват снаряда и аварии", ["прихват", "авари", "обрыв снаряда", "оставлен снаряд", "ликвидация аварии"]],
  ["Ожидание и простой", ["ожидание", "простой", "ждем", "ожидаем", "нет дизель", "нет воды", "закончились диски"]],
  ["Погода", ["погода", "дождь", "мороз", "актированн", "метель", "паводок"]],
  ["Камеральные работы", ["камеральн", "разметка", "документац", "бд", "отчет"]],
];

export function seedReasons(force = false) {
  if (force) pdb.prepare("DELETE FROM pbk_reasons").run();
  const n = pdb.prepare("SELECT COUNT(*) c FROM pbk_reasons").get() as any;
  if (n.c > 0) return;
  const ins = pdb.prepare("INSERT INTO pbk_reasons (category, keyword, builtin) VALUES (?,?,1)");
  for (const [cat, words] of DEFAULT_REASONS) for (const w of words) ins.run(cat, w);
}

export function reasonList(): Array<{ id: number; category: string; keyword: string; builtin: number }> {
  seedReasons();
  return pdb.prepare("SELECT * FROM pbk_reasons ORDER BY category, keyword").all() as any;
}

/** Категория непроизводительной работы по тексту комментария */
export function classifyComment(comment: string, rules?: Array<{ category: string; keyword: string }>): string {
  const text = (comment || "").toLowerCase().replace(/\s+/g, " ");
  if (!text.trim()) return "Без комментария";
  const list = rules ?? (reasonList() as any);
  for (const r of list) {
    if (r.keyword && text.includes(String(r.keyword).toLowerCase())) return r.category;
  }
  return "Прочее";
}

const INCIDENT_WORDS = ["прихват", "авари", "обрыв", "поломк", "ремонт", "оставлен снаряд"];
export function hasIncident(comment: string): boolean {
  const t = (comment || "").toLowerCase();
  return INCIDENT_WORDS.some((w) => t.includes(w));
}

export const PBK_TABLES = [
  "pbk_shifts", "pbk_geo", "pbk_geo_summary", "pbk_holes", "pbk_litho", "pbk_prep", "pbk_prep_queue",
  "pbk_trenches", "pbk_trench_daily", "pbk_moves", "pbk_plan_lines", "pbk_plan_periods",
  "pbk_cost_calc", "pbk_imports",
];

export function clearPbkData() {
  for (const t of PBK_TABLES) pdb.prepare(`DELETE FROM ${t}`).run();
  pdb.prepare("UPDATE pbk_profiles_state SET uses = 0").run();
}

export function pbkCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of PBK_TABLES) {
    out[t] = (pdb.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as any).c;
  }
  return out;
}
