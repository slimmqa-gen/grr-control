/**
 * Кадровая аналитика: месячные и годовые итоги по каждому сотруднику.
 *
 * Правило расчёта: один календарный день относится только к одному состоянию.
 * Приоритет состояний сверху вниз, поэтому суммы по месяцу и по году не дублируются
 * и в итоге дают число прошедших календарных дней.
 */
import { storage } from "./storage";
import { OPEN_ENDED_DATE } from "@shared/schema";
import { workDayMap } from "./calendar";

export const HR_STATES = [
  "sick", "vacation", "study", "trip", "onshift", "between", "work", "dayoff", "unassigned",
] as const;
export type HrState = (typeof HR_STATES)[number];

export const HR_STATE_LABELS: Record<HrState, string> = {
  sick: "Больничный",
  vacation: "Отпуск",
  study: "Обучение",
  trip: "Командировка",
  onshift: "На вахте",
  between: "На межвахте",
  work: "Работа",
  dayoff: "Выходной",
  unassigned: "Без статуса",
};

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayIso = () => iso(new Date());

/** Приоритет события над расчётом по вахте: тип события → состояние дня */
const EVENT_STATE: Record<string, HrState> = {
  sick: "sick",
  vacation: "vacation",
  study: "study",
  trip: "trip",
  between: "between",
  office: "work",
  pp: "work",
};

type DayCounters = Record<HrState, number>;
const emptyCounters = (): DayCounters =>
  HR_STATES.reduce((acc, s) => { acc[s] = 0; return acc; }, {} as DayCounters);

/**
 * Состояние одного календарного дня сотрудника.
 * Событие (больничный, отпуск, обучение, командировка, межвахта) перекрывает вахту,
 * вахта перекрывает постоянный метод работы.
 */
function stateOfDay(
  day: string,
  emp: any,
  empShifts: any[],
  empEvents: any[],
  firstShiftStart: string,
  calendar: Map<string, string>,
): HrState {
  const covering = empEvents.filter((ev) => ev.startDate <= day && ev.endDate >= day);
  if (covering.length) {
    for (const s of HR_STATES) {
      if (covering.some((ev) => EVENT_STATE[String(ev.kind)] === s)) return s;
    }
  }
  if (empShifts.some((s) => s.startDate <= day && s.endDate >= day)) return "onshift";
  if (emp.workStatus === "between") {
    if (firstShiftStart && day >= firstShiftStart) return "between";
    // межвахта, отмеченная вручную, действует с сегодняшнего дня
    return emp.manualStatus === "between" && day >= new Date().toISOString().slice(0, 10) ? "between" : "unassigned";
  }
  if (emp.workStatus === "office" || emp.workStatus === "pp") {
    // офис и пробоподготовка работают по производственному календарю;
    // работа в выходной отмечается отдельной записью вида «Офис» или «ПП»
    const kind = calendar.get(day) ?? "work";
    return kind === "weekend" || kind === "holiday" ? "dayoff" : "work";
  }
  return "unassigned";
}

/** Итоги по месяцам и за год для одного сотрудника */
export function employeeTimesheet(employeeId: number, year: number) {
  const emp = storage.employees().find((e: any) => e.id === employeeId);
  if (!emp) throw new Error("Сотрудник не найден");

  const today = todayIso();
  const empShifts = storage.shifts().filter((s: any) => s.employeeId === employeeId);
  const empEvents = storage.employeeEvents()
    .filter((ev: any) => ev.employeeId === employeeId)
    .map((ev: any) => ({
      ...ev,
      // открытая запись «по настоящее время» считается только по сегодняшний день
      endDate: ev.endDate === OPEN_ENDED_DATE ? today : ev.endDate,
    }));
  const firstShiftStart = empShifts.map((s: any) => s.startDate).sort()[0] ?? "";
  const calendar = workDayMap([year]);

  const months = MONTHS.map((label, i) => {
    const counters = emptyCounters();
    const monthNum = i + 1;
    const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
    let counted = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const day = `${year}-${String(monthNum).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (day > today) break; // будущие дни не считаем — это факт, а не план
      counters[stateOfDay(day, emp, empShifts, empEvents, firstShiftStart, calendar)]++;
      counted++;
    }
    return { month: `${year}-${String(monthNum).padStart(2, "0")}`, label, days: counted, ...counters };
  });

  const total = emptyCounters();
  let totalDays = 0;
  for (const m of months) {
    totalDays += m.days;
    for (const s of HR_STATES) total[s] += (m as any)[s];
  }

  return {
    employeeId,
    fio: emp.fio,
    position: emp.position,
    year,
    months,
    total: { days: totalDays, ...total },
    states: HR_STATES.map((s) => ({ key: s, label: HR_STATE_LABELS[s] })),
  };
}

/** Годовые итоги по всем сотрудникам — сводная таблица для раздела «Сотрудники» */
export function allEmployeesTimesheet(year: number) {
  const rows = storage.employees().map((e: any) => {
    const t = employeeTimesheet(e.id, year);
    return {
      employeeId: e.id, fio: e.fio, position: e.position, objectId: e.objectId,
      ...t.total,
    };
  });
  rows.sort((a: any, b: any) => String(a.fio).localeCompare(String(b.fio), "ru"));
  return { year, rows, states: HR_STATES.map((s) => ({ key: s, label: HR_STATE_LABELS[s] })) };
}
