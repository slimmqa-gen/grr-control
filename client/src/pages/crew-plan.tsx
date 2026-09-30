/**
 * Предварительный заезд: кого и куда планируем. Это ещё не вахта —
 * на статусы, вызовы, табели и MAX не влияет. Кнопка «Назначить вахту»
 * превращает план в настоящую вахту.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarPlus, Check, Download, Pencil, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Section, Empty, Loading, ErrorBox } from "@/components/shell";
import { ruDate, todayIso, downloadFile } from "@/lib/app";
import { employeeStateOn, type EmployeeState } from "@shared/status";

/** Статус на дату простыми словами и цвет */
const STATE: Record<EmployeeState, { label: string; cls: string; free: boolean; group: string }> = {
  between: { label: "на межвахте", cls: "border-emerald-500 text-emerald-700 dark:text-emerald-400", free: true, group: "free" },
  none: { label: "вахта не назначена", cls: "border-emerald-500 text-emerald-700 dark:text-emerald-400", free: true, group: "free" },
  onshift: { label: "на вахте", cls: "border-sky-500 text-sky-700 dark:text-sky-400", free: false, group: "busy" },
  vacation: { label: "в отпуске", cls: "border-amber-500 text-amber-700", free: false, group: "away" },
  sick: { label: "на больничном", cls: "border-amber-500 text-amber-700", free: false, group: "away" },
  study: { label: "на обучении", cls: "border-amber-500 text-amber-700", free: false, group: "away" },
  trip: { label: "в командировке", cls: "border-amber-500 text-amber-700", free: false, group: "away" },
  office: { label: "офис", cls: "border-slate-400 text-slate-600", free: false, group: "office" },
  pp: { label: "пробоподготовка", cls: "border-slate-400 text-slate-600", free: false, group: "office" },
};
const dm = (iso: string) => (iso && iso !== "9999-12-31" ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : "");

/** Состояние сотрудника на дату с пояснением: до какого числа, когда заезд */
function useAvailability(employees: any[], day: string) {
  const shiftsQ = useQuery<any[]>({ queryKey: ["/api/shifts"] });
  const eventsQ = useQuery<any[]>({ queryKey: ["/api/employee-events"] });
  return useMemo(() => {
    const shifts = shiftsQ.data ?? [];
    const events = eventsQ.data ?? [];
    const map = new Map<number, { state: EmployeeState; note: string }>();
    for (const e of employees) {
      const own = shifts.filter((s) => s.employeeId === e.id);
      const ev = events.filter((x) => x.employeeId === e.id);
      const state = employeeStateOn(day, e, own, ev);
      let note = "";
      if (state === "onshift") {
        const cur = own.find((s) => s.startDate <= day && s.endDate >= day);
        note = cur ? (dm(cur.endDate) ? `до ${dm(cur.endDate)}` : "выезд не определён") : "";
      } else if (["vacation", "sick", "study", "trip"].includes(state)) {
        const a = ev.find((x) => x.startDate <= day && x.endDate >= day);
        note = a && dm(a.endDate) ? `до ${dm(a.endDate)}` : "";
      } else if (state === "between" || state === "none") {
        const next = own.filter((s) => s.startDate > day).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
        note = next ? `следующий заезд ${dm(next.startDate)}` : "";
      }
      map.set(e.id, { state, note });
    }
    return map;
  }, [employees, shiftsQ.data, eventsQ.data, day]);
}

function StateBadge({ a }: { a?: { state: EmployeeState; note: string } }) {
  if (!a) return null;
  const st = STATE[a.state];
  return <Badge variant="outline" className={`text-[11px] ${st.cls}`}>{st.label}{a.note ? ` · ${a.note}` : ""}</Badge>;
}

type Form = { id: number; employeeIds: number[]; objectId: number; rigId: number; vehicleId: number; startDate: string; endDate: string; openEnd: boolean; note: string };
const EMPTY: Form = { id: 0, employeeIds: [], objectId: 0, rigId: 0, vehicleId: 0, startDate: todayIso(), endDate: "", openEnd: false, note: "" };
const isDriver = (p: string) => /водит|шофер|шофёр|машинист/i.test(String(p ?? ""));

