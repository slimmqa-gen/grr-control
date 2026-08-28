import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { storage } from "./storage";
import {
  SMART_ENTITIES, SMART_TYPES, DOWNTIME_REASONS,
  type SmartType, type SmartEntity, type ImportProfile,
} from "@shared/schema";

/* ==================== Вспомогательные разборщики ==================== */

export const norm = (s: any) =>
  String(s ?? "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]/g, "");

const MONTHS_RU: Record<string, number> = {
  январ: 1, феврал: 2, март: 3, апрел: 4, мая: 5, май: 6 - 1, июн: 6, июл: 7,
  август: 8, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12,
};

/** Дата в любом виде: 12.08.2026, 12.08.26, 12 августа, 12/08, число Excel */
export function parseDate(v: any, fallbackYear = new Date().getFullYear()): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})[.\/-](\d{1,2})$/);
  if (m) return `${fallbackYear}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.toLowerCase().match(/^(\d{1,2})\s+([а-яё]+)\.?\s*(\d{4})?/);
  if (m) {
    const key = Object.keys(MONTHS_RU).find((k) => m![2].startsWith(k));
    if (key) {
      const mm = key === "мая" ? 5 : MONTHS_RU[key];
      const y = m[3] ? Number(m[3]) : fallbackYear;
      return `${y}-${String(mm).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
  }
  const n = Number(s.replace(",", "."));
  if (Number.isFinite(n) && n > 20000 && n < 60000)
    return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Числа с пробелами и запятой: «1 245,5» → 1245.5 */
export function parseNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/\u00a0/g, " ").replace(/\s/g, "").replace(/[^\d.,-]/g, "").replace(",", ".");
  if (!s || s === "-" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const TOTAL_RE = /^(итого|всего|сумма|итог|total|итогозасмену|всегозасмену|итогопоскважине)/;

export const isTotalRow = (row: any[]) =>
  row.some((c) => TOTAL_RE.test(norm(c)));

/* ==================== Чтение книги с разъединением ячеек ==================== */

export type SheetData = { name: string; matrix: any[][] };

function cellValue(cell: ExcelJS.Cell): any {
  const v: any = cell.value;
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("text" in v) return String(v.text);
    if ("result" in v) return (v as any).result ?? null;
    if ("richText" in v) return (v as any).richText.map((t: any) => t.text).join("");
    if ("hyperlink" in v) return String((v as any).text ?? "");
    return null;
  }
  return v;
}

/** Читает книгу: объединённые ячейки разъединяются, значение протягивается */
export async function readSheets(buffer: Buffer, fileName: string): Promise<SheetData[]> {
  if (/\.csv$/i.test(fileName)) {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/);
    const delim = (lines[0]?.match(/;/g)?.length ?? 0) > (lines[0]?.match(/,/g)?.length ?? 0) ? ";" : ",";
    return [{
      name: "CSV",
      matrix: lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, ""))),
    }];
  }

  // Старый формат Excel 97-2003 (.xls) — не zip-архив, ExcelJS его не читает.
  // Определяем по расширению файла и по «магической подписи» бинарного формата OLE2.
  const isOldXls =
    /\.xls$/i.test(fileName) ||
    (buffer.length > 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0);

  if (isOldXls) {
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
    } catch {
      throw new Error("Не удалось прочитать файл. Убедитесь, что это исправный файл Excel (.xls/.xlsx) или CSV.");
    }
    const out: SheetData[] = wb.SheetNames.map((name) => {
      const ws = wb.Sheets[name];
      const matrix = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false, defval: null }) as any[][];
      return { name, matrix };
    });
    if (!out.length) throw new Error("В файле не найдено ни одного листа с данными");
    return out;
  }

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
  const out: SheetData[] = [];
  wb.eachSheet((ws) => {
    const rowCount = Math.min(ws.rowCount || 0, 5000);
    const colCount = Math.min(ws.columnCount || 0, 80);
    const matrix: any[][] = [];
    for (let r = 1; r <= rowCount; r++) {
      const row: any[] = [];
      for (let c = 1; c <= colCount; c++) {
        const cell = ws.getRow(r).getCell(c);
        // Объединённая ячейка: берём значение «главной» ячейки — протяжка вправо и вниз
        const value = (cell as any).isMerged && (cell as any).master
          ? cellValue((cell as any).master) : cellValue(cell);
        row.push(value === "" ? null : value);
      }
      matrix.push(row);
    }
    out.push({ name: ws.name, matrix });
  });
  if (!out.length) throw new Error("В файле не найдено ни одного листа с данными");
  return out;
}

