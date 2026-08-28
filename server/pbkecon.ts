/**
 * Экономика по реальным данным ПБК.
 * Анализ потерь считается В СМЕНАХ (в сводках нет часов простоя и ГСМ),
 * выручка — по расценкам календарного плана, ключевой показатель — «зависшая выручка».
 */
import { pdb, classifyComment, reasonList } from "./pbkdb";

const all = (sql: string, ...p: any[]) => pdb.prepare(sql).all(...p) as any[];
const one = (sql: string, ...p: any[]) => pdb.prepare(sql).get(...p) as any;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Расценки по умолчанию из календарного плана (₽ за единицу) */
export const FALLBACK_RATES: Record<string, { rate: number; unit: string }> = {
  "бурение": { rate: 10155.46, unit: "п.м." },
  "описание": { rate: 461.28, unit: "п.м." },
  "распиловка": { rate: 297.76, unit: "п.м." },
  "опробование": { rate: 310.07, unit: "п.м." },
  "дробление": { rate: 566.04, unit: "проба" },
  "РФА": { rate: 134, unit: "анализ" },
  "пробирный анализ": { rate: 619, unit: "анализ" },
};

/** Приоритетный источник расценок — календарный план (Приложение № 2 к договору) */
const MAIN_PLAN = "%Kalendarnyi-plan%";

export function rates(): Record<string, { rate: number; unit: string; source: string }> {
  const out: Record<string, { rate: number; unit: string; source: string }> = {};
  for (const [k, v] of Object.entries(FALLBACK_RATES)) out[k] = { ...v, source: "расценка по умолчанию" };
  const main = all(`SELECT work_kind, unit, rate, name, source_file FROM pbk_plan_lines
                    WHERE work_kind <> '' AND rate > 0 AND source_file LIKE ? ORDER BY id`, MAIN_PLAN);
  const other = all(`SELECT work_kind, unit, rate, name, source_file FROM pbk_plan_lines
                     WHERE work_kind <> '' AND rate > 0 AND source_file NOT LIKE ? ORDER BY id`, MAIN_PLAN);
  for (const r of other) {
    if (out[r.work_kind]?.source.startsWith("расценка по умолчанию")) {
      out[r.work_kind] = { rate: r.rate, unit: r.unit, source: `${r.name} — ${r.source_file}` };
    }
  }
  for (const r of main) {
    out[r.work_kind] = { rate: r.rate, unit: r.unit, source: `${r.name} — календарный план ${r.source_file}` };
  }
  return out;
}

/** Все расценки календарных планов — для экрана «Расценки» */
export function allPlanRates() {
  return all(`SELECT contract, object, name, unit, rate, total_qty, total_cost, work_kind, source_file
              FROM pbk_plan_lines WHERE is_group=0 AND rate>0 ORDER BY source_file, id`);
}

/* ==================== смены и потери ==================== */

export function shiftStats(objectFilter?: string) {
  const where = objectFilter ? "WHERE object = ?" : "";
  const p = objectFilter ? [objectFilter] : [];
  const rows = all(`SELECT * FROM pbk_shifts ${where}`, ...p);
  const total = rows.length;
  const productive = rows.filter((r) => r.meters > 0);
  const lost = rows.filter((r) => r.meters <= 0);
  const meters = productive.reduce((a, r) => a + r.meters, 0);
  const avgProductive = productive.length ? meters / productive.length : 0;
  const byReason: Record<string, { shifts: number; comments: string[] }> = {};
  for (const r of lost) {
    const cat = r.loss_category || "Прочее";
    byReason[cat] ??= { shifts: 0, comments: [] };
    byReason[cat].shifts++;
    if (r.comment && byReason[cat].comments.length < 5) byReason[cat].comments.push(r.comment);
  }
  return {
    total, productive: productive.length, lost: lost.length,
    productiveShare: total ? r2((productive.length / total) * 100) : 0,
    meters: r2(meters), avgProductive: r2(avgProductive),
    incidents: rows.filter((r) => r.incident).length,
    byReason: Object.entries(byReason)
      .map(([reason, v]) => ({ reason, shifts: v.shifts, comments: v.comments }))
      .sort((a, b) => b.shifts - a.shifts),
  };
}

