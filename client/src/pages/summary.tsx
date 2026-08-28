import { useState } from "react";
import { Copy, Check, FileDown, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAnalytics } from "@/lib/hooks";
import { PageHeader, Section, Loading, ErrorBox, Empty } from "@/components/shell";
import { downloadFile, nf, money, ruDate, levelBadge } from "@/lib/app";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

const PERIODS = [
  { key: "day", label: "За сутки" },
  { key: "week", label: "За неделю" },
  { key: "month", label: "За месяц" },
];

function Block({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Нет пунктов.</p>
      ) : (
        <ol className="mt-2 space-y-2 text-sm">
          {items.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span className="num shrink-0 text-muted-foreground">{i + 1}.</span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function Summary() {
  const { finance } = useAuth();
  const { data, isLoading, error } = useAnalytics();
  const [period, setPeriod] = useState("day");
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  if (isLoading) return <Loading rows={4} />;
  if (error || !data) return <ErrorBox text="Не удалось загрузить сводку. Обновите страницу." />;

  const s = data.summaries[period];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(s.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      toast({ title: "Текст скопирован", description: "Можно вставить в письмо или мессенджер." });
    } catch {
      toast({ title: "Не удалось скопировать", description: "Выделите текст сводки вручную.", variant: "destructive" });
    }
  };

  return (
    <>
      <PageHeader
        title="Сводка для директора"
        subtitle={`${s.periodTitle}: ${ruDate(s.from)} — ${ruDate(s.to)}. Формируется автоматически по данным рапортов.`}
        actions={
          <>
            <Button size="sm" onClick={copy} data-testid="button-copy-text">
              {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
              Скопировать текст
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid="button-summary-docx"
              onClick={() => downloadFile(`/api/export/summary/docx/${period}`, "Сводка.docx")}
            >
              <FileText className="mr-2 h-4 w-4" />
              Скачать в Word
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid="button-summary-xlsx"
              onClick={() => downloadFile(`/api/export/summary/xlsx/${period}`, "Сводка.xlsx")}
            >
              <FileDown className="mr-2 h-4 w-4" />
              Скачать в Excel
            </Button>
          </>
        }
      />

      <Tabs value={period} onValueChange={setPeriod} className="mb-4">
        <TabsList data-testid="tabs-period">
          {PERIODS.map((p) => (
            <TabsTrigger key={p.key} value={p.key} data-testid={`tab-${p.key}`}>
              {p.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="mb-4 space-y-5 p-4 sm:p-5" data-testid="card-summary-text">
        <Block title="Суть" items={s.essence} />
        <Block title="Выводы" items={s.conclusions} />
        <Block title="Риски" items={s.risks} />
        <Block title="Что решить" items={s.actions} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Рейтинг станков" description="Метры на смену и доля простоев за месяц">
          {data.rigRating.length === 0 ? (
            <Empty text="Нет данных за выбранный период. Добавьте сменный рапорт." />
          ) : (
            <ol className="space-y-2" data-testid="list-rig-rating">
              {data.rigRating.map((r: any, i: number) => (
                <li key={r.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="num w-5 text-sm text-muted-foreground">{i + 1}</span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{r.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{r.object}</div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="num text-sm font-semibold">{nf(r.perShift, 1)} м/смена</div>
                    <div className="num text-xs text-muted-foreground">простои {nf(r.downtimeShare, 1)} %</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section title="Рейтинг сменных мастеров" description="Метры на смену и доля простоев за месяц, по сменным рапортам">
          {data.brigadeRating.length === 0 ? (
            <Empty text="Нет данных за выбранный период. Добавьте сменный рапорт." />
          ) : (
            <ol className="space-y-2" data-testid="list-master-rating">
              {data.brigadeRating.map((r: any, i: number) => (
                <li key={r.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="num w-5 text-sm text-muted-foreground">{i + 1}</span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{r.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{r.object}</div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="num text-sm font-semibold">{nf(r.perShift, 1)} м/смена</div>
                    <div className="num text-xs text-muted-foreground">простои {nf(r.downtimeShare, 1)} %</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>

      <Section
        className="mt-4"
        title={finance ? "Простои в метрах и рублях" : "Простои в часах и метрах"}
        description={`Всего за месяц: ${nf(data.lostTotal.hours, 1)} ч = ${nf(data.lostTotal.meters)} м${finance ? ` = ${money(data.lostTotal.money)}` : ""}`}
      >
        {data.downtimeReasons.length === 0 ? (
          <Empty text="Простоев за период не зафиксировано." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm" data-testid="table-downtime-reasons">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Причина</th>
                  <th className="py-2 pr-3 text-right font-medium">Часы</th>
                  <th className="py-2 pr-3 text-right font-medium">Доля</th>
                  <th className="py-2 pr-3 text-right font-medium">Потерянные метры</th>
                  {finance && <th className="py-2 text-right font-medium">Упущенная выручка</th>}
                </tr>
              </thead>
              <tbody>
                {data.downtimeReasons.map((r: any, i: number) => (
                  <tr key={r.reason} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      {i < 3 && (
                        <Badge variant="outline" className={cn("mr-2 border text-[10px]", levelBadge["bad"])}>
                          топ-{i + 1}
                        </Badge>
                      )}
                      {r.reason}
                    </td>
                    <td className="num py-2 pr-3 text-right">{nf(r.hours, 1)}</td>
                    <td className="num py-2 pr-3 text-right">{nf(r.sharePct, 1)} %</td>
                    <td className="num py-2 pr-3 text-right">{nf(r.lostMeters)}</td>
                    {finance && <td className="num py-2 text-right">{money(r.lostMoney)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section className="mt-4" title="Прогноз выполнения договоров">
        <div className="grid gap-3 lg:grid-cols-3">
          {data.byObject.map((o: any) => (
            <div key={o.id} className="rounded-md border p-3" data-testid={`forecast-${o.id}`}>
              <div className="truncate text-sm font-semibold">{o.name}</div>
              <div className="num mt-2 text-sm">
                Выполнено {nf(o.doneTotal)} из {nf(o.contractVolume)} м ({nf(o.contractPct, 1)} %)
              </div>
              <div className="num text-xs text-muted-foreground">
                Срок {ruDate(o.contractEnd)} · осталось {nf(o.daysLeft)} дн.
              </div>
              <div
                className={cn(
                  "mt-2 rounded border px-2 py-1.5 text-xs",
                  o.willMeet
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
                    : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
                )}
              >
                {o.willMeet
                  ? "Успеваем к сроку при текущем темпе"
                  : `Опоздание ${nf(o.daysLate)} дн. Нужно ${nf(o.neededPerShift, 1)} м/смена`}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
