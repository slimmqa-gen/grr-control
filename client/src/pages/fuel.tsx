import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { useAnalytics } from "@/lib/hooks";
import { PageHeader, Section, Empty, Loading, ErrorBox, ExportButton, Kpi } from "@/components/shell";
import {
  nf, pct, ruDate, downloadFile, CHART_COLORS, overLevel, levelBadge, levelText,
  type Level,
} from "@/lib/app";
import { cn } from "@/lib/utils";

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

export default function FuelPage() {
  const { data, isLoading, error } = useAnalytics();

  if (isLoading) return <Loading rows={4} />;
  if (error || !data) return <ErrorBox text="Не удалось загрузить данные по ГСМ. Обновите страницу." />;

  const th = data.thresholds;
  const t = data.fuelTotals;
  const chartData = data.charts.fuelByObject.map((f: any) => ({
    name: f.object.replace("Участок ", ""),
    норма: f.norm,
    факт: f.fact,
  }));
  const critical = data.stock.filter((s: any) => s.status !== "норма").length;

  return (
    <>
      <PageHeader
        title="ГСМ и запасы"
        subtitle="Норма и фактический расход топлива, остатки ТМЦ и запас в днях"
        actions={
          <ExportButton
            testId="button-export-fuel"
            onClick={() => downloadFile("/api/export/fuel", "ГСМ и запасы.xlsx")}
          />
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi testId="kpi-fuel-norm" label="Норма расхода" value={`${nf(t.norm)} л`} hint="За месяц по всем объектам" />
        <Kpi testId="kpi-fuel-fact" label="Фактический расход" value={`${nf(t.fact)} л`} />
        <Kpi
          testId="kpi-fuel-dev"
          label="Отклонение от нормы"
          value={`${t.deviationPct > 0 ? "+" : ""}${nf(t.deviationPct, 1)} %`}
          level={overLevel(t.deviationPct, th.fuelOverPct)}
          hint={`Порог ${nf(th.fuelOverPct)} %`}
        />
        <Kpi
          testId="kpi-stock-alert"
          label="Позиций ниже нормы"
          value={nf(critical)}
          level={critical === 0 ? "ok" : "bad"}
          hint={`Минимальный запас — ${nf(th.stockDaysMin)} дн.`}
        />
      </div>

      <Section className="mb-4" title="Расход топлива по объектам" description="Норма и факт за месяц, л">
        {chartData.length === 0 ? (
          <Empty text="Нет данных по ГСМ за выбранный период. Загрузите файл расхода топлива." />
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 8, left: -6, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={axis} />
                <YAxis tick={axis} width={58} tickFormatter={(v: any) => nf(Number(v))} />
                <Tooltip {...tt} formatter={(v: any, n: any) => [`${nf(Number(v))} л`, n]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar isAnimationActive={false} dataKey="норма" fill={CHART_COLORS[1]} radius={[3, 3, 0, 0]} />
                <Bar isAnimationActive={false} dataKey="факт" fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      <Section className="mb-4" title="Расход по технике" description="Норма против факта за месяц">
        {data.fuelByUnit.length === 0 ? (
          <Empty text="Нет данных по ГСМ за выбранный период. Загрузите файл расхода топлива." />
        ) : (
          <div className="sticky-head max-h-[50vh] overflow-auto">
            <table className="w-full min-w-[640px] text-sm" data-testid="table-fuel">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Техника</th>
                  <th className="py-2 pr-3 font-medium">Объект</th>
                  <th className="py-2 pr-3 text-right font-medium">Норма, л</th>
                  <th className="py-2 pr-3 text-right font-medium">Факт, л</th>
                  <th className="py-2 pr-3 text-right font-medium">Отклонение, л</th>
                  <th className="py-2 text-right font-medium">Отклонение, %</th>
                </tr>
              </thead>
              <tbody>
                {data.fuelByUnit.map((f: any, i: number) => {
                  const lvl = overLevel(f.deviationPct, th.fuelOverPct);
                  return (
                    <tr key={i} className="border-b last:border-0" data-testid={`row-fuel-${i}`}>
                      <td className="py-2 pr-3 font-medium whitespace-nowrap">{f.unitName}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{f.object}</td>
                      <td className="num py-2 pr-3 text-right">{nf(f.norm)}</td>
                      <td className="num py-2 pr-3 text-right">{nf(f.fact)}</td>
                      <td className="num py-2 pr-3 text-right">{f.deviation > 0 ? "+" : ""}{nf(f.deviation)}</td>
                      <td className={cn("num py-2 text-right font-medium", levelText[lvl])}>
                        {f.deviationPct > 0 ? "+" : ""}{nf(f.deviationPct, 1)} %
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Остатки на складе" description="Хватит на N дней при текущем расходе">
        {data.stock.length === 0 ? (
          <Empty text="Остатки не внесены. Загрузите файл остатков ТМЦ." />
        ) : (
          <div className="sticky-head max-h-[60vh] overflow-auto">
            <table className="w-full min-w-[760px] text-sm" data-testid="table-stock">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Позиция</th>
                  <th className="py-2 pr-3 font-medium">Объект</th>
                  <th className="py-2 pr-3 text-right font-medium">Остаток</th>
                  <th className="py-2 pr-3 text-right font-medium">Минимум</th>
                  <th className="py-2 pr-3 text-right font-medium">Расход в сутки</th>
                  <th className="py-2 pr-3 text-right font-medium">Хватит, дн.</th>
                  <th className="py-2 pr-3 font-medium">Поставка</th>
                  <th className="py-2 font-medium">Статус</th>
                </tr>
              </thead>
              <tbody>
                {data.stock.map((s: any) => {
                  const lvl: Level = s.status === "норма" ? "ok" : s.status === "внимание" ? "warn" : "bad";
                  return (
                    <tr key={s.id} className="border-b last:border-0" data-testid={`row-stock-${s.id}`}>
                      <td className="py-2 pr-3 font-medium whitespace-nowrap">{s.itemName}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{s.object}</td>
                      <td className="num py-2 pr-3 text-right">{nf(s.qty)} {s.unit}</td>
                      <td className="num py-2 pr-3 text-right">{nf(s.minQty)} {s.unit}</td>
                      <td className="num py-2 pr-3 text-right">{nf(s.dailyUse, 2)}</td>
                      <td className={cn("num py-2 pr-3 text-right font-medium", levelText[lvl])}>
                        {nf(s.daysLeft)}
                      </td>
                      <td className="num py-2 pr-3 whitespace-nowrap">
                        {s.expectedDelivery ? ruDate(s.expectedDelivery) : "не заявлена"}
                      </td>
                      <td className="py-2">
                        <Badge variant="outline" className={cn("border text-[11px]", levelBadge[lvl])}>
                          {s.status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