const isEmptyRow = (row: any[]) => row.every((c) => c === null || String(c).trim() === "");

/** Разбиение листа на блоки таблиц по пустым строкам */
export function detectBlocks(matrix: any[][]): { from: number; to: number }[] {
  const blocks: { from: number; to: number }[] = [];
  let start = -1;
  for (let i = 0; i < matrix.length; i++) {
    const empty = isEmptyRow(matrix[i]);
    if (!empty && start < 0) start = i;
    if (empty && start >= 0) {
      if (i - start >= 2) blocks.push({ from: start, to: i - 1 });
      start = -1;
    }
  }
  if (start >= 0 && matrix.length - start >= 2) blocks.push({ from: start, to: matrix.length - 1 });
  return blocks.length ? blocks : [{ from: 0, to: Math.max(0, matrix.length - 1) }];
}

function aliasPool(type: SmartType): Set<string> {
  const set = new Set<string>();
  SMART_ENTITIES[type].forEach((e) => e.fields.forEach((f) => {
    set.add(norm(f.label));
    f.aliases.forEach((a) => set.add(norm(a)));
  }));
  return set;
}

function scoreHeaderRow(row: any[], pool: Set<string>): number {
  let score = 0;
  row.forEach((c) => {
    const n = norm(c);
    if (!n) return;
    if (pool.has(n)) score += 2;
    else if ([...pool].some((a) => a.length > 3 && (n.startsWith(a) || n.includes(a)))) score += 1;
  });
  return score;
}

export type HeaderDetection = {
  headerRow: number;      // индекс строки в матрице
  headers: string[];
  twoLevel: boolean;
  score: number;
};

/** Автопоиск строки заголовков в первых 30 строках блока, включая двухуровневую шапку */
export function detectHeader(matrix: any[][], block: { from: number; to: number }, type: SmartType): HeaderDetection {
  const pool = aliasPool(type);
  const limit = Math.min(block.to, block.from + 29);
  let best: HeaderDetection = { headerRow: block.from, headers: [], twoLevel: false, score: -1 };
  for (let i = block.from; i <= limit; i++) {
    const row = matrix[i] ?? [];
    const filled = row.filter((c) => c !== null && String(c).trim() !== "").length;
    if (filled < 2) continue;
    const single = scoreHeaderRow(row, pool);
    const next = matrix[i + 1] ?? [];
    const merged = row.map((c, j) => {
      const a = String(c ?? "").trim();
      const b = String(next[j] ?? "").trim();
      return a && b && norm(a) !== norm(b) ? `${a} ${b}` : (b || a);
    });
    const twoScore = scoreHeaderRow(merged, pool);
    if (twoScore > single + 1 && next.filter((c) => c !== null && String(c).trim() !== "").length >= 2) {
      if (twoScore > best.score)
        best = { headerRow: i, headers: merged.map((h, j) => h || `Колонка ${j + 1}`), twoLevel: true, score: twoScore };
    } else if (single > best.score) {
      best = {
        headerRow: i,
        headers: row.map((h, j) => String(h ?? "").trim() || `Колонка ${j + 1}`),
        twoLevel: false, score: single,
      };
    }
  }
  return best;
}

