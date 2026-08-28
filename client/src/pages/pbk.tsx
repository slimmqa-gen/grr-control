import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  RefreshCw, Database, Plus, Trash2, RotateCcw, FileSpreadsheet, TrendingDown, Wallet,
  AlertTriangle, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader, Section, Empty, Loading, ErrorBox, TableWrap } from "@/components/shell";
import { nf, money, pct, ruDate, levelText, type Level } from "@/lib/app";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

const TABLES: Array<{ code: string; label: string }> = [
  { code: "pbk_shifts", label: "Смены бурения" },
  { code: "pbk_geo", label: "Документация и опробование" },
  { code: "pbk_holes", label: "Реестр скважин" },
  { code: "pbk_litho", label: "Литология" },
  { code: "pbk_prep", label: "Пробоподготовка ЦПП" },
  { code: "pbk_trenches", label: "Канавы (план-факт)" },
  { code: "pbk_trench_daily", label: "Дневник по канавам" },
  { code: "pbk_moves", label: "Движение проб" },
  { code: "pbk_plan_lines", label: "Календарный план" },
  { code: "pbk_cost_calc", label: "Карта-предложение" },
];

/** Русские подписи к техническим именам колонок */
const COL: Record<string, string> = {
  date: "Дата", sheet: "Лист", object: "Участок", contract: "Договор", master: "Мастер", rig: "Станок",
  shift_master: "Бурильщик (поле «Смена»)", hole: "Скважина", hole_project: "Скважина по проекту",
  from_m: "От, м", to_m: "До, м", meters: "Метры", plan_depth: "Проектная глубина",
  comment: "Комментарий", loss_category: "Категория потери", incident: "Авария", source_file: "Файл",
  kind: "Вид работ", length_m: "Длина, м", executor: "Исполнитель", samples: "Проб", note: "Примечание",
  site: "Зона / участок", tdepth: "Глубина факт", td_pro: "Глубина проект", planned: "В проекте",
  azimuth: "Азимут", dip: "Угол", geologist: "Геолог", status: "Статус",
  code: "Код породы", thickness: "Мощность, м", veins: "Прожилки", ore: "Рудный",
  crushed: "Дробление", milled: "Истирание", shipped: "Отправлено", received: "Поступило", xrf: "РФА",
  agr: "№ АГР", plan_len: "План, м", state: "Состояние", clean_m: "Зачистка, м", clean_pct: "Зачистка, %",
  doc_m: "Документация, м", doc_pct: "Документация, %", groove_n: "Бороздовых проб",
  groove_m: "Бороздовых, м", chip_n: "Точечных проб", chip_m: "Точечных, м",
  name: "Наименование работ", unit: "Ед. изм.", rate: "Расценка, ₽", total_qty: "Объём по плану",
  total_cost: "Стоимость, ₽", work_kind: "Передел", is_group: "Заголовок", item: "Статья затрат",
  amount: "Сумма, ₽", per_meter: "На 1 п.м., ₽", qty: "Количество", from_place: "Откуда", to_place: "Куда",
};
const colLabel = (c: string) => COL[c] ?? c;

