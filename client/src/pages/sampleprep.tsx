import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Plus, Trash2, ArrowRight, Ban, FlaskConical, Boxes, ClipboardList, ShieldCheck, LineChart as LineIcon, History,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { nf, ruDate, todayIso, downloadFile, money, levelBadge, CHART_COLORS } from "@/lib/app";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

type TabKey = "overview" | "journal" | "batches" | "results" | "qa";

const TABS: { key: TabKey; label: string; icon: any }[] = [
  { key: "overview", label: "Обзор и этапы", icon: LineIcon },
  { key: "journal", label: "Журнал проб", icon: ClipboardList },
  { key: "batches", label: "Партии в лабораторию", icon: Boxes },
  { key: "results", label: "Результаты анализов", icon: FlaskConical },
  { key: "qa", label: "Контроль качества", icon: ShieldCheck },
];

const emptySample = {
  code: "", date: todayIso(), objectId: "", rigId: "", holeName: "",
  fromDepth: "", toDepth: "", sampleType: "керновая", weightKg: "",
  geologistId: "", note: "",
};

/** Префикс номера пробы по объекту: «Северный» → СЕВ */
function objPrefix(name: string) {
  const inner = /«([^»]+)»/.exec(name || "")?.[1] ?? name ?? "";
  return inner.replace(/[^А-Яа-яЁё]/g, "").slice(0, 3).toUpperCase() || "ПРБ";
}

