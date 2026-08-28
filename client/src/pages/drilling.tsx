import { useAuth } from "@/lib/auth";
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAnalytics, useList, useReference } from "@/lib/hooks";
import { PageHeader, Section, Empty, Loading, ErrorBox, ExportButton, Kpi } from "@/components/shell";
import { nf, ruDate, todayIso, downloadFile, money } from "@/lib/app";

const REASONS = [
  "нет", "погода", "поломка техники", "нет ГСМ", "нет решения заказчика",
  "переезд", "ремонт/ТО", "отсутствие персонала", "прочее",
];

const PERIODS = [
  { key: "7", label: "7 дней" },
  { key: "30", label: "30 дней" },
  { key: "60", label: "60 дней" },
  { key: "all", label: "Весь период" },
];

const emptyForm = {
  date: todayIso(), objectId: "", rigId: "", shift: "день",
  meters: "", drillHours: "", pzrHours: "", downtimeHours: "0",
  downtimeReason: "нет", comment: "",
};

export default function Drilling() {
  const { finance } = useAuth();
  const { data: ref } = useReference();
  const { data: analytics } = useAnalytics();
  const reports = useList<any>("/api/reports");
  const { toast } = useToast();

  const [period, setPeriod] = useState("30");
  const [objectId, setObjectId] = useState("all");
  const [rigId, setRigId] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [formError, setFormError] = useState("");

  const objects: any[] = ref?.objects ?? [];
  const rigs: any[] = ref?.rigs ?? [];
  const nameOf = (arr: any[], id: number) => arr.find((x) => x.id === id)?.name ?? "—";

  const rows = useMemo(() => {
    const list = [...(reports.data ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));
    const limit =
      period === "all" ? null : new Date(Date.now() - Number(period) * 86400000).toISOString().slice(0, 10);
    return list.filter(
      (r) =>
        (!limit || r.date >= limit) &&
        (objectId === "all" || r.objectId === Number(objectId)) &&
        (rigId === "all" || r.rigId === Number(rigId)),
    );
  }, [reports.data, period, objectId, rigId]);

  const totals = useMemo(() => {
    const m = rows.reduce((s, r) => s + r.meters, 0);
    const dt = rows.reduce((s, r) => s + r.downtimeHours, 0);
    const all = rows.reduce((s, r) => s + r.drillHours + r.pzrHours + r.downtimeHours, 0);
    return {
      meters: m,
      shifts: rows.length,
      perShift: rows.length ? m / rows.length : 0,
      downtimeHours: dt,
      downtimeShare: all ? (dt / all) * 100 : 0,
    };
  }, [rows]);

  const create = useMutation({
    mutationFn: async () => {
      const body = {
        date: form.date,
        objectId: Number(form.objectId),
        rigId: Number(form.rigId),
        brigadeId: 0,
        shift: form.shift,
        meters: Number(form.meters || 0),
        drillHours: Number(form.drillHours || 0),
        pzrHours: Number(form.pzrHours || 0),
        downtimeHours: Number(form.downtimeHours || 0),
        downtimeReason: form.downtimeReason,
        comment: form.comment,
      };
      const res = await apiRequest("POST", "/api/reports", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setForm({ ...emptyForm });
      setShowForm(false);
      setFormError("");
      toast({ title: "Рапорт добавлен", description: "Показатели пересчитаны." });
    },
    onError: (e: any) => setFormError(String(e.message).replace(/^\d+:\s*/, "").replace(/^\{"error":"|"\}$/g, "")),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/reports/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Рапорт удалён" });
    },
  });

  const submit = () => {
    setFormError("");
    if (!form.objectId || !form.rigId) {
      setFormError("Заполните объект и станок.");
      return;
    }
    const meters = Number(form.meters);
    if (!form.meters || Number.isNaN(meters) || meters < 0) {
      setFormError("Метры должны быть числом не меньше нуля.");
      return;
    }
    const hours = Number(form.drillHours || 0) + Number(form.pzrHours || 0) + Number(form.downtimeHours || 0);
    if (hours > 12) {
      setFormError(`Сумма часов больше 12 (${nf(hours, 1)} ч). Проверьте бурение, ПЗР и простой.`);
      return;
    }
    if (Number(form.downtimeHours || 0) > 0 && form.downtimeReason === "нет") {
      setFormError("Указан простой — выберите причину простоя.");
      return;
    }
    create.mutate();
  };

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <>
      <PageHeader
        title="Бурение и простои"
        subtitle="Сменные рапорты по станкам. Ручной ввод — резервный вариант, основной путь — импорт файлов с объектов."
        actions={
          <>
            <ExportButton
              testId="button-export-reports"
              onClick={() => downloadFile("/api/export/reports", "Бурение и простои.xlsx")}
            />
            <Button size="sm" onClick={() => setShowForm((v) => !v)} data-testid="button-add-report">
              <Plus className="mr-2 h-4 w-4" />
              Добавить рапорт
            </Button>
          </>
        }
      />

      {showForm && (
        <Card className="mb-4 p-4" data-testid="form-report">
          <h2 className="mb-3 text-sm font-semibold">Новый сменный рапорт</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Дата</label>
              <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} data-testid="input-date" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Объект</label>
              <Select value={form.objectId} onValueChange={(v) => set("objectId", v)}>
                <SelectTrigger data-testid="select-object"><SelectValue placeholder="Выберите объект" /></SelectTrigger>
                <SelectContent>
                  {objects.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Станок</label>
              <Select value={form.rigId} onValueChange={(v) => set("rigId", v)}>
                <SelectTrigger data-testid="select-rig"><SelectValue placeholder="Выберите станок" /></SelectTrigger>
                <SelectContent>
                  {rigs
                    .filter((r) => !form.objectId || r.objectId === Number(form.objectId))
                    .map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Смена</label>
              <Select value={form.shift} onValueChange={(v) => set("shift", v)}>
                <SelectTrigger data-testid="select-shift"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="день">день</SelectItem>
                  <SelectItem value="ночь">ночь</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Метры за смену</label>
              <Input inputMode="decimal" value={form.meters} onChange={(e) => set("meters", e.target.value)} data-testid="input-meters" placeholder="0" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Часы бурения</label>
              <Input inputMode="decimal" value={form.drillHours} onChange={(e) => set("drillHours", e.target.value)} data-testid="input-drill" placeholder="0" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Часы ПЗР</label>
              <Input inputMode="decimal" value={form.pzrHours} onChange={(e) => set("pzrHours", e.target.value)} data-testid="input-pzr" placeholder="0" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Часы простоя</label>
              <Input inputMode="decimal" value={form.downtimeHours} onChange={(e) => set("downtimeHours", e.target.value)} data-testid="input-downtime" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Причина простоя</label>
              <Select value={form.downtimeReason} onValueChange={(v) => set("downtimeReason", v)}>
                <SelectTrigger data-testid="select-reason"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium">Комментарий</label>
              <Input value={form.comment} onChange={(e) => set("comment", e.target.value)} data-testid="input-comment" placeholder="Необязательно" />
            </div>
          </div>
          {formError && <div className="mt-3"><ErrorBox text={formError} /></div>}
          <div className="mt-4 flex gap-2">
            <Button onClick={submit} disabled={create.isPending} data-testid="button-save-report">
              {create.isPending ? "Сохраняем…" : "Сохранить рапорт"}
            </Button>
            <Button variant="ghost" onClick={() => { setShowForm(false); setFormError(""); }} data-testid="button-cancel-report">
              Отмена
            </Button>
          </div>
        </Card>
      )}

      {/* Фильтры */}
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Период</label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger data-testid="filter-period"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Объект</label>
          <Select value={objectId} onValueChange={(v) => { setObjectId(v); setRigId("all"); }}>
            <SelectTrigger data-testid="filter-object"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все объекты</SelectItem>
              {objects.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Станок</label>
          <Select value={rigId} onValueChange={setRigId}>
            <SelectTrigger data-testid="filter-rig"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все станки</SelectItem>
              {rigs
                .filter((r) => objectId === "all" || r.objectId === Number(objectId))
                .map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi testId="kpi-sel-meters" label="Метры за период" value={`${nf(totals.meters)} м`} hint={`Смен: ${nf(totals.shifts)}`} />
        <Kpi testId="kpi-sel-pershift" label="Метры на смену" value={nf(totals.perShift, 1)} />
        <Kpi testId="kpi-sel-downtime" label="Часы простоя" value={nf(totals.downtimeHours, 1)} hint={`Доля ${nf(totals.downtimeShare, 1)} %`} />
        {finance && <Kpi
          testId="kpi-sel-lost"
          label="Цена простоев (месяц)"
          value={analytics ? money(analytics.lostTotal.money) : "—"}
          hint={analytics ? `${nf(analytics.lostTotal.meters)} м потеряно` : ""}
        />}
      </div>

      <Section title="Сменные рапорты" description={`Показано записей: ${nf(rows.length)}`}>
        {reports.isLoading ? (
          <Loading rows={3} />
        ) : rows.length === 0 ? (
          <Empty text="Нет данных за выбранный период. Добавьте сменный рапорт." />
        ) : (
          <div className="sticky-head max-h-[60vh] overflow-auto">
            <table className="w-full min-w-[860px] text-sm" data-testid="table-reports">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Дата</th>
                  <th className="py-2 pr-3 font-medium">Объект</th>
                  <th className="py-2 pr-3 font-medium">Станок</th>
                  <th className="py-2 pr-3 font-medium">Смена</th>
                  <th className="py-2 pr-3 text-right font-medium">Метры</th>
                  <th className="py-2 pr-3 text-right font-medium">Бурение, ч</th>
                  <th className="py-2 pr-3 text-right font-medium">ПЗР, ч</th>
                  <th className="py-2 pr-3 text-right font-medium">Простой, ч</th>
                  <th className="py-2 pr-3 font-medium">Причина</th>
                  <th className="py-2 font-medium"> </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 400).map((r) => (
                  <tr key={r.id} className="border-b last:border-0" data-testid={`row-report-${r.id}`}>
                    <td className="num py-2 pr-3 whitespace-nowrap">{ruDate(r.date)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{nameOf(objects, r.objectId)}</td>
                    <td className="py-2 pr-3">{nameOf(rigs, r.rigId)}</td>
                    <td className="py-2 pr-3">{r.shift}</td>
                    <td className="num py-2 pr-3 text-right font-medium">{nf(r.meters, 1)}</td>
                    <td className="num py-2 pr-3 text-right">{nf(r.drillHours, 1)}</td>
                    <td className="num py-2 pr-3 text-right">{nf(r.pzrHours, 1)}</td>
                    <td className="num py-2 pr-3 text-right">{nf(r.downtimeHours, 1)}</td>
                    <td className="py-2 pr-3">
                      {r.downtimeReason !== "нет" ? (
                        <Badge variant="outline" className="text-[11px]">{r.downtimeReason}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Удалить рапорт"
                        onClick={() => remove.mutate(r.id)}
                        data-testid={`button-delete-report-${r.id}`}
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
    </>
  );
}
