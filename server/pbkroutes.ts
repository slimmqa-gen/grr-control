/** API профилей ПБК: загрузка реальных файлов, аналитика, словарь причин */
import type { Express, Response } from "express";
import multer from "multer";
import fs from "fs";
import { pdb, seedReasons, reasonList, PBK_TABLES, pbkCounts, clearPbkData } from "./pbkdb";
import { PBK_PROFILES, parseWorkbook } from "./pbkparse";
import { loadPbkFiles, PBK_DIR, ORG_NAME, lastOverlaps } from "./pbkload";
import path from "path";
import crypto from "crypto";
import { pbkAnalytics, reclassifyShifts, rates, factRevenue, hangingRevenue } from "./pbkecon";
import { storage, restoreDemoData } from "./storage";
import {
  dailySummary, summaryText, defaultReportDate, dailySettings, saveDailySettings, saveSnapshot,
  snapshotList, snapshotById, summaryWorkbook, sendDailyNow, hourlyTick, localNow, deleteSnapshot,
} from "./daily";
import { publicMailSettings, saveMailSettings, testMail, mailLog, senderList, lastFilledDate, mailErrorText } from "./mail";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const fail = (res: Response, e: any, code = 400) =>
  res.status(code).json({ error: e?.message ?? "Не удалось выполнить операцию" });

