/**
 * Маршруты управления составом программы: показ и скрытие разделов, переименование,
 * порядок и группы меню, готовые наборы, очистка данных раздела и пользовательские разделы-журналы.
 */
import type { Express, Request, Response } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { pdb } from "./pbkdb";
import { currentUser, requireRole, audit } from "./auth";
import { ROLES, ROLE_KEYS } from "@shared/schema";
import {
  SECTION_CATALOG, CATALOG_KEYS, LOCKED_KEYS, PRESETS, CUSTOM_COL_TYPES,
} from "@shared/sections";
import {
  getConfig, saveConfig, resetConfig, applyPreset, clearSectionData,
  customSections, customByKey, createCustomSection, updateCustomSection, deleteCustomSection,
  customRecords, addCustomRecord, deleteCustomRecord, visibleSectionsFor, moneyEnabled,
} from "./sectionsconfig";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

function fail(res: Response, e: any, code = 400) {
  res.status(code).json({ error: e?.message ?? "Не удалось выполнить операцию" });
}

/** Сколько записей хранит раздел — показывается рядом с кнопкой очистки */
function sectionCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  const names = new Set(
    pdb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name),
  );
  for (const s of SECTION_CATALOG) {
    let n = 0;
    for (const t of s.tables) {
      if (t === "pbk") {
        for (const p of ["pbk_shifts", "pbk_geo", "pbk_holes", "pbk_litho", "pbk_prep", "pbk_trenches"]) {
          if (names.has(p)) n += Number((pdb.prepare(`SELECT COUNT(*) c FROM ${p}`).get() as any).c);
        }
        continue;
      }
      if (!names.has(t)) continue;
      n += Number((pdb.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as any).c);
    }
    out[s.key] = n;
  }
  for (const c of customSections())
    out[`custom:${c.key}`] = Number(
      (pdb.prepare("SELECT COUNT(*) c FROM custom_records WHERE section_id = ?").get(c.id) as any).c);
  return out;
}

/** Меню для текущего пользователя: только видимые ему разделы, сгруппированные */
function menuFor(role: string) {
  const cfg = getConfig();
  const allowed = new Set(visibleSectionsFor(role));
  const items = SECTION_CATALOG
    .filter((s) => !s.noMenu && allowed.has(s.key))
    .map((s) => ({
      key: s.key, label: cfg.items[s.key].title, href: s.href, icon: s.icon,
      group: cfg.items[s.key].group, order: cfg.items[s.key].order, custom: false,
    }));
  for (const c of customSections()) {
    if (!allowed.has(`custom:${c.key}`)) continue;
    items.push({
      key: `custom:${c.key}`, label: c.title, href: `/c/${c.key}`, icon: "ClipboardList",
      group: c.group, order: c.order, custom: true,
    });
  }
  const groups = [...cfg.groups].sort((a, b) => a.order - b.order).map((g) => ({
    key: g.key, title: g.title, collapsed: g.collapsed,
    items: items.filter((i) => i.group === g.key).sort((a, b) => a.order - b.order),
  })).filter((g) => g.items.length > 0);
  return { groups, money: moneyEnabled(), sections: Array.from(allowed) };
}

