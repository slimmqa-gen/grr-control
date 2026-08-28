import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Check, Trash2, Pencil, CalendarPlus, Search, Users, CalendarRange, Plane, HeartPulse, Briefcase, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAnalytics, useList, useReference } from "@/lib/hooks";
import { PageHeader, Section, Empty, Loading, ErrorBox, ExportButton, Kpi } from "@/components/shell";
import { nf, ruDate, todayIso, downloadFile, levelBadge, levelText, type Level } from "@/lib/app";
import { cn } from "@/lib/utils";

const CYCLES = ["30/30", "60/30", "15/15", "45/45", "60/60"];
const NO_OBJECT = "0";
const OWN_POSITION = "__own__";
const OWN_CYCLE = "__own__";

function addDaysIso(iso: string, days: number) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type Status = "onshift" | "between" | "none" | "vacation" | "sick" | "trip" | "study";
const MANUAL_STATUSES: Status[] = ["vacation", "sick", "trip", "study"];
const STATUS_TEXT: Record<Status, string> = {
  onshift: "На вахте",
  between: "На межвахте",
  none: "Вахта не назначена",
  vacation: "Отпуск",
  sick: "Больничный",
  trip: "Командировка",
  study: "Обучение",
};
const STATUS_LEVEL: Record<Status, Level> = {
  onshift: "ok",
  between: "warn",
  none: "bad",
  vacation: "warn",
  sick: "warn",
  trip: "warn",
  study: "warn",
};

