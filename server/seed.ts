import { eq } from "drizzle-orm";
import {
  objects, rigs, brigades, reports, costs, fuel, inventory, employees, shifts,
  equipment, costItems, inventoryItems, DOWNTIME_REASONS, COST_CATEGORIES,
  labs, analysisTypes, samples, sampleMoves, labBatches, assays, SAMPLE_STAGES,
  coreLogs, coreCuts, CUT_REJECT_REASONS,
} from "@shared/schema";

/** План скважин по станкам (станок бурит одну скважину около 30 дней) */
const HOLE_PLAN: string[][] = [
  ["СКВ-102", "СКВ-101"],
  ["СКВ-103", "СКВ-104"],
  ["СКВ-210", "СКВ-211"],
  ["СКВ-212"],
  ["СКВ-305", "СКВ-306"],
];

// Детерминированный генератор — данные одинаковы при каждом пересоздании базы
let seedState = 20260812;
function rnd() {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
}
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

export function seedDatabase(db: any, force = false) {
  const existing = db.select().from(objects).all();
  if (existing.length > 0 && !force) return;
  seedState = 20260812;

  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const objDefs = [
    {
      name: "Участок «Северный»", customer: 'АО «Полюс Разведка»', region: "Красноярский край",
      planMetersMonth: 0, contractVolume: 0, contractEnd: iso(addDays(today, 190)),
      pricePerMeter: 9800, plannedCostPerMeter: 7400, staffRequired: 24,
    },
    {
      name: "Участок «Восточный»", customer: 'ООО «Тайга Голд»', region: "Республика Саха (Якутия)",
      planMetersMonth: 0, contractVolume: 0, contractEnd: iso(addDays(today, 145)),
      pricePerMeter: 11200, plannedCostPerMeter: 8600, staffRequired: 10,
    },
    {
      name: "Участок «Озёрный»", customer: 'ПАО «Уралмедь»', region: "Челябинская область",
      planMetersMonth: 0, contractVolume: 0, contractEnd: iso(addDays(today, 96)),
      pricePerMeter: 8600, plannedCostPerMeter: 6900, staffRequired: 8,
    },
  ];
  const objIds: number[] = objDefs.map((o) => db.insert(objects).values(o).returning().get().id);

  const rigDefs = [
    { name: "УБ-01", model: "Boart Longyear LF-90", objectId: objIds[0], status: "в работе" },
    { name: "УБ-02", model: "Atlas Copco CS14", objectId: objIds[0], status: "в работе" },
    { name: "УБ-03", model: "УКБ-500", objectId: objIds[1], status: "в работе" },
    { name: "УБ-04", model: "Sandvik DE710", objectId: objIds[1], status: "ремонт" },
    { name: "УБ-05", model: "ЗИФ-650М", objectId: objIds[2], status: "в работе" },
  ];
  const rigIds: number[] = rigDefs.map((r) => db.insert(rigs).values(r).returning().get().id);

  const brDefs = [
    { name: "Бригада №1", objectId: objIds[0], staffPlan: 12 },
    { name: "Бригада №2", objectId: objIds[0], staffPlan: 12 },
    { name: "Бригада №3", objectId: objIds[1], staffPlan: 10 },
    { name: "Бригада №4", objectId: objIds[2], staffPlan: 8 },
  ];
  const brIds: number[] = brDefs.map((b) => db.insert(brigades).values(b).returning().get().id);
  const brigadeForObject: Record<number, number[]> = {
    [objIds[0]]: [brIds[0], brIds[1]],
    [objIds[1]]: [brIds[2]],
    [objIds[2]]: [brIds[3]],
  };

  // --- Сменные рапорты за 60 дней ---
  const insertReport = db.insert(reports);
  const reportRows: any[] = [];
  for (let d = 59; d >= 0; d--) {
    const date = iso(addDays(today, -d));
    rigDefs.forEach((rig, ri) => {
      const rigId = rigIds[ri];
      const objId = rig.objectId;
      for (const shiftName of ["день", "ночь"] as const) {
        // Базовая производительность по станку
        const base = [22, 19, 17, 20, 14][ri];
        let downtime = 0;
        let reason = "нет";
        const roll = rnd();
        // на «Восточном» проблем больше
        const troubleFactor = objId === objIds[1] ? 0.45 : 0.28;
        if (roll < troubleFactor) {
          downtime = Math.round((1 + rnd() * 6) * 2) / 2;
          reason = pick(DOWNTIME_REASONS);
        }
        const pzr = Math.round((1 + rnd() * 1.5) * 2) / 2;
        const drill = Math.max(0, Math.round((12 - downtime - pzr) * 2) / 2);
        const meters = Math.round(Math.max(0, (drill / 10) * base * (0.75 + rnd() * 0.5)) * 10) / 10;
        const plan = HOLE_PLAN[ri];
        const holeName = plan[Math.min(Math.floor((59 - d) / 30), plan.length - 1)];
        reportRows.push({
          date, objectId: objId, rigId, brigadeId: pick(brigadeForObject[objId]),
          shift: shiftName, meters, drillHours: drill, pzrHours: pzr,
          downtimeHours: downtime, downtimeReason: reason, comment: "", holeName,
        });
      }
    });
  }
  for (const r of reportRows) db.insert(reports).values(r).run();

  // --- План, договоры и затраты выводим из фактической выработки, чтобы цифры были согласованы ---
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysElapsed = today.getDate();
  const total60 = objIds.map((oid) =>
    reportRows.filter((r) => r.objectId === oid).reduce((s, r) => s + r.meters, 0));
  const monthly = total60.map((v) => v / 2); // 60 дней ≈ 2 месяца

  // Северный — небольшое отставание, Восточный — заметное, Озёрный — идёт с опережением
  const planFactor = [1.06, 1.22, 0.95];
  const contractFactor = [0.88, 1.35, 0.97]; // <1 — успеваем к сроку, >1 — риск срыва
  const daysToEnd = [190, 145, 96];
  objIds.forEach((oid, i) => {
    const plan = Math.round((monthly[i] * planFactor[i]) / 10) * 10;
    const volume = Math.round(
      (total60[i] + (monthly[i] / 30) * daysToEnd[i] * contractFactor[i]) / 100) * 100;
    db.update(objects).set({ planMetersMonth: plan, contractVolume: volume })
      .where(eq(objects.id, oid)).run();
  });

  const monthKey = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
  const months = [monthKey(addDays(today, -60)), monthKey(addDays(today, -30)), monthKey(today)]
    .filter((v, i, a) => a.indexOf(v) === i);
  const costShares: Record<string, number> = {
    "ГСМ": 0.26, "Зарплата": 0.34, "Буровой инструмент": 0.11, "Транспорт": 0.09,
    "Содержание лагеря": 0.07, "Ремонты": 0.08, "Прочее/накладные": 0.05,
  };
  // Северный — в смете, Восточный — перерасход, Озёрный — экономия
  const costOverrun = [1.03, 1.17, 0.95];
  months.forEach((m) => {
    objIds.forEach((oid, oi) => {
      // затраты месяца считаем от фактически пройденных метров того же месяца
      const metersInMonth = reportRows
        .filter((r) => r.objectId === oid && r.date.slice(0, 7) === m)
        .reduce((s, r) => s + r.meters, 0);
      if (metersInMonth <= 0) return;
      const monthCost = metersInMonth * objDefs[oi].plannedCostPerMeter * costOverrun[oi];
      COST_CATEGORIES.forEach((cat) => {
        const amount = Math.round((monthCost * costShares[cat] * (0.94 + rnd() * 0.12)) / 1000) * 1000;
        db.insert(costs).values({ objectId: oid, month: m, category: cat, amount }).run();
      });
    });
  });

  // --- ГСМ ---
  const units = [
    { name: "Станок УБ-01", obj: 0, norm: 210 }, { name: "Станок УБ-02", obj: 0, norm: 195 },
    { name: "КамАЗ 43118 (в/т)", obj: 0, norm: 130 }, { name: "Станок УБ-03", obj: 1, norm: 205 },
    { name: "Станок УБ-04", obj: 1, norm: 220 }, { name: "ДЭС-100 (лагерь)", obj: 1, norm: 240 },
    { name: "Станок УБ-05", obj: 2, norm: 180 }, { name: "Урал-4320 (вездеход)", obj: 2, norm: 145 },
  ];
  // Справочник техники для ГСМ
  for (const u of units) {
    db.insert(equipment).values({
      name: u.name,
      kind: u.name.includes("Станок") ? "станок" : u.name.includes("ДЭС") ? "ДЭС" : "автотранспорт",
      objectId: objIds[u.obj], normLiters: u.norm,
    }).run();
  }
  // Камнерезные станки для распиловки керна
  const sawIds: number[] = [
    { name: "Камнерез КС-400 (кернохранилище)", obj: 0 },
    { name: "Камнерез Almig CS-2 (лагерь)", obj: 1 },
    { name: "Камнерез КС-250", obj: 2 },
  ].map((s) =>
    db.insert(equipment).values({
      name: s.name, kind: "Камнерезный станок", objectId: objIds[s.obj], normLiters: 0,
    }).returning().get().id);

  // Справочник статей затрат
  for (const c of COST_CATEGORIES) db.insert(costItems).values({ name: c }).run();

  for (let d = 44; d >= 0; d--) {
    const date = iso(addDays(today, -d));
    for (const u of units) {
      const over = u.name.includes("ДЭС") || u.name.includes("УБ-04") ? 0.12 : 0;
      const fact = Math.round(u.norm * (0.93 + rnd() * 0.2 + over));
      db.insert(fuel).values({
        date, objectId: objIds[u.obj], unitName: u.name, normLiters: u.norm, factLiters: fact,
      }).run();
    }
  }

  // --- ТМЦ ---
  const invDefs = [
    { obj: 0, itemName: "Дизельное топливо", qty: 18400, unit: "л", minQty: 8000, dailyUse: 540, del: iso(addDays(today, 9)) },
    { obj: 0, itemName: "Буровые трубы HQ", qty: 132, unit: "шт", minQty: 60, dailyUse: 1.2, del: iso(addDays(today, 21)) },
    { obj: 0, itemName: "Коронки алмазные NQ", qty: 14, unit: "шт", minQty: 20, dailyUse: 0.6, del: iso(addDays(today, 12)) },
    { obj: 1, itemName: "Дизельное топливо", qty: 7100, unit: "л", minQty: 9000, dailyUse: 660, del: iso(addDays(today, 4)) },
    { obj: 1, itemName: "Масло моторное 15W-40", qty: 640, unit: "л", minQty: 300, dailyUse: 11, del: "" },
    { obj: 1, itemName: "Запчасти к насосу НБ-32", qty: 6, unit: "компл", minQty: 4, dailyUse: 0.08, del: iso(addDays(today, 17)) },
    { obj: 2, itemName: "Дизельное топливо", qty: 11200, unit: "л", minQty: 5000, dailyUse: 330, del: iso(addDays(today, 14)) },
    { obj: 2, itemName: "Коронки твердосплавные", qty: 41, unit: "шт", minQty: 15, dailyUse: 0.5, del: "" },
    { obj: 2, itemName: "Буровые трубы NQ", qty: 58, unit: "шт", minQty: 40, dailyUse: 0.9, del: iso(addDays(today, 26)) },
  ];
  // Справочник позиций ТМЦ
  const invNames = new Map<string, { unit: string; minQty: number }>();
  for (const i of invDefs) if (!invNames.has(i.itemName)) invNames.set(i.itemName, { unit: i.unit, minQty: i.minQty });
  for (const [name, v] of invNames)
    db.insert(inventoryItems).values({ name, unit: v.unit, minQty: v.minQty }).run();

  for (const i of invDefs) {
    db.insert(inventory).values({
      objectId: objIds[i.obj], itemName: i.itemName, qty: i.qty, unit: i.unit,
      minQty: i.minQty, dailyUse: i.dailyUse, expectedDelivery: i.del,
    }).run();
  }

  // --- Сотрудники ---
  const surnames = ["Ковалёв", "Ерофеев", "Шамсутдинов", "Гриценко", "Прохоров", "Ким", "Литвинов",
    "Бабаев", "Селиванов", "Дорохов", "Ушаков", "Заикин", "Мамедов", "Худяков", "Тарасенко",
    "Никулин", "Бортников", "Савельев", "Ярцев", "Обухов", "Кравчук", "Демьянов", "Пахомов",
    "Ситников", "Юрченко", "Верещагин", "Лапшин", "Токарев", "Черемных", "Загидуллин",
    "Астафьев", "Мещеряков", "Панкратов", "Ремизов", "Сомов", "Хабибуллин"];
  const initials = ["А. В.", "С. П.", "И. Н.", "Д. М.", "Е. А.", "Р. Т.", "К. С.", "О. Ю."];
  const brigadeStaff: { pos: string; n: number }[] = [
    { pos: "Мастер участка", n: 1 }, { pos: "Бурильщик", n: 2 }, { pos: "Помощник бурильщика", n: 3 },
    { pos: "Геолог", n: 1 }, { pos: "Механик", n: 1 }, { pos: "Водитель", n: 1 }, { pos: "Повар", n: 1 },
  ];
  let si = 0;
  const employeeRows: { id: number; objectId: number }[] = [];
  brDefs.forEach((br, bi) => {
    const brigadeId = brIds[bi];
    // немного недобора в бригаде №3 и №4
    const shortfall = bi >= 2 ? 1 : 0;
    let created = 0;
    for (const g of brigadeStaff) {
      for (let k = 0; k < g.n; k++) {
        if (created >= br.staffPlan - shortfall) break;
        const fio = `${surnames[si % surnames.length]} ${initials[si % initials.length]}`;
        si++;
        const row = db.insert(employees).values({
          fio, position: g.pos, objectId: br.objectId, brigadeId,
          phone: `+7 9${String(10 + (si % 89))} ${String(100 + (si * 7) % 900)}-${String(10 + si % 90)}-${String(10 + (si * 3) % 90)}`,
        }).returning().get();
        employeeRows.push({ id: row.id, objectId: br.objectId });
        created++;
      }
    }
  });

  // --- Геологи-документаторы (описание керна) ---
  const loggerDefs = [
    { fio: "Антипина М. В.", obj: 0, brigade: brIds[0] },
    { fio: "Шевцов Г. А.", obj: 0, brigade: brIds[1] },
    { fio: "Рахимова Э. Р.", obj: 1, brigade: brIds[2] },
    { fio: "Степанцов Н. И.", obj: 2, brigade: brIds[3] },
  ];
  const loggerIds: number[] = loggerDefs.map((l, i) => {
    const row = db.insert(employees).values({
      fio: l.fio, position: "Геолог-документатор", objectId: objIds[l.obj], brigadeId: l.brigade,
      phone: `+7 923 4${String(10 + i)}-${String(20 + i * 3)}-${String(31 + i)}`,
    }).returning().get();
    employeeRows.push({ id: row.id, objectId: objIds[l.obj] });
    return row.id;
  });

  // --- Вахты ---
  employeeRows.forEach((e, idx) => {
    const cycle = idx % 5 === 0 ? "60/30" : "30/30";
    const onDays = cycle === "60/30" ? 60 : 30;
    // текущая вахта: старт со сдвигом, чтобы часть заканчивалась скоро
    const offset = -(idx % onDays);
    const start = addDays(today, offset - (idx % 3));
    const end = addDays(start, onDays - 1);
    const daysLeft = Math.round((end.getTime() - today.getTime()) / 86400000);
    db.insert(shifts).values({
      employeeId: e.id, objectId: e.objectId, startDate: iso(start), endDate: iso(end),
      cycleType: cycle, replacementAssigned: daysLeft <= 5 && idx % 3 === 0 ? 0 : (rnd() > 0.35 ? 1 : 0),
    }).run();
    // прошлая вахта
    const pStart = addDays(start, -(onDays + 30));
    db.insert(shifts).values({
      employeeId: e.id, objectId: e.objectId, startDate: iso(pStart),
      endDate: iso(addDays(pStart, onDays - 1)), cycleType: cycle, replacementAssigned: 1,
    }).run();
  });

  const holeCut = seedCoreWork(db, today, objIds, reportRows, loggerIds, sawIds);
  seedSamplePrep(db, today, objIds, rigIds, rigDefs, holeCut);
}

