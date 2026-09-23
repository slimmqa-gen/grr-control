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
import { randomBytes } from "node:crypto";
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
  const { token, webhookSecret, ...rest } = s;
  return { ...rest, hasToken: !!token, hasWebhookSecret: !!webhookSecret };
}

async function maxRequest(path: string, init?: RequestInit) {
  const s = maxSettings();
  if (!s.token) throw new Error("Не задан токен бота MAX");
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: s.token,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (e: any) {
    // сертификат MAX выпущен удостоверяющим центром Минцифры, которого нет
    // в наборе по умолчанию: без него соединение обрывается на проверке сертификата
    const code = String(e?.cause?.code ?? "");
    if (/CERT|SELF_SIGNED|ISSUER/i.test(code)) {
      throw new Error(
        "Нет сертификата Минцифры, поэтому соединение с MAX не устанавливается. "
        + "Запустите на сервере: sudo bash deploy/install-russian-certs.sh",
      );
    }
    throw new Error(`MAX недоступен: ${String(e?.message ?? e)}${code ? ` (${code})` : ""}`);
  }
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

/**
 * Отправка сообщения в MAX. Если передан номер вахты, под текстом появляются
 * кнопки «Подтверждаю» и «Не смогу» — ответ придёт в программу.
 */
export async function sendMax(chatId: string, text: string, shiftId = 0) {
  try {
    const body: any = { text };
    if (shiftId) {
      body.attachments = [{
        type: "inline_keyboard",
        payload: {
          buttons: [[
            { type: "callback", text: "Подтверждаю", payload: `confirm:${shiftId}` },
            { type: "callback", text: "Не смогу", payload: `decline:${shiftId}` },
          ]],
        },
      }];
    }
    await maxRequest(`/messages?user_id=${encodeURIComponent(chatId)}`, {
      method: "POST",
      body: JSON.stringify(body),
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
/**
 * Обработка одного события MAX: приходит либо из опроса, либо из webhook.
 * Возвращает, что именно распознано, чтобы вызывающий мог посчитать итоги.
 */
export async function handleMaxUpdate(u: any): Promise<{ linked: number; replies: number }> {
  let linked = 0;
  let replies = 0;

  const type = String(u?.update_type ?? u?.type ?? "");
  // поля у разных событий лежат по-разному, поэтому проверяем несколько мест
  const user = u?.user ?? u?.callback?.user ?? u?.message?.sender ?? null;
  const chatId = String(
    user?.user_id ?? u?.user_id ?? u?.message?.recipient?.user_id ?? u?.chat_id ?? "",
  );
  const userName = String(user?.name ?? user?.first_name ?? "");
  const text = String(u?.message?.body?.text ?? u?.message?.text ?? "").trim();
  const startPayload = String(u?.payload ?? "").trim();
  const callbackPayload = String(u?.callback?.payload ?? "").trim();
  const callbackId = String(u?.callback?.callback_id ?? "");
  const link = chatId
    ? storage.notifyLinks().find((l: any) => l.channel === "max" && String(l.chatId) === chatId)
    : null;
  const employeeId = link?.employeeId ?? 0;

  // 1. нажата кнопка подтверждения вахты
  if (callbackPayload) {
    const [action, shiftRaw] = callbackPayload.split(":");
    const shiftId = Number(shiftRaw) || 0;
    if (["confirm", "decline"].includes(action)) {
      storage.createMaxInbox({
        employeeId, shiftId, chatId, userName,
        text: action === "confirm" ? "Подтверждаю заезд" : "Не смогу приехать",
        kind: action, createdAt: new Date().toISOString(),
      });
      replies++;
      if (callbackId) {
        try {
          await maxRequest(`/answers?callback_id=${encodeURIComponent(callbackId)}`, {
            method: "POST",
            body: JSON.stringify({
              message: {
                text: action === "confirm"
                  ? "Спасибо, ответ записан: вы подтвердили заезд."
                  : "Ответ записан: вы не сможете приехать. С вами свяжется мастер.",
              },
            }),
          });
        } catch {
          // ответ на кнопку не критичен — сам ответ уже сохранён
        }
      }
      return { linked, replies };
    }
  }

  // 2. переход по персональной ссылке или сообщение с кодом привязки
  const code = (startPayload || text).replace(/^\/start\s*/i, "").trim();
  const codeRow = code
    ? storage.notifyLinks().find((l: any) => l.channel === "max" && l.code === code)
    : null;
  if (codeRow && chatId) {
    storage.updateNotifyLink(codeRow.id, {
      chatId, name: userName, linkedAt: new Date().toISOString(),
    });
    linked++;
    try {
      await maxRequest(`/messages?user_id=${encodeURIComponent(chatId)}`, {
        method: "POST",
        body: JSON.stringify({
          text: "Готово: уведомления о вахте будут приходить сюда. Отвечать можно прямо в этом чате.",
        }),
      });
    } catch {
      // приветствие не критично
    }
    return { linked, replies };
  }

  // 3. запрос сводки: доступен только тем, кому разрешена рассылка сводок
  if (/^\/?(статус|сводка|status)$/i.test(text)) {
    const allowed = String(maxSettings().reportChatIds ?? "")
      .split(",").map((x) => x.trim()).filter(Boolean);
    if (chatId && allowed.includes(chatId)) {
      try {
        const { calloutDigestText } = await import("./sms");
        await sendMax(chatId, calloutDigestText());
      } catch (e) {
        await sendMax(chatId, `Сводку собрать не удалось: ${String((e as Error)?.message ?? e)}`);
      }
    } else if (chatId) {
      await sendMax(chatId, "Сводка доступна только руководителям. Обратитесь в отдел кадров.");
    }
    return { linked, replies };
  }

  // 4. обычный ответ сотрудника
  if (text && type !== "bot_started") {
    storage.createMaxInbox({
      employeeId, shiftId: 0, chatId, userName, text,
      kind: "reply", createdAt: new Date().toISOString(),
    });
    replies++;
  }
  return { linked, replies };
}

export async function pollMaxUpdates() {
  const s = maxSettings();
  if (!s.token) return { linked: 0, seen: 0 };
  const query = new URLSearchParams({ limit: "100", timeout: "0" });
  if (s.marker) query.set("marker", String(s.marker));
  const data = await maxRequest(`/updates?${query.toString()}`);
  const updates: any[] = Array.isArray(data?.updates) ? data.updates : [];
  let linked = 0;

  let replies = 0;

  for (const u of updates) {
    const out = await handleMaxUpdate(u);
    linked += out.linked;
    replies += out.replies;
  }

  if (data?.marker) saveMaxSettings({ marker: Number(data.marker) });
  return { linked, replies, seen: updates.length };
}

/** Раз в минуту проверяем, кто открыл бота, — привязки появляются сами */
export function startMaxPolling() {
  const tick = async () => {
    try {
      const s = maxSettings();
      if (!s.enabled || !s.token) return;
      // при активной подписке MAX не отдаёт события через опрос
      if (s.mode === "webhook") return;
      const out = await pollMaxUpdates();
      if (out.linked || out.replies) {
        console.log(`[MAX] Привязок: ${out.linked}, ответов: ${out.replies}`);
      }
    } catch (e) {
      // сеть или токен — молча ждём следующего цикла, ошибку покажем в интерфейсе по кнопке проверки
    }
  };
  setTimeout(tick, 45_000);
  setInterval(tick, 60_000);
}

/** Ответы сотрудников: что пришло из MAX */
export function maxInboxRows(limit = 200) {
  const emps = storage.employees();
  return storage.maxInbox()
    .map((r: any) => ({
      ...r,
      fio: emps.find((e: any) => e.id === r.employeeId)?.fio ?? (r.userName || "неизвестный профиль"),
      position: emps.find((e: any) => e.id === r.employeeId)?.position ?? "",
    }))
    .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

/** Ответить сотруднику из программы */
export async function replyInMax(employeeId: number, text: string) {
  const chatId = maxChatId(employeeId);
  if (!chatId) throw new Error("Сотрудник не привязал бота MAX");
  const r = await sendMax(chatId, text);
  if (!r.ok) throw new Error(r.response);
  storage.createMaxInbox({
    employeeId, shiftId: 0, chatId, userName: "", text,
    kind: "outgoing", createdAt: new Date().toISOString(),
  });
  return { ok: true };
}

/** Последний ответ сотрудника по вахте: подтвердил или отказался */
export function confirmStateByShift() {
  const map: Record<number, string> = {};
  for (const r of storage.maxInbox().sort((a: any, b: any) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
    if (r.shiftId && ["confirm", "decline"].includes(String(r.kind))) map[r.shiftId] = String(r.kind);
  }
  return map;
}

/** Типы событий, которые нужны программе */
const WEBHOOK_EVENTS = ["message_created", "message_callback", "bot_started", "bot_added"];

/**
 * Включить получение событий через webhook.
 *
 * MAX требует адрес на https и только порт 443, сертификат доверенного центра
 * (самоподписанный не принимается) и ответ 200 не позднее 30 секунд. Если
 * endpoint молчит 8 часов, MAX сам снимает подписку.
 */
export async function enableMaxWebhook(url: string) {
  const clean = url.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(clean)) throw new Error("Адрес должен начинаться с https://");
  if (/:\d+/.test(clean.replace(/^https:\/\//, ""))) {
    throw new Error("MAX принимает только порт 443, поэтому порт в адресе указывать нельзя");
  }
  const secret = maxSettings().webhookSecret || randomBytes(16).toString("hex");
  const out = await maxRequest("/subscriptions", {
    method: "POST",
    body: JSON.stringify({ url: clean, update_types: WEBHOOK_EVENTS, secret }),
  });
  if (out && out.success === false) throw new Error(String(out.message ?? "MAX отклонил подписку"));
  saveMaxSettings({
    mode: "webhook", webhookUrl: clean, webhookSecret: secret,
    webhookAt: new Date().toISOString(),
  });
  return { ok: true, url: clean };
}

/** Снять подписку и вернуться к опросу */
export async function disableMaxWebhook() {
  const s = maxSettings();
  if (s.webhookUrl) {
    try {
      await maxRequest(`/subscriptions?url=${encodeURIComponent(s.webhookUrl)}`, { method: "DELETE" });
    } catch {
      // даже если MAX не подтвердил снятие, программа возвращается к опросу
    }
  }
  saveMaxSettings({ mode: "poll", webhookAt: "" });
  return { ok: true };
}

/** Какие подписки MAX считает активными */
export async function maxWebhooks() {
  const out = await maxRequest("/subscriptions");
  const rows = Array.isArray(out?.subscriptions) ? out.subscriptions : [];
  return { rows, settings: publicMaxSettings() };
}

/** Проверка секрета из заголовка webhook-запроса */
export function webhookSecretOk(header: string | undefined) {
  const secret = maxSettings().webhookSecret;
  if (!secret) return false;
  return String(header ?? "") === secret;
}

/** Отметка времени последнего события — по ней видно, живёт ли подписка */
export function markMaxEvent() {
  saveMaxSettings({ lastEventAt: new Date().toISOString() });
}
