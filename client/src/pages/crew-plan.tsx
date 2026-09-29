/**
 * Предварительный заезд: кого и куда планируем. Это ещё не вахта —
 * на статусы, вызовы, табели и MAX не влияет. Кнопка «Назначить вахту»
 * превращает план в настоящую вахту.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarPlus, Check, Pencil, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Section, Empty, Loading, ErrorBox } from "@/components/shell";
import { ruDate, todayIso } from "@/lib/app";

type Form = { id: number; employeeIds: number[]; objectId: number; startDate: string; endDate: string; openEnd: boolean; note: string };
const EMPTY: Form = { id: 0, employeeIds: [], objectId: 0, startDate: todayIso(), endDate: "", openEnd: false, note: "" };

export function PlanTab({ employees, objects }: { employees: any[]; objects: any[] }) {
  const { toast } = useToast();
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
      const body = { employeeIds: f.employeeIds, objectId: f.objectId, startDate: f.startDate, endDate: f.endDate, openEnd: f.openEnd, note: f.note };
      return (await (f.id ? apiRequest("PATCH", `/api/shift-plans/${f.id}`, body) : apiRequest("POST", "/api/shift-plans", body))).json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/shift-plans"] }); setOpen(false); toast({ title: "План сохранён" }); },
    onError: (e: any) => setErr(String(e?.message ?? e)),
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
      toast({ title: `Вахта назначена: ${d.created}`, description: "Записи перенесены в «Вахты». Вызов отправляется отдельно — кнопкой." });
    },
    onError: (e: any) => toast({ title: "Не назначено", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const startNew = () => { setErr(""); setQ(""); setForm({ ...EMPTY, objectId: objFilter || objects[0]?.id || 0 }); setOpen(true); };
  const edit = (r: any) => {
    setErr("");
    setForm({ id: r.id, employeeIds: [r.employeeId], objectId: r.objectId, startDate: r.startDate, endDate: r.endDate, openEnd: !r.endDate, note: r.note ?? "" });
    setOpen(true);
  };
  const empList = employees.filter((e) => !q || String(e.fio).toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <Section
        title="Предварительный заезд"
        description="Кого и куда планируем. Это ещё не вахта: на статусы, вызовы, табели и бота MAX план не влияет. Когда решение принято — «Назначить вахту»."
        actions={(
          <div className="flex flex-wrap gap-2">
            {picked.length > 0 && (
              <Button size="sm" onClick={() => assign.mutate(picked)} disabled={assign.isPending} data-testid="button-plan-assign-picked">
                <Check className="mr-2 h-4 w-4" />Назначить вахту выбранным ({picked.length})
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={startNew} data-testid="button-plan-add">
              <CalendarPlus className="mr-2 h-4 w-4" />Запланировать
            </Button>
          </div>
        )}
      >
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
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="w-8 py-1.5" />
                        <th className="py-1.5 pr-3 font-medium">Сотрудник</th>
                        <th className="py-1.5 pr-3 font-medium">Заезд (план)</th>
                        <th className="py-1.5 pr-3 font-medium">Выезд (план)</th>
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
                            <div className="font-medium">{r.fio}</div>
                            <div className="text-xs text-muted-foreground">{r.position}</div>
                            {r.clash && <Badge variant="outline" className="mt-0.5 border-amber-500 text-[11px] text-amber-700">{r.clash}</Badge>}
                          </td>
                          <td className="num py-1.5 pr-3 whitespace-nowrap">{ruDate(r.startDate)}</td>
                          <td className="num py-1.5 pr-3 whitespace-nowrap">{r.endDate ? ruDate(r.endDate) : <span className="text-muted-foreground">не определена</span>}</td>
                          <td className="py-1.5 pr-3 text-xs text-muted-foreground">{r.note}</td>
                          <td className="py-1.5 text-right whitespace-nowrap">
                            <Button size="sm" variant="outline" className="mr-1 h-7" onClick={() => assign.mutate([r.id])} disabled={assign.isPending}
                              data-testid={`button-plan-assign-${r.id}`}>
                              <Check className="mr-1 h-3.5 w-3.5" />Назначить вахту
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
                <div className="relative ml-auto w-56">
                  <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input className="h-8 pl-7 text-sm" placeholder="Поиск по ФИО" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
              </div>
              <div className="max-h-56 overflow-auto rounded-md border p-2" data-testid="list-plan-employees">
                <div className="grid gap-1 sm:grid-cols-2">
                  {empList.map((e) => {
                    const on = form.employeeIds.includes(e.id);
                    return (
                      <label key={e.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                        <Checkbox checked={on}
                          onCheckedChange={(v) => setForm({ ...form, employeeIds: v ? [...form.employeeIds, e.id] : form.employeeIds.filter((x) => x !== e.id) })} />
                        <span className="truncate">{e.fio}</span>
                        <span className="truncate text-xs text-muted-foreground">{e.position}</span>
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
