import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/** Объекты (участки ГРР) */
export const objects = sqliteTable("objects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  customer: text("customer").notNull(),
  region: text("region").notNull(),
  planMetersMonth: real("plan_meters_month").notNull(),
  contractVolume: real("contract_volume").notNull(),
  contractEnd: text("contract_end").notNull(),
  pricePerMeter: real("price_per_meter").notNull(),
  plannedCostPerMeter: real("planned_cost_per_meter").notNull(),
  staffRequired: integer("staff_required").notNull(),
});

/** Буровые станки */
export const rigs = sqliteTable("rigs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  model: text("model").notNull(),
  objectId: integer("object_id").notNull(),
  status: text("status").notNull().default("в работе"),
});

export const RIG_STATUSES = ["в работе", "ремонт", "резерв"] as const;

/** Техника для учёта ГСМ */
export const equipment = sqliteTable("equipment", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("станок"), // станок | ДЭС | автотранспорт
  objectId: integer("object_id").notNull().default(0),
  normLiters: real("norm_liters").notNull().default(0),
});

export const EQUIPMENT_KINDS = ["станок", "ДЭС", "автотранспорт", "Камнерезный станок"] as const;

/** Справочник статей затрат */
export const costItems = sqliteTable("cost_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
});

/** Справочник позиций ТМЦ */
export const inventoryItems = sqliteTable("inventory_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("шт"),
  minQty: real("min_qty").notNull().default(0),
});

/** Бригады */
export const brigades = sqliteTable("brigades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  objectId: integer("object_id").notNull(),
  staffPlan: integer("staff_plan").notNull(),
});

/** Сменные рапорты */
export const reports = sqliteTable("reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  objectId: integer("object_id").notNull(),
  rigId: integer("rig_id").notNull(),
  brigadeId: integer("brigade_id").notNull(),
  shift: text("shift").notNull(), // день | ночь
  meters: real("meters").notNull(),
  drillHours: real("drill_hours").notNull(),
  pzrHours: real("pzr_hours").notNull(),
  downtimeHours: real("downtime_hours").notNull(),
  downtimeReason: text("downtime_reason").notNull().default("нет"),
  comment: text("comment").notNull().default(""),
  holeName: text("hole_name").notNull().default(""),
  importId: integer("import_id").notNull().default(0),
});

/** Описание керна геологами */
export const coreLogs = sqliteTable("core_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  objectId: integer("object_id").notNull().default(0),
  holeName: text("hole_name").notNull().default(""),
  fromDepth: real("from_depth").notNull().default(0),
  toDepth: real("to_depth").notNull().default(0),
  geologistId: integer("geologist_id").notNull().default(0),
  recoveryPct: real("recovery_pct").notNull().default(100),
  lithology: text("lithology").notNull().default(""),
  mineralization: integer("mineralization").notNull().default(0),
  mineralizationNote: text("mineralization_note").notNull().default(""),
  photo: integer("photo").notNull().default(0),
  status: text("status").notNull().default("описано"),
  importId: integer("import_id").notNull().default(0),
});

/** Распиловка керна */
export const coreCuts = sqliteTable("core_cuts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  objectId: integer("object_id").notNull().default(0),
  holeName: text("hole_name").notNull().default(""),
  fromDepth: real("from_depth").notNull().default(0),
  toDepth: real("to_depth").notNull().default(0),
  worker: text("worker").notNull().default(""),
  shift: text("shift").notNull().default("день"),
  cutType: text("cut_type").notNull().default("продольная"),
  equipmentId: integer("equipment_id").notNull().default(0),
  rejectMeters: real("reject_meters").notNull().default(0),
  rejectReason: text("reject_reason").notNull().default(""),
  status: text("status").notNull().default("распилено"),
  importId: integer("import_id").notNull().default(0),
});

export const CUT_TYPES = ["продольная", "поперечная"] as const;
export const CORE_LOG_STATUSES = ["описано", "требует уточнения"] as const;
export const CUT_STATUSES = ["распилено", "требует повтора"] as const;
export const CUT_REJECT_REASONS = [
  "раскрошился керн", "сколы при подаче", "износ диска", "перекос интервала", "прочее",
] as const;

/** Фактические затраты по объекту и месяцу */
export const costs = sqliteTable("costs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  objectId: integer("object_id").notNull(),
  month: text("month").notNull(), // YYYY-MM
  category: text("category").notNull(),
  amount: real("amount").notNull(),
  importId: integer("import_id").notNull().default(0),
});

/** Расход ГСМ */
export const fuel = sqliteTable("fuel", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  objectId: integer("object_id").notNull(),
  unitName: text("unit_name").notNull(),
  normLiters: real("norm_liters").notNull(),
  factLiters: real("fact_liters").notNull(),
  importId: integer("import_id").notNull().default(0),
});

/** Остатки ТМЦ */
export const inventory = sqliteTable("inventory", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  objectId: integer("object_id").notNull(),
  itemName: text("item_name").notNull(),
  qty: real("qty").notNull(),
  unit: text("unit").notNull(),
  minQty: real("min_qty").notNull(),
  dailyUse: real("daily_use").notNull(),
  expectedDelivery: text("expected_delivery").notNull().default(""),
  importId: integer("import_id").notNull().default(0),
});

/** Сотрудники */
export const employees = sqliteTable("employees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fio: text("fio").notNull(),
  position: text("position").notNull(),
  objectId: integer("object_id").notNull(),
  brigadeId: integer("brigade_id").notNull(),
  phone: text("phone").notNull().default(""),
  importId: integer("import_id").notNull().default(0),
  manualStatus: text("manual_status").notNull().default(""),
});

/** Отпуска, больничные, командировки, обучение — с датами начала и окончания */
export const employeeEvents = sqliteTable("employee_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id").notNull(),
  kind: text("kind").notNull(), // vacation | sick | trip | study
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  destination: text("destination").notNull().default(""),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(""),
});
export type EmployeeEvent = typeof employeeEvents.$inferSelect;

export const EMPLOYEE_EVENT_KINDS = ["vacation", "sick", "trip", "study", "office", "pp"] as const;
export const OPEN_ENDED_DATE = "9999-12-31";

export const EMPLOYEE_EVENT_LABELS: Record<string, string> = {
  vacation: "Отпуск",
  sick: "Больничный",
  trip: "Командировка",
  study: "Обучение",
  office: "Офис",
  pp: "Работа в ПП",
};

export const insertEmployeeEventSchema = createInsertSchema(employeeEvents).omit({ id: true }).extend({
  employeeId: z.coerce.number().min(1, "Выберите сотрудника"),
  kind: z.string().refine((k) => (EMPLOYEE_EVENT_KINDS as readonly string[]).includes(k), "Неизвестный тип события"),
  startDate: z.string().min(1, "Укажите дату начала"),
  endDate: z.string().min(1, "Укажите дату окончания"),
  destination: z.string().default(""),
  note: z.string().default(""),
}).refine((v) => v.endDate >= v.startDate, {
  message: "Дата окончания не может быть раньше даты начала", path: ["endDate"],
});