function Kpi({
  title, value, hint, tone = "ok", icon: Icon, testId,
}: { title: string; value: string; hint?: string; tone?: Level; icon: any; testId: string }) {
  return (
    <Card className="p-4" data-testid={testId}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
        <Icon className={cn("h-4 w-4 shrink-0", levelText[tone])} />
      </div>
      <p className={cn("mt-2 text-xl font-semibold tabular-nums", levelText[tone])}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

export default function PbkPage() {
  const { toast } = useToast();
  const { finance } = useAuth();
  const analytics = useQuery<any>({ queryKey: ["/api/pbk/analytics"] });
  const imports = useQuery<any>({ queryKey: ["/api/pbk/imports"] });
  const profiles = useQuery<any[]>({ queryKey: ["/api/pbk/profiles"] });
  const reasons = useQuery<any>({ queryKey: ["/api/pbk/reasons"] });
  const [table, setTable] = useState("pbk_shifts");
  const rows = useQuery<any>({ queryKey: ["/api/pbk/data", table], queryFn: async () =>
    (await apiRequest("GET", `/api/pbk/data/${table}?limit=300`)).json() });
  const [newReason, setNewReason] = useState({ category: "", keyword: "" });

  const reload = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/pbk/load-all", {})).json(),
    onSuccess: (d: any) => {
      toast({ title: "Файлы заказчика перезагружены", description: `Строк по таблицам: ${Object.values(d.counts ?? {}).reduce((a: any, b: any) => a + b, 0)}` });
      queryClient.invalidateQueries();
    },
    onError: (e: any) => toast({ title: "Ошибка загрузки", description: e.message, variant: "destructive" }),
  });
  const demo = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/pbk/restore-demo", {})).json(),
    onSuccess: () => { toast({ title: "Возвращены демонстрационные данные" }); queryClient.invalidateQueries(); },
  });
  const addReason = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/pbk/reasons", newReason)).json(),
    onSuccess: (d: any) => {
      setNewReason({ category: "", keyword: "" });
      toast({ title: "Слово добавлено", description: `Пересчитано смен: ${d.reclassified}` });
      queryClient.invalidateQueries();
    },
    onError: (e: any) => toast({ title: "Не добавлено", description: e.message, variant: "destructive" }),
  });
  const delReason = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/pbk/reasons/${id}`)).json(),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const resetReasons = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/pbk/reasons/reset", {})).json(),
    onSuccess: () => { toast({ title: "Словарь причин восстановлен" }); queryClient.invalidateQueries(); },
  });

  if (analytics.isLoading) return <Loading rows={4} />;
  if (analytics.error) return <ErrorBox text={(analytics.error as any).message} />;
  const a = analytics.data;
  const k = a?.kpi ?? {};
  // В режиме контроля работ (раздел «Экономика» скрыт) рубли заменяются на натуральные измерители
  const gapOf = (stage: string) =>
    Number((a?.hanging?.chain ?? []).find((c: any) => c.stage === stage)?.gap ?? 0);

  return (
    <div className="space-y-4" data-testid="page-pbk">
      <PageHeader
        title="Реальные данные ПБК"
        subtitle="Восемь встроенных профилей под файлы ООО «Производственно-Буровая Компания»: сводки принимаются как есть, потери считаются в сменах, выручка — по расценкам календарного плана"
        actions={
          <>
            <Button variant="outline" onClick={() => reload.mutate()} disabled={reload.isPending} data-testid="button-reload-pbk">
              <RefreshCw className={cn("mr-2 h-4 w-4", reload.isPending && "animate-spin")} />
              Перечитать файлы заказчика
            </Button>
            <Button variant="ghost" onClick={() => demo.mutate()} disabled={demo.isPending} data-testid="button-restore-demo">
              <RotateCcw className="mr-2 h-4 w-4" />
              Вернуть демо-данные
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {finance ? (
          <>
            <Kpi testId="kpi-hanging" title="Зависшая выручка" tone="bad" icon={TrendingDown}
              value={money(k.hangingRevenue)}
              hint="Отставание описания, опробования и анализов от бурения в рублях невыставленной выручки" />
            <Kpi testId="kpi-lost-money" title="Цена потерянных смен" tone="bad" icon={AlertTriangle}
              value={money(k.lostShiftMoney)}
              hint={`${nf(k.lostShifts)} смен с нулевой проходкой × ${money(k.lostShiftPrice)}`} />
            <Kpi testId="kpi-revenue" title="Выручка по факту" tone="ok" icon={Wallet}
              value={money(k.factRevenue)}
              hint="Фактические объёмы × расценки календарного плана" />
          </>
        ) : (
          <>
            <Kpi testId="kpi-not-described" title="Не описано керна" tone="bad" icon={TrendingDown}
              value={`${nf(gapOf("описание"), 1)} м`}
              hint="Разрыв между пробуренными и описанными метрами" />
            <Kpi testId="kpi-not-cut" title="Не распилено" tone="bad" icon={Layers}
              value={`${nf(gapOf("распиловка"), 1)} м`}
              hint="Отставание распиловки от бурения" />
            <Kpi testId="kpi-lost-shifts" title="Потеряно смен" tone="bad" icon={AlertTriangle}
              value={`${nf(k.lostShifts)} смен`}
              hint={`Смены с нулевой проходкой из ${nf(k.shifts)} всего`} />
          </>
        )}
        <Kpi testId="kpi-productive" title="Доля результативных смен" tone={k.productiveShare >= 70 ? "ok" : k.productiveShare >= 55 ? "warn" : "bad"}
          icon={Layers} value={pct(k.productiveShare)}
          hint={`${nf(k.shifts)} смен, ${nf(k.meters)} м проходки, аварий и прихватов: ${nf(k.incidents)}`} />
      </div>

      <Tabs defaultValue="chain">
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="chain" data-testid="tab-chain">{finance ? "Зависшая выручка" : "Отставание переделов"}</TabsTrigger>
          <TabsTrigger value="loss" data-testid="tab-loss">Смены и потери</TabsTrigger>
          <TabsTrigger value="objects" data-testid="tab-objects">Участки и бурильщики</TabsTrigger>
          {finance && <TabsTrigger value="plan" data-testid="tab-plan">Расценки и план</TabsTrigger>}
          <TabsTrigger value="files" data-testid="tab-files">Файлы и профили</TabsTrigger>
          <TabsTrigger value="data" data-testid="tab-data">Загруженные данные</TabsTrigger>
          <TabsTrigger value="reasons" data-testid="tab-reasons">Словарь причин</TabsTrigger>
        </TabsList>

        {/* ---------- цепочка ---------- */}
        <TabsContent value="chain" className="mt-3 space-y-4">
          <Section
            title="Цепочка: бурение → описание → распиловка → опробование → дробление → анализы"
            description={`Период сводок ${ruDate(a.hanging.period.from)} — ${ruDate(a.hanging.period.to)}. Норматив проб: ${nf(a.hanging.samplesPerMeter, 2)} пробы на 1 п.м. по календарному плану`}
          >
            <TableWrap>
              <table className="w-full min-w-[760px] text-sm" data-testid="table-chain">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Передел</th>
                    <th className="py-2 pr-3 text-right font-medium">Нужно</th>
                    <th className="py-2 pr-3 text-right font-medium">Сделано</th>
                    <th className="py-2 pr-3 text-right font-medium">Отставание</th>
                    {finance && <th className="py-2 pr-3 text-right font-medium">Расценка</th>}
                    {finance && <th className="py-2 pr-3 text-right font-medium">Зависшая выручка</th>}
                    <th className="py-2 text-right font-medium">Готовность</th>
                  </tr>
                </thead>
                <tbody>
                  {a.hanging.chain.map((c: any) => (
                    <tr key={c.stage} className="border-b last:border-0" data-testid={`row-chain-${c.stage}`}>
                      <td className="py-2 pr-3 font-medium">{c.stage}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{nf(c.base, 1)} {c.unit}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{nf(c.fact, 1)} {c.unit}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{c.gap > 0 ? nf(c.gap, 1) : "—"}</td>
                      {finance && <td className="py-2 pr-3 text-right tabular-nums">{money(c.rate)}</td>}
                      {finance && <td className={cn("py-2 pr-3 text-right font-semibold tabular-nums", c.money > 0 ? levelText.bad : levelText.ok)}>
                        {c.money > 0 ? money(c.money) : "—"}
                      </td>}
                      <td className={cn("py-2 text-right tabular-nums", levelText[c.done >= 90 ? "ok" : c.done >= 70 ? "warn" : "bad"])}>
                        {pct(c.done)}
                      </td>
                    </tr>
                  ))}
                  {finance ? (
                    <tr className="bg-muted/50 font-semibold">
                      <td className="py-2 pr-3" colSpan={5}>Итого зависшая выручка</td>
                      <td className={cn("py-2 pr-3 text-right tabular-nums", levelText.bad)} data-testid="text-hanging-total">{money(a.hanging.total)}</td>
                      <td />
                    </tr>
                  ) : (
                    <tr className="bg-muted/50 font-semibold">
                      <td className="py-2 pr-3" colSpan={3}>Итого отставание по переделам</td>
                      <td className={cn("py-2 pr-3 text-right tabular-nums", levelText.bad)} data-testid="text-hanging-total-natural">
                        {nf((a.hanging.chain ?? []).reduce((s: number, c: any) => s + (c.gap || 0), 0), 1)}
                      </td>
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </TableWrap>
          </Section>

          {finance && <Section title="Выручка по факту в разрезе переделов" description="Фактический объём × расценка календарного плана">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={a.revenue.lines.filter((l: any) => l.money > 0)} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                  <XAxis dataKey="stage" tick={{ fontSize: 11 }} interval={0} angle={-12} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1e6)} млн`} />
                  <RTooltip formatter={(v: any) => money(Number(v))} />
                  <Bar dataKey="money" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <TableWrap maxH="40vh">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Вид работ</th>
                    <th className="py-2 pr-3 text-right font-medium">Факт</th>
                    <th className="py-2 pr-3 text-right font-medium">Расценка</th>
                    <th className="py-2 pr-3 text-right font-medium">Сумма</th>
                    <th className="py-2 font-medium">Источник расценки</th>
                  </tr>
                </thead>
                <tbody>
                  {a.revenue.lines.map((l: any) => (
                    <tr key={l.stage} className="border-b last:border-0">
                      <td className="py-2 pr-3">{l.stage}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{nf(l.qty, 1)} {l.unit}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(l.rate)}</td>
                      <td className="py-2 pr-3 text-right font-medium tabular-nums">{money(l.money)}</td>
                      <td className="py-2 text-xs text-muted-foreground">{l.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Section>}
        </TabsContent>

        {/* ---------- потери ---------- */}
        <TabsContent value="loss" className="mt-3 space-y-4">
          <Section
            title="Потерянные смены и их цена"
            description={finance
              ? `В реальных сводках нет часов простоя и расхода ГСМ, поэтому потери считаются в сменах. Цена одной смены = средняя проходка результативной смены (${nf(a.loss.avgProductive, 2)} м) × ставка бурения ${money(a.loss.drillRate)}/п.м.`
              : `Потери считаются в сменах и недобранных метрах. Средняя проходка результативной смены — ${nf(a.loss.avgProductive, 2)} м`}
          >
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={a.loss.byReason} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.3} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => (finance ? `${Math.round(v / 1e6)} млн` : nf(Number(v)))} />
                  <YAxis type="category" dataKey="reason" width={170} tick={{ fontSize: 11 }} />
                  <RTooltip formatter={(v: any, n: any) => (n === "money" ? money(Number(v)) : nf(Number(v)))} />
                  <Bar dataKey={finance ? "money" : "shifts"} radius={[0, 4, 4, 0]}>
                    {a.loss.byReason.map((_: any, i: number) => (
                      <Cell key={i} fill={`hsl(var(--chart-${(i % 5) + 1}))`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <TableWrap maxH="45vh">
              <table className="w-full min-w-[720px] text-sm" data-testid="table-loss">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Причина (по тексту комментария)</th>
                    <th className="py-2 pr-3 text-right font-medium">Смен</th>
                    <th className="py-2 pr-3 text-right font-medium">Недобрано метров</th>
                    {finance && <th className="py-2 pr-3 text-right font-medium">Цена потери</th>}
                    <th className="py-2 font-medium">Примеры комментариев</th>
                  </tr>
                </thead>
                <tbody>
                  {a.loss.byReason.map((r: any) => (
                    <tr key={r.reason} className="border-b last:border-0" data-testid={`row-reason-${r.reason}`}>
                      <td className="py-2 pr-3 font-medium">{r.reason}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{nf(r.shifts)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{nf(r.meters, 1)}</td>
                      {finance && <td className={cn("py-2 pr-3 text-right font-semibold tabular-nums", levelText.bad)}>{money(r.money)}</td>}
                      <td className="py-2 text-xs text-muted-foreground">{r.comments.slice(0, 2).join(" · ") || "комментарий не заполнен"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Section>

          <Section title="Динамика по месяцам" description="Результативные и потерянные смены по участкам">
            <TableWrap maxH="45vh">
              <table className="w-full min-w-[640px] text-sm" data-testid="table-monthly">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Месяц</th>
                    <th className="py-2 pr-3 font-medium">Участок</th>
                    <th className="py-2 pr-3 text-right font-medium">Смен</th>
                    <th className="py-2 pr-3 text-right font-medium">Результативных</th>
                    <th className="py-2 pr-3 text-right font-medium">Потеряно</th>
                    <th className="py-2 pr-3 text-right font-medium">Метры</th>
                    <th className="py-2 text-right font-medium">Доля</th>
                  </tr>
                </thead>
                <tbody>
                  {a.monthly.map((m: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-3">{m.month}</td>
                      <td className="py-2 pr-3">{m.object}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{nf(m.shifts)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{nf(m.productive)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{nf(m.lost)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{nf(m.meters, 1)}</td>
                      <td className={cn("py-2 text-right tabular-nums", levelText[m.productiveShare >= 70 ? "ok" : m.productiveShare >= 55 ? "warn" : "bad"])}>
                        {pct(m.productiveShare)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Section>
        </TabsContent>

        {/* ---------- участки ---------- */}
        <TabsContent value="objects" className="mt-3 space-y-4">
          <Section title="Участки" description="Договоры, станки и мастера из шапок реальных сводок">
            <TableWrap>
              <table className="w-full min-w-[900px] text-sm" data-testid="table-objects">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Участок</th>
                    <th className="py-2 pr-3 font-medium">Договор</th>
                    <th className="py-2 pr-3 font-medium">Мастер</th>
                    <th className="py-2 pr-3 font-medium">Станки</th>
                    <th className="py-2 pr-3 text-right font-medium">Смен</th>
                    <th className="py-2 pr-3 text-right font-medium">Потеряно</th>
                    <th className="py-2 pr-3 text-right font-medium">Метры</th>
                    <th className="py-2 pr-3 text-right font-medium">Доля результативных</th>
                    {finance && <th className="py-2 text-right font-medium">Цена потерь</th>}
                  </tr>
                </thead>
                <tbody>
                  {a.objects.map((o: any) => (
                    <tr key={o.object} className="border-b last:border-0" data-testid={`row-object-${o.object}`}>
                      <td className="py-2 pr-3 font-medium">{o.object}</td>
                      <td className="py-2 pr-3">{o.contract || "—"}</td>
                      <td className="py-2 pr-3">{o.master || "—"}</td>
                      <td className="py-2 pr-3">{o.rigs || "не указан"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{nf(o.shifts)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{nf(o.lost)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{nf(o.meters, 1)}</td>
                      <td className={cn("py-2 pr-3 text-right tabular-nums", levelText[o.productiveShare >= 70 ? "ok" : o.productiveShare >= 55 ? "warn" : "bad"])}>{pct(o.productiveShare)}</td>
                      {finance && <td className={cn("py-2 text-right tabular-nums", levelText.bad)}>{money(o.lostMoney)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Section>

          <Section title="Бурильщики" description="Поле «Смена» в сводках заполняется фамилией бурильщика — это рейтинг по людям, а не по дню и ночи">
            <TableWrap maxH="50vh">
              <table className="w-full min-w-[760px] text-sm" data-testid="table-crews">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Бурильщик</th>
                    <th className="py-2 pr-3 font-medium">Участок</th>
                    <th className="py-2 pr-3 text-right font-medium">Смен</th>
                    <th className="py-2 pr-3 text-right font-medium">Потеряно</th>
                    <th className="py-2 pr-3 text-right font-medium">Метры</th>
                    <th className="py-2 pr-3 text-right font-medium">Среднее за смену</th>
                    <th className="py-2 text-right font-medium">Аварии</th>
                  </tr>
                </thead>
                <tbody>
                  {a.crews.map((c: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">{c.master}</td>
                      <td className="py-2 pr-3">{c.object}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{nf(c.shifts)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{nf(c.lost)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{nf(c.meters, 1)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{nf(c.avg, 2)}</td>
                      <td className="py-2 text-right tabular-nums">{nf(c.incidents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Section>
        </TabsContent>

        {/* ---------- расценки ---------- */}
        <TabsContent value="plan" className="mt-3 space-y-4">
          <Section title="План и факт по календарным планам" description="Объёмы и суммы из приложений № 2 к договорам против фактических объёмов сводок">
            <TableWrap maxH="55vh">
              <table className="w-full min-w-[860px] text-sm" data-testid="table-planfact">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Договор</th>
                    <th className="py-2 pr-3 font-medium">Вид работ</th>
                    <th className="py-2 pr-3 text-right font-medium">Расценка</th>
                    <th className="py-2 pr-3 text-right font-medium">План</th>
                    <th className="py-2 pr-3 text-right font-medium">Сумма плана</th>
                    <th className="py-2 pr-3 text-right font-medium">Факт</th>
                    <th className="py-2 pr-3 text-right font-medium">Сумма факта</th>
                    <th className="py-2 text-right font-medium">Выполнение</th>
                  </tr>
                </thead>
                <tbody>
                  {a.planFact.map((p: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-3">{p.contract || "—"}</td>
                      <td className="py-2 pr-3 font-medium">{p.work_kind}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(p.rate)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{nf(p.planQty, 1)} {p.unit}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(p.planCost)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{nf(p.factQty, 1)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(p.factCost)}</td>
                      <td className={cn("py-2 text-right tabular-nums", levelText[p.pct >= 90 ? "ok" : p.pct >= 60 ? "warn" : "bad"])}>{pct(p.pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Section>

          <Section title="Пробоподготовка ЦПП и очередь проб" description="Из сводки ЦПП: дробление, истирание, отправка и поступление проб">
            <div className="grid grid-cols-2 gap-3 p-1 sm:grid-cols-5">
              {[["Дроблено", a.prep.totals.crushed], ["Истёрто", a.prep.totals.milled],
                ["Отправлено", a.prep.totals.shipped], ["Поступило", a.prep.totals.received],
                ["РФА", a.prep.totals.xrf]].map(([label, v]: any) => (
                <Card key={label} className="p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{nf(v)}</p>
                </Card>
              ))}
            </div>
            {a.prep.last && (
              <p className="px-1 pt-2 text-sm text-muted-foreground" data-testid="text-prep-queue">
                Очередь в ЦПП на последнюю дату сводки: <b>{nf(a.prep.last.queue)}</b> проб, запас работы <b>{nf(a.prep.last.days, 1)}</b> дней.
              </p>
            )}
          </Section>

          <Section title="Скважины и канавы" description="Реестр СВЯЗЬ С ММ и сводка горных работ">
            <div className="grid grid-cols-2 gap-3 p-1 sm:grid-cols-4">
              {[["Скважин всего", a.holes.total], ["В проекте", a.holes.planned],
                ["Пробурено", a.holes.drilled], ["Метров по факту", a.holes.metersFact],
                ["Канав", a.trenches.count], ["Зачищено, м", a.trenches.cleanM],
                ["Задокументировано, м", a.trenches.docM], ["Бороздовых проб", a.trenches.grooveN]].map(([label, v]: any) => (
                <Card key={label} className="p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{nf(v, 0)}</p>
                </Card>
              ))}
            </div>
          </Section>
        </TabsContent>

        {/* ---------- файлы и профили ---------- */}
        <TabsContent value="files" className="mt-3 space-y-4">
          <Section title="Встроенные профили" description="Профили распознают файлы заказчика по строкам-маркерам, без ручной настройки колонок">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {(profiles.data ?? []).map((p) => (
                <Card key={p.code} className="p-4" data-testid={`card-profile-${p.code}`}>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold">{p.name}</h3>
                    <Badge variant="secondary">{nf(p.uses)} листов</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{p.about}</p>
                  <p className="mt-2 text-xs">
                    <span className="text-muted-foreground">Маркеры: </span>{p.markers.join(" · ")}
                  </p>
                </Card>
              ))}
            </div>
          </Section>

          <Section title="Журнал загрузки файлов заказчика" description="По каждому файлу — какие листы распознаны, сколько строк загружено и что пропущено">
            {imports.isLoading ? <Loading rows={2} /> : (imports.data?.imports ?? []).length === 0 ? (
              <Empty text="Файлы ещё не загружены" />
            ) : (
              <div className="space-y-3">
                {imports.data.imports.map((im: any) => (
                  <Card key={im.id} className="p-3" data-testid={`card-import-${im.id}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{im.file}</span>
                      <Badge variant="secondary">{im.profile || "не распознан"}</Badge>
                      <span className="text-xs text-muted-foreground">
                        загружено {nf(im.rows_loaded)} строк, пропущено {nf(im.rows_skipped)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Листы: {im.sheets.join(", ")}</p>
                    {im.notes.length > 0 && (
                      <ul className="mt-1 list-inside list-disc text-xs text-amber-700 dark:text-amber-400">
                        {im.notes.slice(0, 5).map((n: string, i: number) => <li key={i}>{n}</li>)}
                      </ul>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </Section>
        </TabsContent>

        {/* ---------- данные ---------- */}
        <TabsContent value="data" className="mt-3 space-y-4">
          <Section
            title="Загруженные данные"
            description="Первые 300 строк выбранной таблицы — так, как их разобрали профили"
            actions={
              <Select value={table} onValueChange={setTable}>
                <SelectTrigger className="w-[260px]" data-testid="select-table"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TABLES.map((t) => (
                    <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          >
            {rows.isLoading ? <Loading rows={3} /> : !rows.data?.rows?.length ? (
              <Empty text="В таблице нет строк" />
            ) : (
              <>
                <p className="pb-2 text-xs text-muted-foreground">Всего строк в таблице: {nf(rows.data.total)}</p>
                <TableWrap maxH="60vh">
                  <table className="w-full text-xs" data-testid="table-rows">
                    <thead>
                      <tr className="border-b text-left uppercase tracking-wide text-muted-foreground">
                        {Object.keys(rows.data.rows[0]).filter((c) => c !== "id").map((c) => (
                          <th key={c} className="whitespace-nowrap py-2 pr-3 font-medium">{colLabel(c)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.data.rows.map((r: any) => (
                        <tr key={r.id} className="border-b last:border-0">
                          {Object.keys(rows.data.rows[0]).filter((c) => c !== "id").map((c) => (
                            <td key={c} className="max-w-[280px] truncate py-1.5 pr-3">{String(r[c] ?? "")}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              </>
            )}
          </Section>
        </TabsContent>

        {/* ---------- словарь ---------- */}
        <TabsContent value="reasons" className="mt-3 space-y-4">
          <Section
            title="Словарь причин потерянных смен"
            description="Смена с нулевой проходкой получает категорию по первому совпавшему слову в комментарии. Словарь можно дополнять — категории пересчитываются сразу"
            actions={
              <Button variant="outline" onClick={() => resetReasons.mutate()} data-testid="button-reset-reasons">
                <RotateCcw className="mr-2 h-4 w-4" /> Вернуть словарь по умолчанию
              </Button>
            }
          >
            <div className="flex flex-col gap-2 pb-3 sm:flex-row">
              <Input placeholder="Категория, например «ГИС и каротаж»" value={newReason.category}
                onChange={(e) => setNewReason((v) => ({ ...v, category: e.target.value }))}
                data-testid="input-reason-category" />
              <Input placeholder="Ключевое слово в комментарии" value={newReason.keyword}
                onChange={(e) => setNewReason((v) => ({ ...v, keyword: e.target.value }))}
                data-testid="input-reason-keyword" />
              <Button onClick={() => addReason.mutate()} disabled={addReason.isPending} data-testid="button-add-reason">
                <Plus className="mr-2 h-4 w-4" /> Добавить
              </Button>
            </div>
            {reasons.isLoading ? <Loading rows={2} /> : (
              <div className="space-y-3">
                {(reasons.data?.categories ?? []).map((cat: string) => (
                  <div key={cat}>
                    <p className="text-sm font-medium">{cat}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {reasons.data.reasons.filter((r: any) => r.category === cat).map((r: any) => (
                        <Badge key={r.id} variant="secondary" className="gap-1" data-testid={`badge-keyword-${r.id}`}>
                          {r.keyword}
                          <button onClick={() => delReason.mutate(r.id)} aria-label="Удалить слово"
                            className="ml-1 text-muted-foreground hover:text-destructive" data-testid={`button-del-reason-${r.id}`}>
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
