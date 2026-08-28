import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RotateCcw, Save, Wand2, Eraser, AlertTriangle, Undo2, Building2, FileCog, Download } from "lucide-react";
import { Link } from "wouter";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader, Section, Loading, ErrorBox, Empty } from "@/components/shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import SectionsManager from "@/pages/sections";
import { nf, downloadFile } from "@/lib/app";

const THRESHOLD_FIELDS = [
  { key: "planLagPct", label: "Отставание от плана, %", hint: "Выше порога — предупреждение, вдвое выше — критично" },
  { key: "downtimeSharePct", label: "Доля простоев, %", hint: "Максимально допустимая доля простоев" },
  { key: "fuelOverPct", label: "Перерасход ГСМ, %", hint: "Отклонение факта от нормы" },
  { key: "costOverPct", label: "Превышение себестоимости, %", hint: "Факт против сметы за метр" },
  { key: "stockDaysMin", label: "Минимальный запас, дней", hint: "Меньше — поднимаем тревогу по ТМЦ" },
  { key: "rotationEndDays", label: "Предупреждать о выезде за, дней", hint: "Срок подбора замены вахтовику" },
  { key: "silenceDays", label: "Молчание объекта, дней", hint: "Нет рапортов дольше этого срока — флаг" },
];

/** Пороги пробоподготовки и лабораторий */
const PREP_FIELDS = [
  { key: "stageQueueMax", label: "Затор на этапе, проб", hint: "Больше проб в очереди на одном этапе — узкое место" },
  { key: "stageStuckDays", label: "Проба стоит на этапе, дней", hint: "Дольше — считается залежавшейся" },
  { key: "dupSharePct", label: "Доля дубликатов, %", hint: "Норматив QA/QC, не менее" },
  { key: "stdSharePct", label: "Доля стандартов, %", hint: "Норматив QA/QC, не менее" },
  { key: "blankSharePct", label: "Доля бланков, %", hint: "Норматив QA/QC, не менее" },
  { key: "dupDeviationPct", label: "Допустимое расхождение дубликата, %", hint: "Больше — результат под вопросом" },
  { key: "rejectSharePct", label: "Доля брака проб, %", hint: "Выше — предупреждение" },
  { key: "samplesPerMeter", label: "Плотность опробования, проб/м", hint: "По геологическому заданию, не менее" },
  { key: "labNoResultDays", label: "Нет результата сверх срока, дней", hint: "Дольше — риск потери пробы в лаборатории" },
  { key: "oreAuGt", label: "Рудный порог Au, г/т", hint: "Содержание выше — подсветка рудного интервала" },
  { key: "oreAgGt", label: "Рудный порог Ag, г/т" },
  { key: "oreCuPct", label: "Рудный порог Cu, %" },
];

/** Пороги по керну: описание и распиловка */
const CORE_FIELDS = [
  { key: "coreRecoveryMin", label: "Норма выхода керна, %", hint: "Ниже — флаг по скважине" },
  { key: "coreLagMeters", label: "Отставание описания, м", hint: "Допустимый разрыв между бурением и описанием" },
  { key: "coreLagDays", label: "Отставание описания, дней работы", hint: "Сколько дней геолога нужно, чтобы догнать" },
  { key: "cutLagMeters", label: "Отставание распиловки, м" },
  { key: "cutLagDays", label: "Отставание распиловки, дней работы" },
  { key: "geologistNormMpd", label: "Норматив геолога, м/день", hint: "По нему считается отставание в днях" },
  { key: "cutRejectPct", label: "Допустимый брак распиловки, %" },
  { key: "logDelayDays", label: "Керн лежит неописанным, дней", hint: "Дольше — риск потери и деградации керна" },
  { key: "lagGrowDays", label: "Отставание растёт, дней подряд", hint: "Столько дней роста — нужен второй геолог" },
];

