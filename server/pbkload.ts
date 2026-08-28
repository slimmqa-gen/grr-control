/**
 * Загрузка реальных файлов ООО «Производственно-Буровая Компания» в базу.
 * Данные ложатся в таблицы pbk_* и одновременно зеркалируются в рабочие
 * таблицы программы (объекты, станки, бригады, рапорты, описание и распиловка керна),
 * чтобы существующие 14 экранов показывали реальную картину вместо демо-данных.
 */
import fs from "fs";
import path from "path";
import { db, storage } from "./storage";
import { objects, rigs, brigades, employees, reports, coreLogs, coreCuts } from "@shared/schema";
import { pdb, clearPbkData, seedReasons, pbkCounts } from "./pbkdb";
import { parseWorkbook, PBK_PROFILES, PROFILE_NAME, type ParseResult } from "./pbkparse";
import { FILES_DIR } from "./paths";

export const PBK_DIR = FILES_DIR;
export const ORG_NAME = "ООО «Производственно-Буровая Компания»";

const CUSTOMERS: Record<string, string> = {
  "Ведуга": "ООО ГРК «Амикан»",
  "Линейный": "ООО «КСП Майнинг»",
  "Ергожу": "ЗАО «БПМК»",
  "Карахем": "ООО «КСП Майнинг»",
};
const CONTRACT_END: Record<string, string> = {
  "Ведуга": "2026-12-31", "Линейный": "2026-12-31", "Ергожу": "2027-12-31", "Карахем": "2027-03-31",
};

function insertRows(table: string, rows: any[]) {
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]).filter((k) => !k.startsWith("_"));
  const stmt = pdb.prepare(
    `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`
  );
  const tx = pdb.transaction((list: any[]) => {
    for (const r of list) stmt.run(cols.map((c) => (r[c] === undefined || r[c] === null ? (typeof r[c] === "number" ? 0 : "") : r[c])));
  });
  tx(rows);
  return rows.length;
}

