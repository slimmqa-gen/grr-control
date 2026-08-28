import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, Download, Plus, Trash2, Upload, Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useRefBook } from "@/lib/hooks";
import { PageHeader, Section, Empty, Loading, ErrorBox } from "@/components/shell";
import { downloadFile, nf, ruDate } from "@/lib/app";
import { cn } from "@/lib/utils";

const STEPS = [
  { n: 1, title: "Название организации", lead: "Как называется ваша компания" },
  { n: 2, title: "Объекты (участки)", lead: "Где ведутся работы" },
  { n: 3, title: "Буровые станки", lead: "Чем бурите" },
  { n: 4, title: "Сотрудники", lead: "Кто работает" },
  { n: 5, title: "Пороги предупреждений", lead: "Когда программа поднимает тревогу" },
];

const THRESHOLD_FIELDS = [
  { key: "planLagPct", label: "Отставание от плана, %", hint: "Если факт метров ниже плана больше чем на столько процентов — программа покажет предупреждение." },
  { key: "downtimeSharePct", label: "Доля простоев, %", hint: "Сколько процентов рабочего времени допустимо простаивать без тревоги." },
  { key: "fuelOverPct", label: "Перерасход ГСМ, %", hint: "Насколько факт по топливу может превышать норму." },
  { key: "costOverPct", label: "Превышение себестоимости, %", hint: "Насколько фактическая стоимость метра может быть выше сметы." },
  { key: "stockDaysMin", label: "Минимальный запас, дней", hint: "Если остатков ТМЦ хватает на меньшее число дней — будет предупреждение." },
  { key: "rotationEndDays", label: "Предупреждать о выезде за, дней", hint: "За сколько дней до конца вахты напомнить о подборе замены." },
  { key: "silenceDays", label: "Молчание объекта, дней", hint: "Если с объекта нет рапортов дольше этого срока — тревога." },
];

