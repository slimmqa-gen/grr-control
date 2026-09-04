import {
  objects, rigs, brigades, reports, costs, fuel, inventory, employees, shifts, positions,
  importLogs, settings, equipment, costItems, inventoryItems, DEFAULT_THRESHOLDS, POSITIONS,
  labs, analysisTypes, samples, sampleMoves, labBatches, assays, coreLogs, coreCuts,
  users, sessions, auditLog, importProfiles, synonyms, excelTemplates,
  estimates, estimateLines, depthRates, calendarPlans, calendarStages, employeeEvents, dashboardNotes,
} from "@shared/schema";
import type {
  ObjectRow, Rig, Brigade, Report, Cost, Fuel, Inventory, Employee, Shift, Position, ImportLog, Thresholds,
  Equipment, CostItem, InventoryItem, Lab, AnalysisType, Sample, SampleMove, LabBatch, Assay,
  CoreLog, CoreCut, User, AuditRow, ImportProfile, Synonym, ExcelTemplateRow,
  Estimate, EstimateLine, DepthRate, CalendarPlan, CalendarStage, EmployeeEvent, DashboardNote,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { DB_PATH } from "./paths";
import { eq, asc, desc } from "drizzle-orm";
import { seedDatabase } from "./seed";

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");

sqlite.exec(`
CREATE TABLE IF NOT EXISTS objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, customer TEXT NOT NULL,
  region TEXT NOT NULL, plan_meters_month REAL NOT NULL, contract_volume REAL NOT NULL,
  contract_end TEXT NOT NULL, price_per_meter REAL NOT NULL,
  planned_cost_per_meter REAL NOT NULL, staff_required INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rigs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, model TEXT NOT NULL, object_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS brigades (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, object_id INTEGER NOT NULL, staff_plan INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, object_id INTEGER NOT NULL,
  rig_id INTEGER NOT NULL, brigade_id INTEGER NOT NULL, shift TEXT NOT NULL, meters REAL NOT NULL,
  drill_hours REAL NOT NULL, pzr_hours REAL NOT NULL, downtime_hours REAL NOT NULL,
  downtime_reason TEXT NOT NULL DEFAULT 'нет', comment TEXT NOT NULL DEFAULT '',
  hole_name TEXT NOT NULL DEFAULT '', import_id INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, object_id INTEGER NOT NULL, month TEXT NOT NULL,
  category TEXT NOT NULL, amount REAL NOT NULL, import_id INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS fuel (
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, object_id INTEGER NOT NULL,
  unit_name TEXT NOT NULL, norm_liters REAL NOT NULL, fact_liters REAL NOT NULL,
  import_id INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT, object_id INTEGER NOT NULL, item_name TEXT NOT NULL,
  qty REAL NOT NULL, unit TEXT NOT NULL, min_qty REAL NOT NULL, daily_use REAL NOT NULL,
  expected_delivery TEXT NOT NULL DEFAULT '', import_id INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fio TEXT NOT NULL, position TEXT NOT NULL,
  object_id INTEGER NOT NULL, brigade_id INTEGER NOT NULL, phone TEXT NOT NULL DEFAULT '',
  import_id INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, object_id INTEGER NOT NULL,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL, cycle_type TEXT NOT NULL,
  replacement_assigned INTEGER NOT NULL DEFAULT 0, import_id INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS import_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, file_name TEXT NOT NULL,
  data_type TEXT NOT NULL, rows_loaded INTEGER NOT NULL, rows_skipped INTEGER NOT NULL,
  rows_error INTEGER NOT NULL, author TEXT NOT NULL DEFAULT 'Аналитик',
  issues TEXT NOT NULL DEFAULT '[]', rolled_back INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'станок',
  object_id INTEGER NOT NULL DEFAULT 0, norm_liters REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS cost_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'шт',
  min_qty REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS labs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, city TEXT NOT NULL DEFAULT '',
  lead_days INTEGER NOT NULL DEFAULT 14, price_per_sample REAL NOT NULL DEFAULT 0,
  analyses TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS analysis_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, elements TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'г/т');
CREATE TABLE IF NOT EXISTS samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, date TEXT NOT NULL,
  object_id INTEGER NOT NULL DEFAULT 0, rig_id INTEGER NOT NULL DEFAULT 0,
  hole_name TEXT NOT NULL DEFAULT '', from_depth REAL NOT NULL DEFAULT 0,
  to_depth REAL NOT NULL DEFAULT 0, sample_type TEXT NOT NULL DEFAULT 'керновая',
  weight_kg REAL NOT NULL DEFAULT 0, geologist_id INTEGER NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'Отобрана', stage_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'в работе', reject_reason TEXT NOT NULL DEFAULT '',
  batch_id INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
  import_id INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS idx_samples_code ON samples(code);
CREATE TABLE IF NOT EXISTS sample_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sample_id INTEGER NOT NULL,
  from_stage TEXT NOT NULL DEFAULT '', to_stage TEXT NOT NULL, date TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'Пробоподготовка', note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS lab_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, lab_id INTEGER NOT NULL DEFAULT 0,
  analysis_type_id INTEGER NOT NULL DEFAULT 0, sent_date TEXT NOT NULL,
  due_date TEXT NOT NULL DEFAULT '', ship_method TEXT NOT NULL DEFAULT 'транспортная компания',
  waybill TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'в лаборатории',
  result_date TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS assays (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sample_id INTEGER NOT NULL, element TEXT NOT NULL DEFAULT 'Au',
  value REAL NOT NULL DEFAULT 0, unit TEXT NOT NULL DEFAULT 'г/т',
  received_date TEXT NOT NULL DEFAULT '', import_id INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS core_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, object_id INTEGER NOT NULL DEFAULT 0,
  hole_name TEXT NOT NULL DEFAULT '', from_depth REAL NOT NULL DEFAULT 0, to_depth REAL NOT NULL DEFAULT 0,
  geologist_id INTEGER NOT NULL DEFAULT 0, recovery_pct REAL NOT NULL DEFAULT 100,
  lithology TEXT NOT NULL DEFAULT '', mineralization INTEGER NOT NULL DEFAULT 0,
  mineralization_note TEXT NOT NULL DEFAULT '', photo INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'описано', import_id INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS core_cuts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, object_id INTEGER NOT NULL DEFAULT 0,
  hole_name TEXT NOT NULL DEFAULT '', from_depth REAL NOT NULL DEFAULT 0, to_depth REAL NOT NULL DEFAULT 0,
  worker TEXT NOT NULL DEFAULT '', shift TEXT NOT NULL DEFAULT 'день',
  cut_type TEXT NOT NULL DEFAULT 'продольная', equipment_id INTEGER NOT NULL DEFAULT 0,
  reject_meters REAL NOT NULL DEFAULT 0, reject_reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'распилено', import_id INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT NOT NULL, password_hash TEXT NOT NULL,
  fio TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'viewer',
  object_ids TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT '', last_login TEXT NOT NULL DEFAULT '');
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login ON users(login);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user_id INTEGER NOT NULL DEFAULT 0,
  login TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '', action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '', ok INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS import_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'drill',
  sheet_rule TEXT NOT NULL DEFAULT 'все', sheet_match TEXT NOT NULL DEFAULT '',
  header_row INTEGER NOT NULL DEFAULT 0, transposed INTEGER NOT NULL DEFAULT 0,
  mapping TEXT NOT NULL DEFAULT '{}', defaults TEXT NOT NULL DEFAULT '{}',
  signature TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT '',
  used_count INTEGER NOT NULL DEFAULT 0, last_used TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS synonyms (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'rig',
  alias TEXT NOT NULL, canonical TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS excel_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'data', base_type TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL, sheet_name TEXT NOT NULL DEFAULT 'Лист1',
  columns TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, object_id INTEGER NOT NULL DEFAULT 0,
  contract TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
  valid_from TEXT NOT NULL DEFAULT '', valid_to TEXT NOT NULL DEFAULT '',
  plan_meters REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS estimate_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT, estimate_id INTEGER NOT NULL,
  section TEXT NOT NULL DEFAULT 'прямые', item TEXT NOT NULL, work_type TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'руб.', qty REAL NOT NULL DEFAULT 0, price REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS depth_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, estimate_id INTEGER NOT NULL,
  drill_type TEXT NOT NULL DEFAULT 'колонковое', diameter TEXT NOT NULL DEFAULT 'HQ',
  from_depth REAL NOT NULL DEFAULT 0, to_depth REAL NOT NULL DEFAULT 0,
  price_per_meter REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS calendar_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT, object_id INTEGER NOT NULL DEFAULT 0,
  estimate_id INTEGER NOT NULL DEFAULT 0, month TEXT NOT NULL,
  plan_meters REAL NOT NULL DEFAULT 0, plan_cost REAL NOT NULL DEFAULT 0,
  work_type TEXT NOT NULL DEFAULT 'бурение', note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS calendar_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, object_id INTEGER NOT NULL DEFAULT 0,
  estimate_id INTEGER NOT NULL DEFAULT 0, stage TEXT NOT NULL,
  plan_start TEXT NOT NULL DEFAULT '', plan_end TEXT NOT NULL DEFAULT '',
  fact_start TEXT NOT NULL DEFAULT '', fact_end TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'план');
CREATE TABLE IF NOT EXISTS employee_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL,
  kind TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  destination TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS dashboard_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL,
  remind_date TEXT NOT NULL DEFAULT '', done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '');
`);

// Миграция: статус станка появился позже
try {
  const cols = sqlite.prepare("PRAGMA table_info(rigs)").all() as any[];
  if (!cols.some((c) => c.name === "status"))
    sqlite.exec("ALTER TABLE rigs ADD COLUMN status TEXT NOT NULL DEFAULT 'в работе'");
} catch {
  /* таблица только что создана — колонка уже есть */
}

// Миграция: номер скважины в сменных рапортах появился позже
try {
  const cols = sqlite.prepare("PRAGMA table_info(reports)").all() as any[];
  if (!cols.some((c) => c.name === "hole_name"))
    sqlite.exec("ALTER TABLE reports ADD COLUMN hole_name TEXT NOT NULL DEFAULT ''");
} catch {
  /* таблица только что создана */
}

// Миграция: ручной статус сотрудника (отпуск/больничный/командировка/обучение) появился позже
try {
  const cols = sqlite.prepare("PRAGMA table_info(employees)").all() as any[];
  if (!cols.some((c) => c.name === "manual_status"))
    sqlite.exec("ALTER TABLE employees ADD COLUMN manual_status TEXT NOT NULL DEFAULT ''");
  if (!cols.some((c) => c.name === "medical_exam_end_date")) sqlite.exec("ALTER TABLE employees ADD COLUMN medical_exam_end_date TEXT NOT NULL DEFAULT ''");
  if (!cols.some((c) => c.name === "work_status")) sqlite.exec("ALTER TABLE employees ADD COLUMN work_status TEXT NOT NULL DEFAULT 'office'");
} catch {
  /* таблица только что создана */
}

export const db = drizzle(sqlite);

// Справочник должностей заполняется списком по умолчанию только один раз,
// дальше его ведёт пользователь в разделе «Справочники».
try {
  const cnt = sqlite.prepare("SELECT COUNT(*) AS c FROM positions").get() as any;
  if (!cnt || cnt.c === 0) {
    const ins = sqlite.prepare("INSERT INTO positions (name) VALUES (?)");
    const known = new Set<string>();
    for (const p of POSITIONS) { ins.run(p); known.add(p.toLowerCase()); }
    // должности, уже встречающиеся у сотрудников (например, подтянутые из сводок)
    const used = sqlite.prepare("SELECT DISTINCT position FROM employees").all() as any[];
    for (const r of used) {
      const name = String(r.position ?? "").trim();
      if (name && !known.has(name.toLowerCase())) { ins.run(name); known.add(name.toLowerCase()); }
    }
  }
} catch {
  /* таблица только что создана */
}

export const storage = {
  objects: () => db.select().from(objects).orderBy(asc(objects.id)).all() as ObjectRow[],
  rigs: () => db.select().from(rigs).orderBy(asc(rigs.id)).all() as Rig[],
  brigades: () => db.select().from(brigades).orderBy(asc(brigades.id)).all() as Brigade[],
  reports: () => db.select().from(reports).all() as Report[],
  costs: () => db.select().from(costs).all() as Cost[],
  fuel: () => db.select().from(fuel).all() as Fuel[],
  inventory: () => db.select().from(inventory).all() as Inventory[],
  employees: () => db.select().from(employees).orderBy(asc(employees.id)).all() as Employee[],
  shifts: () => db.select().from(shifts).all() as Shift[],
  positions: () => db.select().from(positions).orderBy(asc(positions.id)).all() as Position[],
  createPosition: (v: any) => db.insert(positions).values(v).returning().get() as Position,
  updatePosition: (id: number, v: any) =>
    db.update(positions).set(v).where(eq(positions.id, id)).returning().get() as Position,
  deletePosition: (id: number) => db.delete(positions).where(eq(positions.id, id)).run(),
  equipment: () => db.select().from(equipment).orderBy(asc(equipment.id)).all() as Equipment[],
  costItems: () => db.select().from(costItems).orderBy(asc(costItems.id)).all() as CostItem[],
  inventoryItems: () =>
    db.select().from(inventoryItems).orderBy(asc(inventoryItems.id)).all() as InventoryItem[],

  // ---------- Пробоподготовка ----------
  labs: () => db.select().from(labs).orderBy(asc(labs.id)).all() as Lab[],
  analysisTypes: () => db.select().from(analysisTypes).orderBy(asc(analysisTypes.id)).all() as AnalysisType[],
  samples: () => db.select().from(samples).orderBy(asc(samples.id)).all() as Sample[],
  sampleMoves: () => db.select().from(sampleMoves).orderBy(asc(sampleMoves.id)).all() as SampleMove[],
  labBatches: () => db.select().from(labBatches).orderBy(asc(labBatches.id)).all() as LabBatch[],
  assays: () => db.select().from(assays).orderBy(asc(assays.id)).all() as Assay[],


  // ---------- Пользователи, сессии, журнал действий ----------
  users: () => db.select().from(users).orderBy(asc(users.id)).all() as User[],
  userById: (id: number) => db.select().from(users).where(eq(users.id, id)).get() as User | undefined,
  userByLogin: (login: string) =>
    db.select().from(users).where(eq(users.login, login)).get() as User | undefined,
  createUser: (v: any) => db.insert(users).values(v).returning().get() as User,
  updateUser: (id: number, v: any) =>
    db.update(users).set(v).where(eq(users.id, id)).returning().get() as User,
  deleteUser: (id: number) => db.delete(users).where(eq(users.id, id)).run(),

  createSession: (token: string, userId: number) =>
    db.insert(sessions).values({ token, userId, createdAt: new Date().toISOString() }).returning().get(),
  sessionByToken: (token: string) => db.select().from(sessions).where(eq(sessions.token, token)).get(),
  deleteSession: (token: string) => db.delete(sessions).where(eq(sessions.token, token)).run(),
  deleteSessionsOfUser: (userId: number) => db.delete(sessions).where(eq(sessions.userId, userId)).run(),

  audit: (limit = 400) =>
    db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(limit).all() as AuditRow[],
  addAudit: (v: any) => db.insert(auditLog).values(v).returning().get() as AuditRow,

  // ---------- Профили импорта и синонимы ----------
  profiles: () => db.select().from(importProfiles).orderBy(asc(importProfiles.id)).all() as ImportProfile[],
  profileById: (id: number) =>
    db.select().from(importProfiles).where(eq(importProfiles.id, id)).get() as ImportProfile | undefined,
  createProfile: (v: any) => db.insert(importProfiles).values(v).returning().get() as ImportProfile,
  updateProfile: (id: number, v: any) =>
    db.update(importProfiles).set(v).where(eq(importProfiles.id, id)).returning().get() as ImportProfile,
  deleteProfile: (id: number) => db.delete(importProfiles).where(eq(importProfiles.id, id)).run(),

  // ---------- Шаблоны Excel ----------
  templates: () => db.select().from(excelTemplates).orderBy(asc(excelTemplates.id)).all() as ExcelTemplateRow[],
  templateByCode: (code: string) =>
    db.select().from(excelTemplates).where(eq(excelTemplates.code, code)).get() as ExcelTemplateRow | undefined,
  saveTemplate: (v: any) => {
    const cur = db.select().from(excelTemplates).where(eq(excelTemplates.code, v.code)).get() as ExcelTemplateRow | undefined;
    if (cur) return db.update(excelTemplates).set(v).where(eq(excelTemplates.code, v.code)).returning().get() as ExcelTemplateRow;
    return db.insert(excelTemplates).values(v).returning().get() as ExcelTemplateRow;
  },
  deleteTemplate: (code: string) => db.delete(excelTemplates).where(eq(excelTemplates.code, code)).run(),

  synonyms: () => db.select().from(synonyms).orderBy(asc(synonyms.id)).all() as Synonym[],
  createSynonym: (v: any) => db.insert(synonyms).values(v).returning().get() as Synonym,
  updateSynonym: (id: number, v: any) =>
    db.update(synonyms).set(v).where(eq(synonyms.id, id)).returning().get() as Synonym,
  deleteSynonym: (id: number) => db.delete(synonyms).where(eq(synonyms.id, id)).run(),

  // ---------- Сметы и календарные планы ----------
  estimates: () => db.select().from(estimates).orderBy(asc(estimates.id)).all() as Estimate[],
  estimateLines: () => db.select().from(estimateLines).orderBy(asc(estimateLines.id)).all() as EstimateLine[],
  depthRates: () => db.select().from(depthRates).orderBy(asc(depthRates.id)).all() as DepthRate[],
  calendarPlans: () => db.select().from(calendarPlans).orderBy(asc(calendarPlans.month)).all() as CalendarPlan[],
  calendarStages: () => db.select().from(calendarStages).orderBy(asc(calendarStages.id)).all() as CalendarStage[],

  createEstimate: (v: any) => db.insert(estimates).values(v).returning().get() as Estimate,
  updateEstimate: (id: number, v: any) =>
    db.update(estimates).set(v).where(eq(estimates.id, id)).returning().get() as Estimate,
  deleteEstimate: (id: number) => {
    db.delete(estimateLines).where(eq(estimateLines.estimateId, id)).run();
    db.delete(depthRates).where(eq(depthRates.estimateId, id)).run();
    return db.delete(estimates).where(eq(estimates.id, id)).run();
  },
  createEstimateLine: (v: any) => db.insert(estimateLines).values(v).returning().get() as EstimateLine,
  updateEstimateLine: (id: number, v: any) =>
    db.update(estimateLines).set(v).where(eq(estimateLines.id, id)).returning().get() as EstimateLine,
  deleteEstimateLine: (id: number) => db.delete(estimateLines).where(eq(estimateLines.id, id)).run(),
  createDepthRate: (v: any) => db.insert(depthRates).values(v).returning().get() as DepthRate,
  deleteDepthRate: (id: number) => db.delete(depthRates).where(eq(depthRates.id, id)).run(),
  createCalendarPlan: (v: any) => db.insert(calendarPlans).values(v).returning().get() as CalendarPlan,
  updateCalendarPlan: (id: number, v: any) =>
    db.update(calendarPlans).set(v).where(eq(calendarPlans.id, id)).returning().get() as CalendarPlan,
  deleteCalendarPlan: (id: number) => db.delete(calendarPlans).where(eq(calendarPlans.id, id)).run(),
  employeeEvents: () => db.select().from(employeeEvents).orderBy(desc(employeeEvents.startDate)).all() as EmployeeEvent[],
  createEmployeeEvent: (v: any) => db.insert(employeeEvents).values(v).returning().get() as EmployeeEvent,
  updateEmployeeEvent: (id: number, v: any) =>
    db.update(employeeEvents).set(v).where(eq(employeeEvents.id, id)).returning().get() as EmployeeEvent,
  deleteEmployeeEvent: (id: number) => db.delete(employeeEvents).where(eq(employeeEvents.id, id)).run(),

  dashboardNotes: () => db.select().from(dashboardNotes).orderBy(desc(dashboardNotes.id)).all() as DashboardNote[],
  createDashboardNote: (v: any) => db.insert(dashboardNotes).values(v).returning().get() as DashboardNote,
  updateDashboardNote: (id: number, v: any) =>
    db.update(dashboardNotes).set(v).where(eq(dashboardNotes.id, id)).returning().get() as DashboardNote,
  deleteDashboardNote: (id: number) => db.delete(dashboardNotes).where(eq(dashboardNotes.id, id)).run(),

  createCalendarStage: (v: any) => db.insert(calendarStages).values(v).returning().get() as CalendarStage,
  updateCalendarStage: (id: number, v: any) =>
    db.update(calendarStages).set(v).where(eq(calendarStages.id, id)).returning().get() as CalendarStage,
  deleteCalendarStage: (id: number) => db.delete(calendarStages).where(eq(calendarStages.id, id)).run(),

  createSampleRaw: (v: any) => db.insert(samples).values(v).returning().get(),

  createLab: (v: any) => db.insert(labs).values(v).returning().get(),
  updateLab: (id: number, v: any) => db.update(labs).set(v).where(eq(labs.id, id)).returning().get(),
  deleteLab: (id: number) => db.delete(labs).where(eq(labs.id, id)).run(),

  createAnalysisType: (v: any) => db.insert(analysisTypes).values(v).returning().get(),
  updateAnalysisType: (id: number, v: any) =>
    db.update(analysisTypes).set(v).where(eq(analysisTypes.id, id)).returning().get(),
  deleteAnalysisType: (id: number) => db.delete(analysisTypes).where(eq(analysisTypes.id, id)).run(),

  createSample: (v: any) => db.insert(samples).values(v).returning().get() as Sample,
  updateSample: (id: number, v: any) =>
    db.update(samples).set(v).where(eq(samples.id, id)).returning().get() as Sample,
  deleteSample: (id: number) => {
    db.delete(assays).where(eq(assays.sampleId, id)).run();
    db.delete(sampleMoves).where(eq(sampleMoves.sampleId, id)).run();
    return db.delete(samples).where(eq(samples.id, id)).run();
  },
  createSampleMove: (v: any) => db.insert(sampleMoves).values(v).returning().get(),

  createLabBatch: (v: any) => db.insert(labBatches).values(v).returning().get() as LabBatch,
  updateLabBatch: (id: number, v: any) =>
    db.update(labBatches).set(v).where(eq(labBatches.id, id)).returning().get() as LabBatch,
  deleteLabBatch: (id: number) => {
    db.update(samples).set({ batchId: 0 }).where(eq(samples.batchId, id)).run();
    return db.delete(labBatches).where(eq(labBatches.id, id)).run();
  },

  createAssay: (v: any) => db.insert(assays).values(v).returning().get() as Assay,
  deleteAssay: (id: number) => db.delete(assays).where(eq(assays.id, id)).run(),

  // ---------- Керн: описание и распиловка ----------
  coreLogs: () => db.select().from(coreLogs).orderBy(asc(coreLogs.id)).all() as CoreLog[],
  coreCuts: () => db.select().from(coreCuts).orderBy(asc(coreCuts.id)).all() as CoreCut[],
  createCoreLog: (v: any) => db.insert(coreLogs).values(v).returning().get() as CoreLog,
  updateCoreLog: (id: number, v: any) =>
    db.update(coreLogs).set(v).where(eq(coreLogs.id, id)).returning().get() as CoreLog,
  deleteCoreLog: (id: number) => db.delete(coreLogs).where(eq(coreLogs.id, id)).run(),
  createCoreCut: (v: any) => db.insert(coreCuts).values(v).returning().get() as CoreCut,
  updateCoreCut: (id: number, v: any) =>
    db.update(coreCuts).set(v).where(eq(coreCuts.id, id)).returning().get() as CoreCut,
  deleteCoreCut: (id: number) => db.delete(coreCuts).where(eq(coreCuts.id, id)).run(),

  createEquipment: (v: any) => db.insert(equipment).values(v).returning().get(),
  updateEquipment: (id: number, v: any) =>
    db.update(equipment).set(v).where(eq(equipment.id, id)).returning().get(),
  deleteEquipment: (id: number) => db.delete(equipment).where(eq(equipment.id, id)).run(),

  createCostItem: (v: any) => db.insert(costItems).values(v).returning().get(),
  updateCostItem: (id: number, v: any) =>
    db.update(costItems).set(v).where(eq(costItems.id, id)).returning().get(),
  deleteCostItem: (id: number) => db.delete(costItems).where(eq(costItems.id, id)).run(),

  createInventoryItem: (v: any) => db.insert(inventoryItems).values(v).returning().get(),
  updateInventoryItem: (id: number, v: any) =>
    db.update(inventoryItems).set(v).where(eq(inventoryItems.id, id)).returning().get(),
  deleteInventoryItem: (id: number) =>
    db.delete(inventoryItems).where(eq(inventoryItems.id, id)).run(),

  deleteObject: (id: number) => db.delete(objects).where(eq(objects.id, id)).run(),
  deleteRig: (id: number) => db.delete(rigs).where(eq(rigs.id, id)).run(),
  deleteBrigade: (id: number) => db.delete(brigades).where(eq(brigades.id, id)).run(),

  /** Сколько данных завязано на элемент справочника */
  objectUsage: (id: number) => ({
    reports: db.select().from(reports).where(eq(reports.objectId, id)).all().length,
    rigs: db.select().from(rigs).where(eq(rigs.objectId, id)).all().length,
    brigades: db.select().from(brigades).where(eq(brigades.objectId, id)).all().length,
    costs: db.select().from(costs).where(eq(costs.objectId, id)).all().length,
    fuel: db.select().from(fuel).where(eq(fuel.objectId, id)).all().length,
    inventory: db.select().from(inventory).where(eq(inventory.objectId, id)).all().length,
    employees: db.select().from(employees).where(eq(employees.objectId, id)).all().length,
    shifts: db.select().from(shifts).where(eq(shifts.objectId, id)).all().length,
  }),
  rigUsage: (id: number) => ({
    reports: db.select().from(reports).where(eq(reports.rigId, id)).all().length,
  }),
  brigadeUsage: (id: number) => ({
    reports: db.select().from(reports).where(eq(reports.brigadeId, id)).all().length,
    employees: db.select().from(employees).where(eq(employees.brigadeId, id)).all().length,
  }),

  /** Каскадное удаление объекта со всеми связанными данными */
  deleteObjectCascade: (id: number) => {
    const brigadeIds = db.select().from(brigades).where(eq(brigades.objectId, id)).all().map((b: any) => b.id);
    db.delete(reports).where(eq(reports.objectId, id)).run();
    db.delete(costs).where(eq(costs.objectId, id)).run();
    db.delete(fuel).where(eq(fuel.objectId, id)).run();
    db.delete(inventory).where(eq(inventory.objectId, id)).run();
    db.delete(shifts).where(eq(shifts.objectId, id)).run();
    db.delete(employees).where(eq(employees.objectId, id)).run();
    for (const b of brigadeIds) db.delete(brigades).where(eq(brigades.id, b)).run();
    db.delete(rigs).where(eq(rigs.objectId, id)).run();
    db.delete(equipment).where(eq(equipment.objectId, id)).run();
    db.delete(objects).where(eq(objects.id, id)).run();
  },
  deleteRigCascade: (id: number) => {
    db.delete(reports).where(eq(reports.rigId, id)).run();
    db.delete(rigs).where(eq(rigs.id, id)).run();
  },
  deleteBrigadeCascade: (id: number) => {
    db.delete(reports).where(eq(reports.brigadeId, id)).run();
    db.delete(employees).where(eq(employees.brigadeId, id)).run();
    db.delete(brigades).where(eq(brigades.id, id)).run();
  },

  /** Очистка оперативных данных, справочники остаются */
  clearOperational: () => {
    const counts = {
      reports: db.delete(reports).run().changes,
      costs: db.delete(costs).run().changes,
      fuel: db.delete(fuel).run().changes,
      inventory: db.delete(inventory).run().changes,
      employees: db.delete(employees).run().changes,
      shifts: db.delete(shifts).run().changes,
      importLogs: db.delete(importLogs).run().changes,
      samples: (db.delete(assays).run(), db.delete(sampleMoves).run(), db.delete(labBatches).run(),
        db.delete(samples).run().changes),
      coreLogs: db.delete(coreLogs).run().changes,
      coreCuts: db.delete(coreCuts).run().changes,
    };
    return counts;
  },

  /** Полный сброс: удаляется всё, включая справочники */
  fullReset: () => {
    db.delete(reports).run();
    db.delete(costs).run();
    db.delete(fuel).run();
    db.delete(inventory).run();
    db.delete(employees).run();
    db.delete(shifts).run();
    db.delete(importLogs).run();
    db.delete(rigs).run();
    db.delete(brigades).run();
    db.delete(equipment).run();
    db.delete(costItems).run();
    db.delete(inventoryItems).run();
    db.delete(assays).run();
    db.delete(sampleMoves).run();
    db.delete(samples).run();
    db.delete(labBatches).run();
    db.delete(labs).run();
    db.delete(analysisTypes).run();
    db.delete(coreLogs).run();
    db.delete(coreCuts).run();
    db.delete(estimateLines).run();
    db.delete(depthRates).run();
    db.delete(estimates).run();
    db.delete(calendarPlans).run();
    db.delete(calendarStages).run();
    db.delete(objects).run();
    return { ok: true };
  },

  counts: () => ({
    objects: db.select().from(objects).all().length,
    rigs: db.select().from(rigs).all().length,
    brigades: db.select().from(brigades).all().length,
    equipment: db.select().from(equipment).all().length,
    costItems: db.select().from(costItems).all().length,
    inventoryItems: db.select().from(inventoryItems).all().length,
    reports: db.select().from(reports).all().length,
    costs: db.select().from(costs).all().length,
    fuel: db.select().from(fuel).all().length,
    inventory: db.select().from(inventory).all().length,
    employees: db.select().from(employees).all().length,
    shifts: db.select().from(shifts).all().length,
    importLogs: db.select().from(importLogs).all().length,
    labs: db.select().from(labs).all().length,
    analysisTypes: db.select().from(analysisTypes).all().length,
    samples: db.select().from(samples).all().length,
    labBatches: db.select().from(labBatches).all().length,
    assays: db.select().from(assays).all().length,
    coreLogs: db.select().from(coreLogs).all().length,
    coreCuts: db.select().from(coreCuts).all().length,
    estimates: db.select().from(estimates).all().length,
    calendarPlans: db.select().from(calendarPlans).all().length,
    users: db.select().from(users).all().length,
    profiles: db.select().from(importProfiles).all().length,
    templates: db.select().from(excelTemplates).all().length,
    synonyms: db.select().from(synonyms).all().length,
  }),

  createReport: (v: any) => db.insert(reports).values(v).returning().get(),
  updateReport: (id: number, v: any) => db.update(reports).set(v).where(eq(reports.id, id)).returning().get(),
  deleteReport: (id: number) => db.delete(reports).where(eq(reports.id, id)).run(),

  updateObject: (id: number, v: any) => db.update(objects).set(v).where(eq(objects.id, id)).returning().get(),

  createCost: (v: any) => db.insert(costs).values(v).returning().get(),
  deleteCost: (id: number) => db.delete(costs).where(eq(costs.id, id)).run(),

  createFuel: (v: any) => db.insert(fuel).values(v).returning().get(),
  deleteFuel: (id: number) => db.delete(fuel).where(eq(fuel.id, id)).run(),

  createInventory: (v: any) => db.insert(inventory).values(v).returning().get(),
  deleteInventory: (id: number) => db.delete(inventory).where(eq(inventory.id, id)).run(),

  createEmployee: (v: any) => db.insert(employees).values(v).returning().get() as Employee,
  updateEmployee: (id: number, v: any) =>
    db.update(employees).set(v).where(eq(employees.id, id)).returning().get() as Employee,
  deleteEmployee: (id: number) => {
    db.delete(shifts).where(eq(shifts.employeeId, id)).run();
    return db.delete(employees).where(eq(employees.id, id)).run();
  },

  createShift: (v: any) => db.insert(shifts).values(v).returning().get(),
  updateShift: (id: number, v: any) => db.update(shifts).set(v).where(eq(shifts.id, id)).returning().get(),
  deleteShift: (id: number) => db.delete(shifts).where(eq(shifts.id, id)).run(),

  createRig: (v: any) => db.insert(rigs).values(v).returning().get(),
  createBrigade: (v: any) => db.insert(brigades).values(v).returning().get(),
  createObject: (v: any) => db.insert(objects).values(v).returning().get(),
  updateBrigade: (id: number, v: any) => db.update(brigades).set(v).where(eq(brigades.id, id)).returning().get(),
  updateRig: (id: number, v: any) => db.update(rigs).set(v).where(eq(rigs.id, id)).returning().get(),

  importLogs: () => db.select().from(importLogs).orderBy(desc(importLogs.id)).all() as ImportLog[],
  createImportLog: (v: any) => db.insert(importLogs).values(v).returning().get() as ImportLog,
  updateImportLog: (id: number, v: any) =>
    db.update(importLogs).set(v).where(eq(importLogs.id, id)).returning().get() as ImportLog,
  rollbackImport: (id: number) => {
    const counts = { reports: 0, costs: 0, fuel: 0, inventory: 0, employees: 0, shifts: 0 };
    counts.reports = db.delete(reports).where(eq(reports.importId, id)).run().changes;
    counts.costs = db.delete(costs).where(eq(costs.importId, id)).run().changes;
    counts.fuel = db.delete(fuel).where(eq(fuel.importId, id)).run().changes;
    counts.inventory = db.delete(inventory).where(eq(inventory.importId, id)).run().changes;
    counts.shifts = db.delete(shifts).where(eq(shifts.importId, id)).run().changes;
    counts.employees = db.delete(employees).where(eq(employees.importId, id)).run().changes;
    (counts as any).assays = db.delete(assays).where(eq(assays.importId, id)).run().changes;
    (counts as any).coreLogs = db.delete(coreLogs).where(eq(coreLogs.importId, id)).run().changes;
    (counts as any).coreCuts = db.delete(coreCuts).where(eq(coreCuts.importId, id)).run().changes;
    db.update(importLogs).set({ rolledBack: 1 }).where(eq(importLogs.id, id)).run();
    return counts;
  },

  getThresholds: (): Thresholds => {
    const row = db.select().from(settings).where(eq(settings.key, "thresholds")).get();
    if (!row) return { ...DEFAULT_THRESHOLDS };
    try {
      return { ...DEFAULT_THRESHOLDS, ...JSON.parse(row.value) };
    } catch {
      return { ...DEFAULT_THRESHOLDS };
    }
  },
  getSetting: (key: string, fallback = "") => {
    const row = db.select().from(settings).where(eq(settings.key, key)).get();
    return row ? row.value : fallback;
  },
  setSetting: (key: string, value: string) => {
    const existing = db.select().from(settings).where(eq(settings.key, key)).get();
    if (existing) db.update(settings).set({ value }).where(eq(settings.key, key)).run();
    else db.insert(settings).values({ key, value }).run();
    return value;
  },

  setThresholds: (v: any) => {
    const value = JSON.stringify(v);
    const existing = db.select().from(settings).where(eq(settings.key, "thresholds")).get();
    if (existing) db.update(settings).set({ value }).where(eq(settings.key, "thresholds")).run();
    else db.insert(settings).values({ key: "thresholds", value }).run();
    return v;
  },
};

// Демо-данные заполняются только один раз — при самом первом запуске программы.
// Если пользователь потом вручную удалил все объекты, при перезапуске сервера
// демо-данные НЕ подставляются заново — база остаётся пустой, как он и оставил.
try {
  const seeded = db.select().from(settings).where(eq(settings.key, "demoSeeded")).get();
  if (!seeded) {
    seedDatabase(db);
    db.insert(settings).values({ key: "demoSeeded", value: "1" }).run();
  }
} catch {
  seedDatabase(db);
}

/** Восстановление демонстрационного набора: сначала полная очистка, затем генерация */
export function restoreDemoData() {
  storage.fullReset();
  seedDatabase(db, true);
  const existing = db.select().from(settings).where(eq(settings.key, "demoSeeded")).get();
  if (existing) db.update(settings).set({ value: "1" }).where(eq(settings.key, "demoSeeded")).run();
  else db.insert(settings).values({ key: "demoSeeded", value: "1" }).run();
  return storage.counts();
}
