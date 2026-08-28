import { useState } from "react";
import { Link } from "wouter";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, PieChart, Pie, Cell,
} from "recharts";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Copy, Check, Wand2, Upload,
  Plane, HeartPulse, Briefcase, GraduationCap, Plus, Trash2, StickyNote, Bell,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAnalytics, useStatus, useList } from "@/lib/hooks";
import {
  Kpi, Section, PageHeader, ExportButton, Empty, Loading, ErrorBox,
} from "@/components/shell";
import {
  nf, money, pct, meters, ruDate, downloadFile, CHART_COLORS,
  planLevel, overLevel, levelBadge, levelText, type Level,
} from "@/lib/app";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

const ABSENCE_ICON: Record<string, any> = { vacation: Plane, sick: HeartPulse, trip: Briefcase, study: GraduationCap };
const ABSENCE_LABEL: Record<string, string> = { vacation: "Отпуск", sick: "Больничный", trip: "Командировка", study: "Обучение" };

/** Боковая панель заметок и напоминаний на дашборде */
function NotesPanel() {
  const notesQ = useList<any>("/api/dashboard-notes");
  const notes: any[] = notesQ.data ?? [];
  const [text, setText] = useState("");
  const [remindDate, setRemindDate] = useState("");
  const todayIso = new Date().toISOString().slice(0, 10);

  const addNote = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/dashboard-notes", { text, remindDate, done: 0 })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setText("");
      setRemindDate("");
    },
  });
  const toggleNote = useMutation({
    mutationFn: async ({ id, done }: { id: number; done: number }) =>
      (await apiRequest("PATCH", `/api/dashboard-notes/${id}`, { done })).json(),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const deleteNote = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/dashboard-notes/${id}`)).json(),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const sorted = [...notes].sort((a, b) => {
    if (a.done !== b.done) return a.done - b.done;
    const aOverdue = a.remindDate && a.remindDate <= todayIso ? 0 : 1;
    const bOverdue = b.remindDate && b.remindDate <= todayIso ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;
    return (a.remindDate || "9999").localeCompare(b.remindDate || "9999");
  });

  return (
    <Card className="p-4" data-testid="card-notes-panel">
      <div className="mb-3 flex items-center gap-2">
        <StickyNote className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Заметки и напоминания</h2>
      </div>

      <div className="mb-3 space-y-2 rounded-md border p-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Например: позвонить в отдел кадров"
          data-testid="input-note-text"
        />
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={remindDate}
            onChange={(e) => setRemindDate(e.target.value)}
            className="text-xs"
            data-testid="input-note-date"
          />
          <Button
            size="sm"
            className="shrink-0"
            disabled={!text.trim() || addNote.isPending}
            onClick={() => addNote.mutate()}
            data-testid="button-add-note"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">Заметок пока нет. Добавьте первую выше.</p>
      ) : (
        <div className="max-h-[420px] space-y-2 overflow-auto">
          {sorted.map((n) => {
            const overdue = !!n.remindDate && n.remindDate <= todayIso && !n.done;
            return (
              <div
                key={n.id}
                className={cn(
                  "flex items-start gap-2 rounded-md border p-2",
                  overdue && "border-amber-500 bg-amber-50 dark:bg-amber-950/30",
                  n.done && "opacity-50",
                )}
                data-testid={`note-${n.id}`}
              >
                <Checkbox
                  checked={!!n.done}
                  onCheckedChange={(v) => toggleNote.mutate({ id: n.id, done: v ? 1 : 0 })}
                  className="mt-0.5"
                  aria-label="Выполнено"
                />
                <div className="min-w-0 flex-1">
                  <div className={cn("text-sm", n.done && "line-through")}>{n.text}</div>
                  {n.remindDate && (
                    <div className={cn("mt-0.5 flex items-center gap-1 text-xs", overdue ? "text-amber-700 dark:text-amber-400 font-medium" : "text-muted-foreground")}>
                      <Bell className="h-3 w-3" />
                      {ruDate(n.remindDate)}
                      {overdue && " · напоминание"}
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => deleteNote.mutate(n.id)}
                  aria-label="Удалить"
                  data-testid={`button-delete-note-${n.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/** Кто сейчас в отпуске, на больничном, в командировке или на обучении */
function AbsenceSection({ active, upcoming }: { active: any[]; upcoming: any[] }) {
  if (!active?.length && !upcoming?.length) {
    return (
      <Section className="mb-4" title="Отпуска, больничные, командировки">
        <Empty text="Сейчас все сотрудники на месте. Отсутствий не зафиксировано." />
      </Section>
    );
  }
  return (
    <Section
      className="mb-4"
      title="Отпуска, больничные, командировки"
      description={`Сейчас отсутствует: ${active.length}${upcoming.length ? `, уйдёт в течение недели: ${upcoming.length}` : ""}`}
    >
      <div className="grid gap-2 md:grid-cols-2">
        {active.map((ev: any) => {
          const Icon = ABSENCE_ICON[ev.kind] ?? Plane;
          const soon = ev.daysLeft <= 2;
          return (
            <div
              key={`active-${ev.id}`}
              className={cn("rounded-md border p-3", soon && "border-amber-500 bg-amber-50 dark:bg-amber-950/30")}
              data-testid={`absence-active-${ev.id}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn("border text-[11px]", soon ? levelBadge.bad : levelBadge.warn)}>
                  <Icon className="mr-1 h-3 w-3" />
                  {ABSENCE_LABEL[ev.kind] ?? ev.kind}
                </Badge>
                <span className="text-xs text-muted-foreground">{ev.object}</span>
              </div>
              <div className="mt-1.5 text-sm font-medium">{ev.fio}</div>
              <div className="num text-sm">
                с {ruDate(ev.startDate)}{ev.endDate === "9999-12-31" ? "" : ` по ${ruDate(ev.endDate)}`}
                {ev.destination ? ` · ${ev.destination}` : ""}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {ev.endDate === "9999-12-31"
                  ? "Дата окончания не указана"
                  : ev.daysLeft <= 0 ? "Выходит сегодня" : `Осталось ${ev.daysLeft} дн.`}
              </div>
            </div>
          );
        })}
        {upcoming.map((ev: any) => {
          const Icon = ABSENCE_ICON[ev.kind] ?? Plane;
          return (
            <div key={`upcoming-${ev.id}`} className="rounded-md border border-dashed p-3" data-testid={`absence-upcoming-${ev.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border text-[11px] text-muted-foreground">
                  <Icon className="mr-1 h-3 w-3" />
                  {ABSENCE_LABEL[ev.kind] ?? ev.kind} · скоро
                </Badge>
              </div>
              <div className="mt-1.5 text-sm font-medium">{ev.fio}</div>
              <div className="num text-sm">
                с {ruDate(ev.startDate)} по {ruDate(ev.endDate)}
                {ev.destination ? ` · ${ev.destination}` : ""}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

const axis = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

function tooltipStyle() {
  return {
    contentStyle: {
      background: "hsl(var(--popover))",
      border: "1px solid hsl(var(--border))",
      borderRadius: 6,
      fontSize: 12,
      color: "hsl(var(--popover-foreground))",
    },
  };
}

function Delta({ c }: { c: { current: number; previous: number; deltaPct: number } }) {
  const up = c.deltaPct >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-1", up ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
      <Icon className="h-3.5 w-3.5" />
      {nf(Math.abs(c.deltaPct), 1)} %
    </span>
  );
}

/**
 * Тот же блок ПБК, но без рублей: режим «Только контроль работ».
 * Зависшая выручка → не описано / не распилено метров, цена смены → потеряно смен.
 */
function PbkNaturalBlock({ core }: { core?: any }) {
  const { data } = useQuery<any>({ queryKey: ["/api/pbk/analytics"] });
  if (!data?.kpi?.shifts) return null;
  const k = data.kpi;
  const chain: any[] = data.hanging?.chain ?? [];
  const gap = (stage: string) => Number(chain.find((c) => c.stage === stage)?.gap ?? 0);
  const descGap = gap("описание") || Number(core?.summary?.lagDescM ?? 0);
  const cutGap = gap("распиловка") || Number(core?.summary?.lagCutM ?? 0);
  const top = (data.loss?.byReason ?? []).slice(0, 4);
  return (
    <Section
      className="mb-4"
      title="Реальные данные ПБК: отставание переделов и потерянные смены"
      description="Режим контроля работ: всё в натуральных измерителях — метры и смены, без денег"
      actions={<Link href="/pbk"><Button size="sm" variant="outline" data-testid="button-open-pbk">Открыть раздел ПБК</Button></Link>}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi testId="kpi-pbk-not-described" label="Не описано керна" level="bad"
          value={`${nf(descGap, 1)} м`} hint="Описание отстаёт от бурения" />
        <Kpi testId="kpi-pbk-not-cut" label="Не распилено" level="bad"
          value={`${nf(cutGap, 1)} м`} hint="Распиловка отстаёт от бурения" />
        <Kpi testId="kpi-pbk-lost-shifts" label="Потеряно смен" level="bad"
          value={`${nf(k.lostShifts)} смен`} hint={`Из ${nf(k.shifts)} смен с нулевой проходкой`} />
        <Kpi testId="kpi-pbk-share" label="Доля результативных смен"
          level={k.productiveShare >= 70 ? "ok" : k.productiveShare >= 55 ? "warn" : "bad"}
          value={pct(k.productiveShare)} hint={`Всего смен ${nf(k.shifts)}, метров ${nf(k.meters)}`} />
      </div>
      {top.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {top.map((r: any) => (
            <div key={r.reason} className="rounded-md border p-3" data-testid={`card-pbk-reason-${r.reason}`}>
              <div className="text-xs text-muted-foreground">{r.reason}</div>
              <div className="num mt-1 text-sm font-semibold">{nf(r.shifts)} смен</div>
              <div className="text-xs text-muted-foreground">недобрано {nf(r.meters, 1)} м</div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/** Блок по реальным данным ПБК: считается в сменах, без часов простоя и ГСМ */
function PbkBlock() {
  const { data } = useQuery<any>({ queryKey: ["/api/pbk/analytics"] });
  if (!data?.kpi?.shifts) return null;
  const k = data.kpi;
  const top = (data.loss?.byReason ?? []).slice(0, 4);
  return (
    <Section
      className="mb-4"
      title="Реальные данные ПБК: зависшая выручка и потерянные смены"
      description="В сводках заказчика нет часов простоя и расхода ГСМ, поэтому потери считаются в сменах, а выручка — по расценкам календарного плана"
      actions={<Link href="/pbk"><Button size="sm" variant="outline" data-testid="button-open-pbk">Открыть раздел ПБК</Button></Link>}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi testId="kpi-pbk-hanging" label="Зависшая выручка" level="bad"
          value={money(k.hangingRevenue)} hint="Переделы отстают от бурения — выручка не выставлена" />
        <Kpi testId="kpi-pbk-lost" label="Цена потерянных смен" level="bad"
          value={money(k.lostShiftMoney)} hint={`${nf(k.lostShifts)} смен × ${money(k.lostShiftPrice)}`} />
        <Kpi testId="kpi-pbk-share" label="Доля результативных смен"
          level={k.productiveShare >= 70 ? "ok" : k.productiveShare >= 55 ? "warn" : "bad"}
          value={pct(k.productiveShare)} hint={`Всего смен ${nf(k.shifts)}, метров ${nf(k.meters)}`} />
        <Kpi testId="kpi-pbk-revenue" label="Выручка по факту"
          value={money(k.factRevenue)} hint="Фактические объёмы × расценки договора" />
      </div>
      {top.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {top.map((r: any) => (
            <div key={r.reason} className="rounded-md border p-3" data-testid={`card-pbk-reason-${r.reason}`}>
              <div className="text-xs text-muted-foreground">{r.reason}</div>
              <div className="num mt-1 text-sm font-semibold">{money(r.money)}</div>
              <div className="text-xs text-muted-foreground">{nf(r.shifts)} смен</div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

export default function Dashboard() {
  const { data, isLoading, error } = useAnalytics();
  const status = useStatus();
  const { toast } = useToast();
  const { finance, user } = useAuth();
  const roleLabel = user?.roleLabel ?? "";
  const [copied, setCopied] = useState(false);

  if (isLoading || status.isLoading) return <Loading rows={5} />;

  const st = status.data;
  // Программа ещё не заполнена — вместо пустых графиков показываем понятный баннер
  if (st && (!st.hasReference || !st.hasData)) {
    const noRefs = !st.hasReference;
    return (
      <>
        <PageHeader
          title="Дашборд"
          subtitle="Программа ещё не заполнена данными вашей организации."
        />
        <Card className="p-6" data-testid="banner-setup">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <h2 className="text-base font-semibold">
                {noRefs ? "Справочники пустые" : "Нет ни одного рапорта"}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {noRefs
                  ? "Графики и KPI считаются по объектам, станкам и сотрудникам. Пока их нет, показывать нечего. Пройдите мастер настройки за 5 шагов — это занимает несколько минут."
                  : "Структура заведена, но данных нет. Загрузите сменные рапорты — после этого заполнятся KPI, графики и сводка для директора."}
              </p>
              <div className="mt-3 text-xs text-muted-foreground" data-testid="text-setup-counts">
                Сейчас в базе: объектов {nf(st.counts?.objects ?? 0)}, станков {nf(st.counts?.rigs ?? 0)},
                рапортов {nf(st.counts?.reports ?? 0)}.
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/setup">
                  <Button size="sm" data-testid="button-banner-setup">
                    <Wand2 className="mr-2 h-4 w-4" />
                    Открыть мастер настройки
                  </Button>
                </Link>
                <Link href="/import">
                  <Button variant="outline" size="sm" data-testid="button-banner-import">
                    <Upload className="mr-2 h-4 w-4" />
                    Загрузить данные из Excel
                  </Button>
                </Link>
                <Link href="/settings">
                  <Button variant="ghost" size="sm" data-testid="button-banner-restore">
                    Вернуть демо-данные
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </Card>
      </>
    );
  }

  if (error || !data) return <ErrorBox text="Не удалось загрузить данные. Обновите страницу." />;

  const k = data.kpi;
  const th = data.thresholds;
  const s = data.summaries.day;
  const critical = data.flags.filter((f: any) => f.level === "критично");
  const warnings = data.flags.filter((f: any) => f.level !== "критично");

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(s.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      toast({ title: "Сводка скопирована", description: "Текст в буфере обмена — можно вставить в письмо или мессенджер." });
    } catch {
      toast({ title: "Не удалось скопировать", description: "Скопируйте текст вручную на экране «Сводка».", variant: "destructive" });
    }
  };

  const noData = k.factMeters === 0;

  return (
    <>
      <PageHeader
        title={roleLabel ? `Панель: ${roleLabel.toLowerCase()}` : "Панель управления"}
        subtitle={`Текущий период: ${k.monthLabel}. Данные на ${ruDate(data.nowIso)}`}
        actions={
          <>
            <ExportButton
              label="Выгрузить всё в Excel"
              testId="button-export-all"
              onClick={() => downloadFile("/api/export/all", "ГРР-Контроль.xlsx")}
            />
            <Button size="sm" onClick={copySummary} data-testid="button-copy-summary">
              {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
              Сводка для директора
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0">
      {/* 1. Текстовая сводка — самое главное, выше графиков */}
      <Card className="mb-4 p-4" data-testid="card-summary-short">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Коротко: что происходит</h2>
          <Link
            href="/summary"
            className="text-xs font-medium text-primary underline-offset-4 hover:underline dark:text-foreground"
            data-testid="link-full-summary"
          >
            Полная сводка →
          </Link>
        </div>
        <ul className="space-y-1.5 text-sm">
          {[...s.essence, ...s.conclusions.slice(0, 2)].map((line: string, i: number) => (
            <li key={i} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary dark:bg-foreground" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 border-t pt-3 text-sm">
          <span className="font-semibold">Что решить сегодня: </span>
          {s.actions[0] ?? "Критичных решений нет."}
        </div>
      </Card>

      {/* 2. Красные флаги */}
      <Section
        className="mb-4"
        title="Красные флаги"
        description={`Критично — ${critical.length}, внимание — ${warnings.length}`}
      >
        {data.flags.length === 0 ? (
          <Empty text="Отклонений выше порогов нет. Все объекты в норме." />
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {[...critical, ...warnings].slice(0, 8).map((f: any, i: number) => (
              <div
                key={i}
                className="rounded-md border p-3"
                data-testid={`flag-${i}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn("border text-[11px]", levelBadge[f.level === "критично" ? "bad" : "warn"])}
                  >
                    {f.level === "критично" ? (
                      <AlertTriangle className="mr-1 h-3 w-3" />
                    ) : null}
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

      {/* 2.5 Отпуска, больничные, командировки */}
      <AbsenceSection active={data.activeEmployeeEvents ?? []} upcoming={data.upcomingEmployeeEvents ?? []} />

      {/* 3. KPI */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          testId="kpi-meters"
          label="Метры за месяц"
          value={meters(k.factMeters)}
          hint={`План на дату ${nf(k.planToDate)} м · выполнение ${nf(k.planPct, 1)} %`}
          level={planLevel(k.planPct, th.planLagPct)}
        />
        <Kpi
          testId="kpi-per-shift"
          label="Метры на смену"
          value={nf(k.metersPerShift, 1)}
          hint="Среднее по всем станкам"
        />
        <Kpi
          testId="kpi-downtime"
          label="Доля простоев"
          value={pct(k.downtimeShare)}
          hint={`Порог ${nf(th.downtimeSharePct)} %`}
          level={overLevel(k.downtimeShare, th.downtimeSharePct / 2)}
        />
        {finance ? <Kpi
          testId="kpi-cost"
          label="Себестоимость метра"
          value={money(k.costPerMeter)}
          hint={`Выручка ${money(k.revenue)}`}
        /> : <Kpi
          testId="kpi-plan-lag"
          label="Отставание от плана"
          level={planLevel(k.planPct, th.planLagPct)}
          value={`${nf(Math.max(0, (k.planToDate ?? 0) - (k.factMeters ?? 0)))} м`}
          hint={`План на дату ${nf(k.planToDate)} м, факт ${nf(k.factMeters)} м`}
        />}
        {finance ? <Kpi
          testId="kpi-profit"
          label="Рентабельность"
          value={pct(k.profitability)}
          hint={`Маржа ${money(k.margin)}`}
          level={k.profitability >= 15 ? "ok" : k.profitability >= 5 ? "warn" : "bad"}
        /> : <Kpi
          testId="kpi-not-described"
          label="Не описано керна"
          level={Number(data.core?.summary?.lagDescM ?? 0) > 0 ? "warn" : "ok"}
          value={`${nf(data.core?.summary?.lagDescM ?? 0)} м`}
          hint={`Не распилено ${nf(data.core?.summary?.lagCutM ?? 0)} м`}
        />}
        <Kpi
          testId="kpi-people"
          label="Людей на вахте"
          value={`${nf(k.peopleOnSite)} / ${nf(k.staffRequired)}`}
          hint="Факт / штат по объектам"
          level={
            k.peopleOnSite >= k.staffRequired
              ? "ok"
              : k.peopleOnSite >= k.staffRequired * 0.85
                ? "warn"
                : "bad"
          }
        />
        {finance ? <Kpi
          testId="kpi-lost"
          label="Цена простоев"
          value={money(data.lostTotal.money)}
          hint={`${nf(data.lostTotal.hours, 1)} ч = ${nf(data.lostTotal.meters)} м`}
        /> : <Kpi
          testId="kpi-lost-meters"
          label="Потеряно метров на простоях"
          level="bad"
          value={`${nf(data.lostTotal.meters)} м`}
          hint={`${nf(data.lostTotal.hours, 1)} ч простоев за период`}
        />}
        <Kpi
          testId="kpi-week"
          label="Неделя к неделе"
          value={`${nf(data.comparisons.weekMeters.current)} м`}
          hint={`Было ${nf(data.comparisons.weekMeters.previous)} м`}
          level={data.comparisons.weekMeters.deltaPct >= 0 ? "ok" : "warn"}
        />
      </div>

      {/* 3a. Реальные данные ПБК: зависшая выручка и цена потерянных смен */}
      {finance ? <PbkBlock /> : <PbkNaturalBlock core={data.core} />}

      {/* 4. Объекты */}
      <Section className="mb-4" title="Объекты" description={finance ? "План, себестоимость и прогноз по договору" : "План, выполнение и простои по объектам"}>
        {data.byObject.length === 0 ? (
          <Empty text="Нет данных за выбранный период. Добавьте сменный рапорт." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-3">
            {data.byObject.map((o: any) => {
              const lvl: Level = planLevel(o.planPct, th.planLagPct);
              return (
                <div key={o.id} className="rounded-md border p-3" data-testid={`card-object-${o.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{o.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{o.customer}</div>
                    </div>
                    <Badge variant="outline" className={cn("shrink-0 border text-[11px]", levelBadge[lvl])}>
                      {nf(o.planPct, 1)} % плана
                    </Badge>
                  </div>
                  <dl className="mt-3 space-y-1.5 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Метры (факт / план)</dt>
                      <dd className="num font-medium">{nf(o.fact)} / {nf(o.planToDate)}</dd>
                    </div>
                    {finance && <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Себестоимость метра</dt>
                      <dd className={cn("num font-medium", levelText[overLevel(o.costDeviationPct, th.costOverPct)])}>
                        {money(o.costPerMeter)}
                      </dd>
                    </div>}
                    {finance && <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Рентабельность</dt>
                      <dd className="num font-medium">{pct(o.profitability)}</dd>
                    </div>}
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Простои</dt>
                      <dd className="num font-medium">{pct(o.downtimeShare)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Срок договора</dt>
                      <dd className="num font-medium">{ruDate(o.contractEnd)}</dd>
                    </div>
                  </dl>
                  <div
                    className={cn(
                      "mt-3 rounded border px-2 py-1.5 text-xs",
                      o.willMeet
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
                        : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
                    )}
                  >
                    {o.willMeet
                      ? `Прогноз: успеваем к сроку, темп ${nf(o.currentPerShift, 1)} м/смена`
                      : `Прогноз: опоздание ${nf(o.daysLate)} дн. Нужно ${nf(o.neededPerShift, 1)} м/смена вместо ${nf(o.currentPerShift, 1)}`}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* 5. Графики */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Динамика метров: план и факт" description="По дням, м">
          {noData ? (
            <Empty text="Нет данных за выбранный период. Добавьте сменный рапорт." />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.charts.metersByDay} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={axis} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tick={axis} width={46} />
                  <Tooltip {...tooltipStyle()} formatter={(v: any, n: any) => [`${nf(Number(v))} м`, n]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line isAnimationActive={false} type="monotone" dataKey="план" stroke={CHART_COLORS[3]} strokeDasharray="5 4" dot={false} strokeWidth={2} />
                  <Line isAnimationActive={false} type="monotone" dataKey="факт" stroke={CHART_COLORS[0]} dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Section>

        <Section title="Структура простоев" description="Часы по причинам за месяц">
          {data.charts.downtimeStructure.length === 0 ? (
            <Empty text="Простоев за период не зафиксировано." />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.charts.downtimeStructure}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="45%"
                    outerRadius="78%"
                    paddingAngle={1}
                  >
                    {data.charts.downtimeStructure.map((_: any, i: number) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip {...tooltipStyle()} formatter={(v: any, n: any) => [`${nf(Number(v), 1)} ч`, n]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Section>

        <Section title="Метры на смену по станкам" description="Среднее за месяц, м/смена">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.charts.perShiftByRig} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={axis} />
                <YAxis tick={axis} width={46} />
                <Tooltip {...tooltipStyle()} formatter={(v: any) => [`${nf(Number(v), 1)} м/смена`, "Выработка"]} />
                <Bar isAnimationActive={false} dataKey="м/смена" fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>

        {finance && <Section title="Себестоимость метра по объектам" description="Факт против сметы, ₽/м">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.charts.costPerMeterByObject} margin={{ top: 5, right: 8, left: -6, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={axis} />
                <YAxis tick={axis} width={62} tickFormatter={(v: any) => nf(Number(v))} />
                <Tooltip {...tooltipStyle()} formatter={(v: any, n: any) => [money(Number(v)), n]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar isAnimationActive={false} dataKey="смета" fill={CHART_COLORS[1]} radius={[3, 3, 0, 0]} />
                <Bar isAnimationActive={false} dataKey="факт" fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>}
      </div>

      {/* 5.1 Пробоподготовка и керн */}
      {data.samplePrep && data.core && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Section
            title="Пробоподготовка"
            description="Движение проб, лаборатории и стоимость анализов"
            actions={
              <Link
                href="/sampleprep"
                className="text-xs font-medium text-primary underline-offset-4 hover:underline dark:text-foreground"
                data-testid="link-dash-sampleprep"
              >
                Раздел →
              </Link>
            }
          >
            {data.samplePrep.totals.samples === 0 ? (
              <Empty text="Проб пока нет. Заведите пробы в разделе «Пробоподготовка» или загрузите их из Excel." />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Kpi
                    testId="kpi-dash-samples"
                    label="Проб всего"
                    value={nf(data.samplePrep.totals.samples)}
                    hint={`В работе ${nf(data.samplePrep.totals.inWork)} · с результатом ${nf(data.samplePrep.totals.done)}`}
                  />
                  <Kpi
                    testId="kpi-dash-cycle"
                    label="Цикл отбор → результат"
                    value={`${nf(data.samplePrep.cycle.total, 1)} дн.`}
                    hint={`Подготовка ${nf(data.samplePrep.cycle.prep, 1)} + лаборатория ${nf(data.samplePrep.cycle.lab, 1)}`}
                  />
                  <Kpi
                    testId="kpi-dash-bottleneck"
                    label="Узкое место"
                    value={data.samplePrep.worstStage?.stage ?? "—"}
                    hint={
                      data.samplePrep.worstStage
                        ? `${nf(data.samplePrep.worstStage.count)} проб в очереди`
                        : "Заторов нет"
                    }
                    level={data.samplePrep.worstStage?.bottleneck ? "bad" : "ok"}
                  />
                  {finance && <Kpi
                    testId="kpi-dash-assaycost"
                    label="Стоимость анализов"
                    value={money(data.samplePrep.totals.analysisCost)}
                    hint={`${money(data.samplePrep.totals.costPerMeter)} на метр проходки`}
                  />}
                </div>
                <div className="mt-3 text-xs text-muted-foreground" data-testid="text-dash-prep-note">
                  Рудных интервалов по результатам: {nf(data.samplePrep.results.oreCount)} проб ·
                  плотность опробования {nf(data.samplePrep.totals.samplesPerMeter, 2)} проб/м ·
                  брак проб {nf(data.samplePrep.totals.rejectPct, 1)} %
                </div>
              </>
            )}
          </Section>

          <Section
            title="Керн: описание и распиловка"
            description="Отставание документации и распиловки от бурения"
            actions={
              <Link
                href="/core"
                className="text-xs font-medium text-primary underline-offset-4 hover:underline dark:text-foreground"
                data-testid="link-dash-core"
              >
                Раздел →
              </Link>
            }
          >
            {data.core.summary.drilled === 0 ? (
              <Empty text="Нет данных по керну. Внесите описание и распиловку или загрузите их из Excel." />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Kpi
                    testId="kpi-dash-described"
                    label="Описано керна"
                    value={`${nf(data.core.summary.describedPct, 1)} %`}
                    hint={`${nf(data.core.summary.described)} м из ${nf(data.core.summary.drilled)} м`}
                    level={
                      data.core.summary.describedPct >= 90
                        ? "ok"
                        : data.core.summary.describedPct >= 75
                          ? "warn"
                          : "bad"
                    }
                  />
                  <Kpi
                    testId="kpi-dash-lagdesc"
                    label="Отставание описания"
                    value={`${nf(data.core.summary.lagDescM)} м`}
                    hint={`Это ${nf(data.core.summary.lagDescDays, 1)} дн. работы геолога`}
                    level={data.core.summary.lagDescM >= (th.coreLagMeters ?? 250) ? "bad" : "warn"}
                  />
                  <Kpi
                    testId="kpi-dash-lagcut"
                    label="Отставание распиловки"
                    value={`${nf(data.core.summary.lagCutM)} м`}
                    hint={`Распилено ${nf(data.core.summary.cutPct, 1)} % · ${nf(data.core.summary.lagCutDays, 1)} дн. работы`}
                    level={data.core.summary.lagCutM >= (th.cutLagMeters ?? 350) ? "bad" : "warn"}
                  />
                  <Kpi
                    testId="kpi-dash-worsthole"
                    label="Худшая скважина"
                    value={data.core.worstHole?.hole ?? "—"}
                    hint={
                      data.core.worstHole
                        ? `${nf(data.core.worstHole.lagDescPct, 0)} % отставания, тренд: ${data.core.worstHole.trend}`
                        : "Отставаний нет"
                    }
                    level={data.core.worstHole ? "bad" : "ok"}
                  />
                </div>
                <div className="mt-3 text-xs text-muted-foreground" data-testid="text-dash-core-note">
                  Темп описания {nf(data.core.summary.logRate, 1)} м/день, распиловки{" "}
                  {nf(data.core.cutting.perShift, 1)} м/смена · средний выход керна{" "}
                  {nf(data.core.logging.avgRecovery, 1)} %
                </div>
              </>
            )}
          </Section>
        </div>
      )}

      {/* 6. Сравнение с прошлым периодом */}
      <Section className="mt-4" title="Сравнение с прошлым периодом">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Метры за неделю", data.comparisons.weekMeters, "м"],
            ["Метры за месяц", data.comparisons.monthMeters, "м"],
            ["Доля простоев (нед.)", data.comparisons.weekDowntimeShare, "%"],
            ["Метры на смену (нед.)", data.comparisons.weekPerShift, "м"],
          ].map(([label, c, unit]: any, i: number) => (
            <div key={i} className="rounded-md border p-3" data-testid={`compare-${i}`}>
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="num mt-1 text-lg font-semibold">
                {nf(c.current, 1)} {unit}
              </div>
              <div className="mt-1 text-xs">
                <Delta c={c} />{" "}
                <span className="text-muted-foreground">к прошлому: {nf(c.previous, 1)} {unit}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>
      </div>

      <div className="min-w-0">
        <NotesPanel />
      </div>
      </div>
    </>
  );
}
