import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import multer from "multer";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { storage, restoreDemoData } from "./storage";
import { buildAnalytics } from "./analytics";
import { buildWorkbook, buildSummaryWorkbook, type SheetKey } from "./excel";
import {
  parseUpload, analyzeRows, commitImport, suggestMapping, buildTemplate,
  buildRefsTemplate, importRefs, REFS_SHEETS,
} from "./importer";
import {
  insertReportSchema, insertCostSchema, insertFuelSchema, insertInventorySchema,
  insertEmployeeSchema, insertShiftSchema, insertObjectSchema, insertRigSchema, insertEmployeeEventSchema, insertDashboardNoteSchema, OPEN_ENDED_DATE,
  insertBrigadeSchema, insertEquipmentSchema, insertCostItemSchema, insertInventoryItemSchema,
  insertPositionSchema, CYCLE_TYPES,
  DATA_TYPES, IMPORT_FIELDS, DEFAULT_THRESHOLDS, RIG_STATUSES, EQUIPMENT_KINDS,
  insertLabSchema, insertAnalysisTypeSchema, insertSampleSchema, insertLabBatchSchema,
  insertAssaySchema, insertCoreLogSchema, insertCoreCutSchema,
  SAMPLE_STAGES, SAMPLE_TYPES, REJECT_REASONS, SHIP_METHODS, SAMPLE_ELEMENTS, ASSAY_UNITS,
  CUT_TYPES, CORE_LOG_STATUSES, CUT_STATUSES, CUT_REJECT_REASONS,
} from "@shared/schema";
import type { DataType } from "@shared/schema";
import { installAuth, registerUserRoutes, currentUser, audit } from "./auth";
import {
  listTemplates, templateDef, saveTemplateDef, resetTemplateDef, deleteTemplateDef,
  createTemplateDef, buildTemplateWorkbook, previewRows, proposeFromFile,
} from "./templates";
import { brandingInfo, saveBranding } from "./branding";
import { templateSaveSchema, brandingSchema } from "@shared/schema";
import { smartUpload, smartPreview, smartCommit, headersOf, signatureOf } from "./smartparse";
import { buildEstimateAnalytics } from "./estimates";
import { seedEstimates } from "./seedEstimates";
import { registerPbkRoutes } from "./pbkroutes";
import { registerSectionRoutes } from "./sections";
import { resetConfig } from "./sectionsconfig";
import { ensurePbkLoaded } from "./pbkload";
import {
  SMART_TYPES, SMART_ENTITIES, SYNONYM_KINDS, ROLES, CONTRACT_STAGES,
  STAGE_STATUSES, ESTIMATE_SECTIONS, insertEstimateSchema, insertEstimateLineSchema,
  insertDepthRateSchema, insertCalendarPlanSchema, insertCalendarStageSchema,
} from "@shared/schema";

const ALLOWED_EXT = /\.(xlsx|xlsm|xls|csv)$/i;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_EXT.test(file.originalname || "")) {
      return cb(new Error("Поддерживаются только файлы Excel и CSV: .xlsx, .xlsm, .xls, .csv"));
    }
    cb(null, true);
  },
});

function fail(res: Response, e: any, code = 400) {
  const msg = e?.issues?.[0]?.message ?? e?.message ?? "Не удалось выполнить операцию";
  res.status(code).json({ error: msg });
}