/** Цена одной потерянной смены = средняя проходка результативной смены × ставка бурения */
export function lostShiftPrice(objectFilter?: string) {
  const st = shiftStats(objectFilter);
  const drillRate = rates()["бурение"].rate;
  const price = r2(st.avgProductive * drillRate);
  const byReason = st.byReason.map((r) => ({
    ...r, meters: r2(r.shifts * st.avgProductive), money: r2(r.shifts * price),
  }));
  return {
    ...st, drillRate, price,
    lostMeters: r2(st.lost * st.avgProductive),
    lostMoney: r2(st.lost * price),
    byReason,
  };
}

/* ==================== фактические объёмы по цепочке ==================== */

/** Период, за который есть буровые сводки */
export function drillPeriod() {
  const p = one(`SELECT MIN(date) a, MAX(date) b FROM pbk_shifts WHERE date<>''`);
  return { from: p?.a ?? "", to: p?.b ?? "9999-12-31" };
}

export function factVolumes(from = "", to = "9999-12-31") {
  const drillM = one(`SELECT COALESCE(SUM(meters),0) v FROM pbk_shifts WHERE date BETWEEN ? AND ?`, from, to).v as number;
  const geo = (k: string) => one(`SELECT COALESCE(SUM(length_m),0) v FROM pbk_geo WHERE kind=? AND date BETWEEN ? AND ?`, k, from, to).v as number;
  const docM = geo("документация");
  const sawM = geo("распиловка");
  const sampM = geo("опробование");
  const prep = one(`SELECT COALESCE(SUM(crushed),0) crushed, COALESCE(SUM(milled),0) milled,
                    COALESCE(SUM(shipped),0) shipped, COALESCE(SUM(xrf),0) xrf FROM pbk_prep
                    WHERE date BETWEEN ? AND ?`, from, to);
  return {
    "бурение": r2(drillM), "описание": r2(docM), "распиловка": r2(sawM), "опробование": r2(sampM),
    "дробление": r2(prep.crushed), "истирание": r2(prep.milled),
    "РФА": r2(prep.xrf), "пробирный анализ": r2(prep.shipped),
  } as Record<string, number>;
}

/** Коэффициент «проб на метр» из календарного плана (5027 проб на 4570 п.м. и т.п.) */
function samplesPerMeter(): number {
  const d = one(`SELECT total_qty q FROM pbk_plan_lines WHERE work_kind='дробление' AND total_qty>0 AND source_file LIKE ? ORDER BY id LIMIT 1`, MAIN_PLAN);
  const m = one(`SELECT total_qty q FROM pbk_plan_lines WHERE work_kind='описание' AND total_qty>0 AND source_file LIKE ? ORDER BY id LIMIT 1`, MAIN_PLAN);
  if (d?.q && m?.q) return d.q / m.q;
  return 1.1;
}

/**
 * Зависшая выручка: разрыв между пробуренными метрами и объёмом
 * следующих переделов, пересчитанный в рубли невыставленной выручки.
 */
export function hangingRevenue() {
  const R = rates();
  const per = drillPeriod();
  const f = factVolumes(per.from, per.to);
  const spm = samplesPerMeter();
  const drill = f["бурение"];
  const chain: Array<{ stage: string; unit: string; base: number; fact: number; gap: number; rate: number; money: number; done: number }> = [];
  const push = (stage: string, base: number, fact: number) => {
    const rate = R[stage]?.rate ?? 0;
    const gap = Math.max(0, base - fact);
    chain.push({
      stage, unit: R[stage]?.unit ?? "", base: r2(base), fact: r2(fact), gap: r2(gap), rate,
      money: r2(gap * rate), done: base > 0 ? r2((Math.min(fact, base) / base) * 100) : 0,
    });
  };
  push("описание", drill, f["описание"]);
  const sawBase = f["распиловка"] > 0 ? drill : 0;
  if (sawBase) push("распиловка", sawBase, f["распиловка"]);
  push("опробование", drill, f["опробование"]);
  push("дробление", f["опробование"] * spm, f["дробление"]);
  push("РФА", f["дробление"], f["РФА"]);
  push("пробирный анализ", f["дробление"], f["пробирный анализ"]);
  const total = r2(chain.reduce((a, c) => a + c.money, 0));
  return { chain, total, samplesPerMeter: r2(spm), period: per, volumes: f };
}

