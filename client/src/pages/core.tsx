import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Plus, Trash2, TrendingUp, TrendingDown, Minus, Layers, ScissorsSquare, ClipboardList, Gauge, AlertTriangle,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAnalytics, useList, useReference } from "@/lib/hooks";
import {
  PageHeader, Section, Empty, Loading, ErrorBox, ExportButton, Kpi, TableWrap,
} from "@/components/shell";
import { nf, ruDate, todayIso, downloadFile, levelBadge, levelText, CHART_COLORS, type Level } from "@/lib/app";
import { cn } from "@/lib/utils";

type TabKey = "lag" | "logs" | "cuts" | "perf";

const TABS: { key: TabKey; label: string; icon: any }[] = [
  { key: "lag", label: "Отставание по керну", icon: Layers },
  { key: "logs", label: "Описание керна", icon: ClipboardList },
  { key: "cuts", label: "Распиловка керна", icon: ScissorsSquare },
  { key: "perf", label: "Производительность", icon: Gauge },
];

const axis = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const tip = {
  contentStyle: {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 6,
    fontSize: 12,
    color: "hsl(var(--popover-foreground))",
  },
};

const emptyLog = {
  date: todayIso(), objectId: "", holeName: "", fromDepth: "", toDepth: "",
  geologistId: "", recoveryPct: "95", lithology: "", mineralization: "0",
  mineralizationNote: "", photo: "1", status: "описано",
};

const emptyCut = {
  date: todayIso(), objectId: "", holeName: "", fromDepth: "", toDepth: "",
  worker: "", shift: "день", cutType: "продольная", equipmentId: "",
  rejectMeters: "0", rejectReason: "", status: "распилено",
};

/** Уровень по отставанию: сравниваем метры и дни с порогами из настроек */
function lagLevel(m: number, days: number, limM: number, limD: number): Level {
  if (m >= limM || days >= limD) return "bad";
  if (m >= limM * 0.6 || days >= limD * 0.6) return "warn";
  return "ok";
}

function Trend({ trend, delta }: { trend: string; delta: number }) {
  const grow = trend === "растёт";
  const Icon = grow ? TrendingUp : trend === "сокращается" ? TrendingDown : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap",
        grow ? "text-red-700 dark:text-red-400" : trend === "сокращается" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {trend}
      {delta ? ` (${delta > 0 ? "+" : ""}${nf(delta)} м/нед.)` : ""}
    </span>
  );
}

