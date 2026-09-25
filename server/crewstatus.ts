/**
 * «Кто где» для бота MAX: кто на вахте, в командировке, на межвахте,
 * в офисе и кто отсутствует. Считается по единому правилу статуса.
 *
 * MAX не умеет красить текст, поэтому группы отмечены цветными кружками,
 * а заголовки выделены жирным (разметка HTML). Сначала приходит короткий
 * итог по группам, подробности — кнопками, чтобы сообщение не было длинным.
 */
import { storage } from "./storage";
import { employeeStateOn, type EmployeeState } from "@shared/status";

export type CrewGroup = "onshift" | "trip" | "between" | "absent" | "office" | "none";

export const GROUPS: { key: CrewGroup; mark: string; title: string; states: EmployeeState[] }[] = [
  { key: "onshift", mark: "🟢", title: "На вахте", states: ["onshift"] },
  { key: "trip", mark: "🔵", title: "В командировке", states: ["trip"] },
  { key: "between", mark: "🟡", title: "На межвахте", states: ["between"] },
  { key: "absent", mark: "🟠", title: "Отпуск, больничный, обучение", states: ["vacation", "sick", "study"] },
  { key: "office", mark: "⚪", title: "Офис и ПП", states: ["office", "pp"] },
  { key: "none", mark: "🔴", title: "Вахта не назначена", states: ["none"] },
];

const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dm = (iso: string) => (iso && iso !== "9999-12-31" ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : "");
const short = (fio: string) => {
  // «Иванов Иван Иванович» → «Иванов И. И.», уже сокращённые оставляем
  const p = String(fio ?? "").trim().split(/\s+/);
  if (p.length === 3 && p[1].length > 2 && p[2].length > 2) return `${p[0]} ${p[1][0]}. ${p[2][0]}.`;
  return fio;
};

function todayLocal() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Krasnoyarsk" });
}

type Row = {
  id: number; fio: string; state: EmployeeState; object: string;
  note: string;
};

export function crewRows(day = todayLocal()): Row[] {
  const emps = storage.employees() as any[];
  const shifts = storage.shifts() as any[];
  const events = storage.employeeEvents() as any[];
  const objs = storage.objects() as any[];
  const objName = (id: number) => objs.find((o) => o.id === id)?.name ?? "";
  const KIND: Record<string, string> = { vacation: "отпуск", sick: "больничный", study: "обучение" };

  return emps.map((e) => {
    const own = shifts.filter((s) => s.employeeId === e.id);
    const ev = events.filter((x) => x.employeeId === e.id);
    const state = employeeStateOn(day, e, own, ev);
    const cur = own.find((s) => s.startDate <= day && s.endDate >= day);
    const next = own.filter((s) => s.startDate > day).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
    const absence = ev.find((x) => x.startDate <= day && x.endDate >= day && x.kind === state);
    let object = objName(e.objectId);
    let note = "";
    if (state === "onshift" && cur) {
      object = objName(cur.objectId) || object;
      note = dm(cur.endDate) ? `до ${dm(cur.endDate)}` : "";
    } else if (state === "trip" && absence) {
      object = (absence.destinationObjectId ? objName(absence.destinationObjectId) : absence.destination) || "место не указано";
      note = dm(absence.endDate) ? `до ${dm(absence.endDate)}` : "";
    } else if (state === "between") {
      note = next ? `заезд ${dm(next.startDate)}` : "";
      if (next) object = objName(next.objectId) || object;
    } else if (["vacation", "sick", "study"].includes(state) && absence) {
      note = `${KIND[state]}${dm(absence.endDate) ? ` до ${dm(absence.endDate)}` : ""}`;
    }
    return { id: e.id, fio: e.fio, state, object: object || "без участка", note };
  });
}

/** Короткий итог: по одной строке на группу */
export function crewOverviewText(day = todayLocal()) {
  const rows = crewRows(day);
  const lines = [`<b>Кто где на ${dm(day)}.${day.slice(0, 4)}</b>`, `Всего сотрудников: ${rows.length}`, ""];
  for (const g of GROUPS) {
    const n = rows.filter((r) => g.states.includes(r.state)).length;
    if (!n && g.key !== "onshift") continue;
    lines.push(`${g.mark} ${g.title} — <b>${n}</b>`);
  }
  const soonTrips = upcomingTrips(day).length;
  if (soonTrips) lines.push(`🔷 Скоро командировка — <b>${soonTrips}</b>`);
  // вахта по участкам — самое нужное, показываем сразу
  const on = rows.filter((r) => r.state === "onshift");
  if (on.length) {
    const byObj = new Map<string, number>();
    for (const r of on) byObj.set(r.object, (byObj.get(r.object) ?? 0) + 1);
    lines.push("", "<b>На участках:</b>");
    for (const [o, n] of Array.from(byObj).sort((a, b) => b[1] - a[1])) lines.push(`• ${esc(o)} — ${n}`);
  }
  lines.push("", "<i>Нажмите группу ниже, чтобы увидеть фамилии.</i>");
  const buttons = GROUPS
    .filter((g) => rows.some((r) => g.states.includes(r.state)) || (g.key === "trip" && soonTrips > 0))
    .map((g) => ({ text: `${g.mark} ${g.title}`, payload: `st:crew:${g.key}` }));
  return { text: lines.join("\n"), buttons };
}

/** Одна группа подробно: по участкам, фамилии через запятую с датами */
export function crewGroupText(key: CrewGroup, day = todayLocal()) {
  const g = GROUPS.find((x) => x.key === key) ?? GROUPS[0];
  const rows = crewRows(day).filter((r) => g.states.includes(r.state));
  const lines = [`${g.mark} <b>${g.title} — ${rows.length}</b>`];
  const soon = key === "trip" ? upcomingTrips(day) : [];
  if (!rows.length && !soon.length) return [...lines, "", "Никого."].join("\n");

  const byObj = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byObj.has(r.object)) byObj.set(r.object, []);
    byObj.get(r.object)!.push(r);
  }
  for (const [o, list] of Array.from(byObj).sort((a, b) => b[1].length - a[1].length)) {
    lines.push("", `<b>${esc(o)}</b> (${list.length})`);
    for (const r of list.sort((a, b) => a.fio.localeCompare(b.fio, "ru"))) {
      lines.push(`• ${esc(short(r.fio))}${r.note ? ` — <i>${esc(r.note)}</i>` : ""}`);
    }
  }
  if (soon.length) {
    lines.push("", "<b>Скоро выезжают:</b>");
    for (const t of soon) lines.push(`• ${esc(short(t.fio))} — ${esc(t.place)}, <i>${dm(t.startDate)}${dm(t.endDate) ? `–${dm(t.endDate)}` : ""}</i>`);
  }
  return lines.join("\n");
}

/** Командировки, которые начнутся в ближайшую неделю */
export function upcomingTrips(day = todayLocal(), days = 7) {
  const emps = storage.employees() as any[];
  const objs = storage.objects() as any[];
  const limit = new Date(day + "T00:00:00Z");
  limit.setUTCDate(limit.getUTCDate() + days);
  const to = limit.toISOString().slice(0, 10);
  return (storage.employeeEvents() as any[])
    .filter((ev) => ev.kind === "trip" && ev.startDate > day && ev.startDate <= to)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((ev) => ({
      fio: emps.find((e) => e.id === ev.employeeId)?.fio ?? `#${ev.employeeId}`,
      place: (ev.destinationObjectId ? objs.find((o) => o.id === ev.destinationObjectId)?.name : ev.destination) || "место не указано",
      startDate: ev.startDate, endDate: ev.endDate,
    }));
}
