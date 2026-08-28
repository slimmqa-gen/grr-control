import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { storage } from "./storage";
import { IMPORT_FIELDS, DATA_TYPES, DOWNTIME_REASONS, COST_CATEGORIES, CORE_LOG_STATUSES, CUT_STATUSES, CUT_TYPES, REFS_SHEETS } from "@shared/schema";
import type { DataType } from "@shared/schema";
import { templateAliases, refsOverride } from "./templates";

export type ParsedFile = {
  uploadId: string;
  fileName: string;
  headers: string[];
  rows: (string | number | null)[][];
  totalRows: number;
  suggestedType: DataType;
  suggestedMapping: Record<string, string>;
};

const cache = new Map<string, { fileName: string; headers: string[]; rows: any[][]; at: number }>();

const norm = (s: any) =>
  String(s ?? "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]/g, "");

function cellToValue(v: any): string | number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("text" in v) return String((v as any).text);
    if ("result" in v) return (v as any).result ?? null;
    if ("richText" in v) return (v as any).richText.map((t: any) => t.text).join("");
    return String(v);
  }
  return v as any;
}

function parseCsv(buf: Buffer): any[][] {
  const text = buf.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  const delim = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  return lines.map((l) =>
    l.split(delim).map((c) => {
      const t = c.trim().replace(/^"|"$/g, "");
      return t;
    }));
}

const isOldXlsBuffer = (buffer: Buffer, fileName: string) =>
  /\.xls$/i.test(fileName) ||
  (buffer.length > 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0);

function parseOldXls(buffer: Buffer): any[][] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch {
    throw new Error("Не удалось прочитать файл. Убедитесь, что это исправный файл Excel (.xls/.xlsx) или CSV.");
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("В файле не найдено ни одного листа");
  return XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false, defval: null }) as any[][];
}

export async function parseUpload(buffer: Buffer, fileName: string): Promise<ParsedFile> {
  let matrix: any[][] = [];
  if (/\.csv$/i.test(fileName)) {
    matrix = parseCsv(buffer);
  } else if (isOldXlsBuffer(buffer, fileName)) {
    matrix = parseOldXls(buffer);
  } else {
    let wb: ExcelJS.Workbook;
    try {
      wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as any);
    } catch {
      throw new Error(
        "Не удалось прочитать файл как Excel (.xlsx). Проверьте, что файл не повреждён и действительно " +
        "имеет формат .xlsx/.xls/.csv."
      );
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new Error("В файле не найдено ни одного листа");
    ws.eachRow((row) => {
      const vals = (row.values as any[]).slice(1).map(cellToValue);
      matrix.push(vals);
    });
  }
  if (!matrix.length) throw new Error("Файл пустой — нет ни одной строки");

  // Найти строку заголовков (первая строка, где >=2 непустых текстовых ячейки)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const filled = matrix[i].filter((c) => c !== null && String(c).trim() !== "");
    if (filled.length >= 2) { headerIdx = i; break; }
  }
  const headers = matrix[headerIdx].map((h, i) => String(h ?? "").trim() || `Колонка ${i + 1}`);
  const rows = matrix.slice(headerIdx + 1).filter((r) => r.some((c) => c !== null && String(c).trim() !== ""));

  // Определение типа по заголовкам
  const scores = (Object.keys(DATA_TYPES) as DataType[]).map((type) => {
    const fields = IMPORT_FIELDS[type];
    const extra = templateAliases(type);
    let score = 0;
    headers.forEach((h) => {
      const nh = norm(h).replace(/\*/g, "");
      if (fields.some((f) =>
        f.aliases.includes(nh) || norm(f.label) === nh || (extra[f.key] ?? []).includes(nh))) score++;
    });
    const required = fields.filter((f) => f.required).length;
    return { type, score: score / Math.max(1, required) };
  }).sort((a, b) => b.score - a.score);
  const suggestedType = scores[0].type;

  const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  cache.set(uploadId, { fileName, headers, rows, at: Date.now() });
  for (const [k, v] of cache) if (Date.now() - v.at > 3600_000) cache.delete(k);

  return {
    uploadId, fileName, headers,
    rows: rows.slice(0, 200),
    totalRows: rows.length,
    suggestedType,
    suggestedMapping: suggestMapping(headers, suggestedType),
  };
}

export function suggestMapping(headers: string[], type: DataType): Record<string, string> {
  const map: Record<string, string> = {};
  const extra = templateAliases(type);
  IMPORT_FIELDS[type].forEach((f) => {
    const aliases = [...f.aliases, ...(extra[f.key] ?? [])];
    const idx = headers.findIndex((h) => {
      const nh = norm(h).replace(/\*/g, "");
      return nh === norm(f.label) || aliases.includes(nh);
    });
    const idx2 = idx >= 0 ? idx : headers.findIndex((h) => aliases.some((a) => norm(h).startsWith(a) && a.length > 2));
    map[f.key] = idx2 >= 0 ? String(idx2) : "";
  });
  return map;
}

export type RowIssue = { row: number; level: "ошибка" | "предупреждение"; message: string };
export type PreviewResult = {
  fields: { key: string; label: string; required: boolean }[];
  headers: string[];
  preview: { row: number; values: Record<string, any>; issues: RowIssue[]; duplicate: boolean }[];
  issues: RowIssue[];
  totals: { total: number; valid: number; errors: number; duplicates: number };
  unknownRefs: { type: string; value: string }[];
  allItems?: { row: number; values: Record<string, any>; issues: RowIssue[]; duplicate: boolean }[];
};

