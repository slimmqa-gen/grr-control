import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { storage } from "./storage";
import {
  DATA_TYPES, IMPORT_FIELDS, REFS_SHEETS, DOWNTIME_REASONS, COST_CATEGORIES,
  CUT_TYPES, SAMPLE_ELEMENTS,
} from "@shared/schema";
import type { DataType, TemplateColumn, TemplateDef } from "@shared/schema";
import { brandHeaderLine, signatureLine, brandingInfo } from "./branding";

const norm = (s: any) =>
  String(s ?? "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]/g, "");

const nowIso = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const today = () => new Date().toISOString().slice(0, 10);

/* ==================== Встроенные шаблоны ==================== */

export const REFS_CODES = {
  "refs-objects": "objects",
  "refs-rigs": "rigs",
} as const;

type RefsCode = keyof typeof REFS_CODES;

function builtinDataDef(type: DataType): TemplateDef {
  const fields = IMPORT_FIELDS[type];
  return {
    code: type,
    kind: "data",
    baseType: type,
    title: `Шаблон — ${DATA_TYPES[type]}`,
    sheetName: DATA_TYPES[type].slice(0, 31),
    columns: fields.map((f) => ({
      key: f.key,
      label: f.label,
      required: f.required,
      hint: f.aliases.slice(0, 3).join(", "),
      custom: false,
    })),
    notes: [
      "Строки с примерами удалите перед отправкой.",
      "Даты — в формате ДД.ММ.ГГГГ или ГГГГ-ММ-ДД. Числа — с запятой или точкой.",
    ],
    edited: false,
    builtin: true,
  };
}

function builtinRefsDef(code: RefsCode): TemplateDef {
  const key = REFS_CODES[code];
  const def = REFS_SHEETS[key];
  return {
    code,
    kind: "refs",
    baseType: "",
    title: `Шаблон справочника — ${def.title}`,
    sheetName: def.title,
    columns: def.fields.map((f) => ({
      key: f.key,
      label: f.label,
      required: f.required,
      hint: (f.aliases as readonly string[]).slice(0, 3).join(", "),
      custom: false,
    })),
    notes: [
      "Сначала заполните «Объекты» — станки привязываются к объекту по названию.",
      "Повторная загрузка обновляет запись с тем же названием, а не задваивает её.",
    ],
    edited: false,
    builtin: true,
  };
}

/** Формат штатного расписания заказчика: две колонки — Имя и Должность */
function staffRosterDef(): TemplateDef {
  return {
    code: "staff-roster",
    kind: "data",
    baseType: "employees",
    title: "Штатное расписание",
    sheetName: "Лист1",
    columns: [
      { key: "fio", label: "Имя", required: true, hint: "ФИО полностью", custom: false },
      { key: "position", label: "Должность по штатному расписанию", required: false, hint: "если пусто — «Не указана»", custom: false },
    ],
    notes: [
      "Шаблон повторяет формат штатного расписания: шапка в первой строке, данные со второй.",
      "Загружайте его в разделе «Загрузка» с типом данных «Сотрудники» — колонки подставляются автоматически.",
      "Повторная загрузка того же файла не задваивает людей: совпадения по ФИО можно пропустить или обновить.",
    ],
    edited: false,
    builtin: true,
  };
}

export function builtinDefs(): TemplateDef[] {
  return [
    ...(Object.keys(DATA_TYPES) as DataType[]).map(builtinDataDef),
    staffRosterDef(),
    ...(Object.keys(REFS_CODES) as RefsCode[]).map(builtinRefsDef),
  ];
}

/* ==================== Сохранённые изменения ==================== */

function rowToDef(row: any, builtin: TemplateDef | null): TemplateDef {
  let columns: TemplateColumn[] = [];
  let notes: string[] = [];
  try { columns = JSON.parse(row.columns) as TemplateColumn[]; } catch { columns = []; }
  try { notes = JSON.parse(row.notes) as string[]; } catch { notes = []; }
  return {
    code: row.code,
    kind: row.kind,
    baseType: row.baseType || builtin?.baseType || "",
    title: row.title,
    sheetName: row.sheetName,
    columns: columns.length ? columns : (builtin?.columns ?? []),
    notes,
    edited: true,
    builtin: !!builtin,
  };
}

/** Действующий шаблон: встроенный, если пользователь его не менял, иначе сохранённый */
export function templateDef(code: string): TemplateDef | null {
  const row = storage.templateByCode(code);
  const builtin = builtinDefs().find((d) => d.code === code) ?? null;
  if (row) return rowToDef(row, builtin);
  return builtin;
}

export function listTemplates(): TemplateDef[] {
  const rows = storage.templates();
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const list: TemplateDef[] = builtinDefs().map((b) => {
    const row = byCode.get(b.code);
    return row ? rowToDef(row, b) : b;
  });
  // Свои шаблоны, созданные из файлов заказчика
  rows
    .filter((r) => !list.some((d) => d.code === r.code))
    .forEach((r) => list.push({ ...rowToDef(r, null), builtin: false }));
  return list;
}

export function saveTemplateDef(
  code: string,
  payload: { title: string; sheetName: string; columns: TemplateColumn[]; notes: string[]; baseType?: string },
  author: string,
) {
  const builtin = builtinDefs().find((d) => d.code === code) ?? null;
  const existing = storage.templateByCode(code);
  if (!builtin && !existing) throw new Error("Шаблон не найден");
  const labels = new Set<string>();
  payload.columns.forEach((c) => {
    const n = norm(c.label);
    if (labels.has(n)) throw new Error(`Колонка «${c.label}» встречается дважды — названия должны быть разными`);
    labels.add(n);
  });
  storage.saveTemplate({
    code,
    kind: builtin?.kind ?? existing?.kind ?? "custom",
    baseType: payload.baseType || builtin?.baseType || existing?.baseType || "",
    title: payload.title,
    sheetName: payload.sheetName,
    columns: JSON.stringify(payload.columns),
    notes: JSON.stringify(payload.notes ?? []),
    updatedAt: nowIso(),
    author,
  });
  syncProfileForTemplate(code, author);
  return templateDef(code)!;
}

export function resetTemplateDef(code: string) {
  const builtin = builtinDefs().find((d) => d.code === code);
  if (!builtin) throw new Error("Свой шаблон нельзя вернуть к заводскому виду — его можно только удалить");
  storage.deleteTemplate(code);
  return builtin;
}

export function deleteTemplateDef(code: string) {
  const builtin = builtinDefs().find((d) => d.code === code);
  if (builtin) throw new Error("Встроенный шаблон удалить нельзя. Нажмите «Вернуть заводской вид»");
  storage.deleteTemplate(code);
  return { ok: true };
}

export function createTemplateDef(
  payload: { title: string; sheetName: string; columns: TemplateColumn[]; notes: string[]; baseType?: string },
  author: string,
) {
  const codes = new Set(storage.templates().map((t) => t.code));
  let n = 1;
  while (codes.has(`custom-${n}`)) n++;
  const code = `custom-${n}`;
  storage.saveTemplate({
    code,
    kind: "custom",
    baseType: payload.baseType ?? "",
    title: payload.title,
    sheetName: payload.sheetName,
    columns: JSON.stringify(payload.columns),
    notes: JSON.stringify(payload.notes ?? []),
    updatedAt: nowIso(),
    author,
  });
  syncProfileForTemplate(code, author);
  return templateDef(code)!;
}

/* ==================== Синонимы для импорта ==================== */

/**
 * Дополнительные названия колонок из шаблонов: переименовал колонку — импорт
 * продолжает работать, потому что новое имя попадает в словарь синонимов профиля.
 */
export function templateAliases(type: DataType): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  listTemplates()
    .filter((d) => d.baseType === type)
    .forEach((d) =>
      d.columns.forEach((c) => {
        if (!c.key || c.custom) return;
        const n = norm(c.label);
        if (!n) return;
        (out[c.key] ??= []).push(n);
      }),
    );
  return out;
}

