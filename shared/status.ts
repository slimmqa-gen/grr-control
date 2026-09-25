/**
 * Единое правило статуса сотрудника на дату.
 *
 * Им пользуются список сотрудников, фильтры, показатели дашборда,
 * срез на дату, выгрузка в Excel и табель — чтобы один и тот же человек
 * везде был в одном статусе.
 *
 * Порядок:
 *  1. Отсутствие на эту дату (отпуск, больничный, командировка, обучение).
 *  2. Вахта, в даты которой попадает день, — «На вахте».
 *  3. Метод работы:
 *     • «Работа в офисе» / «Работа на ПП» — офис или ПП;
 *     • «Работа вахтовым методом» — «На межвахте», если у человека есть
 *       вахты или межвахта отмечена вручную, иначе «Вахта не назначена».
 */
export type EmployeeState =
  | "onshift" | "between" | "none" | "office" | "pp"
  | "vacation" | "sick" | "trip" | "study";

export const ABSENCE_KINDS = ["vacation", "sick", "trip", "study"] as const;

type Emp = { workStatus?: string | null; manualStatus?: string | null };
type Sh = { startDate: string; endDate: string };
type Ev = { kind: string; startDate: string; endDate: string };

export function employeeStateOn(day: string, emp: Emp, shifts: Sh[], events: Ev[]): EmployeeState {
  const absence = events.find(
    (ev) => ev.startDate <= day && ev.endDate >= day && (ABSENCE_KINDS as readonly string[]).includes(ev.kind),
  );
  if (absence) return absence.kind as EmployeeState;

  // старые ручные отметки отсутствия без записей в журнале отсутствий
  const manual = String(emp.manualStatus ?? "");
  if (!events.length && (ABSENCE_KINDS as readonly string[]).includes(manual)) return manual as EmployeeState;

  if (shifts.some((s) => s.startDate <= day && s.endDate >= day)) return "onshift";

  const method = emp.workStatus || "office";
  if (method === "office") return "office";
  if (method === "pp") return "pp";
  return shifts.length || manual === "between" ? "between" : "none";
}