export default function CorePage() {
  const { data: ref } = useReference();
  const { data: analytics, isLoading, error } = useAnalytics();
  const logs = useList<any>("/api/corelogs");
  const cuts = useList<any>("/api/corecuts");
  const { toast } = useToast();

  const [tab, setTab] = useState<TabKey>("lag");
  const [hole, setHole] = useState("");

  // фильтры журналов
  const [lObject, setLObject] = useState("all");
  const [lHole, setLHole] = useState("all");
  const [lGeologist, setLGeologist] = useState("all");
  const [lStatus, setLStatus] = useState("all");
  const [cObject, setCObject] = useState("all");
  const [cHole, setCHole] = useState("all");
  const [cStatus, setCStatus] = useState("all");

  const [logOpen, setLogOpen] = useState(false);
  const [logForm, setLogForm] = useState({ ...emptyLog });
  const [logError, setLogError] = useState("");
  const [cutOpen, setCutOpen] = useState(false);
  const [cutForm, setCutForm] = useState({ ...emptyCut });
  const [cutError, setCutError] = useState("");

  const objects: any[] = ref?.objects ?? [];
  const employees: any[] = ref?.employees ?? [];
  const equipment: any[] = ref?.equipment ?? [];
  const cutTypes: string[] = ref?.cutTypes ?? ["продольная", "поперечная"];
  const logStatuses: string[] = ref?.coreLogStatuses ?? ["описано", "требует уточнения"];
  const cutStatuses: string[] = ref?.cutStatuses ?? ["распилено", "требует повтора"];
  const cutReasons: string[] = ref?.cutRejectReasons ?? [];

  const core = analytics?.core;
  const th = analytics?.thresholds ?? {};
  const nameOf = (arr: any[], id: number) => arr.find((x) => x.id === id)?.name ?? "—";
  const fioOf = (id: number) => employees.find((e) => e.id === id)?.fio ?? "—";

  const byHole: any[] = core?.byHole ?? [];
  const holes = useMemo(() => byHole.map((h) => h.hole), [byHole]);
  const currentHole = hole && holes.includes(hole) ? hole : (core?.worstHole?.hole ?? holes[0] ?? "");
  const row = byHole.find((h) => h.hole === currentHole);
  const series: any[] = core?.holeSeries?.[currentHole] ?? [];

  const geologists: any[] = employees.filter((e) => /геолог/i.test(e.position ?? ""));
  const cutMachines: any[] = equipment.filter((e) => /камнерез/i.test(e.kind ?? "") || /камнерез/i.test(e.name ?? ""));

  const coreFlags: any[] = useMemo(
    () =>
      (analytics?.flags ?? []).filter((f: any) =>
        /(описани|распиловк|выход керна|выработка геолога|керн)/i.test(f.title ?? ""),
      ),
    [analytics?.flags],
  );

  const logRows = useMemo(() => {
    const list = [...(logs.data ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));
    return list.filter(
      (r) =>
        (lObject === "all" || r.objectId === Number(lObject)) &&
        (lHole === "all" || r.holeName === lHole) &&
        (lGeologist === "all" || r.geologistId === Number(lGeologist)) &&
        (lStatus === "all" || r.status === lStatus),
    );
  }, [logs.data, lObject, lHole, lGeologist, lStatus]);

  const cutRows = useMemo(() => {
    const list = [...(cuts.data ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));
    return list.filter(
      (r) =>
        (cObject === "all" || r.objectId === Number(cObject)) &&
        (cHole === "all" || r.holeName === cHole) &&
        (cStatus === "all" || r.status === cStatus),
    );
  }, [cuts.data, cObject, cHole, cStatus]);

  const logHoles = useMemo(
    () => [...new Set((logs.data ?? []).map((r: any) => r.holeName).filter(Boolean))].sort() as string[],
    [logs.data],
  );
  const cutHoles = useMemo(
    () => [...new Set((cuts.data ?? []).map((r: any) => r.holeName).filter(Boolean))].sort() as string[],
    [cuts.data],
  );

  const createLog = useMutation({
    mutationFn: async () => {
      const body = {
        date: logForm.date,
        objectId: Number(logForm.objectId || 0),
        holeName: logForm.holeName.trim(),
        fromDepth: Number(logForm.fromDepth || 0),
        toDepth: Number(logForm.toDepth || 0),
        geologistId: Number(logForm.geologistId || 0),
        recoveryPct: Number(logForm.recoveryPct || 0),
        lithology: logForm.lithology,
        mineralization: Number(logForm.mineralization || 0),
        mineralizationNote: logForm.mineralizationNote,
        photo: Number(logForm.photo || 0),
        status: logForm.status,
      };
      return (await apiRequest("POST", "/api/corelogs", body)).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setLogOpen(false);
      setLogForm({ ...emptyLog });
      toast({ title: "Интервал описания внесён", description: "Отставание по скважине пересчитано." });
    },
    onError: (e: any) => setLogError(String(e.message).replace(/^\d+:\s*/, "")),
  });

  const createCut = useMutation({
    mutationFn: async () => {
      const body = {
        date: cutForm.date,
        objectId: Number(cutForm.objectId || 0),
        holeName: cutForm.holeName.trim(),
        fromDepth: Number(cutForm.fromDepth || 0),
        toDepth: Number(cutForm.toDepth || 0),
        worker: cutForm.worker,
        shift: cutForm.shift,
        cutType: cutForm.cutType,
        equipmentId: Number(cutForm.equipmentId || 0),
        rejectMeters: Number(cutForm.rejectMeters || 0),
        rejectReason: cutForm.rejectReason,
        status: cutForm.status,
      };
      return (await apiRequest("POST", "/api/corecuts", body)).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setCutOpen(false);
      setCutForm({ ...emptyCut });
      toast({ title: "Распиловка внесена", description: "Показатели раздела пересчитаны." });
    },
    onError: (e: any) => setCutError(String(e.message).replace(/^\d+:\s*/, "")),
  });

  const removeLog = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/corelogs/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Запись описания удалена" });
    },
  });

  const removeCut = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/corecuts/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Запись распиловки удалена" });
    },
  });

  const openLog = () => {
    setLogForm({
      ...emptyLog,
      objectId: objects[0] ? String(objects[0].id) : "",
      holeName: currentHole || "",
      geologistId: geologists[0] ? String(geologists[0].id) : "",
    });
    setLogError("");
    setLogOpen(true);
  };

  const openCut = () => {
    setCutForm({
      ...emptyCut,
      objectId: objects[0] ? String(objects[0].id) : "",
      holeName: currentHole || "",
      worker: employees[0]?.fio ?? "",
      equipmentId: cutMachines[0] ? String(cutMachines[0].id) : "",
    });
    setCutError("");
    setCutOpen(true);
  };

  if (isLoading) return <Loading rows={5} />;
  if (error || !analytics) return <ErrorBox text="Не удалось загрузить данные. Обновите страницу." />;

  const s = core?.summary;
  const noCore = !s || (s.drilled === 0 && s.described === 0 && s.cut === 0);

  const header = (
    <PageHeader
      title="Керн и распиловка"
      subtitle="Бурение → описание геологом → распиловка → опробование. Раздел показывает, где разрыв и сколько дней нужно, чтобы догнать."
      actions={
        <>
          {tab === "logs" && (
            <Button size="sm" onClick={openLog} data-testid="button-add-corelog">
              <Plus className="mr-2 h-4 w-4" />
              Внести описание
            </Button>
          )}
          {tab === "cuts" && (
            <Button size="sm" onClick={openCut} data-testid="button-add-corecut">
              <Plus className="mr-2 h-4 w-4" />
              Внести распиловку
            </Button>
          )}
          <ExportButton
            label="Скачать Excel"
            testId="button-export-core"
            onClick={() => downloadFile("/api/export/core", "Керн и распиловка.xlsx")}
          />
        </>
      }
    />
  );

  const tabs = (
    <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {TABS.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            data-testid={`tab-core-${t.key}`}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm",
              tab === t.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {t.label}
          </button>
        );
      })}
    </div>
  );

  if (noCore) {
    return (
      <>
        {header}
        {tabs}
        <Empty text="Нет данных по керну. Внесите описание и распиловку вручную или загрузите их из Excel на экране «Импорт данных»." />
      </>
    );
  }

  const descLvl = lagLevel(s.lagDescM, s.lagDescDays, th.coreLagMeters ?? 250, th.coreLagDays ?? 5);
  const cutLvl = lagLevel(s.lagCutM, s.lagCutDays, th.cutLagMeters ?? 350, th.cutLagDays ?? 6);

  /** Каскад по выбранной скважине: 4 полосы от пробуренного метража */
  const cascade = row
    ? [
        { name: "Пробурено", value: row.drilled, color: CHART_COLORS[0] },
        { name: "Описано", value: row.described, color: CHART_COLORS[1] },
        { name: "Распилено", value: row.cut, color: CHART_COLORS[2] },
        { name: "Опробовано", value: row.sampled, color: CHART_COLORS[3] },
      ]
    : [];
  const cascadeMax = Math.max(1, ...cascade.map((c) => c.value));

  return (
    <>
      {header}
      {tabs}

      {tab === "lag" && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              testId="kpi-core-drilled"
              label="Пробурено всего"
              value={`${nf(s.drilled)} м`}
              hint={`Опробовано ${nf(s.sampled)} м`}
            />
            <Kpi
              testId="kpi-core-described"
              label="Описано геологами"
              value={`${nf(s.described)} м`}
              hint={`${nf(s.describedPct, 1)} % от пробуренного`}
              level={s.describedPct >= 90 ? "ok" : s.describedPct >= 75 ? "warn" : "bad"}
            />
            <Kpi
              testId="kpi-core-lag-desc"
              label="Отставание описания"
              value={`${nf(s.lagDescM)} м`}
              hint={`${nf(s.lagDescPct, 1)} % · это ${nf(s.lagDescDays, 1)} дн. работы геолога`}
              level={descLvl}
            />
            <Kpi
              testId="kpi-core-lag-cut"
              label="Отставание распиловки"
              value={`${nf(s.lagCutM)} м`}
              hint={`Распилено ${nf(s.cutPct, 1)} % · это ${nf(s.lagCutDays, 1)} дн. работы`}
              level={cutLvl}
            />
            <Kpi
              testId="kpi-core-lograte"
              label="Темп описания"
              value={`${nf(s.logRate, 1)} м/день`}
              hint={`Норматив на геолога ${nf(th.geologistNormMpd ?? 45)} м/день`}
            />
            <Kpi
              testId="kpi-core-cutrate"
              label="Темп распиловки"
              value={`${nf(core.cutting.perShift, 1)} м/смена`}
              hint={`${nf(core.cutting.perDay, 1)} м/день · брак ${nf(core.cutting.rejectPct, 1)} %`}
              level={core.cutting.rejectPct <= (th.cutRejectPct ?? 3) ? "ok" : "bad"}
            />
            <Kpi
              testId="kpi-core-recovery"
              label="Средний выход керна"
              value={`${nf(core.logging.avgRecovery, 1)} %`}
              hint={`Норма ${nf(th.coreRecoveryMin ?? 90)} %`}
              level={core.logging.avgRecovery >= (th.coreRecoveryMin ?? 90) ? "ok" : "bad"}
            />
            <Kpi
              testId="kpi-core-worst"
              label="Худшая скважина"
              value={core.worstHole?.hole ?? "—"}
              hint={
                core.worstHole
                  ? `${nf(core.worstHole.lagDescM)} м (${nf(core.worstHole.lagDescPct, 0)} %), тренд: ${core.worstHole.trend}`
                  : "Отставаний нет"
              }
              level={core.worstHole ? "bad" : "ok"}
            />
          </div>

          <Section
            className="mb-4"
            title="Каскад по скважине"
            description="Пробурено → описано → распилено → опробовано. Сразу видно, где разрыв."
            actions={
              <Select value={currentHole} onValueChange={setHole}>
                <SelectTrigger className="w-[190px]" data-testid="select-core-hole">
                  <SelectValue placeholder="Скважина" />
                </SelectTrigger>
                <SelectContent>
                  {holes.map((h) => (
                    <SelectItem key={h} value={h}>{h}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          >
            {!row ? (
              <Empty text="Выберите скважину." />
            ) : (
              <>
                <div className="space-y-3" data-testid="chart-core-cascade">
                  {cascade.map((c) => (
                    <div key={c.name}>
                      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                        <span className="font-medium">{c.name}</span>
                        <span className="num text-muted-foreground">
                          {nf(c.value, 1)} м · {nf((c.value / cascadeMax) * 100, 0)} % от проходки
                        </span>
                      </div>
                      <div className="h-5 w-full overflow-hidden rounded bg-muted">
                        <div
                          className="h-full rounded"
                          style={{
                            width: `${Math.max(1, (c.value / cascadeMax) * 100)}%`,
                            background: c.color,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-md border p-2.5" data-testid="text-core-lagdesc">
                    <div className="text-muted-foreground">Описание от бурения</div>
                    <div className={cn("num mt-0.5 font-semibold", levelText[lagLevel(row.lagDescM, row.lagDescDays, th.coreLagMeters ?? 250, th.coreLagDays ?? 5)])}>
                      {nf(row.lagDescM, 1)} м · {nf(row.lagDescPct, 0)} % · {nf(row.lagDescDays, 1)} дн.
                    </div>
                  </div>
                  <div className="rounded-md border p-2.5" data-testid="text-core-lagcut">
                    <div className="text-muted-foreground">Распиловка от бурения</div>
                    <div className={cn("num mt-0.5 font-semibold", levelText[lagLevel(row.lagCutM, row.lagCutDays, th.cutLagMeters ?? 350, th.cutLagDays ?? 6)])}>
                      {nf(row.lagCutM, 1)} м · {nf(row.lagCutPct, 0)} % · {nf(row.lagCutDays, 1)} дн.
                    </div>
                  </div>
                  <div className="rounded-md border p-2.5" data-testid="text-core-lagcutdesc">
                    <div className="text-muted-foreground">Распиловка от описания</div>
                    <div className="num mt-0.5 font-semibold">
                      {nf(row.lagCutFromDescM, 1)} м · {nf(row.lagCutFromDescPct, 0)} %
                    </div>
                  </div>
                  <div className="rounded-md border p-2.5" data-testid="text-core-trend">
                    <div className="text-muted-foreground">Тренд отставания</div>
                    <div className="mt-0.5 font-semibold">
                      <Trend trend={row.trend} delta={row.weekDelta} />
                    </div>
                    {row.growDays > 0 && (
                      <div className="mt-0.5 text-muted-foreground">растёт {nf(row.growDays)} дн. подряд</div>
                    )}
                  </div>
                </div>
              </>
            )}
          </Section>

          <Section
            className="mb-4"
            title={`Динамика: пробурено против описано — ${currentHole}`}
            description="Накопительные кривые по дням. Если линии расходятся — геолог не догоняет бурение."
          >
            {series.length === 0 ? (
              <Empty text="По этой скважине нет данных по дням." />
            ) : (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 5, right: 8, left: -14, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={axis} interval="preserveStartEnd" minTickGap={26} />
                    <YAxis tick={axis} width={50} />
                    <Tooltip {...tip} formatter={(v: any, n: any) => [`${nf(Number(v), 1)} м`, n]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line isAnimationActive={false} type="monotone" dataKey="пробурено" stroke={CHART_COLORS[0]} dot={false} strokeWidth={2} />
                    <Line isAnimationActive={false} type="monotone" dataKey="описано" stroke={CHART_COLORS[1]} dot={false} strokeWidth={2} />
                    <Line isAnimationActive={false} type="monotone" dataKey="распилено" stroke={CHART_COLORS[2]} strokeDasharray="5 4" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Section>

          <Section
            className="mb-4"
            title="Скважины: отставание описания и распиловки"
            description="Цветом отмечены скважины, где отставание превышает пороги из настроек"
          >
            <TableWrap maxH="60vh">
              <table className="w-full min-w-[1080px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3">Скважина</th>
                    <th className="py-2 pr-3">Объект</th>
                    <th className="py-2 pr-3 text-right">Пробурено</th>
                    <th className="py-2 pr-3 text-right">Описано</th>
                    <th className="py-2 pr-3 text-right">Распилено</th>
                    <th className="py-2 pr-3 text-right">Опробовано</th>
                    <th className="py-2 pr-3 text-right">Отст. описания</th>
                    <th className="py-2 pr-3 text-right">Отст. распиловки</th>
                    <th className="py-2 pr-3 text-right">Выход керна</th>
                    <th className="py-2 pr-3">Тренд</th>
                  </tr>
                </thead>
                <tbody>
                  {byHole.map((h) => {
                    const dl = lagLevel(h.lagDescM, h.lagDescDays, th.coreLagMeters ?? 250, th.coreLagDays ?? 5);
                    const cl = lagLevel(h.lagCutM, h.lagCutDays, th.cutLagMeters ?? 350, th.cutLagDays ?? 6);
                    return (
                      <tr
                        key={h.hole}
                        className={cn(
                          "border-b last:border-0",
                          dl === "bad" && "bg-red-50 dark:bg-red-950/30",
                          dl === "warn" && "bg-amber-50 dark:bg-amber-950/20",
                        )}
                        data-testid={`row-core-hole-${h.hole}`}
                      >
                        <td className="py-2 pr-3 font-medium">
                          <button
                            className="underline-offset-4 hover:underline"
                            onClick={() => setHole(h.hole)}
                            data-testid={`button-core-hole-${h.hole}`}
                          >
                            {h.hole}
                          </button>
                          {h.active && (
                            <Badge variant="outline" className="ml-2 border text-[10px]">бурится</Badge>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">{h.object}</td>
                        <td className="num py-2 pr-3 text-right">{nf(h.drilled, 1)}</td>
                        <td className="num py-2 pr-3 text-right">{nf(h.described, 1)}</td>
                        <td className="num py-2 pr-3 text-right">{nf(h.cut, 1)}</td>
                        <td className="num py-2 pr-3 text-right">{nf(h.sampled, 1)}</td>
                        <td className={cn("num py-2 pr-3 text-right font-medium", levelText[dl])}>
                          {nf(h.lagDescM, 1)} м / {nf(h.lagDescPct, 0)} % / {nf(h.lagDescDays, 1)} дн.
                        </td>
                        <td className={cn("num py-2 pr-3 text-right font-medium", levelText[cl])}>
                          {nf(h.lagCutM, 1)} м / {nf(h.lagCutPct, 0)} % / {nf(h.lagCutDays, 1)} дн.
                        </td>
                        <td className={cn("num py-2 pr-3 text-right", h.recoveryOk ? "" : levelText.bad)}>
                          {nf(h.avgRecovery, 1)} %
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          <Trend trend={h.trend} delta={h.weekDelta} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Объекты: пробурено, описано, распилено" description="Метры за весь период, м">
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={core.byObject} margin={{ top: 5, right: 8, left: -14, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="object" tick={axis} tickFormatter={(v: string) => v.replace("Участок ", "")} />
                    <YAxis tick={axis} width={52} />
                    <Tooltip {...tip} formatter={(v: any, n: any) => [`${nf(Number(v))} м`, n]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar isAnimationActive={false} dataKey="drilled" name="пробурено" fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
                    <Bar isAnimationActive={false} dataKey="described" name="описано" fill={CHART_COLORS[1]} radius={[3, 3, 0, 0]} />
                    <Bar isAnimationActive={false} dataKey="cut" name="распилено" fill={CHART_COLORS[2]} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <TableWrap maxH="40vh">
                <table className="mt-3 w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3">Объект</th>
                      <th className="py-2 pr-3 text-right">Скв.</th>
                      <th className="py-2 pr-3 text-right">Отст. описания</th>
                      <th className="py-2 pr-3 text-right">Дней работы</th>
                      <th className="py-2 pr-3 text-right">Выход керна</th>
                    </tr>
                  </thead>
                  <tbody>
                    {core.byObject.map((o: any) => (
                      <tr key={o.object} className="border-b last:border-0" data-testid={`row-core-object-${o.object}`}>
                        <td className="py-2 pr-3">{o.object}</td>
                        <td className="num py-2 pr-3 text-right">{nf(o.holes)}</td>
                        <td className="num py-2 pr-3 text-right">{nf(o.lagDescM)} м / {nf(o.lagDescPct, 0)} %</td>
                        <td className="num py-2 pr-3 text-right">{nf(o.lagDescDays, 1)}</td>
                        <td className="num py-2 pr-3 text-right">{nf(o.avgRecovery, 1)} %</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </Section>

            <Section title="Что делать" description="Автоматические предупреждения раздела с рекомендациями">
              {coreFlags.length === 0 ? (
                <Empty text="Отставаний выше порогов нет — описание и распиловка идут в темпе бурения." />
              ) : (
                <div className="space-y-2">
                  {coreFlags.slice(0, 12).map((f: any, i: number) => (
                    <div key={i} className="rounded-md border p-3" data-testid={`core-flag-${i}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn("border text-[11px]", levelBadge[f.level === "критично" ? "bad" : "warn"])}
                        >
                          {f.level === "критично" && <AlertTriangle className="mr-1 h-3 w-3" />}
                          {f.level}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{f.object}</span>
                      </div>
                      <div className="mt-1.5 text-sm font-medium">{f.title}</div>
                      <div className="num text-sm">{f.value}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{f.advice}</div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        </>
      )}

      {tab === "logs" && (
        <>
          <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Объект</div>
              <Select value={lObject} onValueChange={setLObject}>
                <SelectTrigger data-testid="select-log-object"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все объекты</SelectItem>
                  {objects.map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Скважина</div>
              <Select value={lHole} onValueChange={setLHole}>
                <SelectTrigger data-testid="select-log-hole"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все скважины</SelectItem>
                  {logHoles.map((h) => (
                    <SelectItem key={h} value={h}>{h}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Геолог</div>
              <Select value={lGeologist} onValueChange={setLGeologist}>
                <SelectTrigger data-testid="select-log-geologist"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все геологи</SelectItem>
                  {geologists.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>{e.fio}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Статус</div>
              <Select value={lStatus} onValueChange={setLStatus}>
                <SelectTrigger data-testid="select-log-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все статусы</SelectItem>
                  {logStatuses.map((s2) => (
                    <SelectItem key={s2} value={s2}>{s2}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Card>

          <Section
            title="Журнал описания керна"
            description={`Записей: ${nf(logRows.length)} · описано ${nf(core.logging.meters)} м, фотодокументация ${nf(core.logging.photoPct, 1)} %, требуют уточнения ${nf(core.logging.needsReview)}`}
          >
            {logRows.length === 0 ? (
              <Empty text="Нет записей по выбранным фильтрам. Внесите описание или загрузите его из Excel." />
            ) : (
              <TableWrap maxH="62vh">
                <table className="w-full min-w-[1040px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3">Дата</th>
                      <th className="py-2 pr-3">Объект</th>
                      <th className="py-2 pr-3">Скважина</th>
                      <th className="py-2 pr-3 text-right">Интервал, м</th>
                      <th className="py-2 pr-3 text-right">Метраж</th>
                      <th className="py-2 pr-3">Геолог</th>
                      <th className="py-2 pr-3 text-right">Выход, %</th>
                      <th className="py-2 pr-3">Литология</th>
                      <th className="py-2 pr-3">Минерал.</th>
                      <th className="py-2 pr-3">Фото</th>
                      <th className="py-2 pr-3">Статус</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {logRows.slice(0, 300).map((r) => {
                      const low = r.recoveryPct < (th.coreRecoveryMin ?? 90);
                      return (
                        <tr key={r.id} className="border-b last:border-0" data-testid={`row-corelog-${r.id}`}>
                          <td className="num py-2 pr-3">{ruDate(r.date)}</td>
                          <td className="py-2 pr-3 text-xs text-muted-foreground">{nameOf(objects, r.objectId)}</td>
                          <td className="py-2 pr-3">{r.holeName}</td>
                          <td className="num py-2 pr-3 text-right">{nf(r.fromDepth, 1)}–{nf(r.toDepth, 1)}</td>
                          <td className="num py-2 pr-3 text-right">{nf(r.toDepth - r.fromDepth, 1)}</td>
                          <td className="py-2 pr-3">{fioOf(r.geologistId)}</td>
                          <td className={cn("num py-2 pr-3 text-right", low && levelText.bad)}>{nf(r.recoveryPct, 1)}</td>
                          <td className="max-w-[220px] truncate py-2 pr-3 text-xs text-muted-foreground">{r.lithology}</td>
                          <td className="py-2 pr-3 text-xs">
                            {r.mineralization ? (
                              <Badge variant="outline" className={cn("border text-[10px]", levelBadge.warn)}>да</Badge>
                            ) : "нет"}
                          </td>
                          <td className="py-2 pr-3 text-xs">{r.photo ? "да" : "нет"}</td>
                          <td className="py-2 pr-3 text-xs">
                            <Badge variant="outline" className={cn("border text-[10px]", r.status === "описано" ? levelBadge.ok : levelBadge.warn)}>
                              {r.status}
                            </Badge>
                          </td>
                          <td className="py-2 text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeLog.mutate(r.id)}
                              data-testid={`button-delete-corelog-${r.id}`}
                              aria-label="Удалить запись"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Section>
        </>
      )}

      {tab === "cuts" && (
        <>
          <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Объект</div>
              <Select value={cObject} onValueChange={setCObject}>
                <SelectTrigger data-testid="select-cut-object"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все объекты</SelectItem>
                  {objects.map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Скважина</div>
              <Select value={cHole} onValueChange={setCHole}>
                <SelectTrigger data-testid="select-cut-hole"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все скважины</SelectItem>
                  {cutHoles.map((h) => (
                    <SelectItem key={h} value={h}>{h}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Статус</div>
              <Select value={cStatus} onValueChange={setCStatus}>
                <SelectTrigger data-testid="select-cut-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все статусы</SelectItem>
                  {cutStatuses.map((s2) => (
                    <SelectItem key={s2} value={s2}>{s2}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setCObject("all"); setCHole("all"); setCStatus("all"); }}
                data-testid="button-reset-cut-filters"
              >
                Сбросить фильтры
              </Button>
            </div>
          </Card>

          <Section
            title="Журнал распиловки керна"
            description={`Записей: ${nf(cutRows.length)} · распилено ${nf(core.cutting.meters)} м, брак ${nf(core.cutting.rejectMeters, 1)} м (${nf(core.cutting.rejectPct, 1)} %), требуют повтора ${nf(core.cutting.repeat)}`}
          >
            {cutRows.length === 0 ? (
              <Empty text="Нет записей по выбранным фильтрам. Внесите распиловку или загрузите её из Excel." />
            ) : (
              <TableWrap maxH="62vh">
                <table className="w-full min-w-[1020px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3">Дата</th>
                      <th className="py-2 pr-3">Объект</th>
                      <th className="py-2 pr-3">Скважина</th>
                      <th className="py-2 pr-3 text-right">Интервал, м</th>
                      <th className="py-2 pr-3 text-right">Метраж</th>
                      <th className="py-2 pr-3">Исполнитель</th>
                      <th className="py-2 pr-3">Смена</th>
                      <th className="py-2 pr-3">Тип</th>
                      <th className="py-2 pr-3">Станок</th>
                      <th className="py-2 pr-3 text-right">Брак, м</th>
                      <th className="py-2 pr-3">Статус</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {cutRows.slice(0, 300).map((r) => (
                      <tr key={r.id} className="border-b last:border-0" data-testid={`row-corecut-${r.id}`}>
                        <td className="num py-2 pr-3">{ruDate(r.date)}</td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">{nameOf(objects, r.objectId)}</td>
                        <td className="py-2 pr-3">{r.holeName}</td>
                        <td className="num py-2 pr-3 text-right">{nf(r.fromDepth, 1)}–{nf(r.toDepth, 1)}</td>
                        <td className="num py-2 pr-3 text-right">{nf(r.toDepth - r.fromDepth, 1)}</td>
                        <td className="py-2 pr-3">{r.worker || "—"}</td>
                        <td className="py-2 pr-3 text-xs">{r.shift}</td>
                        <td className="py-2 pr-3 text-xs">{r.cutType}</td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">{nameOf(equipment, r.equipmentId)}</td>
                        <td className={cn("num py-2 pr-3 text-right", r.rejectMeters > 0 && levelText.warn)}>
                          {nf(r.rejectMeters, 1)}
                          {r.rejectReason ? <span className="block text-[10px] text-muted-foreground">{r.rejectReason}</span> : null}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          <Badge variant="outline" className={cn("border text-[10px]", r.status === "распилено" ? levelBadge.ok : levelBadge.warn)}>
                            {r.status}
                          </Badge>
                        </td>
                        <td className="py-2 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeCut.mutate(r.id)}
                            data-testid={`button-delete-corecut-${r.id}`}
                            aria-label="Удалить запись"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Section>
        </>
      )}

      {tab === "perf" && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi testId="kpi-perf-logweek" label="Описано за неделю" value={`${nf(core.logging.weekMeters)} м`} hint={`За месяц ${nf(core.logging.monthMeters)} м`} />
            <Kpi testId="kpi-perf-cutweek" label="Распилено за неделю" value={`${nf(core.cutting.weekMeters)} м`} hint={`За месяц ${nf(core.cutting.monthMeters)} м`} />
            <Kpi
              testId="kpi-perf-pershift"
              label="Производительность распиловки"
              value={`${nf(core.cutting.perShift, 1)} м/смена`}
              hint={`${nf(core.cutting.perDay, 1)} м/день · смен ${nf(core.cutting.shifts)}`}
            />
            <Kpi
              testId="kpi-perf-reject"
              label="Брак распиловки"
              value={`${nf(core.cutting.rejectPct, 1)} %`}
              hint={`Порог ${nf(th.cutRejectPct ?? 3)} % · ${nf(core.cutting.rejectMeters, 1)} м`}
              level={core.cutting.rejectPct <= (th.cutRejectPct ?? 3) ? "ok" : "bad"}
            />
          </div>

          <Section className="mb-4" title="Производительность геологов" description={`Метры описания в день. Норматив ${nf(th.geologistNormMpd ?? 45)} м/день`}>
            {core.geologists.length === 0 ? (
              <Empty text="Нет данных по геологам." />
            ) : (
              <>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={core.geologists} margin={{ top: 5, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={axis} />
                      <YAxis tick={axis} width={44} />
                      <Tooltip {...tip} formatter={(v: any) => [`${nf(Number(v), 1)} м/день`, "Выработка"]} />
                      <ReferenceLine
                        y={th.geologistNormMpd ?? 45}
                        stroke={CHART_COLORS[3]}
                        strokeDasharray="5 4"
                        label={{ value: "норматив", fontSize: 11, fill: "hsl(var(--muted-foreground))", position: "insideTopRight" }}
                      />
                      <Bar isAnimationActive={false} dataKey="perDay" name="м/день" fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <TableWrap maxH="45vh">
                  <table className="mt-3 w-full min-w-[840px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3">Геолог</th>
                        <th className="py-2 pr-3">Объект</th>
                        <th className="py-2 pr-3 text-right">Всего, м</th>
                        <th className="py-2 pr-3 text-right">За месяц</th>
                        <th className="py-2 pr-3 text-right">За неделю</th>
                        <th className="py-2 pr-3 text-right">м/день</th>
                        <th className="py-2 pr-3 text-right">Интервалов</th>
                        <th className="py-2 pr-3 text-right">Фото, %</th>
                        <th className="py-2 pr-3 text-right">Выход керна</th>
                      </tr>
                    </thead>
                    <tbody>
                      {core.geologists.map((g: any) => (
                        <tr
                          key={g.id}
                          className={cn("border-b last:border-0", !g.normOk && "bg-amber-50 dark:bg-amber-950/20")}
                          data-testid={`row-geologist-${g.id}`}
                        >
                          <td className="py-2 pr-3 font-medium">{g.name}</td>
                          <td className="py-2 pr-3 text-xs text-muted-foreground">{g.object}</td>
                          <td className="num py-2 pr-3 text-right">{nf(g.meters)}</td>
                          <td className="num py-2 pr-3 text-right">{nf(g.monthMeters)}</td>
                          <td className="num py-2 pr-3 text-right">{nf(g.weekMeters)}</td>
                          <td className={cn("num py-2 pr-3 text-right font-medium", g.normOk ? levelText.ok : levelText.warn)}>
                            {nf(g.perDay, 1)}
                          </td>
                          <td className="num py-2 pr-3 text-right">{nf(g.intervals)}</td>
                          <td className="num py-2 pr-3 text-right">{nf(g.photoPct, 1)}</td>
                          <td className="num py-2 pr-3 text-right">{nf(g.avgRecovery, 1)} %</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              </>
            )}
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Распиловка по станкам" description="Метры и брак по камнерезному оборудованию">
              {core.cutting.byMachine.length === 0 ? (
                <Empty text="Нет данных по распиловке." />
              ) : (
                <TableWrap maxH="45vh">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3">Станок</th>
                        <th className="py-2 pr-3">Объект</th>
                        <th className="py-2 pr-3 text-right">Смен</th>
                        <th className="py-2 pr-3 text-right">Метры</th>
                        <th className="py-2 pr-3 text-right">м/смена</th>
                        <th className="py-2 pr-3 text-right">Брак, м</th>
                      </tr>
                    </thead>
                    <tbody>
                      {core.cutting.byMachine.map((m: any) => (
                        <tr key={m.name} className="border-b last:border-0" data-testid={`row-machine-${m.name}`}>
                          <td className="py-2 pr-3">{m.name}</td>
                          <td className="py-2 pr-3 text-xs text-muted-foreground">{m.object}</td>
                          <td className="num py-2 pr-3 text-right">{nf(m.shifts)}</td>
                          <td className="num py-2 pr-3 text-right">{nf(m.meters)}</td>
                          <td className="num py-2 pr-3 text-right">{nf(m.shifts ? m.meters / m.shifts : 0, 1)}</td>
                          <td className="num py-2 pr-3 text-right">{nf(m.rejectMeters, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </Section>

            <Section title="Динамика по дням" description="Пробурено, описано, распилено — метры за день">
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={core.charts.coreByDay} margin={{ top: 5, right: 8, left: -14, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={axis} interval="preserveStartEnd" minTickGap={26} />
                    <YAxis tick={axis} width={46} />
                    <Tooltip {...tip} formatter={(v: any, n: any) => [`${nf(Number(v), 1)} м`, n]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line isAnimationActive={false} type="monotone" dataKey="пробурено" stroke={CHART_COLORS[0]} dot={false} strokeWidth={2} />
                    <Line isAnimationActive={false} type="monotone" dataKey="описано" stroke={CHART_COLORS[1]} dot={false} strokeWidth={2} />
                    <Line isAnimationActive={false} type="monotone" dataKey="распилено" stroke={CHART_COLORS[2]} dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Section>
          </div>
        </>
      )}

      {/* Диалог: описание керна */}
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Описание керна: новый интервал</DialogTitle>
            <DialogDescription>
              Метраж считается автоматически как «до» минус «от». Пересечение с уже описанным интервалом программа не пропустит.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Дата</div>
              <Input type="date" value={logForm.date} onChange={(e) => setLogForm({ ...logForm, date: e.target.value })} data-testid="input-log-date" />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Объект</div>
              <Select value={logForm.objectId} onValueChange={(v) => setLogForm({ ...logForm, objectId: v })}>
                <SelectTrigger data-testid="select-log-form-object"><SelectValue placeholder="Выберите объект" /></SelectTrigger>
                <SelectContent>
                  {objects.map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Скважина</div>
              <Input value={logForm.holeName} onChange={(e) => setLogForm({ ...logForm, holeName: e.target.value })} placeholder="СКВ-101" data-testid="input-log-hole" />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Геолог</div>
              <Select value={logForm.geologistId} onValueChange={(v) => setLogForm({ ...logForm, geologistId: v })}>
                <SelectTrigger data-testid="select-log-form-geologist"><SelectValue placeholder="Выберите геолога" /></SelectTrigger>
                <SelectContent>
                  {(geologists.length ? geologists : employees).map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>{e.fio}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Интервал от, м</div>
              <Input inputMode="decimal" value={logForm.fromDepth} onChange={(e) => setLogForm({ ...logForm, fromDepth: e.target.value })} data-testid="input-log-from" />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Интервал до, м</div>
              <Input inputMode="decimal" value={logForm.toDepth} onChange={(e) => setLogForm({ ...logForm, toDepth: e.target.value })} data-testid="input-log-to" />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Выход керна, %</div>
              <Input inputMode="decimal" value={logForm.recoveryPct} onChange={(e) => setLogForm({ ...logForm, recoveryPct: e.target.value })} data-testid="input-log-recovery" />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Статус</div>
              <Select value={logForm.status} onValueChange={(v) => setLogForm({ ...logForm, status: v })}>
                <SelectTrigger data-testid="select-log-form-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {logStatuses.map((s2) => (
                    <SelectItem key={s2} value={s2}>{s2}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <div className="mb-1 text-xs text-muted-foreground">Литология / краткое описание</div>
              <Input value={logForm.lithology} onChange={(e) => setLogForm({ ...logForm, lithology: e.target.value })} placeholder="Кварц-сульфидные прожилки в метасоматитах" data-testid="input-log-lithology" />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Признаки минерализации</div>
              <Select value={logForm.mineralization} onValueChange={(v) => setLogForm({ ...logForm, mineralization: v })}>
                <SelectTrigger data-testid="select-log-min"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">нет</SelectItem>
                  <SelectItem value="1">да</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Фотодокументация</div>
              <Select value={logForm.photo} onValueChange={(v) => setLogForm({ ...logForm, photo: v })}>
                <SelectTrigger data-testid="select-log-photo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">выполнена</SelectItem>
                  <SelectItem value="0">нет</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {logForm.mineralization === "1" && (
              <div className="sm:col-span-2">
                <div className="mb-1 text-xs text-muted-foreground">Примечание по минерализации</div>
                <Input value={logForm.mineralizationNote} onChange={(e) => setLogForm({ ...logForm, mineralizationNote: e.target.value })} data-testid="input-log-minnote" />
              </div>
            )}
            <div className="text-xs text-muted-foreground sm:col-span-2">
              Метраж интервала: {nf(Math.max(0, Number(logForm.toDepth || 0) - Number(logForm.fromDepth || 0)), 1)} м
            </div>
          </div>
          {logError && <ErrorBox text={logError} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogOpen(false)} data-testid="button-log-cancel">Отмена</Button>
            <Button
              onClick={() => { setLogError(""); createLog.mutate(); }}
              disabled={createLog.isPending}
              data-testid="button-log-save"
            >
              {createLog.isPending ? "Сохраняем…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог: распиловка */}
      <Dialog open={cutOpen} onOpenChange={setCutOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Распиловка керна: новая запись</DialogTitle>
            <DialogDescription>Метраж считается автоматически. Пересечения интервалов программа проверяет сама.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Дата</div>
              <Input type="date" value={cutForm.date} onChange={(e) => setCutForm({ ...cutForm, date: e.target.value })} data-testid="input-cut-date" />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Объект</div>
              <Select value={cutForm.objectId} onValueChange={(v) => setCutForm({ ...cutForm, objectId: v })}>
                <SelectTrigger data-testid="select-cut-form-object"><SelectValue placeholder="Выберите объект" /></SelectTrigger>
                <SelectContent>
                  {objects.map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Скважина</div>
              <Input value={cutForm.holeName} onChange={(e) => setCutForm({ ...cutForm, holeName: e.target.value })} placeholder="СКВ-101" data-testid="input-cut-hole" />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Исполнитель</div>
              <Input value={cutForm.worker} onChange={(e) => setCutForm({ ...cutForm, worker: e.target.value })} data-testid="input-cut-worker" />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Интервал от, м</div>
              <Input inputMode="decimal" value={cutForm.fromDepth} onChange={(e) => setCutForm({ ...cutForm, fromDepth: e.target.value })} data-testid="input-cut-from" />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Интервал до, м</div>
              <Input inputMode="decimal" value={cutForm.toDepth} onChange={(e) => setCutForm({ ...cutForm, toDepth: e.target.value })} data-testid="input-cut-to" />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Смена</div>
              <Select value={cutForm.shift} onValueChange={(v) => setCutForm({ ...cutForm, shift: v })}>
                <SelectTrigger data-testid="select-cut-shift"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="день">день</SelectItem>
                  <SelectItem value="ночь">ночь</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Тип распиловки</div>
              <Select value={cutForm.cutType} onValueChange={(v) => setCutForm({ ...cutForm, cutType: v })}>
                <SelectTrigger data-testid="select-cut-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {cutTypes.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Оборудование</div>
              <Select value={cutForm.equipmentId} onValueChange={(v) => setCutForm({ ...cutForm, equipmentId: v })}>
                <SelectTrigger data-testid="select-cut-equipment"><SelectValue placeholder="Камнерезный станок" /></SelectTrigger>
                <SelectContent>
                  {(cutMachines.length ? cutMachines : equipment).map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Статус</div>
              <Select value={cutForm.status} onValueChange={(v) => setCutForm({ ...cutForm, status: v })}>
                <SelectTrigger data-testid="select-cut-form-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {cutStatuses.map((s2) => (
                    <SelectItem key={s2} value={s2}>{s2}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Брак, м</div>
              <Input inputMode="decimal" value={cutForm.rejectMeters} onChange={(e) => setCutForm({ ...cutForm, rejectMeters: e.target.value })} data-testid="input-cut-reject" />
            </div>
            {Number(cutForm.rejectMeters || 0) > 0 && (
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Причина брака</div>
                <Select value={cutForm.rejectReason} onValueChange={(v) => setCutForm({ ...cutForm, rejectReason: v })}>
                  <SelectTrigger data-testid="select-cut-reason"><SelectValue placeholder="Выберите причину" /></SelectTrigger>
                  <SelectContent>
                    {cutReasons.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="text-xs text-muted-foreground sm:col-span-2">
              Метраж интервала: {nf(Math.max(0, Number(cutForm.toDepth || 0) - Number(cutForm.fromDepth || 0)), 1)} м
            </div>
          </div>
          {cutError && <ErrorBox text={cutError} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCutOpen(false)} data-testid="button-cut-cancel">Отмена</Button>
            <Button
              onClick={() => { setCutError(""); createCut.mutate(); }}
              disabled={createCut.isPending}
              data-testid="button-cut-save"
            >
              {createCut.isPending ? "Сохраняем…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