export function registerPbkRoutes(app: Express) {
  seedReasons();

  app.get("/api/pbk/profiles", (_req, res) => {
    const state = pdb.prepare("SELECT * FROM pbk_profiles_state").all() as any[];
    res.json(PBK_PROFILES.map((p) => ({
      ...p, uses: state.find((s) => s.code === p.code)?.uses ?? 0,
      enabled: state.find((s) => s.code === p.code)?.enabled ?? 1,
    })));
  });

  app.get("/api/pbk/imports", (_req, res) => {
    const rows = (pdb.prepare("SELECT * FROM pbk_imports ORDER BY id").all() as any[]).map((r) => ({
      ...r, sheets: JSON.parse(r.sheets || "[]"), notes: JSON.parse(r.notes || "[]"),
    }));
    res.json({ imports: rows, counts: pbkCounts(), org: ORG_NAME, dir: PBK_DIR });
  });

  app.get("/api/pbk/analytics", (_req, res) => {
    try { res.json(pbkAnalytics()); } catch (e) { fail(res, e, 500); }
  });

  app.get("/api/pbk/data/:table", (req, res) => {
    const t = String(req.params.table);
    if (!PBK_TABLES.includes(t)) return fail(res, new Error("Неизвестная таблица"));
    const limit = Math.min(Number(req.query.limit ?? 500), 5000);
    const rows = pdb.prepare(`SELECT * FROM ${t} ORDER BY id LIMIT ?`).all(limit);
    const total = (pdb.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as any).c;
    res.json({ rows, total });
  });

  app.get("/api/pbk/rates", (_req, res) => res.json({ rates: rates(), revenue: factRevenue(), hanging: hangingRevenue() }));

  app.get("/api/pbk/reasons", (_req, res) => {
    const list = reasonList();
    const cats = Array.from(new Set(list.map((r) => r.category)));
    res.json({ reasons: list, categories: cats });
  });

  app.post("/api/pbk/reasons", (req, res) => {
    try {
      const category = String(req.body?.category ?? "").trim();
      const keyword = String(req.body?.keyword ?? "").trim().toLowerCase();
      if (!category || !keyword) throw new Error("Укажите категорию и ключевое слово");
      pdb.prepare("INSERT INTO pbk_reasons (category, keyword, builtin) VALUES (?,?,0)").run(category, keyword);
      const changed = reclassifyShifts();
      res.json({ ok: true, reclassified: changed, reasons: reasonList() });
    } catch (e) { fail(res, e); }
  });

  app.delete("/api/pbk/reasons/:id", (req, res) => {
    pdb.prepare("DELETE FROM pbk_reasons WHERE id = ?").run(Number(req.params.id));
    const changed = reclassifyShifts();
    res.json({ ok: true, reclassified: changed, reasons: reasonList() });
  });

  app.post("/api/pbk/reasons/reset", (_req, res) => {
    seedReasons(true);
    const changed = reclassifyShifts();
    res.json({ ok: true, reclassified: changed, reasons: reasonList() });
  });

  app.post("/api/pbk/load-all", (_req, res) => {
    try {
      const report = loadPbkFiles();
      res.json(report);
    } catch (e) { fail(res, e, 500); }
  });

  /** Загрузка файлов заказчика через браузер: сохраняем в pbk_files и разбираем все сразу */
  app.post("/api/pbk/upload", upload.array("files", 20), (req, res) => {
    try {
      const files = (req.files as any[]) ?? [];
      if (!files.length) throw new Error("Файлы не выбраны");
      if (!fs.existsSync(PBK_DIR)) fs.mkdirSync(PBK_DIR, { recursive: true });
      const accepted: string[] = [];
      const replaced: string[] = [];
      const rejected: { file: string; reason: string }[] = [];
      for (const f of files) {
        // имя из браузера приходит в latin1 — возвращаем кириллицу
        let name = String(f.originalname);
        try { const u = Buffer.from(name, "latin1").toString("utf8"); if (!u.includes("\uFFFD")) name = u; } catch { /* как есть */ }
        const safeName = name.replace(/[/\\]/g, "_");
        if (!/\.xlsx?$/i.test(safeName)) { rejected.push({ file: safeName, reason: "не файл Excel" }); continue; }
        // сначала проверяем, что это сводка: посторонний файл не должен попасть в данные
        let ok = false;
        try { ok = parseWorkbook(f.buffer, safeName).loaded > 0; } catch { ok = false; }
        if (!ok) { rejected.push({ file: safeName, reason: "не распознан как сводка бурения, геологии или ЦПП" }); continue; }
        const target = path.join(PBK_DIR, safeName);
        if (fs.existsSync(target)) {
          // не даём случайно заменить свежую сводку старой версией с тем же именем
          let oldLast = "", newLast = "";
          try { oldLast = lastFilledDate(parseWorkbook(fs.readFileSync(target), safeName)); } catch { /* пусть заменяется */ }
          try { newLast = lastFilledDate(parseWorkbook(f.buffer, safeName)); } catch { /* уже проверено выше */ }
          if (oldLast && newLast && newLast < oldLast) {
            rejected.push({
              file: safeName,
              reason: `в программе уже есть более свежая версия (данные по ${oldLast.split("-").reverse().join(".")}), а в этом файле — по ${newLast.split("-").reverse().join(".")}. Переименуйте файл, если это другая сводка`,
            });
            continue;
          }
          replaced.push(safeName);
        }
        fs.writeFileSync(target, f.buffer);
        accepted.push(safeName);
      }
      const report = accepted.length ? loadPbkFiles() : null;
      res.json({ ...(report ?? {}), accepted, replaced, rejected, overlaps: lastOverlaps() });
    } catch (e) { fail(res, e, 500); }
  });

  /** Откуда взяты последние данные по каждому участку и ЦПП */
  app.get("/api/pbk/sources", (_req, res) => {
    try {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Krasnoyarsk" });
      const days = (d: string) => (d ? Math.round((Date.parse(today) - Date.parse(d)) / 86400000) : null);
      const fileInfo = (file: string) => {
        const full = path.join(PBK_DIR, file);
        if (!file || !fs.existsSync(full)) return { exists: false, source: "файла уже нет", from: "", at: "" };
        const buf = fs.readFileSync(full);
        const sha = crypto.createHash("sha256").update(buf).digest("hex");
        // письмо, из которого пришла именно эта версия файла
        const mail = pdb.prepare(
          `SELECT from_addr, subject, received_at, checked_at FROM mail_log WHERE sha256=? AND status='принят' ORDER BY id DESC LIMIT 1`,
        ).get(sha) as any;
        if (mail) return { exists: true, source: "почта", from: mail.from_addr, subject: mail.subject, at: mail.received_at || mail.checked_at };
        return { exists: true, source: "вручную", from: "", subject: "", at: fs.statSync(full).mtime.toISOString() };
      };
      const drill = (pdb.prepare(`SELECT DISTINCT object FROM pbk_shifts WHERE object<>'' ORDER BY object`).all() as any[]).map((r) => {
        const last = pdb.prepare(
          `SELECT date, source_file FROM pbk_shifts WHERE object=? AND (meters>0 OR TRIM(comment)<>'') ORDER BY date DESC LIMIT 1`,
        ).get(r.object) as any;
        return { object: r.object, kind: "бурение", lastDate: last?.date ?? "", daysAgo: days(last?.date ?? ""), file: last?.source_file ?? "", ...fileInfo(last?.source_file ?? "") };
      });
      const p = pdb.prepare(
        `SELECT date, source_file FROM pbk_prep WHERE crushed>0 OR milled>0 ORDER BY date DESC LIMIT 1`,
      ).get() as any;
      const prep = p ? [{ object: "ЦПП", kind: "пробоподготовка", lastDate: p.date, daysAgo: days(p.date), file: p.source_file, ...fileInfo(p.source_file) }] : [];
      res.json({ today, rows: [...drill, ...prep] });
    } catch (e) { fail(res, e); }
  });

  /** Загруженные сводки: участки и периоды по каждому файлу, откуда взят каждый месяц */
  app.get("/api/pbk/files", (_req, res) => {
    try {
      const names = fs.existsSync(PBK_DIR)
        ? fs.readdirSync(PBK_DIR).filter((f) => /\.xlsx?$/i.test(f) && !f.startsWith("~$"))
        : [];
      const fromMail = new Set(
        (pdb.prepare(`SELECT DISTINCT file FROM mail_log WHERE status='принят'`).all() as any[]).map((r) => r.file),
      );
      const q = (sql: string, f: string) => pdb.prepare(sql).all(f) as any[];
      const overlaps = lastOverlaps();
      const rows = names.map((f) => {
        const st = fs.statSync(path.join(PBK_DIR, f));
        const drill = q(`SELECT object, MIN(date) d1, MAX(date) d2, COUNT(*) n, SUM(meters) m FROM pbk_shifts
                         WHERE source_file=? AND (meters>0 OR TRIM(comment)<>'') GROUP BY object`, f);
        const prep = q(`SELECT MIN(date) d1, MAX(date) d2, COUNT(*) n, SUM(crushed) c FROM pbk_prep
                        WHERE source_file=? AND (crushed>0 OR milled>0)`, f).filter((r) => r.n);
        return {
          file: f, size: st.size, uploadedAt: st.mtime.toISOString(),
          source: fromMail.has(f) ? "почта" : "вручную",
          drill, prep,
          droppedMonths: overlaps.filter((o) => o.dropped.includes(f)).map((o) => ({ object: o.object, month: o.month, kept: o.kept })),
          keptMonths: overlaps.filter((o) => o.kept === f).map((o) => ({ object: o.object, month: o.month, instead: o.dropped })),
        };
      }).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
      res.json({ rows });
    } catch (e) { fail(res, e); }
  });

  /** Удалить сводку и пересчитать данные без неё */
  app.delete("/api/pbk/files/:name", (req, res) => {
    try {
      if ((req as any).authUser?.role !== "director") return res.status(403).json({ error: "Удалять сводки может директор" });
      const name = path.basename(String(req.params.name));
      const target = path.join(PBK_DIR, name);
      if (!fs.existsSync(target)) return res.status(404).json({ error: "Файл не найден" });
      const left = fs.readdirSync(PBK_DIR).filter((f) => /\.xlsx?$/i.test(f) && f !== name);
      if (!left.length) return res.status(400).json({ error: "Это последняя сводка — удалить нельзя, иначе данные опустеют" });
      // не стираем совсем: переносим в корзину рядом, чтобы можно было вернуть
      const trash = path.join(PBK_DIR, "..", "pbk_files_deleted");
      fs.mkdirSync(trash, { recursive: true });
      fs.renameSync(target, path.join(trash, `${Date.now()}_${name}`));
      res.json({ ok: true, report: loadPbkFiles() });
    } catch (e) { fail(res, e); }
  });

  /** Полная очистка реальных данных ПБК: таблицы pbk_* и рабочие таблицы программы. */
  app.post("/api/pbk/clear", (_req, res) => {
    try {
      clearPbkData();
      storage.fullReset();
      storage.setSetting("dataMode", "empty");
      res.json({ ok: true, counts: pbkCounts() });
    } catch (e) { fail(res, e, 500); }
  });

  app.post("/api/pbk/restore-demo", (_req, res) => {
    try {
      const counts = restoreDemoData();
      storage.setSetting("orgName", "ГРР-Контроль");
      storage.setSetting("dataMode", "demo");
      res.json({ ok: true, counts });
    } catch (e) { fail(res, e, 500); }
  });

  app.get("/api/pbk/mode", (_req, res) => res.json({
    mode: storage.getSetting("dataMode", "demo"),
    org: storage.getSetting("orgName", "ГРР-Контроль"),
  }));

  /** Пробный разбор произвольного файла заказчика встроенными профилями */
  /* ---------- суточная сводка ---------- */
  const isDirector = (req: any) => req.authUser?.role === "director";
  const dateOf = (v: any) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : defaultReportDate());

  app.get("/api/pbk/daily", (req, res) => {
    try {
      const s = dailySummary(dateOf(req.query.date));
      res.json({ summary: s, text: summaryText(s), today: localNow().date });
    } catch (e) { fail(res, e); }
  });

  app.get("/api/pbk/daily/settings", (_req, res) => {
    try { res.json(dailySettings()); } catch (e) { fail(res, e); }
  });

  app.put("/api/pbk/daily/settings", (req, res) => {
    try {
      if (!isDirector(req)) return res.status(403).json({ error: "Настройки рассылки меняет директор" });
      const b = req.body ?? {};
      const patch: any = {};
      for (const k of ["enabled", "notifyChanges"]) if (b[k] !== undefined) patch[k] = !!b[k];
      for (const k of ["sendFrom", "sendTo"]) if (b[k] !== undefined) patch[k] = Number(b[k]);
      if (b.chatIds !== undefined) patch.chatIds = String(b.chatIds);
      if (b.tz !== undefined) patch.tz = String(b.tz) || "Asia/Krasnoyarsk";
      res.json(saveDailySettings(patch));
    } catch (e) { fail(res, e); }
  });

  /** Сохранить текущую редакцию в архив вручную */
  app.post("/api/pbk/daily/snapshot", (req, res) => {
    try {
      const { row, isNew } = saveSnapshot(dailySummary(dateOf(req.body?.date)), "сохранено вручную");
      res.json({ id: row.id, version: row.version, isNew });
    } catch (e) { fail(res, e); }
  });

  app.get("/api/pbk/daily/archive", (_req, res) => {
    try { res.json({ rows: snapshotList() }); } catch (e) { fail(res, e); }
  });

  app.delete("/api/pbk/daily/archive/:id", (req, res) => {
    try {
      if (!isDirector(req)) return res.status(403).json({ error: "Удалять из архива может директор" });
      const n = deleteSnapshot(Number(req.params.id));
      if (!n) return res.status(404).json({ error: "Редакция не найдена" });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  app.get("/api/pbk/daily/archive/:id", (req, res) => {
    try {
      const row = snapshotById(Number(req.params.id));
      if (!row) return res.status(404).json({ error: "Редакция не найдена" });
      res.json(row);
    } catch (e) { fail(res, e); }
  });

  /** Excel: по дате (текущий расчёт) или по редакции из архива */
  app.get("/api/pbk/daily/excel", async (req, res) => {
    try {
      const snap = req.query.id ? snapshotById(Number(req.query.id)) : null;
      const s = snap ? snap.data : dailySummary(dateOf(req.query.date));
      const buf = await summaryWorkbook(s);
      const name = `Svodka_PBK_${s.date}${snap ? `_v${snap.version}` : ""}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
      res.send(buf);
    } catch (e) { fail(res, e); }
  });

  /** Отправить сводку в MAX сейчас */
  app.post("/api/pbk/daily/send", async (req, res) => {
    try {
      if (!dailySettings().chatIds.trim()) return res.status(400).json({ error: "Не выбраны получатели сводки" });
      res.json(await sendDailyNow(dateOf(req.body?.date)));
    } catch (e) { fail(res, e); }
  });

  /** Проверить почту и пересчитать прямо сейчас, как это делает ежечасная проверка */
  app.post("/api/pbk/daily/run", async (req, res) => {
    try {
      if (!isDirector(req)) return res.status(403).json({ error: "Запуск проверки — у директора" });
      res.json(await hourlyTick(true));
    } catch (e) { fail(res, e); }
  });

  /* ---------- почта ---------- */
  app.get("/api/pbk/mail/settings", (_req, res) => {
    try { res.json(publicMailSettings()); } catch (e) { fail(res, e); }
  });

  app.put("/api/pbk/mail/settings", (req, res) => {
    try {
      if (!isDirector(req)) return res.status(403).json({ error: "Настройки почты меняет директор" });
      const b = req.body ?? {};
      const patch: any = {};
      if (b.enabled !== undefined) patch.enabled = !!b.enabled;
      for (const k of ["host", "user", "folder", "senders"]) if (b[k] !== undefined) patch[k] = String(b[k]).trim();
      for (const k of ["port", "days", "intervalMin"]) if (b[k] !== undefined) patch[k] = Number(b[k]);
      if (b.password) patch.password = String(b.password);
      const saved = saveMailSettings(patch);
      // сразу после сохранения — забрать почту в фоне, не дожидаясь часа
      if (saved.enabled && saved.user && saved.password && senderList(saved.senders).length) {
        hourlyTick(true, true).catch((e) => console.log(`[Почта] ${String(e?.message ?? e)}`));
      }
      res.json({ ...publicMailSettings(), senderCount: senderList(publicMailSettings().senders).length });
    } catch (e) { fail(res, e); }
  });

  app.post("/api/pbk/mail/test", async (req, res) => {
    try {
      if (!isDirector(req)) return res.status(403).json({ error: "Проверка почты — у директора" });
      const out = await testMail();
      saveMailSettings({ lastError: "" });
      res.json(out);
    } catch (e: any) {
      res.status(400).json({ error: `Не удалось подключиться: ${mailErrorText(e)}` });
    }
  });

  app.post("/api/pbk/mail/check", async (req, res) => {
    try {
      if (!isDirector(req)) return res.status(403).json({ error: "Проверка почты — у директора" });
      // ручная проверка: забрать почту и сразу пересчитать суточную сводку
      const out: any = await hourlyTick(true, true);
      if (out.mail?.error) return res.status(400).json({ error: out.mail.error });
      res.json({ ...(out.mail ?? {}), snapshot: out.snapshot, isNew: out.isNew });
    } catch (e) { fail(res, e); }
  });

  app.get("/api/pbk/mail/log", (_req, res) => {
    try { res.json({ rows: mailLog() }); } catch (e) { fail(res, e); }
  });

  app.post("/api/pbk/preview", upload.single("file"), (req, res) => {
    try {
      if (!req.file) throw new Error("Файл не выбран");
      const r = parseWorkbook(req.file.buffer, req.file.originalname);
      const sample: Record<string, any[]> = {};
      for (const [k, v] of Object.entries(r.entities)) if (v.length) sample[k] = v.slice(0, 10);
      res.json({ file: r.file, profiles: r.profiles, sheets: r.sheets, loaded: r.loaded, skipped: r.skipped, sample });
    } catch (e) { fail(res, e); }
  });
}