/** Фактическая выручка по расценкам календарного плана */
export function factRevenue() {
  const R = rates();
  const f = factVolumes();
  const lines = Object.entries(R).map(([stage, r]) => ({
    stage, unit: r.unit, rate: r.rate, qty: f[stage] ?? 0, money: r2((f[stage] ?? 0) * r.rate), source: r.source,
  }));
  return { lines, total: r2(lines.reduce((a, l) => a + l.money, 0)) };
}

/* ==================== план / факт по договорам ==================== */

export function planFact() {
  const plans = all(`SELECT contract, object, work_kind, unit, rate, SUM(total_qty) qty, SUM(total_cost) cost
                     FROM pbk_plan_lines WHERE is_group=0 AND work_kind<>'' GROUP BY contract, object, work_kind`);
  const f = factVolumes();
  return plans.map((p) => {
    const fact = f[p.work_kind] ?? 0;
    return {
      contract: p.contract, object: p.object, work_kind: p.work_kind, unit: p.unit, rate: p.rate,
      planQty: r2(p.qty), planCost: r2(p.cost), factQty: r2(fact),
      factCost: r2(fact * p.rate), pct: p.qty ? r2((fact / p.qty) * 100) : 0,
    };
  });
}

/* ==================== динамика по месяцам ==================== */

export function monthly() {
  const rows = all(`SELECT substr(date,1,7) m, object,
      COUNT(*) shifts, SUM(CASE WHEN meters>0 THEN 1 ELSE 0 END) prod, SUM(meters) meters
      FROM pbk_shifts WHERE date<>'' GROUP BY m, object ORDER BY m`);
  return rows.map((r) => ({
    month: r.m, object: r.object, shifts: r.shifts, productive: r.prod,
    lost: r.shifts - r.prod, meters: r2(r.meters ?? 0),
    productiveShare: r.shifts ? r2((r.prod / r.shifts) * 100) : 0,
  }));
}

export function byObject() {
  const objs = all(`SELECT DISTINCT object FROM pbk_shifts WHERE object<>'' ORDER BY object`).map((r) => r.object);
  return objs.map((o) => {
    const s = lostShiftPrice(o);
    const row = one(`SELECT contract, master, GROUP_CONCAT(DISTINCT rig) rigs FROM pbk_shifts WHERE object=?`, o);
    return {
      object: o, contract: row?.contract ?? "", master: row?.master ?? "", rigs: row?.rigs ?? "",
      shifts: s.total, productive: s.productive, lost: s.lost, productiveShare: s.productiveShare,
      meters: s.meters, avgProductive: s.avgProductive, lostMoney: s.lostMoney, incidents: s.incidents,
    };
  });
}

export function crewStats() {
  const rows = all(`SELECT shift_master, object, COUNT(*) shifts,
      SUM(CASE WHEN meters>0 THEN 1 ELSE 0 END) prod, SUM(meters) meters, SUM(incident) inc
      FROM pbk_shifts WHERE shift_master<>'' GROUP BY shift_master, object ORDER BY SUM(meters) DESC`);
  return rows.map((r) => ({
    master: r.shift_master, object: r.object, shifts: r.shifts, productive: r.prod,
    lost: r.shifts - r.prod, meters: r2(r.meters ?? 0),
    avg: r.prod ? r2((r.meters ?? 0) / r.prod) : 0,
    productiveShare: r.shifts ? r2((r.prod / r.shifts) * 100) : 0, incidents: r.inc,
  }));
}

/** Очередь ЦПП и запас дней (последний месяц сводки) */
export function prepState() {
  const q = all(`SELECT * FROM pbk_prep_queue ORDER BY id`);
  const last = q[q.length - 1];
  const totals = one(`SELECT COALESCE(SUM(crushed),0) crushed, COALESCE(SUM(milled),0) milled,
     COALESCE(SUM(shipped),0) shipped, COALESCE(SUM(received),0) received, COALESCE(SUM(xrf),0) xrf FROM pbk_prep`);
  const byMonth = all(`SELECT sheet, substr(date,1,7) m, SUM(crushed) crushed, SUM(milled) milled,
     SUM(shipped) shipped, SUM(received) received, SUM(xrf) xrf FROM pbk_prep GROUP BY sheet ORDER BY MIN(date)`);
  return { queue: q, last, totals, byMonth };
}