/** Заметки и напоминания на дашборде: произвольная запись с необязательной датой напоминания */
export const dashboardNotes = sqliteTable("dashboard_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  remindDate: text("remind_date").notNull().default(""), // если указано — подсвечивать/напоминать в этот день
  done: integer("done").notNull().default(0),
  createdAt: text("created_at").notNull().default(""),
});
export type DashboardNote = typeof dashboardNotes.$inferSelect;

export const insertDashboardNoteSchema = createInsertSchema(dashboardNotes).omit({ id: true }).extend({
  text: z.string().min(1, "Введите текст заметки"),
  remindDate: z.string().default(""),
  done: z.coerce.number().default(0),
});

/** Справочник должностей */
export const positions = sqliteTable("positions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
});

/** Вахты */
export const shifts = sqliteTable("shifts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id").notNull(),
  objectId: integer("object_id").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  cycleType: text("cycle_type").notNull(), // 30/30, 60/30, свой
  replacementAssigned: integer("replacement_assigned").notNull().default(0),
  importId: integer("import_id").notNull().default(0),
});

/** Журнал импортов */
export const importLogs = sqliteTable("import_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: text("created_at").notNull(),
  fileName: text("file_name").notNull(),
  dataType: text("data_type").notNull(),
  rowsLoaded: integer("rows_loaded").notNull(),
  rowsSkipped: integer("rows_skipped").notNull(),
  rowsError: integer("rows_error").notNull(),
  author: text("author").notNull().default("Аналитик"),
  issues: text("issues").notNull().default("[]"),
  rolledBack: integer("rolled_back").notNull().default(0),
});

/* ==================== Пробоподготовка ==================== */

/** Справочник лабораторий */
export const labs = sqliteTable("labs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  city: text("city").notNull().default(""),
  leadDays: integer("lead_days").notNull().default(14),
  pricePerSample: real("price_per_sample").notNull().default(0),
  analyses: text("analyses").notNull().default(""),
});

/** Справочник видов анализов */
export const analysisTypes = sqliteTable("analysis_types", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  elements: text("elements").notNull().default(""),
  unit: text("unit").notNull().default("г/т"),
});

/** Журнал проб */
export const samples = sqliteTable("samples", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull(),
  date: text("date").notNull(),
  objectId: integer("object_id").notNull().default(0),
  rigId: integer("rig_id").notNull().default(0),
  holeName: text("hole_name").notNull().default(""),
  fromDepth: real("from_depth").notNull().default(0),
  toDepth: real("to_depth").notNull().default(0),
  sampleType: text("sample_type").notNull().default("керновая"),
  weightKg: real("weight_kg").notNull().default(0),
  geologistId: integer("geologist_id").notNull().default(0),
  stage: text("stage").notNull().default("Отобрана"),
  stageDate: text("stage_date").notNull().default(""),
  status: text("status").notNull().default("в работе"),
  rejectReason: text("reject_reason").notNull().default(""),
  batchId: integer("batch_id").notNull().default(0),
  note: text("note").notNull().default(""),
  importId: integer("import_id").notNull().default(0),
});

/** Движение проб по этапам */
export const sampleMoves = sqliteTable("sample_moves", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sampleId: integer("sample_id").notNull(),
  fromStage: text("from_stage").notNull().default(""),
  toStage: text("to_stage").notNull(),
  date: text("date").notNull(),
  author: text("author").notNull().default("Пробоподготовка"),
  note: text("note").notNull().default(""),
});

/** Отправки партий в лабораторию */
export const labBatches = sqliteTable("lab_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull(),
  labId: integer("lab_id").notNull().default(0),
  analysisTypeId: integer("analysis_type_id").notNull().default(0),
  sentDate: text("sent_date").notNull(),
  dueDate: text("due_date").notNull().default(""),
  shipMethod: text("ship_method").notNull().default("транспортная компания"),
  waybill: text("waybill").notNull().default(""),
  status: text("status").notNull().default("в лаборатории"),
  resultDate: text("result_date").notNull().default(""),
  note: text("note").notNull().default(""),
});

/** Результаты анализов */
export const assays = sqliteTable("assays", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sampleId: integer("sample_id").notNull(),
  element: text("element").notNull().default("Au"),
  value: real("value").notNull().default(0),
  unit: text("unit").notNull().default("г/т"),
  receivedDate: text("received_date").notNull().default(""),
  importId: integer("import_id").notNull().default(0),
});

export const SAMPLE_STAGES = [
  "Отобрана",
  "Принята в пробоподготовку",
  "Сушка",
  "Дробление",
  "Сокращение",
  "Измельчение",
  "Упакована",
  "Отправлена в лабораторию",
  "Результат получен",
  "Архив/Брак",
] as const;

export const SAMPLE_TYPES = [
  "керновая",
  "дубликат",
  "контрольная (стандарт)",
  "пустышка (бланк)",
  "шламовая",
  "бороздовая",
] as const;

export const CONTROL_TYPES = ["дубликат", "контрольная (стандарт)", "пустышка (бланк)"] as const;

export const REJECT_REASONS = [
  "недостаточный вес",
  "потеря пробы",
  "нарушение упаковки",
  "загрязнение",
  "прочее",
] as const;

export const SHIP_METHODS = [
  "транспортная компания",
  "автотранспорт компании",
  "авиа",
  "курьер",
] as const;

export const SAMPLE_ELEMENTS = ["Au", "Ag", "Cu", "Pb", "Zn"] as const;
export const ASSAY_UNITS = ["г/т", "%", "ppm"] as const;

/** Настройки (ключ → значение JSON) */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type ImportLog = typeof importLogs.$inferSelect;

export const DATA_TYPES = {
  reports: "Сменные рапорты по бурению",
  costs: "Затраты по объектам",
  fuel: "Расход ГСМ",
  inventory: "Остатки ТМЦ",
  crew: "Вахтовый график",
  employees: "Сотрудники",
  assays: "Результаты анализов проб",
  corelogs: "Описание керна",
  corecuts: "Распиловка керна",
} as const;
export type DataType = keyof typeof DATA_TYPES;

