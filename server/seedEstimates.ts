import { storage } from "./storage";
import { COST_CATEGORIES, CONTRACT_STAGES } from "@shared/schema";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

/** Демонстрационные сметы, расценки по глубинам и календарные планы */
export function seedEstimates(force = false) {
  if (storage.estimates().length > 0 && !force) return;
  const objects = storage.objects();
  if (!objects.length) return;

  const today = new Date();
  const shares: Record<string, number> = {
    "ГСМ": 0.22, "Зарплата": 0.31, "Буровой инструмент": 0.14, "Транспорт": 0.09,
    "Содержание лагеря": 0.07, "Ремонты": 0.06, "Прочее/накладные": 0.11,
  };

  objects.forEach((o, oi) => {
    const planMeters = o.contractVolume || 12000;
    const total = planMeters * (o.plannedCostPerMeter || 7000);

    // Версия 1 — первоначальная смета (архивная)
    const v1 = storage.createEstimate({
      objectId: o.id, contract: `Договор №${120 + oi}/2026 — ${o.customer}`, version: 1,
      validFrom: iso(addDays(today, -210)), validTo: iso(addDays(today, -95)),
      planMeters, active: 0, note: "Первоначальная смета к договору",
      createdAt: new Date().toISOString(),
    });
    COST_CATEGORIES.forEach((cat) => {
      const amount = Math.round(total * 0.94 * (shares[cat] ?? 0.1));
      storage.createEstimateLine({
        estimateId: v1.id,
        section: cat === "Прочее/накладные" || cat === "Содержание лагеря" ? "накладные" : "прямые",
        item: cat, workType: "бурение", unit: "руб.",
        qty: planMeters, price: Math.round(amount / planMeters), amount,
      });
    });

    // Версия 2 — действующая (после дополнительного соглашения)
    const v2 = storage.createEstimate({
      objectId: o.id, contract: `Договор №${120 + oi}/2026 — ${o.customer}`, version: 2,
      validFrom: iso(addDays(today, -94)), validTo: o.contractEnd,
      planMeters, active: 1, note: "Действующая редакция (доп. соглашение №1)",
      createdAt: new Date().toISOString(),
    });
    COST_CATEGORIES.forEach((cat) => {
      const amount = Math.round(total * (shares[cat] ?? 0.1));
      storage.createEstimateLine({
        estimateId: v2.id,
        section: cat === "Прочее/накладные" || cat === "Содержание лагеря" ? "накладные" : "прямые",
        item: cat, workType: "бурение", unit: "руб.",
        qty: planMeters, price: Math.round(amount / planMeters), amount,
      });
    });

    // Расценки по интервалам глубин
    const base = o.pricePerMeter || 9500;
    [[0, 100, 1], [100, 250, 1.12], [250, 400, 1.28], [400, 600, 1.45]].forEach(([f, t, k]) => {
      storage.createDepthRate({
        estimateId: v2.id, drillType: "колонковое", diameter: "HQ",
        fromDepth: f as number, toDepth: t as number,
        pricePerMeter: Math.round(base * (k as number)),
      });
    });

    // Календарный план по месяцам
    const start = new Date(today.getFullYear(), today.getMonth() - 4, 1);
    const monthly = planMeters / 10;
    for (let i = 0; i < 8; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const k = i < 2 ? 0.8 : i < 5 ? 1.1 : 1.05;
      const pm = Math.round(monthly * k);
      storage.createCalendarPlan({
        objectId: o.id, estimateId: v2.id, month,
        planMeters: pm, planCost: Math.round(pm * (o.plannedCostPerMeter || 7000)),
        workType: "колонковое бурение", note: "",
      });
    }

    // Этапы договора
    const stageDays = [-200, -180, 150, 175, 190];
    CONTRACT_STAGES.forEach((stage, i) => {
      const ps = addDays(today, stageDays[i] - 10);
      const pe = addDays(today, stageDays[i]);
      const done = stageDays[i] < 0;
      storage.createCalendarStage({
        objectId: o.id, estimateId: v2.id, stage,
        planStart: iso(ps), planEnd: iso(pe),
        factStart: done ? iso(addDays(ps, oi)) : "",
        factEnd: done ? iso(addDays(pe, oi === 1 ? 12 : 1)) : "",
        status: done ? "выполнен" : i === 2 ? "в работе" : "план",
      });
    });
  });
}