/** Вертикальная сводка: показатели в первой колонке */
export function looksTransposed(matrix: any[][], block: { from: number; to: number }, type: SmartType): boolean {
  const pool = aliasPool(type);
  const col = [];
  for (let i = block.from; i <= Math.min(block.to, block.from + 30); i++) col.push(matrix[i]?.[0]);
  const colScore = scoreHeaderRow(col, pool);
  const rowScores = [];
  for (let i = block.from; i <= Math.min(block.to, block.from + 5); i++)
    rowScores.push(scoreHeaderRow(matrix[i] ?? [], pool));
  return colScore >= 6 && colScore > Math.max(...rowScores, 0) + 2;
}

export function transpose(matrix: any[][]): any[][] {
  const cols = Math.max(...matrix.map((r) => r.length), 0);
  const out: any[][] = [];
  for (let c = 0; c < cols; c++) out.push(matrix.map((r) => r[c] ?? null));
  return out;
}

/* ==================== Профили ==================== */

export const signatureOf = (headers: string[]) =>
  headers.map(norm).filter((h) => h && !/^колонка\d+$/.test(h)).sort();

export function similarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a), sb = new Set(b);
  let inter = 0;
  sa.forEach((x) => { if (sb.has(x)) inter++; });
  return inter / new Set([...a, ...b]).size;
}

export function matchProfile(headers: string[], kind: SmartType) {
  const sig = signatureOf(headers);
  let best: { profile: ImportProfile; score: number } | null = null;
  storage.profiles().forEach((p) => {
    if (p.kind !== kind) return;
    let psig: string[] = [];
    try { psig = JSON.parse(p.signature || "[]"); } catch { psig = []; }
    const score = similarity(sig, psig);
    if (!best || score > best.score) best = { profile: p, score };
  });
  if (best && (best as any).score >= 0.6) return best;
  return null;
}

/* ==================== Автосопоставление колонок ==================== */

export function suggestSmartMapping(headers: string[], type: SmartType): Record<string, Record<string, string>> {
  const map: Record<string, Record<string, string>> = {};
  const used = new Set<string>();
  SMART_ENTITIES[type].forEach((entity) => {
    const m: Record<string, string> = {};
    entity.fields.forEach((f) => {
      const targets = [norm(f.label), ...f.aliases.map(norm)];
      let idx = headers.findIndex((h) => targets.includes(norm(h)));
      if (idx < 0)
        idx = headers.findIndex((h) => {
          const n = norm(h);
          return targets.some((a) => a.length > 3 && (n === a || n.startsWith(a) || n.includes(a)));
        });
      m[f.key] = idx >= 0 ? String(idx) : "";
      if (idx >= 0) used.add(`${entity.key}.${f.key}`);
    });
    map[entity.key] = m;
  });
  return map;
}

/** Блок считается данными, если по его заголовкам распознано не менее двух полей. */
export function blockLooksLikeData(headers: string[], type: SmartType): boolean {
  const m = suggestSmartMapping(headers, type);
  // хотя бы одна сущность должна получить две разные колонки
  return Object.values(m).some(
    (e) => new Set(Object.values(e).filter((v) => v !== "")).size >= 2);
}

/* ==================== Синонимы и справочники ==================== */

function synonymMap(kind: string) {
  const m = new Map<string, string>();
  storage.synonyms().filter((s) => s.kind === kind).forEach((s) => m.set(norm(s.alias), s.canonical));
  return m;
}

function resolveRef<T extends { id: number; name: string }>(
  list: T[], value: any, kind: string, syn: Map<string, string>,
): T | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const bySyn = syn.get(norm(raw));
  const target = bySyn ? norm(bySyn) : norm(raw);
  return list.find((x) => norm(x.name) === target)
    ?? list.find((x) => norm(x.name).includes(target) || target.includes(norm(x.name)));
}

/* ==================== Кэш загрузок ==================== */

type Cached = { fileName: string; sheets: SheetData[]; at: number };
const cache = new Map<string, Cached>();