/** Поля программы для сопоставления колонок */
export const IMPORT_FIELDS: Record<DataType, { key: string; label: string; required: boolean; aliases: string[] }[]> = {
  reports: [
    { key: "date", label: "Дата", required: true, aliases: ["дата", "датасмены", "день", "date", "датарапорта"] },
    { key: "object", label: "Объект", required: true, aliases: ["объект", "участок", "площадь", "объектработ", "месторождение"] },
    { key: "rig", label: "Станок", required: true, aliases: ["станок", "бу", "установка", "буроваяустановка", "буровая", "агрегат"] },
    { key: "brigade", label: "Сменный мастер", required: false, aliases: ["сменныймастер", "мастер", "бригада", "звено", "вахта", "смена№"] },
    { key: "shift", label: "Смена (день/ночь)", required: false, aliases: ["смена", "сменадн", "деньночь", "типсмены"] },
    { key: "meters", label: "Метры за смену", required: true, aliases: ["метры", "м", "проходка", "объём", "объем", "метраж", "пробурено"] },
    { key: "drillHours", label: "Часы бурения", required: false, aliases: ["часыбурения", "бурение", "чбур", "времябурения"] },
    { key: "pzrHours", label: "Часы ПЗР", required: false, aliases: ["часыпзр", "пзр", "подготовительные"] },
    { key: "downtimeHours", label: "Часы простоя", required: false, aliases: ["часыпростоя", "простой", "простои", "чпростоя"] },
    { key: "downtimeReason", label: "Причина простоя", required: false, aliases: ["причинапростоя", "причина", "комментарийпростоя"] },
    { key: "comment", label: "Комментарий", required: false, aliases: ["комментарий", "примечание", "заметка"] },
  ],
  costs: [
    { key: "object", label: "Объект", required: true, aliases: ["объект", "участок", "договор"] },
    { key: "month", label: "Месяц (ГГГГ-ММ)", required: true, aliases: ["месяц", "период", "дата"] },
    { key: "category", label: "Статья затрат", required: true, aliases: ["статья", "статьязатрат", "категория", "наименование"] },
    { key: "amount", label: "Сумма, руб.", required: true, aliases: ["сумма", "затраты", "руб", "стоимость", "факт"] },
  ],
  fuel: [
    { key: "date", label: "Дата", required: true, aliases: ["дата", "день", "date"] },
    { key: "object", label: "Объект", required: true, aliases: ["объект", "участок"] },
    { key: "unitName", label: "Единица техники", required: true, aliases: ["техника", "единицатехники", "машина", "станок", "агрегат", "наименование"] },
    { key: "normLiters", label: "Норма, л", required: true, aliases: ["норма", "нормал", "поднорме", "нормарасхода"] },
    { key: "factLiters", label: "Факт, л", required: true, aliases: ["факт", "фактл", "фактическийрасход", "расход"] },
  ],
  inventory: [
    { key: "itemName", label: "Позиция", required: true, aliases: ["позиция", "наименование", "тмц", "материал"] },
    { key: "object", label: "Объект", required: true, aliases: ["объект", "участок", "склад"] },
    { key: "qty", label: "Остаток", required: true, aliases: ["остаток", "количество", "колво", "наличие"] },
    { key: "unit", label: "Ед. изм.", required: false, aliases: ["единица", "едизм", "ед", "единицаизмерения"] },
    { key: "minQty", label: "Минимальный запас", required: false, aliases: ["минимум", "минзапас", "минимальныйзапас", "неснижаемыйостаток"] },
    { key: "dailyUse", label: "Средний расход в сутки", required: false, aliases: ["расходвсутки", "суточныйрасход", "среднийрасход"] },
    { key: "expectedDelivery", label: "Ожидаемая поставка", required: false, aliases: ["поставка", "датапоставки", "ожидаемаяпоставка"] },
  ],
  crew: [
    { key: "fio", label: "ФИО", required: true, aliases: ["фио", "сотрудник", "работник", "фамилия"] },
    { key: "position", label: "Должность", required: false, aliases: ["должность", "профессия", "специальность"] },
    { key: "object", label: "Объект", required: true, aliases: ["объект", "участок"] },
    { key: "startDate", label: "Дата заезда", required: true, aliases: ["датазаезда", "заезд", "начало", "дата"] },
    { key: "cycleType", label: "Тип цикла", required: false, aliases: ["типцикла", "цикл", "вахта", "график"] },
    { key: "phone", label: "Телефон", required: false, aliases: ["телефон", "тел", "контакт"] },
  ],
  employees: [
    { key: "fio", label: "ФИО", required: true, aliases: ["фио", "имя", "сотрудник", "работник", "фамилия", "фамилияинициалы", "фамилияимяотчество"] },
    { key: "position", label: "Должность", required: false, aliases: ["должность", "должностьпоштатномурасписанию", "штатнаядолжность", "профессия", "специальность", "позиция"] },
    { key: "object", label: "Объект", required: false, aliases: ["объект", "участок", "площадь", "месторождение"] },
    { key: "phone", label: "Телефон", required: false, aliases: ["телефон", "тел", "контакт", "мобильный"] },
    { key: "startDate", label: "Дата заезда", required: false, aliases: ["датазаезда", "заезд", "начало", "дата", "началовахты"] },
    { key: "cycleType", label: "Цикл вахты", required: false, aliases: ["циклвахты", "типцикла", "цикл", "график", "вахтовыйцикл"] },
  ],
  assays: [
    { key: "sampleCode", label: "Номер пробы", required: true, aliases: ["номерпробы", "проба", "номер", "шифрпробы", "sampleid", "sample", "№пробы"] },
    { key: "element", label: "Элемент", required: true, aliases: ["элемент", "компонент", "металл", "element", "au", "показатель"] },
    { key: "value", label: "Содержание", required: true, aliases: ["содержание", "значение", "результат", "концентрация", "grade", "value"] },
    { key: "unit", label: "Ед. изм. (г/т, %, ppm)", required: false, aliases: ["единица", "едизм", "ед", "единицаизмерения", "unit"] },
    { key: "receivedDate", label: "Дата получения результата", required: false, aliases: ["дата", "датарезультата", "датаполучения", "датаанализа"] },
  ],
  corelogs: [
    { key: "date", label: "Дата", required: true, aliases: ["дата", "день", "датаописания", "date"] },
    { key: "object", label: "Объект", required: true, aliases: ["объект", "участок", "площадь"] },
    { key: "hole", label: "Скважина", required: true, aliases: ["скважина", "скв", "номерскважины", "hole", "holeid"] },
    { key: "fromDepth", label: "Интервал от, м", required: true, aliases: ["от", "отм", "интервалот", "глубинаот", "from"] },
    { key: "toDepth", label: "Интервал до, м", required: true, aliases: ["до", "дом", "интервалдо", "глубинадо", "to"] },
    { key: "geologist", label: "Геолог", required: false, aliases: ["геолог", "документатор", "фио", "исполнитель"] },
    { key: "recoveryPct", label: "Выход керна, %", required: false, aliases: ["выходкерна", "выход", "recovery", "выходкернапроц"] },
    { key: "lithology", label: "Литология / описание", required: false, aliases: ["литология", "описание", "породы", "характеристика"] },
    { key: "mineralization", label: "Признаки минерализации (да/нет)", required: false, aliases: ["минерализация", "признакиминерализации", "рудность"] },
    { key: "photo", label: "Фотодокументация (да/нет)", required: false, aliases: ["фото", "фотодокументация", "фотографии"] },
    { key: "status", label: "Статус", required: false, aliases: ["статус", "состояние"] },
  ],
  corecuts: [
    { key: "date", label: "Дата", required: true, aliases: ["дата", "день", "датараспиловки", "date"] },
    { key: "object", label: "Объект", required: true, aliases: ["объект", "участок", "площадь"] },
    { key: "hole", label: "Скважина", required: true, aliases: ["скважина", "скв", "номерскважины", "hole"] },
    { key: "fromDepth", label: "Интервал от, м", required: true, aliases: ["от", "отм", "интервалот", "глубинаот", "from"] },
    { key: "toDepth", label: "Интервал до, м", required: true, aliases: ["до", "дом", "интервалдо", "глубинадо", "to"] },
    { key: "worker", label: "Исполнитель", required: false, aliases: ["исполнитель", "фио", "распиловщик", "работник"] },
    { key: "shift", label: "Смена", required: false, aliases: ["смена", "деньночь", "типсмены"] },
    { key: "cutType", label: "Тип распиловки", required: false, aliases: ["типраспиловки", "тип", "распиловка"] },
    { key: "rejectMeters", label: "Брак при распиловке, м", required: false, aliases: ["брак", "бракм", "бракметры", "потери"] },
    { key: "rejectReason", label: "Причина брака", required: false, aliases: ["причинабрака", "причина", "комментарий"] },
    { key: "status", label: "Статус", required: false, aliases: ["статус", "состояние"] },
  ],
};

