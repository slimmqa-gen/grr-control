/** API профилей ПБК: загрузка реальных файлов, аналитика, словарь причин */
import type { Express, Response } from "express";
import multer from "multer";
import fs from "fs";
import { pdb, seedReasons, reasonList, PBK_TABLES, pbkCounts, clearPbkData } from "./pbkdb";
import { PBK_PROFILES, parseWorkbook } from "./pbkparse";
import { loadPbkFiles, PBK_DIR, ORG_NAME } from "./pbkload";
import { pbkAnalytics, reclassifyShifts, rates, factRevenue, hangingRevenue } from "./pbkecon";
import { storage, restoreDemoData } from "./storage";
import {
  dailySummary, summaryText, defaultReportDate, dailySettings, saveDailySettings, saveSnapshot,
  snapshotList, snapshotById, summaryWorkbook, sendDailyNow, hourlyTick, localNow,
} from "./daily";
import { publicMailSettings, saveMailSettings, testMail, checkMail, mailLog, senderList } from "./mail";

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
      for (const f of files) {
        const safeName = String(f.originalname).replace(/[/\\]/g, "_");
        fs.writeFileSync(`${PBK_DIR}/${safeName}`, f.buffer);
      }
      const report = loadPbkFiles();
      res.json(report);
    } catch (e) { fail(res, e, 500); }
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
      for (const k of ["port", "days"]) if (b[k] !== undefined) patch[k] = Number(b[k]);
      if (b.password) patch.password = String(b.password);
      saveMailSettings(patch);
      res.json({ ...publicMailSettings(), senderCount: senderList(publicMailSettings().senders).length });
    } catch (e) { fail(res, e); }
  });

  app.post("/api/pbk/mail/test", async (req, res) => {
    try {
      if (!isDirector(req)) return res.status(403).json({ error: "Проверка почты — у директора" });
      res.json(await testMail());
    } catch (e: any) {
      const msg = String(e?.responseText || e?.message || e);
      const hint = /auth|login|credentials|password/i.test(msg)
        ? " Для Mail.ru нужен пароль для внешнего приложения: Настройки ящика → Безопасность → Пароли для внешних приложений."
        : "";
      res.status(400).json({ error: `Не удалось подключиться: ${msg}.${hint}` });
    }
  });

  app.post("/api/pbk/mail/check", async (req, res) => {
    try {
      if (!isDirector(req)) return res.status(403).json({ error: "Проверка почты — у директора" });
      res.json(await checkMail());
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