/* ========== Демо-данные: описание и распиловка керна ========== */

const LITHOLOGY = [
  "Алевролит тёмно-серый, трещиноватый",
  "Песчаник мелкозернистый с прожилками кварца",
  "Метасоматит кварц-серицитовый, сульфидизация 2–5 %",
  "Дайка диоритовых порфиритов",
  "Сланец углеродистый, рассланцеванный",
  "Зона дробления, лимонитизация по трещинам",
];

/**
 * Сеет описание и распиловку керна от фактической проходки по скважинам.
 * По СКВ-101 заложено критическое отставание описания (~60 %) с растущим трендом.
 * Возвращает карту «скважина → распилено метров».
 */
function seedCoreWork(
  db: any, today: Date, objIds: number[], reportRows: any[], loggerIds: number[], sawIds: number[],
): Record<string, number> {
  // скважина → объект и проходка по дням
  const holes = new Map<string, { objectId: number; days: Map<string, number> }>();
  for (const r of reportRows) {
    if (!r.holeName) continue;
    if (!holes.has(r.holeName)) holes.set(r.holeName, { objectId: r.objectId, days: new Map() });
    const h = holes.get(r.holeName)!;
    h.days.set(r.date, (h.days.get(r.date) ?? 0) + r.meters);
  }

  const loggerForObject: Record<number, number[]> = {
    [objIds[0]]: [loggerIds[0], loggerIds[1]],
    [objIds[1]]: [loggerIds[2]],
    [objIds[2]]: [loggerIds[3]],
  };
  const sawForObject: Record<number, number> = {
    [objIds[0]]: sawIds[0], [objIds[1]]: sawIds[1], [objIds[2]]: sawIds[2],
  };
  const workers = ["Савельев П. К.", "Габдуллин Р. Ш.", "Николаев А. А."];
  const holeCut: Record<string, number> = {};

  for (const [hole, info] of holes) {
    const dates = Array.from(info.days.keys()).sort();
    const logger = loggerForObject[info.objectId] ?? [0];
    // Геолог закреплён за скважиной; у двух геологов «Северного» разная выработка
    const geologistId = logger[hole.charCodeAt(hole.length - 1) % logger.length];
    const lowRecovery = hole === "СКВ-211"; // выход керна ниже нормы
    const critical = hole === "СКВ-101"; // критическое отставание описания

    let drilled = 0;
    let described = 0;
    let cut = 0;
    dates.forEach((date, di) => {
      drilled += info.days.get(date) ?? 0;
      const p = dates.length > 1 ? di / (dates.length - 1) : 1;
      // доля описанного от пробуренного
      const share = critical ? 0.74 - 0.34 * p : 0.86 - 0.06 * p;
      const targetDesc = drilled * share;
      let add = Math.round((targetDesc - described) * 10) / 10;
      if (add >= 1) {
        const parts = add > 26 ? 2 : 1;
        for (let k = 0; k < parts; k++) {
          const len = Math.round((add / parts) * 10) / 10;
          const from = Math.round(described * 10) / 10;
          const to = Math.round((described + len) * 10) / 10;
          const recovery = lowRecovery
            ? Math.round((78 + rnd() * 12) * 10) / 10
            : Math.round((91 + rnd() * 8) * 10) / 10;
          const mineral = rnd() < 0.22 ? 1 : 0;
          db.insert(coreLogs).values({
            date, objectId: info.objectId, holeName: hole, fromDepth: from, toDepth: to,
            geologistId, recoveryPct: recovery,
            lithology: LITHOLOGY[Math.floor(rnd() * LITHOLOGY.length)],
            mineralization: mineral,
            mineralizationNote: mineral ? "Вкрапленность пирита, кварцевые прожилки" : "",
            photo: rnd() < 0.82 ? 1 : 0,
            status: rnd() < 0.06 ? "требует уточнения" : "описано",
            importId: 0,
          }).run();
          described = to;
        }
      }

      // распиловка идёт следом за описанием и отстаёт ещё немного
      const targetCut = described * 0.87;
      const addCut = Math.round((targetCut - cut) * 10) / 10;
      if (addCut >= 1) {
        const from = Math.round(cut * 10) / 10;
        const to = Math.round((cut + addCut) * 10) / 10;
        const rejShare = info.objectId === objIds[1] ? 0.045 : 0.018;
        const reject = rnd() < 0.35 ? Math.round(addCut * rejShare * (0.5 + rnd()) * 10) / 10 : 0;
        db.insert(coreCuts).values({
          date, objectId: info.objectId, holeName: hole, fromDepth: from, toDepth: to,
          worker: workers[di % workers.length], shift: di % 3 === 0 ? "ночь" : "день",
          cutType: rnd() < 0.85 ? "продольная" : "поперечная",
          equipmentId: sawForObject[info.objectId] ?? 0,
          rejectMeters: reject,
          rejectReason: reject ? CUT_REJECT_REASONS[Math.floor(rnd() * CUT_REJECT_REASONS.length)] : "",
          status: rnd() < 0.05 ? "требует повтора" : "распилено",
          importId: 0,
        }).run();
        cut = to;
      }
    });
    holeCut[hole] = cut;
  }
  return holeCut;
}