export const DEFAULT_THRESHOLDS = {
  planLagPct: 10,
  downtimeSharePct: 20,
  fuelOverPct: 10,
  costOverPct: 10,
  stockDaysMin: 7,
  rotationEndDays: 5,
  silenceDays: 2,
  // Пробоподготовка
  stageQueueMax: 35,
  stageStuckDays: 7,
  dupSharePct: 5,
  stdSharePct: 3,
  blankSharePct: 2,
  dupDeviationPct: 20,
  rejectSharePct: 3,
  samplesPerMeter: 0.5,
  labNoResultDays: 5,
  oreAuGt: 1,
  oreAgGt: 30,
  oreCuPct: 0.4,
  // Керн: описание и распиловка
  coreRecoveryMin: 90,
  coreLagMeters: 250,
  coreLagDays: 5,
  cutLagMeters: 350,
  cutLagDays: 6,
  geologistNormMpd: 45,
  cutRejectPct: 3,
  logDelayDays: 10,
  lagGrowDays: 3,
  // Сметы и календарный план
  budgetAheadPP: 10,
  costPerMeterOverPct: 10,
  calendarLagDays: 10,
  forecastOverPct: 3,
};
export type Thresholds = typeof DEFAULT_THRESHOLDS;

export const DOWNTIME_REASONS = [
  "погода",
  "поломка техники",
  "нет ГСМ",
  "нет решения заказчика",
  "переезд",
  "ремонт/ТО",
  "отсутствие персонала",
  "прочее",
] as const;

export const COST_CATEGORIES = [
  "ГСМ",
  "Зарплата",
  "Буровой инструмент",
  "Транспорт",
  "Содержание лагеря",
  "Ремонты",
  "Прочее/накладные",
] as const;

export const POSITIONS = [
  "Бурильщик",
  "Помощник бурильщика",
  "Буровой мастер",
  "Геолог",
  "Геолог-документатор",
  "Машинист",
  "Механик",
  "Водитель",
  "Пробоподготовщик",
  "Повар",
  "Мастер участка",
] as const;

/** Цикл вахты по умолчанию */
export const CYCLE_TYPES = ["30/30", "60/30", "15/15", "45/45", "60/60"] as const;

export const insertObjectSchema = createInsertSchema(objects).omit({ id: true }).extend({
  name: z.string().min(1, "Укажите название объекта"),
  customer: z.string().default(""),
  region: z.string().default(""),
  planMetersMonth: z.coerce.number().min(0).default(0),
  contractVolume: z.coerce.number().min(0).default(0),
  contractEnd: z.string().default(""),
  pricePerMeter: z.coerce.number().min(0).default(0),
  plannedCostPerMeter: z.coerce.number().min(0).default(0),
  staffRequired: z.coerce.number().min(0).default(0),
});
export const insertRigSchema = createInsertSchema(rigs).omit({ id: true }).extend({
  name: z.string().min(1, "Укажите название или номер станка"),
  model: z.string().default(""),
  objectId: z.coerce.number().default(0),
  status: z.string().default("в работе"),
});
export const insertBrigadeSchema = createInsertSchema(brigades).omit({ id: true }).extend({
  name: z.string().min(1, "Укажите название бригады"),
  objectId: z.coerce.number().default(0),
  staffPlan: z.coerce.number().min(0).default(0),
});
export const insertEquipmentSchema = createInsertSchema(equipment).omit({ id: true }).extend({
  name: z.string().min(1, "Укажите название техники"),
  kind: z.string().default("станок"),
  objectId: z.coerce.number().default(0),
  normLiters: z.coerce.number().min(0).default(0),
});
export const insertCostItemSchema = createInsertSchema(costItems).omit({ id: true }).extend({
  name: z.string().min(1, "Укажите название статьи затрат"),
});
export const insertInventoryItemSchema = createInsertSchema(inventoryItems).omit({ id: true }).extend({
  name: z.string().min(1, "Укажите название позиции"),
  unit: z.string().default("шт"),
  minQty: z.coerce.number().min(0).default(0),
});
export const insertReportSchema = createInsertSchema(reports)
  .omit({ id: true })
  .extend({
    meters: z.coerce.number().min(0, "Метры не могут быть отрицательными"),
    drillHours: z.coerce.number().min(0),
    pzrHours: z.coerce.number().min(0),
    downtimeHours: z.coerce.number().min(0),
    objectId: z.coerce.number(),
    rigId: z.coerce.number(),
    brigadeId: z.coerce.number(),
  })
  .refine((v) => v.drillHours + v.pzrHours + v.downtimeHours <= 12, {
    message: "Сумма часов за смену не может превышать 12",
    path: ["drillHours"],
  });
