/**
 * Проверка почтового сбора и суточной сводки на сервере.
 * Ничего не меняет: только читает базу, пробует войти в почтовый ящик
 * и показывает, что видит программа. Пароли не выводятся.
 *
 * Запуск: sudo bash deploy/diag.sh
 */
const path = require("path");
const fs = require("fs");

const APP = path.resolve(__dirname, "..");
const DATA_DIR = process.env.DATA_DIR || "/var/pbk-data";
const DB = process.env.DB_PATH || path.join(DATA_DIR, "data.db");
const FILES = process.env.PBK_DIR || path.join(DATA_DIR, "pbk_files");

const line = (t) => console.log(`\n=== ${t} ===`);
const req = (m) => require(path.join(APP, "node_modules", m));

(async () => {
  console.log(`База: ${DB}\nПапка сводок: ${FILES}\nСейчас по Красноярску: ${new Date().toLocaleString("ru-RU", { timeZone: "Asia/Krasnoyarsk" })}`);
  if (!fs.existsSync(DB)) { console.log("ОШИБКА: файл базы не найден"); return; }
  const Database = req("better-sqlite3");
  const db = new Database(DB, { readonly: true, fileMustExist: true });
  const setting = (k) => { try { return JSON.parse(db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value || "{}"); } catch { return {}; } };
  const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);

  line("1. Настройки почты");
  const m = setting("mail");
  if (!Object.keys(m).length) console.log("Почта ни разу не настраивалась (настроек нет).");
  else {
    console.log(`Включена: ${m.enabled ? "да" : "НЕТ"} · забирать каждые ${m.intervalMin || 60} мин`);
    console.log(`Ящик: ${m.user || "НЕ УКАЗАН"} · сервер ${m.host}:${m.port} · папка ${m.folder} · смотреть писем за ${m.days} дн.`);
    console.log(`Пароль приложения: ${m.password ? "задан" : "НЕ ЗАДАН"}`);
    console.log(`Адреса отправителей: ${m.senders || "СПИСОК ПУСТ"}`);
    console.log(`Последняя проверка: ${m.lastCheck || "не было"}`);
    console.log(`Итог: ${m.lastResult || "—"}`);
    if (m.lastError) console.log(`ОШИБКА последней проверки: ${m.lastError}`);
  }

  line("2. Вход в почтовый ящик");
  if (m.user && m.password) {
    try {
      const { ImapFlow } = req("imapflow");
      const c = new ImapFlow({ host: m.host, port: m.port, secure: m.port !== 143 && m.port !== 1143, auth: { user: m.user, pass: m.password }, logger: false });
      await c.connect();
      const st = await c.status(m.folder || "INBOX", { messages: true, unseen: true });
      console.log(`Вход выполнен. В папке ${m.folder}: писем ${st.messages}, непрочитанных ${st.unseen}.`);
      const lock = await c.getMailboxLock(m.folder || "INBOX");
      try {
        const since = new Date(Date.now() - (Number(m.days) || 3) * 86400000);
        const uids = (await c.search({ since }, { uid: true })) || [];
        console.log(`Писем за последние ${m.days} дн.: ${uids.length}. Последние 15:`);
        const list = [];
        if (uids.length) {
          for await (const msg of c.fetch(uids.slice(-15), { envelope: true, bodyStructure: true, uid: true }, { uid: true })) {
            const names = [];
            const walk = (n) => { if (!n) return; const f = n.dispositionParameters?.filename || n.parameters?.name; if (f) names.push(f); (n.childNodes || []).forEach(walk); };
            walk(msg.bodyStructure);
            list.push(`  ${msg.envelope?.date ? new Date(msg.envelope.date).toLocaleString("ru-RU", { timeZone: "Asia/Krasnoyarsk" }) : "?"} | ${msg.envelope?.from?.[0]?.address} | «${msg.envelope?.subject || ""}» | вложения: ${names.join(", ") || "нет"}`);
          }
        }
        console.log(list.join("\n") || "  писем нет");
      } finally { lock.release(); }
      await c.logout();
    } catch (e) {
      console.log(`НЕ УДАЛОСЬ ВОЙТИ: ${e.responseText || e.message}${e.authenticationFailed ? " (неверный адрес или пароль приложения)" : ""}`);
    }
  } else console.log("Пропущено: нет адреса или пароля.");

  line("3. Журнал почты в программе (последние 15)");
  if (has("mail_log")) {
    const rows = db.prepare("SELECT * FROM mail_log ORDER BY id DESC LIMIT 15").all();
    console.log(rows.length ? rows.map((r) => `  ${r.checked_at.slice(0, 16)} | ${r.status} | ${r.from_addr} | ${r.file} | ${r.note}`).join("\n") : "  пусто — программа ещё не взяла ни одного письма от ваших адресов");
  } else console.log("  таблицы журнала нет — почтовый модуль ещё не запускался");
  const others = setting("mail_others");
  if (Array.isArray(others) && others.length) console.log(`Письма с Excel от адресов ВНЕ списка: ${others.map((o) => `${o.from} (${o.count})`).join(", ")}`);

  line("4. Файлы сводок");
  if (fs.existsSync(FILES)) {
    const f = fs.readdirSync(FILES).filter((x) => /\.xlsx?$/i.test(x));
    console.log(f.map((x) => `  ${fs.statSync(path.join(FILES, x)).mtime.toLocaleString("ru-RU", { timeZone: "Asia/Krasnoyarsk" })} | ${x}`).join("\n") || "  папка пуста");
  } else console.log("  папки нет");

  line("5. Последние данные по участкам");
  if (has("pbk_shifts")) {
    for (const r of db.prepare("SELECT object, MAX(date) d, source_file f FROM pbk_shifts WHERE meters>0 OR TRIM(comment)<>'' GROUP BY object").all()) console.log(`  ${r.object}: по ${r.d} (${r.f})`);
    const p = db.prepare("SELECT MAX(date) d FROM pbk_prep WHERE crushed>0 OR milled>0").get();
    console.log(`  ЦПП: по ${p?.d || "нет данных"}`);
  }

  line("6. Рассылка суточной сводки в MAX");
  const d = setting("daily");
  console.log(`Включена: ${d.enabled ? "да" : "НЕТ"} · окно с ${d.sendFrom ?? 8} до ${d.sendTo ?? 9} · получателей: ${String(d.chatIds || "").split(",").filter(Boolean).length}`);
  console.log(`Последняя утренняя отправка: ${d.lastSentDate || "не было"} · последняя ежечасная проверка: ${d.lastHourKey || "не было"}`);
  if (has("daily_snapshots")) {
    const s = db.prepare("SELECT report_date, version, created_at, reason, sent FROM daily_snapshots ORDER BY id DESC LIMIT 5").all();
    console.log(s.map((r) => `  сводка за ${r.report_date} ред.${r.version} | ${r.created_at.slice(0, 16)} | ${r.reason} | ${r.sent ? "отправлена" : "не отправлена"}`).join("\n") || "  архив пуст");
  }
})().catch((e) => console.log("Ошибка проверки:", e.message));
