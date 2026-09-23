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

// адрес API MAX; переменная окружения нужна только для отладки на стенде
const API = process.env.MAX_API_URL || "https://platform-api2.max.ru";

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
export async function sendMax(chatId: string, text: string, shiftId = 0, withButtons = false) {
  try {
    const body: any = { text };
    if (shiftId || withButtons) {
      body.attachments = [{
        type: "inline_keyboard",
        payload: {
          buttons: [[
            { type: "callback", text: "Подтверждаю", payload: `confirm:${shiftId}`, intent: "positive" },
            { type: "callback", text: "Не смогу", payload: `decline:${shiftId}`, intent: "negative" },
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

/** Дата в привычном виде: 2026-09-24 → 24.09.2026 */
const ruDate = (s: string) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : "");

/** Варианты ответа события: для подтверждения — стандартные две кнопки */
export function eventOptions(ev: any): { text: string; verdict: "yes" | "no" | "choice" }[] {
  if (ev.kind === "confirm") {
    return [
      { text: "Подтверждаю", verdict: "yes" },
      { text: "Не смогу", verdict: "no" },
    ];
  }
  if (ev.kind === "poll") {
    let list: string[] = [];
    try { list = JSON.parse(ev.options || "[]"); } catch { list = []; }
    return list.filter((x) => String(x).trim()).map((x) => ({ text: String(x).trim(), verdict: "choice" as const }));
  }
  return [];
}

/** Текст события для сотрудника */
function eventText(ev: any) {
  const head = ev.title ? `${ev.title}` : "Сообщение от ПБК";
  const when = ev.eventDate ? `\nДата: ${ruDate(ev.eventDate)}` : "";
  return `${head}${when}\n\n${ev.text}`;
}

/** Отправка события или опроса одному сотруднику */
export async function sendEventTo(ev: any, chatId: string, employeeId: number) {
  const opts = eventOptions(ev);
  const body: any = { text: eventText(ev) };
  if (opts.length) {
    body.attachments = [{
      type: "inline_keyboard",
      payload: {
        // по одной кнопке в ряд: варианты опроса бывают длинными
        buttons: opts.map((o, i) => [{
          type: "callback",
          text: o.text,
          payload: `ev:${ev.id}:${i}`,
          ...(o.verdict === "yes" ? { intent: "positive" } : {}),
          ...(o.verdict === "no" ? { intent: "negative" } : {}),
        }]),
      },
    }];
  }
  try {
    await maxRequest(`/messages?user_id=${encodeURIComponent(chatId)}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const prev = storage.maxEventAnswerFor(ev.id, employeeId);
    if (prev) {
      storage.updateMaxEventAnswer(prev.id, { sentAt: new Date().toISOString(), chatId });
    } else {
      storage.createMaxEventAnswer({
        eventId: ev.id, employeeId, chatId,
        answer: "", verdict: "", reason: "",
        sentAt: new Date().toISOString(), answeredAt: "",
      });
    }
    return { ok: true, status: "sent", response: "доставлено боту MAX" };
  } catch (e: any) {
    return { ok: false, status: "error", response: String(e?.message ?? e) };
  }
}

/** Рассылка события выбранным сотрудникам (только привязанным к боту) */
export async function sendEventToEmployees(eventId: number, employeeIds: number[]) {
  const ev = storage.maxEvent(eventId);
  if (!ev) return { sent: 0, errors: ["Событие не найдено"] };
  const links = storage.notifyLinks();
  let sent = 0;
  const errors: string[] = [];
  for (const [i, id] of employeeIds.entries()) {
    const link = links.find((l: any) => l.employeeId === id && l.channel === "max" && l.chatId);
    const fio = storage.employees().find((e: any) => e.id === id)?.fio ?? `#${id}`;
    if (!link) { errors.push(`${fio}: нет привязки к боту MAX`); continue; }
    if (i > 0) await new Promise((r) => setTimeout(r, 600));
    const res = await sendEventTo(ev, String(link.chatId), id);
    if (res.ok) sent++;
    else errors.push(`${fio}: ${res.response}`);
  }
  return { sent, errors };
}

/** Итоги по событию: кто как ответил */
export function eventResults(eventId: number) {
  const ev = storage.maxEvent(eventId);
  if (!ev) return null;
  const answers = storage.maxEventAnswers(eventId);
  const emp = storage.employees();
  const rows = answers.map((a: any) => ({
    ...a,
    fio: emp.find((e: any) => e.id === a.employeeId)?.fio ?? `#${a.employeeId}`,
    position: emp.find((e: any) => e.id === a.employeeId)?.position ?? "",
  })).sort((x: any, y: any) => x.fio.localeCompare(y.fio, "ru"));
  const counts: Record<string, number> = {};
  for (const a of answers) if (a.answer) counts[a.answer] = (counts[a.answer] ?? 0) + 1;
  return {
    event: { ...ev, optionList: eventOptions(ev).map((o) => o.text) },
    rows,
    total: rows.length,
    answered: rows.filter((r: any) => r.answer).length,
    waiting: rows.filter((r: any) => !r.answer).length,
    counts,
  };
}

/** Короткая сводка по событию для ответственных */
export function eventDigestText(eventId: number) {
  const res = eventResults(eventId);
  if (!res) return "Событие не найдено.";
  const lines = [`${res.event.title || "Событие"}: ответили ${res.answered} из ${res.total}.`];
  for (const [opt, n] of Object.entries(res.counts)) lines.push(`• ${opt} — ${n}`);
  const waiting = res.rows.filter((r: any) => !r.answer).map((r: any) => r.fio);
  if (waiting.length) lines.push("", `Без ответа (${waiting.length}): ${waiting.join(", ")}`);
  const reasons = res.rows.filter((r: any) => r.reason);
  if (reasons.length) {
    lines.push("", "Причины:");
    for (const r of reasons) lines.push(`• ${r.fio} — ${r.reason}`);
  }
  return lines.join("\n");
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

    // ответ на событие или опрос: payload вида ev:<id>:<номер варианта>
    if (action === "ev") {
      const parts = callbackPayload.split(":");
      const evId = Number(parts[1]) || 0;
      const optIdx = Number(parts[2]) || 0;
      const ev = evId ? storage.maxEvent(evId) : null;
      const opts = ev ? eventOptions(ev) : [];
      const chosen = opts[optIdx];

      if (!ev || !chosen) {
        if (callbackId) {
          try {
            await maxRequest(`/answers?callback_id=${encodeURIComponent(callbackId)}`, {
              method: "POST",
              body: JSON.stringify({ notification: "Событие не найдено", message: { text: "Это событие больше недоступно." } }),
            });
          } catch { /* не критично */ }
        }
        return { linked, replies };
      }

      if (ev.closed) {
        if (callbackId) {
          try {
            await maxRequest(`/answers?callback_id=${encodeURIComponent(callbackId)}`, {
              method: "POST",
              body: JSON.stringify({ notification: "Опрос закрыт", message: { text: "Ответы по этому событию больше не принимаются." } }),
            });
          } catch { /* не критично */ }
        }
        return { linked, replies };
      }

      const now = new Date().toISOString();
      const prev = employeeId ? storage.maxEventAnswerFor(evId, employeeId) : null;
      if (prev) {
        storage.updateMaxEventAnswer(prev.id, {
          answer: chosen.text, verdict: chosen.verdict, answeredAt: now, chatId, reason: "",
        });
      } else {
        storage.createMaxEventAnswer({
          eventId: evId, employeeId, chatId,
          answer: chosen.text, verdict: chosen.verdict, reason: "",
          sentAt: "", answeredAt: now,
        });
      }
      replies++;

      // при отрицательном ответе спрашиваем причину следующим сообщением
      const askReason = chosen.verdict === "no" && Number(ev.askReason) === 1;
      if (link) storage.updateNotifyLink(link.id, { awaitingEvent: askReason ? evId : 0 });

      // отклик человеку сразу, рассылка ответственным — после
      if (callbackId) {
        try {
          await maxRequest(`/answers?callback_id=${encodeURIComponent(callbackId)}`, {
            method: "POST",
            body: JSON.stringify({
              notification: `Ответ записан: ${chosen.text}`,
              message: {
                text: askReason
                  ? `Ответ записан: «${chosen.text}». Напишите, пожалуйста, причину одним сообщением — передам руководителю.`
                  : `Спасибо, ответ записан: «${chosen.text}».`,
              },
            }),
          });
        } catch { /* ответ на кнопку не критичен */ }
      }

      const who = employeeName(employeeId, userName);
      const kindForNotify = chosen.verdict === "no" ? "decline" : chosen.verdict === "yes" ? "confirm" : "message";
      void notifyResponsible(
        `${ev.title || "Событие"} — ответ ${who}: ${chosen.text}`,
        kindForNotify as "decline" | "confirm" | "message",
        chatId,
        employeeId,
      );
      return { linked, replies };
    }

    // ответственный нажал «Ответить» под оповещением
    if (action === "reply") {
      const target = shiftId;
      const allowed = String(maxSettings().reportChatIds ?? "")
        .split(",").map((x) => x.trim()).filter(Boolean);
      if (link && target && allowed.includes(chatId)) {
        storage.updateNotifyLink(link.id, { replyTo: target });
        const e = storage.employees().find((x: any) => x.id === target);
        if (callbackId) {
          try {
            await maxRequest(`/answers?callback_id=${encodeURIComponent(callbackId)}`, {
              method: "POST",
              body: JSON.stringify({
                notification: "Напишите ответ сообщением",
                message: { text: `Напишите ответ для ${e?.fio ?? "сотрудника"} одним сообщением.` },
              }),
            });
          } catch {
            // если ответ на нажатие не прошёл, пишем обычным сообщением
            try {
              await sendMax(chatId, `Напишите ответ для ${e?.fio ?? "сотрудника"} одним сообщением.`);
            } catch {
              // подсказка не критична
            }
          }
        }
      }
      return { linked, replies };
    }

    if (["confirm", "decline"].includes(action)) {
      storage.createMaxInbox({
        employeeId, shiftId, chatId, userName,
        text: action === "confirm" ? "Подтверждаю заезд" : "Не смогу приехать",
        kind: action, createdAt: new Date().toISOString(),
      });
      replies++;
      // при отказе просим причину следующим сообщением
      if (action === "decline" && link) {
        storage.updateNotifyLink(link.id, { awaitingShift: shiftId });
      }

      // человек должен увидеть отклик сразу, поэтому отвечаем на нажатие
      // первым делом, а рассылку ответственным отправляем уже после
      if (callbackId) {
        try {
          await maxRequest(`/answers?callback_id=${encodeURIComponent(callbackId)}`, {
            method: "POST",
            body: JSON.stringify({
              notification: action === "confirm" ? "Заезд подтверждён" : "Ответ записан",
              message: {
                text: action === "confirm"
                  ? "Спасибо, ответ записан: вы подтвердили заезд."
                  : "Ответ записан. Напишите, пожалуйста, причину одним сообщением — передам руководителю.",
              },
            }),
          });
        } catch {
          // ответ на кнопку не критичен — сам ответ уже сохранён
        }
      }

      // оповещения ответственным не задерживают отклик кнопки
      const summary = action === "confirm"
        ? `Заезд подтверждён: ${employeeName(employeeId, userName)}.`
        : `Отказ от заезда: ${employeeName(employeeId, userName)}. Спросил причину, пришлю, как ответит.`;
      void notifyResponsible(summary, action === "confirm" ? "confirm" : "decline");
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

  // 3. ответственный отвечает сотруднику из MAX: следующее сообщение — это ответ
  if (text && link && Number(link.replyTo) > 0) {
    const target = Number(link.replyTo);
    storage.updateNotifyLink(link.id, { replyTo: 0 });
    try {
      await replyInMax(target, text);
      const e = storage.employees().find((x: any) => x.id === target);
      await sendMax(chatId, `Отправлено: ${e?.fio ?? "сотруднику"}.`);
    } catch (e) {
      await sendMax(chatId, `Не удалось отправить: ${String((e as Error)?.message ?? e)}`);
    }
    return { linked, replies };
  }

  // 4. причина отказа по событию или опросу
  if (text && link && Number(link.awaitingEvent) > 0) {
    const evId = Number(link.awaitingEvent);
    storage.updateNotifyLink(link.id, { awaitingEvent: 0 });
    const ev = storage.maxEvent(evId);
    const prev = employeeId ? storage.maxEventAnswerFor(evId, employeeId) : null;
    if (prev) storage.updateMaxEventAnswer(prev.id, { reason: text });
    storage.createMaxInbox({
      employeeId, shiftId: 0, chatId, userName, text,
      kind: "reason", createdAt: new Date().toISOString(),
    });
    replies++;
    try {
      await sendMax(chatId, "Принято, передал руководителю.");
    } catch { /* подтверждение не критично */ }
    void notifyResponsible(
      `${ev?.title || "Событие"} — причина. ${employeeName(employeeId, userName)}: ${text}`,
      "decline", chatId, employeeId,
    );
    return { linked, replies };
  }

  // 5. причина отказа от заезда: человек уже нажал «Не смогу», ждём пояснение текстом
  if (text && link && Number(link.awaitingShift) > 0) {
    const shiftId = Number(link.awaitingShift);
    storage.createMaxInbox({
      employeeId, shiftId, chatId, userName, text,
      kind: "reason", createdAt: new Date().toISOString(),
    });
    storage.updateNotifyLink(link.id, { awaitingShift: 0 });
    replies++;
    try {
      await sendMax(chatId, "Причина записана, передал руководителю. Если планы изменятся — напишите здесь.");
    } catch {
      // подтверждение приёма не критично
    }
    void notifyResponsible(
      `Причина отказа. ${employeeName(employeeId, userName)}: ${text}`,
      "decline", "", employeeId,
    );
    return { linked, replies };
  }

  // 6. запрос сводки: доступен только тем, кому разрешена рассылка сводок
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

  // 7. обычный ответ сотрудника — попадёт в переписку
  if (text && type !== "bot_started") {
    storage.createMaxInbox({
      employeeId, shiftId: 0, chatId, userName, text,
      kind: "reply", createdAt: new Date().toISOString(),
    });
    replies++;
    void notifyResponsible(
      `Новое сообщение от ${employeeName(employeeId, userName)}: ${text}`,
      "message", chatId, employeeId,
    );
  }
  return { linked, replies };
}

export async function pollMaxUpdates(waitSeconds = 0) {
  const s = maxSettings();
  if (!s.token) return { linked: 0, replies: 0, seen: 0 };
  // timeout > 0 — запрос ждёт события на стороне MAX и возвращается сразу,
  // как только что-то произошло: отклик почти мгновенный
  const query = new URLSearchParams({ limit: "100", timeout: String(waitSeconds) });
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
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const loop = async () => {
    // бесконечный цикл ожидания событий: пока событий нет, запрос «висит»
    // на стороне MAX, поэтому реакция на кнопки приходит за секунды
    for (;;) {
      const s = maxSettings();
      if (!s.enabled || !s.token || s.mode === "webhook") {
        await sleep(30_000);
        continue;
      }
      const startedAt = Date.now();
      try {
        const out = await pollMaxUpdates(25);
        if (out.linked || out.replies) {
          console.log(`[MAX] Привязок: ${out.linked}, ответов: ${out.replies}`);
        }
        // страховка от «пустой карусели»: если ответ пришёл мгновенно и событий
        // не было, выдерживаем паузу, чтобы не бомбить API запросами
        const spent = Date.now() - startedAt;
        if (out.seen === 0 && spent < 2_000) await sleep(2_000 - spent);
      } catch {
        // сеть или токен — подождём и попробуем снова; ошибку покажет кнопка проверки
        await sleep(15_000);
      }
    }
  };

  setTimeout(() => { void loop(); }, 10_000);
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

/** ФИО из карточки, если человек привязан, иначе имя профиля MAX */
function employeeName(employeeId: number, fallback: string) {
  const e = storage.employees().find((x: any) => x.id === employeeId);
  const fio = e?.fio ? String(e.fio) : "";
  const position = e?.position ? `, ${e.position}` : "";
  return fio ? `${fio}${position}` : (fallback || "неизвестный профиль");
}

/**
 * Оповестить ответственных: сообщение в MAX и, если включено, СМС на их номера.
 * `exceptChatId` не даёт отправить человеку его же сообщение, когда он сам
 * отмечен ответственным.
 */
export async function notifyResponsible(
  text: string,
  kind: "decline" | "message" | "confirm" = "decline",
  exceptChatId = "",
  /** сотрудник, которому ответственный сможет ответить кнопкой прямо из MAX */
  replyEmployeeId = 0,
) {
  const s = maxSettings();
  const allow = kind === "message" ? s.notifyMessage
    : kind === "confirm" ? s.notifyConfirm
    : s.notifyDecline;
  if (!allow) return { sent: 0 };
  const targets = String(s.reportChatIds ?? "").split(",").map((x) => x.trim())
    .filter((x) => x && x !== exceptChatId);
  let sent = 0;
  for (const [i, chatId] of targets.entries()) {
    // MAX принимает не более двух сообщений в секунду в один чат,
    // поэтому пауза нужна только между отправками
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 600));
    try {
      const r = replyEmployeeId
        ? await sendMaxWithReply(chatId, text, replyEmployeeId)
        : await sendMax(chatId, text);
      if (r.ok) sent++;
    } catch {
      // не дошло в MAX — ниже может уйти СМС
    }
  }
  if (s.duplicateSms) {
    try {
      const { sendSms } = await import("./sms");
      const links = storage.notifyLinks().filter((l: any) =>
        l.channel === "max" && targets.includes(String(l.chatId)));
      for (const l of links) {
        const phone = storage.employees().find((e: any) => e.id === l.employeeId)?.phone ?? "";
        if (phone) await sendSms(phone, text.slice(0, 300));
      }
    } catch {
      // СМС — резерв, ошибку не поднимаем
    }
  }
  return { sent };
}

/** Оповещение с кнопкой «Ответить», чтобы ответить сотруднику прямо из MAX */
async function sendMaxWithReply(chatId: string, text: string, employeeId: number) {
  try {
    await maxRequest(`/messages?user_id=${encodeURIComponent(chatId)}`, {
      method: "POST",
      body: JSON.stringify({
        text,
        attachments: [{
          type: "inline_keyboard",
          payload: {
            buttons: [[
              { type: "callback", text: "Ответить", payload: `reply:${employeeId}`, intent: "positive" },
            ]],
          },
        }],
      }),
    });
    return { ok: true, status: "sent", response: "доставлено боту MAX" };
  } catch (e: any) {
    return { ok: false, status: "error", response: String(e?.message ?? e) };
  }
}

/** Переписка: список диалогов с последним сообщением и числом непрочитанных */
export function maxChats() {
  const emps = storage.employees();
  const byEmployee = new Map<number, any[]>();
  for (const r of storage.maxInbox()) {
    if (!r.employeeId) continue;
    const list = byEmployee.get(r.employeeId) ?? [];
    list.push(r);
    byEmployee.set(r.employeeId, list);
  }
  return [...byEmployee.entries()]
    .map(([employeeId, list]) => {
      const sorted = list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      const last = sorted[sorted.length - 1];
      const e = emps.find((x: any) => x.id === employeeId);
      return {
        employeeId,
        fio: e?.fio ?? "сотрудник удалён",
        position: e?.position ?? "",
        lastText: last?.text ?? "",
        lastKind: last?.kind ?? "",
        lastAt: last?.createdAt ?? "",
        unread: sorted.filter((r) => !r.seen && r.kind !== "outgoing").length,
        total: sorted.length,
      };
    })
    .sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
}

/** Переписка с одним человеком по порядку сообщений */
export function maxChat(employeeId: number) {
  const e = storage.employees().find((x: any) => x.id === employeeId);
  const messages = storage.maxInbox()
    .filter((r: any) => r.employeeId === employeeId)
    .sort((a: any, b: any) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return {
    employeeId,
    fio: e?.fio ?? "сотрудник удалён",
    position: e?.position ?? "",
    phone: e?.phone ?? "",
    linked: !!maxChatId(employeeId),
    messages,
  };
}

/** Отметить переписку прочитанной */
export function markChatSeen(employeeId: number) {
  storage.markMaxInboxSeen(employeeId);
  return { ok: true };
}