/* ==================== Демо-данные раздела «Пробоподготовка» ==================== */

function seedSamplePrep(
  db: any, today: Date, objIds: number[], rigIds: number[],
  rigDefs: { name: string; objectId: number }[], holeCut: Record<string, number> = {},
) {
  const labDefs = [
    { name: 'АО «СЖС Восток Лимитед»', city: "Чита", leadDays: 14, pricePerSample: 1450,
      analyses: "Пробирный на золото; ICP-MS" },
    { name: 'ООО «Стьюарт Геокемикл энд Эссей»', city: "Красноярск", leadDays: 21, pricePerSample: 1180,
      analyses: "Пробирный на золото; Спектральный" },
    { name: 'Центральная лаборатория АО «Иргиредмет»', city: "Иркутск", leadDays: 18, pricePerSample: 1320,
      analyses: "Пробирный на золото; Атомно-абсорбционный" },
  ];
  const labIds: number[] = labDefs.map((l) => db.insert(labs).values(l).returning().get().id);

  const atDefs = [
    { name: "Пробирный на золото", elements: "Au", unit: "г/т" },
    { name: "ICP-MS (многоэлементный)", elements: "Au, Ag, Cu, Pb, Zn", unit: "г/т" },
    { name: "Спектральный полуколичественный", elements: "Cu, Pb, Zn", unit: "%" },
    { name: "Атомно-абсорбционный", elements: "Au, Ag", unit: "г/т" },
  ];
  const atIds: number[] = atDefs.map((a) => db.insert(analysisTypes).values(a).returning().get().id);

  const geologists = (db.select().from(employees).all() as any[]).filter((e) => e.position === "Геолог");
  const yr = String(today.getFullYear()).slice(2);
  const prefixes = ["СЕВ", "ВОС", "ОЗЕ"];
  const holeSets = [
    ["СКВ-101", "СКВ-102", "СКВ-103", "СКВ-104"],
    ["СКВ-210", "СКВ-211", "СКВ-212"],
    ["СКВ-305", "СКВ-306"],
  ];
  const perObject = [78, 60, 42]; // 180 проб

  // Партии отправки в лабораторию
  const batchDefs = [
    { code: "П-2601", labIdx: 0, atIdx: 0, sentAge: 50, status: "получена", resultAge: 34, waybill: "ТТН 774512", ship: "транспортная компания" },
    { code: "П-2602", labIdx: 1, atIdx: 1, sentAge: 42, status: "получена", resultAge: 20, waybill: "ТТН 774598", ship: "авиа" },
    { code: "П-2603", labIdx: 0, atIdx: 0, sentAge: 24, status: "в лаборатории", resultAge: 0, waybill: "ТТН 774631", ship: "транспортная компания" },
    { code: "П-2604", labIdx: 2, atIdx: 3, sentAge: 8, status: "в лаборатории", resultAge: 0, waybill: "ТТН 774702", ship: "автотранспорт компании" },
  ];
  const batchIds: number[] = batchDefs.map((b) => {
    const sent = addDays(today, -b.sentAge);
    const due = addDays(sent, labDefs[b.labIdx].leadDays);
    return db.insert(labBatches).values({
      code: b.code, labId: labIds[b.labIdx], analysisTypeId: atIds[b.atIdx],
      sentDate: iso(sent), dueDate: iso(due), shipMethod: b.ship, waybill: b.waybill,
      status: b.status, resultDate: b.resultAge ? iso(addDays(today, -b.resultAge)) : "",
      note: "",
    }).returning().get().id;
  });

  /** Этап и партия по возрасту пробы */
  const routeOf = (age: number) => {
    if (age >= 48) return { stage: "Результат получен", batch: 0, stageAge: 34 };
    if (age >= 40) return { stage: "Результат получен", batch: 1, stageAge: 20 };
    if (age >= 30) return { stage: "Отправлена в лабораторию", batch: 2, stageAge: 24 };
    if (age >= 21) return { stage: "Отправлена в лабораторию", batch: 3, stageAge: 8 };
    if (age >= 17) return { stage: "Упакована", batch: -1, stageAge: 13 };
    if (age >= 14) return { stage: "Измельчение", batch: -1, stageAge: 11 };
    if (age >= 11) return { stage: "Сокращение", batch: -1, stageAge: 9 };
    if (age >= 6) return { stage: "Дробление", batch: -1, stageAge: Math.min(age - 1, 9) };
    if (age >= 4) return { stage: "Сушка", batch: -1, stageAge: age - 2 };
    if (age >= 2) return { stage: "Принята в пробоподготовку", batch: -1, stageAge: age - 1 };
    return { stage: "Отобрана", batch: -1, stageAge: age };
  };

  type Made = { id: number; code: string; type: string; objIdx: number; hole: string; from: number; to: number; batch: number; stage: string; date: string };
  const made: Made[] = [];
  let rejected = 0;

  for (let oi = 0; oi < objIds.length; oi++) {
    const objId = objIds[oi];
    const objRigIds = rigIds.filter((_, i) => rigDefs[i].objectId === objId);
    const holes = holeSets[oi];
    const depths: Record<string, number> = {};
    let counter = 0;
    let prev: Made | null = null;

    for (let n = 0; n < perObject[oi]; n++) {
      const age = 59 - Math.floor((n / perObject[oi]) * 59);
      const date = iso(addDays(today, -age));
      const hole = holes[Math.floor(n / Math.ceil(perObject[oi] / holes.length))] ?? holes[holes.length - 1];
      const type =
        n % 20 === 19 ? "дубликат"
        : n % 33 === 32 ? "контрольная (стандарт)"
        : n % 45 === 44 ? "пустышка (бланк)"
        : oi === 2 && n % 9 === 4 ? "шламовая"
        : oi === 1 && n % 17 === 8 ? "бороздовая"
        : "керновая";

      let from: number, to: number;
      if (type === "дубликат" && prev) {
        from = prev.from; to = prev.to; // дубликат берётся с того же интервала
      } else {
        // опробование ведётся по распиленной части скважины, с рудной зоны
        const start = depths[hole] ?? Math.round((holeCut[hole] ?? 0) * 0.35 * 10) / 10;
        const len = 1 + Math.round(rnd() * 10) / 10; // 1.0–2.0 м
        from = Math.round(start * 10) / 10;
        to = Math.round((start + len) * 10) / 10;
        depths[hole] = to;
      }

      counter++;
      const code = `${prefixes[oi]}-${yr}-${String(counter).padStart(3, "0")}`;
      const route = routeOf(age);
      const isReject = (oi === 0 && n === 33) || (oi === 1 && n === 27);
      const stage = isReject ? "Архив/Брак" : route.stage;
      const stageDate = isReject ? iso(addDays(today, -Math.max(1, age - 3))) : iso(addDays(today, -route.stageAge));
      if (isReject) rejected++;

      const row = db.insert(samples).values({
        code, date, objectId: objId,
        rigId: objRigIds[n % objRigIds.length] ?? 0,
        holeName: hole, fromDepth: from, toDepth: to,
        sampleType: type, weightKg: Math.round((8 + rnd() * 8) * 10) / 10,
        geologistId: geologists[(oi + n) % (geologists.length || 1)]?.id ?? 0,
        stage, stageDate,
        status: isReject ? "брак" : "в работе",
        rejectReason: isReject ? (rejected === 1 ? "недостаточный вес" : "нарушение упаковки") : "",
        batchId: !isReject && route.batch >= 0 ? batchIds[route.batch] : 0,
        note: type === "контрольная (стандарт)" ? "СО «ОРЕАС 214», аттестованное значение 2,05 г/т" : "",
        importId: 0,
      }).returning().get();

      const m: Made = { id: row.id, code, type, objIdx: oi, hole, from, to, batch: isReject ? -1 : route.batch, stage, date };
      made.push(m);
      if (type !== "дубликат") prev = m;

      // Журнал движения по этапам
      const target = SAMPLE_STAGES.indexOf(stage as any);
      const steps = target < 0 ? 0 : target;
      const startAge = age;
      const endAge = isReject ? Math.max(1, age - 3) : route.stageAge;
      for (let s = 0; s <= steps; s++) {
        const d = steps === 0 ? startAge : Math.round(startAge - ((startAge - endAge) * s) / steps);
        db.insert(sampleMoves).values({
          sampleId: row.id,
          fromStage: s === 0 ? "" : SAMPLE_STAGES[s - 1],
          toStage: SAMPLE_STAGES[s],
          date: iso(addDays(today, -Math.max(0, d))),
          author: s === 0 ? "Геолог участка" : "Пробоподготовка",
          note: s === steps && isReject ? "Забракована" : "",
        }).run();
      }
    }
  }

  // ---- Результаты анализов по партиям №№ 1–2 ----
  const resultDates = [iso(addDays(today, -34)), iso(addDays(today, -20))];
  const byInterval = new Map<string, number>(); // исходное содержание для дубликатов
  let dupNo = 0;
  made.filter((m) => m.batch === 0 || m.batch === 1).forEach((m, idx) => {
    const key = `${m.objIdx}|${m.hole}|${m.from}`;
    const received = resultDates[m.batch];
    let au: number;
    if (m.type === "пустышка (бланк)") {
      au = Math.round(rnd() * 4) / 100; // фон
    } else if (m.type === "контрольная (стандарт)") {
      au = Math.round((2.05 + (rnd() - 0.5) * 0.14) * 100) / 100;
    } else if (m.type === "дубликат") {
      dupNo++;
      const base = byInterval.get(key) ?? 0.6;
      const dev = dupNo % 4 === 0 ? 0.34 : (rnd() - 0.5) * 0.18; // один из четырёх — расхождение выше нормы
      au = Math.round(base * (1 + dev) * 100) / 100;
    } else {
      const inOre = idx % 25 >= 5 && idx % 25 <= 9; // рудные интервалы по 5 проб
      au = inOre
        ? Math.round((1.4 + rnd() * 6.2) * 100) / 100
        : Math.round((0.02 + rnd() * 0.65) * 100) / 100;
      byInterval.set(key, au);
    }
    db.insert(assays).values({ sampleId: m.id, element: "Au", value: au, unit: "г/т", receivedDate: received, importId: 0 }).run();
    if (m.batch === 1 && m.type !== "пустышка (бланк)") {
      db.insert(assays).values({
        sampleId: m.id, element: "Ag", value: Math.round((2 + rnd() * 48) * 10) / 10, unit: "г/т", receivedDate: received, importId: 0,
      }).run();
      db.insert(assays).values({
        sampleId: m.id, element: "Cu", value: Math.round((0.01 + rnd() * 0.75) * 1000) / 1000, unit: "%", receivedDate: received, importId: 0,
      }).run();
    }
  });
}
