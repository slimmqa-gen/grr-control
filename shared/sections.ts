/**
 * Состав программы: каталог разделов, группы меню и готовые наборы (пресеты).
 * Используется и сервером (проверка доступа, 403), и интерфейсом (меню, экран настройки).
 */
import { ROLE_KEYS } from "./schema";

/** Группы меню по умолчанию */
export const DEFAULT_GROUPS = [
  { key: "prod", title: "Производство", order: 0, collapsed: false },
  { key: "geo", title: "Геология", order: 1, collapsed: false },
  { key: "econ", title: "Экономика", order: 2, collapsed: false },
  { key: "setup", title: "Настройка", order: 3, collapsed: false },
];

export type SectionCatalogItem = {
  key: string;
  /** Название по умолчанию (заказчик может переименовать) */
  title: string;
  href: string;
  /** Значок в меню (имя из lucide-react, разбирается на клиенте) */
  icon: string;
  group: string;
  order: number;
  /** Нельзя скрыть от генерального директора — защита от самоблокировки */
  locked: boolean;
  /** Не выводится отдельным пунктом меню */
  noMenu?: boolean;
  /** Таблицы, которые чистит кнопка «Очистить данные раздела» */
  tables: string[];
  /** Что именно удаляется — пояснение для окна подтверждения */
  clearHint: string;
  /** Ключ выгрузки в Excel перед очисткой */
  exportKey?: string;
};

export const SECTION_CATALOG: SectionCatalogItem[] = [
  { key: "dashboard", title: "Дашборд", href: "/", icon: "LayoutDashboard", group: "prod", order: 0,
    locked: false, tables: [], clearHint: "Дашборд считается по другим разделам, своих записей у него нет." },
  { key: "summary", title: "Сводка", href: "/summary", icon: "FileText", group: "prod", order: 1,
    locked: false, tables: [], clearHint: "Сводка формируется автоматически, своих записей у неё нет." },
  { key: "import", title: "Импорт данных", href: "/import", icon: "Upload", group: "prod", order: 2,
    locked: false, tables: ["import_logs"], clearHint: "Журнал загрузок файлов (сами данные остаются в своих разделах).",
    exportKey: "all" },
  { key: "drilling", title: "Бурение и работа смен", href: "/drilling", icon: "Drill", group: "prod", order: 3,
    locked: false, tables: ["reports"], clearHint: "Сменные рапорты по бурению.", exportKey: "reports" },
  { key: "crew", title: "Сотрудники и вахты", href: "/crew", icon: "Users", group: "prod", order: 4,
    locked: false, tables: ["employees", "shifts"], clearHint: "Сотрудники и вахтовый график.", exportKey: "crew" },
  { key: "pbk", title: "Реальные данные ПБК", href: "/pbk", icon: "Database", group: "prod", order: 5,
    locked: false, tables: ["pbk"], clearHint: "Загруженные сводки заказчика: смены, геология, скважины, пробоподготовка, канавы." },

  { key: "core", title: "Керн и распиловка", href: "/core", icon: "Layers", group: "geo", order: 0,
    locked: false, tables: ["core_logs", "core_cuts"], clearHint: "Описание керна и распиловка.", exportKey: "core" },
  { key: "sampleprep", title: "Пробоподготовка", href: "/sampleprep", icon: "FlaskConical", group: "geo", order: 1,
    locked: false, tables: ["assays", "sample_moves", "lab_batches", "samples"],
    clearHint: "Пробы, движения проб, партии и результаты анализов.", exportKey: "sampleprep" },

  { key: "economics", title: "Экономика", href: "/economics", icon: "Wallet", group: "econ", order: 0,
    locked: false, tables: ["costs", "estimate_lines", "depth_rates", "estimates", "calendar_stages", "calendar_plans"],
    clearHint: "Затраты, сметы, расценки по глубине и календарные планы.", exportKey: "economics" },
  { key: "fuel", title: "ГСМ и запасы", href: "/fuel", icon: "Fuel", group: "econ", order: 1,
    locked: false, tables: ["fuel", "inventory"], clearHint: "Расход ГСМ и остатки ТМЦ.", exportKey: "fuel" },

  { key: "references", title: "Справочники", href: "/references", icon: "BookMarked", group: "setup", order: 0,
    locked: false, tables: [], clearHint: "Справочники не очищаются этой кнопкой — они нужны всем разделам." },
  { key: "templates", title: "Шаблоны Excel", href: "/templates", icon: "FileCog", group: "setup", order: 1,
    locked: false, tables: ["excel_templates"], clearHint: "Пользовательские настройки шаблонов (встроенные шаблоны вернутся)." },
  { key: "profiles", title: "Профили импорта", href: "/profiles", icon: "SlidersHorizontal", group: "setup", order: 2,
    locked: false, tables: ["import_profiles", "synonyms"], clearHint: "Сохранённые профили импорта и словарь синонимов." },
  { key: "users", title: "Пользователи", href: "/users", icon: "ShieldCheck", group: "setup", order: 3,
    locked: true, tables: [], clearHint: "Учётные записи удаляются поштучно в самом разделе." },
  { key: "settings", title: "Настройки", href: "/settings", icon: "Settings", group: "setup", order: 4,
    locked: true, tables: [], clearHint: "Настройки очищаются только «Полным сбросом»." },
  { key: "sections", title: "Разделы программы", href: "/settings", icon: "ListTree", group: "setup", order: 5,
    locked: true, noMenu: true, tables: [], clearHint: "Состав программы сбрасывается кнопкой «Вернуть настройки по умолчанию»." },
  { key: "setup", title: "Настройка за 5 шагов", href: "/setup", icon: "Wand2", group: "setup", order: 6,
    locked: false, noMenu: true, tables: [], clearHint: "Мастер не хранит собственных записей." },
  { key: "install", title: "Установка на устройства", href: "/install", icon: "Smartphone", group: "setup", order: 7,
    locked: false, tables: [], clearHint: "Раздел-инструкция, данных не хранит." },
];

