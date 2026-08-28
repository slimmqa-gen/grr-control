/**
 * Разбор реальных файлов ООО «Производственно-Буровая Компания».
 * 8 встроенных профилей импорта, распознавание по строкам-маркерам.
 * Поддержка .xlsx и .xls (старый формат), всех листов книги, объединённых ячеек,
 * значений через слэш и чисел с запятой.
 */
import * as XLSX from "xlsx";
import { classifyComment, hasIncident, reasonList } from "./pbkdb";

export type Grid = (any)[][];

export type SheetOutcome = {
  sheet: string;
  profile: string;
  profileName: string;
  loaded: number;
  skipped: number;
  notes: string[];
};

export type ParseResult = {
  file: string;
  profiles: string[];
  entities: Record<string, any[]>;
  sheets: SheetOutcome[];
  loaded: number;
  skipped: number;
  notes: string[];
};

export const PBK_PROFILES: Array<{ code: string; name: string; markers: string[]; about: string }> = [
  { code: "drill", name: "Буровая сводка ПБК (участковая)", markers: ["участок:", "мастер:", "Дата + Смена + Проходка за смену"], about: "Сменные рапорты бурения: ФИО бурильщика в поле «Смена», интервал от-до, метры, комментарий. Классифицирует нулевые смены по словарю причин. Поддерживает .xls и два станка на одном листе." },
  { code: "geodoc", name: "Геологическая сводка: документация и опробование", markers: ["ДОКУМЕНТАЦИЯ", "ОПРОБОВАНИЕ", "Распиловка керна"], about: "Два блока в одном листе: описание керна и опробование со своими исполнителями. Даты и скважины протягиваются, значения через слэш разбираются на две записи." },
  { code: "geosummary", name: "Геологическая сводка по скважинам (план/факт/пробы)", markers: ["номер АГР", "ФИО документатора", "Керновые", "Сколковые"], about: "Одна строка — одна скважина: проектные и фактические параметры, метры документации и отставание от бурения, керновые/сколковые/контрольные/холостые пробы, стандарты. Скважины без факта считаются непробуренными." },
  { code: "holes", name: "Реестр скважин (СВЯЗЬ С ММ)", markers: ["HOLE_pro", "TD_pro", "N_CONTRACT"], about: "Проектный и фактический фонд скважин: координаты, азимут, угол, рудная зона, геолог, статус, договор. Строки с нулями — запланированные скважины." },
  { code: "litho", name: "Литология", markers: ["CODE", "МОЩНОСТЬ, М", "ПРОЖИЛКИ"], about: "Интервалы литологического описания с кодом породы и прожилками. Признак потенциально рудного интервала." },
  { code: "prep", name: "Сводка пробоподготовки (ЦПП)", markers: ["Кол-во проб в ЦПП", "дробление шт.", "истирание"], about: "Работа ЦПП по сменам: дробление, истирание, отправка в лабораторию, поступление, РФА. Очередь проб и запас дней." },
  { code: "mining", name: "Сводка горных работ (канавы)", markers: ["номер АГР", "РУЧНАЯ ЗАЧИСТКА", "№ КАНАВЫ", "ДВИЖЕНИ ПРОБ"], about: "План-факт по канавам, дневник зачистки/документации/опробования и движение проб по канавам." },
  { code: "plan", name: "Календарный план к договору", markers: ["Календарный план", "Наименования работ", "Стоимость единицы"], about: "Расценки за единицу, объёмы и суммы по месяцам или годам. Ключевой источник экономики: из него считается фактическая выручка." },
  { code: "costcalc", name: "Карта-предложение (расчёт тарифов)", markers: ["Карта-предложение", "Расчет тарифов", "Статья затрат"], about: "Плановая себестоимость по статьям: ФОТ, ГСМ, инструмент, амортизация, обслуживание, СИЗ, прочие расходы." },
];

export const PROFILE_NAME: Record<string, string> = Object.fromEntries(PBK_PROFILES.map((p) => [p.code, p.name]));

/* ==================== вспомогательные функции ==================== */

const norm = (v: any) => String(v ?? "").replace(/\s+/g, " ").trim();
const low = (v: any) => norm(v).toLowerCase();

export function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/\u00a0/g, " ").replace(/\s/g, "").replace(",", ".");
  s = s.replace(/[^0-9.+-]/g, "");
  if (!s || s === "-" || s === "." ) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Excel-серийная дата → ISO */