/** Переопределение названий листа и колонок справочника (для загрузки файла справочников) */
export function refsOverride(key: keyof typeof REFS_SHEETS): { title: string; labels: Record<string, string> } | null {
  const code = (Object.keys(REFS_CODES) as RefsCode[]).find((c) => REFS_CODES[c] === key);
  if (!code) return null;
  const row = storage.templateByCode(code);
  if (!row) return null;
  const def = templateDef(code);
  if (!def) return null;
  const labels: Record<string, string> = {};
  def.columns.forEach((c) => { if (c.key && !c.custom) labels[c.key] = c.label; });
  return { title: def.sheetName, labels };
}

/** Профиль импорта под шаблон: сопоставление колонок по их порядку в шаблоне */
function syncProfileForTemplate(code: string, author: string) {
  const def = templateDef(code);
  if (!def || !def.baseType) return;
  const kind = ["corelogs", "corecuts", "assays"].includes(def.baseType) ? "geo" : "drill";
  const mapping: Record<string, Record<string, number>> = { [def.baseType]: {} };
  def.columns.forEach((c, i) => {
    if (c.key && !c.custom) mapping[def.baseType][c.key] = i;
  });
  const signature = def.columns.map((c) => norm(c.label));
  const name = `Шаблон: ${def.title}`;
  const existing = storage.profiles().find((p) => p.name === name);
  const values = {
    name, kind,
    sheetRule: "по названию",
    sheetMatch: def.sheetName,
    headerRow: 1,
    transposed: 0,
    mapping: JSON.stringify(mapping),
    defaults: JSON.stringify({}),
    signature: JSON.stringify(signature),
    createdAt: nowIso(),
    author,
  };
  if (existing) storage.updateProfile(existing.id, values);
  else storage.createProfile({ ...values, usedCount: 0, lastUsed: "" });
}

