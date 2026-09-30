/**
 * Предварительный выезд: кто и когда уезжает с участка.
 *  • Авто — сменяемые из плана заезда: выезд в день заезда сменщика.
 *  • Вручную — выбираете людей на вахте и дату.
 * «Подтвердить» ставит дату выезда в настоящую вахту.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Download, LogOut, Pencil, RotateCcw, Search, Trash2 } from "lucide-react";
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

const dm = (iso: string) => (iso && iso !== "9999-12-31" ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : "");

export function ExitTab({ employees, objects }: { employees: any[]; objects: any[] }) {
  const { toast } = useToast();
  const q = useQuery<any>({ queryKey: ["/api/exit-plans"] });
  const shiftsQ = useQuery<any[]>({ queryKey: ["/api/shifts"] });
  const rows: any[] = q.data?.rows ?? [];
  const [objFilter, setObjFilter] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employeeIds: [] as number[], endDate: todayIso(), note: "" });
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [onlyObj, setOnlyObj] = useState(0);

  const refresh = () => { queryClient.invalidateQueries({ queryKey: ["/api/exit-plans"] }); };
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/exit-plans", form)).json(),
    onSuccess: () => { refresh(); setOpen(false); toast({ title: "Выезд запланирован" }); },
    onError: (e: any) => setErr(String(e?.message ?? e)),
  });
  const remove = useMutation({
    mutationFn: async (key: string) => (await apiRequest("POST", "/api/exit-plans/remove", { key })).json(),
    onSuccess: () => { refresh(); toast({ title: "Убрано из плана выезда" }); },
  });
  const confirmM = useMutation({
    mutationFn: async (v: string[] | { objectId: number }) =>
      (await apiRequest("POST", "/api/exit-plans/confirm", Array.isArray(v) ? { keys: v } : v)).json(),
    onSuccess: (d: any) => {
      queryClient.invalidateQueries();
      setPicked([]);
      toast({ title: `Подтверждено выездов: ${d.done}`, description: "Дата выезда поставлена в вахту. Если вызов человеку отправляли — он получит сообщение в MAX." });
    },
    onError: (e: any) => toast({ title: "Не подтверждено", description: String(e?.message ?? e), variant: "destructive" }),
  });

  // кто сейчас на вахте или заезжает — из них выбираем выезд вручную
  const today = todayIso();
  const onShift = useMemo(() => {
    const sh = shiftsQ.data ?? [];
    return employees.map((e) => {
      const cur = sh.filter((s) => s.employeeId === e.id && s.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
      return cur ? { ...e, shift: cur } : null;
    }).filter(Boolean) as any[];
  }, [employees, shiftsQ.data, today]);
  const pickList = onShift.filter((e) => (!onlyObj || e.shift.objectId === onlyObj)
    && (!search || String(e.fio).toLowerCase().includes(search.toLowerCase())));

  const shown = rows.filter((r) => !objFilter || r.objectId === objFilter);
  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const r of shown) { if (!m.has(r.object)) m.set(r.object, []); m.get(r.object)!.push(r); }
    return Array.from(m);
  }, [shown]);

  const startManual = (ids: number[] = [], date = today) => {
    setErr(""); setSearch(""); setOnlyObj(objFilter);
    setForm({ employeeIds: ids, endDate: date, note: "" });
    setOpen(true);
  };

  return (
    <>
      <Section
        title="Предварительный выезд"
        description="Кто и когда уезжает. Авто — сменяемые из плана заезда (выезд в день заезда сменщика). Вручную — отметьте людей на вахте и дату. «Подтвердить» ставит дату выезда в вахту."
        actions={(
          <div className="flex flex-wrap gap-2">
            {picked.length > 0 && (
              <Button size="sm" onClick={() => confirmM.mutate(picked)} disabled={confirmM.isPending} data-testid="button-exit-confirm-picked">
                <Check className="mr-2 h-4 w-4" />Подтвердить выбранных ({picked.length})
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => downloadFile("/api/exit-plans/xlsx", "Предварительный выезд.xlsx")} data-testid="button-exit-xlsx">
              <Download className="mr-2 h-4 w-4" />Выезд в Excel
            </Button>
            <Button size="sm" variant="outline" onClick={() => startManual()} data-testid="button-exit-add">
              <LogOut className="mr-2 h-4 w-4" />Запланировать выезд вручную
            </Button>
          </div>
        )}
      >
        <div className="mb-3 flex flex-wrap gap-2">
          <Button size="sm" variant={objFilter === 0 ? "default" : "outline"} className="h-7" onClick={() => setObjFilter(0)}>Все участки ({rows.length})</Button>
          {objects.map((o) => {
            const n = rows.filter((r) => r.objectId === o.id).length;
            return n ? <Button key={o.id} size="sm" variant={objFilter === o.id ? "default" : "outline"} className="h-7" onClick={() => setObjFilter(o.id)}>{o.name} ({n})</Button> : null;
          })}
        </div>
        {q.isLoading ? <Loading rows={3} /> : shown.length === 0 ? (
          <Empty text="Выездов в плане нет. Они появятся сами, когда в плане заезда указано «кого меняет», или добавьте вручную." />
        ) : (
          <div className="space-y-4" data-testid="list-exits">
            {groups.map(([obj, list]) => (
              <div key={obj}>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{obj} <span className="font-normal text-muted-foreground">· {list.length} чел.</span></span>
                  <Button size="sm" className="ml-auto h-7" disabled={confirmM.isPending}
                    onClick={() => { if (confirm(`Подтвердить выезд всех на участке «${obj}» (${list.length} чел.)?`)) confirmM.mutate({ objectId: list[0].objectId }); }}
                    data-testid={`button-exit-confirm-object-${list[0].objectId}`}>
                    <Check className="mr-1 h-3.5 w-3.5" />Подтвердить всех на участке ({list.length})
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground whitespace-nowrap">
                        <th className="w-8 py-1.5" />
                        <th className="py-1.5 pr-3 font-medium">Сотрудник</th>
                        <th className="py-1.5 pr-3 font-medium">На вахте с</th>
                        <th className="py-1.5 pr-3 font-medium">Выезд по графику</th>
                        <th className="py-1.5 pr-3 font-medium">Выезд (план)</th>
                        <th className="py-1.5 pr-3 font-medium">Кто меняет</th>
                        <th className="py-1.5 pr-3 font-medium">Как</th>
                        <th className="py-1.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r: any) => (
                        <tr key={r.key} className="border-b last:border-0" data-testid={`exit-row-${r.key}`}>
                          <td className="py-1.5">
                            <Checkbox checked={picked.includes(r.key)} disabled={!r.shiftId}
                              onCheckedChange={(v) => setPicked(v ? [...picked, r.key] : picked.filter((x) => x !== r.key))} />
                          </td>
                          <td className="py-1.5 pr-3">
                            <div className="font-medium whitespace-nowrap">{r.fio}</div>
                            <div className="text-xs text-muted-foreground">{r.position}</div>
                            {r.warn && <Badge variant="outline" className="mt-0.5 border-amber-500 text-[11px] text-amber-700">{r.warn}</Badge>}
                            {r.note && <div className="text-xs text-muted-foreground">{r.note}</div>}
                          </td>
                          <td className="num py-1.5 pr-3 whitespace-nowrap">{r.shiftStart ? ruDate(r.shiftStart) : "—"}</td>
                          <td className="num py-1.5 pr-3 whitespace-nowrap text-muted-foreground">{r.shiftEndText}</td>
                          <td className="num py-1.5 pr-3 whitespace-nowrap font-medium">{ruDate(r.endDate)}</td>
                          <td className="py-1.5 pr-3">{r.replacedBy || <span className="text-muted-foreground">—</span>}</td>
                          <td className="py-1.5 pr-3">
                            <Badge variant="outline" className="text-[11px]">{r.source === "auto" ? "авто из заезда" : "вручную"}</Badge>
                          </td>
                          <td className="py-1.5 text-right whitespace-nowrap">
                            <Button size="sm" variant="outline" className="mr-1 h-7" disabled={!r.shiftId || confirmM.isPending}
                              onClick={() => confirmM.mutate([r.key])} data-testid={`button-exit-confirm-${r.key}`}>
                              <Check className="mr-1 h-3.5 w-3.5" />Подтвердить
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="Изменить дату"
                              onClick={() => startManual([r.employeeId], r.endDate)} aria-label="Изменить"><Pencil className="h-4 w-4" /></Button>
                            {r.source === "manual" && r.replacedBy && (
                              <Button size="icon" variant="ghost" className="h-7 w-7" title="Вернуть авто-дату из плана заезда"
                                onClick={() => apiRequest("POST", "/api/exit-plans/reset", { employeeId: r.employeeId }).then(refresh)} aria-label="Вернуть авто">
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            )}
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="Убрать из плана выезда"
                              onClick={() => { if (confirm(`Убрать ${r.fio} из плана выезда?`)) remove.mutate(r.key); }} aria-label="Убрать">
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
            <DialogTitle>Запланировать выезд</DialogTitle>
            <DialogDescription>Это план: дата выезда в вахте поменяется только после «Подтвердить».</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Дата выезда (план) *</label>
              <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} data-testid="input-exit-date" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Участок</label>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={onlyObj} onChange={(e) => setOnlyObj(Number(e.target.value))}>
                <option value={0}>все участки</option>
                {objects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div className="relative">
              <label className="mb-1 block text-xs font-medium">Поиск</label>
              <Search className="absolute left-2 top-8 h-3.5 w-3.5 text-muted-foreground" />
              <Input className="pl-7" placeholder="Фамилия" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium">На вахте: отметьте, кто выезжает (выбрано {form.employeeIds.length})</div>
            <div className="max-h-60 overflow-auto rounded-md border p-2" data-testid="list-exit-employees">
              {pickList.length === 0 ? <div className="text-sm text-muted-foreground">Никого нет на вахте.</div> : pickList.map((e) => (
                <label key={e.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                  <Checkbox checked={form.employeeIds.includes(e.id)}
                    onCheckedChange={(v) => setForm({ ...form, employeeIds: v ? [...form.employeeIds, e.id] : form.employeeIds.filter((x) => x !== e.id) })} />
                  <span className="w-44 shrink-0 truncate font-medium">{e.fio}</span>
                  <span className="w-40 shrink-0 truncate text-xs text-muted-foreground">{e.position || "—"}</span>
                  <Badge variant="outline" className="text-[11px]">
                    {e.shift.startDate > today ? `заезд ${dm(e.shift.startDate)}` : "на вахте"}{dm(e.shift.endDate) ? ` · по графику до ${dm(e.shift.endDate)}` : " · выезд не определён"}
                  </Badge>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Примечание</label>
            <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="например: досрочно по семейным, после окончания скважины" />
          </div>
          {err && <ErrorBox text={err} />}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
            <Button disabled={save.isPending}
              onClick={() => {
                setErr("");
                if (!form.employeeIds.length) return setErr("Отметьте сотрудников.");
                if (!form.endDate) return setErr("Укажите дату выезда.");
                save.mutate();
              }}
              data-testid="button-exit-save">Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
