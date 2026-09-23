/**
 * СМС-вызов на вахту через шлюз SMSC.ru.
 *
 * Логика простая: за N дней до даты заезда сотрудник получает одно сообщение.
 * Повторно по той же вахте программа не пишет — в журнале остаётся запись.
 * Пароль и ключ хранятся в настройках на сервере и наружу не отдаются.
 */
import { storage } from "./storage";
import { DEFAULT_SMS_SETTINGS, type SmsSettings } from "@shared/schema";
import { maxChatId, sendMax, maxSettings, confirmStateByShift, saveMaxSettings } from "./max";

const SMSC_SEND = "https://smsc.ru/sys/send.php";
const SMSC_BALANCE = "https://smsc.ru/sys/balance.php";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayIso = () => iso(new Date());
const ruDate = (s: string) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : "");

export function smsSettings(): SmsSettings {
  const raw = storage.getSetting("sms");
  if (!raw) return { ...DEFAULT_SMS_SETTINGS };
  try {
    return { ...DEFAULT_SMS_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SMS_SETTINGS };
  }
}

export function saveSmsSettings(patch: Partial<SmsSettings>): SmsSettings {
  const next: SmsSettings = { ...smsSettings(), ...patch };
  next.daysBefore = Math.max(0, Math.min(30, Number(next.daysBefore) || 0));
  next.sendHour = Math.max(0, Math.min(23, Number(next.sendHour) || 0));
  storage.setSetting("sms", JSON.stringify(next));
  return next;
}

/** Настройки для интерфейса: секреты заменяются признаком «задано» */
export function publicSmsSettings() {
  const s = smsSettings();
  const { password, apikey, ...rest } = s;
  return { ...rest, hasPassword: !!password, hasApikey: !!apikey };
}

/** Номер в формате 7XXXXXXXXXX; пустая строка, если номер непригоден */
export function normalizePhone(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) return "7" + digits.slice(1);
  if (digits.length === 10 && digits.startsWith("9")) return "7" + digits;
  return "";
}

/** Подстановки в шаблон сообщения */
export function renderTemplate(template: string, ctx: Record<string, string>): string {
  return String(template ?? "").replace(/\{([а-яa-z]+)\}/gi, (_m, key) => ctx[String(key).toLowerCase()] ?? "");
}

/** Число частей сообщения: кириллица — 70 символов в части, 67 в составном */
export function smsParts(text: string): number {
  const len = [...String(text ?? "")].length;
  if (len === 0) return 0;
  return len <= 70 ? 1 : Math.ceil(len / 67);
}

type SendResult = { ok: boolean; status: string; response: string };

/** Понятные подсказки по кодам ошибок SMSC, чтобы не искать их в документации */
const ERROR_HINTS: Record<number, string> = {
  1: "Ошибка в параметрах запроса",
  2: "Неверный логин или пароль, либо отправка с неразрешённого IP-адреса",
  3: "Недостаточно средств на счёте SMSC",
  4: "IP-адрес временно заблокирован из-за частых ошибок — повторите позже",
  5: "Неверный формат даты",
  6: "Сообщение запрещено по тексту или имени отправителя. Для рассылок по своей базе "
     + "нужен заключённый договор с SMSC и зарегистрированное имя отправителя",
  7: "Неверный формат номера телефона",
  8: "Сообщение на этот номер доставить нельзя",
  9: "Слишком много одинаковых запросов за минуту — повторите позже",
};

const errorText = (data: any) => {
  const code = Number(data?.error_code ?? 0);
  const hint = ERROR_HINTS[code];
  return `${data?.error ?? "отказ шлюза"} (код ${code || "?"})${hint ? ` — ${hint}` : ""}`;
};

async function smscRequest(url: string, params: Record<string, string>): Promise<any> {
  const s = smsSettings();
  const query = new URLSearchParams({
    ...(s.apikey ? { apikey: s.apikey } : { login: s.login, psw: s.password }),
    fmt: "3",
    charset: "utf-8",
    ...params,
  });
  const res = await fetch(`${url}?${query.toString()}`);
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    return { error: body.slice(0, 300), error_code: 0 };
  }
}