/* ==================== Примеры строк и предпросмотр ==================== */

function exampleFor(key: string, label: string, i: number): string | number {
  const k = norm(key);
  const l = norm(label);
  const objects = storage.objects();
  const rigs = storage.rigs();
  const pick = (arr: any[], f: string) => arr[i % Math.max(1, arr.length)]?.[f];
  if (k === "fio" || /^(фио|имя)$/.test(l)) return ["Иванов Иван Иванович", "Петров Пётр Петрович"][i % 2];
  if (k === "position" || /должность/.test(l)) return ["Бурильщик", "Геолог 1 категории"][i % 2];

  if (/date|month|expecteddelivery|startdate|contractend/.test(k) || /дата|месяц|срок/.test(l)) {
    if (/month|месяц/.test(k + l)) return today().slice(0, 7);
    return today();
  }
  if (k === "object" || /объект|участок/.test(l)) return pick(objects, "name") ?? "Участок «Пример»";
  if (k === "rig" || /станок|установка/.test(l)) return pick(rigs, "name") ?? "УБ-01";
  if (k === "shift" || /смена/.test(l)) return i % 2 === 0 ? "день" : "ночь";
  if (k === "meters" || /метр|проходка/.test(l)) return 24.5 - i * 2;
  if (/hours|час/.test(k + l)) return 9 - i;
  if (k === "downtimereason" || /причин/.test(l)) return DOWNTIME_REASONS[i % DOWNTIME_REASONS.length];
  if (k === "category" || /категор|статья/.test(l)) return COST_CATEGORIES[i % COST_CATEGORIES.length];
  if (/amount|сумм|руб|₽|цена|стоимост/.test(k + l)) return 5400000 - i * 100000;
  if (/liters|литр|гсм|топлив/.test(k + l)) return 210 + i * 18;
  if (/qty|кол|остат/.test(k + l)) return 12000 - i * 500;
  if (k === "unit" || /единиц/.test(l)) return "л";
  if (k === "fio" || /фио|сотрудник|бурильщик|геолог|работник/.test(l)) return i === 0 ? "Иванов И. И." : "Петров А. С.";
  if (k === "position" || /должност/.test(l)) return "Бурильщик";
  if (/phone|телефон/.test(k + l)) return "+7 900 000-00-00";
  if (/cycletype|вахта|цикл/.test(k + l)) return "30/30";
  if (/samplecode|проба|шифр/.test(k + l)) return `СЕВ-26-00${i + 1}`;
  if (k === "element" || /элемент/.test(l)) return SAMPLE_ELEMENTS[i % SAMPLE_ELEMENTS.length];
  if (k === "value" || /содержан|значен/.test(l)) return 1.24 + i;
  if (/hole|скважин/.test(k + l)) return `СКВ-10${i + 1}`;
  if (/fromdepth|от,/.test(k + l) || /^от/.test(l)) return 120 + i * 15;
  if (/todepth/.test(k) || /^до/.test(l)) return 135.5 + i * 15;
  if (/recovery|выход/.test(k + l)) return 94 - i;
  if (/lithology|литолог|порода/.test(k + l)) return "Сланец углистый, кварцевые прожилки";
  if (/mineraliz|оруден|фото/.test(k + l)) return "да";
  if (k === "cuttype" || /вид распил|тип распил/.test(l)) return CUT_TYPES[i % CUT_TYPES.length];
  if (/status|статус/.test(k + l)) return "описано";
  if (/reject|брак/.test(k + l)) return i === 0 ? 0.4 : 0;
  if (/comment|коммент|примечан/.test(k + l)) return "";
  if (/customer|заказчик/.test(k + l)) return "АО «Заказчик»";
  if (/region|регион|край|област/.test(k + l)) return "Красноярский край";
  if (/plan|штат|числен/.test(k + l)) return 1200;
  if (/model|тип|марка/.test(k + l)) return "ЗИФ-650М";
  if (k === "name" || /названи|наименован/.test(l)) return "Участок «Пример»";
  return "";
}

