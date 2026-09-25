/**
 * Суточная производственная сводка ООО ПБК.
 *
 * Считается напрямую по разобранным сводкам участков (pbk_shifts, pbk_prep):
 * по каждому участку — сутки, с начала месяца, с начала года, план месяца
 * из справочника, сколько осталось до плана и отставание на дату; по каждому
 * бурильщику — проходка за смену (сутки), за месяц и за год.
 * Отдельный блок — пробоподготовка: дробление за сутки, месяц и год.
 *
 * Каждая новая редакция сводки сохраняется в архив (daily_snapshots).
 * Планировщик рассылает сводку в MAX в заданное окно (по умолчанию 8–9 утра)
 * и каждый час сообщает, если данные за сутки изменились.
 */
import crypto from "node:crypto";
import ExcelJS from "exceljs";
import { pdb } from "./pbkdb";
import { storage } from "./storage";
import { findObjectByName } from "./pbkload";

pdb.exec(`
CREATE TABLE IF NOT EXISTS daily_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  text TEXT NOT NULL DEFAULT '',
  sent INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS daily_snapshots_date ON daily_snapshots(report_date);
`);

/* ---------------------------- настройки ---------------------------- */

export type DailySettings = {
  /** рассылка сводки в MAX включена */
  enabled: boolean;
  /** часовой пояс, по которому считаются «сутки» и окно рассылки */
  tz: string;
  /** окно утренней рассылки: с какого часа и до какого */
  sendFrom: number;
  sendTo: number;
  /** сообщать ли об изменениях после утренней рассылки */
  notifyChanges: boolean;
  /** кому отправлять: chatId MAX через запятую */
  chatIds: string;
  /** служебное: когда отправляли и какую редакцию */
  lastSentDate: string;
  lastSentHash: string;
  lastHourKey: string;
};

const DEFAULT_DAILY: DailySettings = {
  enabled: false,
  tz: "Asia/Krasnoyarsk",
  sendFrom: 8,
  sendTo: 9,
  notifyChanges: true,
  chatIds: "",
  lastSentDate: "",
  lastSentHash: "",
  lastHourKey: "",
};

export function dailySettings(): DailySettings {
  try {
    return { ...DEFAULT_DAILY, ...JSON.parse(storage.getSetting("daily") || "{}") };
  } catch {
    return { ...DEFAULT_DAILY };
  }
}

export function saveDailySettings(patch: Partial<DailySettings>): DailySettings {
  const next = { ...dailySettings(), ...patch };
  next.sendFrom = Math.max(0, Math.min(23, Number(next.sendFrom) || 0));
  next.sendTo = Math.max(next.sendFrom + 1, Math.min(24, Number(next.sendTo) || next.sendFrom + 1));
  storage.setSetting("daily", JSON.stringify(next));
  return next;
}

/* ---------------------------- время ---------------------------- */

/** Дата и час «сейчас» в часовом поясе компании */
export function localNow(tz = dailySettings().tz): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) || 0 };
}

function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Отчётные сутки по умолчанию — вчера: утром отчитываются за прошедший день */
export function defaultReportDate() {
  return addDays(localNow().date, -1);
}

const ru = (iso: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "");
const r1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => r1(n).toLocaleString("ru-RU");

/* ---------------------------- расчёт ---------------------------- */

export type WorkerRow = {
  name: string; rig: string;
  day: number; month: number; year: number;
  /** комментарий к смене без проходки */
  comment: string;
  /** работал ли в отчётные сутки (есть строка смены на эту дату) */
  onDay: boolean;
};

export type ObjectRow = {
  object: string;
  refName: string;
  planMonth: number;
  planDay: number;
  planToDate: number;
  day: number; month: number; year: number;
  remaining: number;
  lag: number;
  pct: number;
  reported: boolean;
  lastDate: string;
  /** из какого файла последние данные — чтобы видеть, если сводка не обновилась */
  lastFile: string;
  workers: WorkerRow[];
};

export type DailySummary = {
  date: string;
  generatedAt: string;
  objects: ObjectRow[];
  totals: { day: number; month: number; year: number; planMonth: number; planToDate: number; lag: number; remaining: number };
  prep: { day: number; month: number; year: number; milledDay: number; milledMonth: number; milledYear: number; lastDate: string; reported: boolean };
  missing: string[];
};