/** Отправка одного сообщения; результат пишется в журнал вызывающей стороной */
export async function sendSms(phone: string, text: string): Promise<SendResult> {
  const s = smsSettings();
  if (!s.apikey && (!s.login || !s.password)) {
    return { ok: false, status: "error", response: "Не заданы логин и пароль (или API-ключ) SMSC" };
  }
  const to = normalizePhone(phone);
  if (!to) return { ok: false, status: "error", response: `Непригодный номер: ${phone || "пусто"}` };
  try {
    const data = await smscRequest(SMSC_SEND, {
      phones: to,
      mes: text,
      ...(s.sender ? { sender: s.sender } : {}),
      cost: "3",
    });
    if (data?.error) return { ok: false, status: "error", response: errorText(data) };
    return {
      ok: true,
      status: "sent",
      response: `отправлено частей ${data?.cnt ?? "?"}, стоимость ${data?.cost ?? "?"}, баланс ${data?.balance ?? "?"}`,
    };
  } catch (e: any) {
    return { ok: false, status: "error", response: `Шлюз недоступен: ${String(e?.message ?? e)}` };
  }
}

export async function smsBalance() {
  const s = smsSettings();
  if (!s.apikey && (!s.login || !s.password)) throw new Error("Не заданы логин и пароль (или API-ключ) SMSC");
  const data = await smscRequest(SMSC_BALANCE, { cur: "1" });
  if (data?.error) throw new Error(errorText(data));
  return { balance: data?.balance ?? "", currency: data?.currency ?? "руб." };
}

export type Callout = {
  shiftId: number;
  employeeId: number;
  fio: string;
  position: string;
  phone: string;
  phoneOk: boolean;
  object: string;
  startDate: string;
  endDate: string;
  daysLeft: number;
  text: string;
  parts: number;
  sentAt: string;
  /** привязан ли сотрудник к боту MAX */
  maxLinked: boolean;
  /** последний ответ по этой вахте: confirm, decline или пусто */
  answer: string;
};