async function sendWorkbook(res: Response, wb: any, fileName: string) {
  const buf = await wb.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.end(Buffer.from(buf));
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  seedEstimates();
  // ВАЖНО: installAuth должен подключаться до registerPbkRoutes, иначе маршруты
  // /api/pbk/* (расценки, себестоимость, выручка) окажутся зарегистрированы раньше
  // app.use(guard) и будут отвечать без какой-либо проверки авторизации.
  installAuth(app);
  registerPbkRoutes(app);
  ensurePbkLoaded();
  registerUserRoutes(app);
  registerSectionRoutes(app);

  // ---------- Умный импорт «живых» сводок ----------
  app.post("/api/smart/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) throw new Error("Файл не выбран");
      const type = req.body?.type === "geo" ? "geo" : req.body?.type === "drill" ? "drill" : undefined;
      const result = await smartUpload(req.file.buffer, req.file.originalname, type as any);
      audit(req, "Разбор файла умного импорта", req.file.originalname, result.message);
      res.json(result);
    } catch (e) { fail(res, e); }
  });

  app.post("/api/smart/preview", (req, res) => {
    try { res.json(smartPreview(req.body)); } catch (e) { fail(res, e); }
  });

  app.post("/api/smart/commit", (req, res) => {
    try {
      const u = currentUser(req);
      const result = smartCommit({ ...req.body, author: u?.fio ?? "—" });
      // отмечаем применение профиля, если файл был распознан автоматически
      const pid = Number(req.body?.profileId ?? 0);
      if (pid) {
        const prof = storage.profileById(pid);
        if (prof) storage.updateProfile(pid, { usedCount: (prof.usedCount ?? 0) + 1, lastUsed: new Date().toISOString() });
      }
      audit(req, "Загрузка данных умным импортом", SMART_TYPES[req.body.type as "drill" | "geo"], result.summary);
      res.json(result);
    } catch (e) { fail(res, e); }
  });

  app.get("/api/smart/meta", (_req, res) => {
    res.json({ types: SMART_TYPES, entities: SMART_ENTITIES, synonymKinds: SYNONYM_KINDS });
  });

  // ---------- Профили импорта ----------
  app.get("/api/profiles", (_req, res) => res.json(storage.profiles()));

  app.post("/api/profiles", (req, res) => {
    try {
      const u = currentUser(req);
      const b = req.body ?? {};
      if (!String(b.name ?? "").trim()) throw new Error("Укажите название профиля");
      const headers: string[] = b.headers?.length ? b.headers : headersOf(b.uploadId, { type: b.kind });
      const p = storage.createProfile({
        name: String(b.name).trim(), kind: b.kind === "geo" ? "geo" : "drill",
        sheetRule: b.sheetRule ?? "все", sheetMatch: b.sheetMatch ?? "",
        headerRow: Number(b.headerRow ?? 0), transposed: b.transposed ? 1 : 0,
        mapping: JSON.stringify(b.mapping ?? {}), defaults: JSON.stringify(b.defaults ?? {}),
        signature: JSON.stringify(signatureOf(headers)),
        createdAt: new Date().toISOString(), usedCount: 0, lastUsed: "",
        author: u?.fio ?? "—",
      });
      audit(req, "Создан профиль импорта", p.name, "");
      res.json(p);
    } catch (e) { fail(res, e); }
  });

  app.patch("/api/profiles/:id", (req, res) => {
    try {
      const b = req.body ?? {};
      const patch: any = {};
      ["name", "kind", "sheetRule", "sheetMatch"].forEach((k) => { if (b[k] !== undefined) patch[k] = b[k]; });
      if (b.headerRow !== undefined) patch.headerRow = Number(b.headerRow);
      if (b.transposed !== undefined) patch.transposed = b.transposed ? 1 : 0;
      if (b.mapping !== undefined) patch.mapping = JSON.stringify(b.mapping);
      if (b.defaults !== undefined) patch.defaults = JSON.stringify(b.defaults);
      if (b.headers !== undefined) patch.signature = JSON.stringify(signatureOf(b.headers));
      if (b.usedTick) { patch.usedCount = (storage.profileById(Number(req.params.id))?.usedCount ?? 0) + 1; patch.lastUsed = new Date().toISOString(); }
      res.json(storage.updateProfile(Number(req.params.id), patch));
    } catch (e) { fail(res, e); }
  });

  app.post("/api/profiles/:id/duplicate", (req, res) => {
    try {
      const src = storage.profileById(Number(req.params.id));
      if (!src) throw new Error("Профиль не найден");
      const { id, ...rest } = src as any;
      res.json(storage.createProfile({ ...rest, name: `${src.name} (копия)`, usedCount: 0, lastUsed: "", createdAt: new Date().toISOString() }));
    } catch (e) { fail(res, e); }
  });

  app.delete("/api/profiles/:id", (req, res) => {
    try {
      const p = storage.profileById(Number(req.params.id));
      storage.deleteProfile(Number(req.params.id));
      audit(req, "Удалён профиль импорта", p?.name ?? "", "");
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // ---------- Словарь синонимов ----------
  app.get("/api/synonyms", (_req, res) => res.json(storage.synonyms()));
  app.post("/api/synonyms", (req, res) => {
    try {
      const b = req.body ?? {};
      if (!String(b.alias ?? "").trim() || !String(b.canonical ?? "").trim())
        throw new Error("Заполните написание в файле и значение из справочника");
      res.json(storage.createSynonym({
        kind: b.kind ?? "rig", alias: String(b.alias).trim(), canonical: String(b.canonical).trim(),
      }));
    } catch (e) { fail(res, e); }
  });
  app.patch("/api/synonyms/:id", (req, res) => {
    try { res.json(storage.updateSynonym(Number(req.params.id), req.body)); } catch (e) { fail(res, e); }
  });
  app.delete("/api/synonyms/:id", (req, res) => {
    try { storage.deleteSynonym(Number(req.params.id)); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });

  // ---------- Сметы и календарные планы ----------
  app.get("/api/estimates", (_req, res) => {
    res.json({
      estimates: storage.estimates(), lines: storage.estimateLines(),
      rates: storage.depthRates(), plans: storage.calendarPlans(), stages: storage.calendarStages(),
      analytics: buildEstimateAnalytics(),
      meta: { stages: CONTRACT_STAGES, statuses: STAGE_STATUSES, sections: ESTIMATE_SECTIONS },
    });
  });

  app.post("/api/estimates", (req, res) => {
    try {
      const v = insertEstimateSchema.parse(req.body);
      if (v.active) storage.estimates().filter((e) => e.objectId === v.objectId)
        .forEach((e) => storage.updateEstimate(e.id, { active: 0 }));
      const e = storage.createEstimate({ ...v, active: v.active ? 1 : 0, createdAt: new Date().toISOString() });
      audit(req, "Создана смета", e.contract, `версия ${e.version}`);
      res.json(e);
    } catch (e) { fail(res, e); }
  });

  app.patch("/api/estimates/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      const patch: any = { ...req.body };
      if (patch.active !== undefined) {
        patch.active = patch.active ? 1 : 0;
        const cur = storage.estimates().find((e) => e.id === id);
        if (patch.active && cur) storage.estimates().filter((e) => e.objectId === cur.objectId && e.id !== id)
          .forEach((e) => storage.updateEstimate(e.id, { active: 0 }));
      }
      audit(req, "Изменена смета", String(id), Object.keys(patch).join(", "));
      res.json(storage.updateEstimate(id, patch));
    } catch (e) { fail(res, e); }
  });

  app.delete("/api/estimates/:id", (req, res) => {
    try { storage.deleteEstimate(Number(req.params.id)); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });

  app.post("/api/estimate-lines", (req, res) => {
    try {
      const v = insertEstimateLineSchema.parse(req.body);
      res.json(storage.createEstimateLine({ ...v, amount: v.amount || v.qty * v.price }));
    } catch (e) { fail(res, e); }
  });
  app.patch("/api/estimate-lines/:id", (req, res) => {
    try {
      const patch: any = { ...req.body };
      if (patch.qty !== undefined || patch.price !== undefined) {
        const cur = storage.estimateLines().find((l) => l.id === Number(req.params.id));
        const qty = patch.qty ?? cur?.qty ?? 0, price = patch.price ?? cur?.price ?? 0;
        if (patch.amount === undefined) patch.amount = qty * price;
      }
      res.json(storage.updateEstimateLine(Number(req.params.id), patch));
    } catch (e) { fail(res, e); }
  });
  app.delete("/api/estimate-lines/:id", (req, res) => {
    try { storage.deleteEstimateLine(Number(req.params.id)); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });

  app.post("/api/depth-rates", (req, res) => {
    try { res.json(storage.createDepthRate(insertDepthRateSchema.parse(req.body))); } catch (e) { fail(res, e); }
  });
  app.delete("/api/depth-rates/:id", (req, res) => {
    try { storage.deleteDepthRate(Number(req.params.id)); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });

  app.post("/api/calendar/plans", (req, res) => {
    try { res.json(storage.createCalendarPlan(insertCalendarPlanSchema.parse(req.body))); } catch (e) { fail(res, e); }
  });
  app.patch("/api/calendar/plans/:id", (req, res) => {
    try { res.json(storage.updateCalendarPlan(Number(req.params.id), req.body)); } catch (e) { fail(res, e); }
  });
  app.delete("/api/calendar/plans/:id", (req, res) => {
    try { storage.deleteCalendarPlan(Number(req.params.id)); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });
  app.post("/api/calendar/stages", (req, res) => {
    try { res.json(storage.createCalendarStage(insertCalendarStageSchema.parse(req.body))); } catch (e) { fail(res, e); }
  });
  app.patch("/api/calendar/stages/:id", (req, res) => {
    try { res.json(storage.updateCalendarStage(Number(req.params.id), req.body)); } catch (e) { fail(res, e); }
  });
  app.delete("/api/calendar/stages/:id", (req, res) => {
    try { storage.deleteCalendarStage(Number(req.params.id)); res.json({ ok: true }); } catch (e) { fail(res, e); }
  });

  // ---------- Справочники и аналитика ----------
  app.get("/api/reference", (_req, res) => {
    res.json({
      objects: storage.objects(), rigs: storage.rigs(), brigades: storage.brigades(),
      employees: storage.employees(), positions: storage.positions(),
      cycleTypes: CYCLE_TYPES, thresholds: storage.getThresholds(),
      dataTypes: DATA_TYPES, importFields: IMPORT_FIELDS,
      labs: storage.labs(), analysisTypes: storage.analysisTypes(),
      equipment: storage.equipment(),
      sampleStages: SAMPLE_STAGES, sampleTypes: SAMPLE_TYPES, rejectReasons: REJECT_REASONS,
      shipMethods: SHIP_METHODS, elements: SAMPLE_ELEMENTS, assayUnits: ASSAY_UNITS,
      cutTypes: CUT_TYPES, coreLogStatuses: CORE_LOG_STATUSES, cutStatuses: CUT_STATUSES,
      cutRejectReasons: CUT_REJECT_REASONS,
    });
  });

  // ---------- Состояние заполненности программы ----------
  const orgName = () => storage.getSetting("orgName", "ГРР-Контроль");
  app.get("/api/status", (_req, res) => {
    const c = storage.counts();
    res.json({
      counts: c,
      orgName: orgName(),
      setupDone: storage.getSetting("setupDone", "0") === "1",
      hasReference: c.objects > 0,
      hasData: c.reports > 0,
    });
  });

  app.put("/api/settings/org", (req, res) => {
    try {
      const name = String(req.body?.orgName ?? "").trim();
      if (!name) throw new Error("Укажите название организации");
      storage.setSetting("orgName", name);
      res.json({ orgName: name });
    } catch (e) { fail(res, e); }
  });
  app.put("/api/settings/setup-done", (req, res) => {
    storage.setSetting("setupDone", req.body?.done === false ? "0" : "1");
    res.json({ ok: true });
  });

  // ---------- Справочники: полный CRUD ----------
  app.get("/api/ref/all", (_req, res) => {
    res.json({
      objects: storage.objects(),
      rigs: storage.rigs(),
      brigades: storage.brigades(),
      equipment: storage.equipment(),
      costItems: storage.costItems(),
      inventoryItems: storage.inventoryItems(),
      positions: storage.positions(),
      labs: storage.labs(),
      analysisTypes: storage.analysisTypes(),
      rigStatuses: RIG_STATUSES,
      equipmentKinds: EQUIPMENT_KINDS,
      assayUnits: ASSAY_UNITS,
      counts: storage.counts(),
    });
  });

  // Объекты
  app.post("/api/ref/objects", (req, res) => {
    try { res.json(storage.createObject(insertObjectSchema.parse(req.body))); } catch (e) { fail(res, e); }
  });
  app.patch("/api/ref/objects/:id", (req, res) => {
    try { res.json(storage.updateObject(Number(req.params.id), insertObjectSchema.partial().parse(req.body))); }
    catch (e) { fail(res, e); }
  });
  app.get("/api/ref/objects/:id/usage", (req, res) => res.json(storage.objectUsage(Number(req.params.id))));
  app.delete("/api/ref/objects/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      const usage = storage.objectUsage(id);
      const linked = usage.reports + usage.costs + usage.fuel + usage.inventory + usage.shifts;
      if (linked > 0 && req.query.cascade !== "1")
        return res.status(409).json({ error: "По этому объекту есть связанные данные", usage });
      storage.deleteObjectCascade(id);
      res.json({ ok: true, usage });
    } catch (e) { fail(res, e); }
  });

  // Станки
  app.post("/api/ref/rigs", (req, res) => {
    try { res.json(storage.createRig(insertRigSchema.parse(req.body))); } catch (e) { fail(res, e); }
  });
  app.patch("/api/ref/rigs/:id", (req, res) => {
    try { res.json(storage.updateRig(Number(req.params.id), insertRigSchema.partial().parse(req.body))); }
    catch (e) { fail(res, e); }
  });
  app.get("/api/ref/rigs/:id/usage", (req, res) => res.json(storage.rigUsage(Number(req.params.id))));
  app.delete("/api/ref/rigs/:id", (req, res) => {
    const id = Number(req.params.id);
    const usage = storage.rigUsage(id);
    if (usage.reports > 0 && req.query.cascade !== "1")
      return res.status(409).json({ error: "По этому станку есть рапорты", usage });
    storage.deleteRigCascade(id);
    res.json({ ok: true, usage });
  });

  // Бригады
  app.post("/api/ref/brigades", (req, res) => {
    try { res.json(storage.createBrigade(insertBrigadeSchema.parse(req.body))); } catch (e) { fail(res, e); }
  });
  app.patch("/api/ref/brigades/:id", (req, res) => {
    try { res.json(storage.updateBrigade(Number(req.params.id), insertBrigadeSchema.partial().parse(req.body))); }
    catch (e) { fail(res, e); }
  });
  app.get("/api/ref/brigades/:id/usage", (req, res) => res.json(storage.brigadeUsage(Number(req.params.id))));
  app.delete("/api/ref/brigades/:id", (req, res) => {
    const id = Number(req.params.id);
    const usage = storage.brigadeUsage(id);
    if (usage.reports + usage.employees > 0 && req.query.cascade !== "1")
      return res.status(409).json({ error: "По этой бригаде есть данные", usage });
    storage.deleteBrigadeCascade(id);
    res.json({ ok: true, usage });
  });

  // Техника для ГСМ
  app.post("/api/ref/equipment", (req, res) => {
    try { res.json(storage.createEquipment(insertEquipmentSchema.parse(req.body))); } catch (e) { fail(res, e); }
  });
  app.patch("/api/ref/equipment/:id", (req, res) => {
    try { res.json(storage.updateEquipment(Number(req.params.id), insertEquipmentSchema.partial().parse(req.body))); }
    catch (e) { fail(res, e); }
  });
  app.delete("/api/ref/equipment/:id", (req, res) => {
    storage.deleteEquipment(Number(req.params.id));
    res.json({ ok: true });
  });

  // Должности
  app.post("/api/ref/positions", (req, res) => {
    try {
      const v = insertPositionSchema.parse(req.body);
      const dup = storage.positions().find((p) => p.name.toLowerCase() === v.name.toLowerCase());
      if (dup) throw new Error("Такая должность уже есть в справочнике");
      res.json(storage.createPosition(v));
    } catch (e) { fail(res, e); }
  });
  app.patch("/api/ref/positions/:id", (req, res) => {
    try { res.json(storage.updatePosition(Number(req.params.id), insertPositionSchema.partial().parse(req.body))); }
    catch (e) { fail(res, e); }
  });
  app.get("/api/ref/positions/:id/usage", (req, res) => {
    const p = storage.positions().find((x) => x.id === Number(req.params.id));
    const used = p ? storage.employees().filter((e) => e.position === p.name).length : 0;
    res.json({ employees: used });
  });
  app.delete("/api/ref/positions/:id", (req, res) => {
    storage.deletePosition(Number(req.params.id));
    res.json({ ok: true });
  });

  // Статьи затрат
  app.post("/api/ref/cost-items", (req, res) => {
    try { res.json(storage.createCostItem(insertCostItemSchema.parse(req.body))); } catch (e) { fail(res, e); }
  });
  app.patch("/api/ref/cost-items/:id", (req, res) => {
    try { res.json(storage.updateCostItem(Number(req.params.id), insertCostItemSchema.partial().parse(req.body))); }
    catch (e) { fail(res, e); }
  });
  app.delete("/api/ref/cost-items/:id", (req, res) => {
    storage.deleteCostItem(Number(req.params.id));
    res.json({ ok: true });
  });

  // Позиции ТМЦ
  app.post("/api/ref/inventory-items", (req, res) => {
    try { res.json(storage.createInventoryItem(insertInventoryItemSchema.parse(req.body))); } catch (e) { fail(res, e); }
  });
  app.patch("/api/ref/inventory-items/:id", (req, res) => {
    try { res.json(storage.updateInventoryItem(Number(req.params.id), insertInventoryItemSchema.partial().parse(req.body))); }
    catch (e) { fail(res, e); }
  });
  app.delete("/api/ref/inventory-items/:id", (req, res) => {
    storage.deleteInventoryItem(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Начало работы с нуля ----------
  app.post("/api/maintenance/clear-demo", (_req, res) => {
    try { res.json({ ok: true, removed: storage.clearOperational(), counts: storage.counts() }); }
    catch (e) { fail(res, e, 500); }
  });
  /** Начать с чистого листа, оставив свои справочники, шаблоны, профили и пользователей */
  app.post("/api/maintenance/keep-refs", (req, res) => {
    try {
      if (String(req.body?.confirm ?? "").trim().toUpperCase() !== "ОЧИСТИТЬ")
        throw new Error("Для очистки введите слово ОЧИСТИТЬ");
      const removed = storage.clearOperational();
      storage.setSetting("setupDone", "1");
      const c = storage.counts();
      res.json({
        ok: true,
        removed,
        kept: {
          objects: c.objects, rigs: c.rigs, brigades: c.brigades,
          equipment: c.equipment, costItems: c.costItems, inventoryItems: c.inventoryItems,
          labs: c.labs, analysisTypes: c.analysisTypes,
          estimates: c.estimates, calendarPlans: c.calendarPlans,
          users: c.users, profiles: c.profiles, templates: c.templates, synonyms: c.synonyms,
        },
        counts: c,
      });
    } catch (e) { fail(res, e); }
  });

  app.post("/api/maintenance/full-reset", (req, res) => {
    try {
      if (String(req.body?.confirm ?? "").trim().toUpperCase() !== "УДАЛИТЬ")
        throw new Error("Для полного сброса введите слово УДАЛИТЬ");
      storage.fullReset();
      storage.setSetting("setupDone", "0");
      // Состав программы сбрасывается только при полном сбросе
      resetConfig();
      res.json({ ok: true, counts: storage.counts() });
    } catch (e) { fail(res, e); }
  });
  app.post("/api/maintenance/restore-demo", (_req, res) => {
    try {
      const counts = restoreDemoData();
      storage.setSetting("setupDone", "1");
      res.json({ ok: true, counts });
    } catch (e) { fail(res, e, 500); }
  });

  app.get("/api/analytics", (req, res) => {
    try {
      const a: any = buildAnalytics();
      const u = currentUser(req);
      if (u?.perm.finance) {
        const est = buildEstimateAnalytics();
        a.flags = [...a.flags, ...est.flags];
        a.estimates = { totals: est.totals, byEstimate: est.byEstimate.map((e: any) => ({
          object: e.object, spendPct: e.spendPct, volumePct: e.volumePct, lagDays: e.lagDays,
          forecastResult: e.forecastResult, breakEvenMeters: e.breakEvenMeters, idleHourCost: e.idleHourCost,
        })) };
      }
      res.json(a);
    } catch (e) { fail(res, e, 500); }
  });

  // ---------- Рапорты ----------
  app.get("/api/reports", (_req, res) => res.json(storage.reports()));
  app.post("/api/reports", (req, res) => {
    try { res.json(storage.createReport({ ...insertReportSchema.parse(req.body), importId: 0 })); }
    catch (e) { fail(res, e); }
  });
  app.patch("/api/reports/:id", (req, res) => {
    try { res.json(storage.updateReport(Number(req.params.id), insertReportSchema.parse(req.body))); }
    catch (e) { fail(res, e); }
  });
  app.delete("/api/reports/:id", (req, res) => {
    storage.deleteReport(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Затраты ----------
  app.get("/api/costs", (_req, res) => res.json(storage.costs()));
  app.post("/api/costs", (req, res) => {
    try { res.json(storage.createCost({ ...insertCostSchema.parse(req.body), importId: 0 })); }
    catch (e) { fail(res, e); }
  });
  app.delete("/api/costs/:id", (req, res) => { storage.deleteCost(Number(req.params.id)); res.json({ ok: true }); });

  // ---------- ГСМ ----------
  app.get("/api/fuel", (_req, res) => res.json(storage.fuel()));
  app.post("/api/fuel", (req, res) => {
    try { res.json(storage.createFuel({ ...insertFuelSchema.parse(req.body), importId: 0 })); }
    catch (e) { fail(res, e); }
  });
  app.delete("/api/fuel/:id", (req, res) => { storage.deleteFuel(Number(req.params.id)); res.json({ ok: true }); });

  // ---------- ТМЦ ----------
  app.get("/api/inventory", (_req, res) => res.json(storage.inventory()));
  app.post("/api/inventory", (req, res) => {
    try { res.json(storage.createInventory({ ...insertInventorySchema.parse(req.body), importId: 0 })); }
    catch (e) { fail(res, e); }
  });
  app.delete("/api/inventory/:id", (req, res) => { storage.deleteInventory(Number(req.params.id)); res.json({ ok: true }); });

  // ---------- Люди и вахты ----------
  app.get("/api/employees", (_req, res) => res.json(storage.employees()));
  app.post("/api/employees", (req, res) => {
    try { res.json(storage.createEmployee({ ...insertEmployeeSchema.parse(req.body), importId: 0 })); }
    catch (e) { fail(res, e); }
  });
  app.patch("/api/employees/:id", (req, res) => {
    try {
      const body = insertEmployeeSchema.partial().parse(req.body);
      const updated = storage.updateEmployee(Number(req.params.id), body);

      // Синхронизация со вкладкой «Отсутствия»: смена статуса сотрудника
      // автоматически открывает или закрывает соответствующую запись отсутствия.
      if (Object.prototype.hasOwnProperty.call(body, "manualStatus")) {
        const empId = Number(req.params.id);
        const todayIso = new Date().toISOString().slice(0, 10);
        const openEvent = storage.employeeEvents().find(
          (ev) => ev.employeeId === empId && ev.endDate >= todayIso
        );
        const kind = String(body.manualStatus ?? "");
        const isAbsenceKind = ["vacation", "sick", "trip", "study", "office", "pp"].includes(kind);

        if (isAbsenceKind) {
          if (openEvent && openEvent.kind === kind) {
            // уже есть открытая запись такого же типа — ничего не делаем
          } else if (openEvent) {
            // была открыта запись другого типа — закрываем её и открываем новую
            storage.updateEmployeeEvent(openEvent.id, { endDate: todayIso });
            storage.createEmployeeEvent({
              employeeId: empId, kind, startDate: todayIso,
              endDate: OPEN_ENDED_DATE, destination: "", note: "Создано автоматически из карточки сотрудника",
              createdAt: new Date().toISOString(),
            });
          } else {
            storage.createEmployeeEvent({
              employeeId: empId, kind, startDate: todayIso,
              endDate: OPEN_ENDED_DATE, destination: "", note: "Создано автоматически из карточки сотрудника",
              createdAt: new Date().toISOString(),
            });
          }
        } else if (openEvent) {
          // статус сброшен на «Автоматически» — закрываем открытую запись отсутствия
          storage.updateEmployeeEvent(openEvent.id, { endDate: todayIso });
        }
      }

      res.json(updated);
    } catch (e) { fail(res, e); }
  });
  app.delete("/api/employees/:id", (req, res) => { storage.deleteEmployee(Number(req.params.id)); res.json({ ok: true }); });

  /** Массовое назначение вахты выбранным сотрудникам */
  app.post("/api/employees/bulk-shift", (req, res) => {
    try {
      const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
      const startDate = String(req.body?.startDate ?? "").slice(0, 10);
      const cycleType = String(req.body?.cycleType ?? "").trim();
      const objectId = Number(req.body?.objectId ?? 0) || 0;
      if (!ids.length) throw new Error("Выберите хотя бы одного сотрудника");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error("Укажите дату заезда");
      if (!cycleType) throw new Error("Укажите цикл вахты");
      const days = Number(String(cycleType).split("/")[0]);
      if (!days || days < 1) throw new Error("Цикл вахты указывается в виде 30/30");
      const end = new Date(startDate + "T00:00:00Z");
      end.setUTCDate(end.getUTCDate() + days - 1);
      const endDate = end.toISOString().slice(0, 10);
      const emps = storage.employees();
      let created = 0;
      for (const id of ids) {
        const e = emps.find((x) => x.id === id);
        if (!e) continue;
        const target = objectId || e.objectId || 0;
        if (objectId && e.objectId !== objectId) storage.updateEmployee(id, { objectId });
        storage.createShift({
          employeeId: id, objectId: target, startDate, endDate, cycleType,
          replacementAssigned: 0, importId: 0,
        });
        created++;
      }
      audit(req, "Назначение вахты", "employees", `Сотрудников: ${created}, заезд ${startDate}, цикл ${cycleType}`);
      res.json({ ok: true, created, endDate });
    } catch (e) { fail(res, e); }
  });

  /** Массовое изменение объекта или должности */
  app.post("/api/employees/bulk-update", (req, res) => {
    try {
      const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
      if (!ids.length) throw new Error("Выберите хотя бы одного сотрудника");
      const patch: any = {};
      if (req.body?.objectId !== undefined && req.body?.objectId !== null && req.body?.objectId !== "")
        patch.objectId = Number(req.body.objectId) || 0;
      if (req.body?.position) patch.position = String(req.body.position).trim();
      if (!Object.keys(patch).length) throw new Error("Нечего менять: укажите объект или должность");
      let updated = 0;
      for (const id of ids) { storage.updateEmployee(id, patch); updated++; }
      audit(req, "Изменение сотрудников", "employees", `Изменено: ${updated}`);
      res.json({ ok: true, updated });
    } catch (e) { fail(res, e); }
  });

  /** Массовое удаление сотрудников */
  app.post("/api/employees/bulk-delete", (req, res) => {
    try {
      const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
      if (!ids.length) throw new Error("Выберите хотя бы одного сотрудника");
      for (const id of ids) storage.deleteEmployee(id);
      audit(req, "Удаление сотрудников", "employees", `Удалено: ${ids.length}`);
      res.json({ ok: true, deleted: ids.length });
    } catch (e) { fail(res, e); }
  });

  // ---------- Отпуска, больничные, командировки, обучение ----------
  // Синхронизация с карточкой сотрудника: если запись покрывает сегодняшний день,
  // статус сотрудника в разделе «Сотрудники» подставляется автоматически, и наоборот.
  const syncEmployeeStatusFromEvents = (employeeId: number) => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const openEvent = storage.employeeEvents().find(
      (ev) => ev.employeeId === employeeId && ev.startDate <= todayIso && ev.endDate >= todayIso
    );
    storage.updateEmployee(employeeId, { manualStatus: openEvent ? openEvent.kind : "" });
  };

  app.get("/api/employee-events", (_req, res) => res.json(storage.employeeEvents()));
  app.post("/api/employee-events", (req, res) => {
    try {
      const v = insertEmployeeEventSchema.parse(req.body);
      const created = storage.createEmployeeEvent({ ...v, createdAt: new Date().toISOString() });
      syncEmployeeStatusFromEvents(v.employeeId);
      audit(req, "Добавление отсутствия", "employee-events", `Сотрудник #${v.employeeId}, ${v.kind}, ${v.startDate}—${v.endDate}`);
      res.json(created);
    } catch (e) { fail(res, e); }
  });
  app.patch("/api/employee-events/:id", (req, res) => {
    try {
      const before = storage.employeeEvents().find((ev) => ev.id === Number(req.params.id));
      const updated = storage.updateEmployeeEvent(Number(req.params.id), insertEmployeeEventSchema.partial().parse(req.body));
      if (before) syncEmployeeStatusFromEvents(before.employeeId);
      res.json(updated);
    } catch (e) { fail(res, e); }
  });
  app.delete("/api/employee-events/:id", (req, res) => {
    const before = storage.employeeEvents().find((ev) => ev.id === Number(req.params.id));
    storage.deleteEmployeeEvent(Number(req.params.id));
    if (before) syncEmployeeStatusFromEvents(before.employeeId);
    audit(req, "Удаление отсутствия", "employee-events", `#${req.params.id}`);
    res.json({ ok: true });
  });

  // ---------- Заметки и напоминания на дашборде ----------
  app.get("/api/dashboard-notes", (_req, res) => res.json(storage.dashboardNotes()));
  app.post("/api/dashboard-notes", (req, res) => {
    try {
      const v = insertDashboardNoteSchema.parse(req.body);
      const created = storage.createDashboardNote({ ...v, createdAt: new Date().toISOString() });
      audit(req, "Добавление заметки", "dashboard-notes", v.text.slice(0, 80));
      res.json(created);
    } catch (e) { fail(res, e); }
  });
  app.patch("/api/dashboard-notes/:id", (req, res) => {
    try { res.json(storage.updateDashboardNote(Number(req.params.id), insertDashboardNoteSchema.partial().parse(req.body))); }
    catch (e) { fail(res, e); }
  });
  app.delete("/api/dashboard-notes/:id", (req, res) => {
    storage.deleteDashboardNote(Number(req.params.id));
    res.json({ ok: true });
  });

  app.get("/api/shifts", (_req, res) => res.json(storage.shifts()));
  app.post("/api/shifts", (req, res) => {
    try {
      const v = insertShiftSchema.parse(req.body);
      res.json(storage.createShift({ ...v, importId: 0 }));
    } catch (e) { fail(res, e); }
  });
  app.patch("/api/shifts/:id", (req, res) => {
    try { res.json(storage.updateShift(Number(req.params.id), req.body)); } catch (e) { fail(res, e); }
  });
  app.delete("/api/shifts/:id", (req, res) => { storage.deleteShift(Number(req.params.id)); res.json({ ok: true }); });

  // ---------- Справочник: лаборатории ----------
  app.post("/api/ref/labs", (req, res) => {
    try { res.json(storage.createLab(insertLabSchema.parse(req.body))); } catch (e) { fail(res, e); }
  });
  app.patch("/api/ref/labs/:id", (req, res) => {
    try { res.json(storage.updateLab(Number(req.params.id), insertLabSchema.partial().parse(req.body))); }
    catch (e) { fail(res, e); }
  });
  app.get("/api/ref/labs/:id/usage", (req, res) => {
    const id = Number(req.params.id);
    res.json({ batches: storage.labBatches().filter((b) => b.labId === id).length });
  });
  app.delete("/api/ref/labs/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      const used = storage.labBatches().filter((b) => b.labId === id).length;
      if (used > 0 && req.query.cascade !== "1")
        return res.status(409).json({ error: "По этой лаборатории есть отправленные партии", usage: { batches: used } });
      storage.deleteLab(id);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // ---------- Справочник: виды анализов ----------
  app.post("/api/ref/analysis-types", (req, res) => {
    try { res.json(storage.createAnalysisType(insertAnalysisTypeSchema.parse(req.body))); } catch (e) { fail(res, e); }
  });
  app.patch("/api/ref/analysis-types/:id", (req, res) => {
    try { res.json(storage.updateAnalysisType(Number(req.params.id), insertAnalysisTypeSchema.partial().parse(req.body))); }
    catch (e) { fail(res, e); }
  });
  app.get("/api/ref/analysis-types/:id/usage", (req, res) => {
    const id = Number(req.params.id);
    res.json({ batches: storage.labBatches().filter((b) => b.analysisTypeId === id).length });
  });
  app.delete("/api/ref/analysis-types/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      const used = storage.labBatches().filter((b) => b.analysisTypeId === id).length;
      if (used > 0 && req.query.cascade !== "1")
        return res.status(409).json({ error: "Этот вид анализа используется в партиях", usage: { batches: used } });
      storage.deleteAnalysisType(id);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // ---------- Пробы ----------
  app.get("/api/samples", (_req, res) => res.json(storage.samples()));
  app.get("/api/samples/:id/moves", (req, res) => {
    const id = Number(req.params.id);
    res.json(storage.sampleMoves().filter((m) => m.sampleId === id));
  });
  app.post("/api/samples", (req, res) => {
    try {
      const v = insertSampleSchema.parse(req.body);
      if (storage.samples().some((s) => s.code.toLowerCase() === v.code.toLowerCase()))
        throw new Error(`Проба с номером ${v.code} уже есть в журнале`);
      const s = storage.createSample({ ...v, importId: 0 });
      storage.createSampleMove({
        sampleId: s.id, fromStage: "", toStage: s.stage, date: s.stageDate || s.date,
        author: "Геолог", note: "Проба заведена в журнал",
      });
      res.json(s);
    } catch (e) { fail(res, e); }
  });
  app.patch("/api/samples/:id", (req, res) => {
    try { res.json(storage.updateSample(Number(req.params.id), insertSampleSchema.partial().parse(req.body))); }
    catch (e) { fail(res, e); }
  });
  app.delete("/api/samples/:id", (req, res) => {
    storage.deleteSample(Number(req.params.id));
    res.json({ ok: true });
  });

  /** Массовый перевод проб на следующий этап */
  app.post("/api/samples/bulk-stage", (req, res) => {
    try {
      const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
      const stage = String(req.body?.stage ?? "");
      const date = String(req.body?.date ?? new Date().toISOString().slice(0, 10));
      const author = String(req.body?.author ?? "Пробоподготовка");
      const note = String(req.body?.note ?? "");
      if (!ids.length) throw new Error("Не выбрано ни одной пробы");
      if (!SAMPLE_STAGES.includes(stage as any)) throw new Error("Неизвестный этап");
      const all = storage.samples();
      let moved = 0; const skipped: string[] = [];
      ids.forEach((id) => {
        const s = all.find((x) => x.id === id);
        if (!s) return;
        if (s.stage === stage) { skipped.push(`${s.code} — уже на этом этапе`); return; }
        if (s.status === "брак") { skipped.push(`${s.code} — проба в браке`); return; }
        storage.updateSample(id, { stage, stageDate: date });
        storage.createSampleMove({ sampleId: id, fromStage: s.stage, toStage: stage, date, author, note });
        moved++;
      });
      res.json({ moved, skipped });
    } catch (e) { fail(res, e); }
  });

  // ---------- Партии в лабораторию ----------
  app.get("/api/batches", (_req, res) => res.json(storage.labBatches()));
  app.post("/api/batches", (req, res) => {
    try {
      const v = insertLabBatchSchema.parse(req.body);
      const ids: number[] = Array.isArray(req.body?.sampleIds) ? req.body.sampleIds.map(Number) : [];
      const lab = storage.labs().find((l) => l.id === v.labId);
      if (!lab) throw new Error("Выберите лабораторию из справочника");
      const due = v.dueDate || new Date(new Date(v.sentDate).getTime() + lab.leadDays * 86400000)
        .toISOString().slice(0, 10);
      const b = storage.createLabBatch({ ...v, dueDate: due });
      ids.forEach((id) => {
        const s = storage.samples().find((x) => x.id === id);
        if (!s) return;
        storage.updateSample(id, { batchId: b.id, stage: "Отправлена в лабораторию", stageDate: v.sentDate });
        storage.createSampleMove({
          sampleId: id, fromStage: s.stage, toStage: "Отправлена в лабораторию", date: v.sentDate,
          author: "Пробоподготовка", note: `Партия ${b.code}`,
        });
      });
      res.json({ ...b, samples: ids.length, cost: ids.length * lab.pricePerSample });
    } catch (e) { fail(res, e); }
  });
  app.patch("/api/batches/:id", (req, res) => {
    try { res.json(storage.updateLabBatch(Number(req.params.id), insertLabBatchSchema.partial().parse(req.body))); }
    catch (e) { fail(res, e); }
  });
  app.delete("/api/batches/:id", (req, res) => {
    storage.deleteLabBatch(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Результаты анализов ----------
  app.get("/api/assays", (_req, res) => res.json(storage.assays()));
  app.post("/api/assays", (req, res) => {
    try {
      const v = insertAssaySchema.parse(req.body);
      const s = storage.samples().find((x) => x.id === v.sampleId);
      if (!s) throw new Error("Проба не найдена");
      const a = storage.createAssay({ ...v, importId: 0 });
      if (s.stage !== "Результат получен" && s.stage !== "Архив/Брак") {
        storage.updateSample(s.id, { stage: "Результат получен", stageDate: v.receivedDate });
        storage.createSampleMove({
          sampleId: s.id, fromStage: s.stage, toStage: "Результат получен",
          date: v.receivedDate, author: "Геолог", note: "Внесён результат анализа",
        });
      }
      res.json(a);
    } catch (e) { fail(res, e); }
  });
  app.delete("/api/assays/:id", (req, res) => { storage.deleteAssay(Number(req.params.id)); res.json({ ok: true }); });

  // ---------- Описание керна ----------
  const overlapCheck = (rows: { id: number; holeName: string; fromDepth: number; toDepth: number }[],
    holeName: string, from: number, to: number, selfId = 0) => {
    const clash = rows.find((r) => r.id !== selfId && r.holeName === holeName && from < r.toDepth && to > r.fromDepth);
    if (clash)
      throw new Error(`Интервал ${from}–${to} м по скважине ${holeName} пересекается с уже внесённым ${clash.fromDepth}–${clash.toDepth} м`);
  };

  app.get("/api/corelogs", (_req, res) => res.json(storage.coreLogs()));
  app.post("/api/corelogs", (req, res) => {
    try {
      const v = insertCoreLogSchema.parse(req.body);
      overlapCheck(storage.coreLogs(), v.holeName, v.fromDepth, v.toDepth);
      res.json(storage.createCoreLog({ ...v, importId: 0 }));
    } catch (e) { fail(res, e); }
  });
  app.patch("/api/corelogs/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      const v = insertCoreLogSchema.partial().parse(req.body);
      const cur = storage.coreLogs().find((x) => x.id === id);
      if (cur)
        overlapCheck(storage.coreLogs(), v.holeName ?? cur.holeName,
          v.fromDepth ?? cur.fromDepth, v.toDepth ?? cur.toDepth, id);
      res.json(storage.updateCoreLog(id, v));
    } catch (e) { fail(res, e); }
  });
  app.delete("/api/corelogs/:id", (req, res) => { storage.deleteCoreLog(Number(req.params.id)); res.json({ ok: true }); });

  // ---------- Распиловка керна ----------
  app.get("/api/corecuts", (_req, res) => res.json(storage.coreCuts()));
  app.post("/api/corecuts", (req, res) => {
    try {
      const v = insertCoreCutSchema.parse(req.body);
      overlapCheck(storage.coreCuts(), v.holeName, v.fromDepth, v.toDepth);
      res.json(storage.createCoreCut({ ...v, importId: 0 }));
    } catch (e) { fail(res, e); }
  });
  app.patch("/api/corecuts/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      const v = insertCoreCutSchema.partial().parse(req.body);
      const cur = storage.coreCuts().find((x) => x.id === id);
      if (cur)
        overlapCheck(storage.coreCuts(), v.holeName ?? cur.holeName,
          v.fromDepth ?? cur.fromDepth, v.toDepth ?? cur.toDepth, id);
      res.json(storage.updateCoreCut(id, v));
    } catch (e) { fail(res, e); }
  });
  app.delete("/api/corecuts/:id", (req, res) => { storage.deleteCoreCut(Number(req.params.id)); res.json({ ok: true }); });

  // ---------- Настройки ----------
  app.get("/api/settings", (_req, res) => {
    res.json({
      thresholds: storage.getThresholds(),
      defaults: DEFAULT_THRESHOLDS,
      objects: storage.objects(),
      brigades: storage.brigades(),
      rigs: storage.rigs(),
    });
  });
  app.put("/api/settings/thresholds", (req, res) => {
    try { res.json(storage.setThresholds(req.body)); } catch (e) { fail(res, e); }
  });
  app.patch("/api/settings/objects/:id", (req, res) => {
    try {
      const b = req.body ?? {};
      const patch: any = {};
      ["planMetersMonth", "pricePerMeter", "plannedCostPerMeter", "contractVolume", "staffRequired"]
        .forEach((k) => { if (b[k] !== undefined && b[k] !== "") patch[k] = Number(b[k]); });
      if (b.contractEnd) patch.contractEnd = String(b.contractEnd);
      res.json(storage.updateObject(Number(req.params.id), patch));
    } catch (e) { fail(res, e); }
  });
  app.patch("/api/settings/brigades/:id", (req, res) => {
    try { res.json(storage.updateBrigade(Number(req.params.id), { staffPlan: Number(req.body.staffPlan) })); }
    catch (e) { fail(res, e); }
  });

  // ---------- Импорт ----------
  app.post("/api/import/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return fail(res, new Error("Файл не получен. Выберите файл .xlsx, .xls или .csv"));
      const parsed = await parseUpload(req.file.buffer, req.file.originalname);
      res.json(parsed);
    } catch (e) { fail(res, e); }
  });

  app.post("/api/import/mapping", (req, res) => {
    try {
      const { headers, type } = req.body as { headers: string[]; type: DataType };
      res.json({ mapping: suggestMapping(headers, type) });
    } catch (e) { fail(res, e); }
  });

  app.post("/api/import/preview", (req, res) => {
    try {
      const { uploadId, type, mapping } = req.body;
      const r = analyzeRows(uploadId, type, mapping);
      const { allItems, ...rest } = r;
      res.json(rest);
    } catch (e) { fail(res, e); }
  });

  app.post("/api/import/commit", (req, res) => {
    try {
      const { uploadId, type, mapping, duplicateStrategy } = req.body;
      res.json(commitImport(uploadId, type, mapping, duplicateStrategy ?? "skip"));
    } catch (e) { fail(res, e); }
  });

  app.get("/api/import/logs", (_req, res) => res.json(storage.importLogs()));
  app.post("/api/import/logs/:id/rollback", (req, res) => {
    try { res.json(storage.rollbackImport(Number(req.params.id))); } catch (e) { fail(res, e); }
  });

  app.post("/api/import/refs", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return fail(res, new Error("Файл не получен. Выберите файл .xlsx"));
      res.json(await importRefs(req.file.buffer, req.file.originalname));
    } catch (e) { fail(res, e); }
  });

  app.get("/api/import/refs-sheets", (_req, res) => res.json(REFS_SHEETS));

  app.get("/api/import/template/:type", async (req, res) => {
    try {
      if (req.params.type === "refs") {
        const wb = await buildRefsTemplate();
        return await sendWorkbook(res, wb, "Шаблон — Справочники.xlsx");
      }
      const type = req.params.type as DataType;
      if (!DATA_TYPES[type]) return fail(res, new Error("Неизвестный тип файла"));
      // шаблон берётся из редактора шаблонов, если пользователь его изменил
      const { wb, fileName } = await buildTemplateWorkbook(type);
      await sendWorkbook(res, wb, fileName);
    } catch (e) { fail(res, e, 500); }
  });

  // ---------- Редактор шаблонов Excel ----------
  const who = (req: Request) => {
    const u = currentUser(req);
    return u ? `${u.fio || u.login} (${u.perm.label})` : "";
  };

  app.get("/api/templates", (_req, res) => {
    try {
      res.json({
        templates: listTemplates().map((d) => ({ ...d, columnsCount: d.columns.length })),
        dataTypes: DATA_TYPES,
      });
    } catch (e) { fail(res, e, 500); }
  });

  app.get("/api/templates/:code", (req, res) => {
    try {
      const def = templateDef(req.params.code);
      if (!def) return fail(res, new Error("Шаблон не найден"), 404);
      res.json({ def, preview: previewRows(def, 3) });
    } catch (e) { fail(res, e, 500); }
  });

  app.put("/api/templates/:code", (req, res) => {
    try {
      const body = templateSaveSchema.parse(req.body);
      const def = saveTemplateDef(req.params.code, body as any, who(req));
      res.json({ def, preview: previewRows(def, 3) });
    } catch (e) { fail(res, e); }
  });

  app.post("/api/templates", (req, res) => {
    try {
      const body = templateSaveSchema.parse(req.body);
      const def = createTemplateDef(body as any, who(req));
      res.json({ def, preview: previewRows(def, 3) });
    } catch (e) { fail(res, e); }
  });

  app.post("/api/templates/:code/reset", (req, res) => {
    try {
      const def = resetTemplateDef(req.params.code);
      res.json({ def, preview: previewRows(def, 3) });
    } catch (e) { fail(res, e); }
  });

  app.delete("/api/templates/:code", (req, res) => {
    try { res.json(deleteTemplateDef(req.params.code)); } catch (e) { fail(res, e); }
  });

  app.get("/api/templates/:code/xlsx", async (req, res) => {
    try {
      const { wb, fileName } = await buildTemplateWorkbook(req.params.code);
      await sendWorkbook(res, wb, fileName);
    } catch (e) { fail(res, e, 500); }
  });

  app.post("/api/templates/from-file", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return fail(res, new Error("Файл не получен. Выберите файл .xlsx, .xls или .csv"));
      res.json(await proposeFromFile(req.file.buffer, req.file.originalname));
    } catch (e) { fail(res, e); }
  });

  // ---------- Брендирование: название, реквизиты, логотип, подпись ----------
  app.get("/api/branding", (_req, res) => {
    try { res.json(brandingInfo()); } catch (e) { fail(res, e, 500); }
  });

  app.put("/api/branding", (req, res) => {
    try {
      const body = brandingSchema.parse(req.body);
      if (body.logo && body.logo.length > 1_500_000)
        throw new Error("Логотип слишком большой. Загрузите файл до 1 МБ");
      if (body.logo && !/^data:image\/(png|jpe?g);base64,/i.test(body.logo))
        throw new Error("Логотип принимается в формате PNG или JPG");
      res.json(saveBranding(body as any));
    } catch (e) { fail(res, e); }
  });

  // ---------- Выгрузки Excel ----------
  const exportNames: Record<string, string> = {
    reports: "Бурение и простои", economics: "Экономика", fuel: "ГСМ и запасы",
    crew: "Сотрудники и вахты", summary: "Сводка для директора",
    sampleprep: "Пробоподготовка", core: "Керн и распиловка",
  };
  app.get("/api/export/:section", async (req, res) => {
    try {
      const s = req.params.section;
      const sheets: SheetKey[] = s === "all"
        ? ["summary", "reports", "economics", "fuel", "crew", "sampleprep", "core"]
        : [s as SheetKey];
      if (s !== "all" && !exportNames[s]) return fail(res, new Error("Неизвестный раздел выгрузки"));
      const wb = await buildWorkbook(sheets);
      const date = new Date().toISOString().slice(0, 10);
      const name = s === "all" ? `ГРР-Контроль — все данные ${date}.xlsx` : `ГРР-Контроль — ${exportNames[s]} ${date}.xlsx`;
      await sendWorkbook(res, wb, name);
    } catch (e) { fail(res, e, 500); }
  });

  app.get("/api/export/summary/xlsx/:period", async (req, res) => {
    try {
      const p = req.params.period as "day" | "week" | "month";
      const wb = await buildSummaryWorkbook(p);
      await sendWorkbook(res, wb, `Сводка для директора (${p === "day" ? "сутки" : p === "week" ? "неделя" : "месяц"}).xlsx`);
    } catch (e) { fail(res, e, 500); }
  });

  app.get("/api/export/summary/docx/:period", async (req, res) => {
    try {
      const p = req.params.period as "day" | "week" | "month";
      const a = buildAnalytics();
      const s = a.summaries[p];
      const heads = ["СУТЬ", "ВЫВОДЫ", "РИСКИ", "ЧТО РЕШИТЬ"];
      const children = s.text.split("\n").map((line, i) => {
        if (i === 0)
          return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: line, bold: true })] });
        if (heads.includes(line.trim()))
          return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240 }, children: [new TextRun({ text: line, bold: true })] });
        return new Paragraph({ children: [new TextRun(line)] });
      });
      const doc = new Document({ sections: [{ children }] });
      const buf = await Packer.toBuffer(doc);
      const fileName = `Сводка для директора (${p === "day" ? "сутки" : p === "week" ? "неделя" : "месяц"}).docx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition",
        `attachment; filename="summary.docx"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      res.end(buf);
    } catch (e) { fail(res, e, 500); }
  });

  return httpServer;
}