export function registerSectionRoutes(app: Express) {
  /* ---------- Меню: доступно любому вошедшему ---------- */
  app.get("/api/sections/menu", (req, res) => {
    const u = currentUser(req);
    if (!u) return res.status(401).json({ error: "Требуется вход в программу" });
    res.json(menuFor(u.role));
  });

  /* ---------- Экран «Разделы программы»: только генеральный директор ---------- */
  app.get("/api/sections/config", requireRole("director"), (_req, res) => {
    res.json({
      config: getConfig(),
      catalog: SECTION_CATALOG.map((s) => ({
        key: s.key, defaultTitle: s.title, href: s.href, icon: s.icon,
        locked: s.locked, noMenu: !!s.noMenu, clearable: s.tables.length > 0,
        clearHint: s.clearHint, exportKey: s.exportKey ?? "",
      })),
      custom: customSections(),
      counts: sectionCounts(),
      presets: Object.entries(PRESETS).map(([key, p]) => ({ key, title: p.title, hint: p.hint })),
      roles: ROLE_KEYS.map((r) => ({ key: r, label: ROLES[r].label })),
      lockedKeys: LOCKED_KEYS,
      colTypes: CUSTOM_COL_TYPES,
    });
  });

  app.put("/api/sections/config", requireRole("director"), (req, res) => {
    try {
      const cfg = getConfig();
      const body = req.body ?? {};
      if (Array.isArray(body.groups)) {
        for (const g of body.groups) {
          const cur = cfg.groups.find((x) => x.key === g.key);
          if (!cur) continue;
          if (g.title !== undefined && String(g.title).trim()) cur.title = String(g.title).trim();
          if (g.order !== undefined) cur.order = Number(g.order);
          if (g.collapsed !== undefined) cur.collapsed = !!g.collapsed;
        }
      }
      if (body.items && typeof body.items === "object") {
        for (const [key, v] of Object.entries<any>(body.items)) {
          const cur = cfg.items[key];
          if (!cur) continue;
          if (v.title !== undefined && String(v.title).trim()) cur.title = String(v.title).trim();
          if (v.order !== undefined) cur.order = Number(v.order);
          if (v.group !== undefined && cfg.groups.find((g) => g.key === v.group)) cur.group = String(v.group);
          if (Array.isArray(v.roles)) cur.roles = v.roles.filter((r: string) => ROLE_KEYS.includes(r));
          if (v.visible !== undefined) {
            // защита от самоблокировки: ключевые разделы директор скрыть не может
            cur.visible = LOCKED_KEYS.includes(key) ? true : !!v.visible;
            if (LOCKED_KEYS.includes(key) && !cur.roles.includes("director")) cur.roles.push("director");
          }
        }
      }
      for (const k of LOCKED_KEYS) {
        cfg.items[k].visible = true;
        if (!cfg.items[k].roles.includes("director")) cfg.items[k].roles.push("director");
      }
      cfg.preset = "custom";
      const saved = saveConfig(cfg);
      audit(req, "Изменён состав программы", "Разделы", Object.keys(body.items ?? {}).join(", "));
      res.json(saved);
    } catch (e) { fail(res, e); }
  });

  app.post("/api/sections/preset", requireRole("director"), (req, res) => {
    try {
      const name = String(req.body?.preset ?? "");
      const cfg = applyPreset(name);
      audit(req, "Применён набор разделов", PRESETS[name]?.title ?? name, "");
      res.json(cfg);
    } catch (e) { fail(res, e); }
  });

  app.post("/api/sections/reset", requireRole("director"), (req, res) => {
    const cfg = resetConfig();
    audit(req, "Состав программы возвращён к настройкам по умолчанию", "Разделы", "");
    res.json(cfg);
  });

  app.post("/api/sections/clear", requireRole("director"), (req, res) => {
    try {
      if (String(req.body?.confirm ?? "").trim().toUpperCase() !== "ОЧИСТИТЬ")
        throw new Error("Для подтверждения введите слово ОЧИСТИТЬ");
      const key = String(req.body?.key ?? "");
      const result = clearSectionData(key);
      audit(req, "Очищены данные раздела", result.section, `удалено записей: ${result.total}`);
      res.json(result);
    } catch (e) { fail(res, e); }
  });

  /* ---------- Пользовательские разделы ---------- */
  app.post("/api/sections/custom", requireRole("director"), (req, res) => {
    try {
      const sec = createCustomSection(req.body ?? {});
      audit(req, "Создан пользовательский раздел", sec.title, sec.columns.map((c) => c.label).join(", "));
      res.json(sec);
    } catch (e) { fail(res, e); }
  });

  app.patch("/api/sections/custom/:key", requireRole("director"), (req, res) => {
    try {
      const sec = updateCustomSection(String(req.params.key), req.body ?? {});
      audit(req, "Изменён пользовательский раздел", sec.title, "");
      res.json(sec);
    } catch (e) { fail(res, e); }
  });

  app.delete("/api/sections/custom/:key", requireRole("director"), (req, res) => {
    try {
      const sec = customByKey(String(req.params.key));
      deleteCustomSection(String(req.params.key));
      audit(req, "Удалён пользовательский раздел", sec?.title ?? "", "вместе с записями");
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  /* ---------- Данные пользовательского раздела ---------- */
  function access(req: Request, res: Response) {
    const u = currentUser(req);
    if (!u) { res.status(401).json({ error: "Требуется вход в программу" }); return null; }
    const sec = customByKey(String(req.params.key));
    if (!sec) { res.status(404).json({ error: "Раздел не найден" }); return null; }
    if (!visibleSectionsFor(u.role).includes(`custom:${sec.key}`)) {
      audit(req, "Отказано в доступе", `custom:${sec.key}`, `${req.method} ${req.path}`, false);
      res.status(403).json({ error: `Раздел «${sec.title}» недоступен для роли «${ROLES[u.role].label}»` });
      return null;
    }
    return { u, sec };
  }

  app.get("/api/custom/:key", (req, res) => {
    const ctx = access(req, res);
    if (!ctx) return;
    res.json({ section: ctx.sec, records: customRecords(ctx.sec.id) });
  });

  app.post("/api/custom/:key/records", (req, res) => {
    const ctx = access(req, res);
    if (!ctx) return;
    try {
      if (!ctx.u.perm.write) throw new Error(`Роль «${ctx.u.perm.label}» работает только на чтение`);
      const rec = addCustomRecord(ctx.sec, req.body ?? {}, ctx.u.fio || ctx.u.login);
      audit(req, "Добавлена запись", ctx.sec.title, JSON.stringify(rec.data).slice(0, 200));
      res.json(rec);
    } catch (e) { fail(res, e); }
  });

  app.delete("/api/custom/:key/records/:id", (req, res) => {
    const ctx = access(req, res);
    if (!ctx) return;
    deleteCustomRecord(ctx.sec.id, Number(req.params.id));
    audit(req, "Удалена запись", ctx.sec.title, String(req.params.id));
    res.json({ ok: true });
  });

  async function sendBook(res: Response, wb: ExcelJS.Workbook, name: string) {
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition",
      `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.end(Buffer.from(buf));
  }

  function sheetOf(wb: ExcelJS.Workbook, sec: any) {
    const ws = wb.addWorksheet(sec.title.slice(0, 28) || "Журнал");
    ws.columns = sec.columns.map((c: any) => ({ header: c.label, key: c.key, width: 22 }));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    return ws;
  }

  app.get("/api/custom/:key/export", async (req, res) => {
    const ctx = access(req, res);
    if (!ctx) return;
    const wb = new ExcelJS.Workbook();
    const ws = sheetOf(wb, ctx.sec);
    for (const r of customRecords(ctx.sec.id))
      ws.addRow(Object.fromEntries(ctx.sec.columns.map((c) => [
        c.key, c.type === "bool" ? (r.data[c.key] ? "да" : "нет") : r.data[c.key] ?? "",
      ])));
    audit(req, "Выгрузка в Excel", ctx.sec.title, "");
    await sendBook(res, wb, `${ctx.sec.title}.xlsx`);
  });

  app.get("/api/custom/:key/template", async (req, res) => {
    const ctx = access(req, res);
    if (!ctx) return;
    const wb = new ExcelJS.Workbook();
    const ws = sheetOf(wb, ctx.sec);
    ws.addRow(Object.fromEntries(ctx.sec.columns.map((c) => [
      c.key,
      c.type === "date" ? "01.01.2026"
        : c.type === "number" ? 0
        : c.type === "bool" ? "да"
        : c.type === "list" ? (c.options?.[0] ?? "значение")
        : "пример",
    ])));
    await sendBook(res, wb, `Шаблон — ${ctx.sec.title}.xlsx`);
  });

  app.post("/api/custom/:key/import", upload.single("file"), async (req, res) => {
    const ctx = access(req, res);
    if (!ctx) return;
    try {
      if (!ctx.u.perm.write) throw new Error(`Роль «${ctx.u.perm.label}» работает только на чтение`);
      if (!req.file) throw new Error("Файл не выбран");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(req.file.buffer as any);
      const ws = wb.worksheets[0];
      if (!ws) throw new Error("В файле нет ни одного листа");
      const headers: string[] = [];
      ws.getRow(1).eachCell((cell, col) => { headers[col] = String(cell.value ?? "").trim(); });
      const byLabel = new Map(ctx.sec.columns.map((c) => [c.label.toLowerCase(), c]));
      let loaded = 0; let skipped = 0;
      for (let i = 2; i <= ws.rowCount; i++) {
        const row = ws.getRow(i);
        const data: Record<string, any> = {};
        let any = false;
        row.eachCell((cell, col) => {
          const col1 = byLabel.get(String(headers[col] ?? "").toLowerCase());
          if (!col1) return;
          let v: any = cell.value;
          if (v && typeof v === "object" && "text" in v) v = (v as any).text;
          if (v instanceof Date) v = v.toLocaleDateString("ru-RU");
          if (v !== null && v !== undefined && String(v).trim() !== "") any = true;
          data[col1.key] = v;
        });
        if (!any) { skipped++; continue; }
        try { addCustomRecord(ctx.sec, data, ctx.u.fio || ctx.u.login); loaded++; } catch { skipped++; }
      }
      audit(req, "Импорт из Excel", ctx.sec.title, `загружено ${loaded}, пропущено ${skipped}`);
      res.json({ loaded, skipped, message: `Загружено строк: ${loaded}. Пропущено: ${skipped}.` });
    } catch (e) { fail(res, e); }
  });
}

export { CATALOG_KEYS };