export function previewRows(def: TemplateDef, count = 2): (string | number)[][] {
  return Array.from({ length: count }, (_, i) =>
    def.columns.map((c) => (c.custom ? "" : exampleFor(c.key, c.label, i))),
  );
}

/* ==================== Сборка книги Excel по шаблону ==================== */

export async function buildTemplateWorkbook(code: string): Promise<{ wb: ExcelJS.Workbook; fileName: string }> {
  const def = templateDef(code);
  if (!def) throw new Error("Шаблон не найден");
  const b = brandingInfo();

  const wb = new ExcelJS.Workbook();
  wb.creator = b.orgName || "ГРР-Контроль";
  wb.created = new Date();

  const ws = wb.addWorksheet(def.sheetName.slice(0, 31) || "Лист1");
  ws.columns = def.columns.map((c) => ({
    header: c.label + (c.required ? " *" : ""),
    key: c.key || c.label,
    width: Math.max(14, Math.min(40, c.label.length + 6)),
  }));

  // Шапка с брендированием над таблицей
  ws.spliceRows(1, 0, [brandHeaderLine(b)], [def.title], []);
  ws.getRow(1).font = { bold: true, size: 12, color: { argb: "FF1E3A5F" } };
  ws.getRow(2).font = { bold: true, size: 11 };

  const headRow = ws.getRow(4);
  headRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  headRow.alignment = { vertical: "middle", wrapText: true };
  headRow.height = 30;
  ws.views = [{ state: "frozen", ySplit: 4 }];

  // Строка-подсказка по каждой колонке (если задана)
  if (def.columns.some((c) => (c.hint ?? "").trim())) {
    const hintRow = ws.addRow(def.columns.map((c) => (c.hint ?? "").trim()));
    hintRow.font = { italic: true, size: 9, color: { argb: "FF6B7280" } };
    hintRow.alignment = { wrapText: true, vertical: "top" };
  }

  previewRows(def).forEach((r) => {
    ws.addRow(r).font = { italic: true, color: { argb: "FF6B7280" } };
  });

  // Строки-подсказки внизу
  def.notes.filter(Boolean).forEach((n) => {
    ws.addRow([n]).font = { italic: true, size: 9, color: { argb: "FF6B7280" } };
  });
  const sign = signatureLine(b);
  if (sign) {
    ws.addRow([]);
    ws.addRow([sign]).font = { italic: true, color: { argb: "FF6B7280" } };
  }

  // Лист с инструкцией
  const info = wb.addWorksheet("Инструкция");
  info.columns = [{ width: 34 }, { width: 76 }];
  info.addRow([b.orgName || "ГРР-Контроль", def.title]).font = { bold: true, size: 13 };
  info.addRow([]);
  info.addRow(["Лист с данными", def.sheetName]);
  info.addRow(["Шапка таблицы", "Строка 4 файла. Выше — название организации и шаблона, их можно не удалять."]);
  info.addRow([]);
  info.addRow(["Колонка", "Требование"]).font = { bold: true };
  def.columns.forEach((c) =>
    info.addRow([
      c.label,
      (c.required ? "Обязательная. " : "Необязательная. ") +
        (c.custom ? "Своя колонка — программа сохранит её в файле, но при загрузке не разбирает. " : "") +
        (c.hint ? `Подсказка: ${c.hint}` : ""),
    ]),
  );
  info.addRow([]);
  def.notes.filter(Boolean).forEach((n) => info.addRow(["Важно", n]));
  info.eachRow((row) => (row.alignment = { wrapText: true, vertical: "top" }));

  const fileName = `${def.title}.xlsx`.replace(/[\\/:*?"<>|]/g, "-");
  return { wb, fileName };
}

/* ==================== Шаблон на основе файла заказчика ==================== */

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

const isOldXlsBuffer = (buffer: Buffer, fileName: string) =>
  /\.xls$/i.test(fileName) ||
  (buffer.length > 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0);

/** Разбор файла заказчика: предлагается шаблон, повторяющий его структуру */
export async function proposeFromFile(buffer: Buffer, fileName: string) {
  let matrix: any[][] = [];

  if (/\.csv$/i.test(fileName)) {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
    if (!lines.length) throw new Error("Файл пустой — нет ни одной строки");
    const delim = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
    matrix = lines.slice(0, 30).map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, "")));
  } else if (isOldXlsBuffer(buffer, fileName)) {
    // Старый формат Excel 97-2003 (.xls) — не zip-архив, ExcelJS его не читает
    let xwb: XLSX.WorkBook;
    try {
      xwb = XLSX.read(buffer, { type: "buffer", cellDates: true });
    } catch {
      throw new Error("Не удалось прочитать файл. Убедитесь, что это исправный файл Excel (.xls/.xlsx) или CSV.");
    }
    const ws = xwb.Sheets[xwb.SheetNames[0]];
    if (!ws) throw new Error("В файле не найдено ни одного листа");
    matrix = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false, defval: null }) as any[][];
  } else {
    let wb: ExcelJS.Workbook;
    try {
      wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as any);
    } catch {
      throw new Error(
        "Не удалось прочитать файл как Excel (.xlsx). Проверьте, что файл не повреждён и действительно " +
        "имеет формат .xlsx/.xls/.csv (иногда файл с таким расширением на самом деле в другом формате)."
      );
    }
    const sheet = wb.worksheets[0];
    if (!sheet) throw new Error("В файле не найдено ни одного листа");
    sheet.eachRow((row) => {
      const raw = (row.values as any[]).slice(1);
      const dense: any[] = [];
      for (let i = 0; i < raw.length; i++) dense.push(raw[i] === undefined ? null : cellToValue(raw[i]));
      matrix.push(dense);
    });
  }

  if (!matrix.length) throw new Error("В файле не найдено ни одного листа с данными");
  if (!matrix.length) throw new Error("На первом листе нет данных");

  // Строка шапки: первая строка, где не меньше двух непустых текстовых ячеек
  let headerIdx = 0;
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const filled = matrix[i].filter((c) => c !== null && String(c).trim() !== "");
    const texts = filled.filter((c) => typeof c === "string" && String(c).trim().length > 1);
    if (filled.length >= 2 && texts.length >= 2) { headerIdx = i; break; }
  }
  const width = Math.max(...matrix.slice(headerIdx, headerIdx + 6).map((r) => r.length), 1);
  const headerRowCells = Array.from({ length: width }, (_v, i) => (matrix[headerIdx] ?? [])[i] ?? null);
  const seenLabels = new Set<string>();
  const headers = headerRowCells.map((h: any, i: number) => {
    let label = String(h ?? "").replace(/\s+/g, " ").trim() || `Колонка ${i + 1}`;
    if (label.length > 80) label = label.slice(0, 80);
    // одинаковые названия колонок недопустимы — добавляем номер
    let candidate = label;
    let n = 2;
    while (seenLabels.has(norm(candidate))) candidate = `${label} (${n++})`;
    seenLabels.add(norm(candidate));
    return candidate;
  });
  const sampleRows = matrix
    .slice(headerIdx + 1)
    .filter((r) => r.some((c) => c !== null && String(c).trim() !== ""))
    .slice(0, 5)
    .map((r) => headers.map((_h, i) => (r[i] === null || r[i] === undefined ? "" : r[i])));

  // Какой тип сводки ближе всего к структуре файла
  const scores = (Object.keys(DATA_TYPES) as DataType[]).map((type) => {
    const fields = IMPORT_FIELDS[type];
    let hit = 0;
    headers.forEach((h) => {
      const nh = norm(h);
      if (fields.some((f) => f.aliases.includes(nh) || norm(f.label) === nh ||
        f.aliases.some((a) => a.length > 3 && nh.startsWith(a)))) hit++;
    });
    return { type, score: hit / Math.max(1, fields.filter((f) => f.required).length) };
  }).sort((a, b) => b.score - a.score);
  const baseType = scores[0].score > 0 ? scores[0].type : "";

  const fields = baseType ? IMPORT_FIELDS[baseType as DataType] : [];
  const used = new Set<string>();
  const columns: TemplateColumn[] = headers.map((h) => {
    const nh = norm(h);
    const f = fields.find((x) =>
      !used.has(x.key) && (norm(x.label) === nh || x.aliases.includes(nh) ||
        x.aliases.some((a) => a.length > 3 && nh.startsWith(a))));
    if (f) used.add(f.key);
    return {
      key: f ? f.key : `own_${(norm(h).slice(0, 20) || "kol")}_${Math.random().toString(36).slice(2, 6)}`,
      label: h,
      required: f?.required ?? false,
      hint: "",
      custom: !f,
    };
  });

  return {
    fileName,
    sheetName: (sheet.name || "Лист1").slice(0, 31),
    headerRow: headerIdx + 1,
    title: `Шаблон по файлу «${fileName.replace(/\.(xlsx|xlsm|xls|csv)$/i, "")}»`,
    baseType,
    baseTypeLabel: baseType ? DATA_TYPES[baseType as DataType] : "",
    recognized: columns.filter((c) => !c.custom).length,
    columns,
    sampleRows,
    notes: [`Шаблон создан по файлу «${fileName}» — структура повторяет ваш рабочий файл.`],
  };
}