export const insertCostSchema = createInsertSchema(costs).omit({ id: true }).extend({
  amount: z.coerce.number().min(0),
  objectId: z.coerce.number(),
});
export const insertFuelSchema = createInsertSchema(fuel).omit({ id: true }).extend({
  normLiters: z.coerce.number().min(0),
  factLiters: z.coerce.number().min(0),
  objectId: z.coerce.number(),
});
export const insertInventorySchema = createInsertSchema(inventory).omit({ id: true }).extend({
  qty: z.coerce.number().min(0),
  minQty: z.coerce.number().min(0),
  dailyUse: z.coerce.number().min(0),
  objectId: z.coerce.number(),
});
export const insertEmployeeSchema = createInsertSchema(employees).omit({ id: true }).extend({
  fio: z.string().trim().min(1, "Укажите ФИО сотрудника"),
  position: z.string().trim().min(1, "Укажите должность"),
  objectId: z.coerce.number().default(0),
  brigadeId: z.coerce.number().default(0),
  phone: z.string().default(""),
  importId: z.coerce.number().default(0),
});
export const insertPositionSchema = createInsertSchema(positions).omit({ id: true }).extend({
  name: z.string().trim().min(1, "Укажите название должности"),
});
export const insertLabSchema = createInsertSchema(labs).omit({ id: true }).extend({
  name: z.string().min(1, "Укажите название лаборатории"),
  city: z.string().default(""),
  leadDays: z.coerce.number().min(0).default(14),
  pricePerSample: z.coerce.number().min(0).default(0),
  analyses: z.string().default(""),
});
export const insertAnalysisTypeSchema = createInsertSchema(analysisTypes).omit({ id: true }).extend({
  name: z.string().min(1, "Укажите название вида анализа"),
  elements: z.string().default(""),
  unit: z.string().default("г/т"),
});
export const insertSampleSchema = createInsertSchema(samples).omit({ id: true }).extend({
  code: z.string().default(""),
  date: z.string().min(1, "Укажите дату отбора"),
  objectId: z.coerce.number().default(0),
  rigId: z.coerce.number().default(0),
  holeName: z.string().default(""),
  fromDepth: z.coerce.number().min(0).default(0),
  toDepth: z.coerce.number().min(0).default(0),
  sampleType: z.string().default("керновая"),
  weightKg: z.coerce.number().min(0).default(0),
  geologistId: z.coerce.number().default(0),
  stage: z.string().default("Отобрана"),
  stageDate: z.string().default(""),
  status: z.string().default("в работе"),
  rejectReason: z.string().default(""),
  batchId: z.coerce.number().default(0),
  note: z.string().default(""),
  importId: z.coerce.number().default(0),
}).refine((v) => v.toDepth >= v.fromDepth, {
  message: "Глубина «до» должна быть больше глубины «от»", path: ["toDepth"],
});
export const insertLabBatchSchema = createInsertSchema(labBatches).omit({ id: true }).extend({
  code: z.string().default(""),
  labId: z.coerce.number().min(1, "Выберите лабораторию"),
  analysisTypeId: z.coerce.number().default(0),
  sentDate: z.string().min(1, "Укажите дату отправки"),
  dueDate: z.string().default(""),
  shipMethod: z.string().default("транспортная компания"),
  waybill: z.string().default(""),
  status: z.string().default("в лаборатории"),
  resultDate: z.string().default(""),
  note: z.string().default(""),
});
export const insertAssaySchema = createInsertSchema(assays).omit({ id: true }).extend({
  sampleId: z.coerce.number().min(1, "Выберите пробу"),
  element: z.string().default("Au"),
  value: z.coerce.number().min(0).default(0),
  unit: z.string().default("г/т"),
  receivedDate: z.string().default(""),
  importId: z.coerce.number().default(0),
});

export const insertCoreLogSchema = createInsertSchema(coreLogs).omit({ id: true }).extend({
  date: z.string().min(1, "Укажите дату"),
  objectId: z.coerce.number().default(0),
  holeName: z.string().min(1, "Укажите скважину"),
  fromDepth: z.coerce.number().min(0).default(0),
  toDepth: z.coerce.number().min(0).default(0),
  geologistId: z.coerce.number().default(0),
  recoveryPct: z.coerce.number().min(0).max(100).default(100),
  lithology: z.string().default(""),
  mineralization: z.coerce.number().default(0),
  mineralizationNote: z.string().default(""),
  photo: z.coerce.number().default(0),
  status: z.string().default("описано"),
  importId: z.coerce.number().default(0),
}).refine((v) => v.toDepth > v.fromDepth, {
  message: "Глубина «до» должна быть больше глубины «от»", path: ["toDepth"],
});
export const insertCoreCutSchema = createInsertSchema(coreCuts).omit({ id: true }).extend({
  date: z.string().min(1, "Укажите дату"),
  objectId: z.coerce.number().default(0),
  holeName: z.string().min(1, "Укажите скважину"),
  fromDepth: z.coerce.number().min(0).default(0),
  toDepth: z.coerce.number().min(0).default(0),
  worker: z.string().default(""),
  shift: z.string().default("день"),
  cutType: z.string().default("продольная"),
  equipmentId: z.coerce.number().default(0),
  rejectMeters: z.coerce.number().min(0).default(0),
  rejectReason: z.string().default(""),
  status: z.string().default("распилено"),
  importId: z.coerce.number().default(0),
}).refine((v) => v.toDepth > v.fromDepth, {
  message: "Глубина «до» должна быть больше глубины «от»", path: ["toDepth"],
});

export const insertShiftSchema = createInsertSchema(shifts).omit({ id: true }).extend({
  employeeId: z.coerce.number(),
  objectId: z.coerce.number(),
  replacementAssigned: z.coerce.number().default(0),
});

export type Equipment = typeof equipment.$inferSelect;
export type CostItem = typeof costItems.$inferSelect;
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type ObjectRow = typeof objects.$inferSelect;
export type Rig = typeof rigs.$inferSelect;
export type Brigade = typeof brigades.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type Cost = typeof costs.$inferSelect;
export type Fuel = typeof fuel.$inferSelect;
export type Inventory = typeof inventory.$inferSelect;
export type Employee = typeof employees.$inferSelect;
export type Lab = typeof labs.$inferSelect;
export type AnalysisType = typeof analysisTypes.$inferSelect;
export type Sample = typeof samples.$inferSelect;
export type SampleMove = typeof sampleMoves.$inferSelect;
export type LabBatch = typeof labBatches.$inferSelect;
export type Assay = typeof assays.$inferSelect;
export type CoreLog = typeof coreLogs.$inferSelect;
export type CoreCut = typeof coreCuts.$inferSelect;
export type Shift = typeof shifts.$inferSelect;
export type Position = typeof positions.$inferSelect;

export type InsertReport = z.infer<typeof insertReportSchema>;
export type InsertCost = z.infer<typeof insertCostSchema>;
export type InsertFuel = z.infer<typeof insertFuelSchema>;
export type InsertInventory = z.infer<typeof insertInventorySchema>;
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type InsertShift = z.infer<typeof insertShiftSchema>;

/* ==================== Роли и доступы ==================== */

/** Пользователи программы */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  login: text("login").notNull(),
  passwordHash: text("password_hash").notNull(),
  fio: text("fio").notNull().default(""),
  role: text("role").notNull().default("viewer"),
  objectIds: text("object_ids").notNull().default("[]"), // JSON массив id объектов, пусто = все
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull().default(""),
  lastLogin: text("last_login").notNull().default(""),
});

/** Сессии (токен в памяти клиента, запись в SQLite) */
export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull(),
  createdAt: text("created_at").notNull().default(""),
});

/** Журнал действий */
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: text("at").notNull(),
  userId: integer("user_id").notNull().default(0),
  login: text("login").notNull().default(""),
  role: text("role").notNull().default(""),
  action: text("action").notNull(),
  entity: text("entity").notNull().default(""),
  details: text("details").notNull().default(""),
  ok: integer("ok").notNull().default(1),
});

export type User = typeof users.$inferSelect;
export type AuditRow = typeof auditLog.$inferSelect;

export const SECTIONS = [
  "dashboard", "summary", "import", "profiles", "templates", "pbk", "drilling", "sampleprep", "core",
  "economics", "fuel", "crew", "references", "settings", "users", "setup", "install",
] as const;
export type Section = typeof SECTIONS[number];

export type RoleDef = {
  label: string;
  hint: string;
  sections: Section[];
  write: boolean;
  finance: boolean;
  manageUsers: boolean;
  allObjects: boolean;
  personal: boolean; // доступ к персональным данным (ФИО, вахты)
};