const all = (sql: string, ...args: any[]) => pdb.prepare(sql).all(...args) as any[];
const one = (sql: string, ...args: any[]) => pdb.prepare(sql).get(...args) as any;

export function dailySummary(date = defaultReportDate()): DailySummary {
  const monthStart = date.slice(0, 7) + "-01";
  const yearStart = date.slice(0, 4) + "-01-01";
  const [y, m, d] = date.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const refObjects = storage.objects() as any[];
  const pbkObjects = all(`SELECT DISTINCT object FROM pbk_shifts WHERE object<>'' ORDER BY object`).map((r) => r.object);

  const objects: ObjectRow[] = [];
  const usedRef = new Set<number>();

  for (const object of pbkObjects) {
    const sum = (from: string) =>
      Number(one(`SELECT COALESCE(SUM(meters),0) s FROM pbk_shifts WHERE object=? AND date>=? AND date<=?`, object, from, date).s) || 0;
    const day = sum(date);
    const month = sum(monthStart);
    const year = sum(yearStart);

    // «сводка за сутки заполнена»: есть метры или объяснение смены
    const reported = !!one(
      `SELECT 1 x FROM pbk_shifts WHERE object=? AND date=? AND (meters>0 OR TRIM(comment)<>'') LIMIT 1`, object, date,
    );
    const lastDate = String(one(
      `SELECT MAX(date) d FROM pbk_shifts WHERE object=? AND date<=? AND (meters>0 OR TRIM(comment)<>'')`, object, date,
    )?.d ?? "");
    const lastFile = String(one(
      `SELECT source_file f FROM pbk_shifts WHERE object=? AND (meters>0 OR TRIM(comment)<>'') ORDER BY date DESC LIMIT 1`, object,
    )?.f ?? "");

    const ref = findObjectByName(refObjects, object);
    if (ref) usedRef.add(ref.id);
    const planMonth = Number(ref?.planMetersMonth) || 0;
    const planDay = planMonth / daysInMonth;
    const planToDate = planDay * d;

    const workerRows = all(
      `SELECT shift_master name,
              SUM(CASE WHEN date=? THEN meters ELSE 0 END) day,
              SUM(CASE WHEN date>=? THEN meters ELSE 0 END) month,
              SUM(meters) year,
              MAX(CASE WHEN date=? AND meters=0 THEN TRIM(comment) ELSE '' END) comment,
              MAX(CASE WHEN date=? AND (meters>0 OR TRIM(comment)<>'') THEN 1 ELSE 0 END) onDay
         FROM pbk_shifts
        WHERE object=? AND date>=? AND date<=? AND shift_master<>''
        GROUP BY shift_master`,
      date, monthStart, date, date, object, yearStart, date,
    );
    const workers: WorkerRow[] = workerRows
      .filter((w) => w.month > 0 || w.day > 0 || w.comment)
      .map((w) => {
        const rig = String(one(
          `SELECT rig FROM pbk_shifts WHERE object=? AND shift_master=? AND date<=? AND rig<>'' ORDER BY date DESC LIMIT 1`,
          object, w.name, date,
        )?.rig ?? "");
        return { name: w.name, rig, day: r1(w.day), month: r1(w.month), year: r1(w.year), comment: w.comment || "", onDay: !!w.onDay };
      })
      .sort((a, b) => b.day - a.day || b.month - a.month);

    objects.push({
      object, refName: ref?.name ?? "",
      planMonth, planDay: r1(planDay), planToDate: r1(planToDate),
      day: r1(day), month: r1(month), year: r1(year),
      remaining: r1(planMonth - month),
      lag: r1(planToDate - month),
      pct: planMonth ? Math.round((month / planMonth) * 100) : 0,
      reported, lastDate, lastFile, workers,
    });
  }

  // участки со справочным планом, по которым сводки нет вовсе
  const missing: string[] = [];
  for (const o of refObjects) {
    if (usedRef.has(o.id) || !(Number(o.planMetersMonth) > 0)) continue;
    missing.push(o.name);
    const planMonth = Number(o.planMetersMonth);
    objects.push({
      object: o.name, refName: o.name, planMonth,
      planDay: r1(planMonth / daysInMonth), planToDate: r1((planMonth / daysInMonth) * d),
      day: 0, month: 0, year: 0, remaining: planMonth, lag: r1((planMonth / daysInMonth) * d), pct: 0,
      reported: false, lastDate: "", lastFile: "", workers: [],
    });
  }
  for (const o of objects) if (!o.reported && !missing.includes(o.object)) missing.push(o.object);

  const t = (k: keyof ObjectRow) => r1(objects.reduce((a, o) => a + (Number(o[k]) || 0), 0));

  const prepSum = (col: string, from: string) =>
    Number(one(`SELECT COALESCE(SUM(${col}),0) s FROM pbk_prep WHERE date>=? AND date<=?`, from, date).s) || 0;
  const prepLast = String(one(`SELECT MAX(date) d FROM pbk_prep WHERE date<=? AND (crushed>0 OR milled>0)`, date)?.d ?? "");
  const prepHas = Number(one(`SELECT COUNT(*) c FROM pbk_prep`).c) > 0;

  return {
    date,
    generatedAt: new Date().toISOString(),
    objects,
    totals: {
      day: t("day"), month: t("month"), year: t("year"),
      planMonth: t("planMonth"), planToDate: t("planToDate"), lag: t("lag"), remaining: t("remaining"),
    },
    prep: {
      day: prepSum("crushed", date), month: prepSum("crushed", monthStart), year: prepSum("crushed", yearStart),
      milledDay: prepSum("milled", date), milledMonth: prepSum("milled", monthStart), milledYear: prepSum("milled", yearStart),
      lastDate: prepLast, reported: prepHas && prepLast === date,
    },
    missing,
  };
}