export type SheetInfo = {
  index: number;
  name: string;
  rows: number;
  blocks: {
    index: number; from: number; to: number; headerRow: number; headers: string[];
    twoLevel: boolean; dataRows: number; transposed: boolean;
  }[];
};

export type SmartUpload = {
  uploadId: string;
  fileName: string;
  type: SmartType;
  sheets: SheetInfo[];
  mapping: Record<string, Record<string, string>>;
  defaults: Record<string, string>;
  profile: { id: number; name: string; score: number } | null;
  message: string;
  headerFound: boolean;
};

function guessType(sheets: SheetData[]): SmartType {
  const flat = sheets.flatMap((s) => s.matrix.slice(0, 40).flat()).map(norm).join(" ");
  const geoWords = ["скважина", "выходкерна", "литология", "проба", "распиловка", "керн"];
  const drillWords = ["станок", "бригада", "проходка", "пзр", "простой", "топливо", "метры"];
  const g = geoWords.filter((w) => flat.includes(w)).length;
  const d = drillWords.filter((w) => flat.includes(w)).length;
  return g > d ? "geo" : "drill";
}

/** Разбор загруженного файла со всеми листами и блоками */
export async function smartUpload(buffer: Buffer, fileName: string, forcedType?: SmartType): Promise<SmartUpload> {
  const sheets = await readSheets(buffer, fileName);
  const type = forcedType ?? guessType(sheets);

  const info: SheetInfo[] = sheets.map((sh, si) => {
    const blocks = detectBlocks(sh.matrix).map((b, bi) => {
      const t = looksTransposed(sh.matrix, b, type);
      const m = t ? transpose(sh.matrix.slice(b.from, b.to + 1)) : sh.matrix;
      const range = t ? { from: 0, to: m.length - 1 } : b;
      const det = detectHeader(m, range, type);
      const dataRows = m.slice(det.headerRow + (det.twoLevel ? 2 : 1), range.to + 1)
        .filter((r) => !isEmptyRow(r) && !isTotalRow(r)).length;
      return {
        index: bi, from: b.from, to: b.to, headerRow: det.headerRow,
        headers: det.headers, twoLevel: det.twoLevel, dataRows, transposed: t,
      };
    }).filter((b) => b.headers.length && (b.dataRows > 0 || blockLooksLikeData(b.headers, type)))
      .filter((b) => blockLooksLikeData(b.headers, type));
    return { index: si, name: sh.name, rows: sh.matrix.length, blocks };
  });

  const mainBlock = info.flatMap((s) => s.blocks).sort((a, b) => b.dataRows - a.dataRows)[0];
  const headers = mainBlock?.headers ?? [];
  const matched = matchProfile(headers, type) as any;

  let mapping = suggestSmartMapping(headers, type);
  let defaults: Record<string, string> = {};
  if (matched) {
    try { mapping = JSON.parse(matched.profile.mapping); } catch { /* профиль повреждён */ }
    try { defaults = JSON.parse(matched.profile.defaults); } catch { /* пусто */ }
  }

  const headerFound = !!mainBlock && mainBlock.headers.some((h) => !/^Колонка \d+$/.test(h));
  const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  cache.set(uploadId, { fileName, sheets, at: Date.now() });
  for (const [k, v] of cache) if (Date.now() - v.at > 3600_000) cache.delete(k);

  return {
    uploadId, fileName, type, sheets: info, mapping, defaults,
    profile: matched ? { id: matched.profile.id, name: matched.profile.name, score: Math.round(matched.score * 100) } : null,
    headerFound,
    message: !headerFound
      ? "Не удалось найти строку заголовков. Укажите её вручную — выберите лист, блок и номер строки заголовков."
      : matched
        ? `Файл распознан по профилю «${matched.profile.name}» (совпадение структуры ${Math.round(matched.score * 100)}%). Сопоставление колонок уже готово — можно сразу загружать.`
        : `Структура файла разобрана: листов ${info.length}, блоков ${info.reduce((s, x) => s + x.blocks.length, 0)}. Проверьте сопоставление и сохраните профиль.`,
  };
}