function Progress({ step }: { step: number }) {
  return (
    <div className="mt-6" data-testid="setup-progress">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {step <= 5 ? `Шаг ${step} из 5` : "Настройка завершена"}
        </span>
        <span>{step <= 5 ? STEPS[step - 1].title : "Готово"}</span>
      </div>
      <div className="flex gap-1.5">
        {STEPS.map((s) => (
          <div
            key={s.n}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              step > s.n || step > 5 ? "bg-primary" : step === s.n ? "bg-primary/60" : "bg-muted",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function Why({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-md border-l-4 border-primary bg-accent/60 px-4 py-3 text-sm" data-testid="text-why">
      {children}
    </div>
  );
}

export default function SetupPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: ref, isLoading } = useRefBook();
  const status = useQuery<any>({ queryKey: ["/api/status"] });
  const settings = useQuery<any>({ queryKey: ["/api/settings"] });

  const [step, setStep] = useState(1);
  const [org, setOrg] = useState("");
  const [err, setErr] = useState("");

  const [obj, setObj] = useState({
    name: "", customer: "", region: "", planMetersMonth: "", pricePerMeter: "",
    plannedCostPerMeter: "", contractVolume: "", contractEnd: "", staffRequired: "",
  });
  const [rig, setRig] = useState({ name: "", model: "", objectId: "", status: "в работе" });
  const [emp, setEmp] = useState({ fio: "", position: "", objectId: "" });
  const [th, setTh] = useState<Record<string, string>>({});

  useEffect(() => {
    if (status.data?.orgName && !org) setOrg(status.data.orgName === "ГРР-Контроль" ? "" : status.data.orgName);
  }, [status.data]);

  useEffect(() => {
    if (settings.data?.thresholds && Object.keys(th).length === 0)
      setTh(Object.fromEntries(Object.entries(settings.data.thresholds).map(([k, v]) => [k, String(v)])));
  }, [settings.data]);

  useEffect(() => {
    const first = ref?.objects?.[0]?.id;
    if (first) {
      setRig((r) => (r.objectId ? r : { ...r, objectId: String(first) }));
      setEmp((e) => (e.objectId ? e : { ...e, objectId: String(first) }));
    }
  }, [ref]);

  const objects = ref?.objects ?? [];
  const rigs = ref?.rigs ?? [];
  const positions = ref?.positions ?? [];
  const employees = useQuery<any[]>({ queryKey: ["/api/employees"] });
  const empList = employees.data ?? [];

  const post = useMutation({
    mutationFn: async ({ url, body }: { url: string; body: any }) =>
      (await apiRequest("POST", url, body)).json(),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (e: any) => setErr(e.message || "Не удалось сохранить"),
  });

  const remove = useMutation({
    mutationFn: async (url: string) => (await apiRequest("DELETE", url + "?cascade=1")).json(),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const saveOrg = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/settings/org", { orgName: org.trim() })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setErr("");
      setStep(2);
    },
    onError: (e: any) => setErr(e.message),
  });

  const saveThresholds = useMutation({
    mutationFn: async () => {
      const body = Object.fromEntries(Object.entries(th).map(([k, v]) => [k, Number(v)]));
      return (await apiRequest("PUT", "/api/settings/thresholds", body)).json();
    },
    onSuccess: async () => {
      await apiRequest("PUT", "/api/settings/setup-done", { done: true });
      queryClient.invalidateQueries();
      setStep(6);
    },
    onError: (e: any) => setErr(e.message),
  });

  const addObject = () => {
    if (!obj.name.trim()) return setErr("Укажите название объекта");
    setErr("");
    post.mutate({
      url: "/api/ref/objects",
      body: {
        name: obj.name.trim(), customer: obj.customer.trim(), region: obj.region.trim(),
        planMetersMonth: Number(obj.planMetersMonth || 0),
        pricePerMeter: Number(obj.pricePerMeter || 0),
        plannedCostPerMeter: Number(obj.plannedCostPerMeter || 0),
        contractVolume: Number(obj.contractVolume || 0),
        contractEnd: obj.contractEnd, staffRequired: Number(obj.staffRequired || 0),
      },
    }, {
      onSuccess: () => setObj({
        name: "", customer: "", region: "", planMetersMonth: "", pricePerMeter: "",
        plannedCostPerMeter: "", contractVolume: "", contractEnd: "", staffRequired: "",
      }),
    });
  };

  const addRig = () => {
    if (!rig.name.trim()) return setErr("Укажите название или номер станка");
    setErr("");
    post.mutate({
      url: "/api/ref/rigs",
      body: { name: rig.name.trim(), model: rig.model.trim(), objectId: Number(rig.objectId || 0), status: rig.status },
    }, { onSuccess: () => setRig({ ...rig, name: "", model: "" }) });
  };

  const addEmployee = () => {
    if (!emp.fio.trim()) return setErr("Укажите ФИО сотрудника");
    if (!emp.position.trim()) return setErr("Укажите должность");
    setErr("");
    post.mutate({
      url: "/api/employees",
      body: {
        fio: emp.fio.trim(), position: emp.position.trim(),
        objectId: Number(emp.objectId || 0), brigadeId: 0, phone: "",
      },
    }, { onSuccess: () => setEmp({ ...emp, fio: "" }) });
  };

  if (isLoading) return <Loading rows={4} />;

  const objectSelect = (value: string, onChange: (v: string) => void, testId: string) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger data-testid={testId}><SelectValue placeholder="Выберите объект" /></SelectTrigger>
      <SelectContent>
        {objects.length === 0 ? (
          <SelectItem value="0" disabled>Сначала заведите объект на шаге 2</SelectItem>
        ) : (
          objects.map((o: any) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)
        )}
      </SelectContent>
    </Select>
  );

  return (
    <>
      <PageHeader
        title="Настройка за 5 шагов"
        subtitle="Заполните программу под свою организацию. Каждый шаг занимает пару минут, вернуться можно в любой момент."
      />

      <Card className="p-4 sm:p-6">
        {step === 1 && (
          <>
            <h2 className="text-base font-semibold">Шаг 1. Название организации</h2>
            <Why>
              Название выводится в шапке программы и в выгрузках Excel и Word, которые вы отправляете
              заказчику и учредителям. Ничего не считает — просто чтобы отчёты выглядели вашими.
            </Why>
            <label className="mb-1 block text-xs font-medium">Название организации</label>
            <Input
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              placeholder="Например: ООО «Сибгеопроект»"
              className="max-w-md"
              data-testid="input-org-name"
            />
            {err && <div className="mt-3"><ErrorBox text={err} /></div>}
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-base font-semibold">Шаг 2. Объекты (участки)</h2>
            <Why>
              Объект — это участок работ по договору с заказчиком. По объекту программа считает
              выполнение плана по метрам, выручку (метры × цена по договору), себестоимость метра
              и прогноз: успеваете ли вы к сроку договора. Без объектов остальные разделы будут пустыми.
            </Why>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium">Название объекта *</label>
                <Input value={obj.name} onChange={(e) => setObj({ ...obj, name: e.target.value })} placeholder="Участок «Северный»" data-testid="input-setup-object-name" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Заказчик</label>
                <Input value={obj.customer} onChange={(e) => setObj({ ...obj, customer: e.target.value })} data-testid="input-setup-object-customer" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Регион</label>
                <Input value={obj.region} onChange={(e) => setObj({ ...obj, region: e.target.value })} data-testid="input-setup-object-region" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">План метров в месяц</label>
                <Input inputMode="decimal" value={obj.planMetersMonth} onChange={(e) => setObj({ ...obj, planMetersMonth: e.target.value })} data-testid="input-setup-object-plan" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Цена за метр по договору, ₽</label>
                <Input inputMode="decimal" value={obj.pricePerMeter} onChange={(e) => setObj({ ...obj, pricePerMeter: e.target.value })} data-testid="input-setup-object-price" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Плановая себестоимость метра, ₽</label>
                <Input inputMode="decimal" value={obj.plannedCostPerMeter} onChange={(e) => setObj({ ...obj, plannedCostPerMeter: e.target.value })} data-testid="input-setup-object-cost" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Объём по договору, м</label>
                <Input inputMode="decimal" value={obj.contractVolume} onChange={(e) => setObj({ ...obj, contractVolume: e.target.value })} data-testid="input-setup-object-volume" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Дата окончания договора</label>
                <Input type="date" value={obj.contractEnd} onChange={(e) => setObj({ ...obj, contractEnd: e.target.value })} data-testid="input-setup-object-end" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Штатная численность, чел.</label>
                <Input inputMode="numeric" value={obj.staffRequired} onChange={(e) => setObj({ ...obj, staffRequired: e.target.value })} data-testid="input-setup-object-staff" />
              </div>
            </div>
            <Button className="mt-3" size="sm" onClick={addObject} disabled={post.isPending} data-testid="button-setup-add-object">
              <Plus className="mr-2 h-4 w-4" />
              Добавить объект
            </Button>
            {err && <div className="mt-3"><ErrorBox text={err} /></div>}

            <div className="mt-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Заведено объектов: {nf(objects.length)}
              </h3>
              {objects.length === 0 ? (
                <Empty text="Пока ни одного объекта. Заполните форму выше." />
              ) : (
                <ul className="space-y-1.5 text-sm" data-testid="list-setup-objects">
                  {objects.map((o: any) => (
                    <li key={o.id} className="flex items-center justify-between gap-2 rounded border px-3 py-2">
                      <span className="min-w-0">
                        <span className="font-medium">{o.name}</span>
                        <span className="text-muted-foreground">
                          {o.customer ? ` · ${o.customer}` : ""}
                          {o.planMetersMonth ? ` · план ${nf(o.planMetersMonth)} м/мес` : ""}
                          {o.contractEnd ? ` · до ${ruDate(o.contractEnd)}` : ""}
                        </span>
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => remove.mutate(`/api/ref/objects/${o.id}`)} data-testid={`button-setup-del-object-${o.id}`}>
                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="text-base font-semibold">Шаг 3. Буровые станки</h2>
            <Why>
              Каждый рапорт с объекта привязан к станку. По станкам программа считает метры на смену,
              строит рейтинг «кто бурит лучше» и показывает, какая техника чаще всего стоит.
              Станки в статусе «ремонт» и «резерв» не учитываются как рабочие мощности.
            </Why>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-medium">Название / номер *</label>
                <Input value={rig.name} onChange={(e) => setRig({ ...rig, name: e.target.value })} placeholder="УБ-01" data-testid="input-setup-rig-name" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Тип (модель)</label>
                <Input value={rig.model} onChange={(e) => setRig({ ...rig, model: e.target.value })} placeholder="ЗИФ-650М" data-testid="input-setup-rig-model" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Объект</label>
                {objectSelect(rig.objectId, (v) => setRig({ ...rig, objectId: v }), "select-setup-rig-object")}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Статус</label>
                <Select value={rig.status} onValueChange={(v) => setRig({ ...rig, status: v })}>
                  <SelectTrigger data-testid="select-setup-rig-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["в работе", "ремонт", "резерв"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button className="mt-3" size="sm" onClick={addRig} disabled={post.isPending} data-testid="button-setup-add-rig">
              <Plus className="mr-2 h-4 w-4" />
              Добавить станок
            </Button>
            {err && <div className="mt-3"><ErrorBox text={err} /></div>}
            <div className="mt-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Заведено станков: {nf(rigs.length)}
              </h3>
              {rigs.length === 0 ? (
                <Empty text="Пока ни одного станка." />
              ) : (
                <ul className="space-y-1.5 text-sm" data-testid="list-setup-rigs">
                  {rigs.map((r: any) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 rounded border px-3 py-2">
                      <span>
                        <span className="font-medium">{r.name}</span>
                        <span className="text-muted-foreground">
                          {r.model ? ` · ${r.model}` : ""} · {objects.find((o: any) => o.id === r.objectId)?.name ?? "без объекта"} · {r.status}
                        </span>
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => remove.mutate(`/api/ref/rigs/${r.id}`)} data-testid={`button-setup-del-rig-${r.id}`}>
                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2 className="text-base font-semibold">Шаг 4. Сотрудники</h2>
            <Why>
              Заведите людей, которые работают на объектах: программа покажет, кто сейчас на вахте,
              у кого вахта не назначена и когда пора искать замену. Обязательны только ФИО и должность —
              вахту вы назначите отдельно в разделе «Сотрудники и вахты». Много людей удобнее загрузить
              из Excel по шаблону «Штатное расписание».
            </Why>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium">ФИО *</label>
                <Input value={emp.fio} onChange={(e) => setEmp({ ...emp, fio: e.target.value })} placeholder="Иванов Иван Иванович" data-testid="input-setup-employee-fio" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Должность *</label>
                <Input list="setup-positions" value={emp.position} onChange={(e) => setEmp({ ...emp, position: e.target.value })} placeholder="Буровой мастер" data-testid="input-setup-employee-position" />
                <datalist id="setup-positions">
                  {positions.map((p: any) => <option key={p.id} value={p.name} />)}
                </datalist>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Объект (необязательно)</label>
                {objectSelect(emp.objectId, (v) => setEmp({ ...emp, objectId: v }), "select-setup-employee-object")}
              </div>
            </div>
            <Button className="mt-3" size="sm" onClick={addEmployee} disabled={post.isPending} data-testid="button-setup-add-employee">
              <Plus className="mr-2 h-4 w-4" />
              Добавить сотрудника
            </Button>
            {err && <div className="mt-3"><ErrorBox text={err} /></div>}
            <div className="mt-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Заведено сотрудников: {nf(empList.length)}
              </h3>
              {empList.length === 0 ? (
                <Empty text="Пока ни одного сотрудника." />
              ) : (
                <ul className="space-y-1.5 text-sm" data-testid="list-setup-employees">
                  {empList.slice(0, 12).map((e: any) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 rounded border px-3 py-2">
                      <span>
                        <span className="font-medium">{e.fio}</span>
                        <span className="text-muted-foreground">
                          {" · "}{e.position}{" · "}{objects.find((o: any) => o.id === e.objectId)?.name ?? "объект не указан"}
                        </span>
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => remove.mutate(`/api/employees/${e.id}`)} data-testid={`button-setup-del-employee-${e.id}`}>
                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <h2 className="text-base font-semibold">Шаг 5. Пороги предупреждений</h2>
            <Why>
              Это правила, по которым программа сама поднимает красные флаги на дашборде: отставание
              от плана, простои, перерасход топлива, нехватка ТМЦ. Если не уверены — оставьте значения
              по умолчанию, их можно поменять в любой момент в «Настройках».
            </Why>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {THRESHOLD_FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="mb-1 block text-xs font-medium">{f.label}</label>
                  <Input
                    inputMode="numeric"
                    value={th[f.key] ?? ""}
                    onChange={(e) => setTh({ ...th, [f.key]: e.target.value })}
                    data-testid={`input-setup-threshold-${f.key}`}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">{f.hint}</p>
                </div>
              ))}
            </div>
            {err && <div className="mt-3"><ErrorBox text={err} /></div>}
          </>
        )}

        {step === 6 && (
          <div data-testid="setup-done">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              <h2 className="text-base font-semibold">Готово. Что делать дальше</h2>
            </div>
            <Why>
              Структура заведена: объектов {nf(objects.length)}, станков {nf(rigs.length)},
              сотрудников {nf(empList.length)}. Теперь нужно завести данные — иначе графики останутся пустыми.
              Проще всего скачать шаблоны Excel, отправить их на объекты и загрузить обратно заполненные файлы.
            </Why>
            <ol className="space-y-3 text-sm">
              <li className="rounded-md border p-3">
                <div className="font-medium">1. Скачайте шаблоны Excel</div>
                <p className="mt-1 text-muted-foreground">
                  В шаблон уже подставлены ваши объекты и станки — на объекте останется вписать цифры.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => downloadFile("/api/import/template/reports", "Шаблон рапортов.xlsx")} data-testid="button-done-template-reports">
                    <Download className="mr-2 h-4 w-4" />
                    Сменные рапорты
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => downloadFile("/api/import/template/costs", "Шаблон затрат.xlsx")} data-testid="button-done-template-costs">
                    <Download className="mr-2 h-4 w-4" />
                    Затраты
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => downloadFile("/api/import/template/fuel", "Шаблон ГСМ.xlsx")} data-testid="button-done-template-fuel">
                    <Download className="mr-2 h-4 w-4" />
                    ГСМ
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => downloadFile("/api/import/template/refs", "Шаблон справочников.xlsx")} data-testid="button-done-template-refs">
                    <Download className="mr-2 h-4 w-4" />
                    Справочники
                  </Button>
                </div>
              </li>
              <li className="rounded-md border p-3">
                <div className="font-medium">2. Загрузите первые рапорты</div>
                <p className="mt-1 text-muted-foreground">
                  Раздел «Импорт данных» сам сопоставит колонки, проверит строки и покажет дубли до записи в базу.
                </p>
                <Link href="/import">
                  <Button size="sm" className="mt-2" data-testid="button-done-goto-import">
                    <Upload className="mr-2 h-4 w-4" />
                    Перейти к импорту
                  </Button>
                </Link>
              </li>
              <li className="rounded-md border p-3">
                <div className="font-medium">3. Откройте дашборд</div>
                <p className="mt-1 text-muted-foreground">
                  Как только появятся рапорты, на дашборде заполнятся KPI, графики и текстовая сводка для директора.
                </p>
                <Link href="/">
                  <Button variant="outline" size="sm" className="mt-2" data-testid="button-done-goto-dashboard">
                    <Building2 className="mr-2 h-4 w-4" />
                    На дашборд
                  </Button>
                </Link>
              </li>
            </ol>
          </div>
        )}

        <Progress step={step} />

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={step === 1 || step === 6}
            onClick={() => { setErr(""); setStep(step - 1); }}
            data-testid="button-setup-back"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Назад
          </Button>
          <div className="flex flex-wrap gap-2">
            {step < 5 && (
              <Button variant="ghost" size="sm" onClick={() => navigate("/references")} data-testid="button-setup-skip">
                Заполнить вручную позже
              </Button>
            )}
            {step === 1 && (
              <Button size="sm" onClick={() => saveOrg.mutate()} disabled={!org.trim() || saveOrg.isPending} data-testid="button-setup-next">
                Далее
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
            {(step === 2 || step === 3 || step === 4) && (
              <Button size="sm" onClick={() => { setErr(""); setStep(step + 1); }} data-testid="button-setup-next">
                Далее
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
            {step === 5 && (
              <Button size="sm" onClick={() => saveThresholds.mutate()} disabled={saveThresholds.isPending} data-testid="button-setup-finish">
                <Check className="mr-2 h-4 w-4" />
                Завершить настройку
              </Button>
            )}
            {step === 6 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setStep(1); toast({ title: "Мастер открыт заново" }); }}
                data-testid="button-setup-restart"
              >
                Пройти мастер заново
              </Button>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}