/** Отпечаток содержимого: меняется только при изменении цифр, а не времени расчёта */
export function summaryHash(s: DailySummary) {
  const { generatedAt: _g, ...rest } = s;
  return crypto.createHash("sha256").update(JSON.stringify(rest)).digest("hex").slice(0, 16);
}

/* ---------------------------- тексты ---------------------------- */

export function summaryText(s: DailySummary): string {
  const out: string[] = [`Сводка ООО ПБК за ${ru(s.date)}`, ""];
  out.push("БУРЕНИЕ");
  for (const o of s.objects) {
    out.push("");
    out.push(`${o.object}${o.planMonth ? ` (план ${fmt(o.planMonth)} м/мес)` : " (план не задан)"}`);
    if (!o.reported && !o.lastDate && !o.year) {
      out.push("Сводка не поступает");
      continue;
    }
    if (!o.reported) {
      out.push(o.lastDate ? `Сводка за сутки не заполнена. Последние данные: ${ru(o.lastDate)}` : "Сводки нет");
    }
    out.push(`Сутки: ${fmt(o.day)} м · месяц: ${fmt(o.month)} м · год: ${fmt(o.year)} м`);
    if (o.planMonth) {
      const lagText = o.lag > 0 ? `отставание ${fmt(o.lag)} м` : `опережение ${fmt(-o.lag)} м`;
      const remText = o.remaining > 0 ? `до плана ${fmt(o.remaining)} м` : `план выполнен, сверх ${fmt(-o.remaining)} м`;
      out.push(`Выполнено ${o.pct}% · ${remText} · ${lagText}`);
    }
    // по людям — только кто сколько отбурил за смену; их итоги за месяц
    // и год — отдельной командой «люди», чтобы не перегружать сводку
    const onDay = o.workers.filter((x) => x.onDay);
    if (onDay.length) {
      out.push(`За смену: ${onDay.map((w) => `${w.name} ${fmt(w.day)} м${w.day === 0 && w.comment ? ` (${w.comment.slice(0, 40)})` : ""}`).join(", ")}`);
    }
  }
  out.push("");
  out.push(`Итого бурение: сутки ${fmt(s.totals.day)} м · месяц ${fmt(s.totals.month)} м · год ${fmt(s.totals.year)} м`);
  if (s.totals.planMonth) {
    out.push(`План месяца ${fmt(s.totals.planMonth)} м · ${s.totals.lag > 0 ? `отставание ${fmt(s.totals.lag)}` : `опережение ${fmt(-s.totals.lag)}`} м`);
  }
  out.push("");
  out.push("ПРОБОПОДГОТОВКА (дробление, проб)");
  if (!s.prep.reported) out.push(s.prep.lastDate ? `Сводка за сутки не заполнена. Последние данные: ${ru(s.prep.lastDate)}` : "Сводки нет");
  out.push(`Сутки: ${fmt(s.prep.day)} · месяц: ${fmt(s.prep.month)} · год: ${fmt(s.prep.year)}`);
  out.push(`Истирание: сутки ${fmt(s.prep.milledDay)} · месяц ${fmt(s.prep.milledMonth)} · год ${fmt(s.prep.milledYear)}`);
  if (s.missing.length) {
    out.push("", `Нет сводки за сутки: ${s.missing.join(", ")}`);
  }
  out.push("", "Итоги по людям за месяц и год — напишите боту «люди».");
  return out.join("\n");
}

