import { storage } from "./storage";
import type { Estimate, EstimateLine } from "@shared/schema";

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const sum = <T,>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + (f(x) || 0), 0);
const fmtMoney = (n: number) =>
  `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(n))} ₽`;
const fmtNum = (n: number, d = 0) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: d }).format(n);
const monthOf = (iso: string) => (iso || "").slice(0, 7);

export type EstimateAnalytics = ReturnType<typeof buildEstimateAnalytics>;

/** Экономика по сметам и календарным планам: себестоимость, освоение, прогноз */
export function buildEstimateAnalytics(nowIso = new Date().toISOString()) {
  const now = new Date(nowIso);
  const curMonth = nowIso.slice(0, 7);
  const t = storage.getThresholds() as any;

  const objects = storage.objects();
  const reports = storage.reports();
  const costs = storage.costs();
  const ests = storage.estimates();
  const lines = storage.estimateLines();
  const rates = storage.depthRates();
  const plans = storage.calendarPlans();
  const stages = storage.calendarStages();

  const budgetAheadPP = t.budgetAheadPP ?? 10;
  const cpmOverPct = t.costPerMeterOverPct ?? 10;
  const lagDaysLimit = t.calendarLagDays ?? 10;
  const forecastOverPct = t.forecastOverPct ?? 3;

  const flags: any[] = [];

  const byEstimate = ests.filter((e) => e.active).map((e: Estimate) => {
    const obj = objects.find((o) => o.id === e.objectId);
    const objName = obj?.name ?? "Объект не указан";
    const eLines: EstimateLine[] = lines.filter((l) => l.estimateId === e.id);
    const direct = sum(eLines.filter((l) => l.section === "прямые"), (l) => l.amount);
    const overhead = sum(eLines.filter((l) => l.section === "накладные"), (l) => l.amount);
    const total = direct + overhead;
    const planMeters = e.planMeters || obj?.contractVolume || 0;
    const planCpm = planMeters ? total / planMeters : 0;

    const objReports = reports.filter((r) => r.objectId === e.objectId);
    const factMeters = sum(objReports, (r) => r.meters);
    const objCosts = costs.filter((c) => c.objectId === e.objectId);
    const factCost = sum(objCosts, (c) => c.amount);
    const factCpm = factMeters ? factCost / factMeters : 0;
    const cpmDeviation = planCpm ? ((factCpm - planCpm) / planCpm) * 100 : 0;

    const spendPct = total ? (factCost / total) * 100 : 0;
    const volumePct = planMeters ? (factMeters / planMeters) * 100 : 0;
    const gapPP = spendPct - volumePct;

    // Отклонения по статьям: смета против фактических затрат по категориям
    const factByCat = new Map<string, number>();
    objCosts.forEach((c) => factByCat.set(c.category, (factByCat.get(c.category) ?? 0) + c.amount));
    const articles = eLines.map((l) => {
      const planShare = total ? l.amount / total : 0;
      const fact = factByCat.get(l.item) ?? 0;
      const planToDate = l.amount * (volumePct / 100); // план, приведённый к выполненному объёму
      const dev = planToDate ? ((fact - planToDate) / planToDate) * 100 : (fact ? 100 : 0);
      return {
        id: l.id, section: l.section, item: l.item, unit: l.unit,
        qty: l.qty, price: l.price,
        amount: r0(l.amount), sharePct: r1(planShare * 100),
        planToDate: r0(planToDate), fact: r0(fact),
        deviation: r0(fact - planToDate), deviationPct: r1(dev),
      };
    }).sort((a, b) => b.deviation - a.deviation);
    const culprit = articles.filter((a) => a.deviation > 0)[0] ?? null;

    // Календарный план
    const objPlans = plans.filter((p) => p.estimateId === e.id || (!p.estimateId && p.objectId === e.objectId))
      .sort((a, b) => a.month.localeCompare(b.month));
    const months = objPlans.map((p) => {
      const mReports = objReports.filter((r) => monthOf(r.date) === p.month);
      const fMeters = sum(mReports, (r) => r.meters);
      const fCost = sum(objCosts.filter((c) => c.month === p.month), (c) => c.amount);
      return {
        month: p.month, workType: p.workType,
        planMeters: r0(p.planMeters), factMeters: r0(fMeters),
        deltaMeters: r0(fMeters - p.planMeters),
        donePct: p.planMeters ? r1((fMeters / p.planMeters) * 100) : 0,
        planCost: r0(p.planCost), factCost: r0(fCost),
        past: p.month < curMonth, current: p.month === curMonth,
      };
    });

    // Отставание в метрах и днях (план нарастающим итогом на сегодня)
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    let planToDateMeters = 0;
    months.forEach((m) => {
      if (m.past) planToDateMeters += m.planMeters;
      else if (m.current) planToDateMeters += (m.planMeters * dayOfMonth) / daysInMonth;
    });
    const lagMeters = planToDateMeters - factMeters;
    const curPlanMeters = months.find((m) => m.current)?.planMeters ?? 0;
    const dailyPlan = curPlanMeters ? curPlanMeters / daysInMonth
      : (planToDateMeters ? planToDateMeters / Math.max(1, months.filter((m) => m.past).length * 30 + dayOfMonth) : 0);
    const lagDays = dailyPlan > 0 ? r1(lagMeters / dailyPlan) : 0;

    // Прогноз итоговой себестоимости и финансового результата
    const remaining = Math.max(0, planMeters - factMeters);
    const forecastCost = factCost + remaining * (factCpm || planCpm);
    const forecastOver = total ? ((forecastCost - total) / total) * 100 : 0;
    const price = obj?.pricePerMeter ?? 0;
    const contractRevenue = planMeters * price;
    const forecastResult = contractRevenue - forecastCost;
    const planResult = contractRevenue - total;

    // Точка безубыточности: постоянные — накладные, переменные — прямые на метр
    const varPerMeter = planMeters ? direct / planMeters : 0;
    const marginPerMeter = price - varPerMeter;
    const breakEvenMeters = marginPerMeter > 0 ? overhead / marginPerMeter : 0;
    const breakEvenPct = planMeters ? (breakEvenMeters / planMeters) * 100 : 0;

    // Стоимость часа простоя: накладные в час + упущенная маржа за час бурения
    const drillHours = sum(objReports, (r) => r.drillHours) || 1;
    const totalHours = sum(objReports, (r) => r.drillHours + r.pzrHours + r.downtimeHours) || 1;
    const metersPerHour = factMeters / drillHours;
    const overheadPerHour = totalHours ? (overhead * (volumePct / 100)) / totalHours : 0;
    const idleHourCost = overheadPerHour + metersPerHour * Math.max(0, marginPerMeter);
    const downtimeHours = sum(objReports, (r) => r.downtimeHours);
    const idleLoss = idleHourCost * downtimeHours;

    // Расценки по интервалам глубин
    const objRates = rates.filter((r) => r.estimateId === e.id).sort((a, b) => a.fromDepth - b.fromDepth);
    const avgRate = objRates.length ? sum(objRates, (r) => r.pricePerMeter) / objRates.length : price;

    const objStages = stages.filter((s) => s.estimateId === e.id || (!s.estimateId && s.objectId === e.objectId))
      .map((s) => {
        const planEnd = s.planEnd ? new Date(s.planEnd) : null;
        const overdue = !!planEnd && !s.factEnd && planEnd < now;
        const delayDays = planEnd
          ? Math.round(((s.factEnd ? new Date(s.factEnd).getTime() : now.getTime()) - planEnd.getTime()) / 86400000)
          : 0;
        return {
          ...s,
          status: overdue ? "просрочен" : s.status,
          delayDays: s.factEnd || overdue ? delayDays : 0,
        };
      });

    /* --------- Предупреждения --------- */
    if (gapPP > budgetAheadPP)
      flags.push({
        level: gapPP > budgetAheadPP * 2 ? "критично" : "внимание", object: objName,
        title: "Смета осваивается быстрее объёма",
        value: `освоено ${r1(spendPct)}% сметы при выполнении ${r1(volumePct)}% объёма (разрыв ${r1(gapPP)} п. п.)`,
        advice: "Проверить статьи с перерасходом, согласовать с заказчиком дополнительное финансирование или сократить затраты.",
      });
    if (cpmDeviation > cpmOverPct)
      flags.push({
        level: cpmDeviation > cpmOverPct * 2 ? "критично" : "внимание", object: objName,
        title: "Фактическая себестоимость метра выше сметной",
        value: `${fmtMoney(factCpm)}/м против ${fmtMoney(planCpm)}/м (+${r1(cpmDeviation)}%)`,
        advice: culprit
          ? `Основной вклад — статья «${culprit.item}»: перерасход ${fmtMoney(culprit.deviation)}. Разобрать причину.`
          : "Разобрать структуру затрат по статьям сметы.",
      });
    if (lagDays > lagDaysLimit)
      flags.push({
        level: lagDays > lagDaysLimit * 2 ? "критично" : "внимание", object: objName,
        title: "Отставание от календарного плана",
        value: `${fmtNum(Math.abs(lagMeters))} м, это ${fmtNum(lagDays, 1)} дн. работы`,
        advice: "Пересчитать сменные задания, при необходимости вывести дополнительный станок или согласовать перенос сроков.",
      });
    if (forecastOver > forecastOverPct)
      flags.push({
        level: forecastOver > forecastOverPct * 3 ? "критично" : "внимание", object: objName,
        title: "Прогноз выхода за смету",
        value: `прогноз ${fmtMoney(forecastCost)} против сметы ${fmtMoney(total)} (+${r1(forecastOver)}%)`,
        advice: "Подготовить обоснование дополнительных работ или план снижения затрат до конца договора.",
      });
    if (forecastResult < 0)
      flags.push({
        level: "критично", object: objName,
        title: "Прогнозируется убыток по договору",
        value: `${fmtMoney(forecastResult)} при выручке ${fmtMoney(contractRevenue)}`,
        advice: "Пересмотреть цену метра с заказчиком либо сократить прямые затраты и простои.",
      });
    if (breakEvenPct > 85 && breakEvenMeters > 0)
      flags.push({
        level: "внимание", object: objName,
        title: "Точка безубыточности близка к объёму договора",
        value: `безубыточность при ${fmtNum(breakEvenMeters)} м из ${fmtNum(planMeters)} м (${r1(breakEvenPct)}%)`,
        advice: "Запас прочности мал: любое снижение объёма выводит договор в убыток.",
      });
    objStages.filter((s) => s.status === "просрочен").forEach((s) =>
      flags.push({
        level: "внимание", object: objName, title: `Этап «${s.stage}» просрочен`,
        value: `план до ${s.planEnd}, задержка ${s.delayDays} дн.`,
        advice: "Уточнить сроки с начальником участка и уведомить заказчика письмом.",
      }));

    return {
      id: e.id, objectId: e.objectId, object: objName, contract: e.contract,
      version: e.version, validFrom: e.validFrom, note: e.note,
      planMeters: r0(planMeters), direct: r0(direct), overhead: r0(overhead), total: r0(total),
      planCostPerMeter: r0(planCpm), factCostPerMeter: r0(factCpm),
      cpmDeviationPct: r1(cpmDeviation),
      factMeters: r0(factMeters), factCost: r0(factCost),
      spendPct: r1(spendPct), volumePct: r1(volumePct), gapPP: r1(gapPP),
      articles, culprit,
      months, planToDateMeters: r0(planToDateMeters),
      lagMeters: r0(lagMeters), lagDays,
      forecastCost: r0(forecastCost), forecastOverPct: r1(forecastOver),
      contractRevenue: r0(contractRevenue), forecastResult: r0(forecastResult), planResult: r0(planResult),
      breakEvenMeters: r0(breakEvenMeters), breakEvenPct: r1(breakEvenPct),
      idleHourCost: r0(idleHourCost), downtimeHours: r1(downtimeHours), idleLoss: r0(idleLoss),
      rates: objRates, avgRate: r0(avgRate),
      stages: objStages,
      pricePerMeter: r0(obj?.pricePerMeter ?? 0),
    };
  });

  const versions = ests.map((e) => ({
    id: e.id, objectId: e.objectId,
    object: objects.find((o) => o.id === e.objectId)?.name ?? "—",
    contract: e.contract, version: e.version, validFrom: e.validFrom, validTo: e.validTo,
    active: !!e.active, note: e.note,
    total: r0(sum(lines.filter((l) => l.estimateId === e.id), (l) => l.amount)),
    planMeters: r0(e.planMeters),
  })).sort((a, b) => a.object.localeCompare(b.object) || b.version - a.version);

  const totals = {
    estimateTotal: r0(sum(byEstimate, (e) => e.total)),
    factCost: r0(sum(byEstimate, (e) => e.factCost)),
    forecastCost: r0(sum(byEstimate, (e) => e.forecastCost)),
    contractRevenue: r0(sum(byEstimate, (e) => e.contractRevenue)),
    forecastResult: r0(sum(byEstimate, (e) => e.forecastResult)),
    planResult: r0(sum(byEstimate, (e) => e.planResult)),
    idleLoss: r0(sum(byEstimate, (e) => e.idleLoss)),
  };

  const charts = {
    spendVsVolume: byEstimate.map((e) => ({
      name: e.object.replace("Участок ", ""),
      "освоение сметы": e.spendPct, "выполнение объёма": e.volumePct,
    })),
    cpmPlanFact: byEstimate.map((e) => ({
      name: e.object.replace("Участок ", ""),
      смета: e.planCostPerMeter, факт: e.factCostPerMeter,
    })),
    calendar: byEstimate.flatMap((e) => e.months.map((m) => ({
      name: `${e.object.replace("Участок ", "")} ${m.month}`,
      план: m.planMeters, факт: m.factMeters,
    }))),
    articleDeviation: byEstimate.flatMap((e) => e.articles.slice(0, 5).map((a) => ({
      name: a.item, отклонение: a.deviation,
    }))),
  };

  return { generatedAt: nowIso, byEstimate, versions, totals, charts, flags };
}
