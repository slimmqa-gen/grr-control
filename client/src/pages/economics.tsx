import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar,
  XAxis, YAxis, CartesianGrid,
} from "recharts";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAnalytics, useList, useReference } from "@/lib/hooks";
import { PageHeader, Section, Empty, Loading, ErrorBox, ExportButton, Kpi } from "@/components/shell";
import { nf, money, pct, downloadFile, CHART_COLORS, overLevel, levelText, levelBadge } from "@/lib/app";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EstimatesTab, CalendarTab, ForecastTab } from "@/components/estimates";

const CATEGORIES = [
  "ГСМ", "Зарплата", "Буровой инструмент", "Транспорт",
  "Содержание лагеря", "Ремонты", "Прочее/накладные",
];

const axis = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const tt = {
  contentStyle: {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 6,
    fontSize: 12,
    color: "hsl(var(--popover-foreground))",
  },
};

export default function Economics() {
  const { data, isLoading, error } = useAnalytics();
  const { data: ref } = useReference();
  const costs = useList<any>("/api/costs");
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ objectId: "", month: new Date().toISOString().slice(0, 7), category: "ГСМ", amount: "" });
  const [formError, setFormError] = useState("");

  const objects: any[] = ref?.objects ?? [];
  const nameOf = (id: number) => objects.find((o) => o.id === id)?.name ?? "—";

  const byMonth = useMemo(() => {
    const map = new Map<string, any>();
    for (const c of costs.data ?? []) {
      const key = `${c.month}|${c.objectId}`;
      if (!map.has(key)) map.set(key, { month: c.month, objectId: c.objectId, total: 0, cats: {} as any });
      const row = map.get(key);
      row.total += c.amount;
      row.cats[c.category] = (row.cats[c.category] ?? 0) + c.amount;
    }
    return [...map.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
  }, [costs.data]);

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/costs", {
        objectId: Number(form.objectId),
        month: form.month,
        category: form.category,
        amount: Number(form.amount || 0),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setShowForm(false);
      setForm({ ...form, amount: "" });
      toast({ title: "Затраты добавлены" });
    },
    onError: (e: any) => setFormError(String(e.message)),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/costs/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Запись удалена" });
    },
  });

  if (isLoading) return <Loading rows={4} />;
  if (error || !data) return <ErrorBox text="Не удалось загрузить экономику. Обновите страницу." />;

  const k = data.kpi;
  const th = data.thresholds;

  return (
    <>
      <PageHeader
        title="Экономика"
        subtitle={`Смета против факта, ${k.monthLabel}`}
        actions={
          <>
            <ExportButton
              testId="button-export-economics"
              onClick={() => downloadFile("/api/export/economics", "Экономика.xlsx")}
            />
            <Button size="sm" onClick={() => setShowForm((v) => !v)} data-testid="button-add-cost">
              <Plus className="mr-2 h-4 w-4" />
              Добавить затраты
            </Button>
          </>
        }
      />

      <Tabs defaultValue="costs" className="w-full">
        <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start gap-1 sm:w-auto">
          <TabsTrigger value="costs" data-testid="tab-costs">Затраты и факт</TabsTrigger>
          <TabsTrigger value="estimates" data-testid="tab-estimates">Сметы</TabsTrigger>
          <TabsTrigger value="calendar" data-testid="tab-calendar">Календарный план</TabsTrigger>
          <TabsTrigger value="forecast" data-testid="tab-forecast">Освоение и прогноз</TabsTrigger>
        </TabsList>

        <TabsContent value="costs" className="mt-0 space-y-0">
      {showForm && (
        <Card className="mb-4 p-4" data-testid="form-cost">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Объект</label>
              <Select value={form.objectId} onValueChange={(v) => setForm({ ...form, objectId: v })}>
                <SelectTrigger data-testid="select-cost-object"><SelectValue placeholder="Выберите объект" /></SelectTrigger>
                <SelectContent>
                  {objects.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Месяц</label>
              <Input type="month" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} data-testid="input-cost-month" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Статья</label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger data-testid="select-cost-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Сумма, ₽</label>
              <Input inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="input-cost-amount" placeholder="0" />
            </div>
          </div>
          {formError && <div className="mt-3"><ErrorBox text={formError} /></div>}
          <div className="mt-4 flex gap-2">
            <Button
              onClick={() => {
                setFormError("");
                if (!form.objectId) return setFormError("Выберите объект.");
                if (!form.amount || Number(form.amount) < 0) return setFormError("Введите сумму затрат.");
                create.mutate();
              }}
              disabled={create.isPending}
              data-testid="button-save-cost"
            >
              Сохранить
            </Button>
            <Button variant="ghost" onClick={() => setShowForm(false)} data-testid="button-cancel-cost">Отмена</Button>
          </div>
        </Card>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi testId="kpi-revenue" label="Выручка (месяц)" value={money(k.revenue)} />
        <Kpi testId="kpi-costs" label="Затраты (месяц)" value={money(k.revenue - k.margin)} />
        <Kpi testId="kpi-margin" label="Маржа" value={money(k.margin)} level={k.margin > 0 ? "ok" : "bad"} />
        <Kpi
          testId="kpi-profitability"
          label="Рентабельность"
          value={pct(k.profitability)}
          level={k.profitability >= 15 ? "ok" : k.profitability >= 5 ? "warn" : "bad"}
        />
      </div>

      <Section className="mb-4" title="Смета и факт по объектам" description="Зелёный — в смете, жёлтый — небольшое отклонение, красный — перерасход">
        {data.byObject.length === 0 ? (
          <Empty text="Нет данных за выбранный период. Добавьте сменный рапорт." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm" data-testid="table-economics">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Объект</th>
                  <th className="py-2 pr-3 text-right font-medium">Метры</th>
                  <th className="py-2 pr-3 text-right font-medium">Смета, ₽/м</th>
                  <th className="py-2 pr-3 text-right font-medium">Факт, ₽/м</th>
                  <th className="py-2 pr-3 text-right font-medium">Отклонение</th>
                  <th className="py-2 pr-3 text-right font-medium">Выручка</th>
                  <th className="py-2 pr-3 text-right font-medium">Затраты</th>
                  <th className="py-2 pr-3 text-right font-medium">Маржа</th>
                  <th className="py-2 text-right font-medium">Рентабельность</th>
                </tr>
              </thead>
              <tbody>
                {data.byObject.map((o: any) => {
                  const lvl = overLevel(o.costDeviationPct, th.costOverPct);
                  return (
                    <tr key={o.id} className="border-b last:border-0" data-testid={`row-econ-${o.id}`}>
                      <td className="py-2 pr-3 font-medium whitespace-nowrap">{o.name}</td>
                      <td className="num py-2 pr-3 text-right">{nf(o.fact)}</td>
                      <td className="num py-2 pr-3 text-right">{nf(o.plannedCostPerMeter)}</td>
                      <td className={cn("num py-2 pr-3 text-right font-medium", levelText[lvl])}>{nf(o.costPerMeter)}</td>
                      <td className="py-2 pr-3 text-right">
                        <Badge variant="outline" className={cn("num border text-[11px]", levelBadge[lvl])}>
                          {o.costDeviationPct > 0 ? "+" : ""}{nf(o.costDeviationPct, 1)} %
                        </Badge>
                      </td>
                      <td className="num py-2 pr-3 text-right">{money(o.revenue)}</td>
                      <td className="num py-2 pr-3 text-right">{money(o.costs)}</td>
                      <td className={cn("num py-2 pr-3 text-right", o.margin >= 0 ? "" : "text-red-700 dark:text-red-400")}>
                        {money(o.margin)}
                      </td>
                      <td className="num py-2 text-right">{pct(o.profitability)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Структура затрат" description="Доли статей за месяц, ₽">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie isAnimationActive={false} data={data.charts.costStructure} dataKey="value" nameKey="name" innerRadius="45%" outerRadius="78%" paddingAngle={1}>
                  {data.charts.costStructure.map((_: any, i: number) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip {...tt} formatter={(v: any, n: any) => [money(Number(v)), n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Себестоимость метра" description="Факт против сметы, ₽/м">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.charts.costPerMeterByObject} margin={{ top: 5, right: 8, left: -6, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={axis} />
                <YAxis tick={axis} width={62} tickFormatter={(v: any) => nf(Number(v))} />
                <Tooltip {...tt} formatter={(v: any, n: any) => [money(Number(v)), n]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar isAnimationActive={false} dataKey="смета" fill={CHART_COLORS[1]} radius={[3, 3, 0, 0]} />
                <Bar isAnimationActive={false} dataKey="факт" fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>

      <Section className="mt-4" title="Затраты по месяцам и объектам">
        {costs.isLoading ? (
          <Loading rows={2} />
        ) : byMonth.length === 0 ? (
          <Empty text="Затраты не внесены. Загрузите файл затрат или добавьте запись вручную." />
        ) : (
          <div className="sticky-head max-h-[50vh] overflow-auto">
            <table className="w-full min-w-[860px] text-sm" data-testid="table-costs">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Месяц</th>
                  <th className="py-2 pr-3 font-medium">Объект</th>
                  {CATEGORIES.map((c) => (
                    <th key={c} className="py-2 pr-3 text-right font-medium whitespace-nowrap">{c}</th>
                  ))}
                  <th className="py-2 text-right font-medium">Итого</th>
                </tr>
              </thead>
              <tbody>
                {byMonth.map((r, i) => (
                  <tr key={i} className="border-b last:border-0" data-testid={`row-cost-${i}`}>
                    <td className="num py-2 pr-3 whitespace-nowrap">{r.month}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{nameOf(r.objectId)}</td>
                    {CATEGORIES.map((c) => (
                      <td key={c} className="num py-2 pr-3 text-right">{nf(r.cats[c] ?? 0)}</td>
                    ))}
                    <td className="num py-2 text-right font-medium">{nf(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section className="mt-4" title="Записи затрат" description="Последние 50 записей — можно удалить ошибочную">
        {(costs.data ?? []).length === 0 ? (
          <Empty text="Записей нет." />
        ) : (
          <div className="max-h-[40vh] overflow-auto">
            <table className="w-full min-w-[560px] text-sm">
              <tbody>
                {[...(costs.data ?? [])].slice(-50).reverse().map((c: any) => (
                  <tr key={c.id} className="border-b last:border-0" data-testid={`row-cost-item-${c.id}`}>
                    <td className="num py-2 pr-3 whitespace-nowrap">{c.month}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{nameOf(c.objectId)}</td>
                    <td className="py-2 pr-3">{c.category}</td>
                    <td className="num py-2 pr-3 text-right">{money(c.amount)}</td>
                    <td className="py-2 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Удалить запись"
                        onClick={() => remove.mutate(c.id)}
                        data-testid={`button-delete-cost-${c.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
        </TabsContent>

        <TabsContent value="estimates" className="mt-0"><EstimatesTab /></TabsContent>
        <TabsContent value="calendar" className="mt-0"><CalendarTab /></TabsContent>
        <TabsContent value="forecast" className="mt-0"><ForecastTab /></TabsContent>
      </Tabs>
    </>
  );
}
