import { storage } from "./storage";
import { SAMPLE_STAGES } from "@shared/schema";
import type { Thresholds } from "@shared/schema";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (a: number, b: number) => (b === 0 ? 0 : (a / b) * 100);
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

export const fmt = (n: number, digits = 0) =>
  new Intl.NumberFormat("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
const money = (n: number) => fmt(Math.round(n)) + " ₽";

export type PrepFlag = {
  level: "критично" | "внимание";
  object: string;
  title: string;
  value: string;
  advice: string;
};

/**
 * Аналитика раздела «Пробоподготовка» и блока «Керн» (описание, распиловка, отставания).
 * Все расчёты устойчивы к пустой базе — после полного сброса возвращаются нули и пустые списки.
 */
export function buildSamplePrep(t: Thresholds, now: Date) {
  const nowIso = iso(now);
  const objects = storage.objects();
  const employees = storage.employees();
  const equipment = storage.equipment();
  const reports = storage.reports();
  const labs = storage.labs();
  const analysisTypes = storage.analysisTypes();
  const samples = storage.samples();
  const moves = storage.sampleMoves();
  const batches = storage.labBatches();
  const assays = storage.assays();
  const logs = storage.coreLogs();
  const cuts = storage.coreCuts();

  const objName = (id: number) => objects.find((o) => o.id === id)?.name ?? "—";
  const empName = (id: number) => employees.find((e) => e.id === id)?.fio ?? "—";
  const labName = (id: number) => labs.find((l) => l.id === id)?.name ?? "—";
  const sum = <T,>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0);

  /* ==================== 1. Пробоподготовка ==================== */

  const active = samples.filter((s) => s.status !== "брак");
  const rejected = samples.filter((s) => s.status === "брак");
  const inWork = active.filter((s) => s.stage !== "Результат получен" && s.stage !== "Архив/Брак");
  const done = samples.filter((s) => s.stage === "Результат получен");

  const cnt = (from: string, to: string) => samples.filter((s) => s.date >= from && s.date <= to).length;
  const weekFrom = iso(addDays(now, -6));
  const monthFrom = nowIso.slice(0, 7) + "-01";
  const prevWeekFrom = iso(addDays(now, -13));
  const prevWeekTo = iso(addDays(now, -7));
  const perPeriod = {
    day: cnt(nowIso, nowIso),
    week: cnt(weekFrom, nowIso),
    month: cnt(monthFrom, nowIso),
    prevWeek: cnt(prevWeekFrom, prevWeekTo),
  };
  const weekDeltaPct = perPeriod.prevWeek ? r1(pct(perPeriod.week - perPeriod.prevWeek, perPeriod.prevWeek)) : 0;

  // Этапы (канбан) с поиском затора
  const byStage = SAMPLE_STAGES.map((stage) => {
    const rows = samples.filter((s) => s.stage === stage);
    const stuck = rows.filter((s) => s.stageDate && daysBetween(s.stageDate, nowIso) > t.stageStuckDays);
    const avgDays = rows.length
      ? r1(sum(rows, (s) => (s.stageDate ? daysBetween(s.stageDate, nowIso) : 0)) / rows.length)
      : 0;
    const inProcess = stage !== "Результат получен" && stage !== "Архив/Брак";
    return {
      stage, count: rows.length, avgDays, stuck: stuck.length,
      oldestDays: rows.length ? Math.max(...rows.map((s) => (s.stageDate ? daysBetween(s.stageDate, nowIso) : 0))) : 0,
      bottleneck: inProcess && (rows.length > t.stageQueueMax || stuck.length > 0),
      inProcess,
    };
  });
  const worstStage = [...byStage.filter((s) => s.inProcess)].sort((a, b) => b.count - a.count)[0] ?? null;

  // Цикл: отбор → отправка → результат
  const moveDate = (sampleId: number, stage: string) =>
    moves.find((m) => m.sampleId === sampleId && m.toStage === stage)?.date ?? "";
  const cycleRows = done.map((s) => {
    const sent = moveDate(s.id, "Отправлена в лабораторию") || s.date;
    const res = moveDate(s.id, "Результат получен") || s.stageDate || nowIso;
    return { prep: Math.max(0, daysBetween(s.date, sent)), lab: Math.max(0, daysBetween(sent, res)),
      total: Math.max(0, daysBetween(s.date, res)) };
  });
  const cycle = {
    total: cycleRows.length ? r1(sum(cycleRows, (c) => c.total) / cycleRows.length) : 0,
    prep: cycleRows.length ? r1(sum(cycleRows, (c) => c.prep) / cycleRows.length) : 0,
    lab: cycleRows.length ? r1(sum(cycleRows, (c) => c.lab) / cycleRows.length) : 0,
  };

  // Партии в лабораторию
  const batchRows = batches.map((b) => {
    const rows = samples.filter((s) => s.batchId === b.id);
    const lab = labs.find((l) => l.id === b.labId);
    const due = b.dueDate || (lab ? iso(addDays(new Date(b.sentDate), lab.leadDays)) : b.sentDate);
    const received = b.status === "получена";
    const overdueDays = received
      ? Math.max(0, daysBetween(due, b.resultDate || nowIso))
      : Math.max(0, daysBetween(due, nowIso));
    const price = lab?.pricePerSample ?? 0;
    return {
      id: b.id, code: b.code, labId: b.labId, lab: labName(b.labId),
      analysisType: analysisTypes.find((a) => a.id === b.analysisTypeId)?.name ?? "—",
      sentDate: b.sentDate, dueDate: due, resultDate: b.resultDate, status: b.status,
      shipMethod: b.shipMethod, waybill: b.waybill, note: b.note,
      samples: rows.length, cost: r0(rows.length * price),
      objects: [...new Set(rows.map((s) => objName(s.objectId)))].join(", ") || "—",
      overdue: !received && overdueDays > 0, overdueDays,
      standards: rows.filter((s) => s.sampleType === "контрольная (стандарт)").length,
      duplicates: rows.filter((s) => s.sampleType === "дубликат").length,
      blanks: rows.filter((s) => s.sampleType === "пустышка (бланк)").length,
    };
  }).sort((a, b) => (a.sentDate < b.sentDate ? 1 : -1));

  const costByMonth = (() => {
    const m = new Map<string, number>();
    batchRows.forEach((b) => m.set(b.sentDate.slice(0, 7), (m.get(b.sentDate.slice(0, 7)) ?? 0) + b.cost));
    return [...m.entries()].sort().map(([month, cost]) => ({ month, cost: r0(cost) }));
  })();
  const costByLab = labs.map((l) => {
    const rows = batchRows.filter((b) => b.labId === l.id);
    return { lab: l.name, city: l.city, batches: rows.length,
      samples: sum(rows, (b) => b.samples), cost: r0(sum(rows, (b) => b.cost)) };
  }).filter((x) => x.batches > 0).sort((a, b) => b.cost - a.cost);
  const analysisCost = r0(sum(batchRows, (b) => b.cost));

  const drilledTotal = sum(reports, (r) => r.meters);
  const costPerMeter = drilledTotal ? r1(analysisCost / drilledTotal) : 0;
  const sampledMeters = sum(samples, (s) => Math.max(0, s.toDepth - s.fromDepth));
  // Плотность опробования — сколько проб приходится на метр опробованного интервала
  const samplesPerMeter = sampledMeters ? r2(samples.length / sampledMeters) : 0;

  // Контроль качества QA/QC
  const typeShare = (type: string) => r1(pct(samples.filter((s) => s.sampleType === type).length, samples.length || 1));
  const qaShares = {
    dup: typeShare("дубликат"), std: typeShare("контрольная (стандарт)"), blank: typeShare("пустышка (бланк)"),
    dupNorm: t.dupSharePct, stdNorm: t.stdSharePct, blankNorm: t.blankSharePct,
  };
  const auOf = (sampleId: number) => assays.find((a) => a.sampleId === sampleId && a.element === "Au")?.value ?? null;
  const dupPairs = samples.filter((s) => s.sampleType === "дубликат").map((d) => {
    const orig = samples.find(
      (s) => s.id !== d.id && s.holeName === d.holeName && s.objectId === d.objectId &&
        s.fromDepth === d.fromDepth && s.sampleType !== "дубликат");
    const a = orig ? auOf(orig.id) : null;
    const b = auOf(d.id);
    const dev = a && b ? r1(Math.abs(a - b) / ((a + b) / 2) * 100) : null;
    return {
      code: d.code, origCode: orig?.code ?? "—", object: objName(d.objectId), hole: d.holeName,
      interval: `${fmt(d.fromDepth, 1)}–${fmt(d.toDepth, 1)}`,
      origValue: a, dupValue: b, deviationPct: dev,
      ok: dev === null ? null : dev <= t.dupDeviationPct,
    };
  }).filter((p) => p.dupValue !== null);
  const dupFailed = dupPairs.filter((p) => p.ok === false);

  const stdRows = samples.filter((s) => s.sampleType === "контрольная (стандарт)").map((s) => ({
    code: s.code, object: objName(s.objectId), value: auOf(s.id), note: s.note,
  })).filter((s) => s.value !== null);
  const blankRows = samples.filter((s) => s.sampleType === "пустышка (бланк)").map((s) => ({
    code: s.code, object: objName(s.objectId), value: auOf(s.id),
  })).filter((s) => s.value !== null);

  const batchesWithoutStd = batchRows.filter((b) => b.samples >= 20 && b.standards === 0);
  const lostSamples = samples.filter((s) => {
    if (s.stage !== "Отправлена в лабораторию" || !s.batchId) return false;
    const b = batchRows.find((x) => x.id === s.batchId);
    return !!b && b.overdueDays > t.labNoResultDays;
  }).map((s) => ({
    code: s.code, object: objName(s.objectId),
    batch: batchRows.find((b) => b.id === s.batchId)?.code ?? "—",
    daysOver: batchRows.find((b) => b.id === s.batchId)?.overdueDays ?? 0,
  }));

  const rejectPct = r1(pct(rejected.length, samples.length || 1));
  const rejectReasons = (() => {
    const m = new Map<string, number>();
    rejected.forEach((s) => m.set(s.rejectReason || "не указана", (m.get(s.rejectReason || "не указана") ?? 0) + 1));
    return [...m.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
  })();

  // Результаты анализов
  const oreLimit = (el: string) =>
    el === "Au" ? t.oreAuGt : el === "Ag" ? t.oreAgGt : el === "Cu" ? t.oreCuPct : Number.POSITIVE_INFINITY;
  const assayRows = assays.map((a) => {
    const s = samples.find((x) => x.id === a.sampleId);
    return {
      id: a.id, sampleId: a.sampleId, code: s?.code ?? "—", object: s ? objName(s.objectId) : "—",
      hole: s?.holeName ?? "—", fromDepth: s?.fromDepth ?? 0, toDepth: s?.toDepth ?? 0,
      sampleType: s?.sampleType ?? "—", element: a.element, value: a.value, unit: a.unit,
      receivedDate: a.receivedDate, ore: a.value >= oreLimit(a.element),
    };
  }).sort((a, b) => (a.code < b.code ? -1 : 1));
  const oreCount = assayRows.filter((a) => a.ore).length;

  const holeGrades = (() => {
    const m = new Map<string, { object: string; len: number; grade: number; ore: number; oreLen: number; n: number }>();
    assayRows.filter((a) => a.element === "Au").forEach((a) => {
      const key = `${a.object}|${a.hole}`;
      const len = Math.max(0, a.toDepth - a.fromDepth);
      const cur = m.get(key) ?? { object: a.object, len: 0, grade: 0, ore: 0, oreLen: 0, n: 0 };
      cur.len += len; cur.grade += a.value * len; cur.n += 1;
      if (a.ore) { cur.ore += 1; cur.oreLen += len; }
      m.set(key, cur);
    });
    return [...m.entries()].map(([key, v]) => ({
      object: v.object, hole: key.split("|")[1], samples: v.n, meters: r1(v.len),
      avgAu: v.len ? r2(v.grade / v.len) : 0, oreSamples: v.ore, oreMeters: r1(v.oreLen),
    })).sort((a, b) => b.avgAu - a.avgAu);
  })();

  const samplesByDay = (() => {
    const keys: string[] = [];
    for (let i = 29; i >= 0; i--) keys.push(iso(addDays(now, -i)));
    return keys.map((d) => ({
      date: d, label: d.slice(8, 10) + "." + d.slice(5, 7),
      отобрано: samples.filter((s) => s.date === d).length,
      результаты: assays.filter((a) => a.receivedDate === d && a.element === "Au").length,
    }));
  })();

  /* ==================== 2. Керн: описание и распиловка ==================== */

  const holeNames = [...new Set([
    ...reports.filter((r) => r.holeName).map((r) => r.holeName),
    ...logs.map((l) => l.holeName), ...cuts.map((c) => c.holeName),
  ])].filter(Boolean).sort();

  const dayKeys: string[] = [];
  for (let i = 59; i >= 0; i--) dayKeys.push(iso(addDays(now, -i)));

  // Производительность описания и распиловки за последние 14 дней
  const lastFrom = iso(addDays(now, -13));
  const describedLast14 = sum(logs.filter((l) => l.date >= lastFrom), (l) => l.toDepth - l.fromDepth);
  const cutLast14 = sum(cuts.filter((c) => c.date >= lastFrom), (c) => c.toDepth - c.fromDepth);
  const logDaysActive = new Set(logs.filter((l) => l.date >= lastFrom).map((l) => l.date)).size || 1;
  const cutDaysActive = new Set(cuts.filter((c) => c.date >= lastFrom).map((c) => c.date)).size || 1;
  const logRate = describedLast14 ? r1(describedLast14 / logDaysActive) : t.geologistNormMpd;
  const cutRate = cutLast14 ? r1(cutLast14 / cutDaysActive) : t.geologistNormMpd;

  const holeSeries: Record<string, { date: string; label: string; пробурено: number; описано: number; распилено: number }[]> = {};

  const byHole = holeNames.map((hole) => {
    const hReports = reports.filter((r) => r.holeName === hole);
    const hLogs = logs.filter((l) => l.holeName === hole);
    const hCuts = cuts.filter((c) => c.holeName === hole);
    const hSamples = samples.filter((s) => s.holeName === hole);
    const objectId = hReports[0]?.objectId ?? hLogs[0]?.objectId ?? hCuts[0]?.objectId ?? 0;

    const drilled = r1(sum(hReports, (r) => r.meters));
    const described = r1(sum(hLogs, (l) => l.toDepth - l.fromDepth));
    const cutM = r1(sum(hCuts, (c) => c.toDepth - c.fromDepth));
    const sampled = r1(sum(hSamples, (s) => s.toDepth - s.fromDepth));

    // накопительные кривые по дням
    let cd = 0, cl = 0, cc = 0;
    const series = dayKeys.map((d) => {
      cd += sum(hReports.filter((r) => r.date === d), (r) => r.meters);
      cl += sum(hLogs.filter((l) => l.date === d), (l) => l.toDepth - l.fromDepth);
      cc += sum(hCuts.filter((c) => c.date === d), (c) => c.toDepth - c.fromDepth);
      return { date: d, label: d.slice(8, 10) + "." + d.slice(5, 7), пробурено: r0(cd), описано: r0(cl), распилено: r0(cc) };
    });
    holeSeries[hole] = series;

    // тренд отставания: сколько дней подряд разрыв растёт (окно — последние 14 дней)
    const lagSeries = series.map((s) => s.пробурено - s.описано);
    let growDays = 0;
    for (let i = lagSeries.length - 1; i > 0 && growDays < 14; i--) {
      if (lagSeries[i] > lagSeries[i - 1] + 0.5) growDays++;
      else break;
    }
    const lagWeekAgo = lagSeries[Math.max(0, lagSeries.length - 8)] ?? 0;
    const lagNow = lagSeries[lagSeries.length - 1] ?? 0;
    const weekDelta = r0(lagNow - lagWeekAgo);
    const trend = weekDelta > 5 ? "растёт" : weekDelta < -5 ? "сокращается" : "стабильно";

    const lagDesc = r1(Math.max(0, drilled - described));
    const lagCutDrill = r1(Math.max(0, drilled - cutM));
    const lagCutDesc = r1(Math.max(0, described - cutM));
    const lagSample = r1(Math.max(0, cutM - sampled));
    const avgRecovery = hLogs.length
      ? r1(sum(hLogs, (l) => l.recoveryPct * (l.toDepth - l.fromDepth)) / (described || 1))
      : 0;
    // темп описания именно по этой скважине (м/день работы геолога)
    const recentLogs = hLogs.filter((l) => l.date >= iso(addDays(now, -13)));
    const recentDays = new Set(recentLogs.map((l) => l.date)).size;
    const holeRate = recentDays
      ? r1(sum(recentLogs, (l) => l.toDepth - l.fromDepth) / recentDays)
      : t.geologistNormMpd;
    const recentCuts = hCuts.filter((c) => c.date >= iso(addDays(now, -13)));
    const recentCutDays = new Set(recentCuts.map((c) => c.date)).size;
    const holeCutRate = recentCutDays
      ? r1(sum(recentCuts, (c) => c.toDepth - c.fromDepth) / recentCutDays)
      : t.geologistNormMpd;
    // темп «догоняющей» работы: геолог на подхвате работает не медленнее норматива
    const catchRate = Math.max(holeRate, t.geologistNormMpd) || 1;
    const catchCutRate = Math.max(holeCutRate, cutRate, 1);
    const lastDrill = hReports.length ? hReports.map((r) => r.date).sort().slice(-1)[0] : "";
    const lastLog = hLogs.length ? hLogs.map((l) => l.date).sort().slice(-1)[0] : "";
    const undescribedDays = lagDesc > 1 && lastLog ? daysBetween(lastLog, nowIso) : 0;

    return {
      hole, object: objName(objectId), objectId,
      drilled, described, cut: cutM, sampled,
      lagDescM: lagDesc, lagDescPct: r1(pct(lagDesc, drilled || 1)), lagDescDays: r1(lagDesc / catchRate),
      holeRate, holeCutRate, catchRate, catchCutRate,
      lagCutM: lagCutDrill, lagCutPct: r1(pct(lagCutDrill, drilled || 1)), lagCutDays: r1(lagCutDrill / catchCutRate),
      lagCutFromDescM: lagCutDesc, lagCutFromDescPct: r1(pct(lagCutDesc, described || 1)),
      lagSampleM: lagSample,
      avgRecovery, recoveryOk: avgRecovery === 0 || avgRecovery >= t.coreRecoveryMin,
      trend, weekDelta, growDays, lastDrillDate: lastDrill, lastLogDate: lastLog, undescribedDays,
      photoPct: hLogs.length ? r1(pct(hLogs.filter((l) => l.photo).length, hLogs.length)) : 0,
      active: !!lastDrill && daysBetween(lastDrill, nowIso) <= 7,
    };
  }).sort((a, b) => b.lagDescM - a.lagDescM);

  const coreTotals = {
    drilled: r0(sum(byHole, (h) => h.drilled)),
    described: r0(sum(byHole, (h) => h.described)),
    cut: r0(sum(byHole, (h) => h.cut)),
    sampled: r0(sum(byHole, (h) => h.sampled)),
    logRate, cutRate,
  };
  const lagTotalM = r0(Math.max(0, coreTotals.drilled - coreTotals.described));
  const coreSummary = {
    ...coreTotals,
    describedPct: r1(pct(coreTotals.described, coreTotals.drilled || 1)),
    cutPct: r1(pct(coreTotals.cut, coreTotals.drilled || 1)),
    lagDescM: lagTotalM,
    lagDescPct: r1(pct(lagTotalM, coreTotals.drilled || 1)),
    lagDescDays: r1(lagTotalM / (logRate || 1)),
    lagCutM: r0(Math.max(0, coreTotals.drilled - coreTotals.cut)),
    lagCutDays: r1(Math.max(0, coreTotals.drilled - coreTotals.cut) / (cutRate || 1)),
  };

  const coreByObject = objects.map((o) => {
    const rows = byHole.filter((h) => h.objectId === o.id);
    const drilled = r0(sum(rows, (h) => h.drilled));
    const described = r0(sum(rows, (h) => h.described));
    const cutM = r0(sum(rows, (h) => h.cut));
    const lag = Math.max(0, drilled - described);
    return {
      object: o.name, holes: rows.length, drilled, described, cut: cutM,
      sampled: r0(sum(rows, (h) => h.sampled)),
      lagDescM: r0(lag), lagDescPct: r1(pct(lag, drilled || 1)), lagDescDays: r1(lag / (logRate || 1)),
      lagCutM: r0(Math.max(0, drilled - cutM)),
      avgRecovery: described ? r1(sum(rows, (h) => h.avgRecovery * h.described) / described) : 0,
    };
  }).filter((x) => x.drilled > 0 || x.described > 0);

  // Производительность геологов
  const geologistPerf = (() => {
    const ids = [...new Set(logs.map((l) => l.geologistId))];
    return ids.map((id) => {
      const rows = logs.filter((l) => l.geologistId === id);
      const meters = r0(sum(rows, (l) => l.toDepth - l.fromDepth));
      const days = new Set(rows.map((l) => l.date)).size || 1;
      const monthRows = rows.filter((l) => l.date >= monthFrom);
      return {
        id, name: empName(id), object: objName(rows[0]?.objectId ?? 0),
        meters, days, perDay: r1(meters / days),
        monthMeters: r0(sum(monthRows, (l) => l.toDepth - l.fromDepth)),
        weekMeters: r0(sum(rows.filter((l) => l.date >= weekFrom), (l) => l.toDepth - l.fromDepth)),
        intervals: rows.length,
        photoPct: r1(pct(rows.filter((l) => l.photo).length, rows.length || 1)),
        avgRecovery: r1(sum(rows, (l) => l.recoveryPct) / (rows.length || 1)),
        normOk: r1(meters / days) >= t.geologistNormMpd,
      };
    }).sort((a, b) => b.perDay - a.perDay);
  })();

  const cutMetersTotal = sum(cuts, (c) => c.toDepth - c.fromDepth);
  const cutRejectM = sum(cuts, (c) => c.rejectMeters);
  const cutShiftCount = new Set(cuts.map((c) => `${c.date}|${c.shift}|${c.equipmentId}`)).size;
  const cutting = {
    meters: r0(cutMetersTotal),
    shifts: cutShiftCount,
    perShift: cutShiftCount ? r1(cutMetersTotal / cutShiftCount) : 0,
    perDay: (() => {
      const d = new Set(cuts.map((c) => c.date)).size || 1;
      return r1(cutMetersTotal / d);
    })(),
    weekMeters: r0(sum(cuts.filter((c) => c.date >= weekFrom), (c) => c.toDepth - c.fromDepth)),
    monthMeters: r0(sum(cuts.filter((c) => c.date >= monthFrom), (c) => c.toDepth - c.fromDepth)),
    rejectMeters: r1(cutRejectM),
    rejectPct: r1(pct(cutRejectM, cutMetersTotal || 1)),
    repeat: cuts.filter((c) => c.status === "требует повтора").length,
    byMachine: equipment.filter((e) => e.kind === "Камнерезный станок").map((e) => {
      const rows = cuts.filter((c) => c.equipmentId === e.id);
      return { name: e.name, object: objName(e.objectId), shifts: rows.length,
        meters: r0(sum(rows, (c) => c.toDepth - c.fromDepth)),
        rejectMeters: r1(sum(rows, (c) => c.rejectMeters)) };
    }).filter((m) => m.shifts > 0),
  };

  const logging = {
    meters: coreTotals.described,
    intervals: logs.length,
    weekMeters: r0(sum(logs.filter((l) => l.date >= weekFrom), (l) => l.toDepth - l.fromDepth)),
    monthMeters: r0(sum(logs.filter((l) => l.date >= monthFrom), (l) => l.toDepth - l.fromDepth)),
    photoPct: logs.length ? r1(pct(logs.filter((l) => l.photo).length, logs.length)) : 0,
    needsReview: logs.filter((l) => l.status === "требует уточнения").length,
    avgRecovery: coreTotals.described
      ? r1(sum(logs, (l) => l.recoveryPct * (l.toDepth - l.fromDepth)) / coreTotals.described) : 0,
    mineralizedMeters: r0(sum(logs.filter((l) => l.mineralization), (l) => l.toDepth - l.fromDepth)),
  };

  const worstHole = byHole.find((h) => h.lagDescM > 0) ?? byHole[0] ?? null;

  // Суточная динамика описания и распиловки (все скважины)
  const coreByDay = dayKeys.slice(-30).map((d) => ({
    date: d, label: d.slice(8, 10) + "." + d.slice(5, 7),
    пробурено: r0(sum(reports.filter((r) => r.date === d), (r) => r.meters)),
    описано: r0(sum(logs.filter((l) => l.date === d), (l) => l.toDepth - l.fromDepth)),
    распилено: r0(sum(cuts.filter((c) => c.date === d), (c) => c.toDepth - c.fromDepth)),
  }));

  /* ==================== 3. Предупреждения ==================== */

  const flags: PrepFlag[] = [];

  if (worstStage && worstStage.count > t.stageQueueMax)
    flags.push({
      level: worstStage.count > t.stageQueueMax * 1.5 ? "критично" : "внимание",
      object: "Пробоподготовка", title: `Затор на этапе «${worstStage.stage}»`,
      value: `${worstStage.count} проб в очереди при пороге ${t.stageQueueMax}`,
      advice: "Добавить смену на пробоподготовке или перевести часть проб на подрядчика.",
    });
  byStage.filter((s) => s.inProcess && s.stuck > 0).forEach((s) =>
    flags.push({
      level: s.oldestDays > t.stageStuckDays * 2 ? "критично" : "внимание",
      object: "Пробоподготовка", title: `Пробы залежались на этапе «${s.stage}»`,
      value: `${s.stuck} проб дольше ${t.stageStuckDays} дн., самая старая — ${s.oldestDays} дн.`,
      advice: "Разобрать очередь по этапу и назначить ответственного за передачу дальше.",
    }));
  batchRows.filter((b) => b.overdue).forEach((b) =>
    flags.push({
      level: b.overdueDays > t.labNoResultDays ? "критично" : "внимание",
      object: b.lab, title: `Лаборатория просрочила: партия ${b.code}`,
      value: `${b.overdueDays} дн. сверх срока, ${b.samples} проб, срок был ${b.dueDate.split("-").reverse().join(".")}`,
      advice: "Письмо-претензия в лабораторию, запросить дату выдачи и оценить перенос объёмов.",
    }));
  if (samples.length && qaShares.dup < t.dupSharePct)
    flags.push({
      level: "внимание", object: "Контроль качества", title: "Мало дубликатов в контроле",
      value: `${fmt(qaShares.dup, 1)}% при норме ${t.dupSharePct}%`,
      advice: "Увеличить отбор дубликатов до нормы, иначе результаты нечем перепроверить.",
    });
  if (samples.length && qaShares.std < t.stdSharePct)
    flags.push({
      level: "внимание", object: "Контроль качества", title: "Мало стандартов в контроле",
      value: `${fmt(qaShares.std, 1)}% при норме ${t.stdSharePct}%`,
      advice: "Вкладывать стандартные образцы в каждую партию — иначе нет доказательств качества анализа.",
    });
  batchesWithoutStd.forEach((b) =>
    flags.push({
      level: "внимание", object: b.lab, title: `В партии ${b.code} нет стандартов`,
      value: `${b.samples} проб без контрольных образцов`,
      advice: "Согласовать с лабораторией довложение стандарта или повторный анализ выборки.",
    }));
  if (dupFailed.length)
    flags.push({
      level: dupFailed.length > 2 ? "критично" : "внимание",
      object: "Контроль качества", title: "Расхождение по дубликатам выше нормы",
      value: `${dupFailed.length} пар из ${dupPairs.length}, максимум ${fmt(Math.max(...dupFailed.map((d) => d.deviationPct ?? 0)), 1)}% при допуске ${t.dupDeviationPct}%`,
      advice: "Перепроверить пробоподготовку (сокращение и измельчение) и запросить повторный анализ.",
    });
  if (lostSamples.length)
    flags.push({
      level: "критично", object: "Пробоподготовка", title: "Пробы могут быть потеряны в лаборатории",
      value: `${lostSamples.length} проб без результата дольше ${t.labNoResultDays} дн. сверх срока`,
      advice: "Запросить у лаборатории акт приёмки и подтверждение сохранности проб.",
    });
  if (rejectPct > t.rejectSharePct)
    flags.push({
      level: "внимание", object: "Пробоподготовка", title: "Доля брака проб выше нормы",
      value: `${fmt(rejectPct, 1)}% при норме ${t.rejectSharePct}%`,
      advice: "Разобрать причины брака с геологами участка и пересмотреть упаковку и вес проб.",
    });
  if (drilledTotal > 0 && samplesPerMeter < t.samplesPerMeter)
    flags.push({
      level: "внимание", object: "Пробоподготовка", title: "Плотность опробования ниже нормы",
      value: `${fmt(samplesPerMeter, 2)} проб на метр при норме ${t.samplesPerMeter}`,
      advice: "Проверить, весь ли рудный интервал опробован, и догнать отбор по пройденным метрам.",
    });

  // Керн
  byHole.forEach((h) => {
    if (h.lagDescM > t.coreLagMeters || h.lagDescDays > t.coreLagDays) {
      const critical = h.lagDescPct >= 40 || h.lagDescDays > t.coreLagDays * 2;
      flags.push({
        level: critical ? "критично" : "внимание",
        object: h.object, title: `Описание керна отстаёт от бурения: ${h.hole}`,
        value: `описано ${fmt(h.described)} м из ${fmt(h.drilled)} пробуренных, отставание ${fmt(h.lagDescM)} м (${fmt(h.lagDescPct, 0)}%) — это ${fmt(h.lagDescDays, 1)} дн. работы геолога${h.trend === "растёт" ? `, отставание растёт (+${fmt(h.weekDelta)} м за неделю)` : ""}`,
        advice: critical
          ? "Нужен второй геолог на объект или временное снижение темпа бурения по скважине."
          : "Поставить описание этой скважины первым приоритетом на ближайшие смены.",
      });
    }
    if (h.growDays >= t.lagGrowDays && h.lagDescM > 30)
      flags.push({
        level: "критично", object: h.object,
        title: `Отставание описания растёт ${h.growDays} дн. подряд: ${h.hole}`,
        value: `разрыв ${fmt(h.lagDescM)} м, темп описания ${fmt(logRate, 1)} м/день против бурения`,
        advice: "Геолог не догоняет темп бурения — нужен второй геолог или снижение темпа проходки.",
      });
    if (h.lagCutM > t.cutLagMeters || h.lagCutDays > t.cutLagDays)
      flags.push({
        level: h.lagCutDays > t.cutLagDays * 2 ? "критично" : "внимание",
        object: h.object, title: `Распиловка отстаёт от бурения: ${h.hole}`,
        value: `распилено ${fmt(h.cut)} м из ${fmt(h.drilled)} м, отставание ${fmt(h.lagCutM)} м — ${fmt(h.lagCutDays, 1)} дн. работы`,
        advice: "Добавить смену на камнерезный станок или вывести распиловку на вторую площадку.",
      });
    if (!h.recoveryOk && h.described > 20)
      flags.push({
        level: h.avgRecovery < t.coreRecoveryMin - 8 ? "критично" : "внимание",
        object: h.object, title: `Выход керна ниже нормы: ${h.hole}`,
        value: `${fmt(h.avgRecovery, 1)}% при норме ${t.coreRecoveryMin}%`,
        advice: "Проверить режим бурения и износ колонковой трубы — низкий выход обесценивает опробование.",
      });
    if (h.undescribedDays > t.logDelayDays && h.lagDescM > t.coreLagMeters)
      flags.push({
        level: "внимание", object: h.object,
        title: `Керн лежит неописанным: ${h.hole}`,
        value: `${h.undescribedDays} дн. без описания, ${fmt(h.lagDescM)} м в ящиках`,
        advice: "Риск потери и деградации керна — назначить описание в ближайшую смену.",
      });
  });
  if (cutting.meters > 0 && cutting.rejectPct > t.cutRejectPct)
    flags.push({
      level: "внимание", object: "Распиловка керна", title: "Брак при распиловке выше нормы",
      value: `${fmt(cutting.rejectPct, 1)}% (${fmt(cutting.rejectMeters, 1)} м) при норме ${t.cutRejectPct}%`,
      advice: "Заменить отрезной диск и проверить крепление керна при подаче.",
    });
  geologistPerf.filter((g) => !g.normOk && g.days >= 5).forEach((g) =>
    flags.push({
      level: "внимание", object: g.object, title: `Выработка геолога ниже норматива: ${g.name}`,
      value: `${fmt(g.perDay, 1)} м/день при норме ${t.geologistNormMpd} м/день`,
      advice: "Разобрать загрузку геолога: часть времени уходит не на документацию керна.",
    }));

  /* ==================== 4. Строки для сводки директора ==================== */

  const summaryCore: string[] = [];
  if (coreTotals.drilled > 0) {
    summaryCore.push(
      `Керн и опробование: пробурено ${fmt(coreTotals.drilled)} м, описано ${fmt(coreTotals.described)} м (${fmt(coreSummary.describedPct, 0)}%), распилено ${fmt(coreTotals.cut)} м (${fmt(coreSummary.cutPct, 0)}%), опробовано ${fmt(coreTotals.sampled)} м.`);
    if (worstHole && worstHole.lagDescM > 0)
      summaryCore.push(
        `Самое большое отставание описания — ${worstHole.hole} (${worstHole.object}): ${fmt(worstHole.lagDescM)} м (${fmt(worstHole.lagDescPct, 0)}%), это ${fmt(worstHole.lagDescDays, 1)} дн. работы геолога; отставание ${worstHole.trend}${worstHole.growDays ? ` (${worstHole.growDays} дн. подряд)` : ""}.`);
    summaryCore.push(
      `Темп описания ${fmt(logRate, 1)} м/день, распиловки ${fmt(cutting.perShift, 1)} м/смена; брак распиловки ${fmt(cutting.rejectPct, 1)}%, средний выход керна ${fmt(logging.avgRecovery, 1)}%.`);
  }
  const summaryPrep: string[] = [];
  if (samples.length) {
    summaryPrep.push(
      `Пробы: всего ${fmt(samples.length)}, за неделю отобрано ${fmt(perPeriod.week)} (${weekDeltaPct >= 0 ? "+" : ""}${fmt(weekDeltaPct, 1)}% к прошлой неделе), в работе ${fmt(inWork.length)}, результаты получены по ${fmt(done.length)}.`);
    if (worstStage)
      summaryPrep.push(
        `Узкое место пробоподготовки — этап «${worstStage.stage}»: ${worstStage.count} проб, средний возраст ${fmt(worstStage.avgDays, 1)} дн. Цикл отбор → результат ${fmt(cycle.total, 1)} дн. (подготовка ${fmt(cycle.prep, 1)} + лаборатория ${fmt(cycle.lab, 1)}).`);
    summaryPrep.push(
      `Анализы: ${money(analysisCost)} за период, ${money(costPerMeter)} на метр проходки; брак проб ${fmt(rejectPct, 1)}%, плотность опробования ${fmt(samplesPerMeter, 2)} проб/м.`);
    const over = batchRows.filter((b) => b.overdue);
    if (over.length)
      summaryPrep.push(
        `Лаборатории просрочили ${over.length} парт.: ${over.map((b) => `${b.code} — ${b.overdueDays} дн.`).join("; ")}.`);
  }

  return {
    prep: {
      totals: {
        samples: samples.length, inWork: inWork.length, done: done.length,
        rejected: rejected.length, rejectPct, perPeriod, weekDeltaPct,
        analysisCost, costPerMeter, samplesPerMeter, drilledTotal: r0(drilledTotal),
      },
      byStage, worstStage, cycle, batches: batchRows, costByMonth, costByLab,
      qa: { shares: qaShares, dupPairs, dupFailed: dupFailed.length, stdRows, blankRows,
        batchesWithoutStd: batchesWithoutStd.map((b) => b.code), lostSamples, rejectReasons },
      results: { rows: assayRows, oreCount, holeGrades, oreLimits: { Au: t.oreAuGt, Ag: t.oreAgGt, Cu: t.oreCuPct } },
      charts: { samplesByDay, funnel: byStage.filter((s) => s.inProcess).map((s) => ({ name: s.stage, value: s.count })) },
    },
    core: {
      summary: coreSummary, byHole, byObject: coreByObject, holeSeries,
      geologists: geologistPerf, cutting, logging, worstHole,
      charts: { coreByDay },
      rates: { logRate, cutRate },
    },
    flags,
    summaryCore,
    summaryPrep,
  };
}