export function holesState() {
  const rows = all(`SELECT * FROM pbk_holes`);
  const done = rows.filter((r) => !r.planned);
  return {
    total: rows.length, planned: rows.filter((r) => r.planned).length, drilled: done.length,
    metersPlan: r2(rows.reduce((a, r) => a + (r.td_pro || 0), 0)),
    metersFact: r2(done.reduce((a, r) => a + (r.tdepth || 0), 0)),
    bySite: Object.entries(rows.reduce((acc: Record<string, any>, r) => {
      const k = r.site || "без зоны";
      acc[k] ??= { site: k, holes: 0, planned: 0, metersPlan: 0, metersFact: 0 };
      acc[k].holes++; if (r.planned) acc[k].planned++;
      acc[k].metersPlan += r.td_pro || 0; acc[k].metersFact += r.tdepth || 0;
      return acc;
    }, {})).map(([, v]: any) => ({ ...v, metersPlan: r2(v.metersPlan), metersFact: r2(v.metersFact) })),
  };
}

export function trenchState() {
  const rows = all(`SELECT * FROM pbk_trenches`);
  const sum = (k: string) => r2(rows.reduce((a, r) => a + (r[k] || 0), 0));
  return {
    count: rows.length, planLen: sum("plan_len"), cleanM: sum("clean_m"), docM: sum("doc_m"),
    grooveN: sum("groove_n"), chipN: sum("chip_n"),
    cleanPct: sum("plan_len") ? r2((sum("clean_m") / sum("plan_len")) * 100) : 0,
    docPct: sum("clean_m") ? r2((sum("doc_m") / sum("clean_m")) * 100) : 0,
    rows,
  };
}

/* ==================== Раздел «Реальные данные ПБК»: сводки по участкам ==================== */

/** Буровая сводка по участкам: метры факт, план (проектная глубина скважин), отставание от плана и от договора */
export function drillByObject() {
  const shiftRows = all(`SELECT object,
      SUM(meters) meters_fact, COUNT(DISTINCT hole) holes_touched,
      MIN(date) date_from, MAX(date) date_to, GROUP_CONCAT(DISTINCT rig) rigs
    FROM pbk_shifts WHERE object<>'' GROUP BY object`);
  const planRows = all(`SELECT object, SUM(proj_depth) plan_m, SUM(CASE WHEN fact_depth>0 THEN fact_depth ELSE 0 END) fact_from_geo,
      COUNT(*) holes_total, SUM(CASE WHEN fact_depth>0 THEN 1 ELSE 0 END) holes_drilled
    FROM pbk_geo_summary WHERE object<>'' GROUP BY object`);
  const contractRows = all(`SELECT object, SUM(total_qty) contract_m FROM pbk_plan_lines
     WHERE work_kind='бурение' AND is_group=0 GROUP BY object`);
  const objects = new Set<string>([...shiftRows.map((r) => r.object), ...planRows.map((r) => r.object)]);
  return Array.from(objects).map((obj) => {
    const s = shiftRows.find((r) => r.object === obj);
    const p = planRows.find((r) => r.object === obj);
    const c = contractRows.find((r) => r.object === obj);
    const metersFact = r2(s?.meters_fact ?? p?.fact_from_geo ?? 0);
    const planM = r2(p?.plan_m ?? 0);
    const contractM = r2(c?.contract_m ?? 0);
    return {
      object: obj, rigs: s?.rigs ?? "", dateFrom: s?.date_from ?? "", dateTo: s?.date_to ?? "",
      metersFact, planM, contractM,
      gapPlan: r2(planM - metersFact), gapPlanPct: planM ? r2(((planM - metersFact) / planM) * 100) : 0,
      gapContract: r2(contractM - metersFact), gapContractPct: contractM ? r2(((contractM - metersFact) / contractM) * 100) : 0,
      holesTotal: p?.holes_total ?? 0, holesDrilled: p?.holes_drilled ?? 0,
    };
  }).sort((a, b) => b.metersFact - a.metersFact);
}