/** Статистика по бурильщикам: смена, месяц, год — отдельным сообщением */
export function workersText(s: DailySummary): string {
  const out: string[] = [`Бурильщики: итоги на ${ru(s.date)}`];
  for (const o of s.objects) {
    if (!o.workers.length) continue;
    out.push("", `${o.object}`);
    const list = [...o.workers].sort((a, b) => b.month - a.month);
    for (const w of list) {
      out.push(`• ${w.name}${w.rig ? ` (${w.rig})` : ""}: смена ${w.onDay ? `${fmt(w.day)} м` : "—"} · месяц ${fmt(w.month)} м · год ${fmt(w.year)} м`);
    }
  }
  if (out.length === 1) out.push("", "Данных по бурильщикам нет.");
  return out.join("\n");
}

/** Что изменилось между двумя редакциями сводки за одни сутки */
export function changesText(prev: DailySummary, next: DailySummary): string {
  const lines: string[] = [];
  const pm = new Map(prev.objects.map((o) => [o.object, o]));
  for (const o of next.objects) {
    const p = pm.get(o.object);
    if (!p) { lines.push(`• ${o.object}: появилась сводка, сутки ${fmt(o.day)} м`); continue; }
    if (p.day !== o.day || p.month !== o.month) {
      lines.push(`• ${o.object}: сутки ${fmt(p.day)} → ${fmt(o.day)} м, месяц ${fmt(p.month)} → ${fmt(o.month)} м`);
    }
    const pw = new Map(p.workers.map((w) => [w.name, w]));
    for (const w of o.workers) {
      const old = pw.get(w.name);
      if (!old && w.day) lines.push(`   ${w.name}: смена ${fmt(w.day)} м`);
      else if (old && old.day !== w.day) lines.push(`   ${w.name}: смена ${fmt(old.day)} → ${fmt(w.day)} м`);
    }
  }
  if (prev.prep.day !== next.prep.day || prev.prep.month !== next.prep.month) {
    lines.push(`• Пробоподготовка: дробление за сутки ${fmt(prev.prep.day)} → ${fmt(next.prep.day)}, месяц ${fmt(prev.prep.month)} → ${fmt(next.prep.month)}`);
  }
  if (!lines.length) return "";
  return [`Сводка за ${ru(next.date)} обновилась:`, ...lines, "", "Напишите боту «сводка», чтобы получить её целиком."].join("\n");
}

/* ---------------------------- архив ---------------------------- */

export function lastSnapshot(date: string) {
  return pdb.prepare(`SELECT * FROM daily_snapshots WHERE report_date=? ORDER BY version DESC LIMIT 1`).get(date) as any;
}

/** Сохранить редакцию, если цифры изменились. Возвращает запись и признак новизны */
export function saveSnapshot(s: DailySummary, reason: string): { row: any; isNew: boolean; prev: any } {
  const hash = summaryHash(s);
  const prev = lastSnapshot(s.date);
  if (prev && prev.hash === hash) return { row: prev, isNew: false, prev };
  const version = (prev?.version ?? 0) + 1;
  const info = pdb.prepare(
    `INSERT INTO daily_snapshots (report_date, version, created_at, reason, hash, data, text, sent) VALUES (?,?,?,?,?,?,?,0)`,
  ).run(s.date, version, new Date().toISOString(), reason, hash, JSON.stringify(s), summaryText(s));
  const row = pdb.prepare(`SELECT * FROM daily_snapshots WHERE id=?`).get(info.lastInsertRowid) as any;
  return { row, isNew: true, prev };
}