export const ROLES: Record<string, RoleDef> = {
  director: {
    label: "Генеральный директор",
    hint: "Всё без ограничений, включая экономику, сметы и управление пользователями",
    sections: [...SECTIONS], write: true, finance: true, manageUsers: true, allObjects: true, personal: true,
  },
  analyst: {
    label: "Аналитик",
    hint: "Всё, кроме управления пользователями",
    sections: SECTIONS.filter((s) => s !== "users") as Section[],
    write: true, finance: true, manageUsers: false, allObjects: true, personal: true,
  },
  geolog: {
    label: "Начальник участка / геолог",
    hint: "Только свои объекты: рапорты, керн, распиловка, пробы. Без экономики и цен",
    sections: ["dashboard", "summary", "import", "profiles", "pbk", "drilling", "sampleprep", "core", "install"],
    write: true, finance: false, manageUsers: false, allObjects: false, personal: true,
  },
  lab: {
    label: "Пробоподготовка / лаборатория",
    hint: "Только раздел пробоподготовки: журнал проб, этапы, партии, результаты",
    sections: ["sampleprep", "install"],
    write: true, finance: false, manageUsers: false, allObjects: true, personal: false,
  },
  supply: {
    label: "Снабжение",
    hint: "ГСМ, ТМЦ, остатки и заявки. Без экономики и зарплат",
    sections: ["fuel", "install"],
    write: true, finance: false, manageUsers: false, allObjects: true, personal: false,
  },
  viewer: {
    label: "Наблюдатель (заказчик/инвестор)",
    hint: "Только чтение дашборда и производственных показателей",
    sections: ["dashboard", "summary", "drilling", "install"],
    write: false, finance: false, manageUsers: false, allObjects: true, personal: false,
  },
};

export const ROLE_KEYS = Object.keys(ROLES);

export const DEMO_USERS = [
  { login: "director", password: "director", role: "director", fio: "Иванов И. И., генеральный директор" },
  { login: "analyst", password: "analyst", role: "analyst", fio: "Петрова А. С., аналитик" },
  { login: "geolog", password: "geolog", role: "geolog", fio: "Сидоров П. В., начальник участка" },
  { login: "lab", password: "lab", role: "lab", fio: "Кузнецова М. Н., пробоподготовка" },
  { login: "supply", password: "supply", role: "supply", fio: "Орлов Д. А., снабжение" },
  { login: "viewer", password: "viewer", role: "viewer", fio: "Наблюдатель заказчика" },
];

export const insertUserSchema = z.object({
  login: z.string().trim().min(3, "Логин не короче 3 символов"),
  password: z.string().min(4, "Пароль не короче 4 символов").optional(),
  fio: z.string().trim().default(""),
  role: z.string().refine((r) => ROLE_KEYS.includes(r), "Неизвестная роль"),
  objectIds: z.array(z.number()).default([]),
  active: z.boolean().default(true),
});

/* ==================== Профили импорта и синонимы ==================== */

export const importProfiles = sqliteTable("import_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("drill"), // drill | geo
  sheetRule: text("sheet_rule").notNull().default("все"), // все | первый | по названию
  sheetMatch: text("sheet_match").notNull().default(""),
  headerRow: integer("header_row").notNull().default(0), // 0 = определять автоматически
  transposed: integer("transposed").notNull().default(0),
  mapping: text("mapping").notNull().default("{}"), // JSON: { entity: { field: colIndex } }
  defaults: text("defaults").notNull().default("{}"), // JSON правил подстановки
  signature: text("signature").notNull().default("[]"), // JSON: нормализованные заголовки
  createdAt: text("created_at").notNull().default(""),
  usedCount: integer("used_count").notNull().default(0),
  lastUsed: text("last_used").notNull().default(""),
  author: text("author").notNull().default(""),
});
export type ImportProfile = typeof importProfiles.$inferSelect;

/** Справочники одним файлом: три листа (объекты, станки, бригады) */
export const REFS_SHEETS = {
  objects: {
    title: "Объекты",
    fields: [
      { key: "name", label: "Название объекта", required: true, aliases: ["название", "объект", "участок", "наименование"] },
      { key: "customer", label: "Заказчик", required: false, aliases: ["заказчик", "клиент"] },
      { key: "region", label: "Регион", required: false, aliases: ["регион", "область", "край"] },
      { key: "planMetersMonth", label: "План, м/мес", required: false, aliases: ["план", "планмесяц", "планмвмесяц", "планмметров"] },
      { key: "pricePerMeter", label: "Цена за метр, ₽", required: false, aliases: ["цена", "ценазаметр", "тариф"] },
      { key: "plannedCostPerMeter", label: "Плановая себестоимость метра, ₽", required: false, aliases: ["себестоимость", "смета", "плановаясебестоимость"] },
      { key: "contractVolume", label: "Объём по договору, м", required: false, aliases: ["объемподоговору", "объём", "договорм", "объемдоговора"] },
      { key: "contractEnd", label: "Дата окончания договора", required: false, aliases: ["датаокончания", "срокдоговора", "окончаниедоговора", "конецдоговора"] },
      { key: "staffRequired", label: "Штатная численность", required: false, aliases: ["штат", "численность", "штатнаячисленность", "людей"] },
    ],
  },
  rigs: {
    title: "Станки",
    fields: [
      { key: "name", label: "Название/номер станка", required: true, aliases: ["название", "станок", "номер", "буроваяустановка", "наименование"] },
      { key: "model", label: "Тип (модель)", required: false, aliases: ["тип", "модель", "марка"] },
      { key: "object", label: "Объект", required: false, aliases: ["объект", "участок"] },
      { key: "status", label: "Статус (в работе / ремонт / резерв)", required: false, aliases: ["статус", "состояние"] },
    ],
  },
  brigades: {
    title: "Бригады",
    fields: [
      { key: "name", label: "Название бригады", required: true, aliases: ["название", "бригада", "наименование", "звено"] },
      { key: "object", label: "Объект", required: false, aliases: ["объект", "участок"] },
      { key: "staffPlan", label: "Штатная численность", required: false, aliases: ["штат", "численность", "штатнаячисленность", "людей"] },
    ],
  },
} as const;

/** Шаблоны Excel: пользователь может переименовать колонки, изменить порядок, добавить свои */
export const excelTemplates = sqliteTable("excel_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull(), // reports | costs | refs-objects | custom-1 ...
  kind: text("kind").notNull().default("data"), // data | refs | custom
  baseType: text("base_type").notNull().default(""), // тип сводки для распознавания при импорте
  title: text("title").notNull(),
  sheetName: text("sheet_name").notNull().default("Лист1"),
  columns: text("columns").notNull().default("[]"), // JSON: [{ key, label, hint, required, custom }]
  notes: text("notes").notNull().default("[]"), // JSON: строки-подсказки под шапкой
  updatedAt: text("updated_at").notNull().default(""),
  author: text("author").notNull().default(""),
});
export type ExcelTemplateRow = typeof excelTemplates.$inferSelect;

export type TemplateColumn = {
  key: string;
  label: string;
  hint?: string;
  required?: boolean;
  custom?: boolean;
};

export type TemplateDef = {
  code: string;
  kind: "data" | "refs" | "custom";
  baseType: string;
  title: string;
  sheetName: string;
  columns: TemplateColumn[];
  notes: string[];
  edited: boolean;
  builtin: boolean;
};