const OBJECT_FIELDS = [
  { key: "planMetersMonth", label: "План, м/мес" },
  { key: "pricePerMeter", label: "Цена, ₽/м" },
  { key: "plannedCostPerMeter", label: "Смета, ₽/м" },
  { key: "contractVolume", label: "Объём договора, м" },
  { key: "staffRequired", label: "Штат, чел." },
];

/** Настройки с вкладками: общие и состав программы (только для директора) */
export default function SettingsPage() {
  const { user } = useAuth();
  const isDirector = user?.role === "director";
  const [tab, setTab] = useState("general");

  if (!isDirector) return <GeneralSettings />;

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="mb-4 w-full justify-start overflow-x-auto">
        <TabsTrigger value="general" data-testid="tab-settings-general">Общие настройки</TabsTrigger>
        <TabsTrigger value="sections" data-testid="tab-settings-sections">Разделы программы</TabsTrigger>
      </TabsList>
      <TabsContent value="general"><GeneralSettings /></TabsContent>
      <TabsContent value="sections">
        <PageHeader
          title="Разделы программы"
          subtitle="Какие разделы видны в меню, как они называются и кому доступны. Настройка хранится в базе и применяется сразу."
        />
        <SectionsManager />
      </TabsContent>
    </Tabs>
  );
}