export function snapshotList(limit = 120) {
  return pdb.prepare(
    `SELECT id, report_date, version, created_at, reason, hash, sent FROM daily_snapshots ORDER BY report_date DESC, version DESC LIMIT ?`,
  ).all(limit) as any[];
}

export function snapshotById(id: number) {
  const row = pdb.prepare(`SELECT * FROM daily_snapshots WHERE id=?`).get(id) as any;
  if (!row) return null;
  return { ...row, data: JSON.parse(row.data || "{}") as DailySummary };
}

export function deleteSnapshot(id: number) {
  return pdb.prepare(`DELETE FROM daily_snapshots WHERE id=?`).run(id).changes;
}

export function markSnapshotSent(id: number) {
  pdb.prepare(`UPDATE daily_snapshots SET sent=1 WHERE id=?`).run(id);
}

/* ---------------------------- Excel ---------------------------- */

export async function summaryWorkbook(s: DailySummary): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ГРР-Контроль";
  const ws = wb.addWorksheet("Бурение");
  ws.addRow([`Суточная сводка ООО ПБК за ${ru(s.date)}`]).font = { bold: true, size: 13 };
  ws.addRow([]);
  const head = ws.addRow([
    "Участок", "Бурильщик", "Станок", "За смену, м", "За сутки (участок), м", "С начала месяца, м",
    "С начала года, м", "План месяца, м", "План на дату, м", "До плана, м", "Отставание (+) / опережение (−), м", "Выполнено, %", "Комментарий",
  ]);
  head.font = { bold: true };
  head.alignment = { wrapText: true, vertical: "middle" };
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF4" } }; });
  for (const o of s.objects) {
    const first = ws.addRow([
      o.object, "Итого по участку", "", "", o.day, o.month, o.year, o.planMonth || "", o.planMonth ? o.planToDate : "",
      o.planMonth ? o.remaining : "", o.planMonth ? o.lag : "", o.planMonth ? o.pct : "",
      o.reported ? "" : (o.lastDate ? `нет сводки за сутки, последние данные ${ru(o.lastDate)}` : "нет сводки"),
    ]);
    first.font = { bold: true };
    for (const w of o.workers) {
      ws.addRow([o.object, w.name, w.rig, w.day, "", w.month, w.year, "", "", "", "", "", w.comment]);
    }
  }
  const tot = ws.addRow(["Итого", "", "", "", s.totals.day, s.totals.month, s.totals.year, s.totals.planMonth, s.totals.planToDate, s.totals.remaining, s.totals.lag]);
  tot.font = { bold: true };
  [22, 22, 12, 12, 14, 14, 14, 13, 13, 12, 18, 11, 40].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.getRow(3).height = 45;

  const wp = wb.addWorksheet("Пробоподготовка");
  wp.addRow([`Пробоподготовка за ${ru(s.date)}`]).font = { bold: true, size: 13 };
  wp.addRow([]);
  const ph = wp.addRow(["Показатель", "За сутки", "С начала месяца", "С начала года"]);
  ph.font = { bold: true };
  wp.addRow(["Дробление, проб", s.prep.day, s.prep.month, s.prep.year]);
  wp.addRow(["Истирание, проб", s.prep.milledDay, s.prep.milledMonth, s.prep.milledYear]);
  if (!s.prep.reported) wp.addRow([s.prep.lastDate ? `Нет сводки за сутки, последние данные ${ru(s.prep.lastDate)}` : "Сводки нет"]);
  [24, 14, 18, 16].forEach((w, i) => { wp.getColumn(i + 1).width = w; });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ---------------------------- рассылка ---------------------------- */

/** Разбить длинный текст на части под ограничение MAX (4000 символов) */
function chunks(text: string, size = 3500): string[] {
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if ((cur + "\n" + line).length > size && cur) { out.push(cur); cur = line; } else cur = cur ? cur + "\n" + line : line;
  }
  if (cur) out.push(cur);
  return out;
}