function insertPlanLines(rows: any[]) {
  if (!rows.length) return 0;
  const cols = ["contract", "object", "no", "section", "name", "unit", "rate", "total_qty", "total_cost", "is_group", "work_kind", "sheet", "source_file"];
  const stmt = pdb.prepare(`INSERT INTO pbk_plan_lines (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
  const per = pdb.prepare(`INSERT INTO pbk_plan_periods (line_id, period, qty, cost) VALUES (?,?,?,?)`);
  const tx = pdb.transaction((list: any[]) => {
    for (const r of list) {
      const info = stmt.run(cols.map((c) => r[c] ?? (typeof r[c] === "number" ? 0 : "")));
      for (const p of r._periods ?? []) per.run(info.lastInsertRowid, p.period, p.qty, p.cost);
    }
  });
  tx(rows);
  return rows.length;
}

export type LoadReport = {
  org: string;
  files: Array<{
    file: string; profiles: string[]; loaded: number; skipped: number;
    sheets: Array<{ sheet: string; profile: string; profileName: string; loaded: number; skipped: number; notes: string[] }>;
  }>;
  counts: Record<string, number>;
  mirrored: Record<string, number>;
  at: string;
};

/** Разбор и загрузка всех файлов каталога */
export function loadPbkFiles(dir = PBK_DIR): LoadReport {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.xlsx?$/i.test(f) && !f.startsWith("~$")).sort() : [];
  const results: ParseResult[] = [];
  for (const f of files) {
    try {
      results.push(parseWorkbook(fs.readFileSync(path.join(dir, f)), f));
    } catch (e: any) {
      results.push({ file: f, profiles: [], entities: {}, sheets: [{ sheet: "-", profile: "", profileName: "ошибка", loaded: 0, skipped: 0, notes: [String(e?.message ?? e)] }], loaded: 0, skipped: 0, notes: [String(e?.message ?? e)] });
    }
  }

  clearPbkData();
  seedReasons();
  const ins = pdb.prepare(`INSERT INTO pbk_imports (at, file, profile, sheets, rows_loaded, rows_skipped, notes) VALUES (?,?,?,?,?,?,?)`);
  const at = new Date().toISOString();
  for (const r of results) {
    for (const [table, rows] of Object.entries(r.entities)) {
      if (!rows.length) continue;
      if (table === "pbk_plan_lines") insertPlanLines(rows);
      else insertRows(table, rows);
    }
    ins.run(at, r.file, r.profiles.join(", "), JSON.stringify(r.sheets.map((s) => s.sheet)), r.loaded, r.skipped, JSON.stringify(r.notes));
  }
  // счётчик использования профилей
  const up = pdb.prepare(`INSERT INTO pbk_profiles_state (code, name, enabled, uses, note) VALUES (?,?,1,?, '')
     ON CONFLICT(code) DO UPDATE SET uses = uses + excluded.uses, name = excluded.name`);
  for (const p of PBK_PROFILES) {
    const uses = results.reduce((a, r) => a + r.sheets.filter((s) => s.profile === p.code).length, 0);
    up.run(p.code, p.name, uses);
  }

  const mirrored = mirrorToWorkTables();
  storage.setSetting("orgName", ORG_NAME);
  storage.setSetting("dataMode", "pbk");
  return { org: ORG_NAME, at, counts: pbkCounts(), mirrored, files: results.map((r) => ({ file: r.file, profiles: r.profiles, loaded: r.loaded, skipped: r.skipped, sheets: r.sheets })) };
}

/** Перенос реальных данных в рабочие таблицы программы вместо демо-набора */
export function mirrorToWorkTables(): Record<string, number> {
  storage.fullReset();

  const shifts = pdb.prepare(`SELECT * FROM pbk_shifts`).all() as any[];
  const geo = pdb.prepare(`SELECT * FROM pbk_geo`).all() as any[];
  const planRates = pdb.prepare(`SELECT object, work_kind, rate FROM pbk_plan_lines WHERE rate>0 AND work_kind<>''`).all() as any[];

  const objNames = Array.from(new Set([
    ...shifts.map((s) => s.object).filter(Boolean),
    ...geo.map((g) => g.object).filter(Boolean),
    ...(pdb.prepare(`SELECT DISTINCT object o FROM pbk_plan_lines WHERE object<>''`).all() as any[]).map((r) => r.o),
  ]));
  const objIds: Record<string, number> = {};
  for (const name of objNames) {
    const sh = shifts.filter((s) => s.object === name);
    const meters = sh.reduce((a, s) => a + s.meters, 0);
    const months = new Set(sh.map((s) => String(s.date).slice(0, 7))).size || 1;
    const drillRate = planRates.find((r) => r.object === name && r.work_kind === "бурение")?.rate
      ?? planRates.find((r) => r.work_kind === "бурение")?.rate ?? 10155.46;
    const planLine = pdb.prepare(`SELECT SUM(total_qty) q FROM pbk_plan_lines WHERE object=? AND work_kind='бурение'`).get(name) as any;
    const row = db.insert(objects).values({
      name, customer: CUSTOMERS[name] ?? "заказчик не указан", region: "Красноярский край",
      planMetersMonth: Math.round(meters / months) || 1000,
      contractVolume: Math.round(planLine?.q || meters * 2) || 5000,
      contractEnd: CONTRACT_END[name] ?? "2026-12-31",
      pricePerMeter: Math.round(drillRate),
      plannedCostPerMeter: Math.round(drillRate * 0.78),
      staffRequired: 12,
    }).returning().get() as any;
    objIds[name] = row.id;
  }

  // станки и бригады
  const rigIds: Record<string, number> = {};
  const rigPairs = Array.from(new Set(shifts.map((s) => `${s.object}||${s.rig || "БУ без марки"}`)));
  for (const p of rigPairs) {
    const [obj, rig] = p.split("||");
    const row = db.insert(rigs).values({ name: rig, model: rig, objectId: objIds[obj] ?? 0, status: "в работе" }).returning().get() as any;
    rigIds[p] = row.id;
  }
  const brigIds: Record<string, number> = {};
  const brigPairs = Array.from(new Set(shifts.map((s) => `${s.object}||${s.master || "бригада"}`)));
  for (const p of brigPairs) {
    const [obj, master] = p.split("||");
    const row = db.insert(brigades).values({
      name: master, objectId: objIds[obj] ?? 0, staffPlan: 6,
    }).returning().get() as any;
    brigIds[p] = row.id;
  }

  // персонал: бурильщики и геологи-исполнители
  let staff = 0;
  const seenFio = new Set<string>();
  for (const s of shifts) {
    const fio = s.shift_master;
    if (!fio || seenFio.has(fio + s.object)) continue;
    seenFio.add(fio + s.object);
    db.insert(employees).values({
      fio, position: "бурильщик", objectId: objIds[s.object] ?? 0,
      brigadeId: brigIds[`${s.object}||${s.master || "бригада"}`] ?? 0, phone: "",
    }).run(); staff++;
  }
  for (const g of geo) {
    const fio = g.executor;
    if (!fio || fio.length > 60 || seenFio.has(fio + g.object)) continue;
    seenFio.add(fio + g.object);
    db.insert(employees).values({
      fio, position: g.kind === "опробование" ? "геолог (опробование)" : "геолог (документация)",
      objectId: objIds[g.object] ?? 0, brigadeId: 0, phone: "",
    }).run(); staff++;
  }

  // сменные рапорты: часов простоя в реальных сводках нет — считаем в сменах
  const insReport = pdb.prepare(`INSERT INTO reports
    (date, object_id, rig_id, brigade_id, shift, meters, drill_hours, pzr_hours, downtime_hours, downtime_reason, comment, hole_name, import_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`);
  const txR = pdb.transaction((list: any[]) => {
    for (const s of list) {
      insReport.run(
        s.date || "", objIds[s.object] ?? 0, rigIds[`${s.object}||${s.rig || "БУ без марки"}`] ?? 0,
        brigIds[`${s.object}||${s.master || "бригада"}`] ?? 0,
        s.shift_master || "смена", s.meters || 0, 0, 0, 0,
        s.meters > 0 ? "нет" : (s.loss_category || "Прочее"),
        s.comment || "", s.hole || "",
      );
    }
  });
  txR(shifts);

  // описание керна и распиловка
  const insLog = pdb.prepare(`INSERT INTO core_logs
    (date, object_id, hole_name, from_depth, to_depth, geologist_id, recovery_pct, lithology, mineralization, mineralization_note, photo, status, import_id)
    VALUES (?,?,?,?,?,0,100,?,?,?,0,'описано',0)`);
  const insCut = pdb.prepare(`INSERT INTO core_cuts
    (date, object_id, hole_name, from_depth, to_depth, worker, shift, cut_type, equipment_id, reject_meters, reject_reason, status, import_id)
    VALUES (?,?,?,?,?,?,'день','продольная',0,0,'', 'распилено',0)`);
  let logs = 0, cuts = 0;
  const txG = pdb.transaction((list: any[]) => {
    for (const g of list) {
      if (g.kind === "документация") {
        insLog.run(g.date || "", objIds[g.object] ?? 0, g.hole || "", g.from_m || 0, g.to_m || 0, "", 0, g.note || ""); logs++;
      } else {
        insCut.run(g.date || "", objIds[g.object] ?? 0, g.hole || "", g.from_m || 0, g.to_m || 0, g.executor || ""); cuts++;
      }
    }
  });
  txG(geo);

  return {
    "объекты": objNames.length, "станки": rigPairs.length, "сменные мастера": brigPairs.length,
    "сотрудники": staff, "сменные рапорты": shifts.length, "описание керна": logs, "распиловка/опробование": cuts,
  };
}

/** Первичная загрузка при старте сервера, если реальных данных ещё нет */
export function ensurePbkLoaded() {
  try {
    const c = (pdb.prepare(`SELECT COUNT(*) c FROM pbk_shifts`).get() as any).c;
    if (c > 0) return false;
    if (!fs.existsSync(PBK_DIR)) return false;
    loadPbkFiles();
    return true;
  } catch (e) {
    console.error("[ПБК] автозагрузка не выполнена:", e);
    return false;
  }
}

export { PROFILE_NAME };
