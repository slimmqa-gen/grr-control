import { storage } from "./storage";
import { buildSamplePrep } from "./sampleprep";
import type { Thresholds } from "@shared/schema";
import { EMPLOYEE_EVENT_LABELS } from "@shared/schema";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
export const today = () => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
};
const monthOf = (s: string) => s.slice(0, 7);
const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (a: number, b: number) => (b === 0 ? 0 : (a / b) * 100);

export const fmtNum = (n: number, digits = 0) =>
  new Intl.NumberFormat("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
export const fmtMoney = (n: number) => fmtNum(Math.round(n)) + " ₽";

export type Flag = {
  level: "критично" | "внимание";
  object: string;
  title: string;
  value: string;
  advice: string;
};

export function buildAnalytics() {
  const t = storage.getThresholds();
  const objects = storage.objects();
  const rigs = storage.rigs();
  const brigades = storage.brigades();
  const reports = storage.reports();
  const costs = storage.costs();
  const fuelRows = storage.fuel();
  const inv = storage.inventory();
  const emps = storage.employees();
  const shiftRows = storage.shifts();
  const empEvents = storage.employeeEvents();

  const now = today();
  const nowIso = iso(now);
  const curMonth = nowIso.slice(0, 7);
  const objName = (id: number) => objects.find((o) => o.id === id)?.name ?? "—";
  const rigName = (id: number) => rigs.find((r) => r.id === id)?.name ?? "—";
  const brName = (id: number) => brigades.find((b) => b.id === id)?.name ?? "—";

  const inRange = (from: string, to: string) => reports.filter((r) => r.date >= from && r.date <= to);
  const sum = <T,>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0);

  // ---------- Периоды ----------
  const dayFrom = nowIso;
  const weekFrom = iso(addDays(now, -6));
  const monthFrom = `${curMonth}-01`;
  const prevWeekFrom = iso(addDays(now, -13));
  const prevWeekTo = iso(addDays(now, -7));
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const prevMonth = iso(prevMonthDate).slice(0, 7);

  const monthReports = reports.filter((r) => monthOf(r.date) === curMonth);
  const prevMonthReports = reports.filter((r) => monthOf(r.date) === prevMonth);
  const weekReports = inRange(weekFrom, nowIso);
  const prevWeekReports = inRange(prevWeekFrom, prevWeekTo);
  const dayReports = inRange(dayFrom, nowIso);

  // ---------- KPI за текущий месяц ----------
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();
  const planMonthFull = sum(objects, (o) => o.planMetersMonth);
  const planToDate = (planMonthFull / daysInMonth) * daysElapsed;
  const factMonth = sum(monthReports, (r) => r.meters);
  const shiftsCount = monthReports.length || 1;
  const metersPerShift = factMonth / shiftsCount;
  const totalHours = sum(monthReports, (r) => r.drillHours + r.pzrHours + r.downtimeHours);
  const downtimeHours = sum(monthReports, (r) => r.downtimeHours);
  const downtimeShare = pct(downtimeHours, totalHours || 1);
  const monthCosts = sum(costs.filter((c) => c.month === curMonth), (c) => c.amount);
  const costPerMeter = factMonth ? monthCosts / factMonth : 0;
  const revenueMonth = sum(objects, (o) =>
    sum(monthReports.filter((r) => r.objectId === o.id), (r) => r.meters) * o.pricePerMeter);
  const marginMonth = revenueMonth - monthCosts;
  const profitability = pct(marginMonth, revenueMonth || 1);

  const activeShifts = shiftRows.filter((s) => s.startDate <= nowIso && s.endDate >= nowIso);
  const peopleOnSite = activeShifts.length;
  const staffRequired = sum(objects, (o) => o.staffRequired);

  // производительность метров в час бурения (для пересчёта простоев)
  const drillHoursMonth = sum(monthReports, (r) => r.drillHours) || 1;
  const metersPerDrillHour = factMonth / drillHoursMonth;
  const avgPrice = objects.length ? sum(objects, (o) => o.pricePerMeter) / objects.length : 0;

  const kpi = {
    factMeters: r0(factMonth),
    planMeters: r0(planMonthFull),
    planToDate: r0(planToDate),
    planPct: r1(pct(factMonth, planToDate || 1)),
    metersPerShift: r1(metersPerShift),
    downtimeShare: r1(downtimeShare),
    costPerMeter: r0(costPerMeter),
    profitability: r1(profitability),
    peopleOnSite,
    staffRequired,
    revenue: r0(revenueMonth),
    margin: r0(marginMonth),
    monthLabel: monthTitle(curMonth),
  };

  // ---------- По объектам ----------
  const byObject = objects.map((o) => {
    const rs = monthReports.filter((r) => r.objectId === o.id);
    const fact = sum(rs, (r) => r.meters);
    const planTo = (o.planMetersMonth / daysInMonth) * daysElapsed;
    const hrs = sum(rs, (r) => r.drillHours + r.pzrHours + r.downtimeHours) || 1;
    const dt = sum(rs, (r) => r.downtimeHours);
    const oCosts = sum(costs.filter((c) => c.objectId === o.id && c.month === curMonth), (c) => c.amount);
    const cpm = fact ? oCosts / fact : 0;
    const revenue = fact * o.pricePerMeter;
    const totalFactAll = sum(reports.filter((r) => r.objectId === o.id), (r) => r.meters);
    const lastDate = rs.length
      ? rs.map((r) => r.date).sort().slice(-1)[0]
      : reports.filter((r) => r.objectId === o.id).map((r) => r.date).sort().slice(-1)[0] ?? "";
    // прогноз
    const perDay = fact / Math.max(1, daysElapsed);
    const daysLeft = Math.max(0, Math.round((new Date(o.contractEnd).getTime() - now.getTime()) / 86400000));
    const remaining = Math.max(0, o.contractVolume - totalFactAll);
    const forecastMeters = totalFactAll + perDay * daysLeft;
    const willMeet = forecastMeters >= o.contractVolume;
    const neededPerDay = daysLeft ? remaining / daysLeft : remaining;
    const daysLate = perDay > 0 ? Math.max(0, Math.round(remaining / perDay) - daysLeft) : 999;
    const shiftsPerDay = 2 * Math.max(1, rigs.filter((r) => r.objectId === o.id).length);
    return {
      id: o.id, name: o.name, customer: o.customer, region: o.region,
      fact: r0(fact), planToDate: r0(planTo), planMonth: o.planMetersMonth,
      planPct: r1(pct(fact, planTo || 1)),
      downtimeShare: r1(pct(dt, hrs)), downtimeHours: r1(dt),
      costs: r0(oCosts), costPerMeter: r0(cpm), plannedCostPerMeter: o.plannedCostPerMeter,
      costDeviationPct: r1(pct(cpm - o.plannedCostPerMeter, o.plannedCostPerMeter || 1)),
      revenue: r0(revenue), margin: r0(revenue - oCosts),
      profitability: r1(pct(revenue - oCosts, revenue || 1)),
      pricePerMeter: o.pricePerMeter, contractVolume: o.contractVolume,
      contractEnd: o.contractEnd, doneTotal: r0(totalFactAll),
      contractPct: r1(pct(totalFactAll, o.contractVolume)),
      daysLeft, willMeet, daysLate,
      neededPerShift: r1(neededPerDay / shiftsPerDay),
      currentPerShift: r1(perDay / shiftsPerDay),
      lastReport: lastDate,
      silenceDays: lastDate ? Math.round((now.getTime() - new Date(lastDate).getTime()) / 86400000) : 999,
      staffRequired: o.staffRequired,
      staffOnSite: activeShifts.filter((s) => s.objectId === o.id).length,
    };
  });

  // ---------- Рейтинг станков и сменных мастеров ----------
  const rating = (rows: { id: number; name: string; object: string }[], key: "rigId" | "brigadeId") =>
    rows
      .map((x) => {
        const rs = monthReports.filter((r: any) => r[key] === x.id);
        const fact = sum(rs, (r) => r.meters);
        const hrs = sum(rs, (r) => r.drillHours + r.pzrHours + r.downtimeHours) || 1;
        const dt = sum(rs, (r) => r.downtimeHours);
        return {
          id: x.id, name: x.name, object: x.object,
          shifts: rs.length,
          meters: r0(fact),
          perShift: r1(rs.length ? fact / rs.length : 0),
          downtimeShare: r1(pct(dt, hrs)),
          downtimeHours: r1(dt),
        };
      })
      .sort((a, b) => b.perShift - a.perShift);

  const rigRating = rating(rigs.map((r) => ({ id: r.id, name: r.name, object: objName(r.objectId) })), "rigId");
  // Рейтинг сменных мастеров: имя мастера хранится в названии смены рапорта
  const brigadeRating = rating(
    brigades.map((b) => ({
      id: b.id,
      name: String(b.name).replace(/^Бригада\s+/i, "") || b.name,
      object: objName(b.objectId),
    })), "brigadeId");

  // ---------- Причины простоев ----------
  const reasonMap = new Map<string, number>();
  monthReports.forEach((r) => {
    if (r.downtimeHours > 0 && r.downtimeReason && r.downtimeReason !== "нет")
      reasonMap.set(r.downtimeReason, (reasonMap.get(r.downtimeReason) ?? 0) + r.downtimeHours);
  });
  const downtimeReasons = [...reasonMap.entries()]
    .map(([reason, hours]) => ({
      reason,
      hours: r1(hours),
      sharePct: r1(pct(hours, downtimeHours || 1)),
      lostMeters: r0(hours * metersPerDrillHour),
      lostMoney: r0(hours * metersPerDrillHour * avgPrice),
    }))
    .sort((a, b) => b.hours - a.hours);

  const downtimeByObject = objects.map((o) => {
    const rs = monthReports.filter((r) => r.objectId === o.id);
    const dt = sum(rs, (r) => r.downtimeHours);
    return {
      object: o.name, hours: r1(dt),
      lostMeters: r0(dt * metersPerDrillHour),
      lostMoney: r0(dt * metersPerDrillHour * o.pricePerMeter),
    };
  }).sort((a, b) => b.lostMoney - a.lostMoney);

  const lostTotal = {
    hours: r1(downtimeHours),
    meters: r0(downtimeHours * metersPerDrillHour),
    money: r0(sum(downtimeByObject, (d) => d.lostMoney)),
  };

  // ---------- Сравнение с прошлым периодом ----------
  const cmp = (cur: number, prev: number) => ({
    current: r0(cur), previous: r0(prev),
    deltaPct: prev ? r1(pct(cur - prev, prev)) : 0,
    direction: cur > prev ? "рост" : cur < prev ? "падение" : "без изменений",
  });
  const weekMeters = sum(weekReports, (r) => r.meters);
  const prevWeekMeters = sum(prevWeekReports, (r) => r.meters);
  const comparisons = {
    weekMeters: cmp(weekMeters, prevWeekMeters),
    monthMeters: cmp(factMonth, sum(prevMonthReports, (r) => r.meters)),
    weekDowntimeShare: cmp(
      pct(sum(weekReports, (r) => r.downtimeHours), sum(weekReports, (r) => r.drillHours + r.pzrHours + r.downtimeHours) || 1),
      pct(sum(prevWeekReports, (r) => r.downtimeHours), sum(prevWeekReports, (r) => r.drillHours + r.pzrHours + r.downtimeHours) || 1),
    ),
    weekPerShift: {
      current: r1(weekReports.length ? weekMeters / weekReports.length : 0),
      previous: r1(prevWeekReports.length ? prevWeekMeters / prevWeekReports.length : 0),
      deltaPct: 0, direction: "",
    },
  };
  comparisons.weekPerShift.deltaPct = comparisons.weekPerShift.previous
    ? r1(pct(comparisons.weekPerShift.current - comparisons.weekPerShift.previous, comparisons.weekPerShift.previous)) : 0;
  comparisons.weekPerShift.direction =
    comparisons.weekPerShift.deltaPct > 0 ? "рост" : comparisons.weekPerShift.deltaPct < 0 ? "падение" : "без изменений";

  // ---------- ГСМ ----------
  const fuelMonth = fuelRows.filter((f) => monthOf(f.date) === curMonth);
  const fuelByUnit = [...new Set(fuelMonth.map((f) => f.unitName))].map((u) => {
    const rows = fuelMonth.filter((f) => f.unitName === u);
    const norm = sum(rows, (f) => f.normLiters);
    const fact = sum(rows, (f) => f.factLiters);
    return {
      unitName: u, object: objName(rows[0].objectId),
      norm: r0(norm), fact: r0(fact), deviation: r0(fact - norm),
      deviationPct: r1(pct(fact - norm, norm || 1)),
    };
  }).sort((a, b) => b.deviationPct - a.deviationPct);
  const fuelNorm = sum(fuelMonth, (f) => f.normLiters);
  const fuelFact = sum(fuelMonth, (f) => f.factLiters);
  const fuelOverPct = r1(pct(fuelFact - fuelNorm, fuelNorm || 1));

  const fuelByObject = objects.map((o) => {
    const rows = fuelMonth.filter((f) => f.objectId === o.id);
    const norm = sum(rows, (f) => f.normLiters);
    const fact = sum(rows, (f) => f.factLiters);
    return { object: o.name, norm: r0(norm), fact: r0(fact), deviationPct: r1(pct(fact - norm, norm || 1)) };
  });

  // ---------- Запасы ----------
  const stock = inv.map((i) => {
    const days = i.dailyUse > 0 ? Math.floor(i.qty / i.dailyUse) : 999;
    return {
      ...i, object: objName(i.objectId), daysLeft: days,
      belowMin: i.qty < i.minQty,
      status: i.qty < i.minQty || days < t.stockDaysMin ? "критично" : days < t.stockDaysMin * 2 ? "внимание" : "норма",
    };
  });

  // ---------- Вахты ----------
  const empById = new Map(emps.map((e) => [e.id, e]));
  const rotation = activeShifts.map((s) => {
    const e = empById.get(s.employeeId);
    const daysWorked = Math.round((now.getTime() - new Date(s.startDate).getTime()) / 86400000) + 1;
    const daysLeft = Math.round((new Date(s.endDate).getTime() - now.getTime()) / 86400000);
    const cycleDays = Number(s.cycleType.split("/")[0]) || 30;
    return {
      shiftId: s.id, employeeId: s.employeeId,
      fio: e?.fio ?? "—", position: e?.position ?? "—", phone: e?.phone ?? "",
      object: objName(s.objectId), objectId: s.objectId,
      startDate: s.startDate, endDate: s.endDate, cycleType: s.cycleType,
      daysWorked, daysLeft, overtime: daysWorked > cycleDays,
      replacementAssigned: s.replacementAssigned === 1,
    };
  }).sort((a, b) => a.daysLeft - b.daysLeft);

  const objectStaffing = objects
    .filter((o) => Number(o.staffRequired) > 0)
    .map((o) => {
      const fact = emps.filter((e) => e.objectId === o.id).length;
      const plan = Number(o.staffRequired) || 0;
      return { id: o.id, name: o.name, plan, fact, gap: plan - fact, complete: fact >= plan };
    });

  // ---------- Движок предупреждений ----------
  const flags: Flag[] = [];
  byObject.forEach((o) => {
    if (o.planPct < 100 - t.planLagPct)
      flags.push({
        level: 100 - o.planPct > t.planLagPct * 2 ? "критично" : "внимание",
        object: o.name, title: "Отставание от плана по метрам",
        value: `${fmtNum(o.fact)} м при плане ${fmtNum(o.planToDate)} м (${o.planPct}%)`,
        advice: "Разобрать причины с начальником участка, усилить смену или увеличить сменное задание.",
      });
    if (o.downtimeShare > t.downtimeSharePct)
      flags.push({
        level: o.downtimeShare > t.downtimeSharePct * 1.5 ? "критично" : "внимание",
        object: o.name, title: "Высокая доля простоев",
        value: `${o.downtimeShare}% времени (${fmtNum(o.downtimeHours, 1)} ч)`,
        advice: "Провести разбор простоев по причинам, ускорить снабжение и ремонт техники.",
      });
    if (o.costDeviationPct > t.costOverPct)
      flags.push({
        level: o.costDeviationPct > t.costOverPct * 2 ? "критично" : "внимание",
        object: o.name, title: "Себестоимость метра выше сметы",
        value: `${fmtMoney(o.costPerMeter)}/м против ${fmtMoney(o.plannedCostPerMeter)}/м (+${o.costDeviationPct}%)`,
        advice: "Проверить статьи ГСМ и ремонтов, пересмотреть смету или логистику.",
      });
    if (!o.willMeet)
      flags.push({
        level: "внимание", object: o.name, title: "Риск срыва срока по договору",
        value: `при текущем темпе опоздание ${o.daysLate} дн., нужно ${o.neededPerShift} м/смена вместо ${o.currentPerShift}`,
        advice: "Добавить станок или смену либо согласовать перенос срока с заказчиком.",
      });
    if (o.silenceDays > t.silenceDays)
      flags.push({
        level: "критично", object: o.name, title: "Нет данных с объекта",
        value: `последний рапорт ${o.silenceDays} дн. назад (${o.lastReport || "нет"})`,
        advice: "Связаться с участком: молчание с объекта — тоже сигнал.",
      });
  });
  fuelByUnit.filter((f) => f.deviationPct > t.fuelOverPct).forEach((f) =>
    flags.push({
      level: f.deviationPct > t.fuelOverPct * 2 ? "критично" : "внимание",
      object: f.object, title: `Перерасход ГСМ: ${f.unitName}`,
      value: `${fmtNum(f.fact)} л против нормы ${fmtNum(f.norm)} л (+${f.deviationPct}%)`,
      advice: "Проверить путевые листы и техническое состояние агрегата, назначить замер расхода.",
    }));
  stock.filter((s) => s.status === "критично").forEach((s) =>
    flags.push({
      level: s.belowMin ? "критично" : "внимание",
      object: s.object, title: `Низкий запас: ${s.itemName}`,
      value: `остаток ${fmtNum(s.qty, 0)} ${s.unit}, минимум ${fmtNum(s.minQty, 0)} ${s.unit}, хватит на ${s.daysLeft} дн.`,
      advice: s.expectedDelivery ? `Поставка ожидается ${ruDate(s.expectedDelivery)} — подтвердить отгрузку.`
        : "Срочно разместить заявку на поставку.",
    }));
  rotation.filter((r) => r.daysLeft <= t.rotationEndDays && !r.replacementAssigned).forEach((r) =>
    flags.push({
      level: r.daysLeft <= 2 ? "критично" : "внимание",
      object: r.object, title: `Вахта заканчивается без замены: ${r.fio}`,
      value: `${r.position}, осталось ${r.daysLeft} дн. (выезд ${ruDate(r.endDate)})`,
      advice: "Назначить замену и оформить билеты, иначе на объекте не хватит людей.",
    }));
  rotation.filter((r) => r.overtime).forEach((r) =>
    flags.push({
      level: "внимание", object: r.object, title: `Переработка сверх цикла: ${r.fio}`,
      value: `${r.daysWorked} дн. при цикле ${r.cycleType}`,
      advice: "Организовать выезд и оплату переработки.",
    }));
  // предупреждаем только по объектам, где люди уже закреплены
  objectStaffing.filter((o) => !o.complete && o.fact > 0).forEach((o) =>
    flags.push({
      level: o.gap > 2 ? "критично" : "внимание",
      object: o.name, title: `Объект недоукомплектован людьми: ${o.name}`,
      value: `${o.fact} из ${o.plan} чел., не хватает ${o.gap}`,
      advice: "Заявка в отдел кадров на добор вахтового персонала.",
    }));

  // ---------- Отпуска, больничные, командировки, обучение ----------
  const empName = (id: number) => emps.find((e) => e.id === id)?.fio ?? "—";
  const activeEmployeeEvents = empEvents
    .filter((ev) => ev.startDate <= nowIso && ev.endDate >= nowIso)
    .map((ev) => {
      const daysLeft = Math.round((new Date(ev.endDate + "T00:00:00Z").getTime() - now.getTime()) / 86400000);
      return {
        id: ev.id, employeeId: ev.employeeId, fio: empName(ev.employeeId), kind: ev.kind,
        startDate: ev.startDate, endDate: ev.endDate, destination: ev.destination, note: ev.note,
        daysLeft, object: objName(emps.find((e) => e.id === ev.employeeId)?.objectId ?? 0),
      };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const upcomingEmployeeEvents = empEvents
    .filter((ev) => ev.startDate > nowIso && ev.startDate <= iso(addDays(now, 7)))
    .map((ev) => ({
      id: ev.id, employeeId: ev.employeeId, fio: empName(ev.employeeId), kind: ev.kind,
      startDate: ev.startDate, endDate: ev.endDate, destination: ev.destination, note: ev.note,
    }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  activeEmployeeEvents.filter((ev) => ev.daysLeft <= 2).forEach((ev) =>
    flags.push({
      level: ev.daysLeft <= 0 ? "критично" : "внимание",
      object: ev.object || "—",
      title: `${EMPLOYEE_EVENT_LABELS[ev.kind] ?? ev.kind} заканчивается: ${ev.fio}`,
      value: ev.daysLeft <= 0 ? `истекает сегодня (${ruDate(ev.endDate)})` : `осталось ${ev.daysLeft} дн. (до ${ruDate(ev.endDate)})`,
      advice: ev.kind === "sick" ? "Уточнить закрытие больничного листа и дату выхода на работу."
        : ev.kind === "trip" ? "Проверить возвращение из командировки и билеты обратно."
        : "Уточнить дату возвращения к работе и обновить график вахт.",
    }));
  upcomingEmployeeEvents.filter((ev) => {
    const days = Math.round((new Date(ev.startDate + "T00:00:00Z").getTime() - now.getTime()) / 86400000);
    return days <= 2;
  }).forEach((ev) =>
    flags.push({
      level: "внимание",
      object: ev.fio,
      title: `${EMPLOYEE_EVENT_LABELS[ev.kind] ?? ev.kind} скоро начинается: ${ev.fio}`,
      value: `с ${ruDate(ev.startDate)} по ${ruDate(ev.endDate)}${ev.destination ? `, ${ev.destination}` : ""}`,
      advice: "Учесть отсутствие сотрудника при планировании вахт и замен.",
    }));

  // Пробоподготовка и керн
  const sp = buildSamplePrep(t, now);
  sp.flags.forEach((f) => flags.push(f));

  const order = { "критично": 0, "внимание": 1 };
  flags.sort((a, b) => order[a.level] - order[b.level]);

  // ---------- Данные для графиков ----------
  const dayKeys: string[] = [];
  for (let i = 29; i >= 0; i--) dayKeys.push(iso(addDays(now, -i)));
  const planPerDay = planMonthFull / daysInMonth;
  const metersByDay = dayKeys.map((d) => ({
    date: d, label: d.slice(8, 10) + "." + d.slice(5, 7),
    факт: r0(sum(reports.filter((r) => r.date === d), (r) => r.meters)),
    план: r0(planPerDay),
  }));
  const charts = {
    metersByDay,
    downtimeStructure: downtimeReasons.map((d) => ({ name: d.reason, value: d.hours })),
    perShiftByRig: rigRating.map((r) => ({ name: r.name, "м/смена": r.perShift })),
    costPerMeterByObject: byObject.map((o) => ({
      name: o.name.replace("Участок ", ""), факт: o.costPerMeter, смета: o.plannedCostPerMeter,
    })),
    costStructure: (() => {
      const m = new Map<string, number>();
      costs.filter((c) => c.month === curMonth).forEach((c) => m.set(c.category, (m.get(c.category) ?? 0) + c.amount));
      return [...m.entries()].map(([name, value]) => ({ name, value: r0(value) })).sort((a, b) => b.value - a.value);
    })(),
    fuelByObject,
  };

  // ---------- Автоматические сводки ----------
  const summaries = {
    day: buildSummary("день", dayReports, dayFrom, nowIso),
    week: buildSummary("неделя", weekReports, weekFrom, nowIso),
    month: buildSummary("месяц", monthReports, monthFrom, nowIso),
  };

  function buildSummary(period: "день" | "неделя" | "месяц", rows: typeof reports, from: string, to: string) {
    const days = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1);
    const fact = sum(rows, (r) => r.meters);
    const plan = (planMonthFull / daysInMonth) * days;
    const dev = pct(fact - plan, plan || 1);
    const hrs = sum(rows, (r) => r.drillHours + r.pzrHours + r.downtimeHours) || 1;
    const dt = sum(rows, (r) => r.downtimeHours);
    const periodTitle = period === "день" ? "За сутки" : period === "неделя" ? "За неделю" : "За месяц";

    const essence: string[] = [];
    essence.push(
      `${periodTitle} (${ruDate(from)}${from !== to ? " — " + ruDate(to) : ""}) пробурено ${fmtNum(r0(fact))} м при плане ${fmtNum(r0(plan))} м — ${dev >= 0 ? "перевыполнение" : "отставание"} ${fmtNum(Math.abs(r1(dev)), 1)}%.`);
    essence.push(
      `Отработано ${rows.length} смен, средняя производительность ${fmtNum(r1(rows.length ? fact / rows.length : 0), 1)} м/смена. Доля простоев ${fmtNum(r1(pct(dt, hrs)), 1)}% (${fmtNum(r1(dt), 1)} ч).`);
    if (period !== "день") {
      const c = period === "неделя" ? comparisons.weekMeters : comparisons.monthMeters;
      essence.push(
        `К предыдущему периоду: ${fmtNum(c.current)} м против ${fmtNum(c.previous)} м — ${c.direction} ${fmtNum(Math.abs(c.deltaPct), 1)}%.`);
    }

    const conclusions: string[] = [];
    if (rigRating.length) {
      const best = rigRating[0], worst = rigRating[rigRating.length - 1];
      conclusions.push(
        `Лидер по производительности — станок ${best.name} (${best.object}): ${fmtNum(best.perShift, 1)} м/смена. Отстающий — ${worst.name} (${worst.object}): ${fmtNum(worst.perShift, 1)} м/смена, простои ${worst.downtimeShare}%.`);
    }
    if (brigadeRating.length) {
      const b0 = brigadeRating[0], bl = brigadeRating[brigadeRating.length - 1];
      conclusions.push(
        `Лучший сменный мастер — ${b0.name} (${b0.object}): ${fmtNum(b0.perShift, 1)} м/смена; слабее всех ${bl.name}: ${fmtNum(bl.perShift, 1)} м/смена.`);
    }
    const topReasons = downtimeReasons.slice(0, 3);
    if (topReasons.length) {
      conclusions.push(
        "Топ причин потерь времени за месяц: " +
        topReasons.map((d, i) => `${i + 1}) ${d.reason} — ${fmtNum(d.hours, 1)} ч, это ${fmtNum(d.lostMeters)} непробуренных метров и ${fmtMoney(d.lostMoney)} упущенной выручки`).join("; ") + ".");
    }
    const worstCost = [...byObject].sort((a, b) => b.costDeviationPct - a.costDeviationPct)[0];
    if (worstCost && worstCost.costPerMeter > 0) {
      const fuelObj = fuelByObject.find((f) => f.object === worstCost.name);
      conclusions.push(
        `Себестоимость метра по объекту ${worstCost.name} ${fmtMoney(worstCost.costPerMeter)} против сметы ${fmtMoney(worstCost.plannedCostPerMeter)} — отклонение ${worstCost.costDeviationPct > 0 ? "+" : ""}${worstCost.costDeviationPct}%${fuelObj ? `, ГСМ ${fuelObj.deviationPct > 0 ? "+" : ""}${fuelObj.deviationPct}% к норме` : ""}.`);
    }
    sp.summaryCore.forEach((s) => conclusions.push(s));
    sp.summaryPrep.forEach((s) => conclusions.push(s));
    conclusions.push(
      `Портфель: выручка ${fmtMoney(revenueMonth)}, затраты ${fmtMoney(monthCosts)}, маржа ${fmtMoney(marginMonth)}, рентабельность ${fmtNum(r1(profitability), 1)}%.`);

    const risks: string[] = flags.slice(0, 6).map((f) => `[${f.level.toUpperCase()}] ${f.object}: ${f.title} — ${f.value}.`);
    if (!risks.length) risks.push("Критичных отклонений не выявлено, показатели в пределах установленных порогов.");

    const actions: string[] = [];
    byObject.filter((o) => !o.willMeet).forEach((o) =>
      actions.push(`${o.name}: при текущем темпе опоздание к сроку договора ${o.daysLate} дн. — нужно поднять выработку до ${fmtNum(o.neededPerShift, 1)} м/смена (сейчас ${fmtNum(o.currentPerShift, 1)}).`));
    flags.filter((f) => f.level === "критично").slice(0, 5).forEach((f) =>
      actions.push(`${f.object}: ${f.title.toLowerCase()} — ${f.advice}`));
    if (lostTotal.money > 0)
      actions.push(`Цена простоев за месяц — ${fmtMoney(lostTotal.money)} (${fmtNum(lostTotal.meters)} м). Сокращение простоев на четверть вернёт ${fmtMoney(lostTotal.money * 0.25)}.`);
    if (!actions.length) actions.push("Решений, требующих вмешательства директора, не выявлено.");

    const text = [
      `СВОДКА ДЛЯ ГЕНЕРАЛЬНОГО ДИРЕКТОРА — ${periodTitle.toLowerCase()} (сформировано ${ruDate(nowIso)})`,
      "", "СУТЬ", ...essence.map((s) => "• " + s),
      "", "ВЫВОДЫ", ...conclusions.map((s) => "• " + s),
      "", "РИСКИ", ...risks.map((s) => "• " + s),
      "", "ЧТО РЕШИТЬ", ...actions.map((s, i) => `${i + 1}. ${s}`),
    ].join("\n");

    return { period, periodTitle, from, to, essence, conclusions, risks, actions, text };
  }

  return {
    generatedAt: new Date().toISOString(),
    nowIso, curMonth, thresholds: t,
    kpi, byObject, rigRating, brigadeRating, downtimeReasons, downtimeByObject, lostTotal,
    comparisons, fuelByUnit, fuelByObject, fuelTotals: { norm: r0(fuelNorm), fact: r0(fuelFact), deviationPct: fuelOverPct },
    stock, rotation, objectStaffing, flags, charts, summaries,
    activeEmployeeEvents, upcomingEmployeeEvents,
    samplePrep: sp.prep, core: sp.core,
    counts: {
      objects: objects.length, rigs: rigs.length, brigades: brigades.length,
      reports: reports.length, employees: emps.length,
    },
  };
}

export function ruDate(s: string) {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return `${d}.${m}.${y}`;
}

const MONTHS_RU = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль",
  "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
export function monthTitle(m: string) {
  const [y, mm] = m.split("-");
  return `${MONTHS_RU[Number(mm) - 1]} ${y}`;
}