export const templateColumnSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1, "Название колонки не может быть пустым"),
  hint: z.string().trim().optional().default(""),
  required: z.boolean().optional().default(false),
  custom: z.boolean().optional().default(false),
});

export const templateSaveSchema = z.object({
  title: z.string().trim().min(1, "Укажите название шаблона"),
  sheetName: z.string().trim().min(1, "Укажите название листа").max(31, "Название листа — не длиннее 31 символа"),
  columns: z.array(templateColumnSchema).min(1, "В шаблоне должна быть хотя бы одна колонка"),
  notes: z.array(z.string().trim()).default([]),
  baseType: z.string().trim().optional().default(""),
});

/** Брендирование: название, реквизиты, логотип и подпись отчётов */
export const brandingSchema = z.object({
  orgName: z.string().trim().min(1, "Укажите название организации"),
  orgShort: z.string().trim().max(40, "Короткое название — до 40 символов").optional().default(""),
  orgInn: z.string().trim().max(40).optional().default(""),
  orgDetails: z.string().trim().max(600, "Реквизиты — до 600 символов").optional().default(""),
  logo: z.string().trim().optional().default(""),
  signerName: z.string().trim().max(120).optional().default(""),
  signerPosition: z.string().trim().max(120).optional().default(""),
});
export type Branding = z.infer<typeof brandingSchema>;

/** Словарь синонимов: как называется в файле → как в справочнике */
export const synonyms = sqliteTable("synonyms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull().default("rig"), // object | rig | brigade | downtime | employee
  alias: text("alias").notNull(),
  canonical: text("canonical").notNull(),
});
export type Synonym = typeof synonyms.$inferSelect;

export const SYNONYM_KINDS = {
  object: "Объект",
  rig: "Станок",
  brigade: "Сменный мастер",
  downtime: "Причина простоя",
  employee: "Сотрудник / геолог",
} as const;

/** Мультисущностные типы «живых» сводок */
export const SMART_TYPES = {
  drill: "Буровая сводка",
  geo: "Геологическая сводка",
} as const;
export type SmartType = keyof typeof SMART_TYPES;

export type SmartField = { key: string; label: string; required: boolean; aliases: string[] };
export type SmartEntity = { key: string; label: string; plural: string; fields: SmartField[] };

export const SMART_ENTITIES: Record<SmartType, SmartEntity[]> = {
  drill: [
    {
      key: "reports", label: "Рапорт по бурению", plural: "рапортов",
      fields: [
        { key: "date", label: "Дата", required: true, aliases: ["дата", "датасмены", "день", "датарапорта", "смена дата"] },
        { key: "object", label: "Объект", required: false, aliases: ["объект", "участок", "площадь", "месторождение"] },
        { key: "rig", label: "Станок", required: true, aliases: ["станок", "бу", "установка", "буроваяустановка", "буровая", "агрегат", "номерстанка"] },
        { key: "brigade", label: "Сменный мастер", required: false, aliases: ["сменныймастер", "мастер", "бригада", "звено", "вахта"] },
        { key: "shift", label: "Смена", required: false, aliases: ["смена", "деньночь", "типсмены"] },
        { key: "hole", label: "Скважина", required: false, aliases: ["скважина", "скв", "номерскважины", "hole"] },
        { key: "fromDepth", label: "Интервал от, м", required: false, aliases: ["от", "интервалот", "глубинаот", "начало"] },
        { key: "toDepth", label: "Интервал до, м", required: false, aliases: ["до", "интервалдо", "глубинадо", "конец"] },
        { key: "meters", label: "Метры за смену", required: true, aliases: ["метры", "м", "проходка", "метраж", "пробурено", "объембурения", "метровзасмену"] },
        { key: "drillHours", label: "Часы бурения", required: false, aliases: ["часыбурение", "часыбурения", "бурение", "чбур", "времябурения", "часыбурениеч"] },
        { key: "pzrHours", label: "Часы ПЗР", required: false, aliases: ["часыпзр", "пзр", "подготовительные", "часыпзрч"] },
        { key: "downtimeHours", label: "Часы простоя", required: false, aliases: ["часыпростой", "часыпростоя", "простой", "простои", "чпростоя"] },
        { key: "downtimeReason", label: "Причина простоя", required: false, aliases: ["причинапростоя", "причина", "простойпричина"] },
        { key: "comment", label: "Примечание", required: false, aliases: ["примечание", "комментарий", "заметка"] },
      ],
    },
    {
      key: "fuel", label: "Запись ГСМ", plural: "записей ГСМ",
      fields: [
        { key: "date", label: "Дата", required: true, aliases: ["дата", "датасмены", "день"] },
        { key: "object", label: "Объект", required: false, aliases: ["объект", "участок"] },
        { key: "unitName", label: "Единица техники", required: true, aliases: ["станок", "техника", "установка", "буровая", "агрегат", "машина", "бу", "номерстанка"] },
        { key: "normLiters", label: "Норма топлива, л", required: false, aliases: ["нормал", "норматоплива", "поднорме", "нормарасхода", "нормагсм"] },
        { key: "factLiters", label: "Факт топлива, л", required: true, aliases: ["расходтоплива", "фактл", "топливо", "гсм", "дизель", "солярка", "расходгсм", "фактическийрасход"] },
      ],
    },
    {
      key: "inventory", label: "Остаток ГСМ / ТМЦ", plural: "остатков",
      fields: [
        { key: "itemName", label: "Позиция", required: true, aliases: ["позиция", "наименование", "тмц", "материал", "остатокчего"] },
        { key: "object", label: "Объект", required: false, aliases: ["объект", "участок", "склад"] },
        { key: "qty", label: "Остаток", required: true, aliases: ["остаток", "остатокгсм", "остатоктоплива", "количество", "наличие", "остатокл"] },
        { key: "unit", label: "Ед. изм.", required: false, aliases: ["единица", "едизм", "ед"] },
      ],
    },
  ],
  geo: [
    {
      key: "corelogs", label: "Описание керна", plural: "описаний керна",
      fields: [
        { key: "date", label: "Дата", required: true, aliases: ["дата", "датаописания", "день"] },
        { key: "object", label: "Объект", required: false, aliases: ["объект", "участок", "площадь"] },
        { key: "hole", label: "Скважина", required: true, aliases: ["скважина", "скв", "номерскважины", "hole"] },
        { key: "fromDepth", label: "Интервал от, м", required: true, aliases: ["от", "интервалот", "глубинаот", "описаниеот", "from"] },
        { key: "toDepth", label: "Интервал до, м", required: true, aliases: ["до", "интервалдо", "глубинадо", "описаниедо", "to"] },
        { key: "geologist", label: "Геолог", required: false, aliases: ["геолог", "документатор", "фио", "исполнитель"] },
        { key: "recoveryPct", label: "Выход керна, %", required: false, aliases: ["выходкерна", "выход", "recovery", "выходкернапроц"] },
        { key: "lithology", label: "Литология", required: false, aliases: ["литология", "описание", "породы", "характеристика"] },
      ],
    },
    {
      key: "samples", label: "Проба", plural: "проб",
      fields: [
        { key: "code", label: "Номер пробы", required: true, aliases: ["номерпробы", "проба", "шифрпробы", "пробы", "sampleid", "пробано"] },
        { key: "date", label: "Дата отбора", required: false, aliases: ["дата", "датаотбора", "день"] },
        { key: "hole", label: "Скважина", required: false, aliases: ["скважина", "скв", "номерскважины"] },
        { key: "fromDepth", label: "Интервал от, м", required: false, aliases: ["пробаот", "от", "интервалот", "глубинаот"] },
        { key: "toDepth", label: "Интервал до, м", required: false, aliases: ["пробадо", "до", "интервалдо", "глубинадо"] },
        { key: "weightKg", label: "Вес пробы, кг", required: false, aliases: ["вес", "весквг", "масса", "веспробы", "веспробыкг"] },
        { key: "sampleType", label: "Тип пробы", required: false, aliases: ["типпробы", "вид", "видпробы"] },
      ],
    },
    {
      key: "corecuts", label: "Распиловка", plural: "записей распиловки",
      fields: [
        { key: "date", label: "Дата", required: true, aliases: ["дата", "датараспиловки", "день"] },
        { key: "object", label: "Объект", required: false, aliases: ["объект", "участок"] },
        { key: "hole", label: "Скважина", required: true, aliases: ["скважина", "скв", "номерскважины"] },
        { key: "fromDepth", label: "Распиловка от, м", required: true, aliases: ["распиловкаот", "от", "интервалот", "пилаот"] },
        { key: "toDepth", label: "Распиловка до, м", required: true, aliases: ["распиловкадо", "до", "интервалдо", "пиладо"] },
        { key: "worker", label: "Исполнитель", required: false, aliases: ["исполнитель", "распиловщик", "фио", "работник"] },
        { key: "rejectMeters", label: "Брак, м", required: false, aliases: ["брак", "бракм", "потери"] },
      ],
    },
  ],
};