/* ==================== Предпросмотр и загрузка ==================== */

export type SmartRowIssue = { sheet: string; row: number; level: "ошибка" | "предупреждение"; message: string };

export type SmartPreview = {
  type: SmartType;
  entities: { key: string; label: string; plural: string; count: number; sample: any[] }[];
  totalRows: number;
  skippedTotals: number;
  issues: SmartRowIssue[];
  summary: string;
};

type Options = {
  uploadId: string;
  type: SmartType;
  mapping: Record<string, Record<string, string>>;
  defaults?: Record<string, string>;
  sheetRule?: string;      // все | первый | по названию
  sheetMatch?: string;
  headerRow?: number;      // 0 = автоматически (1-based для пользователя)
  blockIndex?: number;
  transposed?: boolean;
};

function sheetDate(name: string): string | null {
  return parseDate(name.replace(/[^\d.\/ а-яё-]/gi, " ").trim());
}

function pickSheets(sheets: SheetData[], rule = "все", match = ""): SheetData[] {
  if (rule === "первый") return sheets.slice(0, 1);
  if (rule === "по названию" && match)
    return sheets.filter((s) => norm(s.name).includes(norm(match)));
  return sheets;
}

function collectRows(sheets: SheetData[], type: SmartType, o: Options) {
  const out: {
    sheet: string; rowNo: number; cells: any[]; headers: string[];
    map: Record<string, Record<string, string>>;
  }[] = [];
  // Заголовки главного блока — к ним привязано ручное сопоставление
  const allBlocks = pickSheets(sheets, o.sheetRule, o.sheetMatch).flatMap((sh) =>
    detectBlocks(sh.matrix).map((b) => {
      const t = o.transposed ?? looksTransposed(sh.matrix, b, type);
      const m = t ? transpose(sh.matrix.slice(b.from, b.to + 1)) : sh.matrix;
      const range = t ? { from: 0, to: m.length - 1 } : b;
      const det = detectHeader(m, range, type);
      const dataRows = m.slice(det.headerRow + 1, range.to + 1).filter((r) => r && !isEmptyRow(r) && !isTotalRow(r)).length;
      return { headers: det.headers, dataRows };
    })).filter((b) => blockLooksLikeData(b.headers, type));
  const mainHeaders = [...allBlocks].sort((a, b) => b.dataRows - a.dataRows)[0]?.headers ?? [];
  const sig = (h: string[]) => h.map(norm).join("|");
  const mainSig = sig(mainHeaders);
  let skippedTotals = 0;
  pickSheets(sheets, o.sheetRule, o.sheetMatch).forEach((sh) => {
    const blocks = detectBlocks(sh.matrix);
    const chosen = o.blockIndex !== undefined && o.blockIndex >= 0 && blocks[o.blockIndex]
      ? [blocks[o.blockIndex]] : blocks;
    chosen.forEach((b) => {
      const t = o.transposed ?? looksTransposed(sh.matrix, b, type);
      const m = t ? transpose(sh.matrix.slice(b.from, b.to + 1)) : sh.matrix;
      const range = t ? { from: 0, to: m.length - 1 } : b;
      const det = detectHeader(m, range, type);
      // Шапки, титулы и подписи под таблицей данными не считаем
      if (!o.headerRow && !blockLooksLikeData(det.headers, type)) return;
      const headerRow = o.headerRow && o.headerRow > 0 ? o.headerRow - 1 : det.headerRow;
      const skip = det.twoLevel && !o.headerRow ? 2 : 1;
      for (let i = headerRow + skip; i <= range.to; i++) {
        const row = m[i];
        if (!row || isEmptyRow(row)) continue;
        if (isTotalRow(row)) { skippedTotals++; continue; }
        // Для блока с другой структурой сопоставление подбирается автоматически
        const map = sig(det.headers) === mainSig ? o.mapping : suggestSmartMapping(det.headers, type);
        out.push({ sheet: sh.name, rowNo: i + 1, cells: row, headers: det.headers, map });
      }
    });
  });
  return { rows: out, skippedTotals };
}

