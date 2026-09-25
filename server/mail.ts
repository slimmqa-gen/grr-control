/**
 * Сбор сводок с почты (Mail.ru и любой другой ящик с IMAP).
 *
 * Раз в час программа заходит в ящик, берёт письма за последние дни
 * только от адресов из списка, который пользователь ведёт сам,
 * и сохраняет вложения Excel.
 *
 * Каждое вложение:
 *  1) копируется в архив почты (DATA_DIR/mail_archive/<дата>/) — оригиналы не теряются;
 *  2) проверяется разбором: если это сводка бурения или ЦПП, файл кладётся
 *     в папку сводок вместо прежней версии с тем же именем;
 *  3) повторно тот же файл (по SHA-256) не обрабатывается.
 * Письма в ящике не удаляются и не помечаются прочитанными.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pdb } from "./pbkdb";
import { storage } from "./storage";
import { DATA_DIR, FILES_DIR } from "./paths";
import { parseWorkbook } from "./pbkparse";
import { loadPbkFiles } from "./pbkload";

pdb.exec(`
CREATE TABLE IF NOT EXISTS mail_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checked_at TEXT NOT NULL,
  uid INTEGER NOT NULL DEFAULT 0,
  message_id TEXT NOT NULL DEFAULT '',
  from_addr TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL DEFAULT '',
  file TEXT NOT NULL DEFAULT '',
  sha256 TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS mail_log_sha ON mail_log(sha256);
CREATE INDEX IF NOT EXISTS mail_log_msg ON mail_log(message_id);
`);

export type MailSettings = {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  password: string;
  /** адреса, с которых принимаются сводки, — ведёт пользователь */
  senders: string;
  folder: string;
  /** за сколько последних дней смотреть письма */
  days: number;
  lastCheck: string;
  lastResult: string;
  /** ошибка последней проверки: пароль, связь, папка */
  lastError: string;
};

const DEFAULT_MAIL: MailSettings = {
  enabled: false,
  host: "imap.mail.ru",
  port: 993,
  user: "",
  password: "",
  senders: "",
  folder: "INBOX",
  days: 3,
  lastCheck: "",
  lastResult: "",
  lastError: "",
};

export function mailSettings(): MailSettings {
  try {
    return { ...DEFAULT_MAIL, ...JSON.parse(storage.getSetting("mail") || "{}") };
  } catch {
    return { ...DEFAULT_MAIL };
  }
}

export function saveMailSettings(patch: Partial<MailSettings>): MailSettings {
  const cur = mailSettings();
  const next: MailSettings = { ...cur, ...patch };
  // пустой пароль из формы означает «не менять»
  if (patch.password === "" || patch.password === undefined) next.password = cur.password;
  next.port = Number(next.port) || 993;
  next.days = Math.max(1, Math.min(30, Number(next.days) || 3));
  next.senders = senderList(next.senders).join(", ");
  storage.setSetting("mail", JSON.stringify(next));
  return next;
}

/** Для интерфейса: пароль не отдаём, только признак «задан» */
export function publicMailSettings() {
  const { password, ...rest } = mailSettings();
  let others: any[] = [];
  try { others = JSON.parse(storage.getSetting("mail_others") || "[]"); } catch { others = []; }
  return { ...rest, hasPassword: !!password, others, problems: mailProblems() };
}

/** Что мешает забирать почту — простым языком */
export function mailProblems(): string[] {
  const s = mailSettings();
  const out: string[] = [];
  if (!s.enabled) out.push("Выключен переключатель «Забирать сводки с почты каждый час» — автоматически почта не проверяется.");
  if (!s.user) out.push("Не указан адрес ящика.");
  if (!s.password) out.push("Не задан пароль для внешнего приложения.");
  if (!senderList(s.senders).length) out.push("Список адресов отправителей пуст — программа не возьмёт ни одного письма.");
  if (s.lastError) out.push(`Последняя проверка закончилась ошибкой: ${s.lastError}`);
  return out;
}

/** Понятный текст ошибки почты */
export function mailErrorText(e: any): string {
  const msg = String(e?.responseText || e?.message || e);
  if (e?.authenticationFailed || /auth|login|credentials|password|invalid/i.test(msg)) {
    return "почта не пустила: неверный адрес или пароль. Для Mail.ru нужен пароль для внешнего приложения с доступом к IMAP (Настройки → Безопасность → Пароли для внешних приложений).";
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout|EHOSTUNREACH/i.test(msg)) {
    return `нет связи с почтовым сервером (${msg}). Проверьте сервер IMAP и порт: для Mail.ru — imap.mail.ru, 993.`;
  }
  if (/mailbox|folder|NONEXISTENT|doesn't exist/i.test(msg)) {
    return `нет папки «${mailSettings().folder}». Обычно нужна INBOX.`;
  }
  return msg;
}