/** Геологическая сводка по участкам: метры документации/опробования и отставание от факта бурения */
export function geoSummaryByObject() {
  const rows = all(`SELECT object,
      SUM(CASE WHEN fact_depth>0 THEN fact_depth ELSE 0 END) drilled_m,
      SUM(doc_m) doc_m, SUM(doc_gap_m) doc_gap_m,
      SUM(core_m) core_m, SUM(core_samples) core_samples,
      SUM(chip_m) chip_m, SUM(chip_samples) chip_samples,
      SUM(control_samples) control_samples, SUM(blank_samples) blank_samples, SUM(standard_samples) standard_samples,
      COUNT(*) holes_total, SUM(CASE WHEN fact_depth>0 THEN 1 ELSE 0 END) holes_drilled,
      SUM(CASE WHEN doc_m>0 THEN 1 ELSE 0 END) holes_documented,
      SUM(CASE WHEN core_samples>0 OR chip_samples>0 THEN 1 ELSE 0 END) holes_sampled
    FROM pbk_geo_summary WHERE object<>'' GROUP BY object ORDER BY drilled_m DESC`);
  return rows.map((r) => {
    const drilled = r2(r.drilled_m ?? 0), doc = r2(r.doc_m ?? 0);
    const sampled = r2((r.core_m ?? 0) + (r.chip_m ?? 0));
    return {
      object: r.object, drilledM: drilled, docM: doc, docGapM: r2(drilled - doc),
      docGapPct: drilled ? r2(((drilled - doc) / drilled) * 100) : 0,
      sampledM: sampled, sampledGapM: r2(doc - sampled), sampledGapPct: doc ? r2(((doc - sampled) / doc) * 100) : 0,
      coreM: r2(r.core_m ?? 0), coreSamples: r.core_samples ?? 0,
      chipM: r2(r.chip_m ?? 0), chipSamples: r.chip_samples ?? 0,
      controlSamples: r.control_samples ?? 0, blankSamples: r.blank_samples ?? 0, standardSamples: r.standard_samples ?? 0,
      holesTotal: r.holes_total ?? 0, holesDrilled: r.holes_drilled ?? 0,
      holesDocumented: r.holes_documented ?? 0, holesSampled: r.holes_sampled ?? 0,
    };
  });
}

/** Сводка ЦПП: дробление/истирание/пробы по месяцам */
export function prepByMonth() {
  const rows = all(`SELECT sheet, substr(date,1,7) m, SUM(crushed) crushed, SUM(milled) milled,
      SUM(shipped) shipped, SUM(received) received, SUM(xrf) xrf, COUNT(*) shifts,
      COUNT(DISTINCT holes) hole_groups
    FROM pbk_prep GROUP BY sheet ORDER BY MIN(date)`);
  return rows.map((r) => ({
    sheet: r.sheet, month: r.m, crushed: r2(r.crushed ?? 0), milled: r2(r.milled ?? 0),
    shipped: r2(r.shipped ?? 0), received: r2(r.received ?? 0), xrf: r2(r.xrf ?? 0), shifts: r.shifts,
  }));
}

/** Единая сводка «участок → что на нём есть»: где только бурение, где есть и геология/проба.
 * Автоматически подстраивается под то, какие профили реально прислали с участка. */