type Built = { entity: string; values: any; sheet: string; rowNo: number };

function buildEntities(rowsData: ReturnType<typeof collectRows>, type: SmartType, o: Options) {
  const objects = storage.objects();
  const rigs = storage.rigs();
  const brigades = storage.brigades();
  const employees = storage.employees().map((e) => ({ id: e.id, name: e.fio }));
  const synObj = synonymMap("object");
  const synRig = synonymMap("rig");
  const synBrig = synonymMap("brigade");
  const synDown = synonymMap("downtime");
  const defaults = o.defaults ?? {};
  const issues: SmartRowIssue[] = [];
  const built: Built[] = [];

  const val = (cells: any[], entity: string, key: string, map: any) => {
    const idx = map?.[entity]?.[key];
    if (idx === undefined || idx === "") return null;
    const v = cells[Number(idx)];
    return v === undefined ? null : v;
  };

  rowsData.rows.forEach(({ cells, sheet, rowNo, map }) => {
    const sheetDefaultDate = sheetDate(sheet);

    SMART_ENTITIES[type].forEach((entity: SmartEntity) => {
      const raw: Record<string, any> = {};
      entity.fields.forEach((f) => { raw[f.key] = val(cells, entity.key, f.key, map); });
      const hasAny = entity.fields.some((f) => f.required && raw[f.key] !== null && String(raw[f.key]).trim() !== "");
      const required = entity.fields.filter((f) => f.required);
      const missing = required.filter((f) => raw[f.key] === null || String(raw[f.key]).trim() === "");
      if (!hasAny) return; // сущность в этом файле не заполнена

      // Объект: из файла, из правил подстановки или из названия листа
      const objRaw = raw.object ?? defaults.object ?? "";
      const obj = resolveRef(objects, objRaw, "object", synObj)
        ?? (defaults.object ? resolveRef(objects, defaults.object, "object", synObj) : undefined)
        ?? resolveRef(objects, sheet, "object", synObj);
      const date = parseDate(raw.date) ?? sheetDefaultDate ?? (defaults.date || null);

      if (missing.length) {
        issues.push({
          sheet, row: rowNo, level: "предупреждение",
          message: `${entity.label}: не заполнено «${missing.map((f) => f.label).join(", ")}» — строка пропущена`,
        });
        return;
      }

      if (entity.key === "reports") {
        const rig = resolveRef(rigs, raw.rig, "rig", synRig);
        if (!rig) {
          issues.push({ sheet, row: rowNo, level: "ошибка", message: `Станок «${raw.rig}» не найден в справочнике. Добавьте синоним или станок.` });
          return;
        }
        if (!obj) {
          issues.push({ sheet, row: rowNo, level: "ошибка", message: "Объект не определён: укажите правило подстановки в профиле" });
          return;
        }
        if (!date) {
          issues.push({ sheet, row: rowNo, level: "ошибка", message: "Не удалось распознать дату" });
          return;
        }
        const brig = resolveRef(brigades, raw.brigade, "brigade", synBrig)
          ?? brigades.find((b) => b.objectId === obj.id);
        const reasonRaw = String(raw.downtimeReason ?? "").trim();
        const reasonSyn = synDown.get(norm(reasonRaw));
        const reason = reasonSyn
          ?? (DOWNTIME_REASONS.find((r) => norm(r) === norm(reasonRaw)) ?? (reasonRaw || "нет"));
        built.push({
          entity: "reports", sheet, rowNo,
          values: {
            date, objectId: obj.id, rigId: rig.id, brigadeId: brig?.id ?? 0,
            shift: norm(raw.shift).startsWith("н") ? "ночь" : "день",
            meters: parseNum(raw.meters) ?? 0,
            drillHours: parseNum(raw.drillHours) ?? 0,
            pzrHours: parseNum(raw.pzrHours) ?? 0,
            downtimeHours: parseNum(raw.downtimeHours) ?? 0,
            downtimeReason: reason,
            comment: String(raw.comment ?? "").slice(0, 200),
            holeName: String(raw.hole ?? "").trim(),
          },
        });
      }

      if (entity.key === "fuel") {
        const fact = parseNum(raw.factLiters);
        if (!obj || fact === null || !date) return;
        const unitRaw = String(raw.unitName ?? "").trim();
        const unitName = synRig.get(norm(unitRaw)) ?? unitRaw;
        built.push({
          entity: "fuel", sheet, rowNo,
          values: {
            date, objectId: obj.id, unitName: unitName || "—",
            // если норма в сводке не указана, берём факт — иначе получаем ложный «перерасход»
            normLiters: parseNum(raw.normLiters) ?? fact, factLiters: fact,
          },
        });
      }

      if (entity.key === "inventory") {
        const qty = parseNum(raw.qty);
        if (!obj || qty === null) return;
        built.push({
          entity: "inventory", sheet, rowNo,
          values: {
            objectId: obj.id, itemName: String(raw.itemName ?? "").trim() || "Дизтопливо",
            qty, unit: String(raw.unit ?? "л"), minQty: 0, dailyUse: 0, expectedDelivery: "",
          },
        });
      }

      if (entity.key === "corelogs") {
        const from = parseNum(raw.fromDepth), to = parseNum(raw.toDepth);
        if (from === null || to === null || to <= from) {
          issues.push({ sheet, row: rowNo, level: "ошибка", message: "Интервал описания керна указан неверно" });
          return;
        }
        const geo = resolveRef(employees, raw.geologist, "employee", synObj);
        built.push({
          entity: "corelogs", sheet, rowNo,
          values: {
            date: date ?? "", objectId: obj?.id ?? 0, holeName: String(raw.hole ?? "").trim(),
            fromDepth: from, toDepth: to, geologistId: geo?.id ?? 0,
            recoveryPct: parseNum(raw.recoveryPct) ?? 100,
            lithology: String(raw.lithology ?? ""), mineralization: 0,
            mineralizationNote: "", photo: 0, status: "описано",
          },
        });
      }

      if (entity.key === "samples") {
        const code = String(raw.code ?? "").trim();
        if (!code) return;
        built.push({
          entity: "samples", sheet, rowNo,
          values: {
            code, date: date ?? "", objectId: obj?.id ?? 0, rigId: 0,
            holeName: String(raw.hole ?? "").trim(),
            fromDepth: parseNum(raw.fromDepth) ?? 0, toDepth: parseNum(raw.toDepth) ?? 0,
            sampleType: String(raw.sampleType ?? "керновая") || "керновая",
            weightKg: parseNum(raw.weightKg) ?? 0, geologistId: 0,
            stage: "Отобрана", stageDate: date ?? "", status: "в работе",
            rejectReason: "", batchId: 0, note: "",
          },
        });
      }

      if (entity.key === "corecuts") {
        const from = parseNum(raw.fromDepth), to = parseNum(raw.toDepth);
        if (from === null || to === null || to <= from) return;
        built.push({
          entity: "corecuts", sheet, rowNo,
          values: {
            date: date ?? "", objectId: obj?.id ?? 0, holeName: String(raw.hole ?? "").trim(),
            fromDepth: from, toDepth: to, worker: String(raw.worker ?? ""),
            shift: "день", cutType: "продольная", equipmentId: 0,
            rejectMeters: parseNum(raw.rejectMeters) ?? 0, rejectReason: "", status: "распилено",
          },
        });
      }
    });
  });

  return { built, issues };
}