/** Список адресов: запятые, точки с запятой, пробелы и переводы строки */
export function senderList(raw: string): string[] {
  return Array.from(new Set(String(raw ?? "")
    .split(/[\s,;]+/)
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^([^@\s]+)?@[^@\s]+\.[^@\s]+$/.test(x))));
}

function isAllowed(addr: string, allowed: string[]) {
  const a = addr.toLowerCase();
  // можно указать целый домен: @pbk-geo.ru
  return allowed.some((x) => (x.startsWith("@") ? a.endsWith(x) : a === x));
}

const isExcel = (name: string) => /\.xlsx?$/i.test(name) && !name.startsWith("~$");

/** Последняя заполненная дата в сводке: по ней понятно, какая версия свежее */
export function lastFilledDate(pr: { entities: Record<string, any[]> }): string {
  let max = "";
  for (const r of pr.entities.pbk_shifts ?? []) {
    if ((Number(r.meters) > 0 || String(r.comment ?? "").trim()) && String(r.date) > max) max = String(r.date);
  }
  for (const r of pr.entities.pbk_prep ?? []) {
    if ((Number(r.crushed) > 0 || Number(r.milled) > 0) && String(r.date) > max) max = String(r.date);
  }
  for (const r of pr.entities.pbk_geo ?? []) {
    if (Number(r.length_m) > 0 && String(r.date) > max) max = String(r.date);
  }
  return max;
}

/** Проверка подключения без загрузки писем */
export async function testMail() {
  const s = mailSettings();
  if (!s.user || !s.password) throw new Error("Укажите адрес ящика и пароль для внешнего приложения");
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: s.host, port: s.port, secure: s.port !== 143 && s.port !== 1143, auth: { user: s.user, pass: s.password }, logger: false,
  });
  try {
    await client.connect();
    const box = await client.status(s.folder, { messages: true, unseen: true });
    return { ok: true, messages: box.messages ?? 0, unseen: box.unseen ?? 0 };
  } finally {
    try { await client.logout(); } catch { /* уже закрыто */ }
  }
}

export type MailCheckResult = {
  at: string;
  scanned: number;
  fromAllowed: number;
  files: number;
  accepted: number;
  skipped: number;
  rejected: number;
  reload?: { files: number; note?: string };
  details: string[];
  /** письма с Excel от адресов, которых нет в списке отправителей */
  others?: { from: string; subject: string; date: string; count: number }[];
};

/** Есть ли в письме вложение Excel (по структуре, без скачивания) */
function hasExcelPart(node: any): boolean {
  if (!node) return false;
  const name = String(node.dispositionParameters?.filename ?? node.parameters?.name ?? "");
  if (/\.xlsx?$/i.test(name)) return true;
  const type = String(node.type ?? "");
  if (/spreadsheet|ms-excel/i.test(type)) return true;
  return (node.childNodes ?? []).some(hasExcelPart);
}

/**
 * Забрать новые сводки из ящика. Возвращает, сколько файлов принято;
 * если принят хоть один — пересобирает данные сводок.
 */
export async function checkMail(): Promise<MailCheckResult> {
  try {
    return await checkMailInner();
  } catch (e) {
    const text = mailErrorText(e);
    saveMailSettings({ lastCheck: new Date().toISOString(), lastError: text, lastResult: `ошибка: ${text}` });
    throw new Error(text);
  }
}