export default function Crew() {
  const { data, isLoading, error } = useAnalytics();
  const { data: ref } = useReference();
  const employees = useList<any>("/api/employees");
  const shifts = useList<any>("/api/shifts");
  const empEventsQ = useList<any>("/api/employee-events");
  const { toast } = useToast();

  const [tab, setTab] = useState<"people" | "shifts" | "absence">("people");

  // фильтры справочника сотрудников
  const [q, setQ] = useState("");
  const [objectFilter, setObjectFilter] = useState("all");
  const [positionFilter, setPositionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  // фильтр вкладки «Вахты»
  const [shiftObjectFilter, setShiftObjectFilter] = useState("all");

  const [selected, setSelected] = useState<number[]>([]);

  // диалоги
  const [empDialog, setEmpDialog] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [empForm, setEmpForm] = useState({ fio: "", position: "", ownPosition: "", objectId: NO_OBJECT, phone: "" });
  const [empError, setEmpError] = useState("");

  const [shiftDialog, setShiftDialog] = useState<{ open: boolean; ids: number[] }>({ open: false, ids: [] });
  const [shiftForm, setShiftForm] = useState({ startDate: todayIso(), cycle: "30/30", ownCycle: "", objectId: "keep" });
  const [shiftError, setShiftError] = useState("");

  const [bulkDialog, setBulkDialog] = useState<null | "object" | "position">(null);
  const [bulkValue, setBulkValue] = useState("");
  const [bulkError, setBulkError] = useState("");

  const [delDialog, setDelDialog] = useState<{ open: boolean; ids: number[]; name: string }>({ open: false, ids: [], name: "" });

  const [absDialog, setAbsDialog] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [absForm, setAbsForm] = useState({
    employeeId: "", kind: "vacation", startDate: todayIso(), endDate: todayIso(), destination: "", note: "",
  });
  const [absError, setAbsError] = useState("");
  const [absDelDialog, setAbsDelDialog] = useState<{ open: boolean; id: number | null; name: string }>({ open: false, id: null, name: "" });
  const [absKindFilter, setAbsKindFilter] = useState("all");

  const objects: any[] = ref?.objects ?? [];
  const positions: any[] = ref?.positions ?? [];
  const emps: any[] = employees.data ?? [];
  const allShifts: any[] = shifts.data ?? [];

  const objName = (id: number) => objects.find((o) => o.id === id)?.name ?? "";
  const empFio = (id: number) => emps.find((e: any) => e.id === id)?.fio ?? "—";

  const today = todayIso();
  const statusOf = (empId: number, manualStatus?: string): Status => {
    if (manualStatus && (MANUAL_STATUSES as string[]).includes(manualStatus)) return manualStatus as Status;
    const own = allShifts.filter((s) => s.employeeId === empId);
    if (!own.length) return "none";
    return own.some((s) => s.startDate <= today && s.endDate >= today) ? "onshift" : "between";
  };

  const empAllEvents: any[] = empEventsQ.data ?? [];

  const absenceRows = useMemo(() => {
    return empAllEvents
      .map((ev: any) => {
        const daysLeft = Math.round(
          (new Date(ev.endDate + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000
        );
        const daysToStart = Math.round(
          (new Date(ev.startDate + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000
        );
        const state: "active" | "upcoming" | "past" =
          ev.startDate <= today && ev.endDate >= today ? "active" : ev.startDate > today ? "upcoming" : "past";
        return { ...ev, fio: empFio(ev.employeeId), daysLeft, daysToStart, state };
      })
      .filter((ev: any) => absKindFilter === "all" || ev.kind === absKindFilter)
      .sort((a: any, b: any) => {
        const order: any = { active: 0, upcoming: 1, past: 2 };
        if (order[a.state] !== order[b.state]) return order[a.state] - order[b.state];
        return a.startDate < b.startDate ? 1 : -1;
      });
  }, [empAllEvents, emps, today, absKindFilter]);

  const absCounters = useMemo(() => {
    const active = absenceRows.filter((e: any) => e.state === "active");
    return {
      vacation: active.filter((e: any) => e.kind === "vacation").length,
      sick: active.filter((e: any) => e.kind === "sick").length,
      trip: active.filter((e: any) => e.kind === "trip").length,
      study: active.filter((e: any) => e.kind === "study").length,
      endingSoon: active.filter((e: any) => e.daysLeft <= 2).length,
    };
  }, [absenceRows]);

  const saveAbsence = useMutation({
    mutationFn: async () => {
      const body = {
        employeeId: Number(absForm.employeeId) || 0,
        kind: absForm.kind,
        startDate: absForm.startDate,
        endDate: absForm.endDate,
        destination: absForm.destination.trim(),
        note: absForm.note.trim(),
      };
      if (absDialog.id) return (await apiRequest("PATCH", `/api/employee-events/${absDialog.id}`, body)).json();
      return (await apiRequest("POST", "/api/employee-events", body)).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setAbsDialog({ open: false, id: null });
      toast({ title: absDialog.id ? "Запись обновлена" : "Запись добавлена" });
    },
    onError: (e: any) => setAbsError(String(e.message)),
  });

  const deleteAbsence = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/employee-events/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setAbsDelDialog({ open: false, id: null, name: "" });
      toast({ title: "Запись удалена" });
    },
  });

  const openAddAbsence = () => {
    setAbsError("");
    setAbsForm({ employeeId: "", kind: "vacation", startDate: todayIso(), endDate: todayIso(), destination: "", note: "" });
    setAbsDialog({ open: true, id: null });
  };
  const openEditAbsence = (ev: any) => {
    setAbsError("");
    setAbsForm({
      employeeId: String(ev.employeeId), kind: ev.kind, startDate: ev.startDate, endDate: ev.endDate,
      destination: ev.destination ?? "", note: ev.note ?? "",
    });
    setAbsDialog({ open: true, id: ev.id });
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return emps
      .map((e) => ({ ...e, status: statusOf(e.id, e.manualStatus) as Status }))
      .filter((e) =>
        (!needle || String(e.fio).toLowerCase().includes(needle)) &&
        (objectFilter === "all" || (objectFilter === NO_OBJECT ? !e.objectId : e.objectId === Number(objectFilter))) &&
        (positionFilter === "all" || e.position === positionFilter) &&
        (statusFilter === "all" || e.status === statusFilter));
  }, [emps, allShifts, q, objectFilter, positionFilter, statusFilter, today]);

  const counters = useMemo(() => {
    const all = emps.map((e) => statusOf(e.id, e.manualStatus));
    return {
      total: emps.length,
      onshift: all.filter((s) => s === "onshift").length,
      between: all.filter((s) => s === "between").length,
      none: all.filter((s) => s === "none").length,
    };
  }, [emps, allShifts, today]);

  const objectStaffing = useMemo(
    () =>
      objects
        .map((o) => {
          const fact = emps.filter((e) => e.objectId === o.id).length;
          const plan = Number(o.staffRequired) || 0;
          return { id: o.id, name: o.name, fact, plan, complete: plan === 0 || fact >= plan };
        })
        .filter((o) => o.plan > 0 || o.fact > 0),
    [objects, emps],
  );

  const positionOptions = useMemo(() => {
    const list = positions.map((p: any) => p.name);
    emps.forEach((e) => { if (e.position && !list.includes(e.position)) list.push(e.position); });
    return list.sort((a: string, b: string) => a.localeCompare(b, "ru"));
  }, [positions, emps]);

  /* ---------- мутации ---------- */

  const updateManualStatus = useMutation({
    mutationFn: async ({ id, manualStatus }: { id: number; manualStatus: string }) =>
      (await apiRequest("PATCH", `/api/employees/${id}`, { manualStatus })).json(),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const saveEmployee = useMutation({
    mutationFn: async () => {
      const position = empForm.position === OWN_POSITION ? empForm.ownPosition.trim() : empForm.position;
      const body = {
        fio: empForm.fio.trim(),
        position,
        objectId: Number(empForm.objectId) || 0,
        brigadeId: 0,
        phone: empForm.phone.trim(),
      };
      if (empDialog.id) return (await apiRequest("PATCH", `/api/employees/${empDialog.id}`, body)).json();
      const created = (await apiRequest("POST", "/api/employees", body)).json();
      // новая должность попадает в справочник должностей
      if (position && !positions.some((p: any) => p.name.toLowerCase() === position.toLowerCase()))
        await apiRequest("POST", "/api/ref/positions", { name: position }).catch(() => undefined);
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setEmpDialog({ open: false, id: null });
      toast({ title: empDialog.id ? "Сотрудник изменён" : "Сотрудник добавлен" });
    },
    onError: (e: any) => setEmpError(String(e.message)),
  });

  const assignShift = useMutation({
    mutationFn: async () => {
      const cycleType = shiftForm.cycle === OWN_CYCLE ? shiftForm.ownCycle.replace(/\s/g, "") : shiftForm.cycle;
      return (await apiRequest("POST", "/api/employees/bulk-shift", {
        ids: shiftDialog.ids,
        startDate: shiftForm.startDate,
        cycleType,
        objectId: shiftForm.objectId === "keep" ? 0 : Number(shiftForm.objectId),
      })).json();
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries();
      setShiftDialog({ open: false, ids: [] });
      setSelected([]);
      toast({ title: "Вахта назначена", description: `Сотрудников: ${nf(res.created)}, выезд ${ruDate(res.endDate)}.` });
    },
    onError: (e: any) => setShiftError(String(e.message)),
  });

  const bulkUpdate = useMutation({
    mutationFn: async () => {
      const body: any = { ids: selected };
      if (bulkDialog === "object") body.objectId = Number(bulkValue) || 0;
      else body.position = bulkValue;
      return (await apiRequest("POST", "/api/employees/bulk-update", body)).json();
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries();
      setBulkDialog(null);
      setSelected([]);
      toast({ title: "Изменения сохранены", description: `Изменено сотрудников: ${nf(res.updated)}.` });
    },
    onError: (e: any) => setBulkError(String(e.message)),
  });

  const removeEmployees = useMutation({
    mutationFn: async (ids: number[]) =>
      ids.length === 1
        ? (await apiRequest("DELETE", `/api/employees/${ids[0]}`)).json()
        : (await apiRequest("POST", "/api/employees/bulk-delete", { ids })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setDelDialog({ open: false, ids: [], name: "" });
      setSelected([]);
      toast({ title: "Сотрудники удалены" });
    },
  });

  const markReplacement = useMutation({
    mutationFn: async (id: number) =>
      (await apiRequest("PATCH", `/api/shifts/${id}`, { replacementAssigned: 1 })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Замена отмечена" });
    },
  });

  const deleteShift = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/shifts/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Вахта снята" });
    },
  });

  if (isLoading) return <Loading rows={4} />;
  if (error || !data) return <ErrorBox text="Не удалось загрузить данные по сотрудникам. Обновите страницу." />;

  const th = data.thresholds;
  const rotation = data.rotation.filter(
    (r: any) => shiftObjectFilter === "all" || r.objectId === Number(shiftObjectFilter),
  );
  const soon = data.rotation.filter((r: any) => r.daysLeft <= th.rotationEndDays);

  const nowDate = new Date(data.nowIso);
  const span = 60;
  const bar = (r: any) => {
    const start = Math.max(0, Math.round((new Date(r.startDate).getTime() - nowDate.getTime()) / 86400000));
    const end = Math.min(span, Math.round((new Date(r.endDate).getTime() - nowDate.getTime()) / 86400000) + 1);
    return { left: (start / span) * 100, width: Math.max(2, ((end - start) / span) * 100) };
  };

  const openAdd = () => {
    setEmpError("");
    setEmpForm({ fio: "", position: positionOptions[0] ?? "", ownPosition: "", objectId: NO_OBJECT, phone: "" });
    setEmpDialog({ open: true, id: null });
  };
  const openEdit = (e: any) => {
    setEmpError("");
    setEmpForm({
      fio: e.fio,
      position: positionOptions.includes(e.position) ? e.position : OWN_POSITION,
      ownPosition: positionOptions.includes(e.position) ? "" : e.position,
      objectId: String(e.objectId || 0),
      phone: e.phone ?? "",
    });
    setEmpDialog({ open: true, id: e.id });
  };
  const openAssign = (ids: number[]) => {
    setShiftError("");
    setShiftForm({ startDate: todayIso(), cycle: "30/30", ownCycle: "", objectId: "keep" });
    setShiftDialog({ open: true, ids });
  };

  const shiftEnd = (() => {
    const c = shiftForm.cycle === OWN_CYCLE ? shiftForm.ownCycle.replace(/\s/g, "") : shiftForm.cycle;
    const days = Number(String(c).split("/")[0]);
    return days > 0 ? addDaysIso(shiftForm.startDate, days - 1) : "";
  })();

  const allChecked = rows.length > 0 && rows.every((r) => selected.includes(r.id));
  const toggleAll = () =>
    setSelected(allChecked ? selected.filter((id) => !rows.some((r) => r.id === id)) : [...new Set([...selected, ...rows.map((r) => r.id)])]);
  const toggleOne = (id: number) =>
    setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <>
      <PageHeader
        title="Сотрудники и вахты"
        subtitle="Справочник людей и график вахт: кто на объекте, у кого вахта не назначена"
        actions={
          <>
            <ExportButton
              testId="button-export-crew"
              onClick={() => downloadFile("/api/export/crew", "Сотрудники и вахты.xlsx")}
            />
            <Button size="sm" onClick={openAdd} data-testid="button-add-employee">
              <Plus className="mr-2 h-4 w-4" />
              Добавить сотрудника
            </Button>
          </>
        }
      />

      {/* вкладки */}
      <div className="mb-4 inline-flex rounded-md border p-1" role="tablist">
        <Button
          size="sm"
          variant={tab === "people" ? "default" : "ghost"}
          onClick={() => setTab("people")}
          data-testid="tab-people"
        >
          <Users className="mr-2 h-4 w-4" />
          Сотрудники
        </Button>
        <Button
          size="sm"
          variant={tab === "shifts" ? "default" : "ghost"}
          onClick={() => setTab("shifts")}
          data-testid="tab-shifts"
        >
          <CalendarRange className="mr-2 h-4 w-4" />
          Вахты
        </Button>
        <Button
          size="sm"
          variant={tab === "absence" ? "default" : "ghost"}
          onClick={() => setTab("absence")}
          data-testid="tab-absence"
        >
          <Plane className="mr-2 h-4 w-4" />
          Отсутствия
          {absCounters.endingSoon > 0 && (
            <Badge variant="outline" className="ml-2 border-amber-500 text-amber-600 text-[11px]">
              {nf(absCounters.endingSoon)}
            </Badge>
          )}
        </Button>
      </div>

      {tab === "people" && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi testId="kpi-total" label="Всего сотрудников" value={nf(counters.total)} hint="В справочнике" />
            <Kpi testId="kpi-onshift" label="На вахте" value={nf(counters.onshift)} level={counters.onshift > 0 ? "ok" : "warn"} />
            <Kpi testId="kpi-between" label="На межвахте" value={nf(counters.between)} />
            <Kpi
              testId="kpi-noshift"
              label="Вахта не назначена"
              value={nf(counters.none)}
              level={counters.none === 0 ? "ok" : "warn"}
              hint="Отметьте людей и назначьте вахту"
            />
          </div>

          <Card className="mb-4 p-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Поиск по ФИО</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Фамилия или имя"
                    data-testid="input-search-fio"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Объект</label>
                <Select value={objectFilter} onValueChange={setObjectFilter}>
                  <SelectTrigger data-testid="filter-crew-object"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все объекты</SelectItem>
                    <SelectItem value={NO_OBJECT}>Объект не указан</SelectItem>
                    {objects.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Должность</label>
                <Select value={positionFilter} onValueChange={setPositionFilter}>
                  <SelectTrigger data-testid="filter-crew-position"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все должности</SelectItem>
                    {positionOptions.map((p: string) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Статус</label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger data-testid="filter-crew-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все статусы</SelectItem>
                    <SelectItem value="onshift">На вахте</SelectItem>
                    <SelectItem value="between">На межвахте</SelectItem>
                    <SelectItem value="none">Вахта не назначена</SelectItem>
                    <SelectItem value="vacation">Отпуск</SelectItem>
                    <SelectItem value="sick">Больничный</SelectItem>
                    <SelectItem value="trip">Командировка</SelectItem>
                    <SelectItem value="study">Обучение</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>

          {selected.length > 0 && (
            <Card className="mb-4 flex flex-wrap items-center gap-2 p-3" data-testid="bulk-bar">
              <span className="mr-1 text-sm font-medium" data-testid="text-selected-count">
                Выбрано: {nf(selected.length)}
              </span>
              <Button size="sm" onClick={() => openAssign(selected)} data-testid="button-bulk-shift">
                <CalendarPlus className="mr-2 h-4 w-4" />
                Назначить вахту
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setBulkError(""); setBulkValue(NO_OBJECT); setBulkDialog("object"); }}
                data-testid="button-bulk-object"
              >
                Изменить объект
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setBulkError(""); setBulkValue(positionOptions[0] ?? ""); setBulkDialog("position"); }}
                data-testid="button-bulk-position"
              >
                Изменить должность
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDelDialog({ open: true, ids: selected, name: `${selected.length} чел.` })}
                data-testid="button-bulk-delete"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Удалить
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])} data-testid="button-clear-selection">
                Снять выделение
              </Button>
            </Card>
          )}

          <Section
            className="mb-4"
            title="Справочник сотрудников"
            description={`Показано: ${nf(rows.length)} из ${nf(emps.length)}`}
          >
            {emps.length === 0 ? (
              <Empty text="Сотрудники не внесены. Нажмите «Добавить сотрудника» или загрузите файл в разделе «Загрузка» (тип данных «Сотрудники»)." />
            ) : rows.length === 0 ? (
              <Empty text="По выбранным фильтрам никого нет. Сбросьте фильтры или измените поиск." />
            ) : (
              <div className="sticky-head max-h-[60vh] overflow-auto">
                <table className="w-full min-w-[760px] text-sm" data-testid="table-employees">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="w-8 py-2 pr-2">
                        <Checkbox checked={allChecked} onCheckedChange={toggleAll} aria-label="Выбрать всех" data-testid="checkbox-all" />
                      </th>
                      <th className="py-2 pr-3 font-medium">ФИО</th>
                      <th className="py-2 pr-3 font-medium">Должность</th>
                      <th className="py-2 pr-3 font-medium">Объект</th>
                      <th className="py-2 pr-3 font-medium">Телефон</th>
                      <th className="py-2 pr-3 font-medium">Статус</th>
                      <th className="py-2 text-right font-medium">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((e: any) => (
                      <tr key={e.id} className="border-b last:border-0" data-testid={`row-employee-${e.id}`}>
                        <td className="py-2 pr-2">
                          <Checkbox
                            checked={selected.includes(e.id)}
                            onCheckedChange={() => toggleOne(e.id)}
                            aria-label={`Выбрать ${e.fio}`}
                            data-testid={`checkbox-employee-${e.id}`}
                          />
                        </td>
                        <td className="py-2 pr-3 font-medium">{e.fio}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{e.position}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{objName(e.objectId) || "не указан"}</td>
                        <td className="num py-2 pr-3 whitespace-nowrap text-muted-foreground">{e.phone || "—"}</td>
                        <td className="py-2 pr-3">
                          <Select
                            value={e.manualStatus || "auto"}
                            onValueChange={(v) => updateManualStatus.mutate({ id: e.id, manualStatus: v === "auto" ? "" : v })}
                          >
                            <SelectTrigger
                              className={cn(
                                "h-6 w-auto gap-1 border px-2 text-[11px] font-medium [&>svg]:h-3 [&>svg]:w-3",
                                levelBadge[STATUS_LEVEL[e.status as Status]]
                              )}
                              data-testid={`select-manualstatus-${e.id}`}
                            >
                              <SelectValue>{STATUS_TEXT[e.status as Status]}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="auto">Автоматически</SelectItem>
                              <SelectItem value="vacation">Отпуск</SelectItem>
                              <SelectItem value="sick">Больничный</SelectItem>
                              <SelectItem value="trip">Командировка</SelectItem>
                              <SelectItem value="study">Обучение</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-2">
                          <div className="flex justify-end gap-1">
                            {e.status === "none" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openAssign([e.id])}
                                data-testid={`button-assign-shift-${e.id}`}
                              >
                                <CalendarPlus className="mr-1 h-3.5 w-3.5" />
                                Назначить вахту
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Изменить сотрудника"
                              onClick={() => openEdit(e)}
                              data-testid={`button-edit-employee-${e.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Удалить сотрудника"
                              onClick={() => setDelDialog({ open: true, ids: [e.id], name: e.fio })}
                              data-testid={`button-delete-employee-${e.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {objectStaffing.length > 0 && (
            <Section title="Укомплектованность по объектам" description="Сколько людей закреплено за объектом против штатной численности">
              <div className="grid gap-2 sm:grid-cols-2" data-testid="list-staffing">
                {objectStaffing.map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2" data-testid={`staffing-object-${o.id}`}>
                    <div className="min-w-0 truncate text-sm font-medium">{o.name}</div>
                    <Badge variant="outline" className={cn("shrink-0 border text-[11px]", levelBadge[o.complete ? "ok" : "warn"])}>
                      {nf(o.fact)} из {nf(o.plan)} чел.
                    </Badge>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      )}

      {tab === "shifts" && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              testId="kpi-on-site"
              label="Людей на вахте"
              value={`${nf(data.kpi.peopleOnSite)} / ${nf(data.kpi.staffRequired)}`}
              hint="Факт / штат"
              level={
                data.kpi.peopleOnSite >= data.kpi.staffRequired
                  ? "ok"
                  : data.kpi.peopleOnSite >= data.kpi.staffRequired * 0.85
                    ? "warn"
                    : "bad"
              }
            />
            <Kpi
              testId="kpi-rotation-soon"
              label="Выезд в ближайшие дни"
              value={nf(soon.length)}
              hint={`Порог ${nf(th.rotationEndDays)} дн.`}
              level={soon.length === 0 ? "ok" : "warn"}
            />
            <Kpi
              testId="kpi-no-replacement"
              label="Без назначенной замены"
              value={nf(soon.filter((r: any) => !r.replacementAssigned).length)}
              level={soon.filter((r: any) => !r.replacementAssigned).length === 0 ? "ok" : "bad"}
            />
            <Kpi testId="kpi-noshift-total" label="Вахта не назначена" value={nf(counters.none)} hint="Из справочника сотрудников" />
          </div>

          <Card className="mb-4 flex flex-wrap items-end gap-3 p-3">
            <div className="min-w-[200px]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Объект</label>
              <Select value={shiftObjectFilter} onValueChange={setShiftObjectFilter}>
                <SelectTrigger data-testid="filter-shift-object"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все объекты</SelectItem>
                  {objects.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={() => { setTab("people"); }} data-testid="button-go-people">
              <CalendarPlus className="mr-2 h-4 w-4" />
              Назначить вахту
            </Button>
          </Card>

          <Section className="mb-4" title="Кто сейчас на объекте" description="Сортировка по дате выезда">
            {allShifts.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center" data-testid="empty-shifts">
                <div className="text-sm font-medium">Вахты ещё не назначены</div>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Перейдите на вкладку «Сотрудники», выберите людей галочками и нажмите «Назначить вахту».
                  Дата выезда посчитается автоматически по циклу.
                </p>
                <Button className="mt-3" size="sm" onClick={() => setTab("people")} data-testid="button-empty-go-people">
                  <Users className="mr-2 h-4 w-4" />
                  Перейти к сотрудникам
                </Button>
              </div>
            ) : rotation.length === 0 ? (
              <Empty text="На выбранном объекте сейчас нет людей на вахте." />
            ) : (
              <div className="sticky-head max-h-[55vh] overflow-auto">
                <table className="w-full min-w-[760px] text-sm" data-testid="table-rotation">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">ФИО</th>
                      <th className="py-2 pr-3 font-medium">Должность</th>
                      <th className="py-2 pr-3 font-medium">Объект</th>
                      <th className="py-2 pr-3 font-medium">Цикл</th>
                      <th className="py-2 pr-3 font-medium">Заезд</th>
                      <th className="py-2 pr-3 font-medium">Выезд</th>
                      <th className="py-2 pr-3 text-right font-medium">Осталось, дн.</th>
                      <th className="py-2 font-medium">Замена</th>
                      <th className="py-2 text-right font-medium">Вахта</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rotation.map((r: any) => {
                      const lvl: Level = r.daysLeft <= 0 ? "bad" : r.daysLeft <= th.rotationEndDays ? "warn" : "ok";
                      return (
                        <tr key={r.shiftId} className="border-b last:border-0" data-testid={`row-rotation-${r.shiftId}`}>
                          <td className="py-2 pr-3 font-medium whitespace-nowrap">{r.fio}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">{r.position}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">{r.object}</td>
                          <td className="num py-2 pr-3">{r.cycleType}</td>
                          <td className="num py-2 pr-3 whitespace-nowrap">{ruDate(r.startDate)}</td>
                          <td className="num py-2 pr-3 whitespace-nowrap">{ruDate(r.endDate)}</td>
                          <td className={cn("num py-2 pr-3 text-right font-medium", levelText[lvl])}>
                            {nf(r.daysLeft)}
                            {r.overtime && <span className="ml-1 text-xs">переработка</span>}
                          </td>
                          <td className="py-2">
                            {r.replacementAssigned ? (
                              <Badge variant="outline" className={cn("border text-[11px]", levelBadge.ok)}>назначена</Badge>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => markReplacement.mutate(r.shiftId)}
                                data-testid={`button-replacement-${r.shiftId}`}
                              >
                                <Check className="mr-1 h-3.5 w-3.5" />
                                Отметить
                              </Button>
                            )}
                          </td>
                          <td className="py-2 text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Снять вахту"
                              onClick={() => deleteShift.mutate(r.shiftId)}
                              data-testid={`button-delete-shift-${r.shiftId}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Календарь вахт" description="Ближайшие 60 дней, полоса — период работы на объекте">
            {rotation.length === 0 ? (
              <Empty text="Нет активных вахт для отображения." />
            ) : (
              <div className="space-y-1.5" data-testid="calendar-shifts">
                {rotation.slice(0, 24).map((r: any) => {
                  const b = bar(r);
                  return (
                    <div key={r.shiftId} className="flex items-center gap-2">
                      <div className="w-32 shrink-0 truncate text-xs sm:w-44">{r.fio}</div>
                      <div className="relative h-4 flex-1 rounded bg-muted">
                        <div
                          className={cn(
                            "absolute inset-y-0 rounded",
                            r.daysLeft <= th.rotationEndDays ? "bg-amber-500" : "bg-primary dark:bg-primary/80",
                          )}
                          style={{ left: `${b.left}%`, width: `${b.width}%` }}
                          title={`${ruDate(r.startDate)} — ${ruDate(r.endDate)}`}
                        />
                      </div>
                      <div className="num w-20 shrink-0 text-right text-xs text-muted-foreground">
                        {ruDate(r.endDate)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        </>
      )}

      {tab === "absence" && (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Kpi testId="kpi-abs-vacation" label="В отпуске" value={nf(absCounters.vacation)} />
              <Kpi testId="kpi-abs-sick" label="На больничном" value={nf(absCounters.sick)} />
              <Kpi testId="kpi-abs-trip" label="В командировке" value={nf(absCounters.trip)} />
              <Kpi testId="kpi-abs-study" label="На обучении" value={nf(absCounters.study)} />
              <Kpi
                testId="kpi-abs-ending"
                label="Заканчивается в течение 2 дн."
                value={nf(absCounters.endingSoon)}
                level={absCounters.endingSoon > 0 ? "warn" : "ok"}
              />
            </div>
            <Button size="sm" onClick={openAddAbsence} data-testid="button-add-absence">
              <Plus className="mr-2 h-4 w-4" />
              Добавить запись
            </Button>
          </div>

          <Card className="mb-4 p-3">
            <div className="max-w-xs">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Тип события</label>
              <Select value={absKindFilter} onValueChange={setAbsKindFilter}>
                <SelectTrigger data-testid="filter-absence-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все типы</SelectItem>
                  <SelectItem value="vacation">Отпуск</SelectItem>
                  <SelectItem value="sick">Больничный</SelectItem>
                  <SelectItem value="trip">Командировка</SelectItem>
                  <SelectItem value="study">Обучение</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Card>

          <Section
            title="Отпуска, больничные, командировки, обучение"
            description={`Показано: ${absenceRows.length}`}
          >
            {absenceRows.length === 0 ? (
              <Empty text="Нет записей. Добавьте отпуск, больничный, командировку или обучение сотрудника." />
            ) : (
              <div className="sticky-head max-h-[60vh] overflow-auto">
                <table className="w-full min-w-[820px] text-sm" data-testid="table-absence">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">ФИО</th>
                      <th className="py-2 pr-3 font-medium">Тип</th>
                      <th className="py-2 pr-3 font-medium">С</th>
                      <th className="py-2 pr-3 font-medium">По</th>
                      <th className="py-2 pr-3 font-medium">Куда / примечание</th>
                      <th className="py-2 pr-3 font-medium">Статус</th>
                      <th className="py-2 text-right font-medium">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {absenceRows.map((ev: any) => {
                      const icon =
                        ev.kind === "vacation" ? <Plane className="h-3.5 w-3.5" /> :
                        ev.kind === "sick" ? <HeartPulse className="h-3.5 w-3.5" /> :
                        ev.kind === "trip" ? <Briefcase className="h-3.5 w-3.5" /> :
                        <GraduationCap className="h-3.5 w-3.5" />;
                      const kindLabel =
                        ev.kind === "vacation" ? "Отпуск" :
                        ev.kind === "sick" ? "Больничный" :
                        ev.kind === "trip" ? "Командировка" : "Обучение";
                      const badgeLevel: Level =
                        ev.state === "past" ? "ok" :
                        ev.state === "active" && ev.daysLeft <= 2 ? "bad" :
                        ev.state === "upcoming" && ev.daysToStart <= 2 ? "warn" : "ok";
                      const isOpenEnded = ev.endDate === "9999-12-31";
                      const stateText = isOpenEnded
                        ? "по настоящее время"
                        : ev.state === "active" ? (ev.daysLeft <= 0 ? "заканчивается сегодня" : `осталось ${ev.daysLeft} дн.`) :
                          ev.state === "upcoming" ? `начнётся через ${ev.daysToStart} дн.` :
                          "завершено";
                      return (
                        <tr key={ev.id} className="border-b last:border-0" data-testid={`row-absence-${ev.id}`}>
                          <td className="py-2 pr-3 font-medium whitespace-nowrap">{ev.fio}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              {icon}
                              {kindLabel}
                            </span>
                          </td>
                          <td className="num py-2 pr-3 whitespace-nowrap">{ruDate(ev.startDate)}</td>
                          <td className="num py-2 pr-3 whitespace-nowrap">{isOpenEnded ? "—" : ruDate(ev.endDate)}</td>
                          <td className="py-2 pr-3 text-muted-foreground max-w-[220px] truncate" title={ev.destination || ev.note}>
                            {ev.destination || ev.note || "—"}
                          </td>
                          <td className="py-2 pr-3">
                            <Badge variant="outline" className={cn("border text-[11px] whitespace-nowrap", levelBadge[badgeLevel])}>
                              {stateText}
                            </Badge>
                          </td>
                          <td className="py-2 text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Изменить"
                                onClick={() => openEditAbsence(ev)}
                                data-testid={`button-edit-absence-${ev.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Удалить"
                                onClick={() => setAbsDelDialog({ open: true, id: ev.id, name: `${ev.fio} — ${kindLabel}` })}
                                data-testid={`button-delete-absence-${ev.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
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
      )}

      {/* ---------- Диалог сотрудника ---------- */}
      <Dialog open={empDialog.open} onOpenChange={(v) => setEmpDialog({ open: v, id: v ? empDialog.id : null })}>
        <DialogContent className="max-w-lg" data-testid="dialog-employee">
          <DialogHeader>
            <DialogTitle>{empDialog.id ? "Изменить сотрудника" : "Новый сотрудник"}</DialogTitle>
            <DialogDescription>
              Обязательны только ФИО и должность. Объект и телефон можно заполнить позже, вахта назначается отдельно.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">ФИО *</label>
              <Input
                value={empForm.fio}
                onChange={(e) => setEmpForm({ ...empForm, fio: e.target.value })}
                placeholder="Иванов Иван Иванович"
                data-testid="input-fio"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Должность *</label>
              <Select value={empForm.position} onValueChange={(v) => setEmpForm({ ...empForm, position: v })}>
                <SelectTrigger data-testid="select-position"><SelectValue placeholder="Выберите должность" /></SelectTrigger>
                <SelectContent>
                  {positionOptions.map((p: string) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  <SelectItem value={OWN_POSITION}>Своя должность…</SelectItem>
                </SelectContent>
              </Select>
              {empForm.position === OWN_POSITION && (
                <Input
                  className="mt-2"
                  value={empForm.ownPosition}
                  onChange={(e) => setEmpForm({ ...empForm, ownPosition: e.target.value })}
                  placeholder="Название должности"
                  data-testid="input-own-position"
                />
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">Объект</label>
                <Select value={empForm.objectId} onValueChange={(v) => setEmpForm({ ...empForm, objectId: v })}>
                  <SelectTrigger data-testid="select-emp-object"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_OBJECT}>Не указан</SelectItem>
                    {objects.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Телефон</label>
                <Input
                  value={empForm.phone}
                  onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })}
                  placeholder="+7 ..."
                  data-testid="input-phone"
                />
              </div>
            </div>
            {empError && <ErrorBox text={empError} />}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEmpDialog({ open: false, id: null })} data-testid="button-cancel-employee">
              Отмена
            </Button>
            <Button
              onClick={() => {
                setEmpError("");
                if (!empForm.fio.trim()) return setEmpError("Укажите ФИО сотрудника.");
                const pos = empForm.position === OWN_POSITION ? empForm.ownPosition.trim() : empForm.position;
                if (!pos) return setEmpError("Укажите должность.");
                saveEmployee.mutate();
              }}
              disabled={saveEmployee.isPending}
              data-testid="button-save-employee"
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Диалог назначения вахты ---------- */}
      <Dialog open={shiftDialog.open} onOpenChange={(v) => setShiftDialog({ open: v, ids: v ? shiftDialog.ids : [] })}>
        <DialogContent className="max-w-lg" data-testid="dialog-assign-shift">
          <DialogHeader>
            <DialogTitle>Назначить вахту</DialogTitle>
            <DialogDescription>
              Сотрудников выбрано: {nf(shiftDialog.ids.length)}. Дата выезда считается автоматически по циклу.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Дата заезда *</label>
              <Input
                type="date"
                value={shiftForm.startDate}
                onChange={(e) => setShiftForm({ ...shiftForm, startDate: e.target.value })}
                data-testid="input-start"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Цикл вахты *</label>
              <Select value={shiftForm.cycle} onValueChange={(v) => setShiftForm({ ...shiftForm, cycle: v })}>
                <SelectTrigger data-testid="select-cycle"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CYCLES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  <SelectItem value={OWN_CYCLE}>Свой цикл…</SelectItem>
                </SelectContent>
              </Select>
              {shiftForm.cycle === OWN_CYCLE && (
                <Input
                  className="mt-2"
                  value={shiftForm.ownCycle}
                  onChange={(e) => setShiftForm({ ...shiftForm, ownCycle: e.target.value })}
                  placeholder="например 21/21"
                  data-testid="input-own-cycle"
                />
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Объект вахты</label>
              <Select value={shiftForm.objectId} onValueChange={(v) => setShiftForm({ ...shiftForm, objectId: v })}>
                <SelectTrigger data-testid="select-shift-object"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep">Как у сотрудника</SelectItem>
                  {objects.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Дата выезда (расчёт)</label>
              <Input value={shiftEnd ? ruDate(shiftEnd) : "—"} readOnly data-testid="text-end-date" />
            </div>
          </div>
          {shiftError && <div className="mt-2"><ErrorBox text={shiftError} /></div>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShiftDialog({ open: false, ids: [] })} data-testid="button-cancel-shift">
              Отмена
            </Button>
            <Button
              onClick={() => {
                setShiftError("");
                if (!shiftEnd) return setShiftError("Цикл указывается в виде 30/30.");
                assignShift.mutate();
              }}
              disabled={assignShift.isPending}
              data-testid="button-save-shift"
            >
              Назначить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Диалог массового изменения ---------- */}
      <Dialog open={bulkDialog !== null} onOpenChange={(v) => !v && setBulkDialog(null)}>
        <DialogContent className="max-w-md" data-testid="dialog-bulk">
          <DialogHeader>
            <DialogTitle>{bulkDialog === "object" ? "Изменить объект" : "Изменить должность"}</DialogTitle>
            <DialogDescription>Изменение применится ко всем выбранным сотрудникам ({nf(selected.length)}).</DialogDescription>
          </DialogHeader>
          {bulkDialog === "object" ? (
            <Select value={bulkValue} onValueChange={setBulkValue}>
              <SelectTrigger data-testid="select-bulk-object"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_OBJECT}>Не указан</SelectItem>
                {objects.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Select value={bulkValue} onValueChange={setBulkValue}>
              <SelectTrigger data-testid="select-bulk-position"><SelectValue /></SelectTrigger>
              <SelectContent>
                {positionOptions.map((p: string) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {bulkError && <ErrorBox text={bulkError} />}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkDialog(null)} data-testid="button-cancel-bulk">Отмена</Button>
            <Button onClick={() => bulkUpdate.mutate()} disabled={bulkUpdate.isPending} data-testid="button-save-bulk">
              Применить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Диалог удаления ---------- */}
      <Dialog open={delDialog.open} onOpenChange={(v) => setDelDialog({ ...delDialog, open: v })}>
        <DialogContent className="max-w-md" data-testid="dialog-delete-employee">
          <DialogHeader>
            <DialogTitle>Удалить сотрудника?</DialogTitle>
            <DialogDescription>
              Будет удалено: {delDialog.name}. Вместе с человеком снимаются его вахты. Действие необратимо.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDelDialog({ open: false, ids: [], name: "" })} data-testid="button-cancel-delete">
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => removeEmployees.mutate(delDialog.ids)}
              disabled={removeEmployees.isPending}
              data-testid="button-confirm-delete"
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Диалог отсутствия ---------- */}
      <Dialog open={absDialog.open} onOpenChange={(v) => setAbsDialog({ open: v, id: v ? absDialog.id : null })}>
        <DialogContent className="max-w-lg" data-testid="dialog-absence">
          <DialogHeader>
            <DialogTitle>{absDialog.id ? "Изменить запись" : "Отпуск / больничный / командировка / обучение"}</DialogTitle>
            <DialogDescription>Укажите сотрудника, тип события и период.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Сотрудник</label>
              <Select value={absForm.employeeId} onValueChange={(v) => setAbsForm({ ...absForm, employeeId: v })}>
                <SelectTrigger data-testid="select-absence-employee"><SelectValue placeholder="Выберите сотрудника" /></SelectTrigger>
                <SelectContent>
                  {emps.map((e: any) => (
                    <SelectItem key={e.id} value={String(e.id)}>{e.fio}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Тип события</label>
              <Select value={absForm.kind} onValueChange={(v) => setAbsForm({ ...absForm, kind: v })}>
                <SelectTrigger data-testid="select-absence-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vacation">Отпуск</SelectItem>
                  <SelectItem value="sick">Больничный</SelectItem>
                  <SelectItem value="trip">Командировка</SelectItem>
                  <SelectItem value="study">Обучение</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">С какой даты</label>
                <Input
                  type="date"
                  value={absForm.startDate}
                  onChange={(e) => setAbsForm({ ...absForm, startDate: e.target.value })}
                  data-testid="input-absence-start"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">По какую дату</label>
                <Input
                  type="date"
                  value={absForm.endDate === "9999-12-31" ? "" : absForm.endDate}
                  disabled={absForm.endDate === "9999-12-31"}
                  onChange={(e) => setAbsForm({ ...absForm, endDate: e.target.value })}
                  data-testid="input-absence-end"
                />
                <label className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox
                    checked={absForm.endDate === "9999-12-31"}
                    onCheckedChange={(v) =>
                      setAbsForm({ ...absForm, endDate: v ? "9999-12-31" : todayIso() })
                    }
                    data-testid="checkbox-absence-open-ended"
                  />
                  Пока без даты окончания (по настоящее время)
                </label>
              </div>
            </div>
            {absForm.kind === "trip" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Куда (город/объект)</label>
                <Input
                  value={absForm.destination}
                  onChange={(e) => setAbsForm({ ...absForm, destination: e.target.value })}
                  placeholder="Например: Красноярск, база снабжения"
                  data-testid="input-absence-destination"
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Примечание (необязательно)</label>
              <Input
                value={absForm.note}
                onChange={(e) => setAbsForm({ ...absForm, note: e.target.value })}
                placeholder="Комментарий"
                data-testid="input-absence-note"
              />
            </div>
            {absError && <ErrorBox text={absError} />}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAbsDialog({ open: false, id: null })} data-testid="button-cancel-absence">
              Отмена
            </Button>
            <Button
              onClick={() => {
                setAbsError("");
                if (!absForm.employeeId) return setAbsError("Выберите сотрудника.");
                if (!absForm.startDate || !absForm.endDate) return setAbsError("Укажите даты начала и окончания.");
                if (absForm.endDate < absForm.startDate) return setAbsError("Дата окончания раньше даты начала.");
                saveAbsence.mutate();
              }}
              disabled={saveAbsence.isPending}
              data-testid="button-save-absence"
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Диалог удаления записи об отсутствии ---------- */}
      <Dialog open={absDelDialog.open} onOpenChange={(v) => setAbsDelDialog({ ...absDelDialog, open: v })}>
        <DialogContent className="max-w-md" data-testid="dialog-delete-absence">
          <DialogHeader>
            <DialogTitle>Удалить запись?</DialogTitle>
            <DialogDescription>Будет удалено: {absDelDialog.name}. Действие необратимо.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setAbsDelDialog({ open: false, id: null, name: "" })}
              data-testid="button-cancel-delete-absence"
            >
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => absDelDialog.id && deleteAbsence.mutate(absDelDialog.id)}
              disabled={deleteAbsence.isPending}
              data-testid="button-confirm-delete-absence"
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
