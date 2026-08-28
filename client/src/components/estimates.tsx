import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line,
} from "recharts";
import { Plus, Trash2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useReference } from "@/lib/hooks";
import { Section, Empty, Loading, ErrorBox, Kpi } from "@/components/shell";
import { nf, money, pct, CHART_COLORS, levelText } from "@/lib/app";
import { cn } from "@/lib/utils";

const axis = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const tt = {
  contentStyle: {
    background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))",
    borderRadius: 6, fontSize: 12, color: "hsl(var(--popover-foreground))",
  },
};

export function useEstimates() {
  return useQuery<any>({ queryKey: ["/api/estimates"] });
}

function EstimatePicker({
  data, value, onChange,
}: { data: any; value: string; onChange: (v: string) => void }) {
  const list: any[] = data?.analytics?.byEstimate ?? [];
  if (list.length < 2) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-72" data-testid="select-estimate">
        <SelectValue placeholder="Выберите смету" />
      </SelectTrigger>
      <SelectContent>
        {list.map((e) => (
          <SelectItem key={e.id} value={String(e.id)}>{e.object}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ==================== Вкладка «Сметы» ==================== */

export function EstimatesTab() {
  const { data, isLoading, error } = useEstimates();
  const { data: ref } = useReference();
  const { toast } = useToast();
  const [sel, setSel] = useState("");
  const [showLine, setShowLine] = useState(false);
  const [line, setLine] = useState({ section: "прямые", item: "", unit: "руб.", qty: "", price: "" });
  const [showEst, setShowEst] = useState(false);
  const [est, setEst] = useState({ objectId: "", contract: "", version: "3", planMeters: "", note: "" });

  const list: any[] = data?.analytics?.byEstimate ?? [];
  const cur = list.find((e) => String(e.id) === sel) ?? list[0];

  const addLine = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/estimate-lines", {
      estimateId: cur.id, section: line.section, item: line.item, workType: "бурение",
      unit: line.unit, qty: Number(line.qty || 0), price: Number(line.price || 0),
      amount: Number(line.qty || 0) * Number(line.price || 0),
    })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setShowLine(false);
      setLine({ section: "прямые", item: "", unit: "руб.", qty: "", price: "" });
      toast({ title: "Статья добавлена в смету" });
    },
    onError: (e: any) => toast({ title: "Не удалось сохранить", description: e.message, variant: "destructive" }),
  });

  const addEst = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/estimates", {
      objectId: Number(est.objectId), contract: est.contract, version: Number(est.version || 1),
      validFrom: new Date().toISOString().slice(0, 10), validTo: "",
      planMeters: Number(est.planMeters || 0), active: true, note: est.note,
    })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setShowEst(false);
      toast({ title: "Новая версия сметы создана и сделана действующей" });
    },
    onError: (e: any) => toast({ title: "Не удалось сохранить", description: e.message, variant: "destructive" }),
  });

  const delLine = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/estimate-lines/${id}`)).json(),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  if (isLoading) return <Loading rows={3} />;
  if (error) return <ErrorBox text="Раздел смет недоступен для вашей роли или не удалось загрузить данные." />;
  if (!cur) return <Empty text="Сметы пока не загружены. Создайте смету по договору." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <EstimatePicker data={data} value={String(cur.id)} onChange={setSel} />
        <Button size="sm" onClick={() => setShowEst((v) => !v)} data-testid="button-add-estimate">
          <Plus className="mr-2 h-4 w-4" /> Новая версия сметы
        </Button>
      </div>

      {showEst && (
        <Card className="p-4" data-testid="form-estimate">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="mb-1 block text-xs font-medium">Объект</label>
              <Select value={est.objectId} onValueChange={(v) => setEst({ ...est, objectId: v })}>
                <SelectTrigger data-testid="select-estimate-object"><SelectValue placeholder="Объект" /></SelectTrigger>
                <SelectContent>
                  {(ref?.objects ?? []).map((o: any) => (
                    <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Договор</label>
              <Input value={est.contract} onChange={(e) => setEst({ ...est, contract: e.target.value })} data-testid="input-estimate-contract" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Версия</label>
              <Input inputMode="numeric" value={est.version} onChange={(e) => setEst({ ...est, version: e.target.value })} data-testid="input-estimate-version" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Объём по смете, м</label>
              <Input inputMode="numeric" value={est.planMeters} onChange={(e) => setEst({ ...est, planMeters: e.target.value })} data-testid="input-estimate-meters" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Примечание</label>
              <Input value={est.note} onChange={(e) => setEst({ ...est, note: e.target.value })} data-testid="input-estimate-note" />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => addEst.mutate()} disabled={!est.objectId || addEst.isPending} data-testid="button-save-estimate">Сохранить</Button>
            <Button variant="ghost" onClick={() => setShowEst(false)}>Отмена</Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi testId="kpi-estimate-total" label="Смета по договору" value={money(cur.total)} hint={`${nf(cur.planMeters)} м`} />
        <Kpi testId="kpi-plan-cpm" label="Плановая себестоимость метра" value={`${money(cur.planCostPerMeter)}/м`} />
        <Kpi
          testId="kpi-fact-cpm" label="Фактическая себестоимость метра"
          value={`${money(cur.factCostPerMeter)}/м`}
          hint={`отклонение ${cur.cpmDeviationPct > 0 ? "+" : ""}${cur.cpmDeviationPct}%`}
          level={cur.cpmDeviationPct > 10 ? "bad" : cur.cpmDeviationPct > 0 ? "warn" : "ok"}
        />
        <Kpi
          testId="kpi-forecast-result" label="Прогноз финансового результата"
          value={money(cur.forecastResult)} level={cur.forecastResult > 0 ? "ok" : "bad"}
          hint={`выручка ${money(cur.contractRevenue)}`}
        />
      </div>

      <Section title="Статьи сметы и отклонения" description="План приведён к выполненному объёму работ" actions={
        <Button size="sm" variant="outline" onClick={() => setShowLine((v) => !v)} data-testid="button-add-line">
          <Plus className="mr-2 h-4 w-4" /> Статья
        </Button>
      }>
        {showLine && (
          <div className="mb-4 grid gap-3 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="form-line">
            <div>
              <label className="mb-1 block text-xs font-medium">Раздел</label>
              <Select value={line.section} onValueChange={(v) => setLine({ ...line, section: v })}>
                <SelectTrigger data-testid="select-line-section"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="прямые">прямые</SelectItem>
                  <SelectItem value="накладные">накладные</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Статья</label>
              <Input value={line.item} onChange={(e) => setLine({ ...line, item: e.target.value })} data-testid="input-line-item" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Ед. изм.</label>
              <Input value={line.unit} onChange={(e) => setLine({ ...line, unit: e.target.value })} data-testid="input-line-unit" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Объём</label>
              <Input inputMode="numeric" value={line.qty} onChange={(e) => setLine({ ...line, qty: e.target.value })} data-testid="input-line-qty" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Расценка, ₽</label>
              <Input inputMode="numeric" value={line.price} onChange={(e) => setLine({ ...line, price: e.target.value })} data-testid="input-line-price" />
            </div>
            <div className="flex items-end gap-2 lg:col-span-5">
              <Button size="sm" onClick={() => addLine.mutate()} disabled={!line.item || addLine.isPending} data-testid="button-save-line">Сохранить</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowLine(false)}>Отмена</Button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm" data-testid="table-estimate-lines">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Статья</th>
                <th className="py-2 pr-3 font-medium">Раздел</th>
                <th className="py-2 pr-3 text-right font-medium">Смета, ₽</th>
                <th className="py-2 pr-3 text-right font-medium">Доля</th>
                <th className="py-2 pr-3 text-right font-medium">План на объём</th>
                <th className="py-2 pr-3 text-right font-medium">Факт</th>
                <th className="py-2 pr-3 text-right font-medium">Отклонение</th>
                <th className="py-2 text-right font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {cur.articles.map((a: any) => (
                <tr key={a.id} className="border-b last:border-0" data-testid={`row-article-${a.id}`}>
                  <td className="py-2 pr-3 font-medium">{a.item}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{a.section}</td>
                  <td className="num py-2 pr-3 text-right">{nf(a.amount)}</td>
                  <td className="num py-2 pr-3 text-right text-muted-foreground">{a.sharePct}%</td>
                  <td className="num py-2 pr-3 text-right">{nf(a.planToDate)}</td>
                  <td className="num py-2 pr-3 text-right">{nf(a.fact)}</td>
                  <td className={cn("num py-2 pr-3 text-right font-medium", a.deviation > 0 ? levelText.bad : levelText.ok)}>
                    {a.deviation > 0 ? "+" : ""}{nf(a.deviation)} ({a.deviationPct > 0 ? "+" : ""}{a.deviationPct}%)
                  </td>
                  <td className="py-2 text-right">
                    <Button variant="ghost" size="icon" aria-label="Удалить статью"
                      onClick={() => delLine.mutate(a.id)} data-testid={`button-delete-line-${a.id}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {cur.culprit && (
          <p className="mt-3 text-xs text-muted-foreground" data-testid="text-culprit">
            Главный вклад в перерасход — статья «{cur.culprit.item}»: {money(cur.culprit.deviation)} сверх плана
            на выполненный объём.
          </p>
        )}
      </Section>

      <Section title="Расценка за метр по интервалам глубин" description="Чем глубже интервал, тем выше расценка">
        {cur.rates.length === 0 ? <Empty text="Интервальные расценки не заданы." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm" data-testid="table-depth-rates">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Вид бурения</th>
                  <th className="py-2 pr-3 font-medium">Диаметр</th>
                  <th className="py-2 pr-3 text-right font-medium">Интервал, м</th>
                  <th className="py-2 text-right font-medium">Расценка, ₽/м</th>
                </tr>
              </thead>
              <tbody>
                {cur.rates.map((r: any) => (
                  <tr key={r.id} className="border-b last:border-0" data-testid={`row-rate-${r.id}`}>
                    <td className="py-2 pr-3">{r.drillType}</td>
                    <td className="py-2 pr-3">{r.diameter}</td>
                    <td className="num py-2 pr-3 text-right">{nf(r.fromDepth)}–{nf(r.toDepth)}</td>
                    <td className="num py-2 text-right font-medium">{money(r.pricePerMeter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Версии смет" description="Действующая версия используется в расчётах себестоимости">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm" data-testid="table-estimate-versions">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Объект</th>
                <th className="py-2 pr-3 font-medium">Договор</th>
                <th className="py-2 pr-3 text-right font-medium">Версия</th>
                <th className="py-2 pr-3 font-medium">Действует с</th>
                <th className="py-2 pr-3 text-right font-medium">Сумма</th>
                <th className="py-2 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {(data?.analytics?.versions ?? []).map((v: any) => (
                <tr key={v.id} className="border-b last:border-0" data-testid={`row-version-${v.id}`}>
                  <td className="py-2 pr-3 whitespace-nowrap">{v.object}</td>
                  <td className="py-2 pr-3">{v.contract}</td>
                  <td className="num py-2 pr-3 text-right">{v.version}</td>
                  <td className="num py-2 pr-3 whitespace-nowrap">{v.validFrom}</td>
                  <td className="num py-2 pr-3 text-right">{money(v.total)}</td>
                  <td className="py-2">
                    {v.active
                      ? <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> действующая</Badge>
                      : <span className="text-xs text-muted-foreground">архив</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

/* ==================== Вкладка «Календарный план» ==================== */

export function CalendarTab() {
  const { data, isLoading, error } = useEstimates();
  const [sel, setSel] = useState("");
  const list: any[] = data?.analytics?.byEstimate ?? [];
  const cur = list.find((e) => String(e.id) === sel) ?? list[0];

  const chart = useMemo(() => (cur?.months ?? []).map((m: any) => ({
    name: m.month, план: m.planMeters, факт: m.factMeters,
  })), [cur]);

  if (isLoading) return <Loading rows={3} />;
  if (error) return <ErrorBox text="Календарные планы недоступны для вашей роли." />;
  if (!cur) return <Empty text="Календарный план не задан." />;

  return (
    <div className="space-y-4">
      <EstimatePicker data={data} value={String(cur.id)} onChange={setSel} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi testId="kpi-plan-to-date" label="План на сегодня" value={`${nf(cur.planToDateMeters)} м`} />
        <Kpi testId="kpi-fact-meters" label="Выполнено" value={`${nf(cur.factMeters)} м`} />
        <Kpi
          testId="kpi-lag-meters" label="Отставание в метрах"
          value={`${cur.lagMeters > 0 ? "" : "+"}${nf(Math.abs(cur.lagMeters))} м`}
          level={cur.lagMeters > 0 ? "bad" : "ok"}
        />
        <Kpi
          testId="kpi-lag-days" label="Отставание в днях"
          value={`${nf(Math.abs(cur.lagDays), 1)} дн.`}
          level={cur.lagDays > 10 ? "bad" : cur.lagDays > 0 ? "warn" : "ok"}
          hint={cur.lagDays > 0 ? "нужно наверстать" : "идём с опережением"}
        />
      </div>

      <Section title="План и факт по месяцам" description="Метры за месяц: столбцы плана против факта">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={axis} />
              <YAxis tick={axis} />
              <Tooltip {...tt} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="план" fill={CHART_COLORS[1]} radius={[3, 3, 0, 0]} />
              <Bar dataKey="факт" fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm" data-testid="table-calendar">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Месяц</th>
                <th className="py-2 pr-3 font-medium">Вид работ</th>
                <th className="py-2 pr-3 text-right font-medium">План, м</th>
                <th className="py-2 pr-3 text-right font-medium">Факт, м</th>
                <th className="py-2 pr-3 text-right font-medium">Отклонение</th>
                <th className="py-2 pr-3 text-right font-medium">Выполнение</th>
                <th className="py-2 text-right font-medium">Затраты факт</th>
              </tr>
            </thead>
            <tbody>
              {cur.months.map((m: any) => (
                <tr key={m.month} className={cn("border-b last:border-0", m.current && "bg-muted/40")} data-testid={`row-month-${m.month}`}>
                  <td className="num py-2 pr-3 whitespace-nowrap">{m.month}{m.current && " (текущий)"}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{m.workType}</td>
                  <td className="num py-2 pr-3 text-right">{nf(m.planMeters)}</td>
                  <td className="num py-2 pr-3 text-right">{nf(m.factMeters)}</td>
                  <td className={cn("num py-2 pr-3 text-right", m.deltaMeters < 0 ? levelText.bad : levelText.ok)}>
                    {m.deltaMeters > 0 ? "+" : ""}{nf(m.deltaMeters)}
                  </td>
                  <td className="num py-2 pr-3 text-right">{pct(m.donePct)}</td>
                  <td className="num py-2 text-right">{money(m.factCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Этапы договора" description="Просроченные этапы попадают в предупреждения на дашборде">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm" data-testid="table-stages">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Этап</th>
                <th className="py-2 pr-3 font-medium">План</th>
                <th className="py-2 pr-3 font-medium">Факт</th>
                <th className="py-2 pr-3 font-medium">Статус</th>
                <th className="py-2 text-right font-medium">Задержка, дн.</th>
              </tr>
            </thead>
            <tbody>
              {cur.stages.map((s: any) => (
                <tr key={s.id} className="border-b last:border-0" data-testid={`row-stage-${s.id}`}>
                  <td className="py-2 pr-3 font-medium">{s.stage}</td>
                  <td className="num py-2 pr-3 whitespace-nowrap">{s.planStart} — {s.planEnd}</td>
                  <td className="num py-2 pr-3 whitespace-nowrap">{s.factStart || "—"} — {s.factEnd || "—"}</td>
                  <td className="py-2 pr-3">
                    <Badge variant={s.status === "просрочен" ? "destructive" : "secondary"}>{s.status}</Badge>
                  </td>
                  <td className={cn("num py-2 text-right", s.delayDays > 0 ? levelText.bad : "")}>
                    {s.delayDays > 0 ? s.delayDays : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

/* ==================== Вкладка «Освоение и прогноз» ==================== */

export function ForecastTab() {
  const { data, isLoading, error } = useEstimates();
  if (isLoading) return <Loading rows={3} />;
  if (error) return <ErrorBox text="Прогноз недоступен для вашей роли." />;
  const a = data?.analytics;
  const list: any[] = a?.byEstimate ?? [];
  if (!list.length) return <Empty text="Нет действующих смет для расчёта прогноза." />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi testId="kpi-total-estimate" label="Сметы по договорам" value={money(a.totals.estimateTotal)} />
        <Kpi testId="kpi-total-fact" label="Освоено фактически" value={money(a.totals.factCost)} />
        <Kpi
          testId="kpi-total-forecast" label="Прогноз итоговой себестоимости"
          value={money(a.totals.forecastCost)}
          level={a.totals.forecastCost > a.totals.estimateTotal ? "bad" : "ok"}
        />
        <Kpi
          testId="kpi-total-result" label="Прогноз финансового результата"
          value={money(a.totals.forecastResult)} level={a.totals.forecastResult > 0 ? "ok" : "bad"}
        />
      </div>

      <Section title="Освоение сметы против выполнения объёма" description="Если освоение обгоняет объём — деньги тратятся быстрее, чем бурятся метры">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={a.charts.spendVsVolume}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={axis} />
              <YAxis tick={axis} unit="%" />
              <Tooltip {...tt} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="освоение сметы" fill={CHART_COLORS[2]} radius={[3, 3, 0, 0]} />
              <Bar dataKey="выполнение объёма" fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Себестоимость метра: смета и факт">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={a.charts.cpmPlanFact}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={axis} />
              <YAxis tick={axis} />
              <Tooltip {...tt} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="смета" stroke={CHART_COLORS[1]} strokeWidth={2} dot />
              <Line type="monotone" dataKey="факт" stroke={CHART_COLORS[3]} strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Прогноз, безубыточность и цена простоя" description="Расчёт по действующей смете каждого объекта">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm" data-testid="table-forecast">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Объект</th>
                <th className="py-2 pr-3 text-right font-medium">Освоение сметы</th>
                <th className="py-2 pr-3 text-right font-medium">Выполнение объёма</th>
                <th className="py-2 pr-3 text-right font-medium">Прогноз себестоимости</th>
                <th className="py-2 pr-3 text-right font-medium">Прогноз результата</th>
                <th className="py-2 pr-3 text-right font-medium">Безубыточность</th>
                <th className="py-2 pr-3 text-right font-medium">Час простоя</th>
                <th className="py-2 text-right font-medium">Потери на простоях</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className="border-b last:border-0" data-testid={`row-forecast-${e.id}`}>
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">{e.object}</td>
                  <td className="num py-2 pr-3 text-right">{pct(e.spendPct)}</td>
                  <td className={cn("num py-2 pr-3 text-right", e.gapPP > 10 ? levelText.bad : "")}>{pct(e.volumePct)}</td>
                  <td className="num py-2 pr-3 text-right">{money(e.forecastCost)}</td>
                  <td className={cn("num py-2 pr-3 text-right font-medium", e.forecastResult > 0 ? levelText.ok : levelText.bad)}>
                    {money(e.forecastResult)}
                  </td>
                  <td className="num py-2 pr-3 text-right">{nf(e.breakEvenMeters)} м ({e.breakEvenPct}%)</td>
                  <td className="num py-2 pr-3 text-right">{money(e.idleHourCost)}/ч</td>
                  <td className="num py-2 text-right">{money(e.idleLoss)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Точка безубыточности: объём в метрах, при котором маржа покрывает накладные расходы.
          Стоимость часа простоя — накладные за час плюс упущенная маржа по метрам, которые станок мог пробурить.
        </p>
      </Section>

      <Section title="Структура отклонений по статьям" description="Пять самых крупных отклонений по каждому объекту">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={a.charts.articleDeviation} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" tick={axis} />
              <YAxis type="category" dataKey="name" tick={axis} width={140} />
              <Tooltip {...tt} />
              <Bar dataKey="отклонение" fill={CHART_COLORS[3]} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>
    </div>
  );
}