function GeneralSettings() {
  const { data, isLoading, error } = useQuery<any>({ queryKey: ["/api/settings"] });
  const { toast } = useToast();
  const [th, setTh] = useState<Record<string, string>>({});
  const [objs, setObjs] = useState<Record<number, any>>({});
  const status = useQuery<any>({ queryKey: ["/api/status"] });
  const [org, setOrg] = useState("");
  const [confirmWord, setConfirmWord] = useState("");
  const [dialog, setDialog] = useState<"" | "clear" | "keeprefs" | "reset" | "restore">("");

  useEffect(() => {
    if (status.data?.orgName) setOrg((v) => v || status.data.orgName);
  }, [status.data]);

  const saveOrg = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/settings/org", { orgName: org.trim() })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Название сохранено", description: "Теперь оно выводится в шапке программы." });
    },
    onError: (e: any) => toast({ title: "Не удалось сохранить", description: e.message, variant: "destructive" }),
  });

  const maintenance = useMutation({
    mutationFn: async (kind: "clear" | "keeprefs" | "reset" | "restore") => {
      const url =
        kind === "clear" ? "/api/maintenance/clear-demo"
        : kind === "keeprefs" ? "/api/maintenance/keep-refs"
        : kind === "reset" ? "/api/maintenance/full-reset"
        : "/api/maintenance/restore-demo";
      const body = kind === "reset" ? { confirm: "УДАЛИТЬ" }
        : kind === "keeprefs" ? { confirm: "ОЧИСТИТЬ" } : undefined;
      return (await apiRequest("POST", url, body)).json();
    },
    onSuccess: (_d, kind) => {
      queryClient.invalidateQueries();
      setDialog("");
      setConfirmWord("");
      toast({
        title:
          kind === "clear" ? "Демо-данные очищены"
          : kind === "keeprefs" ? "Начали с чистого листа"
          : kind === "reset" ? "Программа очищена полностью"
          : "Демо-данные восстановлены",
        description:
          kind === "reset"
            ? "Справочники пустые — откройте мастер настройки."
            : kind === "keeprefs"
              ? "Производственные записи удалены. Справочники, шаблоны, профили, пользователи и брендирование сохранены."
              : "Расчёты обновлены.",
      });
    },
    onError: (e: any) => toast({ title: "Операция не выполнена", description: e.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (!data) return;
    setTh(Object.fromEntries(Object.entries(data.thresholds).map(([k, v]) => [k, String(v)])));
    setObjs(
      Object.fromEntries(
        data.objects.map((o: any) => [
          o.id,
          {
            planMetersMonth: String(o.planMetersMonth),
            pricePerMeter: String(o.pricePerMeter),
            plannedCostPerMeter: String(o.plannedCostPerMeter),
            contractVolume: String(o.contractVolume),
            staffRequired: String(o.staffRequired),
            contractEnd: o.contractEnd,
          },
        ]),
      ),
    );
  }, [data]);

  const saveThresholds = useMutation({
    mutationFn: async () => {
      const body = Object.fromEntries(Object.entries(th).map(([k, v]) => [k, Number(v)]));
      return (await apiRequest("PUT", "/api/settings/thresholds", body)).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Пороги сохранены", description: "Предупреждения пересчитаны по новым значениям." });
    },
    onError: (e: any) => toast({ title: "Не удалось сохранить", description: e.message, variant: "destructive" }),
  });

  const saveObject = useMutation({
    mutationFn: async (id: number) =>
      (await apiRequest("PATCH", `/api/settings/objects/${id}`, objs[id])).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Параметры объекта сохранены" });
    },
    onError: (e: any) => toast({ title: "Не удалось сохранить", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <Loading rows={4} />;
  if (error || !data) return <ErrorBox text="Не удалось загрузить настройки. Обновите страницу." />;

  return (
    <>
      <PageHeader
        title="Настройки"
        subtitle="Пороговые значения предупреждений, планы по метрам, цены и штат. Меняются без перезапуска программы."
        actions={
          <Link href="/setup">
            <Button variant="outline" size="sm" data-testid="button-open-setup">
              <Wand2 className="mr-2 h-4 w-4" />
              Мастер настройки за 5 шагов
            </Button>
          </Link>
        }
      />

      <Section
        className="mb-4"
        title="Название организации"
        description="Выводится в шапке программы вместо «ГРР-Контроль» и в выгрузках."
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="Например: ООО «Сибгеопроект»"
            className="sm:max-w-md"
            data-testid="input-settings-org"
          />
          <Button size="sm" onClick={() => saveOrg.mutate()} disabled={!org.trim() || saveOrg.isPending} data-testid="button-save-org">
            <Save className="mr-2 h-4 w-4" />
            Сохранить
          </Button>
        </div>
      </Section>

      <Section
        className="mb-4"
        title="Начало работы с нуля"
        description="Уберите демонстрационный набор и заведите свою структуру. Операции необратимы."
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Eraser className="h-4 w-4" />
              Очистить демо-данные
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Удаляет все рапорты, затраты, ГСМ, ТМЦ, сотрудников, вахты и журнал импортов.
              Справочники (объекты, станки, должности) останутся.
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setDialog("clear")} data-testid="button-clear-demo">
              Очистить демо-данные
            </Button>
          </div>
          <div className="rounded-md border border-primary/50 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileCog className="h-4 w-4" />
              Начать с чистого листа, оставив мои справочники
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Удаляет все производственные записи (смены и рапорты, описание керна и распиловку,
              пробы и анализы, затраты, ГСМ, ТМЦ, сотрудников, журнал импортов).
              Сохраняет справочники, шаблоны Excel, профили импорта, пользователей и брендирование.
              Действие необратимо — сначала лучше сделать выгрузку.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialog("keeprefs")} data-testid="button-keep-refs">
                Начать с чистого листа
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => downloadFile("/api/export/all", "ГРР-Контроль — все данные.xlsx")}
                data-testid="button-export-all-before-clear"
              >
                <Download className="mr-2 h-3.5 w-3.5" /> Выгрузить всё в Excel
              </Button>
            </div>
          </div>
          <div className="rounded-md border border-red-200 p-3 dark:border-red-900">
            <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400">
              <AlertTriangle className="h-4 w-4" />
              Полный сброс
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Удаляет вообще всё, включая справочники, чтобы завести свою структуру с нуля.
              Потребуется ввести слово УДАЛИТЬ.
            </p>
            <Button variant="destructive" size="sm" className="mt-3" onClick={() => setDialog("reset")} data-testid="button-full-reset">
              Полный сброс
            </Button>
          </div>
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Undo2 className="h-4 w-4" />
              Вернуть демо-данные
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Восстанавливает демонстрационный набор (3 объекта, 5 станков, 60 дней рапортов),
              чтобы потренироваться. Текущие данные будут заменены.
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setDialog("restore")} data-testid="button-restore-demo">
              Вернуть демо-данные
            </Button>
          </div>
        </div>
        {status.data?.counts && (
          <p className="mt-3 text-xs text-muted-foreground" data-testid="text-db-counts">
            Сейчас в базе: объектов {nf(status.data.counts.objects)}, станков {nf(status.data.counts.rigs)},
            рапортов {nf(status.data.counts.reports)}.
          </p>
        )}
      </Section>

      <Dialog open={!!dialog} onOpenChange={(v) => { if (!v) { setDialog(""); setConfirmWord(""); } }}>
        <DialogContent className="max-w-md" data-testid="dialog-maintenance">
          <DialogHeader>
            <DialogTitle>
              {dialog === "clear" ? "Очистить демо-данные?"
                : dialog === "keeprefs" ? "Начать с чистого листа, оставив справочники?"
                : dialog === "reset" ? "Полный сброс программы?"
                : "Вернуть демо-данные?"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "clear"
                ? "Будут удалены все рапорты, затраты, ГСМ, ТМЦ, сотрудники, вахты и журнал импортов. Справочники останутся на месте. Отменить будет нельзя."
                : dialog === "keeprefs"
                ? "Будут удалены все производственные записи: смены и рапорты, описание керна и распиловка, пробы, партии и анализы, затраты, ГСМ, ТМЦ, сотрудники, журнал импортов. Останутся объекты, станки, должности, оборудование, статьи затрат, лаборатории, сметы, шаблоны, профили импорта, пользователи и брендирование. Действие необратимо: если данные ещё нужны, сначала нажмите «Выгрузить всё в Excel». Для подтверждения введите слово ОЧИСТИТЬ."
                : dialog === "reset"
                ? "Будет удалено всё, включая объекты, станки и справочники. После сброса программа предложит мастер настройки. Для подтверждения введите слово УДАЛИТЬ."
                : "Текущие данные будут заменены демонстрационным набором для тренировки."}
            </DialogDescription>
          </DialogHeader>
          {dialog === "reset" && (
            <Input
              value={confirmWord}
              onChange={(e) => setConfirmWord(e.target.value)}
              placeholder="Введите УДАЛИТЬ"
              data-testid="input-confirm-reset"
            />
          )}
          {dialog === "keeprefs" && (
            <div className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => downloadFile("/api/export/all", "ГРР-Контроль — все данные.xlsx")}
                data-testid="button-export-before-keeprefs"
              >
                <Download className="mr-2 h-4 w-4" /> Сначала выгрузить всё в Excel
              </Button>
              <Input
                value={confirmWord}
                onChange={(e) => setConfirmWord(e.target.value)}
                placeholder="Введите ОЧИСТИТЬ"
                data-testid="input-confirm-keeprefs"
              />
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { setDialog(""); setConfirmWord(""); }} data-testid="button-cancel-maintenance">
              Отмена
            </Button>
            <Button
              variant={dialog === "restore" ? "default" : "destructive"}
              disabled={
                maintenance.isPending
                || (dialog === "reset" && confirmWord.trim() !== "УДАЛИТЬ")
                || (dialog === "keeprefs" && confirmWord.trim().toUpperCase() !== "ОЧИСТИТЬ")
              }
              onClick={() => maintenance.mutate(dialog as any)}
              data-testid="button-confirm-maintenance"
            >
              {dialog === "clear" ? "Да, очистить"
                : dialog === "keeprefs" ? "Очистить, справочники оставить"
                : dialog === "reset" ? "Сбросить всё" : "Вернуть демо"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Section
        className="mb-4"
        title="Пороги предупреждений"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              data-testid="button-reset-thresholds"
              onClick={() =>
                setTh(Object.fromEntries(Object.entries(data.defaults).map(([k, v]) => [k, String(v)])))
              }
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Значения по умолчанию
            </Button>
            <Button size="sm" onClick={() => saveThresholds.mutate()} disabled={saveThresholds.isPending} data-testid="button-save-thresholds">
              <Save className="mr-2 h-4 w-4" />
              Сохранить
            </Button>
          </>
        }
      >
        {[
          { title: "Бурение, ГСМ, вахты", fields: THRESHOLD_FIELDS },
          { title: "Пробоподготовка, лаборатории и QA/QC", fields: PREP_FIELDS },
          { title: "Керн: описание и распиловка", fields: CORE_FIELDS },
        ].map((group) => (
          <div key={group.title} className="mb-5 last:mb-0">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.title}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.fields.map((f: any) => (
                <div key={f.key}>
                  <label className="mb-1 block text-xs font-medium">{f.label}</label>
                  <Input
                    inputMode="decimal"
                    value={th[f.key] ?? ""}
                    onChange={(e) => setTh({ ...th, [f.key]: e.target.value })}
                    data-testid={`input-threshold-${f.key}`}
                  />
                  {f.hint && <p className="mt-1 text-xs text-muted-foreground">{f.hint}</p>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>

      <Section
        className="mb-4"
        title="Объекты: план, цены и договор"
        actions={
          <Link href="/references">
            <Button variant="outline" size="sm" data-testid="button-goto-references">
              <Building2 className="mr-2 h-4 w-4" />
              Справочники
            </Button>
          </Link>
        }
      >
        {data.objects.length === 0 ? (
          <Empty text="Объекты не заведены. Заведите их в разделе «Справочники» или через мастер настройки." />
        ) : (
          <div className="space-y-4">
            {data.objects.map((o: any) => (
              <div key={o.id} className="rounded-md border p-3" data-testid={`settings-object-${o.id}`}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{o.name}</div>
                    <div className="text-xs text-muted-foreground">{o.customer} · {o.region}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => saveObject.mutate(o.id)} data-testid={`button-save-object-${o.id}`}>
                    <Save className="mr-2 h-4 w-4" />
                    Сохранить
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {OBJECT_FIELDS.map((f) => (
                    <div key={f.key}>
                      <label className="mb-1 block text-xs font-medium">{f.label}</label>
                      <Input
                        inputMode="numeric"
                        value={objs[o.id]?.[f.key] ?? ""}
                        onChange={(e) => setObjs({ ...objs, [o.id]: { ...objs[o.id], [f.key]: e.target.value } })}
                        data-testid={`input-object-${o.id}-${f.key}`}
                      />
                    </div>
                  ))}
                  <div>
                    <label className="mb-1 block text-xs font-medium">Срок договора</label>
                    <Input
                      type="date"
                      value={objs[o.id]?.contractEnd ?? ""}
                      onChange={(e) => setObjs({ ...objs, [o.id]: { ...objs[o.id], contractEnd: e.target.value } })}
                      data-testid={`input-object-${o.id}-contractEnd`}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Справочник станков и типов вахт">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Станки</h3>
            {data.rigs.length === 0 && <Empty text="Станки не заведены." />}
            <ul className="space-y-1 text-sm" data-testid="list-rigs">
              {data.rigs.map((r: any) => (
                <li key={r.id} className="flex justify-between gap-2 rounded border px-3 py-1.5">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-muted-foreground">{r.model}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Типы вахтовых циклов</h3>
            <ul className="space-y-1 text-sm">
              {["30/30", "60/30", "15/15", "45/45"].map((c) => (
                <li key={c} className="rounded border px-3 py-1.5">
                  {c} — {nf(Number(c.split("/")[0]))} дней на объекте, {nf(Number(c.split("/")[1]))} дней межвахты
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Дата выезда рассчитывается автоматически при заезде сотрудника.
            </p>
          </div>
        </div>
      </Section>
    </>
  );
}
