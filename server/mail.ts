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
  return { ...rest, hasPassword: !!password };
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
};

/**
 * Забрать новые сводки из ящика. Возвращает, сколько файлов принято;
 * если принят хоть один — пересобирает данные сводок.
 */
export async function checkMail(): Promise<MailCheckResult> {
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
      if (uids.length) {
        for await (const msg of client.fetch(uids, { envelope: true, uid: true }, { uid: true })) {
          const from = String(msg.envelope?.from?.[0]?.address ?? "").toLowerCase();
          if (!from || !isAllowed(from, allowed)) continue;
          const messageId = String(msg.envelope?.messageId ?? `uid-${msg.uid}`);
          if (seenMsg.get(messageId)) continue;
          wanted.push({
            uid: msg.uid, from, subject: String(msg.envelope?.subject ?? ""),
            date: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : "", messageId,
          });
        }
      }
      res.fromAllowed = wanted.length;

      for (const w of wanted) {
        const dl = await client.download(String(w.uid), undefined, { uid: true });
        const chunksArr: Buffer[] = [];
        for await (const c of dl.content) chunksArr.push(c as Buffer);
        const parsed = await simpleParser(Buffer.concat(chunksArr));
        const atts = (parsed.attachments ?? []).filter((a) => isExcel(String(a.filename ?? "")));
        if (!atts.length) {
          logRow.run(at, w.uid, w.messageId, w.from, w.subject, w.date, "", "", "без вложений", "в письме нет файлов Excel");
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
          try {
            const pr = parseWorkbook(buf, name);
            parsedOk = pr.loaded > 0;
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
          fs.writeFileSync(path.join(FILES_DIR, name), buf);
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
    lastResult: `писем ${res.scanned}, от разрешённых ${res.fromAllowed}, файлов ${res.files}, принято ${res.accepted}, без изменений ${res.skipped}, не принято ${res.rejected}`,
  });
  return res;
}

export function mailLog(limit = 200) {
  return pdb.prepare(`SELECT * FROM mail_log ORDER BY id DESC LIMIT ?`).all(limit) as any[];
}