export default function SamplePrep() {
  const { finance } = useAuth();
  const { data: ref } = useReference();
  const { data: analytics, isLoading, error } = useAnalytics();
  const samples = useList<any>("/api/samples");
  const batches = useList<any>("/api/batches");
  const assays = useList<any>("/api/assays");
  const { toast } = useToast();

  const [tab, setTab] = useState<TabKey>("overview");

  // фильтры журнала
  const [period, setPeriod] = useState("60");
  const [fObject, setFObject] = useState("all");
  const [fRig, setFRig] = useState("all");
  const [fHole, setFHole] = useState("all");
  const [fType, setFType] = useState("all");
  const [fStage, setFStage] = useState("all");
  const [fStatus, setFStatus] = useState("all");

  const [selected, setSelected] = useState<number[]>([]);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveStage, setMoveStage] = useState("");
  const [moveDate, setMoveDate] = useState(todayIso());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ ...emptySample });
  const [formError, setFormError] = useState("");
  const [historyFor, setHistoryFor] = useState<any>(null);

  // партии
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchForm, setBatchForm] = useState({
    code: "", labId: "", analysisTypeId: "", sentDate: todayIso(),
    shipMethod: "", waybill: "", note: "",
  });
  const [batchError, setBatchError] = useState("");

  // результаты
  const [rObject, setRObject] = useState("all");
  const [rHole, setRHole] = useState("all");
  const [rElement, setRElement] = useState("all");
  const [rOnlyOre, setROnlyOre] = useState(false);
  const [assayOpen, setAssayOpen] = useState(false);
  const [assayForm, setAssayForm] = useState({
    sampleCode: "", element: "Au", value: "", unit: "г/т", receivedDate: todayIso(),
  });
  const [assayError, setAssayError] = useState("");

  const objects: any[] = ref?.objects ?? [];
  const rigs: any[] = ref?.rigs ?? [];
  const employees: any[] = ref?.employees ?? [];
  const labs: any[] = ref?.labs ?? [];
  const analysisTypes: any[] = ref?.analysisTypes ?? [];
  const stages: string[] = ref?.sampleStages ?? [];
  const sampleTypes: string[] = ref?.sampleTypes ?? [];
  const reasons: string[] = ref?.rejectReasons ?? [];
  const shipMethods: string[] = ref?.shipMethods ?? [];
  const elements: string[] = ref?.elements ?? [];
  const units: string[] = ref?.assayUnits ?? [];

  const prep = analytics?.samplePrep;
  const nameOf = (arr: any[], id: number) => arr.find((x) => x.id === id)?.name ?? "—";
  const fioOf = (id: number) => employees.find((e) => e.id === id)?.fio ?? "—";

  const holeNames = useMemo(
    () => [...new Set((samples.data ?? []).map((s: any) => s.holeName).filter(Boolean))].sort(),
    [samples.data],
  );

  const rows = useMemo(() => {
    const list = [...(samples.data ?? [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
    const limit = period === "all" ? null : new Date(Date.now() - Number(period) * 86400000).toISOString().slice(0, 10);
    return list.filter(
      (s) =>
        (!limit || s.date >= limit) &&
        (fObject === "all" || s.objectId === Number(fObject)) &&
        (fRig === "all" || s.rigId === Number(fRig)) &&
        (fHole === "all" || s.holeName === fHole) &&
        (fType === "all" || s.sampleType === fType) &&
        (fStage === "all" || s.stage === fStage) &&
        (fStatus === "all" || s.status === fStatus),
    );
  }, [samples.data, period, fObject, fRig, fHole, fType, fStage, fStatus]);

  const resultRows = useMemo(() => {
    const list: any[] = prep?.results?.rows ?? [];
    return list.filter(
      (r) =>
        (rObject === "all" || r.object === rObject) &&
        (rHole === "all" || r.hole === rHole) &&
        (rElement === "all" || r.element === rElement) &&
        (!rOnlyOre || r.ore),
    );
  }, [prep, rObject, rHole, rElement, rOnlyOre]);

  const toggle = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allShownIds = rows.slice(0, 400).map((r) => r.id);
  const allChecked = allShownIds.length > 0 && allShownIds.every((id) => selected.includes(id));

  const bulkMove = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/samples/bulk-stage", {
        ids: selected, stage: moveStage, date: moveDate, author: "Пробоподготовка",
      })).json(),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries();
      setMoveOpen(false);
      setSelected([]);
      toast({
        title: `Переведено проб: ${res.moved}`,
        description: res.skipped?.length ? `Пропущено: ${res.skipped.join("; ")}` : "Этапы и сроки пересчитаны.",
      });
    },
    onError: (e: any) => toast({ title: "Не удалось перевести", description: e.message, variant: "destructive" }),
  });

  const bulkReject = useMutation({
    mutationFn: async () => {
      for (const id of selected) {
        await apiRequest("PATCH", `/api/samples/${id}`, {
          status: "брак", rejectReason, stage: "Архив/Брак", stageDate: todayIso(),
        });
      }
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setRejectOpen(false);
      setSelected([]);
      toast({ title: "Отмечен брак", description: "Пробы переведены в архив с указанием причины." });
    },
    onError: (e: any) => toast({ title: "Не удалось отметить брак", description: e.message, variant: "destructive" }),
  });

  const nextStageOf = (stage: string) => {
    const i = stages.indexOf(stage);
    return i >= 0 && i < stages.length - 1 ? stages[i + 1] : "";
  };

  const moveOne = useMutation({
    mutationFn: async (s: any) => {
      const next = nextStageOf(s.stage);
      if (!next) throw new Error("Проба уже на последнем этапе");
      return (await apiRequest("POST", "/api/samples/bulk-stage", {
        ids: [s.id], stage: next, date: todayIso(), author: "Пробоподготовка",
      })).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Проба передана на следующий этап" });
    },
    onError: (e: any) => toast({ title: "Не удалось передать", description: e.message, variant: "destructive" }),
  });

  const removeSample = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/samples/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Проба удалена из журнала" });
    },
  });

  const createSample = useMutation({
    mutationFn: async () => {
      const body = {
        code: form.code.trim(),
        date: form.date,
        objectId: Number(form.objectId),
        rigId: Number(form.rigId || 0),
        holeName: form.holeName.trim(),
        fromDepth: Number(form.fromDepth || 0),
        toDepth: Number(form.toDepth || 0),
        sampleType: form.sampleType,
        weightKg: Number(form.weightKg || 0),
        geologistId: Number(form.geologistId || 0),
        stage: stages[0] ?? "Отобрана",
        stageDate: form.date,
        status: "в работе",
        rejectReason: "",
        batchId: 0,
        note: form.note,
      };
      return (await apiRequest("POST", "/api/samples", body)).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setAddOpen(false);
      setForm({ ...emptySample });
      toast({ title: "Проба заведена", description: "Показатели раздела пересчитаны." });
    },
    onError: (e: any) => setFormError(String(e.message).replace(/^\d+:\s*/, "")),
  });

  const openAdd = () => {
    const obj = objects[0];
    const pref = objPrefix(obj?.name ?? "");
    const nums = (samples.data ?? [])
      .map((s: any) => Number(/(\d+)$/.exec(s.code)?.[1] ?? 0))
      .filter((n: number) => n > 0);
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    setForm({
      ...emptySample,
      objectId: obj ? String(obj.id) : "",
      code: `${pref}-26-${String(next).padStart(3, "0")}`,
      geologistId: employees[0] ? String(employees[0].id) : "",
    });
    setFormError("");
    setAddOpen(true);
  };

  const createBatch = useMutation({
    mutationFn: async () => {
      const body = {
        code: batchForm.code.trim(),
        labId: Number(batchForm.labId),
        analysisTypeId: Number(batchForm.analysisTypeId),
        sentDate: batchForm.sentDate,
        dueDate: "",
        shipMethod: batchForm.shipMethod || shipMethods[0] || "",
        waybill: batchForm.waybill,
        status: "в лаборатории",
        resultDate: "",
        note: batchForm.note,
        sampleIds: selected,
      };
      return (await apiRequest("POST", "/api/batches", body)).json();
    },
    onSuccess: (b: any) => {
      queryClient.invalidateQueries();
      setBatchOpen(false);
      setSelected([]);
      toast({
        title: `Партия ${b.code} сформирована`,
        description: `Проб: ${nf(b.samples ?? 0)}, ожидаемая дата результата ${ruDate(b.dueDate)}.`,
      });
    },
    onError: (e: any) => setBatchError(String(e.message).replace(/^\d+:\s*/, "")),
  });

  const openBatch = () => {
    const n = (batches.data ?? []).length + 2601;
    setBatchForm({
      code: `П-${n}`,
      labId: labs[0] ? String(labs[0].id) : "",
      analysisTypeId: analysisTypes[0] ? String(analysisTypes[0].id) : "",
      sentDate: todayIso(),
      shipMethod: shipMethods[0] ?? "",
      waybill: "",
      note: "",
    });
    setBatchError("");
    setBatchOpen(true);
  };

  const removeBatch = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/batches/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Партия удалена" });
    },
  });

  const createAssay = useMutation({
    mutationFn: async () => {
      const s = (samples.data ?? []).find(
        (x: any) => x.code.toLowerCase() === assayForm.sampleCode.trim().toLowerCase(),
      );
      if (!s) throw new Error("Проба с таким номером не найдена в журнале");
      const body = {
        sampleId: s.id,
        element: assayForm.element,
        value: Number(assayForm.value || 0),
        unit: assayForm.unit,
        receivedDate: assayForm.receivedDate,
      };
      return (await apiRequest("POST", "/api/assays", body)).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setAssayOpen(false);
      toast({ title: "Результат внесён", description: "Проба переведена на этап «Результат получен»." });
    },
    onError: (e: any) => setAssayError(String(e.message).replace(/^\d+:\s*/, "")),
  });

  const removeAssay = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/assays/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Результат удалён" });
    },
  });

  const moves = useList<any>(historyFor ? `/api/samples/${historyFor.id}/moves` : "/api/samples");

  if (isLoading) return <Loading rows={5} />;
  if (error) return <ErrorBox text="Не удалось загрузить показатели раздела. Обновите страницу." />;

  const noSamples = (samples.data ?? []).length === 0;

  return (
    <>
      <PageHeader
        title="Пробоподготовка"
        subtitle="Где сейчас каждая проба, копится ли затор между бурением и результатом, укладываются ли лаборатории в срок."
        actions={
          <>
            <ExportButton
              testId="button-export-sampleprep"
              onClick={() => downloadFile("/api/export/sampleprep", "Пробоподготовка.xlsx")}
            />
            <Button size="sm" onClick={openAdd} data-testid="button-add-sample">
              <Plus className="mr-2 h-4 w-4" />
              Завести пробу
            </Button>
          </>
        }
      />

      {/* Вкладки раздела */}
      <div className="mb-4 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              data-testid={`tab-prep-${t.key}`}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors sm:text-sm",
                tab === t.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-accent",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="whitespace-nowrap">{t.label}</span>
            </button>
          );
        })}
      </div>

      {noSamples ? (
        <Section title="Раздел пока пуст" description="Пробы ещё не заведены.">
          <Empty text="Нет ни одной пробы. Заведите пробу вручную или загрузите журнал проб через «Импорт данных» — после этого появятся этапы, партии, результаты и контроль качества." />
        </Section>
      ) : tab === "overview" ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              testId="kpi-prep-samples"
              label="Проб всего"
              value={nf(prep.totals.samples)}
              hint={`За неделю ${nf(prep.totals.perPeriod.week)} (${prep.totals.weekDeltaPct >= 0 ? "+" : ""}${nf(prep.totals.weekDeltaPct, 1)} % к прошлой)`}
            />
            <Kpi
              testId="kpi-prep-inwork"
              label="В работе"
              value={nf(prep.totals.inWork)}
              hint={`Результаты получены: ${nf(prep.totals.done)}`}
            />
            <Kpi
              testId="kpi-prep-cycle"
              label="Цикл отбор → результат"
              value={`${nf(prep.cycle.total, 1)} дн.`}
              hint={`Подготовка ${nf(prep.cycle.prep, 1)} + лаборатория ${nf(prep.cycle.lab, 1)}`}
              level={prep.cycle.total > 25 ? "bad" : prep.cycle.total > 18 ? "warn" : "ok"}
            />
            {finance && <Kpi
              testId="kpi-prep-cost"
              label="Затраты на анализы"
              value={money(prep.totals.analysisCost)}
              hint={`${nf(prep.totals.costPerMeter, 1)} ₽ на метр проходки`}
            />}
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              testId="kpi-prep-reject"
              label="Доля брака проб"
              value={`${nf(prep.totals.rejectPct, 1)} %`}
              hint={`Забраковано: ${nf(prep.totals.rejected)}`}
              level={prep.totals.rejectPct > (analytics.thresholds.rejectSharePct ?? 3) ? "bad" : "ok"}
            />
            <Kpi
              testId="kpi-prep-density"
              label="Плотность опробования"
              value={`${nf(prep.totals.samplesPerMeter, 2)} проб/м`}
              hint={`Норматив ${nf(analytics.thresholds.samplesPerMeter, 2)}`}
              level={prep.totals.samplesPerMeter < analytics.thresholds.samplesPerMeter ? "warn" : "ok"}
            />
            <Kpi
              testId="kpi-prep-bottleneck"
              label="Узкое место"
              value={prep.worstStage ? `${nf(prep.worstStage.count)} проб` : "—"}
              hint={prep.worstStage ? prep.worstStage.stage : "Заторов нет"}
              level={prep.worstStage?.bottleneck ? "bad" : "ok"}
            />
            <Kpi
              testId="kpi-prep-overdue"
              label="Просроченные партии"
              value={nf(prep.batches.filter((b: any) => b.overdue).length)}
              hint={`Проб в них: ${nf(prep.batches.filter((b: any) => b.overdue).reduce((s: number, b: any) => s + b.samples, 0))}`}
              level={prep.batches.some((b: any) => b.overdue) ? "bad" : "ok"}
            />
          </div>

          <Section
            className="mb-4"
            title="Канбан по этапам пробоподготовки"
            description="Красным подсвечен этап-затор: проб больше порога или пробы стоят дольше допустимого."
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {prep.byStage.map((s: any) => (
                <button
                  key={s.stage}
                  onClick={() => { setTab("journal"); setFStage(s.stage); }}
                  data-testid={`card-stage-${s.stage}`}
                  className={cn(
                    "rounded-md border p-3 text-left transition-colors hover:bg-accent",
                    s.bottleneck ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40" : "bg-background",
                  )}
                >
                  <div className="text-xs font-medium leading-snug">{s.stage}</div>
                  <div className="num mt-1 text-lg font-semibold">{nf(s.count)}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Средний возраст {nf(s.avgDays, 1)} дн.
                    {s.stuck > 0 && s.inProcess ? ` · залежались ${nf(s.stuck)}` : ""}
                  </div>
                  {s.bottleneck && (
                    <Badge variant="outline" className={cn("mt-2 border text-[10px]", levelBadge.bad)}>
                      затор
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          </Section>

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Section title="Отбор проб и результаты по дням" description="Сколько проб отбирается и сколько результатов приходит от лабораторий.">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={prep.charts.samplesByDay} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={4} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="отобрано" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="результаты" stroke={CHART_COLORS[1]} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Section>
            <Section title="Воронка этапов" description="Сколько проб прошло каждый этап — где воронка сужается, там теряется время.">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={prep.charts.funnel} layout="vertical" margin={{ top: 5, right: 12, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={128} tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="value" name="проб" radius={[0, 4, 4, 0]}>
                      {prep.charts.funnel.map((_: any, i: number) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
          </div>

          {finance && <Section title="Затраты на анализы по лабораториям" description="Сколько платим каждой лаборатории и сколько проб через неё прошло.">
            {prep.costByLab.length === 0 ? (
              <Empty text="Партии в лаборатории пока не отправлялись." />
            ) : (
              <TableWrap>
                <table className="w-full min-w-[560px] text-sm" data-testid="table-cost-by-lab">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Лаборатория</th>
                      <th className="py-2 pr-3 font-medium">Город</th>
                      <th className="py-2 pr-3 text-right font-medium">Партий</th>
                      <th className="py-2 pr-3 text-right font-medium">Проб</th>
                      {finance && <th className="py-2 text-right font-medium">Затраты</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {prep.costByLab.map((l: any) => (
                      <tr key={l.lab} className="border-b last:border-0">
                        <td className="py-2 pr-3">{l.lab}</td>
                        <td className="py-2 pr-3">{l.city}</td>
                        <td className="num py-2 pr-3 text-right">{nf(l.batches)}</td>
                        <td className="num py-2 pr-3 text-right">{nf(l.samples)}</td>
                        {finance && <td className="num py-2 text-right font-medium">{money(l.cost)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Section>}
        </>
      ) : tab === "journal" ? (
        <>
          <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Период</label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger data-testid="filter-prep-period"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 дней</SelectItem>
                  <SelectItem value="30">30 дней</SelectItem>
                  <SelectItem value="60">60 дней</SelectItem>
                  <SelectItem value="all">Весь период</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Объект</label>
              <Select value={fObject} onValueChange={(v) => { setFObject(v); setFRig("all"); }}>
                <SelectTrigger data-testid="filter-prep-object"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все объекты</SelectItem>
                  {objects.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Станок</label>
              <Select value={fRig} onValueChange={setFRig}>
                <SelectTrigger data-testid="filter-prep-rig"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все станки</SelectItem>
                  {rigs
                    .filter((r) => fObject === "all" || r.objectId === Number(fObject))
                    .map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Скважина</label>
              <Select value={fHole} onValueChange={setFHole}>
                <SelectTrigger data-testid="filter-prep-hole"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все скважины</SelectItem>
                  {holeNames.map((h) => <SelectItem key={h as string} value={h as string}>{h as string}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Тип пробы</label>
              <Select value={fType} onValueChange={setFType}>
                <SelectTrigger data-testid="filter-prep-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все типы</SelectItem>
                  {sampleTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Этап</label>
              <Select value={fStage} onValueChange={setFStage}>
                <SelectTrigger data-testid="filter-prep-stage"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все этапы</SelectItem>
                  {stages.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Статус</label>
              <Select value={fStatus} onValueChange={setFStatus}>
                <SelectTrigger data-testid="filter-prep-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Любой статус</SelectItem>
                  <SelectItem value="в работе">в работе</SelectItem>
                  <SelectItem value="готово">готово</SelectItem>
                  <SelectItem value="брак">брак</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                data-testid="button-prep-reset-filters"
                onClick={() => {
                  setPeriod("60"); setFObject("all"); setFRig("all"); setFHole("all");
                  setFType("all"); setFStage("all"); setFStatus("all");
                }}
              >
                Сбросить фильтры
              </Button>
            </div>
          </Card>

          {selected.length > 0 && (
            <Card className="mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="panel-bulk">
              <div className="text-sm">
                Выбрано проб: <span className="num font-semibold">{nf(selected.length)}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  data-testid="button-bulk-move"
                  onClick={() => {
                    const first = rows.find((r) => selected.includes(r.id));
                    setMoveStage(nextStageOf(first?.stage ?? "") || stages[1] || "");
                    setMoveDate(todayIso());
                    setMoveOpen(true);
                  }}
                >
                  <ArrowRight className="mr-2 h-4 w-4" />
                  Перевести партией
                </Button>
                <Button size="sm" variant="outline" data-testid="button-bulk-batch" onClick={openBatch}>
                  <Boxes className="mr-2 h-4 w-4" />
                  Сформировать партию
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="button-bulk-reject"
                  onClick={() => { setRejectReason(reasons[0] ?? ""); setRejectOpen(true); }}
                >
                  <Ban className="mr-2 h-4 w-4" />
                  Отметить брак
                </Button>
                <Button size="sm" variant="ghost" data-testid="button-bulk-clear" onClick={() => setSelected([])}>
                  Снять выбор
                </Button>
              </div>
            </Card>
          )}

          <Section title="Журнал проб" description={`Показано проб: ${nf(rows.length)} из ${nf((samples.data ?? []).length)}`}>
            {samples.isLoading ? (
              <Loading rows={3} />
            ) : rows.length === 0 ? (
              <Empty text="Под фильтры не попала ни одна проба. Измените период или сбросьте фильтры." />
            ) : (
              <TableWrap maxH="65vh">
                <table className="w-full min-w-[1080px] text-sm" data-testid="table-samples">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-2">
                        <Checkbox
                          checked={allChecked}
                          onCheckedChange={(v) => setSelected(v ? allShownIds : [])}
                          aria-label="Выбрать все пробы"
                          data-testid="checkbox-select-all"
                        />
                      </th>
                      <th className="py-2 pr-3 font-medium">Номер</th>
                      <th className="py-2 pr-3 font-medium">Дата</th>
                      <th className="py-2 pr-3 font-medium">Объект</th>
                      <th className="py-2 pr-3 font-medium">Скважина</th>
                      <th className="py-2 pr-3 text-right font-medium">Интервал, м</th>
                      <th className="py-2 pr-3 text-right font-medium">Длина</th>
                      <th className="py-2 pr-3 font-medium">Тип</th>
                      <th className="py-2 pr-3 text-right font-medium">Вес, кг</th>
                      <th className="py-2 pr-3 font-medium">Геолог</th>
                      <th className="py-2 pr-3 font-medium">Этап</th>
                      <th className="py-2 pr-3 font-medium">Статус</th>
                      <th className="py-2 font-medium"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 400).map((s) => (
                      <tr key={s.id} className="border-b last:border-0" data-testid={`row-sample-${s.id}`}>
                        <td className="py-2 pr-2">
                          <Checkbox
                            checked={selected.includes(s.id)}
                            onCheckedChange={() => toggle(s.id)}
                            aria-label={`Выбрать пробу ${s.code}`}
                            data-testid={`checkbox-sample-${s.id}`}
                          />
                        </td>
                        <td className="py-2 pr-3 font-medium whitespace-nowrap">{s.code}</td>
                        <td className="num py-2 pr-3 whitespace-nowrap">{ruDate(s.date)}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{nameOf(objects, s.objectId)}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{s.holeName || "—"}</td>
                        <td className="num py-2 pr-3 text-right whitespace-nowrap">
                          {nf(s.fromDepth, 1)}–{nf(s.toDepth, 1)}
                        </td>
                        <td className="num py-2 pr-3 text-right">{nf(s.toDepth - s.fromDepth, 1)}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{s.sampleType}</td>
                        <td className="num py-2 pr-3 text-right">{nf(s.weightKg, 1)}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{fioOf(s.geologistId)}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{s.stage}</td>
                        <td className="py-2 pr-3">
                          <Badge
                            variant="outline"
                            className={cn(
                              "border text-[11px]",
                              s.status === "брак" ? levelBadge.bad : s.status === "готово" ? levelBadge.ok : levelBadge.warn,
                            )}
                          >
                            {s.status}
                          </Badge>
                          {s.rejectReason ? (
                            <div className="mt-1 text-[11px] text-muted-foreground">{s.rejectReason}</div>
                          ) : null}
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Передать на следующий этап"
                            onClick={() => moveOne.mutate(s)}
                            data-testid={`button-next-stage-${s.id}`}
                          >
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="История движения"
                            onClick={() => setHistoryFor(s)}
                            data-testid={`button-history-${s.id}`}
                          >
                            <History className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Удалить пробу"
                            onClick={() => removeSample.mutate(s.id)}
                            data-testid={`button-delete-sample-${s.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
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
      ) : tab === "batches" ? (
        <Section
          title="Отправки в лабораторию"
          description="Ожидаемая дата результата считается автоматически: дата отправки + срок по договору лаборатории."
          actions={
            <Button size="sm" variant="outline" onClick={() => setTab("journal")} data-testid="button-goto-journal">
              Выбрать пробы для партии
            </Button>
          }
        >
          {prep.batches.length === 0 ? (
            <Empty text="Партии ещё не формировались. Отметьте пробы в журнале и нажмите «Сформировать партию»." />
          ) : (
            <TableWrap maxH="65vh">
              <table className="w-full min-w-[1040px] text-sm" data-testid="table-batches">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Партия</th>
                    <th className="py-2 pr-3 font-medium">Лаборатория</th>
                    <th className="py-2 pr-3 font-medium">Вид анализа</th>
                    <th className="py-2 pr-3 font-medium">Отправлена</th>
                    <th className="py-2 pr-3 font-medium">Срок результата</th>
                    <th className="py-2 pr-3 text-right font-medium">Проб</th>
                    {finance && <th className="py-2 pr-3 text-right font-medium">Стоимость</th>}
                    <th className="py-2 pr-3 font-medium">Контроль</th>
                    <th className="py-2 pr-3 font-medium">Статус</th>
                    <th className="py-2 font-medium"> </th>
                  </tr>
                </thead>
                <tbody>
                  {prep.batches.map((b: any) => (
                    <tr key={b.id} className="border-b last:border-0" data-testid={`row-batch-${b.id}`}>
                      <td className="py-2 pr-3 font-medium whitespace-nowrap">{b.code}</td>
                      <td className="py-2 pr-3">{b.lab}</td>
                      <td className="py-2 pr-3">{b.analysisType}</td>
                      <td className="num py-2 pr-3 whitespace-nowrap">{ruDate(b.sentDate)}</td>
                      <td className="num py-2 pr-3 whitespace-nowrap">{ruDate(b.dueDate)}</td>
                      <td className="num py-2 pr-3 text-right">{nf(b.samples)}</td>
                      {finance && <td className="num py-2 pr-3 text-right">{money(b.cost)}</td>}
                      <td className="py-2 pr-3 whitespace-nowrap text-[11px] text-muted-foreground">
                        дубл. {nf(b.duplicates)} · станд. {nf(b.standards)} · бланк {nf(b.blanks)}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge
                          variant="outline"
                          className={cn(
                            "border text-[11px]",
                            b.overdue ? levelBadge.bad : b.status === "получена" ? levelBadge.ok : levelBadge.warn,
                          )}
                        >
                          {b.overdue ? `просрочка ${nf(b.overdueDays)} дн.` : b.status}
                        </Badge>
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Удалить партию"
                          onClick={() => removeBatch.mutate(b.id)}
                          data-testid={`button-delete-batch-${b.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Section>
      ) : tab === "results" ? (
        <>
          <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Объект</label>
              <Select value={rObject} onValueChange={setRObject}>
                <SelectTrigger data-testid="filter-res-object"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все объекты</SelectItem>
                  {objects.map((o) => <SelectItem key={o.id} value={o.name}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Скважина</label>
              <Select value={rHole} onValueChange={setRHole}>
                <SelectTrigger data-testid="filter-res-hole"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все скважины</SelectItem>
                  {holeNames.map((h) => <SelectItem key={h as string} value={h as string}>{h as string}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Элемент</label>
              <Select value={rElement} onValueChange={setRElement}>
                <SelectTrigger data-testid="filter-res-element"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все элементы</SelectItem>
                  {elements.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Button
                size="sm"
                variant={rOnlyOre ? "default" : "outline"}
                onClick={() => setROnlyOre((v) => !v)}
                data-testid="button-only-ore"
              >
                Только рудные
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setAssayError(""); setAssayOpen(true); }}
                data-testid="button-add-assay"
              >
                <Plus className="mr-2 h-4 w-4" />
                Внести результат
              </Button>
            </div>
          </Card>

          <Section
            className="mb-4"
            title="Результаты анализов"
            description={`Рудным считается содержание выше порога: Au ${nf(prep.results.oreLimits.Au, 2)} г/т, Ag ${nf(prep.results.oreLimits.Ag, 1)} г/т, Cu ${nf(prep.results.oreLimits.Cu, 2)} %. Рудных проб: ${nf(prep.results.oreCount)}.`}
          >
            {resultRows.length === 0 ? (
              <Empty text="Результатов по этим фильтрам нет. Загрузите файл лаборатории через «Импорт данных» → «Результаты анализов»." />
            ) : (
              <TableWrap maxH="60vh">
                <table className="w-full min-w-[920px] text-sm" data-testid="table-assays">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Проба</th>
                      <th className="py-2 pr-3 font-medium">Объект</th>
                      <th className="py-2 pr-3 font-medium">Скважина</th>
                      <th className="py-2 pr-3 text-right font-medium">Интервал, м</th>
                      <th className="py-2 pr-3 font-medium">Тип</th>
                      <th className="py-2 pr-3 font-medium">Элемент</th>
                      <th className="py-2 pr-3 text-right font-medium">Содержание</th>
                      <th className="py-2 pr-3 font-medium">Получен</th>
                      <th className="py-2 font-medium"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultRows.slice(0, 400).map((r: any) => (
                      <tr
                        key={r.id}
                        data-testid={`row-assay-${r.id}`}
                        className={cn(
                          "border-b last:border-0",
                          r.ore && "bg-amber-50 dark:bg-amber-950/30",
                        )}
                      >
                        <td className="py-2 pr-3 font-medium whitespace-nowrap">{r.code}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{r.object}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{r.hole}</td>
                        <td className="num py-2 pr-3 text-right whitespace-nowrap">
                          {nf(r.fromDepth, 1)}–{nf(r.toDepth, 1)}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">{r.sampleType}</td>
                        <td className="py-2 pr-3">{r.element}</td>
                        <td className="num py-2 pr-3 text-right font-medium">
                          {nf(r.value, 2)} {r.unit}
                        </td>
                        <td className="num py-2 pr-3 whitespace-nowrap">{ruDate(r.receivedDate)}</td>
                        <td className="py-2 text-right whitespace-nowrap">
                          {r.ore && (
                            <Badge variant="outline" className={cn("border text-[11px]", levelBadge.warn)}>
                              рудный интервал
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Удалить результат"
                            onClick={() => removeAssay.mutate(r.id)}
                            data-testid={`button-delete-assay-${r.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Section>

          <Section title="Сводка по скважинам" description="Средневзвешенное содержание золота по опробованным интервалам и метраж рудных интервалов.">
            {prep.results.holeGrades.length === 0 ? (
              <Empty text="Пока нет результатов по золоту." />
            ) : (
              <TableWrap>
                <table className="w-full min-w-[620px] text-sm" data-testid="table-hole-grades">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Скважина</th>
                      <th className="py-2 pr-3 font-medium">Объект</th>
                      <th className="py-2 pr-3 text-right font-medium">Проб</th>
                      <th className="py-2 pr-3 text-right font-medium">Опробовано, м</th>
                      <th className="py-2 pr-3 text-right font-medium">Среднее Au, г/т</th>
                      <th className="py-2 pr-3 text-right font-medium">Рудных проб</th>
                      <th className="py-2 text-right font-medium">Рудных, м</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prep.results.holeGrades.map((h: any) => (
                      <tr key={h.hole} className="border-b last:border-0" data-testid={`row-grade-${h.hole}`}>
                        <td className="py-2 pr-3 font-medium">{h.hole}</td>
                        <td className="py-2 pr-3">{h.object}</td>
                        <td className="num py-2 pr-3 text-right">{nf(h.samples)}</td>
                        <td className="num py-2 pr-3 text-right">{nf(h.meters, 1)}</td>
                        <td className="num py-2 pr-3 text-right font-medium">{nf(h.avgAu, 2)}</td>
                        <td className="num py-2 pr-3 text-right">{nf(h.oreSamples)}</td>
                        <td className="num py-2 text-right">{nf(h.oreMeters, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Section>
        </>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              testId="kpi-qa-dup"
              label="Доля дубликатов"
              value={`${nf(prep.qa.shares.dup, 1)} %`}
              hint={`Норма не менее ${nf(prep.qa.shares.dupNorm, 1)} %`}
              level={prep.qa.shares.dup < prep.qa.shares.dupNorm ? "warn" : "ok"}
            />
            <Kpi
              testId="kpi-qa-std"
              label="Доля стандартов"
              value={`${nf(prep.qa.shares.std, 1)} %`}
              hint={`Норма не менее ${nf(prep.qa.shares.stdNorm, 1)} %`}
              level={prep.qa.shares.std < prep.qa.shares.stdNorm ? "warn" : "ok"}
            />
            <Kpi
              testId="kpi-qa-blank"
              label="Доля бланков"
              value={`${nf(prep.qa.shares.blank, 1)} %`}
              hint={`Норма не менее ${nf(prep.qa.shares.blankNorm, 1)} %`}
              level={prep.qa.shares.blank < prep.qa.shares.blankNorm ? "warn" : "ok"}
            />
            <Kpi
              testId="kpi-qa-lost"
              label="Пробы под риском потери"
              value={nf(prep.qa.lostSamples.length)}
              hint={`Нет результата свыше ${nf(analytics.thresholds.labNoResultDays)} дн. сверх срока`}
              level={prep.qa.lostSamples.length ? "bad" : "ok"}
            />
          </div>

          <Section className="mb-4" title="Сравнение дубликат / оригинал" description={`Допустимое расхождение — ${nf(analytics.thresholds.dupDeviationPct, 1)} %. Расхождение выше означает, что результату нельзя доверять.`}>
            {prep.qa.dupPairs.length === 0 ? (
              <Empty text="Пар «дубликат — оригинал» с результатами пока нет." />
            ) : (
              <TableWrap>
                <table className="w-full min-w-[760px] text-sm" data-testid="table-dup-pairs">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Дубликат</th>
                      <th className="py-2 pr-3 font-medium">Оригинал</th>
                      <th className="py-2 pr-3 font-medium">Скважина</th>
                      <th className="py-2 pr-3 font-medium">Интервал, м</th>
                      <th className="py-2 pr-3 text-right font-medium">Оригинал, г/т</th>
                      <th className="py-2 pr-3 text-right font-medium">Дубликат, г/т</th>
                      <th className="py-2 font-medium">Расхождение</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prep.qa.dupPairs.map((p: any) => (
                      <tr key={p.code} className="border-b last:border-0" data-testid={`row-dup-${p.code}`}>
                        <td className="py-2 pr-3 font-medium">{p.code}</td>
                        <td className="py-2 pr-3">{p.origCode}</td>
                        <td className="py-2 pr-3">{p.hole}</td>
                        <td className="num py-2 pr-3">{p.interval}</td>
                        <td className="num py-2 pr-3 text-right">{nf(p.origValue, 2)}</td>
                        <td className="num py-2 pr-3 text-right">{nf(p.dupValue, 2)}</td>
                        <td className="py-2">
                          <Badge variant="outline" className={cn("border text-[11px]", p.ok ? levelBadge.ok : levelBadge.bad)}>
                            {nf(p.deviationPct, 1)} %
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Пробы, которые могут быть потеряны" description="Числятся отправленными, результата нет сверх допустимого срока.">
              {prep.qa.lostSamples.length === 0 ? (
                <Empty text="Все отправленные пробы в пределах срока." />
              ) : (
                <TableWrap maxH="40vh">
                  <table className="w-full min-w-[420px] text-sm" data-testid="table-lost">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Проба</th>
                        <th className="py-2 pr-3 font-medium">Объект</th>
                        <th className="py-2 pr-3 font-medium">Партия</th>
                        <th className="py-2 text-right font-medium">Сверх срока</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prep.qa.lostSamples.map((l: any) => (
                        <tr key={l.code} className="border-b last:border-0">
                          <td className="py-2 pr-3 font-medium">{l.code}</td>
                          <td className="py-2 pr-3">{l.object}</td>
                          <td className="py-2 pr-3">{l.batch}</td>
                          <td className="num py-2 text-right">{nf(l.daysOver)} дн.</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </Section>

            <Section title="Брак проб и партии без стандартов" description="Причины брака и партии, по которым нет контрольных образцов.">
              <div className="space-y-4">
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Причины брака</h3>
                  {prep.qa.rejectReasons.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Брака нет.</p>
                  ) : (
                    <ul className="space-y-1 text-sm" data-testid="list-reject-reasons">
                      {prep.qa.rejectReasons.map((r: any) => (
                        <li key={r.reason} className="flex justify-between gap-3">
                          <span>{r.reason}</span>
                          <span className="num font-medium">{nf(r.count)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Партии без стандартов</h3>
                  {prep.qa.batchesWithoutStd.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Во всех партиях есть контрольные образцы.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2" data-testid="list-no-std">
                      {prep.qa.batchesWithoutStd.map((c: string) => (
                        <Badge key={c} variant="outline" className={cn("border text-[11px]", levelBadge.warn)}>
                          {c}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Section>
          </div>
        </>
      )}

      {/* Диалог массового перевода */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-bulk-move">
          <DialogHeader>
            <DialogTitle>Перевести пробы партией</DialogTitle>
            <DialogDescription>
              Выбрано проб: {nf(selected.length)}. Пробы в браке будут пропущены.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Этап</label>
              <Select value={moveStage} onValueChange={setMoveStage}>
                <SelectTrigger data-testid="select-move-stage"><SelectValue placeholder="Выберите этап" /></SelectTrigger>
                <SelectContent>
                  {stages.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Дата перевода</label>
              <Input type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} data-testid="input-move-date" />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setMoveOpen(false)} data-testid="button-cancel-move">Отмена</Button>
            <Button onClick={() => bulkMove.mutate()} disabled={!moveStage || bulkMove.isPending} data-testid="button-confirm-move">
              {bulkMove.isPending ? "Переводим…" : "Перевести"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог брака */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-reject">
          <DialogHeader>
            <DialogTitle>Отметить брак</DialogTitle>
            <DialogDescription>Пробы уйдут в архив с указанной причиной и попадут в долю брака.</DialogDescription>
          </DialogHeader>
          <div>
            <label className="mb-1 block text-xs font-medium">Причина</label>
            <Select value={rejectReason} onValueChange={setRejectReason}>
              <SelectTrigger data-testid="select-reject-reason"><SelectValue placeholder="Выберите причину" /></SelectTrigger>
              <SelectContent>
                {reasons.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setRejectOpen(false)} data-testid="button-cancel-reject">Отмена</Button>
            <Button onClick={() => bulkReject.mutate()} disabled={!rejectReason || bulkReject.isPending} data-testid="button-confirm-reject">
              {bulkReject.isPending ? "Сохраняем…" : "Отметить брак"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог новой пробы */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="dialog-add-sample">
          <DialogHeader>
            <DialogTitle>Новая проба</DialogTitle>
            <DialogDescription>Номер сформирован по префиксу объекта — при необходимости измените.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Номер пробы</label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} data-testid="input-sample-code" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Дата отбора</label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="input-sample-date" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Объект</label>
              <Select
                value={form.objectId}
                onValueChange={(v) => {
                  const o = objects.find((x) => x.id === Number(v));
                  setForm((f) => ({
                    ...f,
                    objectId: v,
                    code: f.code.replace(/^[А-ЯЁ]{2,3}/, objPrefix(o?.name ?? "")),
                  }));
                }}
              >
                <SelectTrigger data-testid="select-sample-object"><SelectValue placeholder="Объект" /></SelectTrigger>
                <SelectContent>
                  {objects.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Станок</label>
              <Select value={form.rigId} onValueChange={(v) => setForm({ ...form, rigId: v })}>
                <SelectTrigger data-testid="select-sample-rig"><SelectValue placeholder="Станок" /></SelectTrigger>
                <SelectContent>
                  {rigs
                    .filter((r) => !form.objectId || r.objectId === Number(form.objectId))
                    .map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Скважина / линия</label>
              <Input value={form.holeName} onChange={(e) => setForm({ ...form, holeName: e.target.value })} placeholder="СКВ-101" data-testid="input-sample-hole" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Тип пробы</label>
              <Select value={form.sampleType} onValueChange={(v) => setForm({ ...form, sampleType: v })}>
                <SelectTrigger data-testid="select-sample-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sampleTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Интервал от, м</label>
              <Input inputMode="decimal" value={form.fromDepth} onChange={(e) => setForm({ ...form, fromDepth: e.target.value })} data-testid="input-sample-from" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Интервал до, м</label>
              <Input inputMode="decimal" value={form.toDepth} onChange={(e) => setForm({ ...form, toDepth: e.target.value })} data-testid="input-sample-to" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Вес исходный, кг</label>
              <Input inputMode="decimal" value={form.weightKg} onChange={(e) => setForm({ ...form, weightKg: e.target.value })} data-testid="input-sample-weight" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Ответственный</label>
              <Select value={form.geologistId} onValueChange={(v) => setForm({ ...form, geologistId: v })}>
                <SelectTrigger data-testid="select-sample-geologist"><SelectValue placeholder="Геолог" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.fio}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium">Примечание</label>
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Необязательно" data-testid="input-sample-note" />
            </div>
            <div className="sm:col-span-2 text-xs text-muted-foreground">
              Длина интервала:{" "}
              <span className="num font-medium">
                {nf(Math.max(0, Number(form.toDepth || 0) - Number(form.fromDepth || 0)), 1)} м
              </span>
            </div>
          </div>
          {formError && <div className="mt-2"><ErrorBox text={formError} /></div>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setAddOpen(false)} data-testid="button-cancel-sample">Отмена</Button>
            <Button
              onClick={() => {
                setFormError("");
                if (!form.code.trim()) return setFormError("Укажите номер пробы.");
                if (!form.objectId) return setFormError("Выберите объект.");
                if (Number(form.toDepth) <= Number(form.fromDepth))
                  return setFormError("Интервал «до» должен быть больше «от».");
                createSample.mutate();
              }}
              disabled={createSample.isPending}
              data-testid="button-save-sample"
            >
              {createSample.isPending ? "Сохраняем…" : "Сохранить пробу"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог партии */}
      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="dialog-batch">
          <DialogHeader>
            <DialogTitle>Сформировать партию в лабораторию</DialogTitle>
            <DialogDescription>
              В партию войдут выбранные пробы ({nf(selected.length)} шт.). Ожидаемая дата результата
              посчитается по сроку договора лаборатории.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Номер партии</label>
              <Input value={batchForm.code} onChange={(e) => setBatchForm({ ...batchForm, code: e.target.value })} data-testid="input-batch-code" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Дата отправки</label>
              <Input type="date" value={batchForm.sentDate} onChange={(e) => setBatchForm({ ...batchForm, sentDate: e.target.value })} data-testid="input-batch-date" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Лаборатория</label>
              <Select value={batchForm.labId} onValueChange={(v) => setBatchForm({ ...batchForm, labId: v })}>
                <SelectTrigger data-testid="select-batch-lab"><SelectValue placeholder="Лаборатория" /></SelectTrigger>
                <SelectContent>
                  {labs.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.name} · {l.leadDays} дн. · {nf(l.pricePerSample)} ₽
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Вид анализа</label>
              <Select value={batchForm.analysisTypeId} onValueChange={(v) => setBatchForm({ ...batchForm, analysisTypeId: v })}>
                <SelectTrigger data-testid="select-batch-analysis"><SelectValue placeholder="Вид анализа" /></SelectTrigger>
                <SelectContent>
                  {analysisTypes.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Способ отправки</label>
              <Select value={batchForm.shipMethod} onValueChange={(v) => setBatchForm({ ...batchForm, shipMethod: v })}>
                <SelectTrigger data-testid="select-batch-ship"><SelectValue placeholder="Способ" /></SelectTrigger>
                <SelectContent>
                  {shipMethods.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Номер накладной</label>
              <Input value={batchForm.waybill} onChange={(e) => setBatchForm({ ...batchForm, waybill: e.target.value })} data-testid="input-batch-waybill" />
            </div>
            {finance && <div className="sm:col-span-2 text-xs text-muted-foreground">
              Стоимость партии:{" "}
              <span className="num font-medium">
                {money(selected.length * (labs.find((l) => l.id === Number(batchForm.labId))?.pricePerSample ?? 0))}
              </span>
            </div>}
          </div>
          {batchError && <div className="mt-2"><ErrorBox text={batchError} /></div>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setBatchOpen(false)} data-testid="button-cancel-batch">Отмена</Button>
            <Button
              onClick={() => {
                setBatchError("");
                if (!batchForm.code.trim()) return setBatchError("Укажите номер партии.");
                if (!batchForm.labId) return setBatchError("Выберите лабораторию.");
                if (!selected.length) return setBatchError("Сначала отметьте пробы в журнале.");
                createBatch.mutate();
              }}
              disabled={createBatch.isPending}
              data-testid="button-save-batch"
            >
              {createBatch.isPending ? "Сохраняем…" : "Сформировать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог ручного результата */}
      <Dialog open={assayOpen} onOpenChange={setAssayOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-assay">
          <DialogHeader>
            <DialogTitle>Внести результат анализа</DialogTitle>
            <DialogDescription>Проба автоматически перейдёт на этап «Результат получен».</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium">Номер пробы</label>
              <Input
                value={assayForm.sampleCode}
                onChange={(e) => setAssayForm({ ...assayForm, sampleCode: e.target.value })}
                placeholder="СЕВ-26-001"
                data-testid="input-assay-code"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Элемент</label>
              <Select value={assayForm.element} onValueChange={(v) => setAssayForm({ ...assayForm, element: v })}>
                <SelectTrigger data-testid="select-assay-element"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {elements.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Единица</label>
              <Select value={assayForm.unit} onValueChange={(v) => setAssayForm({ ...assayForm, unit: v })}>
                <SelectTrigger data-testid="select-assay-unit"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {units.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Содержание</label>
              <Input inputMode="decimal" value={assayForm.value} onChange={(e) => setAssayForm({ ...assayForm, value: e.target.value })} data-testid="input-assay-value" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Дата получения</label>
              <Input type="date" value={assayForm.receivedDate} onChange={(e) => setAssayForm({ ...assayForm, receivedDate: e.target.value })} data-testid="input-assay-date" />
            </div>
          </div>
          {assayError && <div className="mt-2"><ErrorBox text={assayError} /></div>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setAssayOpen(false)} data-testid="button-cancel-assay">Отмена</Button>
            <Button
              onClick={() => {
                setAssayError("");
                if (!assayForm.sampleCode.trim()) return setAssayError("Укажите номер пробы.");
                if (!assayForm.value) return setAssayError("Укажите содержание.");
                createAssay.mutate();
              }}
              disabled={createAssay.isPending}
              data-testid="button-save-assay"
            >
              {createAssay.isPending ? "Сохраняем…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* История движения пробы */}
      <Dialog open={!!historyFor} onOpenChange={(v) => !v && setHistoryFor(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto" data-testid="dialog-history">
          <DialogHeader>
            <DialogTitle>Движение пробы {historyFor?.code}</DialogTitle>
            <DialogDescription>Все переводы между этапами с датами и ответственными.</DialogDescription>
          </DialogHeader>
          {moves.isLoading ? (
            <Loading rows={2} />
          ) : (moves.data ?? []).length === 0 ? (
            <Empty text="Записей о движении нет." />
          ) : (
            <ol className="space-y-2 text-sm" data-testid="list-moves">
              {(moves.data ?? []).map((m: any) => (
                <li key={m.id} className="rounded-md border p-2">
                  <div className="num text-xs text-muted-foreground">{ruDate(m.date)}</div>
                  <div>
                    {m.fromStage ? `${m.fromStage} → ` : ""}
                    <span className="font-medium">{m.toStage}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {m.author}
                    {m.note ? ` · ${m.note}` : ""}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setHistoryFor(null)} data-testid="button-close-history">Закрыть</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
