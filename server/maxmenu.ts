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
      ru(cur.endDate) ? `С ${ru(cur.startDate)} по <b>${ru(cur.endDate)}</b>` : `С ${ru(cur.startDate)}, дата выезда <b>пока не определена</b>`);
  }
  if (next) {
    if (out.length) out.push("");
    out.push(`🔵 <b>${cur ? "Следующая вахта" : "Вам назначена вахта"}</b>`,
      `Участок: <b>${esc(objName(next.objectId) || "не указан")}</b>`,
      `Заезд: <b>${ru(next.startDate)}</b>`, `Выезд: ${ru(next.endDate) || "не определена"}`);
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
    for (const s of now) out.push(`   • ${esc(fio(s.employeeId))} — ${dm(s.endDate) ? `до ${dm(s.endDate)}` : "выезд не определён"}`);
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

/* ---------------------- предварительный заезд ---------------------- */

async function planList(objectIds: number[] | null) {
  const { planRows } = await import("./routes");
  return planRows().filter((p: any) => !objectIds || objectIds.includes(p.objectId));
}

async function exitList(objectIds: number[] | null) {
  const { exitRows } = await import("./routes");
  return exitRows().filter((x: any) => !objectIds || objectIds.includes(x.objectId));
}

/** Предварительный выезд по участкам */
export function exitText(list: any[]): string {
  const out: string[] = [`🚪 <b>Предварительный выезд</b>${list.length ? ` — ${list.length} чел.` : ""}`];
  if (!list.length) { out.push("В плане никого нет."); return out.join("\n"); }
  const byObj = new Map<string, any[]>();
  for (const x of list) { if (!byObj.has(x.object)) byObj.set(x.object, []); byObj.get(x.object)!.push(x); }
  for (const [obj, l] of byObj) {
    out.push("━━━━━━━━━━━━━━", `<b>${esc(String(obj).toUpperCase())}</b> · ${l.length} чел.`);
    for (const x of l) {
      out.push(`• <b>${esc(x.fio)}</b>${x.position ? `, ${esc(x.position)}` : ""} — выезд <b>${dm(x.endDate)}</b>`);
      out.push(`   ${x.replacedBy ? `сменщик: ${esc(x.replacedBy)}` : "без сменщика"}${x.source === "auto" ? " · по плану заезда" : ""}`);
    }
  }
  return out.join("\n");
}

/** План по участкам: кто, когда, станок или машина, кого меняет */
export function planText(plans: any[], short = false): string {
  const out: string[] = [`🗓 <b>Предварительный заезд</b>${plans.length ? ` — ${plans.length} чел.` : ""}`,
    "<i>Это план, вахта ещё не назначена.</i>"];
  if (!plans.length) { out.push("", "В плане никого нет."); return out.join("\n"); }
  const byObj = new Map<string, any[]>();
  for (const p of plans) {
    if (!byObj.has(p.object)) byObj.set(p.object, []);
    byObj.get(p.object)!.push(p);
  }
  for (const [obj, list] of byObj) {
    out.push("━━━━━━━━━━━━━━", `<b>${esc(String(obj).toUpperCase())}</b> · ${list.length} чел.`);
    for (const p of list) {
      const tech = [p.rig, p.vehicle].filter(Boolean).join(", ");
      out.push(`• <b>${esc(short ? p.fio : p.fio)}</b>${p.position ? `, ${esc(p.position)}` : ""} — заезд <b>${dm(p.startDate)}</b>`);
      const extra = [tech ? `🛠 ${esc(tech)}` : "", p.replacesFio ? `меняет ${esc(p.replacesFio)}` : "никого не меняет"].filter(Boolean);
      out.push(`   ${extra.join(" · ")}`);
    }
  }
  return out.join("\n");
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
        [b("📨 Вызовы", "callouts"), b("📋 События", "events")],
        [b("🗓 Предв. заезд и выезд", "plan"), b("👷 Люди", "people")],
      ];
    case "responsible":
      return [
        [b("📍 Кто где", "crew"), b("📊 Сводка", "summary")],
        [b("🚐 Заезды", "callout"), b("📨 Вызовы", "callouts")],
        [b("📋 События", "events"), b("🗓 Предв. заезд и выезд", "plan")],
      ];
    case "master": {
      const rows: Btn[][] = [];
      rows.push(masterMaySeeSummary(chatId)
        ? [b("📊 Сводка", "summary"), b("🔄 Смена вахт", "rotation")]
        : [b("🔄 Смена вахт", "rotation")]);
      rows.push([b("🗓 Мой заезд", "myshift"), b("✉️ Написать сообщение", "write")]);
      rows.push([b("🔜 Заезд и выезд на участке", "plan")]);
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
  // подтверждение выезда по участку — только директору
  if (cmd.startsWith("ec:") || cmd.startsWith("ecy:")) {
    if (role !== "director") { await sendMainMenu(chatId, "Подтверждать выезд может только директор."); return; }
    const oid = Number(cmd.split(":")[1]) || 0;
    const exits = (await exitList([oid])).filter((x: any) => x.shiftId);
    if (!exits.length) { await sendMaxMenu(chatId, "На этом участке выездов в плане нет.", rows, "html"); return; }
    const place = esc(exits[0].object);
    if (cmd.startsWith("ec:")) {
      await sendMaxMenu(chatId, `Подтвердить выезд: <b>${place}</b> — ${exits.length} чел.?\nДата выезда встанет в их вахты.`,
        [[{ text: `✅ Да, подтвердить (${exits.length})`, payload: `m:ecy:${oid}` }], [{ text: "Отмена", payload: "m:plan" }]], "html");
      return;
    }
    const { planHooks } = await import("./routes");
    const n = planHooks.confirmExits ? planHooks.confirmExits(exits.map((x: any) => x.key)) : 0;
    await sendMaxMenu(chatId, `✅ <b>${place}</b>: выезд подтверждён — ${n} чел.`, rows, "html");
    return;
  }
  // подтверждение плана из бота — только директору
  if (cmd.startsWith("pc:") || cmd.startsWith("pcy:")) {
    if (role !== "director") { await sendMainMenu(chatId, "Подтверждать план может только директор."); return; }
    const oid = Number(cmd.split(":")[1]) || 0;
    const plans = await planList([oid]);
    if (!plans.length) { await sendMaxMenu(chatId, "На этом участке в плане никого нет.", rows, "html"); return; }
    const place = esc(plans[0].object);
    if (cmd.startsWith("pc:")) {
      await sendMaxMenu(chatId,
        `Подтвердить всех: <b>${place}</b> — ${plans.length} чел.?\nКаждому будет назначена вахта по плану. Вызов отправляется отдельно.`,
        [[{ text: `✅ Да, подтвердить (${plans.length})`, payload: `m:pcy:${oid}` }], [{ text: "Отмена", payload: "m:plan" }]], "html");
      return;
    }
    const { planHooks } = await import("./routes");
    const n = planHooks.confirm ? planHooks.confirm(plans.map((p) => p.id)) : 0;
    await sendMaxMenu(chatId, `✅ <b>${place}</b>: подтверждено, назначено вахт — ${n}.\nВызовы — кнопкой «📨 Вызовы».`, rows, "html");
    return;
  }
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
    case "callouts": {
      const { sendCalloutReminder } = await import("./sms");
      const out = await sendCalloutReminder([chatId]);
      if (!out.rows) await sendMaxMenu(chatId, "✅ Все вызовы на ближайшие дни уже отправлены.", rows, "html");
      return;
    }
    case "plan": {
      const ids = role === "master" ? [masterObjectId(empId)].filter(Boolean) : null;
      if (role === "master" && !ids?.length) { await sendMaxMenu(chatId, "Ваш участок не определён.", rows, "html"); return; }
      const plans = await planList(ids);
      const exits = await exitList(ids);
      const text = planText(plans, role === "master") + "\n\n" + exitText(exits);
      // директору — кнопки «Подтвердить» по каждому участку
      const btns: Btn[][] = [];
      if (role === "director") {
        const byObj = new Map<number, { name: string; n: number }>();
        for (const p of plans) {
          const o = byObj.get(p.objectId) ?? { name: p.object, n: 0 };
          o.n++; byObj.set(p.objectId, o);
        }
        for (const [oid, o] of byObj) btns.push([{ text: `✅ Заезд: ${o.name} (${o.n})`.slice(0, 60), payload: `m:pc:${oid}` }]);
        const exObj = new Map<number, { name: string; n: number }>();
        for (const x of exits.filter((z: any) => z.shiftId)) {
          const o = exObj.get(x.objectId) ?? { name: x.object, n: 0 };
          o.n++; exObj.set(x.objectId, o);
        }
        for (const [oid, o] of exObj) btns.push([{ text: `🚪 Выезд: ${o.name} (${o.n})`.slice(0, 60), payload: `m:ec:${oid}` }]);
      }
      await sendMaxMenu(chatId, text, [...btns, ...rows], "html");
      return;
    }
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
      const { dailySummary, summaryHtml, workersHtml, sendToRecipients, summaryFor } = await import("./daily");
      const s = summaryFor(dailySummary(), chatId);
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

/** Разослать всем привязанным их меню — например, после обновления бота */
export async function broadcastMenu(): Promise<{ total: number }> {
  const chats = Array.from(new Set((storage.notifyLinks() as any[])
    .filter((l) => l.channel === "max" && l.chatId).map((l) => String(l.chatId))));
  void (async () => {
    for (const [i, id] of chats.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, 700));
      try { await sendMainMenu(id, "🔔 <b>Бот обновлён</b>\nТеперь всё — кнопками ниже. Меню можно вызвать в любой момент словом «меню»."); }
      catch { /* следующему */ }
    }
  })();
  return { total: chats.length };
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
    // сотрудник узнаёт о вахте из вызова; пока вызов не отправлен — ему не пишем
    const called = (storage.smsLog() as any[]).some((l) =>
      l.shiftId === before.id && ["callout", "max-callout"].includes(String(l.kind)) && l.status === "sent");
    if (!called) return;
    const place = (id: number) => objName(id) || "участок не указан";
    let text = "";
    if (!after) {
      text = `🔴 <b>Вахта отменена</b>\nУчасток: ${esc(place(before.objectId))}\nБыло: ${ru(before.startDate)} — ${ru(before.endDate) || "без даты выезда"}\n\n<i>Если есть вопросы — нажмите «Написать сообщение».</i>`;
    } else {
      const changes: string[] = [];
      if (after.startDate !== before.startDate) changes.push(`Заезд: ${ru(before.startDate)} → <b>${ru(after.startDate)}</b>`);
      if (after.endDate !== before.endDate) changes.push(`Выезд: ${ru(before.endDate) || "не определена"} → <b>${ru(after.endDate) || "не определена"}</b>`);
      if (after.objectId !== before.objectId) changes.push(`Участок: ${esc(place(before.objectId))} → <b>${esc(place(after.objectId))}</b>`);
      if (!changes.length) return;
      text = [`🟡 <b>Вахта изменена</b>`, ...changes, "", `Сейчас: ${esc(place(after.objectId))}, ${ru(after.startDate)} — ${ru(after.endDate) || "выезд не определён"}`].join("\n");
    }
    await sendMaxMenu(chatId, text, menuRows(roleOf(chatId), chatId), "html");
  } catch (e) {
    console.log(`[MAX] Уведомление об изменении вахты не ушло: ${String((e as Error)?.message ?? e)}`);
  }
}