export function smartPreview(o: Options): SmartPreview {
  const cached = cache.get(o.uploadId);
  if (!cached) throw new Error("Файл не найден или срок хранения истёк. Загрузите файл заново.");
  const rowsData = collectRows(cached.sheets, o.type, o);
  const { built, issues } = buildEntities(rowsData, o.type, o);

  const entities = SMART_ENTITIES[o.type].map((e) => ({
    key: e.key, label: e.label, plural: e.plural,
    count: built.filter((b) => b.entity === e.key).length,
    sample: built.filter((b) => b.entity === e.key).slice(0, 5).map((b) => b.values),
  }));
  const parts = entities.filter((e) => e.count > 0).map((e) => `${e.plural} ${e.count}`);
  return {
    type: o.type, entities,
    totalRows: rowsData.rows.length,
    skippedTotals: rowsData.skippedTotals,
    issues: issues.slice(0, 60),
    summary: parts.length ? `Будет добавлено: ${parts.join(", ")}` : "Ни одной записи распознать не удалось",
  };
}

export function smartCommit(o: Options & { fileName?: string; author?: string }) {
  const cached = cache.get(o.uploadId);
  if (!cached) throw new Error("Файл не найден или срок хранения истёк. Загрузите файл заново.");
  const rowsData = collectRows(cached.sheets, o.type, o);
  const { built, issues } = buildEntities(rowsData, o.type, o);
  if (!built.length) throw new Error("Нечего загружать: ни одной корректной строки не распознано");

  const log = storage.createImportLog({
    createdAt: new Date().toISOString(), fileName: cached.fileName,
    dataType: SMART_TYPES[o.type], rowsLoaded: 0, rowsSkipped: rowsData.skippedTotals,
    rowsError: issues.filter((i) => i.level === "ошибка").length,
    author: o.author ?? "—", issues: JSON.stringify(issues.slice(0, 40)), rolledBack: 0,
  });

  const counts: Record<string, number> = {};
  const existingSamples = new Set(storage.samples().map((s) => s.code.toLowerCase()));
  built.forEach((b) => {
    const v = { ...b.values, importId: log.id };
    try {
      if (b.entity === "reports") storage.createReport(v);
      else if (b.entity === "fuel") storage.createFuel(v);
      else if (b.entity === "inventory") storage.createInventory(v);
      else if (b.entity === "corelogs") storage.createCoreLog(v);
      else if (b.entity === "corecuts") storage.createCoreCut(v);
      else if (b.entity === "samples") {
        if (existingSamples.has(String(v.code).toLowerCase())) return;
        existingSamples.add(String(v.code).toLowerCase());
        storage.createSampleRaw(v);
      }
      counts[b.entity] = (counts[b.entity] ?? 0) + 1;
    } catch (e: any) {
      issues.push({ sheet: b.sheet, row: b.rowNo, level: "ошибка", message: e?.message ?? "Ошибка записи" });
    }
  });

  const loaded = Object.values(counts).reduce((s, n) => s + n, 0);
  storage.updateImportLog(log.id, { rowsLoaded: loaded, issues: JSON.stringify(issues.slice(0, 40)) });

  const parts = SMART_ENTITIES[o.type]
    .filter((e) => counts[e.key])
    .map((e) => `${e.plural} ${counts[e.key]}`);
  return {
    importId: log.id, counts, loaded,
    skippedTotals: rowsData.skippedTotals,
    issues: issues.slice(0, 60),
    summary: `Загружено: ${parts.join(", ") || "0"}`,
  };
}

/** Заголовки главного блока — для сохранения профиля */
export function headersOf(uploadId: string, o?: Partial<Options>): string[] {
  const cached = cache.get(uploadId);
  if (!cached) return [];
  const type = (o?.type ?? "drill") as SmartType;
  const all = cached.sheets.flatMap((sh) =>
    detectBlocks(sh.matrix).map((b) => detectHeader(sh.matrix, b, type)));
  return all.sort((a, b) => b.score - a.score)[0]?.headers ?? [];
}