/** Разделы, которые нельзя скрыть от генерального директора */
export const LOCKED_KEYS = SECTION_CATALOG.filter((s) => s.locked).map((s) => s.key);

export const CATALOG_KEYS = SECTION_CATALOG.map((s) => s.key);

export type SectionSetting = {
  title: string;
  visible: boolean;
  order: number;
  group: string;
  roles: string[];
};

export type GroupSetting = { key: string; title: string; order: number; collapsed: boolean };

export type SectionsConfig = {
  groups: GroupSetting[];
  items: Record<string, SectionSetting>;
  preset: string;
};

/** Готовые наборы разделов */
export const PRESETS: Record<string, { title: string; hint: string; visible: string[] | "all" }> = {
  control: {
    title: "Только контроль работ",
    hint: "Люди, объекты, выполненные объёмы и отставания. Без экономики, смет и ГСМ.",
    visible: [
      "dashboard", "summary", "import", "drilling", "core", "sampleprep", "crew", "pbk",
      "references", "templates", "profiles", "users", "settings", "sections", "setup", "install",
    ],
  },
  all: { title: "Всё включено", hint: "Видны все разделы программы, включая экономику и ГСМ.", visible: "all" },
  production: {
    title: "Только производство",
    hint: "Минимум: дашборд, бурение, керн, вахты и импорт.",
    visible: ["dashboard", "drilling", "core", "crew", "import", "settings", "sections", "users"],
  },
};

/** Конфигурация по умолчанию: видно всё, роли — как в матрице ролей */
export function defaultConfig(roleSections: Record<string, readonly string[]>): SectionsConfig {
  const items: Record<string, SectionSetting> = {};
  for (const s of SECTION_CATALOG) {
    items[s.key] = {
      title: s.title,
      visible: true,
      order: s.order,
      group: s.group,
      roles: ROLE_KEYS.filter((r) => (roleSections[r] ?? []).includes(s.key === "sections" ? "settings" : s.key)),
    };
  }
  return { groups: DEFAULT_GROUPS.map((g) => ({ ...g })), items, preset: "all" };
}

/** Типы колонок пользовательского раздела */
export const CUSTOM_COL_TYPES = {
  text: "Текст",
  number: "Число",
  date: "Дата",
  list: "Список значений",
  bool: "Да / нет",
} as const;
export type CustomColType = keyof typeof CUSTOM_COL_TYPES;

export type CustomColumn = {
  key: string;
  label: string;
  type: CustomColType;
  options?: string[];
  required?: boolean;
};
