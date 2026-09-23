/**
 * Производственный календарь для офиса и пробоподготовки.
 *
 * Дни считаются по ТК РФ: суббота и воскресенье — выходные, нерабочие праздники
 * перечислены в статье 112. Если праздник выпадает на выходной, выходной
 * переносится на следующий рабочий день. Переносы на 2027 год и далее
 * правительство утверждает отдельными постановлениями, поэтому любой день
 * можно поправить вручную в разделе календаря.
 */
import { storage } from "./storage";
import { WORK_DAY_KINDS } from "@shared/schema";

/** Нерабочие праздничные дни: месяц-день */
const HOLIDAYS = [
  "01-01", "01-02", "01-03", "01-04", "01-05", "01-06", "01-07", "01-08",
  "02-23", "03-08", "05-01", "05-09", "06-12", "11-04",
];
const NEW_YEAR = new Set(["01-01", "01-02", "01-03", "01-04", "01-05", "01-06", "01-07", "01-08"]);

const iso = (d: Date) => d.toISOString().slice(0, 10);
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

export type CalendarDay = { date: string; kind: string; note: string };

/** Дни года по правилам ТК РФ, вместе с переносами выходных с праздников */
export function buildYear(year: number): CalendarDay[] {
  const days: CalendarDay[] = [];
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const md = iso(d).slice(5);
    const holiday = HOLIDAYS.includes(md);
    days.push({
      date: iso(d),
      kind: holiday ? "holiday" : isWeekend(d) ? "weekend" : "work",
      note: holiday ? "Нерабочий праздничный день" : "",
    });
  }

  // Перенос выходного с праздника, попавшего на субботу или воскресенье
  const byDate = new Map(days.map((x) => [x.date, x]));
  for (const day of [...days]) {
    const md = day.date.slice(5);
    if (!HOLIDAYS.includes(md) || NEW_YEAR.has(md)) continue;
    const d = new Date(day.date + "T00:00:00Z");
    if (!isWeekend(d)) continue;
    const next = new Date(d);
    for (let guard = 0; guard < 20; guard++) {
      next.setUTCDate(next.getUTCDate() + 1);
      const target = byDate.get(iso(next));
      if (target && target.kind === "work") {
        target.kind = "weekend";
        target.note = `Перенос выходного с ${day.date.slice(8, 10)}.${md.slice(0, 2)}`;
        break;
      }
    }
  }
  return days;
}

/** Создать или перезаписать календарь года. Ручные правки при пересоздании теряются. */
export function generateYear(year: number) {
  const days = buildYear(year);
  storage.upsertWorkDays(days);
  return days.length;
}

/** Календарь года из базы; если года ещё нет — он создаётся по ТК РФ */
export function calendarYear(year: number) {
  let rows = storage.workCalendarYear(year);
  if (!rows.length) {
    generateYear(year);
    rows = storage.workCalendarYear(year);
  }
  return rows.sort((a: any, b: any) => a.date.localeCompare(b.date));
}

/** Итоги по месяцам: рабочие, выходные, праздники, сокращённые дни */
export function calendarSummary(year: number) {
  const rows = calendarYear(year);
  const months = Array.from({ length: 12 }, (_, i) => {
    const prefix = `${year}-${String(i + 1).padStart(2, "0")}`;
    const list = rows.filter((d: any) => d.date.startsWith(prefix));
    return {
      month: prefix,
      work: list.filter((d: any) => d.kind === "work" || d.kind === "short").length,
      short: list.filter((d: any) => d.kind === "short").length,
      weekend: list.filter((d: any) => d.kind === "weekend").length,
      holiday: list.filter((d: any) => d.kind === "holiday").length,
      days: list.length,
    };
  });
  const total = months.reduce(
    (acc, m) => ({
      work: acc.work + m.work, short: acc.short + m.short,
      weekend: acc.weekend + m.weekend, holiday: acc.holiday + m.holiday, days: acc.days + m.days,
    }),
    { work: 0, short: 0, weekend: 0, holiday: 0, days: 0 },
  );
  return { year, months, total };
}

let cache: { key: string; map: Map<string, string> } | null = null;

/** Быстрая проверка дня: рабочий ли он по производственному календарю */
export function workDayMap(years: number[]): Map<string, string> {
  const key = years.join(",");
  if (cache && cache.key === key) return cache.map;
  const map = new Map<string, string>();
  for (const y of years) for (const d of calendarYear(y)) map.set(d.date, d.kind);
  cache = { key, map };
  return map;
}

/** Сбросить кэш после правки календаря */
export function resetCalendarCache() {
  cache = null;
}

export const KINDS = WORK_DAY_KINDS;