/* ==================== Сметы и календарные планы ==================== */

export const estimates = sqliteTable("estimates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  objectId: integer("object_id").notNull().default(0),
  contract: text("contract").notNull().default(""),
  version: integer("version").notNull().default(1),
  validFrom: text("valid_from").notNull().default(""),
  validTo: text("valid_to").notNull().default(""),
  planMeters: real("plan_meters").notNull().default(0),
  active: integer("active").notNull().default(1),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(""),
});

export const estimateLines = sqliteTable("estimate_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  estimateId: integer("estimate_id").notNull(),
  section: text("section").notNull().default("прямые"), // прямые | накладные
  item: text("item").notNull(),
  workType: text("work_type").notNull().default(""),
  unit: text("unit").notNull().default("руб."),
  qty: real("qty").notNull().default(0),
  price: real("price").notNull().default(0),
  amount: real("amount").notNull().default(0),
});

/** Расценка за метр по интервалам глубин */
export const depthRates = sqliteTable("depth_rates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  estimateId: integer("estimate_id").notNull(),
  drillType: text("drill_type").notNull().default("колонковое"),
  diameter: text("diameter").notNull().default("HQ"),
  fromDepth: real("from_depth").notNull().default(0),
  toDepth: real("to_depth").notNull().default(0),
  pricePerMeter: real("price_per_meter").notNull().default(0),
});

/** Календарный план по месяцам */
export const calendarPlans = sqliteTable("calendar_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  objectId: integer("object_id").notNull().default(0),
  estimateId: integer("estimate_id").notNull().default(0),
  month: text("month").notNull(), // YYYY-MM
  planMeters: real("plan_meters").notNull().default(0),
  planCost: real("plan_cost").notNull().default(0),
  workType: text("work_type").notNull().default("бурение"),
  note: text("note").notNull().default(""),
});

/** Этапы договора */
export const calendarStages = sqliteTable("calendar_stages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  objectId: integer("object_id").notNull().default(0),
  estimateId: integer("estimate_id").notNull().default(0),
  stage: text("stage").notNull(),
  planStart: text("plan_start").notNull().default(""),
  planEnd: text("plan_end").notNull().default(""),
  factStart: text("fact_start").notNull().default(""),
  factEnd: text("fact_end").notNull().default(""),
  status: text("status").notNull().default("план"),
});

export const CONTRACT_STAGES = [
  "Мобилизация", "Начало бурения", "Окончание бурения", "Сдача отчёта", "Демобилизация",
] as const;
export const STAGE_STATUSES = ["план", "в работе", "выполнен", "просрочен"] as const;
export const ESTIMATE_SECTIONS = ["прямые", "накладные"] as const;

export type Estimate = typeof estimates.$inferSelect;
export type EstimateLine = typeof estimateLines.$inferSelect;
export type DepthRate = typeof depthRates.$inferSelect;
export type CalendarPlan = typeof calendarPlans.$inferSelect;
export type CalendarStage = typeof calendarStages.$inferSelect;

export const insertEstimateSchema = createInsertSchema(estimates).omit({ id: true }).extend({
  objectId: z.coerce.number().int().positive("Выберите объект"),
  contract: z.string().trim().min(1, "Укажите название договора"),
  version: z.coerce.number().int().positive().default(1),
  planMeters: z.coerce.number().nonnegative("Плановый объём не может быть отрицательным"),
});
export const insertEstimateLineSchema = createInsertSchema(estimateLines).omit({ id: true }).extend({
  estimateId: z.coerce.number().int().positive(),
  item: z.string().trim().min(1, "Укажите статью затрат"),
  qty: z.coerce.number().default(0),
  price: z.coerce.number().default(0),
  amount: z.coerce.number().default(0),
});
export const insertDepthRateSchema = createInsertSchema(depthRates).omit({ id: true }).extend({
  estimateId: z.coerce.number().int().positive(),
  fromDepth: z.coerce.number().nonnegative(),
  toDepth: z.coerce.number().positive(),
  pricePerMeter: z.coerce.number().nonnegative(),
}).refine((v) => v.toDepth > v.fromDepth, { message: "Глубина «до» должна быть больше «от»" });
export const insertCalendarPlanSchema = createInsertSchema(calendarPlans).omit({ id: true }).extend({
  objectId: z.coerce.number().int().positive("Выберите объект"),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Месяц в формате ГГГГ-ММ"),
  planMeters: z.coerce.number().nonnegative(),
  planCost: z.coerce.number().nonnegative(),
});
export const insertCalendarStageSchema = createInsertSchema(calendarStages).omit({ id: true }).extend({
  objectId: z.coerce.number().int().positive("Выберите объект"),
  stage: z.string().trim().min(1, "Укажите этап"),
});

/** Дополнительные пороги для смет и календарного плана */
export const ESTIMATE_THRESHOLDS = {
  budgetAheadPP: 10,      // освоение сметы опережает объём, процентных пунктов
  costPerMeterOverPct: 10, // фактическая себестоимость метра выше сметной, %
  calendarLagDays: 10,     // отставание от календарного плана, дней
  forecastOverPct: 3,      // прогнозный выход за смету, %
};
