/**
 * Кнопки (плашки) бота MAX по ролям:
 *  • директор — все команды;
 *  • ответственные — «Кто где», «Сводка», «Заезды», «События»;
 *  • буровые мастера — «Сводка» (если на вахте или есть разрешение),
 *    «Смена вахт» по своему участку, «Мой заезд», «Написать сообщение»;
 *  • сотрудники — «Мой заезд», «Написать сообщение».
 */
import { storage } from "./storage";
import { employeeStateOn } from "@shared/status";
import { maxSettings, sendMaxMenu, sendMax, maxChatId } from "./max";

export type MaxRole = "director" | "responsible" | "master" | "employee" | "unknown";

const list = (v: unknown) => String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ru = (iso: string) => (iso && iso !== "9999-12-31" ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "");
const dm = (iso: string) => (iso && iso !== "9999-12-31" ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : "");
const short = (fio: string) => {
  const p = String(fio ?? "").trim().split(/\s+/);
  return p.length >= 2 ? `${p[0]} ${p.slice(1).map((x) => x[0] ? `${x[0]}.` : "").join(" ")}`.trim() : String(fio ?? "");
};
export function todayLocal() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Krasnoyarsk" });
}
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const objName = (id: number) => (storage.objects() as any[]).find((o) => o.id === id)?.name ?? "";

export const isDirectorChat = (chatId: string) => !!chatId && list(maxSettings().directorChatIds).includes(chatId);
export const isMasterChat = (chatId: string) => !!chatId && list(maxSettings().masterChatIds).includes(chatId);

export function employeeIdByChat(chatId: string): number {
  const l = storage.notifyLinks().find((x: any) => x.channel === "max" && String(x.chatId) === chatId);
  return Number(l?.employeeId) || 0;
}

export function roleOf(chatId: string): MaxRole {
  if (isDirectorChat(chatId)) return "director";
  if (list(maxSettings().reportChatIds).includes(chatId)) return "responsible";
  if (isMasterChat(chatId)) return "master";
  if (employeeIdByChat(chatId)) return "employee";
  return "unknown";
}

/** Состояние сотрудника на сегодня по единому правилу */
function stateToday(employeeId: number) {
  const e = (storage.employees() as any[]).find((x) => x.id === employeeId);
  if (!e) return "";
  const day = todayLocal();
  const own = (storage.shifts() as any[]).filter((s) => s.employeeId === employeeId);
  const ev = (storage.employeeEvents() as any[]).filter((x) => x.employeeId === employeeId);
  return employeeStateOn(day, e, own, ev);
}

/** Мастер получает сводку, если он сейчас на вахте или директор разрешил ему на межвахте */
export function masterMaySeeSummary(chatId: string): boolean {
  if (!isMasterChat(chatId)) return false;
  if (list(maxSettings().masterOffAllowed).includes(chatId)) return true;
  const id = employeeIdByChat(chatId);
  return !!id && stateToday(id) === "onshift";
}

/** Кому доступна суточная сводка по запросу */
export async function maySeeSummary(chatId: string): Promise<boolean> {
  if (!chatId) return false;
  const r = roleOf(chatId);
  if (r === "director" || r === "responsible") return true;
  const { dailySettings } = await import("./daily");
  if (list(dailySettings().chatIds).includes(chatId)) return true;
  return masterMaySeeSummary(chatId);
}

/** Мастера, которым сегодня уходит утренняя сводка (на вахте или с разрешением) */
export function mastersForMorning(): string[] {
  return list(maxSettings().masterChatIds).filter((id) => masterMaySeeSummary(id));
}

/* ---------------------------- тексты ---------------------------- */

/** «Мой заезд»: текущая или ближайшая вахта сотрудника */
export function myShiftText(employeeId: number): string {
  if (!employeeId) return "Ваш профиль MAX не привязан к карточке сотрудника. Обратитесь в отдел кадров.";
  const day = todayLocal();
  const own = (storage.shifts() as any[]).filter((s) => s.employeeId === employeeId);
  const cur = own.find((s) => s.startDate <= day && s.endDate >= day);
  const next = own.filter((s) => s.startDate > day).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  const out: string[] = [];
  if (cur) {
    out.push(`🟢 <b>Вы на вахте</b>`, `Участок: <b>${esc(objName(cur.objectId) || "не указан")}</b>`,
      `С ${ru(cur.startDate)} по <b>${ru(cur.endDate)}</b>`);
  }
  if (next) {
    if (out.length) out.push("");
    out.push(`🔵 <b>${cur ? "Следующая вахта" : "Вам назначена вахта"}</b>`,
      `Участок: <b>${esc(objName(next.objectId) || "не указан")}</b>`,
      `Заезд: <b>${ru(next.startDate)}</b>`, `Выезд: ${ru(next.endDate)}`);
  }
  if (!out.length) return "⚪ Вахта вам пока не назначена. Как только её назначат — я сразу сообщу.";
  out.push("", "<i>Если даты изменятся — пришлю сообщение.</i>");
  return out.join("\n");
}

