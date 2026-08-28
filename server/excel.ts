import ExcelJS from "exceljs";
import { storage } from "./storage";
import { buildAnalytics, ruDate, monthTitle } from "./analytics";
import { brandWorkbook } from "./branding";

const HEAD_FILL = "FF1E3A5F";

function styleSheet(ws: ExcelJS.Worksheet, widths: number[]) {
  ws.columns.forEach((c, i) => (c.width = widths[i] ?? 18));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } };
  head.alignment = { vertical: "middle", wrapText: true };
  head.height = 30;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

export type SheetKey = "reports" | "economics" | "fuel" | "crew" | "summary" | "sampleprep" | "core";

export async function buildWorkbook(sheets: SheetKey[]): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ГРР-Контроль";
  wb.created = new Date();

  const a = buildAnalytics();
  const objects = storage.objects();
  const rigs = storage.rigs();
  const brigades = storage.brigades();
  const objName = (id: number) => objects.find((o) => o.id === id)?.name ?? "—";

  if (sheets.includes("summary")) {
    const ws = wb.addWorksheet("Сводка для директора");
    ws.columns = [{ width: 40 }, { width: 26 }, { width: 26 }, { width: 22 }];
    ws.addRow(["ГРР-Контроль. Панель генерального директора"]).font = { bold: true, size: 14 };
    ws.addRow([`Период: ${monthTitle(a.curMonth)} · сформировано ${ruDate(a.nowIso)}`]);
    ws.addRow([]);
    ws.addRow(["Показатель", "Значение", "План / норматив", "Статус"]).font = { bold: true };
    const rows: [string, string | number, string | number, string][] = [
      ["Метры пробурено за месяц, м", a.kpi.factMeters, a.kpi.planToDate, a.kpi.planPct >= 90 ? "норма" : "отставание"],
      ["Выполнение плана, %", a.kpi.planPct, 100, a.kpi.planPct >= 90 ? "норма" : "отставание"],
      ["Метры на смену, м", a.kpi.metersPerShift, "—", "—"],
      ["Доля простоев, %", a.kpi.downtimeShare, a.thresholds.downtimeSharePct, a.kpi.downtimeShare <= a.thresholds.downtimeSharePct ? "норма" : "выше порога"],
      ["Себестоимость метра, руб.", a.kpi.costPerMeter, "—", "—"],
      ["Рентабельность портфеля, %", a.kpi.profitability, "—", a.kpi.profitability > 0 ? "норма" : "убыток"],
      ["Людей на вахте / по штату", a.kpi.peopleOnSite, a.kpi.staffRequired, a.kpi.peopleOnSite >= a.kpi.staffRequired ? "норма" : "недобор"],
      ["Потери от простоев, руб.", a.lostTotal.money, "—", "—"],
    ];
    rows.forEach((r) => ws.addRow(r));
    ws.addRow([]);
    const txtStart = ws.rowCount + 1;
    a.summaries.month.text.split("\n").forEach((line) => ws.addRow([line]));
    for (let i = txtStart; i <= ws.rowCount; i++) ws.getRow(i).alignment = { wrapText: true, vertical: "top" };
    ws.addRow([]);
    ws.addRow(["Автоматические предупреждения"]).font = { bold: true, size: 12 };
    ws.addRow(["Уровень", "Объект", "Суть", "Рекомендация"]).font = { bold: true };
    a.flags.forEach((f) => ws.addRow([f.level, f.object, `${f.title}: ${f.value}`, f.advice]));
  }

  if (sheets.includes("reports")) {
    const ws = wb.addWorksheet("Бурение и простои");
    ws.columns = [
      { header: "Дата", key: "d" }, { header: "Объект", key: "o" }, { header: "Станок", key: "r" },
      { header: "Смена", key: "s" }, { header: "Метры, м", key: "m" },
      { header: "Часы бурения, ч", key: "dh" }, { header: "Часы ПЗР, ч", key: "ph" },
      { header: "Часы простоя, ч", key: "oh" }, { header: "Причина простоя", key: "rs" },
      { header: "Комментарий", key: "c" },
    ];
    styleSheet(ws, [12, 24, 12, 10, 12, 16, 14, 16, 22, 26]);
    storage.reports().sort((x, y) => (x.date < y.date ? 1 : -1)).forEach((r) =>
      ws.addRow({
        d: ruDate(r.date), o: objName(r.objectId),
        r: rigs.find((x) => x.id === r.rigId)?.name ?? "—",
        s: r.shift, m: r.meters, dh: r.drillHours, ph: r.pzrHours,
        oh: r.downtimeHours, rs: r.downtimeReason, c: r.comment,
      }));

    const ws2 = wb.addWorksheet("Рейтинг станков и мастеров");
    ws2.columns = [
      { header: "Тип", key: "t" }, { header: "Наименование", key: "n" }, { header: "Объект", key: "o" },
      { header: "Смен", key: "s" }, { header: "Метры за месяц, м", key: "m" },
      { header: "Метры на смену, м", key: "ps" }, { header: "Доля простоев, %", key: "dt" },
    ];
    styleSheet(ws2, [12, 22, 24, 10, 20, 20, 18]);
    a.rigRating.forEach((r) => ws2.addRow({ t: "Станок", n: r.name, o: r.object, s: r.shifts, m: r.meters, ps: r.perShift, dt: r.downtimeShare }));
    a.brigadeRating.forEach((r) => ws2.addRow({ t: "Сменный мастер", n: r.name, o: r.object, s: r.shifts, m: r.meters, ps: r.perShift, dt: r.downtimeShare }));

    const ws3 = wb.addWorksheet("Простои по причинам");
    ws3.columns = [
      { header: "Причина простоя", key: "r" }, { header: "Часы, ч", key: "h" },
      { header: "Доля, %", key: "s" }, { header: "Потерянные метры, м", key: "m" },
      { header: "Упущенная выручка, руб.", key: "mo" },
    ];
    styleSheet(ws3, [26, 12, 12, 22, 24]);
    a.downtimeReasons.forEach((d) => ws3.addRow({ r: d.reason, h: d.hours, s: d.sharePct, m: d.lostMeters, mo: d.lostMoney }));
  }

  if (sheets.includes("economics")) {
    const ws = wb.addWorksheet("Экономика по объектам");
    ws.columns = [
      { header: "Объект", key: "o" }, { header: "Заказчик", key: "c" },
      { header: "Метры за месяц, м", key: "m" }, { header: "Выручка, руб.", key: "rv" },
      { header: "Затраты, руб.", key: "cs" }, { header: "Маржа, руб.", key: "mg" },
      { header: "Рентабельность, %", key: "p" },
      { header: "Себестоимость метра факт, руб.", key: "cf" },
      { header: "Себестоимость метра смета, руб.", key: "cp" },
      { header: "Отклонение, %", key: "dv" },
    ];
    styleSheet(ws, [24, 24, 18, 18, 18, 18, 18, 24, 24, 16]);
    a.byObject.forEach((o) =>
      ws.addRow({ o: o.name, c: o.customer, m: o.fact, rv: o.revenue, cs: o.costs, mg: o.margin,
        p: o.profitability, cf: o.costPerMeter, cp: o.plannedCostPerMeter, dv: o.costDeviationPct }));

    const ws2 = wb.addWorksheet("Затраты по статьям");
    ws2.columns = [
      { header: "Объект", key: "o" }, { header: "Месяц", key: "m" },
      { header: "Статья затрат", key: "c" }, { header: "Сумма, руб.", key: "a" },
    ];
    styleSheet(ws2, [24, 14, 26, 18]);
    storage.costs().sort((x, y) => (x.month < y.month ? 1 : -1)).forEach((c) =>
      ws2.addRow({ o: objName(c.objectId), m: monthTitle(c.month), c: c.category, a: c.amount }));
  }

  if (sheets.includes("fuel")) {
    const ws = wb.addWorksheet("Расход ГСМ");
    ws.columns = [
      { header: "Дата", key: "d" }, { header: "Объект", key: "o" },
      { header: "Единица техники", key: "u" }, { header: "Норма, л", key: "n" },
      { header: "Факт, л", key: "f" }, { header: "Отклонение, л", key: "dv" },
      { header: "Отклонение, %", key: "dp" },
    ];
    styleSheet(ws, [12, 24, 24, 12, 12, 16, 16]);
    storage.fuel().sort((x, y) => (x.date < y.date ? 1 : -1)).forEach((f) =>
      ws.addRow({
        d: ruDate(f.date), o: objName(f.objectId), u: f.unitName, n: f.normLiters, f: f.factLiters,
        dv: Math.round((f.factLiters - f.normLiters) * 10) / 10,
        dp: Math.round(((f.factLiters - f.normLiters) / (f.normLiters || 1)) * 1000) / 10,
      }));

    const ws2 = wb.addWorksheet("Остатки ТМЦ");
    ws2.columns = [
      { header: "Позиция", key: "i" }, { header: "Объект", key: "o" },
      { header: "Остаток", key: "q" }, { header: "Ед. изм.", key: "u" },
      { header: "Минимальный запас", key: "mn" }, { header: "Расход в сутки", key: "du" },
      { header: "Хватит на, дней", key: "dl" }, { header: "Ожидаемая поставка", key: "dt" },
      { header: "Статус", key: "st" },
    ];
    styleSheet(ws2, [28, 24, 12, 12, 20, 18, 18, 22, 14]);
    a.stock.forEach((s) =>
      ws2.addRow({ i: s.itemName, o: s.object, q: s.qty, u: s.unit, mn: s.minQty, du: s.dailyUse,
        dl: s.daysLeft >= 999 ? "—" : s.daysLeft, dt: s.expectedDelivery ? ruDate(s.expectedDelivery) : "не назначена", st: s.status }));
  }

  if (sheets.includes("crew")) {
    const ws = wb.addWorksheet("Кто сейчас на объекте");
    ws.columns = [
      { header: "ФИО", key: "f" }, { header: "Должность", key: "p" }, { header: "Объект", key: "o" },
      { header: "Дата заезда", key: "s" }, { header: "Дата выезда", key: "e" },
      { header: "Цикл", key: "c" }, { header: "Отработано дней", key: "dw" },
      { header: "Осталось дней", key: "dl" }, { header: "Замена назначена", key: "r" },
      { header: "Телефон", key: "ph" },
    ];
    styleSheet(ws, [24, 22, 24, 14, 14, 10, 18, 16, 18, 20]);
    a.rotation.forEach((r) =>
      ws.addRow({ f: r.fio, p: r.position, o: r.object, s: ruDate(r.startDate),
        e: ruDate(r.endDate), c: r.cycleType, dw: r.daysWorked, dl: r.daysLeft,
        r: r.replacementAssigned ? "да" : "нет", ph: r.phone }));

    const ws2 = wb.addWorksheet("Укомплектованность объектов");
    ws2.columns = [
      { header: "Объект", key: "o" },
      { header: "Штат, чел.", key: "p" }, { header: "Факт, чел.", key: "f" },
      { header: "Не хватает, чел.", key: "g" },
    ];
    styleSheet(ws2, [24, 14, 14, 18]);
    a.objectStaffing.forEach((o) => ws2.addRow({ o: o.name, p: o.plan, f: o.fact, g: Math.max(0, o.gap) }));

    const ws3 = wb.addWorksheet("Справочник сотрудников");
    ws3.columns = [
      { header: "ФИО", key: "f" }, { header: "Должность", key: "p" },
      { header: "Объект", key: "o" }, { header: "Телефон", key: "t" }, { header: "Статус", key: "st" },
    ];
    styleSheet(ws3, [24, 22, 24, 20, 22]);
    {
      const today = new Date().toISOString().slice(0, 10);
      const allShifts = storage.shifts();
      storage.employees().forEach((e) => {
        const own = allShifts.filter((s2) => s2.employeeId === e.id);
        const st = own.length === 0
          ? "вахта не назначена"
          : own.some((s2) => s2.startDate <= today && s2.endDate >= today) ? "на вахте" : "на межвахте";
        ws3.addRow({ f: e.fio, p: e.position, o: objName(e.objectId) || "не указан", t: e.phone, st });
      });
    }
  }

  if (sheets.includes("sampleprep")) {
    const p = a.samplePrep;
    const samples = storage.samples();
    const labs = storage.labs();

    const ws = wb.addWorksheet("Журнал проб");
    ws.columns = [
      { header: "Номер пробы", key: "c" }, { header: "Дата отбора", key: "d" },
      { header: "Объект", key: "o" }, { header: "Скважина", key: "h" },
      { header: "Интервал от, м", key: "f" }, { header: "Интервал до, м", key: "t" },
      { header: "Тип пробы", key: "ty" }, { header: "Масса, кг", key: "w" },
      { header: "Этап", key: "st" }, { header: "Дата этапа", key: "sd" },
      { header: "Статус", key: "s" }, { header: "Партия", key: "b" }, { header: "Примечание", key: "n" },
    ];
    styleSheet(ws, [16, 14, 22, 14, 15, 15, 22, 12, 24, 14, 14, 14, 28]);
    samples.forEach((s) =>
      ws.addRow({
        c: s.code, d: ruDate(s.date), o: objName(s.objectId), h: s.holeName,
        f: s.fromDepth, t: s.toDepth, ty: s.sampleType, w: s.weightKg,
        st: s.stage, sd: ruDate(s.stageDate), s: s.status,
        b: p.batches.find((x: any) => x.id === s.batchId)?.code ?? "—",
        n: s.rejectReason || s.note,
      }));

    const ws2 = wb.addWorksheet("Этапы пробоподготовки");
    ws2.columns = [
      { header: "Этап", key: "s" }, { header: "Проб, шт.", key: "c" },
      { header: "Средний возраст, дн.", key: "a" },
      { header: "Залежалось, шт.", key: "st" }, { header: "Затор", key: "b" },
    ];
    styleSheet(ws2, [30, 14, 22, 18, 12]);
    p.byStage.forEach((s: any) =>
      ws2.addRow({ s: s.stage, c: s.count, a: s.avgDays, st: s.stuck, b: s.bottleneck ? "да" : "нет" }));

    const ws3 = wb.addWorksheet("Партии в лабораторию");
    ws3.columns = [
      { header: "Партия", key: "c" }, { header: "Лаборатория", key: "l" },
      { header: "Вид анализа", key: "a" }, { header: "Проб, шт.", key: "n" },
      { header: "Отправлена", key: "s" }, { header: "Срок", key: "d" },
      { header: "Получена", key: "r" }, { header: "Статус", key: "st" },
      { header: "Просрочка, дн.", key: "od" }, { header: "Стоимость, руб.", key: "m" },
    ];
    styleSheet(ws3, [14, 26, 26, 12, 14, 14, 14, 16, 16, 18]);
    p.batches.forEach((b: any) =>
      ws3.addRow({ c: b.code, l: b.lab, a: b.analysisType, n: b.samples, s: ruDate(b.sentDate),
        d: ruDate(b.dueDate), r: b.resultDate ? ruDate(b.resultDate) : "—", st: b.status,
        od: b.overdueDays, m: b.cost }));

    const ws4 = wb.addWorksheet("Результаты анализов");
    ws4.columns = [
      { header: "Номер пробы", key: "c" }, { header: "Объект", key: "o" },
      { header: "Скважина", key: "h" }, { header: "От, м", key: "f" }, { header: "До, м", key: "t" },
      { header: "Элемент", key: "e" }, { header: "Содержание", key: "v" },
      { header: "Ед. изм.", key: "u" }, { header: "Рудный интервал", key: "ore" },
      { header: "Дата результата", key: "d" },
    ];
    styleSheet(ws4, [16, 22, 14, 10, 10, 12, 14, 12, 18, 18]);
    p.results.rows.forEach((r: any) =>
      ws4.addRow({ c: r.code, o: r.object, h: r.hole, f: r.fromDepth, t: r.toDepth,
        e: r.element, v: r.value, u: r.unit, ore: r.ore ? "да" : "", d: ruDate(r.receivedDate) }));

    const ws5 = wb.addWorksheet("Контроль качества");
    ws5.columns = [
      { header: "Дубликат", key: "d" }, { header: "Исходная проба", key: "o" },
      { header: "Объект", key: "ob" }, { header: "Скважина", key: "h" },
      { header: "Интервал", key: "i" }, { header: "Au исходная", key: "a" },
      { header: "Au дубликат", key: "b" }, { header: "Расхождение, %", key: "dev" },
      { header: "В допуске", key: "ok" },
    ];
    styleSheet(ws5, [16, 18, 22, 14, 16, 14, 14, 18, 14]);
    p.qa.dupPairs.forEach((d: any) =>
      ws5.addRow({ d: d.code, o: d.origCode, ob: d.object, h: d.hole, i: d.interval,
        a: d.origValue, b: d.dupValue, dev: d.deviationPct, ok: d.ok === false ? "нет" : "да" }));
    ws5.addRow([]);
    ws5.addRow(["Доля дубликатов, %", p.qa.shares.dup, "норма", p.qa.shares.dupNorm]);
    ws5.addRow(["Доля стандартов, %", p.qa.shares.std, "норма", p.qa.shares.stdNorm]);
    ws5.addRow(["Доля бланков, %", p.qa.shares.blank, "норма", p.qa.shares.blankNorm]);

    const ws6 = wb.addWorksheet("Стоимость анализов");
    ws6.columns = [
      { header: "Лаборатория", key: "l" }, { header: "Город", key: "c" },
      { header: "Партий", key: "b" }, { header: "Проб", key: "n" }, { header: "Стоимость, руб.", key: "m" },
      { header: "Срок, дн.", key: "d" }, { header: "Цена за пробу, руб.", key: "p" },
    ];
    styleSheet(ws6, [26, 16, 12, 12, 20, 14, 22]);
    p.costByLab.forEach((l: any) => {
      const lab = labs.find((x) => x.name === l.lab);
      ws6.addRow({ l: l.lab, c: l.city, b: l.batches, n: l.samples, m: l.cost,
        d: lab?.leadDays ?? "—", p: lab?.pricePerSample ?? "—" });
    });
    ws6.addRow([]);
    ws6.addRow(["Итого затрат на анализы, руб.", p.totals.analysisCost]);
    ws6.addRow(["Затраты на анализы на метр проходки, руб.", p.totals.costPerMeter]);
    ws6.addRow(["Плотность опробования, проб/м", p.totals.samplesPerMeter]);
  }

  if (sheets.includes("core")) {
    const c = a.core;

    const ws = wb.addWorksheet("Отставания по скважинам");
    ws.columns = [
      { header: "Скважина", key: "h" }, { header: "Объект", key: "o" },
      { header: "Пробурено, м", key: "d" }, { header: "Описано, м", key: "l" },
      { header: "Распилено, м", key: "cu" }, { header: "Опробовано, м", key: "s" },
      { header: "Отставание описания, м", key: "lm" },
      { header: "Отставание описания, %", key: "lp" },
      { header: "Отставание описания, дн.", key: "ld" },
      { header: "Отставание распиловки, м", key: "cm" },
      { header: "Отставание распиловки, дн.", key: "cd" },
      { header: "Тренд", key: "t" }, { header: "Растёт дней подряд", key: "g" },
      { header: "Выход керна, %", key: "r" },
    ];
    styleSheet(ws, [14, 22, 16, 14, 16, 16, 22, 22, 24, 24, 24, 14, 20, 16]);
    c.byHole.forEach((h: any) =>
      ws.addRow({ h: h.hole, o: h.object, d: h.drilled, l: h.described, cu: h.cut, s: h.sampled,
        lm: h.lagDescM, lp: h.lagDescPct, ld: h.lagDescDays, cm: h.lagCutM, cd: h.lagCutDays,
        t: h.trend, g: h.growDays, r: h.avgRecovery }));

    const ws2 = wb.addWorksheet("Описание керна");
    ws2.columns = [
      { header: "Дата", key: "d" }, { header: "Объект", key: "o" }, { header: "Скважина", key: "h" },
      { header: "От, м", key: "f" }, { header: "До, м", key: "t" }, { header: "Геолог", key: "g" },
      { header: "Выход керна, %", key: "r" }, { header: "Литология", key: "l" },
      { header: "Минерализация", key: "m" }, { header: "Фото", key: "p" }, { header: "Статус", key: "s" },
    ];
    styleSheet(ws2, [14, 22, 14, 10, 10, 22, 18, 40, 18, 10, 20]);
    const emps = storage.employees();
    storage.coreLogs().forEach((l) =>
      ws2.addRow({ d: ruDate(l.date), o: objName(l.objectId), h: l.holeName, f: l.fromDepth, t: l.toDepth,
        g: emps.find((e) => e.id === l.geologistId)?.fio ?? "—", r: l.recoveryPct, l: l.lithology,
        m: l.mineralization ? "да" : "нет", p: l.photo ? "да" : "нет", s: l.status }));

    const ws3 = wb.addWorksheet("Распиловка керна");
    ws3.columns = [
      { header: "Дата", key: "d" }, { header: "Объект", key: "o" }, { header: "Скважина", key: "h" },
      { header: "От, м", key: "f" }, { header: "До, м", key: "t" }, { header: "Исполнитель", key: "w" },
      { header: "Смена", key: "sh" }, { header: "Тип распиловки", key: "ct" },
      { header: "Брак, м", key: "rm" }, { header: "Причина брака", key: "rr" }, { header: "Статус", key: "s" },
    ];
    styleSheet(ws3, [14, 22, 14, 10, 10, 22, 12, 24, 12, 26, 20]);
    storage.coreCuts().forEach((x) =>
      ws3.addRow({ d: ruDate(x.date), o: objName(x.objectId), h: x.holeName, f: x.fromDepth, t: x.toDepth,
        w: x.worker, sh: x.shift, ct: x.cutType, rm: x.rejectMeters, rr: x.rejectReason, s: x.status }));

    const ws4 = wb.addWorksheet("Производительность");
    ws4.columns = [
      { header: "Геолог", key: "n" }, { header: "Объект", key: "o" },
      { header: "Описано, м", key: "m" }, { header: "Дней работы", key: "d" },
      { header: "М/день", key: "p" }, { header: "За месяц, м", key: "mm" },
      { header: "Фотодокументация, %", key: "ph" }, { header: "Норматив выполнен", key: "ok" },
    ];
    styleSheet(ws4, [24, 22, 16, 14, 12, 16, 22, 22]);
    c.geologists.forEach((g: any) =>
      ws4.addRow({ n: g.name, o: g.object, m: g.meters, d: g.days, p: g.perDay,
        mm: g.monthMeters, ph: g.photoPct, ok: g.normOk ? "да" : "нет" }));
    ws4.addRow([]);
    ws4.addRow(["Распиловка: всего, м", c.cutting.meters]);
    ws4.addRow(["Распиловка: м/смена", c.cutting.perShift]);
    ws4.addRow(["Распиловка: брак, %", c.cutting.rejectPct]);
  }

  brandWorkbook(wb);
  return wb;
}

export async function buildSummaryWorkbook(period: "day" | "week" | "month") {
  const a = buildAnalytics();
  const s = a.summaries[period];
  const wb = new ExcelJS.Workbook();
  wb.creator = "ГРР-Контроль";
  const ws = wb.addWorksheet("Сводка");
  ws.columns = [{ width: 110 }];
  s.text.split("\n").forEach((line, i) => {
    const row = ws.addRow([line]);
    row.alignment = { wrapText: true, vertical: "top" };
    if (i === 0) row.font = { bold: true, size: 13 };
    if (["СУТЬ", "ВЫВОДЫ", "РИСКИ", "ЧТО РЕШИТЬ"].includes(line)) row.font = { bold: true, size: 12, color: { argb: HEAD_FILL } };
  });
  brandWorkbook(wb);
  return wb;
}