async function checkMailInner(): Promise<MailCheckResult> {
  const s = mailSettings();
  const allowed = senderList(s.senders);
  const at = new Date().toISOString();
  const res: MailCheckResult = { at, scanned: 0, fromAllowed: 0, files: 0, accepted: 0, skipped: 0, rejected: 0, details: [] };
  if (!s.user || !s.password) throw new Error("Почта не настроена: нет адреса или пароля");
  if (!allowed.length) throw new Error("Не указаны адреса отправителей — программа не возьмёт ни одного письма");

  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");
  const client = new ImapFlow({
    host: s.host, port: s.port, secure: s.port !== 143 && s.port !== 1143, auth: { user: s.user, pass: s.password }, logger: false,
  });

  const logRow = pdb.prepare(`INSERT INTO mail_log
    (checked_at, uid, message_id, from_addr, subject, received_at, file, sha256, status, note)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const seenSha = pdb.prepare(`SELECT 1 x FROM mail_log WHERE sha256=? AND status IN ('принят','без изменений') LIMIT 1`);
  const seenMsg = pdb.prepare(`SELECT 1 x FROM mail_log WHERE message_id=? LIMIT 1`);

  await client.connect();
  try {
    const lock = await client.getMailboxLock(s.folder);
    try {
      const since = new Date(Date.now() - s.days * 86400000);
      const uids = (await client.search({ since }, { uid: true })) || [];
      res.scanned = uids.length;

      // сначала только заголовки — тяжёлые письма от посторонних не скачиваем
      const wanted: { uid: number; from: string; subject: string; date: string; messageId: string }[] = [];
      const others = new Map<string, { from: string; subject: string; date: string; count: number }>();
      if (uids.length) {
        for await (const msg of client.fetch(uids, { envelope: true, uid: true, bodyStructure: true }, { uid: true })) {
          const from = String(msg.envelope?.from?.[0]?.address ?? "").toLowerCase();
          if (!from) continue;
          if (!isAllowed(from, allowed)) {
            // письма с Excel от адресов вне списка — подсказка, кого добавить
            if (hasExcelPart(msg.bodyStructure)) {
              const o = others.get(from) ?? { from, subject: String(msg.envelope?.subject ?? ""), date: "", count: 0 };
              o.count++;
              o.date = msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : o.date;
              others.set(from, o);
            }
            continue;
          }
          const messageId = String(msg.envelope?.messageId ?? `uid-${msg.uid}`);
          if (seenMsg.get(messageId)) continue;
          wanted.push({
            uid: msg.uid, from, subject: String(msg.envelope?.subject ?? ""),
            date: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : "", messageId,
          });
        }
      }
      res.fromAllowed = wanted.length;
      res.others = Array.from(others.values()).sort((a, b) => b.count - a.count);

      for (const w of wanted) {
        const dl = await client.download(String(w.uid), undefined, { uid: true });
        const chunksArr: Buffer[] = [];
        for await (const c of dl.content) chunksArr.push(c as Buffer);
        const parsed = await simpleParser(Buffer.concat(chunksArr));
        const atts = (parsed.attachments ?? []).filter((a) => isExcel(String(a.filename ?? "")));
        if (!atts.length) {
          logRow.run(at, w.uid, w.messageId, w.from, w.subject, w.date, "", "", "без вложений", "в письме нет файлов Excel — возможно, сводку отправили ссылкой на Облако или архивом");
          continue;
        }
        const day = (w.date || at).slice(0, 10);
        const archiveDir = path.join(DATA_DIR, "mail_archive", day);
        fs.mkdirSync(archiveDir, { recursive: true });

        for (const a of atts) {
          res.files++;
          const name = String(a.filename).replace(/[/\\]/g, "_");
          const buf = a.content as Buffer;
          const sha = crypto.createHash("sha256").update(buf).digest("hex");
          fs.writeFileSync(path.join(archiveDir, `${w.uid}_${name}`), buf);

          if (seenSha.get(sha)) {
            res.skipped++;
            logRow.run(at, w.uid, w.messageId, w.from, w.subject, w.date, name, sha, "без изменений", "такой же файл уже принят");
            continue;
          }
          let parsedOk = false;
          let note = "";
          let newLast = "";
          try {
            const pr = parseWorkbook(buf, name);
            parsedOk = pr.loaded > 0;
            newLast = lastFilledDate(pr);
            note = parsedOk
              ? `распознано: ${pr.sheets.filter((x) => x.loaded).map((x) => `${x.sheet} (${x.profileName})`).join(", ")}`
              : "не похоже на сводку бурения или ЦПП";
          } catch (e) {
            note = `ошибка разбора: ${String((e as Error)?.message ?? e)}`;
          }
          if (!parsedOk) {
            res.rejected++;
            logRow.run(at, w.uid, w.messageId, w.from, w.subject, w.date, name, sha, "не принят", note);
            continue;
          }
          // старое письмо не должно затирать более свежую сводку с тем же именем
          const target = path.join(FILES_DIR, name);
          if (fs.existsSync(target)) {
            let oldLast = "";
            try { oldLast = lastFilledDate(parseWorkbook(fs.readFileSync(target), name)); } catch { oldLast = ""; }
            if (oldLast && newLast && newLast < oldLast) {
              res.skipped++;
              logRow.run(at, w.uid, w.messageId, w.from, w.subject, w.date, name, sha, "устарела",
                `в письме данные по ${newLast}, в программе уже есть по ${oldLast} — оставлена более свежая`);
              continue;
            }
          }
          fs.writeFileSync(target, buf);
          res.accepted++;
          logRow.run(at, w.uid, w.messageId, w.from, w.subject, w.date, name, sha, "принят", note);
          res.details.push(`${name} от ${w.from}`);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch { /* уже закрыто */ }
  }

  if (res.accepted) {
    const rep = loadPbkFiles();
    res.reload = { files: rep.files.length, note: rep.note };
  }
  saveMailSettings({
    lastCheck: at,
    lastResult: `писем ${res.scanned}, от ваших адресов новых ${res.fromAllowed}, файлов ${res.files}, принято ${res.accepted}, без изменений ${res.skipped}, не принято ${res.rejected}`,
    lastError: "",
  });
  storage.setSetting("mail_others", JSON.stringify(res.others ?? []));
  return res;
}

export function mailLog(limit = 200) {
  return pdb.prepare(`SELECT * FROM mail_log ORDER BY id DESC LIMIT ?`).all(limit) as any[];
}