/** «Смена вахт»: кто на участке, кто скоро заезжает и выезжает */
export function rotationText(objectIds: number[] | null, days = 14): string {
  const day = todayLocal();
  const to = addDays(day, days);
  const emps = storage.employees() as any[];
  const fio = (id: number) => short(emps.find((e) => e.id === id)?.fio ?? `#${id}`);
  const shifts = (storage.shifts() as any[]).filter((s) => !objectIds || objectIds.includes(s.objectId));
  const objs = (objectIds ?? Array.from(new Set(shifts.map((s) => s.objectId)))).filter(Boolean);
  const out: string[] = [`🔄 <b>Смена вахт</b> · ближайшие ${days} дней`];
  let any = false;
  for (const oid of objs) {
    const here = shifts.filter((s) => s.objectId === oid);
    const now = here.filter((s) => s.startDate <= day && s.endDate >= day).sort((a, b) => a.endDate.localeCompare(b.endDate));
    const arrive = here.filter((s) => s.startDate > day && s.startDate <= to).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const leave = now.filter((s) => s.endDate <= to);
    if (!now.length && !arrive.length) continue;
    any = true;
    out.push("━━━━━━━━━━━━━━", `<b>${esc((objName(oid) || "Без участка").toUpperCase())}</b>`);
    out.push(`🟢 На участке сейчас: ${now.length}`);
    for (const s of now) out.push(`   • ${esc(fio(s.employeeId))} — до ${dm(s.endDate)}`);
    if (arrive.length) {
      out.push(`🔵 Заезжают:`);
      for (const s of arrive) out.push(`   • ${esc(fio(s.employeeId))} — <b>${dm(s.startDate)}</b>`);
    }
    if (leave.length) {
      out.push(`🟠 Выезжают:`);
      for (const s of leave) out.push(`   • ${esc(fio(s.employeeId))} — <b>${dm(s.endDate)}</b>`);
    }
  }
  if (!any) out.push("", "Ближайших заездов и выездов нет.");
  return out.join("\n");
}

/** Участок мастера: текущая вахта, иначе ближайшая, иначе участок из карточки */
export function masterObjectId(employeeId: number): number {
  const day = todayLocal();
  const own = (storage.shifts() as any[]).filter((s) => s.employeeId === employeeId);
  const cur = own.find((s) => s.startDate <= day && s.endDate >= day);
  if (cur?.objectId) return cur.objectId;
  const next = own.filter((s) => s.startDate > day).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  if (next?.objectId) return next.objectId;
  return Number((storage.employees() as any[]).find((e) => e.id === employeeId)?.objectId) || 0;
}

/* ---------------------------- кнопки ---------------------------- */

type Btn = { text: string; payload: string };

export function menuRows(role: MaxRole, chatId: string): Btn[][] {
  const b = (text: string, cmd: string): Btn => ({ text, payload: `m:${cmd}` });
  switch (role) {
    case "director":
      return [
        [b("📍 Кто где", "crew"), b("📊 Сводка", "summary")],
        [b("🚐 Заезды", "callout"), b("🔄 Смена вахт", "rotation")],
        [b("📋 События", "events"), b("👷 Люди", "people")],
      ];
    case "responsible":
      return [
        [b("📍 Кто где", "crew"), b("📊 Сводка", "summary")],
        [b("🚐 Заезды", "callout"), b("📋 События", "events")],
      ];
    case "master": {
      const rows: Btn[][] = [];
      rows.push(masterMaySeeSummary(chatId)
        ? [b("📊 Сводка", "summary"), b("🔄 Смена вахт", "rotation")]
        : [b("🔄 Смена вахт", "rotation")]);
      rows.push([b("🗓 Мой заезд", "myshift"), b("✉️ Написать сообщение", "write")]);
      return rows;
    }
    case "employee":
      return [[b("🗓 Мой заезд", "myshift"), b("✉️ Написать сообщение", "write")]];
    default:
      return [];
  }
}

const HELLO: Record<MaxRole, string> = {
  director: "Меню директора — нажмите нужную кнопку.",
  responsible: "Меню ответственного — нажмите нужную кнопку.",
  master: "Меню бурового мастера — нажмите нужную кнопку.",
  employee: "Нажмите кнопку: узнать о своей вахте или написать руководителю.",
  unknown: "Профиль не привязан. Откройте персональную ссылку, которую прислал отдел кадров.",
};

export async function sendMainMenu(chatId: string, text?: string) {
  const role = roleOf(chatId);
  const rows = menuRows(role, chatId);
  if (!rows.length) { await sendMax(chatId, text ?? HELLO[role]); return; }
  await sendMaxMenu(chatId, text ?? HELLO[role], rows, "html");
}