export function excelDate(v: any): string {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 60000) {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = norm(v);
  let m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return `${y}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return "";
}

const MONTHS: Record<string, number> = {
  январ: 1, феврал: 2, март: 3, апрел: 4, май: 5, мая: 5, июн: 6, июл: 7,
  август: 8, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12,
};
export function monthFromSheet(sheet: string): { m: number; y: number } | null {
  const s = low(sheet);
  for (const k of Object.keys(MONTHS)) {
    if (s.includes(k)) {
      const ym = s.match(/(20\d{2})/);
      return { m: MONTHS[k], y: ym ? Number(ym[1]) : 2026 };
    }
  }
  return null;
}

/** Разбор значений через слэш: «KSE-76/81», «9,4/0,0», «керн\борода» */
export function splitSlash(v: any): string[] {
  const s = norm(v);
  if (!s) return [];
  if (!/[\/\\]/.test(s)) return [s];
  return s.split(/\s*[\/\\]\s*/).map((x) => x.trim()).filter(Boolean);
}

/** Матрица листа с раскрытыми объединёнными ячейками */
export function sheetGrid(ws: XLSX.WorkSheet): Grid {
  const grid: Grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true }) as any;
  const width = grid.reduce((a, r) => Math.max(a, r ? r.length : 0), 0);
  for (const r of grid) { if (r) while (r.length < width) r.push(null); }
  for (const m of (ws["!merges"] || [])) {
    const v = grid[m.s.r]?.[m.s.c] ?? null;
    if (v === null) continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      if (!grid[r]) grid[r] = new Array(width).fill(null);
      for (let c = m.s.c; c <= m.e.c; c++) if (grid[r][c] === null) grid[r][c] = v;
    }
  }
  return grid;
}

const rowText = (row: any[]) => (row || []).map((v) => norm(v)).join(" | ");
const gridText = (grid: Grid, upto = 12) => grid.slice(0, upto).map(rowText).join(" \n ").toLowerCase();

const TOTAL_WORDS = ["итого", "всего", "пробурено за месяц", "среднее за день", "среднее за смену",
  "количество смен", "максимальное значение", "задокументировано", "опробовано за месяц", "заказчик", "подрядчик"];
export function isTotalRow(row: any[]): boolean {
  const t = rowText(row).toLowerCase();
  if (!t.replace(/[\s|]/g, "")) return false;
  return TOTAL_WORDS.some((w) => t.includes(w));
}

/* ==================== определение профиля листа ==================== */

export function detectSheetProfile(grid: Grid, sheetName: string): string | null {
  const head = gridText(grid, 14);
  const sn = low(sheetName);
  if (head.includes("hole_pro") && head.includes("td_pro")) return "holes";
  if (head.includes("кол-во проб в цпп") || (head.includes("дробление шт") && head.includes("истирание"))) return "prep";
  if (head.includes("номер агр") && head.includes("ручная зачистка")) return "mining";
  if (head.includes("№ канавы") && head.includes("ручная зачистка")) return "mining";
  if (head.includes("code") && (head.includes("мощность") || head.includes("прожилки"))) return "litho";
  if (head.includes("всего проб") && head.includes("мкр")) return "mining";
  if (head.includes("наименования работ") && head.includes("объем работ")) return "plan";
  if (head.includes("статья затрат") || head.includes("карта-предложение") ||
      /расчет затрат|расчет стоимости|расчет амортизации|расчет прочих расходов|расчёт стоимости/.test(head)) return "costcalc";
  if (head.includes("участок:") || /мастер\s*:/.test(head)) return "drill";
  if (head.includes("проходка за смену")) return "drill";
  if ((head.includes("документация") || head.includes("докуменатция")) &&
      (head.includes("опробование") || head.includes("распиловка")) && head.includes("исполнитель")) return "geodoc";
  if (head.includes("номер агр") && head.includes("фио документатора") &&
      (head.includes("керновые") || head.includes("сколковые"))) return "geosummary";
  if (sn.includes("график бурения")) return "costcalc";
  return null;
}

/* ==================== профиль 1. Буровая сводка ==================== */

function metaOf(grid: Grid, headerRow: number) {
  let contract = "", object = "", master = "";
  const rigs: Array<{ col: number; name: string }> = [];
  for (let r = 0; r < headerRow; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      const s = norm(row[c]);
      if (!s) continue;
      const l = s.toLowerCase();
      if (l.startsWith("договор")) contract = s.replace(/^договор\s*№?\s*/i, "").trim();
      else if (l.startsWith("участок")) object = s.replace(/^участок\s*:?\s*/i, "").trim();
      else if (l.includes("мастер")) master = s.replace(/^.*мастер\s*:?\s*/i, "").trim();
      else if (/^[A-Za-zА-Яа-я]{1,4}[\s-]?\d{2,4}[A-Za-z]?$/.test(s) && !/^\d+$/.test(s)) {
        if (!rigs.some((x) => x.col === c)) rigs.push({ col: c, name: s });
      }
    }
  }
  return { contract, object, master, rigs };
}

function parseDrill(grid: Grid, sheet: string, file: string, out: any[], notes: string[]) {
  let headerRow = -1;
  for (let r = 0; r < Math.min(grid.length, 20); r++) {
    const row = grid[r] || [];
    if (low(row[0]) === "дата" && row.some((v) => low(v) === "смена")) { headerRow = r; break; }
  }
  if (headerRow < 0) { notes.push(`лист «${sheet}»: не найдена шапка «Дата | Смена»`); return { loaded: 0, skipped: 0 }; }
  const header = grid[headerRow] || [];
  const sub = grid[headerRow + 1] || [];
  const meta = metaOf(grid, headerRow);
  const ms = monthFromSheet(sheet);

  const shiftCols = header.map((v, i) => (low(v) === "смена" ? i : -1)).filter((i) => i >= 0);
  if (!shiftCols.length) { notes.push(`лист «${sheet}»: не найдено ни одной колонки «Смена»`); return { loaded: 0, skipped: 0 }; }

  const blocks = shiftCols.map((start, bi) => {
    const end = bi + 1 < shiftCols.length ? shiftCols[bi + 1] - 1 : header.length - 1;
    const find = (pred: (h: string, s: string) => boolean) => {
      for (let c = start; c <= end; c++) {
        if (pred(low(header[c]), low(sub[c]))) return c;
      }
      return -1;
    };
    const rig = meta.rigs.filter((r) => r.col >= start - 1 && r.col <= end)[0]?.name
      ?? (bi === 0 ? meta.rigs[0]?.name ?? "" : meta.rigs[bi]?.name ?? "");
    return {
      shift: start,
      holeProject: find((h) => h.includes("проектный")),
      hole: find((h) => h.includes("№ скважины") || h === "№ скв."),
      from: find((h, s) => h.includes("проходка") && s === "от"),
      to: find((h, s) => h.includes("проходка") && s === "до"),
      meters: find((h) => h.includes("проходка за смену")),
      planDepth: find((h) => h.includes("проектн") && !h.includes("скв")),
      comment: find((h) => h.startsWith("комент") || h.startsWith("коммент") || h.includes("примечан")),
      rig,
      start, end,
    };
  });

  const rules = reasonList();
  let loaded = 0, skipped = 0;
  let curDate = "";
  const lastHole: Record<number, string> = {};
  for (let r = headerRow + 2; r < grid.length; r++) {
    const row = grid[r] || [];
    if (isTotalRow(row)) { skipped++; continue; }
    const d = excelDate(row[0]);
    if (d) curDate = d;
    else if (ms && num(row[0]) && Number(num(row[0])) <= 31) {
      curDate = `${ms.y}-${String(ms.m).padStart(2, "0")}-${String(num(row[0])).padStart(2, "0")}`;
    }
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      const shiftMaster = norm(row[b.shift]);
      const metersRaw = b.meters >= 0 ? row[b.meters] : null;
      const comment = b.comment >= 0 ? norm(row[b.comment]) : "";
      if (!shiftMaster && num(metersRaw) === null && !comment) continue;
      if (!shiftMaster && !num(metersRaw)) { continue; }
      const holeRaw = norm(b.hole >= 0 ? row[b.hole] : "") || norm(b.holeProject >= 0 ? row[b.holeProject] : "");
      const holes = splitSlash(holeRaw);
      const froms = splitSlash(b.from >= 0 ? row[b.from] : "");
      const tos = splitSlash(b.to >= 0 ? row[b.to] : "");
      const totalMeters = num(metersRaw) ?? 0;
      const planDepths = splitSlash(b.planDepth >= 0 ? row[b.planDepth] : "");
      const n = Math.max(holes.length, froms.length, tos.length, 1);
      if (holes.length) lastHole[bi] = holes[holes.length - 1];
      const parts: any[] = [];
      for (let i = 0; i < n; i++) {
        const from = num(froms[i] ?? froms[0]) ?? 0;
        const to = num(tos[i] ?? tos[0]) ?? 0;
        const hole = holes[i] ?? (n === 1 ? (holes[0] ?? lastHole[bi] ?? "") : (holes[holes.length - 1] ?? lastHole[bi] ?? ""));
        parts.push({ hole, from, to, meters: to > from ? +(to - from).toFixed(2) : 0, plan: num(planDepths[i] ?? planDepths[0]) ?? 0 });
      }
      const sum = parts.reduce((a, p) => a + p.meters, 0);
      if (n === 1) parts[0].meters = totalMeters || parts[0].meters;
      else if (sum === 0 && totalMeters) parts.forEach((p) => { p.meters = +(totalMeters / n).toFixed(2); });
      for (const p of parts) {
        const zero = p.meters <= 0;
        out.push({
          date: curDate, sheet, object: meta.object, contract: meta.contract, master: meta.master,
          rig: b.rig, shift_master: shiftMaster, hole: p.hole, hole_project: norm(b.holeProject >= 0 ? row[b.holeProject] : ""),
          from_m: p.from, to_m: p.to, meters: p.meters, plan_depth: p.plan, comment,
          loss_category: zero ? classifyComment(comment, rules as any) : "",
          incident: !zero && hasIncident(comment) ? 1 : 0,
          source_file: file,
        });
        loaded++;
      }
    }
  }
  return { loaded, skipped };
}

/* ==================== профиль 2. Геологическая сводка ==================== */

function parseGeoDoc(grid: Grid, sheet: string, file: string, object: string, out: any[], notes: string[]) {
  let headerRow = -1;
  for (let r = 0; r < Math.min(grid.length, 12); r++) {
    if (low(grid[r]?.[0]) === "дата") { headerRow = r; break; }
  }
  if (headerRow < 0) { notes.push(`лист «${sheet}»: не найдена колонка «ДАТА»`); return { loaded: 0, skipped: 0 }; }
  const header = grid[headerRow] || [];
  const sub = grid[headerRow + 1] || [];
  const starts: number[] = [];
  header.forEach((v, i) => { if (/скважина\s*№|№ скважины/.test(low(v)) && !starts.includes(i)) starts.push(i); });
  if (!starts.length) { notes.push(`лист «${sheet}»: не найдены блоки «СКВАЖИНА №»`); return { loaded: 0, skipped: 0 }; }
  const blocks = starts.map((start, bi) => {
    const end = bi + 1 < starts.length ? starts[bi + 1] - 1 : header.length - 1;
    let kind = "документация";
    for (let c = start; c <= end; c++) {
      const h = low(header[c]);
      if (h.includes("опробование")) { kind = "опробование"; break; }
      if (h.includes("распиловка")) { kind = "распиловка"; break; }
    }
    const find = (pred: (h: string, s: string) => boolean) => {
      for (let c = start; c <= end; c++) if (pred(low(header[c]), low(sub[c]))) return c;
      return -1;
    };
    return {
      hole: start, kind,
      from: find((h, s) => s.startsWith("от") || h.startsWith("от,")),
      to: find((h, s) => s.startsWith("до") || h.startsWith("до,")),
      len: find((h, s) => s.startsWith("длина") || h.startsWith("длина")),
      executor: find((h) => h.includes("исполнитель")),
      note: find((h) => h.includes("примечан")),
      start, end,
    };
  });
  let loaded = 0, skipped = 0, curDate = "";
  for (let r = headerRow + 2; r < grid.length; r++) {
    const row = grid[r] || [];
    if (isTotalRow(row)) { skipped++; continue; }
    const d = excelDate(row[0]);
    if (d) curDate = d;
    for (const b of blocks) {
      const holeRaw = norm(row[b.hole]);
      const note = b.note >= 0 ? norm(row[b.note]) : "";
      const exec = b.executor >= 0 ? norm(row[b.executor]) : "";
      if ((!holeRaw || holeRaw === "-") && !note) continue;
      if (holeRaw === "-" || !holeRaw) {
        if (note) { out.push({ kind: b.kind, date: curDate, sheet, hole: "", from_m: 0, to_m: 0, length_m: 0, executor: exec, note, object, source_file: file }); loaded++; }
        continue;
      }
      const holes = splitSlash(holeRaw);
      const froms = splitSlash(row[b.from >= 0 ? b.from : -1]);
      const tos = splitSlash(row[b.to >= 0 ? b.to : -1]);
      const lenTotal = num(b.len >= 0 ? row[b.len] : null) ?? 0;
      const n = Math.max(holes.length, froms.length, tos.length, 1);
      for (let i = 0; i < n; i++) {
        const from = num(froms[i] ?? froms[0]) ?? 0;
        const to = num(tos[i] ?? tos[0]) ?? 0;
        let len = to > from ? +(to - from).toFixed(2) : 0;
        if (n === 1) len = lenTotal || len;
        out.push({
          kind: b.kind, date: curDate, sheet, hole: holes[i] ?? holes[0], from_m: from, to_m: to,
          length_m: len, executor: exec, note, object, source_file: file,
        });
        loaded++;
      }
    }
  }
  return { loaded, skipped };
}

/* ==================== профиль 2б. Геологическая сводка (план+факт+пробы на скважину) ==================== */
// Формат: 2 строки заголовка. Первая строка — крупные блоки (ПРОЕКТ / ФАКТ / документация / пробы),
// вторая — подписи колонок. Одна строка листа = одна скважина, факт может отсутствовать (скважина ещё не пробурена).

function findGeoSummaryCols(grid: Grid) {
  const h1 = (grid[0] || []).map((v) => low(v));
  const h2 = (grid[1] || []).map((v) => low(v));
  const n = Math.max(h1.length, h2.length);
  const findAfter = (blockPred: (s: string) => boolean, subPred: (s: string) => boolean) => {
    let inBlock = false;
    for (let c = 0; c < n; c++) {
      if (h1[c] && blockPred(h1[c])) inBlock = true;
      else if (h1[c] && !blockPred(h1[c]) && inBlock && !subPred(h2[c] || "")) {
        if (h1[c].trim()) inBlock = false;
      }
      if (inBlock && subPred(h2[c] || "")) return c;
    }
    return -1;
  };
  const findSub = (pred: (s: string) => boolean) => h2.findIndex((s) => pred(s || ""));
  return {
    contract: 0,
    status: findSub((s) => s === "состояние"),
    rig: findSub((s) => s === "установка"),
    object: findSub((s) => s === "участок"),
    holeProj: findSub((s) => s.includes("номер агр")),
    projAz: findAfter((s) => s.includes("проект"), (s) => s.includes("азимут")),
    projDip: findAfter((s) => s.includes("проект"), (s) => s.startsWith("угол")),
    projDepth: findAfter((s) => s.includes("проект"), (s) => s.includes("глубина")),
    target: findSub((s) => s.includes("целевое назначение")),
    holeFact: findAfter((s) => s.includes("факт"), (s) => s === "номер"),
    factDepth: findAfter((s) => s.includes("факт"), (s) => s.includes("глубина")),
    factAz: findAfter((s) => s.includes("факт"), (s) => s.includes("азимут")),
    factDip: findAfter((s) => s.includes("факт"), (s) => s.startsWith("угол")),
    dateBegin: findAfter((s) => s.includes("факт"), (s) => s.includes("начата")),
    dateEnd: findAfter((s) => s.includes("факт"), (s) => s.includes("окончена")),
    docM: findAfter((s) => s.includes("документац"), (s) => s.includes("документация")),
    docGap: findAfter((s) => s.includes("документац"), (s) => s.includes("отставание")),
    coreM: findAfter((s) => s.includes("керновые"), (s) => s.includes("п.м")),
    coreSamples: findAfter((s) => s.includes("керновые"), (s) => s.includes("пробы")),
    chipM: findAfter((s) => s.includes("сколковые"), (s) => s.includes("п.м")),
    chipSamples: findAfter((s) => s.includes("сколковые"), (s) => s.includes("пробы")),
    controlSamples: findAfter((s) => s.includes("контрольные"), (s) => s.includes("пробы")),
    blankSamples: findAfter((s) => s.includes("холостые"), (s) => s.includes("пробы")),
    standardSamples: findSub((s) => s.includes("стандарты")),
    unsampledNote: findSub((s) => s.includes("неопробован")),
    waterLevel: findSub((s) => s.includes("уровень воды")),
    documenter: findSub((s) => s.includes("фио документатора")),
  };
}

function parseGeoSummary(grid: Grid, sheet: string, file: string, out: any[], notes: string[]) {
  if (grid.length < 3) { notes.push(`лист «${sheet}»: недостаточно строк для геологической сводки`); return { loaded: 0, skipped: 0 }; }
  const c = findGeoSummaryCols(grid);
  if (c.holeProj < 0) { notes.push(`лист «${sheet}»: не найдена колонка «номер АГР»`); return { loaded: 0, skipped: 0 }; }
  let loaded = 0, skipped = 0, curZone = "";
  for (let r = 2; r < grid.length; r++) {
    const row = grid[r] || [];
    const holeProj = norm(row[c.holeProj]);
    if (!holeProj) { continue; }
    if (isTotalRow(row)) { skipped++; continue; }
    const zone = c.object >= 0 ? norm(row[c.object]) : "";
    if (zone) curZone = zone;
    const holeFact = c.holeFact >= 0 ? norm(row[c.holeFact]) : "";
    out.push({
      contract: norm(row[0]), object: curZone,
      rig: c.rig >= 0 ? norm(row[c.rig]) : "", status: c.status >= 0 ? norm(row[c.status]) : "",
      hole_project: holeProj, hole: holeFact || holeProj,
      proj_depth: num(row[c.projDepth]) ?? 0, proj_azimuth: num(row[c.projAz]) ?? 0, proj_dip: num(row[c.projDip]) ?? 0,
      fact_depth: num(row[c.factDepth]) ?? 0, fact_azimuth: num(row[c.factAz]) ?? 0, fact_dip: num(row[c.factDip]) ?? 0,
      date_begin: c.dateBegin >= 0 ? excelDate(row[c.dateBegin]) : "", date_end: c.dateEnd >= 0 ? excelDate(row[c.dateEnd]) : "",
      doc_m: num(row[c.docM]) ?? 0, doc_gap_m: num(row[c.docGap]) ?? 0,
      core_m: num(row[c.coreM]) ?? 0, core_samples: num(row[c.coreSamples]) ?? 0,
      chip_m: num(row[c.chipM]) ?? 0, chip_samples: num(row[c.chipSamples]) ?? 0,
      control_samples: num(row[c.controlSamples]) ?? 0, blank_samples: num(row[c.blankSamples]) ?? 0,
      standard_samples: num(row[c.standardSamples]) ?? 0,
      unsampled_note: c.unsampledNote >= 0 ? norm(row[c.unsampledNote]) : "",
      water_level: num(row[c.waterLevel]) ?? 0, documenter: c.documenter >= 0 ? norm(row[c.documenter]) : "",
      target: c.target >= 0 ? norm(row[c.target]) : "", zone: curZone,
      source_file: file,
    });
    loaded++;
  }
  return { loaded, skipped };
}

/* ==================== профиль 3. Реестр скважин ==================== */

function parseHoles(grid: Grid, sheet: string, file: string, out: any[], notes: string[]) {
  const header = (grid[0] || []).map((v) => low(v));
  const idx = (name: string) => header.indexOf(name);
  const g = (row: any[], name: string) => { const i = idx(name); return i >= 0 ? row[i] : null; };
  let loaded = 0, skipped = 0, unparsedDates = 0;
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] || [];
    if (!norm(row[0])) { continue; }
    if (isTotalRow(row)) { skipped++; continue; }
    const holeFact = norm(g(row, "hole"));
    const planned = !holeFact || holeFact === "0" ? 1 : 0;
    const db = excelDate(g(row, "date_begin"));
    const de = excelDate(g(row, "data_end") ?? g(row, "date_end"));
    if (!planned && !db && norm(g(row, "date_begin")) && norm(g(row, "date_begin")) !== "0") unparsedDates++;
    out.push({
      hole_pro: norm(g(row, "hole_pro")), td_pro: num(g(row, "td_pro")) ?? 0,
      hole: planned ? "" : holeFact, tdepth: planned ? 0 : num(g(row, "tdepth")) ?? 0,
      azimuth: num(g(row, "azimuth")) ?? 0, dip: num(g(row, "dip")) ?? 0,
      x: num(g(row, "x")) ?? 0, y: num(g(row, "y")) ?? 0, z: num(g(row, "z")) ?? 0,
      site: norm(g(row, "site")), type: norm(g(row, "type")), year: norm(g(row, "year")),
      date_begin: db, date_end: de, geolog: planned ? "" : norm(g(row, "geolog")),
      company: norm(g(row, "company")),
      status: planned ? "в проекте" : (norm(g(row, "status")) || "в работе"),
      contract: norm(g(row, "n_contract")), planned, source_file: file,
    });
    loaded++;
  }
  if (unparsedDates) notes.push(`реестр скважин: ${unparsedDates} дат в нестандартном виде (например «20.04.20.26») — сохранены пустыми`);
  return { loaded, skipped };
}

/* ==================== профиль 4. Литология ==================== */

function parseLitho(grid: Grid, sheet: string, file: string, out: any[], notes: string[]) {
  const header = (grid[0] || []).map((v) => low(v));
  const find = (frag: string) => header.findIndex((h) => h.includes(frag));
  const cHole = 0, cFrom = find("от"), cTo = find("до"), cTh = find("мощность"), cCode = find("code");
  const cS = header.findIndex((h) => h.includes("сульфидные")), cQS = header.findIndex((h) => h.includes("кварц-сульфид")),
    cQ = header.findIndex((h) => h.includes("кварцевые")), cD = find("описание");
  const kind = low(grid[0]?.[0]).includes("канав") ? "канава" : "скважина";
  let loaded = 0, skipped = 0, curHole = "";
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const hole = norm(row[cHole]);
    if (hole) curHole = hole;
    const from = num(row[cFrom]), to = num(row[cTo]);
    if (from === null && to === null) { continue; }
    if (isTotalRow(row)) { skipped++; continue; }
    const descr = cD >= 0 ? norm(row[cD]) : "";
    const vs = num(row[cS]) ?? 0, vqs = num(row[cQS]) ?? 0, vq = num(row[cQ]) ?? 0;
    const ore = /потенциально рудн|рудная зона|рудный интервал/.test(descr.toLowerCase()) || vs > 0 || vqs > 0 ? 1 : 0;
    out.push({
      hole: curHole, from_m: from ?? 0, to_m: to ?? 0,
      thickness: num(row[cTh]) ?? ((to ?? 0) - (from ?? 0)), code: norm(row[cCode]),
      v_sulf: vs, v_qz_sulf: vqs, v_qz: vq, descr, ore, kind, source_file: file,
    });
    loaded++;
  }
  return { loaded, skipped };
}

/* ==================== профиль 5. Пробоподготовка ЦПП ==================== */

function parsePrep(grid: Grid, sheet: string, file: string, out: any[], queueOut: any[], notes: string[]) {
  let queue = 0, days = 0;
  for (let r = 0; r < Math.min(grid.length, 8); r++) {
    const t = rowText(grid[r] || []).toLowerCase();
    const nums = (grid[r] || []).map((v) => num(v)).filter((v) => v !== null) as number[];
    if (t.includes("кол-во проб в цпп") && nums.length) queue = nums[nums.length - 1];
    if (t.includes("планируемое кол-во дней") && nums.length) days = nums[nums.length - 1];
  }
  if (queue || days) queueOut.push({ sheet, queue: Math.round(queue), days: +days.toFixed(2), source_file: file });

  let headerRow = -1;
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    if (low(grid[r]?.[0]) === "дата" && low(grid[r]?.[1]) === "смена") { headerRow = r; break; }
  }
  if (headerRow < 0) { notes.push(`лист «${sheet}»: не найдена шапка «дата | Смена»`); return { loaded: 0, skipped: 0 }; }
  const sub = grid[headerRow + 1] || [];
  const find = (frag: string) => sub.findIndex((h) => low(h).includes(frag));
  const cCrush = find("дробление"), cMill = find("истирание"), cType = find("тип проб"),
    cHoles = find("скв"), cShip = find("отправлено"), cRecv = find("поступление"), cXrf = find("рфа");
  const cNote = (grid[headerRow] || []).findIndex((h) => low(h).includes("примечан"));
  let loaded = 0, skipped = 0, curDate = "";
  for (let r = headerRow + 2; r < grid.length; r++) {
    const row = grid[r] || [];
    if (isTotalRow(row)) { skipped++; continue; }
    const d = excelDate(row[0]);
    if (d) curDate = d;
    const shift = norm(row[1]);
    const crushed = num(row[cCrush]) ?? 0, milled = num(row[cMill]) ?? 0;
    const shipped = num(row[cShip]) ?? 0, recv = num(row[cRecv]) ?? 0, xrf = num(row[cXrf]) ?? 0;
    const note = cNote >= 0 ? norm(row[cNote]) : "";
    if (!crushed && !milled && !shipped && !recv && !xrf && !note) { continue; }
    const types = splitSlash(row[cType]);
    const holes = norm(row[cHoles]).split(/\s*,\s*/).filter(Boolean).join(", ");
    const parts = types.length > 1 ? types : [types[0] ?? ""];
    for (const t of parts) {
      out.push({
        date: curDate, sheet, shift, crushed: +(crushed / parts.length).toFixed(2),
        milled: +(milled / parts.length).toFixed(2), sample_type: t, holes,
        shipped: +(shipped / parts.length).toFixed(2), received: +(recv / parts.length).toFixed(2),
        xrf: +(xrf / parts.length).toFixed(2), note, source_file: file,
      });
      loaded++;
    }
  }
  return { loaded, skipped };
}

/* ==================== профиль 6. Горные работы ==================== */

function parseTrenchPlan(grid: Grid, sheet: string, file: string, out: any[], notes: string[]) {
  const h1 = (grid[0] || []).map((v) => low(v));
  const h2 = (grid[1] || []).map((v) => low(v));
  const h3 = (grid[2] || []).map((v) => low(v));
  const cAgr = h2.findIndex((h) => h.includes("номер агр"));
  if (cAgr < 0) { notes.push(`лист «${sheet}»: не найдена колонка «номер АГР»`); return { loaded: 0, skipped: 0 }; }
  const cSite = h2.findIndex((h) => h.includes("участок"));
  const cLen = h2.findIndex((h) => h.includes("длина"));
  const cState = h2.findIndex((h) => h.includes("состояние"));
  const groupCols = (group: string) => {
    const start = h2.findIndex((h) => h.includes(group));
    if (start < 0) return null;
    let end = start;
    while (end + 1 < h2.length && (!h2[end + 1] || h2[end + 1] === h2[start])) end++;
    return { start, end };
  };
  const clean = groupCols("ручная зачистка"), doc = groupCols("геологическая документация");
  const pairOf = (label: string) => {
    const i = h2.findIndex((h) => h.includes(label));
    if (i < 0) return null;
    const cnt = h3.findIndex((h, j) => j >= i && h.includes("кол-во"));
    const m = h3.findIndex((h, j) => j >= i && h.includes("пог"));
    return { cnt, m };
  };
  const groove = pairOf("бороздовые"), chip = pairOf("сколковые"),
    c1 = pairOf("контроль1"), c2 = pairOf("контроль2");
  const cBlank = h2.findIndex((h) => h.includes("холостые")), cStd = h2.findIndex((h) => h.includes("стандарт"));
  const cNote = h1.findIndex((h) => h.includes("примечан"));
  let loaded = 0, skipped = 0;
  for (let r = 3; r < grid.length; r++) {
    const row = grid[r] || [];
    const agr = norm(row[cAgr]);
    if (!agr) continue;
    if (isTotalRow(row)) { skipped++; continue; }
    const pct = (v: any) => { const n0 = num(v); return n0 === null ? 0 : (n0 <= 1.0001 ? +(n0 * 100).toFixed(1) : +n0.toFixed(1)); };
    out.push({
      contract: norm(row[0]), site: cSite >= 0 ? norm(row[cSite]) : "", agr,
      plan_len: num(row[cLen]) ?? 0, state: cState >= 0 ? norm(row[cState]) : "",
      clean_m: clean ? num(row[clean.start]) ?? 0 : 0, clean_pct: clean ? pct(row[clean.start + 1]) : 0,
      doc_m: doc ? num(row[doc.start]) ?? 0 : 0, doc_pct: doc ? pct(row[doc.start + 1]) : 0,
      groove_n: groove ? num(row[groove.cnt]) ?? 0 : 0, groove_m: groove ? num(row[groove.m]) ?? 0 : 0,
      chip_n: chip ? num(row[chip.cnt]) ?? 0 : 0, chip_m: chip ? num(row[chip.m]) ?? 0 : 0,
      ctl1_n: c1 ? num(row[c1.cnt]) ?? 0 : 0, ctl2_n: c2 ? num(row[c2.cnt]) ?? 0 : 0,
      blank_n: cBlank >= 0 ? num(row[cBlank]) ?? 0 : 0, std_n: cStd >= 0 ? num(row[cStd]) ?? 0 : 0,
      note: cNote >= 0 ? norm(row[cNote]) : "", source_file: file,
    });
    loaded++;
  }
  return { loaded, skipped };
}

function parseTrenchDaily(grid: Grid, sheet: string, file: string, out: any[], notes: string[]) {
  const h1 = (grid[0] || []).map((v) => low(v));
  const h2 = (grid[1] || []).map((v) => low(v));
  const starts: number[] = [];
  h1.forEach((v, i) => { if (v.includes("№ канавы")) starts.push(i); });
  if (!starts.length) return { loaded: 0, skipped: 0 };
  const cNote = h1.findIndex((h) => h.includes("примечан"));
  const cExec = h1.findIndex((h) => h.includes("исполнитель"));
  const blocks = starts.map((start, bi) => {
    const end = bi + 1 < starts.length ? starts[bi + 1] - 1 : h1.length - 1;
    let kind = "зачистка";
    for (let c = start; c <= end; c++) {
      const h = h1[c] || "";
      if (h.includes("документ") || h.includes("докуменатция")) { kind = "документация"; break; }
      if (h.includes("опробование")) { kind = "опробование"; break; }
    }
    const find = (frag: string) => { for (let c = start; c <= end; c++) if ((h2[c] || "").startsWith(frag)) return c; return -1; };
    return { start, kind, from: find("от"), to: find("до"), len: find("длина") };
  });
  let loaded = 0, skipped = 0, curDate = "";
  for (let r = 2; r < grid.length; r++) {
    const row = grid[r] || [];
    if (isTotalRow(row)) { skipped++; continue; }
    const d = excelDate(row[0]);
    if (d) curDate = d;
    const note = cNote >= 0 ? norm(row[cNote]) : "";
    const exec = cExec >= 0 ? norm(row[cExec]) : "";
    for (const b of blocks) {
      const agrRaw = norm(row[b.start]);
      if (!agrRaw) continue;
      const agrs = splitSlash(agrRaw);
      const froms = splitSlash(row[b.from]), tos = splitSlash(row[b.to]);
      const lenTotal = num(row[b.len]) ?? 0;
      const n = Math.max(agrs.length, froms.length, tos.length, 1);
      for (let i = 0; i < n; i++) {
        const from = num(froms[i] ?? froms[0]) ?? 0, to = num(tos[i] ?? tos[0]) ?? 0;
        let len = to > from ? +(to - from).toFixed(2) : 0;
        if (n === 1) len = lenTotal || len;
        out.push({
          date: curDate, sheet, kind: b.kind, agr: agrs[i] ?? agrs[0], from_m: from, to_m: to,
          length_m: len, executor: exec, note, source_file: file,
        });
        loaded++;
      }
    }
  }
  return { loaded, skipped };
}

function parseMoves(grid: Grid, sheet: string, file: string, kind: string, out: any[], notes: string[]) {
  const h2 = (grid[1] || []).map((v) => low(v));
  const h1 = (grid[0] || []).map((v) => low(v));
  const f2 = (frag: string) => h2.findIndex((h) => h.includes(frag));
  const f1 = (frag: string) => h1.findIndex((h) => h.includes(frag));
  const cCore = f2("керновые"), cGroove = f2("бороздовые"), cChip = f2("сколковые"),
    cC1 = f2("контроль1") >= 0 ? f2("контроль1") : f2("контрольные"), cC2 = f2("контроль2"),
    cBlank = f2("холост"), cStd = f2("стандарт");
  const cTotal = f1("всего проб"), cW = f1("вес"), cBags = f1("мкр"),
    cDate = f1("дата отправки"), cStatus = f1("статус"), cNote = f1("примечан");
  let loaded = 0, skipped = 0;
  for (let r = 2; r < grid.length; r++) {
    const row = grid[r] || [];
    const code = norm(row[0]);
    if (!code) continue;
    if (isTotalRow(row)) { skipped++; continue; }
    const gv = (c: number) => (c >= 0 ? num(row[c]) ?? 0 : 0);
    out.push({
      kind, code, core_n: gv(cCore), groove_n: gv(cGroove), chip_n: gv(cChip),
      ctl1_n: gv(cC1), ctl2_n: gv(cC2), blank_n: gv(cBlank), std_n: gv(cStd),
      total_n: gv(cTotal), weight_kg: gv(cW), bags: gv(cBags),
      ship_date: cDate >= 0 ? excelDate(row[cDate]) : "", ship_status: cStatus >= 0 ? norm(row[cStatus]) : "",
      note: cNote >= 0 ? norm(row[cNote]) : "", source_file: file,
    });
    loaded++;
  }
  return { loaded, skipped };
}

/* ==================== профиль 7. Календарный план ==================== */

export function workKindOf(name: string): string {
  const s = low(name);
  if (/бурение скважин|колонковое бурение|бурение hq|бурение pq/.test(s)) return "бурение";
  if (/описание керна|документация керна|геологическое описание/.test(s)) return "описание";
  if (/распиловка/.test(s)) return "распиловка";
  if (/отбор.*керновых проб|отбор проб|опробование керна/.test(s)) return "опробование";
  if (/дробление|истирание/.test(s)) return "дробление";
  if (/рфа/.test(s)) return "РФА";
  if (/пробирный анализ/.test(s)) return "пробирный анализ";
  if (/документирование полотна канав/.test(s)) return "документация канав";
  if (/отбор бороздовых проб/.test(s)) return "бороздовое опробование";
  if (/добивка канав|ручная.*канав/.test(s)) return "зачистка канав";
  return "";
}

function parsePlan(grid: Grid, sheet: string, file: string, contract: string, object: string,
  lines: any[], periods: any[], notes: string[]) {
  let headerRow = -1;
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    if ((grid[r] || []).some((v) => low(v).includes("наименования работ"))) { headerRow = r; break; }
  }
  if (headerRow < 0) { notes.push(`лист «${sheet}»: не найдена шапка «Наименования работ»`); return { loaded: 0, skipped: 0 }; }
  const header = grid[headerRow] || [];
  let subRow = headerRow + 1;
  for (let r = headerRow + 1; r < Math.min(headerRow + 4, grid.length); r++) {
    if ((grid[r] || []).some((v) => low(v).includes("объем работ"))) { subRow = r; break; }
  }
  const sub = grid[subRow] || [];
  const cName = header.findIndex((v) => low(v).includes("наименования работ"));
  const cUnit = header.findIndex((v) => low(v).includes("ед.изм"));
  const rateCols = header.map((v, i) => (low(v).includes("стоимость единицы") ? i : -1)).filter((i) => i >= 0);
  const qtyCols = sub.map((v, i) => (low(v).includes("объем работ") ? i : -1)).filter((i) => i >= 0);
  if (!qtyCols.length) { notes.push(`лист «${sheet}»: не найдены колонки «Объем работ»`); return { loaded: 0, skipped: 0 }; }
  const periodLabel = (c: number) => {
    for (let r = Math.max(0, headerRow - 1); r <= headerRow; r++) {
      for (let cc = c; cc >= Math.max(0, c - 2); cc--) {
        const v = grid[r]?.[cc];
        if (v === null || v === undefined || v === "") continue;
        const d = excelDate(v);
        if (d) return d.slice(0, 7);
        const s = norm(v);
        const y = s.match(/(20\d{2})/);
        if (y && /стоимость единицы/i.test(s)) return y[1];
        if (/всего/i.test(s)) continue;
        if (y) return y[1];
      }
    }
    return `колонка ${c + 1}`;
  };
  const rateFor = (c: number) => {
    let best = -1;
    for (const rc of rateCols) if (rc < c && rc > best) best = rc;
    return best >= 0 ? best : (rateCols[0] ?? -1);
  };
  let loaded = 0, skipped = 0;
  let section = "";
  for (let r = subRow + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const name = norm(row[cName]);
    if (!name) continue;
    const lowName = name.toLowerCase();
    if (/заказчик|подрядчик|генеральный директор|_____/.test(lowName)) { skipped++; continue; }
    const no = norm(row[0]);
    const unit = cUnit >= 0 ? norm(row[cUnit]) : "";
    const totalQty = num(row[qtyCols[0]]) ?? 0;
    const totalCost = num(row[qtyCols[0] + 1]) ?? 0;
    const rc = rateFor(qtyCols[1] ?? qtyCols[0]);
    const rate = rc >= 0 ? num(row[rc]) ?? 0 : 0;
    const isGroup = (!unit && !rate) || /^\d+\.?$/.test(no) && !unit;
    if (isGroup) section = name;
    const line = {
      contract, object, no, section: isGroup ? name : section, name, unit, rate,
      total_qty: totalQty, total_cost: totalCost, is_group: isGroup ? 1 : 0,
      work_kind: workKindOf(name), sheet, source_file: file,
      _periods: [] as any[],
    };
    for (let i = 1; i < qtyCols.length; i++) {
      const c = qtyCols[i];
      const q = num(row[c]) ?? 0, cost = num(row[c + 1]) ?? 0;
      if (!q && !cost) continue;
      line._periods.push({ period: periodLabel(c), qty: q, cost });
    }
    lines.push(line);
    loaded++;
  }
  return { loaded, skipped };
}

/* ==================== профиль 8. Карта-предложение ==================== */

function parseCostCalc(grid: Grid, sheet: string, file: string, out: any[], notes: string[]) {
  let loaded = 0, skipped = 0;
  const isTariff = gridText(grid, 8).includes("статья затрат");
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    const texts = row.map((v) => norm(v));
    if (!texts.some(Boolean)) continue;
    const t = texts.join(" ").toLowerCase();
    if (/участник добавляет|расчет |расчёт |ед. изм|наименование|№ п\/п|итого стоимость работ/.test(t) && !isTariff) {
      // строки-заголовки внутри листа
      if (!row.some((v) => typeof v === "number" && Math.abs(v) > 1000)) { skipped++; continue; }
    }
    const nums = row.map((v, i) => ({ i, n: num(v) })).filter((x) => x.n !== null && Math.abs(x.n as number) > 0);
    if (!nums.length) { skipped++; continue; }
    const nameCell = texts.find((s, i) => s && num(row[i]) === null && s.length > 2 && !/^\d+$/.test(s));
    if (!nameCell) { skipped++; continue; }
    const vals = nums.map((x) => x.n as number);
    if (isTariff && vals.length === 1 && Number.isInteger(vals[0]) && vals[0] < 100) { skipped++; continue; }
    const perMeter = isTariff && vals.length >= 2 ? vals[vals.length - 1] : 0;
    const sum = isTariff && vals.length >= 2 ? vals[vals.length - 2]
      : vals.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), vals[0]);
    out.push({
      sheet, category: sheet, name: nameCell,
      unit: texts.find((s, i) => /руб|шт|п\.м|мес|кг|комплекс/.test(s.toLowerCase()) && i > 0) ?? "",
      qty: nums.length > 2 ? (nums[0].n as number) : 0,
      price: nums.length > 3 ? (nums[nums.length - 3].n as number) : 0,
      amount: sum, per_meter: perMeter, source_file: file,
    });
    loaded++;
  }
  return { loaded, skipped };
}

/* ==================== главный разбор книги ==================== */

const OBJECT_BY_FILE: Array<[RegExp, { object: string; contract: string }]> = [
  [/veduga/i, { object: "Ведуга", contract: "190" }],
  [/lineinyi/i, { object: "Линейный", contract: "192 ПБК" }],
  [/uch-k-ergozhu/i, { object: "Ергожу", contract: "39-2026К" }],
  [/1svodka_geologi_ergozhu/i, { object: "Ергожу", contract: "187ПБК-2026" }],
  [/gornye-raboty/i, { object: "Ергожу", contract: "187ПБК-2026" }],
  [/kalendarnyi-plan/i, { object: "Карахем", contract: "189П" }],
  [/ergozhu-v3/i, { object: "Ергожу", contract: "187ПБК-2026" }],
  [/karta-predlozheniia/i, { object: "Ведуга", contract: "190" }],
  [/probopodgotovka/i, { object: "ЦПП", contract: "" }],
];

export function fileContext(file: string) {
  for (const [re, ctx] of OBJECT_BY_FILE) if (re.test(file)) return ctx;
  return { object: "", contract: "" };
}

export function parseWorkbook(buf: Buffer, fileName: string): ParseResult {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const ctx = fileContext(fileName);
  const entities: Record<string, any[]> = {
    pbk_shifts: [], pbk_geo: [], pbk_geo_summary: [], pbk_holes: [], pbk_litho: [], pbk_prep: [], pbk_prep_queue: [],
    pbk_trenches: [], pbk_trench_daily: [], pbk_moves: [], pbk_plan_lines: [], pbk_cost_calc: [],
  };
  const sheets: SheetOutcome[] = [];
  const notes: string[] = [];
  let loaded = 0, skipped = 0;

  for (const sn of wb.SheetNames) {
    const grid = sheetGrid(wb.Sheets[sn]);
    const nonEmpty = grid.filter((r) => r && r.some((v) => norm(v))).length;
    if (nonEmpty < 2) {
      sheets.push({ sheet: sn, profile: "", profileName: "пропущен", loaded: 0, skipped: 0, notes: ["лист пустой"] });
      continue;
    }
    const code = detectSheetProfile(grid, sn);
    if (!code) {
      sheets.push({ sheet: sn, profile: "", profileName: "не распознан", loaded: 0, skipped: nonEmpty, notes: ["структура листа не соответствует ни одному профилю ПБК"] });
      skipped += nonEmpty;
      continue;
    }
    const sNotes: string[] = [];
    let res = { loaded: 0, skipped: 0 };
    try {
      if (code === "drill") res = parseDrill(grid, sn, fileName, entities.pbk_shifts, sNotes);
      else if (code === "geodoc") res = parseGeoDoc(grid, sn, fileName, ctx.object, entities.pbk_geo, sNotes);
      else if (code === "geosummary") res = parseGeoSummary(grid, sn, fileName, entities.pbk_geo_summary, sNotes);
      else if (code === "holes") res = parseHoles(grid, sn, fileName, entities.pbk_holes, sNotes);
      else if (code === "litho") res = parseLitho(grid, sn, fileName, entities.pbk_litho, sNotes);
      else if (code === "prep") res = parsePrep(grid, sn, fileName, entities.pbk_prep, entities.pbk_prep_queue, sNotes);
      else if (code === "mining") {
        const head = gridText(grid, 4);
        if (head.includes("номер агр")) res = parseTrenchPlan(grid, sn, fileName, entities.pbk_trenches, sNotes);
        else if (head.includes("всего проб")) res = parseMoves(grid, sn, fileName, head.includes("канав") ? "канава" : "скважина", entities.pbk_moves, sNotes);
        else res = parseTrenchDaily(grid, sn, fileName, entities.pbk_trench_daily, sNotes);
      } else if (code === "plan") {
        res = parsePlan(grid, sn, fileName, ctx.contract, ctx.object, entities.pbk_plan_lines, [], sNotes);
      } else if (code === "costcalc") res = parseCostCalc(grid, sn, fileName, entities.pbk_cost_calc, sNotes);
    } catch (e: any) {
      sNotes.push(`ошибка разбора: ${e?.message ?? e}`);
    }
    sheets.push({ sheet: sn, profile: code, profileName: PROFILE_NAME[code], loaded: res.loaded, skipped: res.skipped, notes: sNotes });
    loaded += res.loaded; skipped += res.skipped;
    notes.push(...sNotes);
  }

  // движение проб в геологической книге (шапка «ВСЕГО ПРОБ» без «номер АГР»)
  for (const s of sheets) {
    if (s.profile === "" && /движение проб/i.test(s.sheet)) s.notes.push("движение проб по скважинам");
  }

  return {
    file: fileName,
    profiles: Array.from(new Set(sheets.map((s) => s.profile).filter(Boolean))),
    entities, sheets, loaded, skipped, notes,
  };
}