const numOf = (v: any): number | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(/\u00a0/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const dateOf = (v: any): string | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const n = Number(s);
  if (Number.isFinite(n) && n > 20000 && n < 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const monthOfValue = (v: any): string | null => {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})[-.\/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-.\/](\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  const d = dateOf(v);
  return d ? d.slice(0, 7) : null;
};

function findRef<T extends { id: number; name: string }>(list: T[], value: any): T | undefined {
  const nv = norm(value);
  if (!nv) return undefined;
  return list.find((x) => norm(x.name) === nv)
    ?? list.find((x) => norm(x.name).includes(nv) || nv.includes(norm(x.name)));
}

export function analyzeRows(uploadId: string, type: DataType, mapping: Record<string, string>): PreviewResult {
  const cached = cache.get(uploadId);
  if (!cached) throw new Error("Файл не найден или срок хранения истёк. Загрузите файл заново.");
  const { headers, rows } = cached;
  const objects = storage.objects();
  const rigs = storage.rigs();
  const brigades = storage.brigades();
  const existingReports = storage.reports();
  const fields = IMPORT_FIELDS[type];
  const allSamples = type === "assays" ? storage.samples() : [];
  const existingAssays = type === "assays" ? storage.assays() : [];
  const employeesRef = type === "corelogs" ? storage.employees().map((e) => ({ id: e.id, name: e.fio })) : [];
  const intervalIndex = new Map<string, { from: number; to: number; src: string }[]>();
  if (type === "corelogs" || type === "corecuts") {
    const rowsRef: { holeName: string; fromDepth: number; toDepth: number }[] =
      type === "corelogs" ? storage.coreLogs() : storage.coreCuts();
    rowsRef.forEach((r) => {
      const arr = intervalIndex.get(r.holeName) ?? [];
      arr.push({ from: r.fromDepth, to: r.toDepth, src: "база" });
      intervalIndex.set(r.holeName, arr);
    });
  }
  const yesNo = (v: any, def = false) => {
    if (v === null || v === undefined || String(v).trim() === "") return def ? 1 : 0;
    const s = norm(v);
    return ["да", "1", "true", "есть", "yes", "y", "+"].includes(s) ? 1 : 0;
  };

  const get = (row: any[], key: string) => {
    const idx = mapping[key];
    if (idx === undefined || idx === "") return null;
    return row[Number(idx)] ?? null;
  };

  const allIssues: RowIssue[] = [];
  const unknown = new Map<string, { type: string; value: string }>();
  const items: PreviewResult["preview"] = [];
  let errors = 0, duplicates = 0;

  rows.forEach((row, i) => {
    const rowNo = i + 2;
    const issues: RowIssue[] = [];
    const values: Record<string, any> = {};
    let duplicate = false;

    const req = (key: string, label: string) => {
      const v = get(row, key);
      if (v === null || String(v).trim() === "") {
        issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: не заполнено поле «${label}»` });
        return null;
      }
      return v;
    };

    const objRef = (key = "object") => {
      const raw = req(key, "Объект");
      if (raw === null) return null;
      const o = findRef(objects, raw);
      if (!o) {
        issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: неизвестный объект — ${raw}. Добавьте объект в справочник в разделе «Настройки».` });
        unknown.set("объект" + norm(raw), { type: "Объект", value: String(raw) });
        return null;
      }
      values.object = o.name;
      return o;
    };

    if (type === "reports") {
      const d = dateOf(req("date", "Дата"));
      if (get(row, "date") !== null && !d)
        issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: не удалось распознать дату — ${get(row, "date")}` });
      values.date = d;
      const o = objRef();
      const rawRig = req("rig", "Станок");
      let rig = rawRig !== null ? findRef(rigs, rawRig) : undefined;
      if (rawRig !== null && !rig) {
        issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: неизвестный станок — ${rawRig}. Добавить в справочник?` });
        unknown.set("станок" + norm(rawRig), { type: "Станок", value: String(rawRig) });
      }
      values.rig = rig?.name ?? rawRig;
      const rawBr = get(row, "brigade");
      const br = rawBr ? findRef(brigades, rawBr) : undefined;
      if (rawBr && !br) {
        issues.push({ row: rowNo, level: "предупреждение", message: `Строка ${rowNo}: неизвестный сменный мастер — ${rawBr}, будет подставлен мастер объекта` });
        unknown.set("бригада" + norm(rawBr), { type: "Сменный мастер", value: String(rawBr) });
      }
      values.brigade = br?.name ?? rawBr ?? "";
      const shiftRaw = norm(get(row, "shift"));
      values.shift = shiftRaw.startsWith("н") || shiftRaw === "2" ? "ночь" : "день";
      const m = numOf(get(row, "meters"));
      if (m === null) issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: не заполнены метры` });
      else if (m < 0) issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: метры не могут быть отрицательными (${m})` });
      values.meters = m;
      const dh = numOf(get(row, "drillHours")) ?? 0;
      const ph = numOf(get(row, "pzrHours")) ?? 0;
      const oh = numOf(get(row, "downtimeHours")) ?? 0;
      if (dh + ph + oh > 12)
        issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: сумма часов больше 12 (${dh + ph + oh} ч)` });
      values.drillHours = dh; values.pzrHours = ph; values.downtimeHours = oh;
      const reasonRaw = String(get(row, "downtimeReason") ?? "").trim();
      let reason = reasonRaw ? (DOWNTIME_REASONS.find((x) => norm(x) === norm(reasonRaw)) ?? "прочее") : "нет";
      if (reasonRaw && reason === "прочее" && norm(reasonRaw) !== norm("прочее"))
        issues.push({ row: rowNo, level: "предупреждение", message: `Строка ${rowNo}: причина простоя «${reasonRaw}» не из справочника, записана как «прочее»` });
      if (oh > 0 && reason === "нет")
        issues.push({ row: rowNo, level: "предупреждение", message: `Строка ${rowNo}: указан простой ${oh} ч без причины` });
      values.downtimeReason = reason;
      values.comment = String(get(row, "comment") ?? "");
      if (d && rig && o) {
        duplicate = existingReports.some((r) => r.date === d && r.rigId === rig!.id && r.shift === values.shift);
        if (duplicate)
          issues.push({ row: rowNo, level: "предупреждение", message: `Строка ${rowNo}: рапорт за ${d}, станок ${rig.name}, смена ${values.shift} уже есть в базе` });
      }
    }

    if (type === "costs") {
      objRef();
      const mo = monthOfValue(req("month", "Месяц"));
      if (get(row, "month") !== null && !mo)
        issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: не удалось распознать месяц — ${get(row, "month")}` });
      values.month = mo;
      const catRaw = req("category", "Статья затрат");
      const cat = catRaw ? (COST_CATEGORIES.find((c) => norm(c) === norm(catRaw)) ?? "Прочее/накладные") : null;
      if (catRaw && cat === "Прочее/накладные" && norm(catRaw) !== norm("Прочее/накладные"))
        issues.push({ row: rowNo, level: "предупреждение", message: `Строка ${rowNo}: статья «${catRaw}» не из справочника, отнесена к «Прочее/накладные»` });
      values.category = cat;
      const a = numOf(get(row, "amount"));
      if (a === null) issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: не заполнена сумма затрат` });
      else if (a < 0) issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: сумма не может быть отрицательной` });
      values.amount = a;
    }

    if (type === "fuel") {
      const d = dateOf(req("date", "Дата"));
      if (get(row, "date") !== null && !d)
        issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: не удалось распознать дату — ${get(row, "date")}` });
      values.date = d;
      objRef();
      values.unitName = String(req("unitName", "Единица техники") ?? "");
      const n = numOf(get(row, "normLiters"));
      const f = numOf(get(row, "factLiters"));
      if (n === null) issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: не заполнена норма расхода` });
      if (f === null) issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: не заполнен фактический расход` });
      values.normLiters = n; values.factLiters = f;
    }

    if (type === "inventory") {
      values.itemName = String(req("itemName", "Позиция") ?? "");
      objRef();
      const q = numOf(get(row, "qty"));
      if (q === null) issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: не заполнен остаток` });
      values.qty = q;
      values.unit = String(get(row, "unit") ?? "шт");
      values.minQty = numOf(get(row, "minQty")) ?? 0;
      values.dailyUse = numOf(get(row, "dailyUse")) ?? 0;
      values.expectedDelivery = dateOf(get(row, "expectedDelivery")) ?? "";
    }

    if (type === "crew") {
      values.fio = String(req("fio", "ФИО") ?? "");
      values.position = String(get(row, "position") ?? "Бурильщик");
      const o = objRef();
      const rawBr = get(row, "brigade");
      const br = rawBr ? findRef(brigades, rawBr) : (o ? brigades.find((b) => b.objectId === o.id) : undefined);
      if (rawBr && !br)
        issues.push({ row: rowNo, level: "предупреждение", message: `Строка ${rowNo}: неизвестный сменный мастер — ${rawBr}, будет подставлен мастер объекта` });
      values.brigade = br?.name ?? "";
      const sd = dateOf(req("startDate", "Дата заезда"));
      if (get(row, "startDate") !== null && !sd)
        issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: не удалось распознать дату заезда` });
      values.startDate = sd;
      const cycleRaw = String(get(row, "cycleType") ?? "30/30").replace(/\s/g, "");
      values.cycleType = /^\d+\/\d+$/.test(cycleRaw) ? cycleRaw : "30/30";
      values.phone = String(get(row, "phone") ?? "");
    }

    if (type === "employees") {
      const fio = String(req("fio", "ФИО") ?? "").replace(/\s+/g, " ").trim();
      values.fio = fio;
      const pos = String(get(row, "position") ?? "").replace(/\s+/g, " ").trim();
      values.position = pos || "Не указана";
      const rawObj = get(row, "object");
      if (rawObj !== null && String(rawObj).trim() !== "") {
        const o = findRef(objects, rawObj);
        if (!o) {
          issues.push({ row: rowNo, level: "предупреждение", message: `Строка ${rowNo}: неизвестный объект — ${rawObj}. Сотрудник будет добавлен без объекта.` });
          unknown.set("объект" + norm(rawObj), { type: "Объект", value: String(rawObj) });
        }
        values.object = o?.name ?? "";
      } else values.object = "";
      values.phone = String(get(row, "phone") ?? "").trim();
      const rawStart = get(row, "startDate");
      const sd = rawStart !== null && String(rawStart).trim() !== "" ? dateOf(rawStart) : null;
      if (rawStart !== null && String(rawStart).trim() !== "" && !sd)
        issues.push({ row: rowNo, level: "предупреждение", message: `Строка ${rowNo}: не удалось распознать дату заезда — вахта не будет назначена.` });
      values.startDate = sd ?? "";
      const cycleRaw = String(get(row, "cycleType") ?? "").replace(/\s/g, "");
      values.cycleType = /^\d+\/\d+$/.test(cycleRaw) ? cycleRaw : (sd ? "30/30" : "");
      if (values.startDate && !values.object)
        issues.push({ row: rowNo, level: "предупреждение", message: `Строка ${rowNo}: вахта будет назначена без объекта.` });
      if (fio) {
        duplicate = storage.employees().some((e) => norm(e.fio) === norm(fio))
          || items.some((it) => norm(it.values.fio) === norm(fio));
        if (duplicate)
          issues.push({ row: rowNo, level: "предупреждение", message: `Строка ${rowNo}: сотрудник ${fio} уже есть в списке` });
      }
    }

    if (type === "assays") {
      const code = String(req("sampleCode", "Номер пробы") ?? "").trim();
      values.sampleCode = code;
      const smp = code ? allSamples.find((s) => norm(s.code) === norm(code)) : undefined;
      if (code && !smp)
        issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: проба ${code} не найдена в журнале проб. Сначала внесите пробу в раздел «Пробоподготовка».` });
      values.sampleId = smp?.id ?? null;
      const el = String(req("element", "Элемент") ?? "").trim();
      values.element = el;
      const val = numOf(get(row, "value"));
      if (val === null) issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: не заполнено содержание` });
      else if (val < 0) issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: содержание не может быть отрицательным` });
      values.value = val;
      values.unit = String(get(row, "unit") ?? (el === "Cu" || el === "Pb" || el === "Zn" ? "%" : "г/т"));
      values.receivedDate = dateOf(get(row, "receivedDate")) ?? new Date().toISOString().slice(0, 10);
      if (smp && existingAssays.some((a) => a.sampleId === smp.id && norm(a.element) === norm(el))) {
        duplicate = true;
        issues.push({ row: rowNo, level: "предупреждение", message: `Строка ${rowNo}: результат по пробе ${code} и элементу ${el} уже загружен` });
      }
    }

    if (type === "corelogs" || type === "corecuts") {
      const d = dateOf(req("date", "Дата"));
      if (get(row, "date") !== null && !d)
        issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: не удалось распознать дату` });
      values.date = d;
      objRef();
      const hole = String(req("hole", "Скважина") ?? "").trim();
      values.hole = hole;
      const from = numOf(get(row, "fromDepth"));
      const to = numOf(get(row, "toDepth"));
      if (from === null) issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: не заполнен интервал «от»` });
      if (to === null) issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: не заполнен интервал «до»` });
      if (from !== null && to !== null && to <= from)
        issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: интервал ${from}–${to} м некорректен, «до» должно быть больше «от»` });
      values.fromDepth = from; values.toDepth = to;

      if (hole && from !== null && to !== null && to > from) {
        const prev = intervalIndex.get(hole) ?? [];
        const clash = prev.find((p) => from < p.to && to > p.from);
        if (clash)
          issues.push({
            row: rowNo, level: "предупреждение",
            message: `Строка ${rowNo}: интервал ${from}–${to} м по скважине ${hole} пересекается с уже внесённым ${clash.from}–${clash.to} м (${clash.src})`,
          });
        prev.push({ from, to, src: "файл" });
        intervalIndex.set(hole, prev);
      }
    }

    if (type === "corelogs") {
      const rawG = get(row, "geologist");
      const g = rawG ? findRef(employeesRef as any, rawG) : undefined;
      if (rawG && !g)
        issues.push({ row: rowNo, level: "предупреждение", message: `Строка ${rowNo}: геолог «${rawG}» не найден в справочнике сотрудников, будет подставлен первый геолог объекта` });
      values.geologist = (g as any)?.name ?? "";
      const rec = numOf(get(row, "recoveryPct"));
      if (rec !== null && (rec < 0 || rec > 100))
        issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: выход керна ${rec}% вне диапазона 0–100` });
      values.recoveryPct = rec ?? 100;
      values.lithology = String(get(row, "lithology") ?? "");
      values.mineralization = yesNo(get(row, "mineralization"));
      values.photo = yesNo(get(row, "photo"), true);
      const st = String(get(row, "status") ?? "").trim();
      values.status = CORE_LOG_STATUSES.includes(st as any) ? st : "описано";
    }

    if (type === "corecuts") {
      values.worker = String(get(row, "worker") ?? "");
      const sh = String(get(row, "shift") ?? "день").trim().toLowerCase();
      values.shift = sh === "ночь" ? "ночь" : "день";
      const ct = String(get(row, "cutType") ?? "").trim();
      values.cutType = CUT_TYPES.includes(ct as any) ? ct : CUT_TYPES[0];
      const rej = numOf(get(row, "rejectMeters")) ?? 0;
      if (rej < 0) issues.push({ row: rowNo, level: "ошибка", message: `Строка ${rowNo}: брак не может быть отрицательным` });
      values.rejectMeters = Math.max(0, rej);
      values.rejectReason = String(get(row, "rejectReason") ?? "");
      const st = String(get(row, "status") ?? "").trim();
      values.status = CUT_STATUSES.includes(st as any) ? st : "распилено";
    }

    if (issues.some((x) => x.level === "ошибка")) errors++;
    if (duplicate) duplicates++;
    allIssues.push(...issues);
    items.push({ row: rowNo, values, issues, duplicate });
  });

  return {
    fields: fields.map((f) => ({ key: f.key, label: f.label, required: f.required })),
    headers,
    preview: items.slice(0, 20),
    issues: allIssues.slice(0, 200),
    totals: { total: rows.length, valid: rows.length - errors, errors, duplicates },
    unknownRefs: [...unknown.values()],
    allItems: items,
  };
}

export function commitImport(
  uploadId: string, type: DataType, mapping: Record<string, string>,
  duplicateStrategy: "skip" | "replace" | "new",
) {
  const cached = cache.get(uploadId);
  if (!cached) throw new Error("Файл не найден или срок хранения истёк. Загрузите файл заново.");
  const analysis = analyzeRows(uploadId, type, mapping).allItems!;
  const objects = storage.objects();
  const rigs = storage.rigs();
  const brigades = storage.brigades();
  const employees = storage.employees();
  const existingReports = storage.reports();

  const log = storage.createImportLog({
    createdAt: new Date().toISOString(),
    fileName: cached.fileName,
    dataType: DATA_TYPES[type],
    rowsLoaded: 0, rowsSkipped: 0, rowsError: 0,
    author: "Аналитик", issues: "[]", rolledBack: 0,
  });
  const importId = log.id;

  let loaded = 0, skipped = 0, errorRows = 0;
  const issues: string[] = [];

  for (const item of analysis) {
    if (item.issues.some((x) => x.level === "ошибка")) {
      errorRows++;
      issues.push(...item.issues.filter((x) => x.level === "ошибка").map((x) => x.message));
      continue;
    }
    const v = item.values;
    try {
      if (type === "reports") {
        const obj = objects.find((o) => o.name === v.object)!;
        const rig = rigs.find((r) => r.name === v.rig) ?? rigs.find((r) => r.objectId === obj.id)!;
        const br = brigades.find((b) => b.name === v.brigade) ?? brigades.find((b) => b.objectId === obj.id)!;
        const dup = existingReports.find((r) => r.date === v.date && r.rigId === rig.id && r.shift === v.shift);
        if (dup && duplicateStrategy === "skip") { skipped++; continue; }
        const payload = {
          date: v.date, objectId: obj.id, rigId: rig.id, brigadeId: br.id, shift: v.shift,
          meters: v.meters, drillHours: v.drillHours, pzrHours: v.pzrHours,
          downtimeHours: v.downtimeHours, downtimeReason: v.downtimeReason,
          comment: v.comment, importId,
        };
        if (dup && duplicateStrategy === "replace") storage.updateReport(dup.id, payload);
        else storage.createReport(payload);
        loaded++;
      } else if (type === "costs") {
        const obj = objects.find((o) => o.name === v.object)!;
        storage.createCost({ objectId: obj.id, month: v.month, category: v.category, amount: v.amount, importId });
        loaded++;
      } else if (type === "fuel") {
        const obj = objects.find((o) => o.name === v.object)!;
        storage.createFuel({
          date: v.date, objectId: obj.id, unitName: v.unitName,
          normLiters: v.normLiters, factLiters: v.factLiters, importId,
        });
        loaded++;
      } else if (type === "inventory") {
        const obj = objects.find((o) => o.name === v.object)!;
        storage.createInventory({
          objectId: obj.id, itemName: v.itemName, qty: v.qty, unit: v.unit,
          minQty: v.minQty, dailyUse: v.dailyUse, expectedDelivery: v.expectedDelivery, importId,
        });
        loaded++;
      } else if (type === "crew") {
        const obj = objects.find((o) => o.name === v.object)!;
        const br = brigades.find((b) => b.name === v.brigade) ?? brigades.find((b) => b.objectId === obj.id)!;
        let emp = employees.find((e) => e.fio.toLowerCase() === String(v.fio).toLowerCase());
        if (!emp) {
          emp = storage.createEmployee({
            fio: v.fio, position: v.position, objectId: obj.id,
            brigadeId: br.id, phone: v.phone, importId,
          });
          employees.push(emp);
        }
        const days = Number(String(v.cycleType).split("/")[0]) || 30;
        const start = new Date(v.startDate);
        const end = new Date(start.getTime() + (days - 1) * 86400000);
        storage.createShift({
          employeeId: emp.id, objectId: obj.id, startDate: v.startDate,
          endDate: end.toISOString().slice(0, 10), cycleType: v.cycleType,
          replacementAssigned: 0, importId,
        });
        loaded++;
      } else if (type === "employees") {
        const obj = v.object ? objects.find((o) => o.name === v.object) : undefined;
        const existing = employees.find((e) => e.fio.trim().toLowerCase() === String(v.fio).trim().toLowerCase());
        if (existing && duplicateStrategy === "skip") { skipped++; continue; }
        let emp = existing;
        const payload = {
          fio: v.fio, position: v.position, objectId: obj?.id ?? 0,
          brigadeId: 0, phone: v.phone, importId,
        };
        if (existing && duplicateStrategy === "replace") {
          emp = storage.updateEmployee(existing.id, payload);
        } else {
          emp = storage.createEmployee(payload);
          employees.push(emp!);
          // новая должность сразу попадает в справочник
          const pn = String(v.position ?? "").trim();
          if (pn && !storage.positions().some((p) => p.name.toLowerCase() === pn.toLowerCase()))
            storage.createPosition({ name: pn });
        }
        if (emp && v.startDate && v.cycleType) {
          const days = Number(String(v.cycleType).split("/")[0]) || 30;
          const start = new Date(v.startDate);
          const end = new Date(start.getTime() + (days - 1) * 86400000);
          storage.createShift({
            employeeId: emp.id, objectId: obj?.id ?? 0, startDate: v.startDate,
            endDate: end.toISOString().slice(0, 10), cycleType: v.cycleType,
            replacementAssigned: 0, importId,
          });
        }
        loaded++;
      } else if (type === "assays") {
        const existing = storage.assays().find((a) => a.sampleId === v.sampleId && a.element === v.element);
        if (existing && duplicateStrategy === "skip") { skipped++; continue; }
        if (existing && duplicateStrategy === "replace") storage.deleteAssay(existing.id);
        storage.createAssay({
          sampleId: v.sampleId, element: v.element, value: v.value,
          unit: v.unit, receivedDate: v.receivedDate, importId,
        });
        const smp = storage.samples().find((s) => s.id === v.sampleId);
        if (smp && smp.stage !== "Результат получен" && smp.stage !== "Архив/Брак") {
          storage.updateSample(smp.id, { stage: "Результат получен", stageDate: v.receivedDate });
          storage.createSampleMove({
            sampleId: smp.id, fromStage: smp.stage, toStage: "Результат получен",
            date: v.receivedDate, author: "Импорт результатов", note: "Загружено из Excel",
          });
        }
        loaded++;
      } else if (type === "corelogs") {
        const obj = objects.find((o) => o.name === v.object)!;
        const geo = employees.find((e) => e.fio === v.geologist)
          ?? employees.find((e) => e.objectId === obj.id && e.position.includes("Геолог"))
          ?? employees.find((e) => e.objectId === obj.id);
        const dup = storage.coreLogs().find(
          (l) => l.holeName === v.hole && l.fromDepth === v.fromDepth && l.toDepth === v.toDepth);
        if (dup && duplicateStrategy === "skip") { skipped++; continue; }
        const payload = {
          date: v.date, objectId: obj.id, holeName: v.hole, fromDepth: v.fromDepth, toDepth: v.toDepth,
          geologistId: geo?.id ?? 0, recoveryPct: v.recoveryPct, lithology: v.lithology,
          mineralization: v.mineralization, mineralizationNote: "", photo: v.photo, status: v.status, importId,
        };
        if (dup && duplicateStrategy === "replace") storage.updateCoreLog(dup.id, payload);
        else storage.createCoreLog(payload);
        loaded++;
      } else if (type === "corecuts") {
        const obj = objects.find((o) => o.name === v.object)!;
        const saw = storage.equipment().find((e) => e.kind === "Камнерезный станок" && e.objectId === obj.id)
          ?? storage.equipment().find((e) => e.kind === "Камнерезный станок");
        const dup = storage.coreCuts().find(
          (c) => c.holeName === v.hole && c.fromDepth === v.fromDepth && c.toDepth === v.toDepth);
        if (dup && duplicateStrategy === "skip") { skipped++; continue; }
        const payload = {
          date: v.date, objectId: obj.id, holeName: v.hole, fromDepth: v.fromDepth, toDepth: v.toDepth,
          worker: v.worker, shift: v.shift, cutType: v.cutType, equipmentId: saw?.id ?? 0,
          rejectMeters: v.rejectMeters, rejectReason: v.rejectReason, status: v.status, importId,
        };
        if (dup && duplicateStrategy === "replace") storage.updateCoreCut(dup.id, payload);
        else storage.createCoreCut(payload);
        loaded++;
      }
    } catch (e: any) {
      errorRows++;
      issues.push(`Строка ${item.row}: ошибка записи — ${e.message}`);
    }
  }

  storage.updateImportLog(importId, {
    rowsLoaded: loaded, rowsSkipped: skipped, rowsError: errorRows,
    issues: JSON.stringify(issues.slice(0, 200)),
  });

  return { importId, loaded, skipped, errors: errorRows, issues: issues.slice(0, 200) };
}

/** Шаблоны Excel */
export async function buildTemplate(type: DataType): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ГРР-Контроль";
  const ws = wb.addWorksheet(DATA_TYPES[type].slice(0, 30));
  const fields = IMPORT_FIELDS[type];
  ws.columns = fields.map((f) => ({ header: f.label + (f.required ? " *" : ""), key: f.key, width: Math.max(16, f.label.length + 6) }));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  ws.getRow(1).alignment = { vertical: "middle", wrapText: true };
  ws.getRow(1).height = 28;

  const objects = storage.objects();
  const rigs = storage.rigs();
  const brigades = storage.brigades();
  const today = new Date().toISOString().slice(0, 10);
  const examples: Record<DataType, any[]> = {
    reports: [
      { date: today, object: objects[0]?.name, rig: rigs[0]?.name, brigade: brigades[0]?.name, shift: "день",
        meters: 24.5, drillHours: 9, pzrHours: 1.5, downtimeHours: 1.5, downtimeReason: "поломка техники", comment: "" },
      { date: today, object: objects[0]?.name, rig: rigs[0]?.name, brigade: brigades[0]?.name, shift: "ночь",
        meters: 21, drillHours: 10.5, pzrHours: 1.5, downtimeHours: 0, downtimeReason: "", comment: "" },
    ],
    costs: [
      { object: objects[0]?.name, month: today.slice(0, 7), category: "ГСМ", amount: 5400000 },
      { object: objects[0]?.name, month: today.slice(0, 7), category: "Зарплата", amount: 8900000 },
    ],
    fuel: [
      { date: today, object: objects[0]?.name, unitName: "Станок УБ-01", normLiters: 210, factLiters: 228 },
    ],
    inventory: [
      { itemName: "Дизельное топливо", object: objects[0]?.name, qty: 12000, unit: "л", minQty: 8000, dailyUse: 540, expectedDelivery: today },
    ],
    crew: [
      { fio: "Иванов И. И.", position: "Бурильщик", object: objects[0]?.name, startDate: today, cycleType: "30/30", phone: "+7 900 000-00-00" },
    ],
    employees: [
      { fio: "Иванов Иван Иванович", position: "Бурильщик", object: objects[0]?.name ?? "", phone: "+7 900 000-00-00", startDate: today, cycleType: "30/30" },
      { fio: "Петров Пётр Петрович", position: "Геолог", object: "", phone: "", startDate: "", cycleType: "" },
    ],
    assays: [
      { sampleCode: storage.samples()[0]?.code ?? "СЕВ-26-001", element: "Au", value: 1.24, unit: "г/т", receivedDate: today },
      { sampleCode: storage.samples()[1]?.code ?? "СЕВ-26-002", element: "Ag", value: 12.4, unit: "г/т", receivedDate: today },
    ],
    corelogs: [
      { date: today, object: objects[0]?.name, hole: "СКВ-101", fromDepth: 120, toDepth: 135.5,
        geologist: "Антипина М. В.", recoveryPct: 94, lithology: "Сланец углистый, кварцевые прожилки",
        mineralization: "да", photo: "да", status: "описано" },
    ],
    corecuts: [
      { date: today, object: objects[0]?.name, hole: "СКВ-101", fromDepth: 120, toDepth: 135.5,
        worker: "Петров А. С.", shift: "день", cutType: CUT_TYPES[0], rejectMeters: 0.4,
        rejectReason: "рассыпание керна", status: "распилено" },
    ],
  };
  examples[type].forEach((row) => ws.addRow(row));
  ws.eachRow((row, i) => { if (i > 1) row.font = { color: { argb: "FF6B7280" }, italic: true }; });

  const info = wb.addWorksheet("Инструкция");
  info.columns = [{ width: 30 }, { width: 70 }];
  info.addRow(["ГРР-Контроль", `Шаблон: ${DATA_TYPES[type]}`]);
  info.getRow(1).font = { bold: true, size: 13 };
  info.addRow([]);
  info.addRow(["Поле", "Требование"]);
  info.getRow(3).font = { bold: true };
  fields.forEach((f) =>
    info.addRow([f.label, (f.required ? "Обязательное. " : "Необязательное. ") + "Допустимые названия колонок: " + f.aliases.join(", ")]));
  info.addRow([]);
  info.addRow(["Важно", "Строки с примерами удалите перед отправкой. Даты — в формате ДД.ММ.ГГГГ или ГГГГ-ММ-ДД."]);
  info.eachRow((row) => (row.alignment = { wrapText: true, vertical: "top" }));
  return wb;
}

/* ==================== Справочники одним файлом (3 листа) ==================== */

export { REFS_SHEETS };

export async function buildRefsTemplate(): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ГРР-Контроль";
  const objs = storage.objects();

  const mk = (key: keyof typeof REFS_SHEETS, rows: any[]) => {
    const def = REFS_SHEETS[key];
    const ov = refsOverride(key);
    const label = (f: any) => ov?.labels?.[f.key] ?? f.label;
    const ws = wb.addWorksheet((ov?.title || def.title).slice(0, 31));
    ws.columns = def.fields.map((f) => ({
      header: label(f) + (f.required ? " *" : ""),
      key: f.key,
      width: Math.max(18, label(f).length + 4),
    }));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    head.alignment = { vertical: "middle", wrapText: true };
    head.height = 30;
    rows.forEach((r) => ws.addRow(r));
    ws.eachRow((row, i) => { if (i > 1) row.font = { color: { argb: "FF6B7280" }, italic: true }; });
  };

  const today = new Date();
  const end = new Date(today.getTime() + 180 * 86400000).toISOString().slice(0, 10);
  mk("objects", [
    { name: "Участок «Пример»", customer: "АО «Заказчик»", region: "Красноярский край",
      planMetersMonth: 1200, pricePerMeter: 9800, plannedCostPerMeter: 7400,
      contractVolume: 9000, contractEnd: end, staffRequired: 24 },
  ]);
  mk("rigs", [
    { name: "УБ-01", model: "ЗИФ-650М", object: objs[0]?.name ?? "Участок «Пример»", status: "в работе" },
    { name: "УБ-02", model: "УКБ-500", object: objs[0]?.name ?? "Участок «Пример»", status: "резерв" },
  ]);

  const info = wb.addWorksheet("Инструкция");
  info.columns = [{ width: 34 }, { width: 76 }];
  info.addRow(["ГРР-Контроль", "Шаблон: Справочники (объекты и станки)"]);
  info.getRow(1).font = { bold: true, size: 13 };
  info.addRow([]);
  info.addRow(["Как заполнять", "Заполните листы «Объекты» и «Станки». Строки-примеры удалите."]);
  info.addRow(["Порядок листов", "Сначала объекты — станки привязываются к объекту по названию."]);
  info.addRow(["Повторная загрузка", "Если объект или станок с таким названием уже есть, запись будет обновлена, а не задвоена."]);
  info.addRow(["Даты", "Формат ДД.ММ.ГГГГ или ГГГГ-ММ-ДД."]);
  info.addRow([]);
  info.addRow(["Лист", "Колонки"]);
  info.getRow(8).font = { bold: true };
  (Object.keys(REFS_SHEETS) as (keyof typeof REFS_SHEETS)[]).filter((k) => k !== "brigades").forEach((k) => {
    info.addRow([REFS_SHEETS[k].title, REFS_SHEETS[k].fields.map((f) => f.label + (f.required ? " (обязательно)" : "")).join("; ")]);
  });
  info.eachRow((row) => (row.alignment = { wrapText: true, vertical: "top" }));
  return wb;
}

async function sheetMatrix(ws: ExcelJS.Worksheet): Promise<any[][]> {
  const matrix: any[][] = [];
  ws.eachRow((row) => matrix.push((row.values as any[]).slice(1).map(cellToValue)));
  return matrix;
}

export async function importRefs(buffer: Buffer, fileName: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);

  const result = {
    objects: { created: 0, updated: 0 },
    rigs: { created: 0, updated: 0 },
    brigades: { created: 0, updated: 0 },
    issues: [] as string[],
    sheetsFound: [] as string[],
  };

  const findSheet = (key: keyof typeof REFS_SHEETS) => {
    const ov = refsOverride(key);
    const wants = [norm(REFS_SHEETS[key].title)];
    if (ov?.title) wants.unshift(norm(ov.title));
    for (const want of wants) {
      const exact = wb.worksheets.find((w) => norm(w.name) === want);
      if (exact) return exact;
    }
    for (const want of wants) {
      const near = wb.worksheets.find((w) => norm(w.name).includes(want) || want.includes(norm(w.name)));
      if (near) return near;
    }
    return undefined;
  };

  const readSheet = async (key: keyof typeof REFS_SHEETS) => {
    const ws = findSheet(key);
    if (!ws) return null;
    const matrix = await sheetMatrix(ws);
    if (!matrix.length) return null;
    const fields = REFS_SHEETS[key].fields;
    const ov = refsOverride(key);
    const aliasesOf = (f: any): string[] => {
      const list = [...(f.aliases as readonly string[]), norm(f.label)];
      if (ov?.labels?.[f.key]) list.push(norm(ov.labels[f.key]));
      return list.filter(Boolean);
    };
    // Шапка может быть не в первой строке: над ней бывает название организации и шаблона
    let headerIdx = 0;
    let best = -1;
    for (let i = 0; i < Math.min(matrix.length, 12); i++) {
      const cells = matrix[i].map((c: any) => norm(c).replace(/\*/g, ""));
      const filled = cells.filter((c: string) => c !== "").length;
      if (filled < 2) continue;
      const hit = fields.filter((f) => cells.some((c: string) => c !== "" && aliasesOf(f).includes(c))).length;
      if (hit > best) { best = hit; headerIdx = i; }
      if (hit >= Math.min(2, fields.length)) break;
    }
    const headers = (matrix[headerIdx] ?? []).map((h: any, i: number) => String(h ?? "").trim() || `Колонка ${i + 1}`);
    const map: Record<string, number> = {};
    fields.forEach((f) => {
      const aliases = aliasesOf(f);
      const idx = headers.findIndex((h: string) => aliases.includes(norm(h).replace(/\*/g, "")));
      const idx2 = idx >= 0 ? idx : headers.findIndex((h: string) =>
        aliases.some((a) => a.length > 2 && norm(h).startsWith(a)));
      if (idx2 >= 0) map[f.key] = idx2;
    });
    const rows = matrix.slice(headerIdx + 1).filter((r) => r.some((c) => c !== null && String(c).trim() !== ""));
    result.sheetsFound.push(ws.name);
    return { rows, map };
  };

  const val = (row: any[], map: Record<string, number>, key: string) =>
    map[key] === undefined ? null : row[map[key]] ?? null;

  // --- Объекты ---
  const objSheet = await readSheet("objects");
  if (objSheet) {
    objSheet.rows.forEach((row, i) => {
      const name = String(val(row, objSheet.map, "name") ?? "").trim();
      if (!name) {
        result.issues.push(`Лист «Объекты», строка ${i + 2}: не заполнено название — строка пропущена`);
        return;
      }
      const payload: any = {
        name,
        customer: String(val(row, objSheet.map, "customer") ?? "").trim(),
        region: String(val(row, objSheet.map, "region") ?? "").trim(),
        planMetersMonth: numOf(val(row, objSheet.map, "planMetersMonth")) ?? 0,
        pricePerMeter: numOf(val(row, objSheet.map, "pricePerMeter")) ?? 0,
        plannedCostPerMeter: numOf(val(row, objSheet.map, "plannedCostPerMeter")) ?? 0,
        contractVolume: numOf(val(row, objSheet.map, "contractVolume")) ?? 0,
        contractEnd: dateOf(val(row, objSheet.map, "contractEnd")) ?? "",
        staffRequired: Math.round(numOf(val(row, objSheet.map, "staffRequired")) ?? 0),
      };
      const existing = storage.objects().find((o) => norm(o.name) === norm(name));
      if (existing) { storage.updateObject(existing.id, payload); result.objects.updated++; }
      else { storage.createObject(payload); result.objects.created++; }
    });
  }

  const objectByName = (raw: any) => {
    const list = storage.objects();
    const found = findRef(list, raw);
    return found ?? list[0];
  };

  // --- Станки ---
  const rigSheet = await readSheet("rigs");
  if (rigSheet) {
    rigSheet.rows.forEach((row, i) => {
      const name = String(val(row, rigSheet.map, "name") ?? "").trim();
      if (!name) {
        result.issues.push(`Лист «Станки», строка ${i + 2}: не заполнено название — строка пропущена`);
        return;
      }
      const rawObj = val(row, rigSheet.map, "object");
      const obj = objectByName(rawObj);
      if (!obj) {
        result.issues.push(`Лист «Станки», строка ${i + 2}: сначала заведите хотя бы один объект`);
        return;
      }
      if (rawObj && norm(obj.name) !== norm(rawObj))
        result.issues.push(`Лист «Станки», строка ${i + 2}: объект «${rawObj}» не найден, станок привязан к «${obj.name}»`);
      const statusRaw = norm(val(row, rigSheet.map, "status"));
      const status = statusRaw.startsWith("рем") ? "ремонт" : statusRaw.startsWith("рез") ? "резерв" : "в работе";
      const payload = { name, model: String(val(row, rigSheet.map, "model") ?? "").trim(), objectId: obj.id, status };
      const existing = storage.rigs().find((r) => norm(r.name) === norm(name));
      if (existing) { storage.updateRig(existing.id, payload); result.rigs.updated++; }
      else { storage.createRig(payload); result.rigs.created++; }
    });
  }

  // --- Бригады ---
  const brSheet = await readSheet("brigades");
  if (brSheet) {
    brSheet.rows.forEach((row, i) => {
      const name = String(val(row, brSheet.map, "name") ?? "").trim();
      if (!name) {
        result.issues.push(`Лист «Бригады», строка ${i + 2}: не заполнено название — строка пропущена`);
        return;
      }
      const rawObj = val(row, brSheet.map, "object");
      const obj = objectByName(rawObj);
      if (!obj) {
        result.issues.push(`Лист «Бригады», строка ${i + 2}: сначала заведите хотя бы один объект`);
        return;
      }
      const payload = {
        name, objectId: obj.id,
        staffPlan: Math.round(numOf(val(row, brSheet.map, "staffPlan")) ?? 0),
      };
      const existing = storage.brigades().find((b) => norm(b.name) === norm(name));
      if (existing) { storage.updateBrigade(existing.id, payload); result.brigades.updated++; }
      else { storage.createBrigade(payload); result.brigades.created++; }
    });
  }

  if (!result.sheetsFound.length)
    throw new Error("В файле не найдено листов «Объекты» или «Станки». Скачайте шаблон справочников.");

  const total =
    result.objects.created + result.objects.updated +
    result.rigs.created + result.rigs.updated +
    result.brigades.created + result.brigades.updated;

  storage.createImportLog({
    createdAt: new Date().toISOString(),
    fileName,
    dataType: "Справочники (объекты и станки)",
    rowsLoaded: total, rowsSkipped: 0, rowsError: result.issues.length,
    author: "Аналитик", issues: JSON.stringify(result.issues.slice(0, 200)), rolledBack: 0,
  });

  return { ...result, total };
}