export function PlanTab({ employees, objects }: { employees: any[]; objects: any[] }) {
  const { toast } = useToast();
  const refQ = useQuery<any>({ queryKey: ["/api/reference"] });
  const rigs: any[] = refQ.data?.rigs ?? [];
  const vehicles: any[] = refQ.data?.vehicles ?? [];
  // поиск свободных: на какую дату, какая должность, какой статус
  const [availDay, setAvailDay] = useState(todayIso());
  const [availPos, setAvailPos] = useState("");
  const [availGroup, setAvailGroup] = useState<"free" | "busy" | "away" | "all">("free");
  const [availQ, setAvailQ] = useState("");
  const [availPicked, setAvailPicked] = useState<number[]>([]);
  const avail = useAvailability(employees, availDay);
  const positions = Array.from(new Set(employees.map((e) => String(e.position || "")).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru"));
  const availList = employees.filter((e) => {
    const a = avail.get(e.id);
    if (!a) return false;
    if (availGroup !== "all" && STATE[a.state].group !== availGroup) return false;
    if (availPos && e.position !== availPos) return false;
    if (availQ && !String(e.fio).toLowerCase().includes(availQ.toLowerCase())) return false;
    return true;
  });
  const groupCount = (g: string) => employees.filter((e) => {
    const a = avail.get(e.id);
    return a && (g === "all" || STATE[a.state].group === g) && (!availPos || e.position === availPos);
  }).length;
  const plans = useQuery<any>({ queryKey: ["/api/shift-plans"] });
  const rows: any[] = plans.data?.rows ?? [];
  const [objFilter, setObjFilter] = useState(0);
  const [picked, setPicked] = useState<number[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  const shown = rows.filter((r) => !objFilter || r.objectId === objFilter);
  const byObject = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const r of shown) {
      if (!m.has(r.object)) m.set(r.object, []);
      m.get(r.object)!.push(r);
    }
    return Array.from(m);
  }, [shown]);

  const save = useMutation({
    mutationFn: async (f: Form) => {
      const body = { employeeIds: f.employeeIds, objectId: f.objectId, rigId: f.rigId, vehicleId: f.vehicleId, startDate: f.startDate, endDate: f.endDate, openEnd: f.openEnd, note: f.note };
      return (await (f.id ? apiRequest("PATCH", `/api/shift-plans/${f.id}`, body) : apiRequest("POST", "/api/shift-plans", body))).json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/shift-plans"] }); setOpen(false); toast({ title: "План сохранён" }); },
    onError: (e: any) => setErr(String(e?.message ?? e)),
  });
  const patchPlan = useMutation({
    mutationFn: async (v: { id: number; body: any }) => (await apiRequest("PATCH", `/api/shift-plans/${v.id}`, v.body)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/shift-plans"] }),
    onError: (e: any) => toast({ title: "Не сохранено", description: String(e?.message ?? e), variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/shift-plans/${id}`)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/shift-plans"] }); toast({ title: "Удалено из плана" }); },
  });
  const assign = useMutation({
    mutationFn: async (ids: number[]) => (await apiRequest("POST", "/api/shift-plans/assign", { ids })).json(),
    onSuccess: (d: any) => {
      queryClient.invalidateQueries();
      setPicked([]);
      toast({ title: `Подтверждено, вахта назначена: ${d.created}`, description: "Записи перенесены в «Вахты» со станком, машиной и заменой. Вызов отправляется отдельно — кнопкой." });
    },
    onError: (e: any) => toast({ title: "Не назначено", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const startNew = (ids: number[] = []) => {
    setErr(""); setQ("");
    setForm({ ...EMPTY, employeeIds: ids, startDate: availDay, objectId: objFilter || objects[0]?.id || 0 });
    setOpen(true);
  };
  const dlgAvail = useAvailability(employees, form.startDate || todayIso());
  const [dlgGroup, setDlgGroup] = useState<"all" | "free">("free");
  const edit = (r: any) => {
    setErr("");
    setForm({ id: r.id, employeeIds: [r.employeeId], objectId: r.objectId, rigId: r.rigId || 0, vehicleId: r.vehicleId || 0, startDate: r.startDate, endDate: r.endDate, openEnd: !r.endDate, note: r.note ?? "" });
    setOpen(true);
  };
  const empList = employees.filter((e) => (!q || String(e.fio).toLowerCase().includes(q.toLowerCase()))
    && (dlgGroup === "all" || form.employeeIds.includes(e.id) || STATE[dlgAvail.get(e.id)?.state ?? "none"].free));

  return (
    <>
      <Section
        title="Предварительный заезд"
        description="Кого и куда планируем. Это ещё не вахта: на статусы, вызовы, табели и бота MAX план не влияет. Когда решение принято — «Подтвердить»: вахта назначится сама."
        actions={(
          <div className="flex flex-wrap gap-2">
            {picked.length > 0 && (
              <Button size="sm" onClick={() => assign.mutate(picked)} disabled={assign.isPending} data-testid="button-plan-assign-picked">
                <Check className="mr-2 h-4 w-4" />Подтвердить выбранных ({picked.length})
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => downloadFile("/api/shift-plans/xlsx", "Предварительный заезд.xlsx")} data-testid="button-plan-xlsx">
              <Download className="mr-2 h-4 w-4" />План в Excel
            </Button>
            <Button size="sm" variant="outline" onClick={() => downloadFile("/api/shifts/xlsx-by-object", "Назначенные вахты.xlsx")} data-testid="button-shifts-xlsx">
              <Download className="mr-2 h-4 w-4" />Назначенные вахты в Excel
            </Button>
            <Button size="sm" variant="outline" onClick={() => startNew()} data-testid="button-plan-add">
              <CalendarPlus className="mr-2 h-4 w-4" />Запланировать
            </Button>
          </div>
        )}
      >
        <div className="mb-4 rounded-md border p-3" data-testid="box-availability">
          <div className="mb-2 text-sm font-semibold">Кто свободен</div>
          <div className="mb-2 flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">На дату</label>
              <Input type="date" className="h-8 w-40" value={availDay} onChange={(e) => setAvailDay(e.target.value || todayIso())} data-testid="input-avail-day" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Должность</label>
              <select className="h-8 rounded-md border bg-background px-2 text-sm" value={availPos} onChange={(e) => setAvailPos(e.target.value)} data-testid="select-avail-pos">
                <option value="">все должности</option>
                {positions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input className="h-8 w-48 pl-7 text-sm" placeholder="Фамилия" value={availQ} onChange={(e) => setAvailQ(e.target.value)} />
            </div>
          </div>
          <div className="mb-2 flex flex-wrap gap-2">
            {([["free", "Свободны: межвахта и без вахты"], ["busy", "На вахте"], ["away", "Отпуск, больничный, командировка"], ["all", "Все"]] as const).map(([g, label]) => (
              <Button key={g} size="sm" variant={availGroup === g ? "default" : "outline"} className="h-7" onClick={() => setAvailGroup(g)} data-testid={`button-avail-${g}`}>
                {label} ({groupCount(g)})
              </Button>
            ))}
          </div>
          <div className="max-h-64 overflow-auto rounded border" data-testid="list-availability">
            {availList.length === 0 ? <div className="p-2 text-sm text-muted-foreground">Никого.</div> : availList.map((e) => (
              <label key={e.id} className="flex items-center gap-2 border-b px-2 py-1 text-sm last:border-0 hover:bg-muted/50">
                <Checkbox checked={availPicked.includes(e.id)}
                  onCheckedChange={(v) => setAvailPicked(v ? [...availPicked, e.id] : availPicked.filter((x) => x !== e.id))} />
                <span className="w-44 shrink-0 truncate font-medium">{e.fio}</span>
                <span className="w-44 shrink-0 truncate text-xs text-muted-foreground">{e.position || "—"}</span>
                <StateBadge a={avail.get(e.id)} />
                {rows.some((r) => r.employeeId === e.id) && <Badge variant="secondary" className="text-[11px]">уже в плане</Badge>}
              </label>
            ))}
          </div>
          {availPicked.length > 0 && (
            <Button size="sm" className="mt-2" onClick={() => { startNew(availPicked); setAvailPicked([]); }} data-testid="button-avail-plan">
              <CalendarPlus className="mr-2 h-4 w-4" />Запланировать отмеченных ({availPicked.length})
            </Button>
          )}
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          <Button size="sm" variant={objFilter === 0 ? "default" : "outline"} className="h-7" onClick={() => setObjFilter(0)}>Все участки ({rows.length})</Button>
          {objects.map((o) => {
            const n = rows.filter((r) => r.objectId === o.id).length;
            return n ? (
              <Button key={o.id} size="sm" variant={objFilter === o.id ? "default" : "outline"} className="h-7" onClick={() => setObjFilter(o.id)}>
                {o.name} ({n})
              </Button>
            ) : null;
          })}
        </div>
        {plans.isLoading ? <Loading rows={3} /> : shown.length === 0 ? (
          <Empty text="План пуст. Нажмите «Запланировать» и отметьте людей." />
        ) : (
          <div className="space-y-4" data-testid="list-plans">
            {byObject.map(([obj, list]) => (
              <div key={obj}>
                <div className="mb-1 text-sm font-semibold">{obj} <span className="font-normal text-muted-foreground">· {list.length} чел.</span></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground whitespace-nowrap">
                        <th className="w-8 py-1.5" />
                        <th className="py-1.5 pr-3 font-medium">Сотрудник</th>
                        <th className="py-1.5 pr-3 font-medium">Заезд (план)</th>
                        <th className="py-1.5 pr-3 font-medium">Выезд (план)</th>
                        <th className="py-1.5 pr-3 font-medium">Станок / машина</th>
                        <th className="py-1.5 pr-3 font-medium">Кого меняет</th>
                        <th className="py-1.5 pr-3 font-medium">Примечание</th>
                        <th className="py-1.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r: any) => (
                        <tr key={r.id} className="border-b last:border-0" data-testid={`plan-row-${r.id}`}>
                          <td className="py-1.5">
                            <Checkbox checked={picked.includes(r.id)}
                              onCheckedChange={(v) => setPicked(v ? [...picked, r.id] : picked.filter((x) => x !== r.id))} />
                          </td>
                          <td className="py-1.5 pr-3">
                            <div className="font-medium whitespace-nowrap">{r.fio}</div>
                            <div className="text-xs text-muted-foreground">{r.position}</div>
                            {r.clash && <Badge variant="outline" className="mt-0.5 border-amber-500 text-[11px] text-amber-700">{r.clash}</Badge>}
                          </td>
                          <td className="num py-1.5 pr-3 whitespace-nowrap">{ruDate(r.startDate)}</td>
                          <td className="num py-1.5 pr-3 whitespace-nowrap">{r.endDate ? ruDate(r.endDate) : <span className="text-muted-foreground">не определена</span>}</td>
                          <td className="py-1.5 pr-3">
                            {r.driver ? (
                              <select className="h-8 max-w-[190px] rounded-md border bg-background px-1 text-sm" value={r.vehicleId || 0}
                                onChange={(e) => patchPlan.mutate({ id: r.id, body: { vehicleId: Number(e.target.value) } })}
                                data-testid={`select-plan-vehicle-${r.id}`}>
                                <option value={0}>машина —</option>
                                {vehicles.filter((x) => !r.objectId || !x.objectId || x.objectId === r.objectId || x.id === r.vehicleId).map((x) => (
                                  <option key={x.id} value={x.id}>{x.name}</option>
                                ))}
                              </select>
                            ) : (
                              <select className="h-8 max-w-[140px] rounded-md border bg-background px-1 text-sm" value={r.rigId || 0}
                                onChange={(e) => patchPlan.mutate({ id: r.id, body: { rigId: Number(e.target.value) } })}
                                data-testid={`select-plan-rig-${r.id}`}>
                                <option value={0}>станок —</option>
                                {rigs.filter((x) => !r.objectId || !x.objectId || x.objectId === r.objectId || x.id === r.rigId).map((x) => (
                                  <option key={x.id} value={x.id}>{x.name}{x.model ? ` (${x.model})` : ""}</option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td className="py-1.5 pr-3">
                            <select className="h-8 max-w-[210px] rounded-md border bg-background px-1 text-sm"
                              value={r.replacesAuto ? "auto" : String(r.replacesId)}
                              onChange={(e) => patchPlan.mutate({ id: r.id, body: { replaces: e.target.value } })}
                              data-testid={`select-plan-replaces-${r.id}`}>
                              <option value="auto">{r.replacesAuto && r.replacesFio ? `авто: ${r.replacesFio}` : "подобрать автоматически"}</option>
                              <option value="0">никого не меняет</option>
                              {employees
                                .filter((x) => x.id !== r.employeeId && (x.objectId === r.objectId || x.id === r.replacesId))
                                .sort((a, b) => Number(b.position === r.position) - Number(a.position === r.position) || String(a.fio).localeCompare(String(b.fio), "ru"))
                                .map((x) => <option key={x.id} value={String(x.id)}>{x.fio}{x.position ? ` — ${x.position}` : ""}</option>)}
                            </select>
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              {r.replacesId ? `${r.replacesAuto ? "подобрано по должности" : "выбрано вручную"}${r.replacesUntil ? ` · ${r.replacesUntil}` : ""}` : r.replacesAuto ? "замены по должности не найдено" : "без замены"}
                            </div>
                          </td>
                          <td className="py-1.5 pr-3 text-xs text-muted-foreground">{r.note}</td>
                          <td className="py-1.5 text-right whitespace-nowrap">
                            <Button size="sm" variant="outline" className="mr-1 h-7" onClick={() => assign.mutate([r.id])} disabled={assign.isPending}
                              data-testid={`button-plan-assign-${r.id}`}>
                              <Check className="mr-1 h-3.5 w-3.5" />Подтвердить
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => edit(r)} aria-label="Изменить"><Pencil className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { if (confirm(`Убрать ${r.fio} из плана?`)) del.mutate(r.id); }} aria-label="Удалить">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Изменить план" : "Запланировать заезд"}</DialogTitle>
            <DialogDescription>План не создаёт вахту и ничего не отправляет сотрудникам.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Участок</label>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={form.objectId}
                onChange={(e) => setForm({ ...form, objectId: Number(e.target.value) })} data-testid="select-plan-object">
                <option value={0}>не указан</option>
                {objects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Станок</label>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={form.rigId}
                onChange={(e) => setForm({ ...form, rigId: Number(e.target.value) })} data-testid="select-plan-rig">
                <option value={0}>не указан</option>
                {rigs.filter((x) => !form.objectId || !x.objectId || x.objectId === form.objectId).map((x) => (
                  <option key={x.id} value={x.id}>{x.name}{x.model ? ` (${x.model})` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Машина (для водителей)</label>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={form.vehicleId}
                onChange={(e) => setForm({ ...form, vehicleId: Number(e.target.value) })} data-testid="select-plan-vehicle">
                <option value={0}>не указана</option>
                {vehicles.filter((x) => !form.objectId || !x.objectId || x.objectId === form.objectId).map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Заезд (план) *</label>
              <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} data-testid="input-plan-start" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Выезд (план)</label>
              <Input type="date" value={form.openEnd ? "" : form.endDate} disabled={form.openEnd} min={form.startDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })} data-testid="input-plan-end" />
              <label className="mt-1 flex items-center gap-1.5 text-xs">
                <Checkbox checked={form.openEnd} onCheckedChange={(v) => setForm({ ...form, openEnd: !!v, endDate: v ? "" : form.endDate })} />
                не определена
              </label>
            </div>
          </div>
          {!form.id && (
            <div>
              <div className="mb-1 flex items-center gap-2">
                <label className="text-xs font-medium">Сотрудники: выбрано {form.employeeIds.length}</label>
                <Button size="sm" variant={dlgGroup === "free" ? "default" : "outline"} className="h-7" onClick={() => setDlgGroup("free")}>Свободны на дату заезда</Button>
                <Button size="sm" variant={dlgGroup === "all" ? "default" : "outline"} className="h-7" onClick={() => setDlgGroup("all")}>Все</Button>
                <div className="relative ml-auto w-56">
                  <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input className="h-8 pl-7 text-sm" placeholder="Поиск по ФИО" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
              </div>
              <div className="max-h-56 overflow-auto rounded-md border p-2" data-testid="list-plan-employees">
                <div className="grid gap-1">
                  {empList.map((e) => {
                    const on = form.employeeIds.includes(e.id);
                    return (
                      <label key={e.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                        <Checkbox checked={on}
                          onCheckedChange={(v) => setForm({ ...form, employeeIds: v ? [...form.employeeIds, e.id] : form.employeeIds.filter((x) => x !== e.id) })} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{e.fio} <span className="text-xs text-muted-foreground">{e.position}</span></span>
                          <StateBadge a={dlgAvail.get(e.id)} />
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium">Примечание</label>
            <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="например: под новую скважину, если подтвердят объём" />
          </div>
          {err && <ErrorBox text={err} />}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
            <Button
              disabled={save.isPending}
              onClick={() => {
                setErr("");
                if (!form.id && !form.employeeIds.length) return setErr("Отметьте сотрудников.");
                if (!form.startDate) return setErr("Укажите планируемую дату заезда.");
                if (!form.openEnd && form.endDate && form.endDate < form.startDate) return setErr("Дата выезда раньше даты заезда.");
                save.mutate(form);
              }}
              data-testid="button-plan-save"
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
