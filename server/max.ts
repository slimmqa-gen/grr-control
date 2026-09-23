/**
 * Уведомления через бота MAX.
 *
 * Сообщения в MAX бесплатные, но написать первым по номеру телефона нельзя:
 * сотрудник один раз открывает бота по персональной ссылке, после чего его
 * профиль привязывается к карточке и дальше вызовы уходят автоматически.
 *
 * Бот создаётся на верифицированном профиле организации, ИП или самозанятого
 * на платформе MAX для партнёров; токен берётся в разделе «Чат-боты».
 */
import { storage } from "./storage";
import { DEFAULT_MAX_SETTINGS, type MaxSettings } from "@shared/schema";

const API = "https://platform-api2.max.ru";

export function maxSettings(): MaxSettings {
  const raw = storage.getSetting("max");
  if (!raw) return { ...DEFAULT_MAX_SETTINGS };
  try {
    return { ...DEFAULT_MAX_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_MAX_SETTINGS };
  }
}

export function saveMaxSettings(patch: Partial<MaxSettings>): MaxSettings {
  const next: MaxSettings = { ...maxSettings(), ...patch };
  storage.setSetting("max", JSON.stringify(next));
  return next;
}

/** Настройки для интерфейса: токен не отдаём, только признак «задан» */
export function publicMaxSettings() {
  const s = maxSettings();
  const { token, ...rest } = s;
  return { ...rest, hasToken: !!token };
}

async function maxRequest(path: string, init?: RequestInit) {
  const s = maxSettings();
  if (!s.token) throw new Error("Не задан токен бота MAX");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: s.token,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.text();
  let data: any = null;
  try { data = JSON.parse(body); } catch { data = { raw: body.slice(0, 300) }; }
  if (!res.ok) {
    const hint = res.status === 401 ? " — проверьте токен бота" : "";
    throw new Error(`MAX ответил ${res.status}: ${data?.message ?? data?.raw ?? "ошибка"}${hint}`);
  }
  return data;
}

/** Проверка токена: кто мы для MAX */
export async function maxBotInfo() {
  const me = await maxRequest("/me");
  return { name: me?.name ?? "", username: me?.username ?? "", userId: me?.user_id ?? 0 };
}

const randomCode = () => Math.random().toString(36).slice(2, 8);

/** Персональный код и ссылка-приглашение для сотрудника */
export function inviteFor(employeeId: number) {
  const s = maxSettings();
  const links = storage.notifyLinks();
  let row: any = links.find((l: any) => l.employeeId === employeeId && l.channel === "max");
  if (!row) {
    row = storage.createNotifyLink({
      employeeId, channel: "max", chatId: "", name: "",
      code: `e${employeeId}-${randomCode()}`, linkedAt: "",
    });
  }
  const bot = String(s.botName ?? "").replace(/^@/, "");
  return {
    employeeId,
    code: row.code,
    chatId: row.chatId,
    linked: !!row.chatId,
    name: row.name,
    linkedAt: row.linkedAt,
    link: bot ? `https://max.ru/${bot}?start=${encodeURIComponent(row.code)}` : "",
  };
}

/** Кто уже привязал MAX */
export function maxLinks() {
  const emps = storage.employees();
  return storage.notifyLinks()
    .filter((l: any) => l.channel === "max")
    .map((l: any) => ({
      ...l,
      fio: emps.find((e: any) => e.id === l.employeeId)?.fio ?? "сотрудник удалён",
    }));
}

export function unlinkMax(employeeId: number) {
  const row = storage.notifyLinks().find((l: any) => l.employeeId === employeeId && l.channel === "max");
  if (row) storage.deleteNotifyLink(row.id);
  return { ok: true };
}

/** Есть ли у сотрудника рабочая привязка к MAX */
export function maxChatId(employeeId: number): string {
  const row = storage.notifyLinks().find((l: any) => l.employeeId === employeeId && l.channel === "max");
  return row?.chatId ? String(row.chatId) : "";
}

/** Отправка сообщения в MAX конкретному человеку */
export async function sendMax(chatId: string, text: string) {
  try {
    await maxRequest(`/messages?user_id=${encodeURIComponent(chatId)}`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    return { ok: true, status: "sent", response: "доставлено боту MAX" };
  } catch (e: any) {
    return { ok: false, status: "error", response: String(e?.message ?? e) };
  }
}

/**
 * Опрос событий: находим тех, кто открыл бота по персональной ссылке,
 * и привязываем их профиль к карточке сотрудника.
 */
export async function pollMaxUpdates() {
  const s = maxSettings();
  if (!s.token) return { linked: 0, seen: 0 };
  const query = new URLSearchParams({ limit: "100", timeout: "0" });
  if (s.marker) query.set("marker", String(s.marker));
  const data = await maxRequest(`/updates?${query.toString()}`);
  const updates: any[] = Array.isArray(data?.updates) ? data.updates : [];
  let linked = 0;

  for (const u of updates) {
    const type = String(u?.update_type ?? u?.type ?? "");
    // код приходит либо в payload события запуска, либо текстом «/start код»
    const payload = String(u?.payload ?? u?.message?.body?.text ?? "").trim();
    const code = payload.replace(/^\/start\s*/i, "").trim();
    const user = u?.user ?? u?.message?.sender ?? null;
    const chatId = String(u?.user_id ?? user?.user_id ?? u?.chat_id ?? "");
    if (!code || !chatId) continue;
    if (!["bot_started", "message_created"].includes(type) && type) continue;

    const row = storage.notifyLinks().find((l: any) => l.channel === "max" && l.code === code);
    if (!row) continue;
    storage.updateNotifyLink(row.id, {
      chatId,
      name: String(user?.name ?? user?.first_name ?? ""),
      linkedAt: new Date().toISOString(),
    });
    linked++;
  }

  if (data?.marker) saveMaxSettings({ marker: Number(data.marker) });
  return { linked, seen: updates.length };
}

/** Раз в минуту проверяем, кто открыл бота, — привязки появляются сами */
export function startMaxPolling() {
  const tick = async () => {
    try {
      const s = maxSettings();
      if (!s.enabled || !s.token) return;
      const out = await pollMaxUpdates();
      if (out.linked) console.log(`[MAX] Привязано сотрудников: ${out.linked}`);
    } catch (e) {
      // сеть или токен — молча ждём следующего цикла, ошибку покажем в интерфейсе по кнопке проверки
    }
  };
  setTimeout(tick, 45_000);
  setInterval(tick, 60_000);
}