/** Кого нужно вызвать: заезд наступает в течение daysBefore дней */
export function pendingCallouts(daysBeforeOverride?: number): Callout[] {
  const s = smsSettings();
  const daysBefore = daysBeforeOverride ?? s.daysBefore;
  const today = todayIso();
  const limit = iso(new Date(Date.now() + daysBefore * 86400000));
  const emps = storage.employees();
  const objs = storage.objects();
  const log = storage.smsLog();

  return storage.shifts()
    .filter((sh: any) => sh.startDate >= today && sh.startDate <= limit)
    .map((sh: any) => {
      const e = emps.find((x: any) => x.id === sh.employeeId);
      const object = objs.find((o: any) => o.id === sh.objectId)?.name ?? "участок не указан";
      const daysLeft = Math.round(
        (new Date(sh.startDate + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) / 86400000,
      );
      const text = renderTemplate(s.template, {
        фио: e?.fio ?? "",
        дата: ruDate(sh.startDate),
        участок: object,
        должность: e?.position ?? "",
        дней: String(daysLeft),
        контакт: s.contact,
        выезд: ruDate(sh.endDate),
      });
      const sent = log.find((l: any) =>
        l.shiftId === sh.id && ["callout", "max-callout"].includes(String(l.kind)) && l.status === "sent");
      return {
        shiftId: sh.id, employeeId: sh.employeeId,
        fio: e?.fio ?? "сотрудник удалён", position: e?.position ?? "",
        phone: e?.phone ?? "", phoneOk: !!normalizePhone(e?.phone ?? ""),
        object, startDate: sh.startDate, endDate: sh.endDate, daysLeft,
        text, parts: smsParts(text),
        sentAt: sent ? String(sent.createdAt) : "",
        maxLinked: !!maxChatId(sh.employeeId),
        answer: confirmStateByShift()[sh.id] ?? "",
      };
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.fio.localeCompare(b.fio, "ru"));
}

/** Отправка вызовов: только тем, кому ещё не отправляли и у кого есть номер */
export async function runCallouts(shiftIds?: number[], channel: Channel = "auto") {
  const list = pendingCallouts().filter((c) =>
    (!shiftIds || shiftIds.includes(c.shiftId)) && !c.sentAt && (c.phoneOk || !!maxChatId(c.employeeId)));
  const results: { fio: string; phone: string; ok: boolean; response: string }[] = [];
  for (const c of list) {
    const r = await sendOne(c.employeeId, c.phone, c.text, channel, c.shiftId, true);
    storage.createSmsLog({
      employeeId: c.employeeId, shiftId: c.shiftId, phone: r.via === "max" ? "MAX" : c.phone, text: c.text,
      kind: r.via === "max" ? "max-callout" : "callout",
      status: r.status, response: r.response, createdAt: new Date().toISOString(),
    });
    results.push({ fio: c.fio, phone: r.via === "max" ? "MAX" : c.phone, ok: r.ok, response: r.response });
  }
  const skipped = pendingCallouts().filter((c) => !c.phoneOk && !c.sentAt).length;
  return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, skipped, results };
}

/**
 * Отправка выбранным сотрудникам. Текст можно задать свой, иначе берётся шаблон
 * и подставляются данные ближайшей вахты сотрудника. Дублей программа не проверяет:
 * это ручная отправка по решению руководителя.
 */
export type Channel = "auto" | "sms" | "max";

/**
 * Один получатель: бесплатный MAX, если сотрудник привязан, иначе СМС.
 * Канал можно задать жёстко — тогда отправка идёт только выбранным способом.
 */
async function sendOne(
  employeeId: number, phone: string, text: string, channel: Channel,
  shiftId = 0, withButtons = false,
) {
  const linked = employeeId ? maxChatId(employeeId) : "";
  const maxOn = maxSettings().enabled && !!maxSettings().token;
  const useMax = channel === "max" || (channel === "auto" && maxOn && !!linked);

  if (useMax) {
    if (!linked) return { ok: false, status: "error", response: "Сотрудник не привязал бота MAX", via: "max" };
    const r = await sendMax(linked, text, shiftId, withButtons);
    return { ...r, via: "max" };
  }
  const r = await sendSms(phone, text);
  return { ...r, via: "sms" };
}

export async function sendToEmployees(
  employeeIds: number[],
  customText?: string,
  /** Номера, введённые вручную: employeeId → номер. Перебивают номер из карточки. */
  phoneOverrides?: Record<string, string>,
  /** Сохранять введённые вручную номера в карточки сотрудников */
  savePhones = false,
  channel: Channel = "auto",
  /** добавлять кнопки «Подтверждаю» и «Не смогу» под сообщением в MAX */
  withButtons = true,
) {
  const s = smsSettings();
  const today = todayIso();
  const emps = storage.employees();
  const objs = storage.objects();
  const allShifts = storage.shifts();
  const results: { employeeId: number; fio: string; phone: string; ok: boolean; response: string }[] = [];

  for (const id of employeeIds) {
    const e = emps.find((x: any) => x.id === id);
    if (!e) continue;
    const shift = allShifts
      .filter((sh: any) => sh.employeeId === id && sh.endDate >= today)
      .sort((a: any, b: any) => a.startDate.localeCompare(b.startDate))[0];
    const object = shift
      ? objs.find((o: any) => o.id === shift.objectId)?.name ?? "участок не указан"
      : objs.find((o: any) => o.id === e.objectId)?.name ?? "участок не указан";
    const daysLeft = shift
      ? Math.round((new Date(shift.startDate + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) / 86400000)
      : 0;
    const text = (customText && customText.trim())
      ? renderTemplate(customText, {
          фио: e.fio ?? "", дата: ruDate(shift?.startDate ?? ""), участок: object,
          должность: e.position ?? "", дней: String(daysLeft), контакт: s.contact,
          выезд: ruDate(shift?.endDate ?? ""),
        })
      : renderTemplate(s.template, {
          фио: e.fio ?? "", дата: ruDate(shift?.startDate ?? ""), участок: object,
          должность: e.position ?? "", дней: String(daysLeft), контакт: s.contact,
          выезд: ruDate(shift?.endDate ?? ""),
        });

    const manual = String(phoneOverrides?.[String(id)] ?? "").trim();
    const phone = manual || (e.phone ?? "");
    if (manual && savePhones && normalizePhone(manual) && manual !== e.phone) {
      storage.updateEmployee(id, { phone: manual });
    }

    const r = await sendOne(id, phone, text, channel, shift?.id ?? 0, withButtons);
    storage.createSmsLog({
      employeeId: id, shiftId: shift?.id ?? 0, phone: r.via === "max" ? "MAX" : phone, text,
      kind: r.via === "max" ? "max" : "manual",
      status: r.status, response: r.response, createdAt: new Date().toISOString(),
    });
    results.push({ employeeId: id, fio: e.fio ?? "", phone: r.via === "max" ? "MAX" : phone, ok: r.ok, response: r.response });
  }
  return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

/** Отправка на номера, введённые вручную и не привязанные к сотруднику */
export async function sendToPhones(phones: string[], text: string) {
  const results: { phone: string; ok: boolean; response: string }[] = [];
  for (const raw of phones) {
    const phone = String(raw ?? "").trim();
    if (!phone) continue;
    const r = await sendSms(phone, text);
    storage.createSmsLog({
      employeeId: 0, shiftId: 0, phone, text, kind: "manual",
      status: r.status, response: r.response, createdAt: new Date().toISOString(),
    });
    results.push({ phone, ok: r.ok, response: r.response });
  }
  return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

/** Список сотрудников для ручной рассылки: номер, ближайшая вахта, текст по шаблону */
export function smsRecipients() {
  const s = smsSettings();
  const today = todayIso();
  const objs = storage.objects();
  const allShifts = storage.shifts();
  const log = storage.smsLog();

  return storage.employees().map((e: any) => {
    const shift = allShifts
      .filter((sh: any) => sh.employeeId === e.id && sh.endDate >= today)
      .sort((a: any, b: any) => a.startDate.localeCompare(b.startDate))[0];
    const object = shift
      ? objs.find((o: any) => o.id === shift.objectId)?.name ?? ""
      : objs.find((o: any) => o.id === e.objectId)?.name ?? "";
    const last = log
      .filter((l: any) => l.employeeId === e.id && l.status === "sent")
      .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    const daysLeft = shift
      ? Math.round((new Date(shift.startDate + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) / 86400000)
      : 0;
    const text = renderTemplate(s.template, {
      фио: e.fio ?? "", дата: ruDate(shift?.startDate ?? ""), участок: object,
      должность: e.position ?? "", дней: String(daysLeft), контакт: s.contact,
      выезд: ruDate(shift?.endDate ?? ""),
    });
    return {
      employeeId: e.id, fio: e.fio, position: e.position, objectId: e.objectId, object,
      maxLinked: !!maxChatId(e.id),
      phone: e.phone ?? "", phoneOk: !!normalizePhone(e.phone ?? ""),
      shiftStart: shift?.startDate ?? "", shiftEnd: shift?.endDate ?? "",
      daysLeft: shift ? daysLeft : null,
      lastSentAt: last ? String(last.createdAt) : "",
      text, parts: smsParts(text),
    };
  }).sort((a: any, b: any) => String(a.fio).localeCompare(String(b.fio), "ru"));
}

/**
 * Ежедневная автоотправка. Проверка раз в 15 минут: если включено, час наступил
 * и сегодня ещё не отправляли — вызвать всех, у кого подходит заезд.
 */
/**
 * Кому пора отправить вызов: заезд близко, а сообщение ещё не отправляли.
 */
export function calloutReminder(): { rows: Callout[]; text: string } {
  const rows = pendingCallouts().filter((r) => !r.sentAt);
  if (rows.length === 0) return { rows, text: "" };
  const lines = rows.map((r) =>
    `• ${r.fio} — заезд ${ruDate(r.startDate)} (через ${r.daysLeft} дн.), ${r.object}`
    + (r.maxLinked ? "" : r.phoneOk ? "" : " — нет номера и бота"));
  return {
    rows,
    text: [
      `Напоминание: нужно отправить вызов на вахту — ${rows.length} чел.`,
      ...lines,
      "",
      "Откройте «Сотрудники и вахты» → «Вызов на вахту» и отправьте вызовы.",
    ].join("\n"),
  };
}

/**
 * Раз в день напоминаем ответственным, кого пора вызывать.
 *
 * Сообщения сотрудникам программа сама не отправляет: решение и отправка
 * остаются за человеком — кнопками на вкладке «Вызов на вахту».
 */
export function startSmsScheduler() {
  const tick = async () => {
    try {
      const s = smsSettings();
      if (!s.enabled) return;
      const now = new Date();
      const today = iso(now);
      if (s.lastRun === today) return;
      if (now.getHours() < s.sendHour) return;
      const { rows, text } = calloutReminder();
      saveSmsSettings({ lastRun: today });
      if (rows.length === 0) return;
      const { notifyResponsible } = await import("./max");
      await notifyResponsible(text, "decline");
      console.log(`[Напоминание] Нужно вызвать: ${rows.length} чел.`);
    } catch (e) {
      console.log(`[Напоминание] Ошибка: ${String((e as any)?.message ?? e)}`);
    }
  };
  setTimeout(tick, 30_000);
  setInterval(tick, 15 * 60_000);
}

/**
 * Текст сводки по подтверждениям для отправки в MAX.
 *
 * Показывает ближайшие заезды и три группы: кто подтвердил кнопкой,
 * кто отказался и от кого ответа пока нет.
 */
export function calloutDigestText(days?: number): string {
  const rows = pendingCallouts(days ?? Math.max(smsSettings().daysBefore, 14));
  if (rows.length === 0) return "Заездов в ближайшие дни нет.";

  const ok = rows.filter((r) => r.answer === "confirm");
  const no = rows.filter((r) => r.answer === "decline");
  const wait = rows.filter((r) => !r.answer);
  const line = (r: any) => `• ${r.fio} — ${ruDate(r.startDate)}, ${r.object}`;

  const parts = [
    `Подтверждение заезда на ${ruDate(todayIso())}`,
    `Всего заездов: ${rows.length}. Подтвердили: ${ok.length}, отказались: ${no.length}, без ответа: ${wait.length}.`,
  ];
  if (ok.length) parts.push("", `Подтвердили (${ok.length}):`, ...ok.map(line));
  if (no.length) parts.push("", `Не смогут приехать (${no.length}):`, ...no.map(line));
  if (wait.length) {
    parts.push("", `Ответа нет (${wait.length}):`, ...wait.map((r: any) =>
      `${line(r)}${r.sentAt ? "" : " — вызов не отправляли"}`));
  }
  parts.push("", "Напишите «статус», чтобы получить сводку в любой момент.");
  return parts.join("\n");
}

/** Отправить сводку выбранным получателям в MAX */
export async function sendMaxDigest(chatIds?: string[]) {
  const s = maxSettings();
  const targets = (chatIds ?? String(s.reportChatIds ?? "").split(","))
    .map((x) => String(x).trim())
    .filter(Boolean);
  if (targets.length === 0) throw new Error("Не выбрано, кому присылать сводку");
  const text = calloutDigestText();
  const results: any[] = [];
  for (const chatId of targets) {
    const r = await sendMax(chatId, text);
    results.push({ chatId, ok: r.ok, response: r.response });
    // MAX принимает не более двух сообщений в секунду в один чат
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return { sent: results.filter((r) => r.ok).length, results, text };
}

/** Раз в час проверяем, не пора ли отправить сводку по подтверждениям */
export function startMaxDigestScheduler() {
  const tick = async () => {
    try {
      const s = maxSettings();
      if (!s.enabled || !s.reportEnabled || !s.reportChatIds) return;
      const now = new Date();
      const today = todayIso();
      if (s.reportLastDate === today) return;
      if (now.getHours() < Number(s.reportHour ?? 18)) return;
      await sendMaxDigest();
      saveMaxSettings({ reportLastDate: today });
      console.log("[MAX] Сводка по подтверждениям отправлена");
    } catch (e) {
      // не смогли отправить — попробуем на следующем часе
    }
  };
  setTimeout(tick, 90_000);
  setInterval(tick, 30 * 60_000);
}
