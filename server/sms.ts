/**
 * СМС-вызов на вахту через шлюз SMSC.ru.
 *
 * Логика простая: за N дней до даты заезда сотрудник получает одно сообщение.
 * Повторно по той же вахте программа не пишет — в журнале остаётся запись.
 * Пароль и ключ хранятся в настройках на сервере и наружу не отдаются.
 */
import { storage } from "./storage";
import { DEFAULT_SMS_SETTINGS, type SmsSettings } from "@shared/schema";

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
    if (data?.error) return { ok: false, status: "error", response: `${data.error} (код ${data.error_code ?? "?"})` };
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
  if (data?.error) throw new Error(`${data.error} (код ${data.error_code ?? "?"})`);
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
      const sent = log.find((l: any) => l.shiftId === sh.id && l.kind === "callout" && l.status === "sent");
      return {
        shiftId: sh.id, employeeId: sh.employeeId,
        fio: e?.fio ?? "сотрудник удалён", position: e?.position ?? "",
        phone: e?.phone ?? "", phoneOk: !!normalizePhone(e?.phone ?? ""),
        object, startDate: sh.startDate, endDate: sh.endDate, daysLeft,
        text, parts: smsParts(text),
        sentAt: sent ? String(sent.createdAt) : "",
      };
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.fio.localeCompare(b.fio, "ru"));
}

/** Отправка вызовов: только тем, кому ещё не отправляли и у кого есть номер */
export async function runCallouts(shiftIds?: number[]) {
  const list = pendingCallouts().filter((c) =>
    (!shiftIds || shiftIds.includes(c.shiftId)) && !c.sentAt && c.phoneOk);
  const results: { fio: string; phone: string; ok: boolean; response: string }[] = [];
  for (const c of list) {
    const r = await sendSms(c.phone, c.text);
    storage.createSmsLog({
      employeeId: c.employeeId, shiftId: c.shiftId, phone: c.phone, text: c.text,
      kind: "callout", status: r.status, response: r.response, createdAt: new Date().toISOString(),
    });
    results.push({ fio: c.fio, phone: c.phone, ok: r.ok, response: r.response });
  }
  const skipped = pendingCallouts().filter((c) => !c.phoneOk && !c.sentAt).length;
  return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, skipped, results };
}

/**
 * Ежедневная автоотправка. Проверка раз в 15 минут: если включено, час наступил
 * и сегодня ещё не отправляли — вызвать всех, у кого подходит заезд.
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
      const res = await runCallouts();
      saveSmsSettings({ lastRun: today });
      if (res.sent || res.failed) {
        console.log(`[СМС] Вызовы на вахту: отправлено ${res.sent}, с ошибкой ${res.failed}, без номера ${res.skipped}`);
      }
    } catch (e) {
      console.log(`[СМС] Ошибка автоотправки: ${String((e as any)?.message ?? e)}`);
    }
  };
  setTimeout(tick, 30_000);
  setInterval(tick, 15 * 60_000);
}
