/**
 * Служебные проверки по расписанию:
 *  • утренний отчёт директору в MAX (9:30): кто не прислал сводку, какие
 *    вызовы не отправлены, кто не подтвердил заезд, состояние почты, бота и копий;
 *  • проверка бота MAX раз в час: жив ли токен, на месте ли подписка webhook.
 *    Если подписка пропала — программа восстанавливает её сама и сообщает директору.
 */
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { DATA_DIR } from "./paths";
import { maxSettings, saveMaxSettings, sendMaxMenu, maxRequest, enableMaxWebhook } from "./max";

const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ru = (iso: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : "");
const list = (v: unknown) => String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

function local() {
  const now = new Date();
  const date = now.toLocaleDateString("en-CA", { timeZone: "Asia/Krasnoyarsk" });
  const [h, m] = now.toLocaleTimeString("en-GB", { timeZone: "Asia/Krasnoyarsk", hour12: false }).split(":").map(Number);
  return { date, hour: h, minute: m };
}

type Health = { at: string; ok: boolean; note: string; alertedDate?: string };
export function botHealth(): Health {
  try { return JSON.parse(storage.getSetting("max_health") || "null") ?? { at: "", ok: true, note: "" }; }
  catch { return { at: "", ok: true, note: "" }; }
}
function saveHealth(h: Health) { storage.setSetting("max_health", JSON.stringify(h)); }

/** Состояние последней резервной копии — пишет deploy/backup.sh */
export function backupState(): { at: string; offsite: string; note: string } | null {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, "backup_status.json"), "utf8")); } catch { return null; }
}

async function toDirector(text: string) {
  const ids = list(maxSettings().directorChatIds);
  const { menuRows } = await import("./maxmenu");
  for (const [i, id] of ids.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 600));
    try { await sendMaxMenu(id, text, menuRows("director", id), "html"); } catch { /* следующему */ }
  }
  return ids.length;
}

/* ------------------------- проверка бота ------------------------- */

export async function checkBot(): Promise<Health> {
  const s = maxSettings();
  const prev = botHealth();
  const h: Health = { at: new Date().toISOString(), ok: true, note: "бот работает", alertedDate: prev.alertedDate };
  if (!s.enabled || !s.token) { h.note = "бот выключен"; saveHealth(h); return h; }
  try {
    await maxRequest("/me");
  } catch (e) {
    h.ok = false;
    h.note = `MAX не отвечает или токен недействителен: ${String((e as Error)?.message ?? e)}`;
  }
  if (h.ok && s.mode === "webhook" && s.webhookUrl) {
    try {
      const subs = await maxRequest("/subscriptions");
      const urls: string[] = (subs?.subscriptions ?? []).map((x: any) => String(x.url ?? "").replace(/\/+$/, ""));
      if (!urls.includes(s.webhookUrl.replace(/\/+$/, ""))) {
        await enableMaxWebhook(s.webhookUrl);
        h.note = "подписка MAX пропала — восстановлена автоматически";
        await toDirector(`🛠 <b>Бот MAX</b>\nПодписка на сообщения пропала и восстановлена автоматически. Сообщения, отправленные боту за это время, могли не дойти.`);
      }
    } catch (e) {
      h.ok = false;
      h.note = `не удалось проверить подписку: ${String((e as Error)?.message ?? e)}`;
    }
  }
  // о неисправности — директору не чаще раза в день
  const today = local().date;
  if (!h.ok && h.alertedDate !== today) {
    h.alertedDate = today;
    saveHealth(h);
    // если MAX недоступен, сообщение тоже может не дойти — тогда увидят в утреннем отчёте и в программе
    try { await toDirector(`🔴 <b>Бот MAX работает с ошибкой</b>\n${esc(h.note)}`); } catch { /* нет связи */ }
    return h;
  }
  saveHealth(h);
  return h;
}

/* ------------------- напоминания сотрудникам ------------------- */

/**
 * Напоминание о заезде тем, кому вызов уже отправлен: за 3 дня и за 1 день.
 * Кнопки «Подтверждаю» и «Не смогу» те же, что в вызове.
 */
export async function remindEmployees(): Promise<{ sent: number }> {
  const s = maxSettings();
  if (!s.enabled || !s.token || s.remindBefore === false) return { sent: 0 };
  const { pendingCallouts } = await import("./sms");
  const { maxChatId, sendMax } = await import("./max");
  const objs = storage.objects() as any[];
  let done: Record<string, string> = {};
  try { done = JSON.parse(storage.getSetting("shift_reminders") || "{}"); } catch { done = {}; }
  const today = local().date;
  let sent = 0;
  for (const c of pendingCallouts(3)) {
    if (!c.sentAt) continue;                  // вызов ещё не отправляли
    if (c.answer === "decline") continue;     // человек уже отказался
    if (![3, 1].includes(c.daysLeft)) continue;
    const key = `${c.shiftId}:${c.daysLeft}`;
    if (done[key]) continue;
    const chat = maxChatId(c.employeeId);
    if (!chat) continue;
    const place = objs.find((o) => o.name === c.object)?.name ?? c.object;
    const when = c.daysLeft === 1 ? "<b>завтра</b>" : `через <b>${c.daysLeft} дня</b>`;
    const text = [`🔔 <b>Напоминание о заезде</b>`, `Заезд ${when}, ${ru(c.startDate)}.`,
      `Участок: <b>${esc(place)}</b>`, `Выезд: ${ru(c.endDate)}`, "",
      c.answer === "confirm" ? "<i>Вы подтвердили заезд. Если планы изменились — нажмите «Не смогу».</i>"
        : "<i>Подтвердите, пожалуйста, кнопкой ниже.</i>"].join("\n");
    try {
      await sendMax(chat, text, c.shiftId, true, "html");
      done[key] = today;
      sent++;
      await new Promise((r) => setTimeout(r, 600));
    } catch { /* следующему */ }
  }
  // чистим старые отметки
  // отметки старше двух недель больше не нужны
  const old = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  for (const k of Object.keys(done)) if (done[k] < old) delete done[k];
  storage.setSetting("shift_reminders", JSON.stringify(done));
  return { sent };
}