export async function sendToRecipients(text: string, chatIds?: string[]) {
  const { sendMax } = await import("./max");
  const ids = chatIds ?? dailySettings().chatIds.split(",").map((x) => x.trim()).filter(Boolean);
  let sent = 0;
  const errors: string[] = [];
  for (const [i, id] of ids.entries()) {
    for (const [j, part] of chunks(text).entries()) {
      if (i > 0 || j > 0) await new Promise((r) => setTimeout(r, 600));
      const res = await sendMax(id, part);
      if (!res.ok) { errors.push(`${id}: ${res.response}`); break; }
      if (j === 0) sent++;
    }
  }
  return { sent, errors, recipients: ids.length };
}

/** Отправить сводку за дату сейчас (кнопкой из программы или командой боту) */
export async function sendDailyNow(date = defaultReportDate(), chatIds?: string[]) {
  const s = dailySummary(date);
  const { row } = saveSnapshot(s, "отправка вручную");
  const out = await sendToRecipients(summaryText(s), chatIds);
  if (out.sent) markSnapshotSent(row.id);
  return { ...out, snapshotId: row.id };
}

/**
 * Ежечасная проверка: забрать почту, пересчитать сводку, сохранить редакцию.
 * В окне рассылки — отправить сводку за сутки. После утренней отправки —
 * сообщить об изменениях, если они появились.
 */
export async function hourlyTick(force = false, mailNow = false, mailAgain = false) {
  const st = dailySettings();
  const now = localNow(st.tz);
  const hourKey = `${now.date} ${now.hour}`;
  const { checkMail, mailDue } = await import("./mail");
  const wantMail = mailNow || mailDue();
  if (!force && !wantMail && st.lastHourKey === hourKey) return { skipped: true };
  saveDailySettings({ lastHourKey: hourKey });

  let mail: any = null;
  try {
    if (wantMail) mail = await checkMail(mailAgain);
  } catch (e) {
    mail = { error: String((e as Error)?.message ?? e) };
  }

  const date = addDays(now.date, -1);
  const s = dailySummary(date);
  const { row, isNew, prev } = saveSnapshot(s, mail?.accepted ? "новые файлы с почты" : "ежечасная проверка");

  let sentMorning = false;
  let sentChanges = false;
  if (st.enabled && st.chatIds.trim()) {
    // Окно рассылки — с sendFrom. Если окно пропущено (рассылку включили днём,
    // сервер перезапускался утром), сводка уходит при первой проверке после
    // него, а не ждёт следующего утра.
    const dueToday = now.hour >= st.sendFrom;
    if (dueToday && st.lastSentDate !== now.date) {
      const out = await sendToRecipients(summaryText(s));
      if (out.sent) {
        markSnapshotSent(row.id);
        saveDailySettings({ lastSentDate: now.date, lastSentHash: row.hash });
        sentMorning = true;
      }
    } else if (st.notifyChanges && st.lastSentDate === now.date && isNew && row.hash !== st.lastSentHash) {
      const prevData: DailySummary | null = prev ? JSON.parse(prev.data) : null;
      const text = prevData ? changesText(prevData, s) : "";
      if (text) {
        const out = await sendToRecipients(text);
        if (out.sent) {
          markSnapshotSent(row.id);
          saveDailySettings({ lastSentHash: row.hash });
          sentChanges = true;
        }
      }
    }
  }
  return { date, hour: now.hour, mail, snapshot: row.id, isNew, sentMorning, sentChanges };
}

export function startDailyScheduler() {
  const tick = async () => {
    try {
      const out: any = await hourlyTick();
      if (!out.skipped && (out.isNew || out.sentMorning || out.sentChanges || out.mail?.accepted)) {
        console.log(`[Сводка] ${out.date}: редакция ${out.snapshot}${out.isNew ? " (новая)" : ""}`
          + `${out.mail?.accepted ? `, файлов с почты ${out.mail.accepted}` : ""}`
          + `${out.sentMorning ? ", утренняя рассылка" : ""}${out.sentChanges ? ", сообщено об изменениях" : ""}`);
      }
    } catch (e) {
      console.log(`[Сводка] Ошибка: ${String((e as Error)?.message ?? e)}`);
    }
  };
  setTimeout(tick, 60_000);
  setInterval(tick, 5 * 60_000);
}