export function siteOverview() {
  const drill = drillByObject();
  const geo = geoSummaryByObject();
  const sites = new Set<string>([...drill.map((d) => d.object), ...geo.map((g) => g.object)]);
  const rows = Array.from(sites).map((site) => {
    const d = drill.find((x) => x.object === site);
    const g = geo.find((x) => x.object === site);
    return {
      site,
      hasDrill: !!d, hasGeo: !!g,
      drillMeters: d?.metersFact ?? 0, drillGapPlan: d?.gapPlan ?? 0, drillGapPlanPct: d?.gapPlanPct ?? 0,
      drillGapContract: d?.gapContract ?? 0, drillGapContractPct: d?.gapContractPct ?? 0,
      docGapM: g?.docGapM ?? 0, docGapPct: g?.docGapPct ?? 0,
      sampledGapM: g?.sampledGapM ?? 0, sampledGapPct: g?.sampledGapPct ?? 0,
      holesTotal: g?.holesTotal ?? d?.holesTotal ?? 0, holesDrilled: g?.holesDrilled ?? d?.holesDrilled ?? 0,
    };
  }).sort((a, b) => b.drillMeters - a.drillMeters);

  // Автовыводы для дашборда — простые правила по величине отставания
  const findings: string[] = [];
  const worstPlan = [...rows].filter((r) => r.hasDrill).sort((a, b) => b.drillGapPlanPct - a.drillGapPlanPct)[0];
  if (worstPlan && worstPlan.drillGapPlanPct > 5) {
    findings.push(`Участок «${worstPlan.site}» отстаёт от плана бурения на ${r2(worstPlan.drillGapPlanPct)}% (${r2(worstPlan.drillGapPlan)} м).`);
  }
  const worstContract = [...rows].filter((r) => r.hasDrill && r.drillGapContract > 0).sort((a, b) => b.drillGapContractPct - a.drillGapContractPct)[0];
  if (worstContract && worstContract.drillGapContractPct > 5) {
    findings.push(`Отставание от объёма договора наибольшее на участке «${worstContract.site}»: ${r2(worstContract.drillGapContractPct)}% (${r2(worstContract.drillGapContract)} м).`);
  }
  const worstDoc = [...rows].filter((r) => r.hasGeo).sort((a, b) => b.docGapPct - a.docGapPct)[0];
  if (worstDoc && worstDoc.docGapPct > 5) {
    findings.push(`Документация отстаёт от бурения сильнее всего на участке «${worstDoc.site}»: ${r2(worstDoc.docGapPct)}% (${r2(worstDoc.docGapM)} м не задокументировано).`);
  }
  const worstSample = [...rows].filter((r) => r.hasGeo).sort((a, b) => b.sampledGapPct - a.sampledGapPct)[0];
  if (worstSample && worstSample.sampledGapPct > 5) {
    findings.push(`Опробование отстаёт от документации сильнее всего на участке «${worstSample.site}»: ${r2(worstSample.sampledGapPct)}% (${r2(worstSample.sampledGapM)} м без проб).`);
  }
  const drillOnly = rows.filter((r) => r.hasDrill && !r.hasGeo).map((r) => r.site);
  if (drillOnly.length) {
    findings.push(`Только бурение без геологической сводки: ${drillOnly.join(", ")}.`);
  }
  if (!findings.length) findings.push("Существенных отставаний по участкам не выявлено — план и факт близки.");

  const totals = {
    drillMeters: r2(rows.reduce((a, r) => a + r.drillMeters, 0)),
    drillGapPlan: r2(rows.reduce((a, r) => a + Math.max(r.drillGapPlan, 0), 0)),
    drillGapContract: r2(rows.reduce((a, r) => a + Math.max(r.drillGapContract, 0), 0)),
    docGapM: r2(rows.reduce((a, r) => a + Math.max(r.docGapM, 0), 0)),
    sampledGapM: r2(rows.reduce((a, r) => a + Math.max(r.sampledGapM, 0), 0)),
    sites: rows.length,
  };

  return { rows, findings, totals };
}

/** Полная аналитическая сводка для дашборда директора */
export function pbkAnalytics() {
  const loss = lostShiftPrice();
  const hang = hangingRevenue();
  const rev = factRevenue();
  return {
    org: "ООО «Производственно-Буровая Компания»",
    kpi: {
      hangingRevenue: hang.total,
      lostShiftMoney: loss.lostMoney,
      lostShiftPrice: loss.price,
      factRevenue: rev.total,
      productiveShare: loss.productiveShare,
      shifts: loss.total, lostShifts: loss.lost, meters: loss.meters,
      incidents: loss.incidents,
    },
    loss, hanging: hang, revenue: rev,
    planFact: planFact(), monthly: monthly(), objects: byObject(), crews: crewStats(),
    prep: prepState(), holes: holesState(), trenches: trenchState(),
    rates: rates(), volumes: factVolumes(),
    sites: siteOverview(), drillSites: drillByObject(), geoSites: geoSummaryByObject(), prepMonthly: prepByMonth(),
  };
}

/** Пересчёт категорий потерь после правки словаря причин */
export function reclassifyShifts(): number {
  const rules = reasonList();
  const rows = all(`SELECT id, comment, meters FROM pbk_shifts`);
  const upd = pdb.prepare(`UPDATE pbk_shifts SET loss_category=? WHERE id=?`);
  const tx = pdb.transaction((list: any[]) => {
    for (const r of list) upd.run(r.meters > 0 ? "" : classifyComment(r.comment, rules as any), r.id);
  });
  tx(rows);
  return rows.length;
}