/* --------------------- утренний отчёт директору --------------------- */

export async function directorReportText(): Promise<string> {
  const { dailySummary } = await import("./daily");
  const { mailSettings } = await import("./mail");
  const { pendingCallouts } = await import("./sms");
  const s = dailySummary();
  const out: string[] = [`☀️ <b>Утренний контроль · ${ru(local().date)}</b>`];

  // сводки
  out.push("", `<b>Сводки за ${ru(s.date)}</b>`);
  const noReport = s.objects.filter((o) => !o.reported && (o.lastDate || o.year));
  const reported = s.objects.filter((o) => o.reported);
  out.push(`🟢 Прислали: ${reported.length ? reported.map((o) => esc(o.object)).join(", ") : "никто"}`);
  if (noReport.length) out.push(`🔴 Нет сводки: ${noReport.map((o) => `${esc(o.object)} (последняя ${ru(o.lastDate)})`).join(", ")}`);
  out.push(s.prep.reported ? "🟢 ЦПП прислал" : `🔴 ЦПП: нет сводки${s.prep.lastDate ? ` (последняя ${ru(s.prep.lastDate)})` : ""}`);
  const m = mailSettings();
  if (!m.enabled) out.push("⚠️ Почта не забирается автоматически");
  else if (m.lastError) out.push(`⚠️ Почта: ${esc(m.lastError)}`);

  // заезды на 3 дня
  const calls = pendingCallouts(3);
  const notSent = calls.filter((c) => !c.sentAt);
  const noAnswer = calls.filter((c) => c.sentAt && !c.answer);
  const declined = calls.filter((c) => c.answer === "decline");
  const confirmed = calls.filter((c) => c.answer === "confirm");
  out.push("", `<b>Заезды на 3 дня: ${calls.length}</b>`);
  if (!calls.length) out.push("Заездов нет.");
  if (confirmed.length) out.push(`🟢 Подтвердили: ${confirmed.length}`);
  if (notSent.length) out.push(`📨 Вызов не отправлен: ${notSent.map((c) => `${esc(c.fio)} (${ru(c.startDate)})`).join(", ")}`);
  if (noAnswer.length) out.push(`🟡 Без ответа: ${noAnswer.map((c) => `${esc(c.fio)} (${ru(c.startDate)})`).join(", ")}`);
  if (declined.length) out.push(`🔴 Отказались: ${declined.map((c) => `${esc(c.fio)} (${ru(c.startDate)})`).join(", ")}`);

  // служебное
  const h = botHealth();
  const b = backupState();
  out.push("", "<b>Система</b>");
  out.push(h.ok ? "🟢 Бот MAX работает" : `🔴 Бот MAX: ${esc(h.note)}`);
  if (!b) out.push("⚠️ Резервных копий ещё не было");
  else {
    const age = (Date.now() - new Date(b.at).getTime()) / 3600000;
    out.push(age > 30 ? `🔴 Резервная копия устарела: ${esc(b.at.slice(0, 16).replace("T", " "))}` : "🟢 Резервная копия за ночь сделана");
    out.push(b.offsite === "ok" ? "🟢 Копия выгружена в облако" : `⚠️ Копия в облако: ${esc(b.offsite || "не настроено")}`);
  }
  return out.join("\n");
}

export function startAutomationScheduler() {
  let lastBotCheck = 0;
  const tick = async () => {
    try {
      const s = maxSettings();
      if (Date.now() - lastBotCheck > 60 * 60_000) {
        lastBotCheck = Date.now();
        await checkBot();
      }
      if (!s.enabled || !s.token) return;
      if (s.directorReport === false || !list(s.directorChatIds).length) {
        // отчёта нет, но напоминания сотрудникам всё равно нужны
        const t0 = local();
        if (t0.hour >= 9 && t0.hour < 21) await remindEmployees();
        return;
      }
      const t = local();
      const due = (t.hour > 9 || (t.hour === 9 && t.minute >= 30)) && t.hour < 21;
      if (!due || s.directorReportDate === t.date) return;
      saveMaxSettings({ directorReportDate: t.date });
      await remindEmployees();
      await toDirector(await directorReportText());
      console.log("[Отчёт директору] отправлен");
    } catch (e) {
      console.log(`[Автоматика] ${String((e as Error)?.message ?? e)}`);
    }
  };
  setTimeout(tick, 120_000);
  setInterval(tick, 10 * 60_000);
}