/** Нажата кнопка меню */
export async function handleMenu(chatId: string, cmd: string): Promise<void> {
  const role = roleOf(chatId);
  const rows = menuRows(role, chatId);
  const allowed = rows.flat().some((x) => x.payload === `m:${cmd}`);
  if (!allowed) {
    const why = cmd === "summary" && role === "master"
      ? "Вы сейчас на межвахте — сводка недоступна. Разрешение даёт руководитель."
      : "Эта команда вам недоступна.";
    await sendMainMenu(chatId, why);
    return;
  }
  const empId = employeeIdByChat(chatId);
  switch (cmd) {
    case "myshift":
      await sendMaxMenu(chatId, myShiftText(empId), rows, "html");
      return;
    case "write":
      await sendMax(chatId, "✉️ Напишите сообщение одним текстом — я передам его руководителю.");
      return;
    case "rotation": {
      const ids = role === "master" ? [masterObjectId(empId)].filter(Boolean) : null;
      const text = role === "master" && !ids?.length ? "Ваш участок не определён: нет вахты и участка в карточке." : rotationText(ids);
      await sendMaxMenu(chatId, text, rows, "html");
      return;
    }
    case "summary":
    case "people": {
      const { dailySummary, summaryHtml, workersHtml, sendToRecipients } = await import("./daily");
      const s = dailySummary();
      await sendToRecipients(cmd === "people" ? workersHtml(s) : summaryHtml(s), [chatId], "html");
      await sendMaxMenu(chatId, "Меню:", rows, "html");
      return;
    }
    // остальное — существующие команды руководителя
    case "crew":
    case "callout":
    case "events": {
      const { runLeaderCommand } = await import("./max");
      await runLeaderCommand(chatId, cmd);
      return;
    }
  }
}

/* ------------------- уведомление об изменении вахты ------------------- */

/** Сотруднику — сообщение, что ему назначили вахту */
export async function notifyShiftCreated(shift: any) {
  try {
    const s = maxSettings();
    if (!s.enabled || s.notifyShiftChanges === false || !shift || shift.endDate < todayLocal()) return;
    const chatId = maxChatId(shift.employeeId);
    if (!chatId) return;
    const text = [`🔵 <b>Вам назначена вахта</b>`,
      `Участок: <b>${esc(objName(shift.objectId) || "не указан")}</b>`,
      `Заезд: <b>${ru(shift.startDate)}</b>`, `Выезд: ${ru(shift.endDate)}`,
      "", "<i>Если даты изменятся — пришлю сообщение.</i>"].join("\n");
    await sendMaxMenu(chatId, text, menuRows(roleOf(chatId), chatId), "html");
  } catch (e) {
    console.log(`[MAX] Уведомление о вахте не ушло: ${String((e as Error)?.message ?? e)}`);
  }
}

/**
 * Сотруднику — сообщение, если его вахту перенесли, перевели на другой участок
 * или отменили. Прошедшие вахты не трогаем.
 */
export async function notifyShiftChange(before: any, after: any | null) {
  try {
    const s = maxSettings();
    if (!s.enabled || s.notifyShiftChanges === false || !before) return;
    const day = todayLocal();
    if (before.endDate < day && (!after || after.endDate < day)) return;
    const chatId = maxChatId(before.employeeId);
    if (!chatId) return;
    const place = (id: number) => objName(id) || "участок не указан";
    let text = "";
    if (!after) {
      text = `🔴 <b>Вахта отменена</b>\nУчасток: ${esc(place(before.objectId))}\nБыло: ${ru(before.startDate)} — ${ru(before.endDate)}\n\n<i>Если есть вопросы — нажмите «Написать сообщение».</i>`;
    } else {
      const changes: string[] = [];
      if (after.startDate !== before.startDate) changes.push(`Заезд: ${ru(before.startDate)} → <b>${ru(after.startDate)}</b>`);
      if (after.endDate !== before.endDate) changes.push(`Выезд: ${ru(before.endDate)} → <b>${ru(after.endDate)}</b>`);
      if (after.objectId !== before.objectId) changes.push(`Участок: ${esc(place(before.objectId))} → <b>${esc(place(after.objectId))}</b>`);
      if (!changes.length) return;
      text = [`🟡 <b>Вахта изменена</b>`, ...changes, "", `Сейчас: ${esc(place(after.objectId))}, ${ru(after.startDate)} — ${ru(after.endDate)}`].join("\n");
    }
    await sendMaxMenu(chatId, text, menuRows(roleOf(chatId), chatId), "html");
  } catch (e) {
    console.log(`[MAX] Уведомление об изменении вахты не ушло: ${String((e as Error)?.message ?? e)}`);
  }
}
