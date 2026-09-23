import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Check, Trash2, Pencil, CalendarPlus, Search, Users, CalendarRange, Plane, HeartPulse, Briefcase, GraduationCap, BarChart3, Stethoscope, History, CalendarDays, RotateCcw, MessageSquare, Send, Wallet, Link2, Copy, RefreshCw, Settings, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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

const NO_OBJECT = "0";

/** Подписи видов отсутствий: используются в дашборде и списках */
const ABSENCE_KIND_TEXT: Record<string, string> = {
  vacation: "Отпуск", sick: "Больничный", trip: "Командировка", study: "Обучение", between: "На межвахте",
  office: "Работа в офисе", pp: "Работа на ПП",
};

/** Типы дней производственного календаря: подпись и цвет плитки */
const DAY_KIND_TEXT: Record<string, string> = {
  work: "Рабочий", weekend: "Выходной", holiday: "Праздник", short: "Сокращённый",
};
const DAY_KIND_CLASS: Record<string, string> = {
  work: "bg-background hover:bg-muted",
  weekend: "bg-muted text-muted-foreground",
  holiday: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  short: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};
const DAY_KIND_NEXT: Record<string, string> = { work: "weekend", weekend: "holiday", holiday: "short", short: "work" };
const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

/**
 * Строка дашборда: нажатие открывает карточку сотрудника, значок графика —
 * его годовую аналитику. Так из любого показателя можно провалиться к человеку.
 */
function DashRow({
  fio, sub, badge, level, onOpen, onAnalytics, testId,
}: {
  fio: string; sub: string; badge: string; level: Level;
  onOpen: () => void; onAnalytics: () => void; testId: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border p-2" data-testid={testId}>
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left transition hover:text-primary"
        title="Открыть карточку сотрудника"
      >
        <div className="truncate text-sm font-medium">{fio}</div>
        <div className="truncate text-xs text-muted-foreground">{sub}</div>
      </button>
      <Badge variant="outline" className={cn("shrink-0 border text-[11px]", levelBadge[level])}>{badge}</Badge>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Аналитика: ${fio}`}
        title="Аналитика по сотруднику"
        onClick={onAnalytics}
      >
        <BarChart3 className="h-4 w-4" />
      </Button>
    </div>
  );
}
const OTHER_PLACE = "other";

/** Состояния кадровой аналитики: один день относится только к одному состоянию */
const HR_STATE_ORDER = ["work", "dayoff", "onshift", "between", "trip", "vacation", "sick", "study", "unassigned"] as const;
const HR_STATE_LABELS: Record<string, string> = {
  work: "Работа",
  dayoff: "Выходной",
  onshift: "На вахте",
  between: "Межвахта",
  trip: "Командировка",
  vacation: "Отпуск",
  sick: "Больничный",
  study: "Обучение",
  unassigned: "Без статуса",
};

/** Медосмотр: за 30 дней до окончания — предупреждение, после окончания — просрочка */
function medExamInfo(date: string, today: string): { text: string; level: Level } {
  if (!date) return { text: "не указан", level: "bad" };
  const days = Math.round((new Date(date + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000);
  if (days < 0) return { text: `просрочен ${Math.abs(days)} дн.`, level: "bad" };
  if (days <= 30) return { text: `до ${new Date(date).toLocaleDateString("ru-RU")} (${days} дн.)`, level: "warn" };
  return { text: new Date(date).toLocaleDateString("ru-RU"), level: "ok" };
}
const OWN_POSITION = "__own__";

function addDaysIso(iso: string, days: number) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type Status = "onshift" | "between" | "none" | "vacation" | "sick" | "trip" | "study";
const MANUAL_STATUSES: Status[] = ["vacation", "sick", "trip", "study", "between"];

/** Метод работы сотрудника — выбирается кнопкой прямо в списке */
const WORK_STATUSES = [
  { value: "office", label: "Работа в офисе" },
  { value: "pp", label: "Работа на ПП" },
  { value: "between", label: "Работа вахтовым методом" },
] as const;
const workStatusText = (v?: string) =>
  WORK_STATUSES.find((w) => w.value === (v || "office"))?.label ?? "Работа в офисе";
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

  const [tab, setTab] = useState<
    "dash" | "people" | "shifts" | "absence" | "arch" | "cal" | "sms" | "chat" | "setup"
  >("dash");
  // три вкладки работают с одними данными: рассылка, переписка и настройки каналов
  const notifyTab = tab === "sms" || tab === "chat" || tab === "setup";

  // фильтры справочника сотрудников
  const [q, setQ] = useState("");
  const [objectFilter, setObjectFilter] = useState("all");
  const [positionFilter, setPositionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [medFilter, setMedFilter] = useState<"all" | "problem" | "soon">("all");
  // фильтр вкладки «Вахты»
  const [shiftObjectFilter, setShiftObjectFilter] = useState("all");
  const [shiftPeriod, setShiftPeriod] = useState<"current" | "planned" | "done" | "all">("current");
  const [shiftFocus, setShiftFocus] = useState<"all" | "soon" | "noReplacement">("all");
  const [absStateFilter, setAbsStateFilter] = useState<"all" | "active" | "endingSoon" | "upcoming" | "past">("all");

  const [selected, setSelected] = useState<number[]>([]);

  // диалоги
  const [empDialog, setEmpDialog] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [empForm, setEmpForm] = useState({ fio: "", position: "", ownPosition: "", objectId: NO_OBJECT, phone: "", medicalExamEndDate: "", workStatus: "office" });
  const [empError, setEmpError] = useState("");

  const [shiftDialog, setShiftDialog] = useState<{ open: boolean; ids: number[] }>({ open: false, ids: [] });
  const [shiftForm, setShiftForm] = useState({ startDate: todayIso(), endDate: "", objectId: "keep" });
  const [shiftError, setShiftError] = useState("");

  const [bulkDialog, setBulkDialog] = useState<null | "object" | "position">(null);
  const [bulkValue, setBulkValue] = useState("");
  const [bulkError, setBulkError] = useState("");

  const [delDialog, setDelDialog] = useState<{ open: boolean; ids: number[]; name: string }>({ open: false, ids: [], name: "" });

  const [absDialog, setAbsDialog] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [absForm, setAbsForm] = useState({
    employeeId: "", kind: "vacation", startDate: todayIso(), endDate: todayIso(),
    destinationObjectId: NO_OBJECT, destination: "", note: "",
  });

  // редактирование фактических дат вахты
  const [shiftEditDialog, setShiftEditDialog] = useState<{ open: boolean; id: number | null; fio: string }>({ open: false, id: null, fio: "" });
  const [shiftEditForm, setShiftEditForm] = useState({ startDate: "", endDate: "" });
  const [shiftEditError, setShiftEditError] = useState("");

  // кадровая аналитика по сотруднику
  const [tsDialog, setTsDialog] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [tsYear, setTsYear] = useState(String(new Date().getFullYear()));
  const [summaryYear, setSummaryYear] = useState(String(new Date().getFullYear()));
  const [showSummary, setShowSummary] = useState(false);
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
  const empAllEvents: any[] = empEventsQ.data ?? [];

  /**
   * Статус на сегодня. Ручной статус действует только пока его подтверждает
   * запись об отсутствии, иначе завершённый больничный навсегда перекрывает вахту.
   */
  const statusOf = (empId: number, manualStatus?: string): Status => {
    const ownEvents = empAllEvents.filter((ev: any) => ev.employeeId === empId);
    const covering = ownEvents.find((ev: any) => ev.startDate <= today && ev.endDate >= today);
    if (covering && (MANUAL_STATUSES as string[]).includes(covering.kind)) return covering.kind as Status;
    if (!ownEvents.length && manualStatus && (MANUAL_STATUSES as string[]).includes(manualStatus))
      return manualStatus as Status;
    const own = allShifts.filter((s) => s.employeeId === empId);
    if (!own.length) return "none";
    return own.some((s) => s.startDate <= today && s.endDate >= today) ? "onshift" : "between";
  };

  const absenceAll = useMemo(() => {
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
      .sort((a: any, b: any) => {
        const order: any = { active: 0, upcoming: 1, past: 2 };
        if (order[a.state] !== order[b.state]) return order[a.state] - order[b.state];
        return a.startDate < b.startDate ? 1 : -1;
      });
  }, [empAllEvents, emps, today]);

  const absenceRows = useMemo(() =>
    absenceAll.filter((ev: any) =>
      (absKindFilter === "all" || ev.kind === absKindFilter) &&
      (absStateFilter === "all" ||
        (absStateFilter === "endingSoon" ? ev.state === "active" && ev.daysLeft <= 2 : ev.state === absStateFilter))),
  [absenceAll, absKindFilter, absStateFilter]);

  // счётчики считаются по всем записям, поэтому не зависят от выбранных фильтров
  const absCounters = useMemo(() => {
    const active = absenceAll.filter((e: any) => e.state === "active");
    return {
      vacation: active.filter((e: any) => e.kind === "vacation").length,
      sick: active.filter((e: any) => e.kind === "sick").length,
      trip: active.filter((e: any) => e.kind === "trip").length,
      study: active.filter((e: any) => e.kind === "study").length,
      endingSoon: active.filter((e: any) => e.daysLeft <= 2).length,
    };
  }, [absenceAll]);

  const saveAbsence = useMutation({
    mutationFn: async () => {
      const byRef = absForm.kind === "trip" && absForm.destinationObjectId !== OTHER_PLACE;
      const body = {
        employeeId: Number(absForm.employeeId) || 0,
        kind: absForm.kind,
        startDate: absForm.startDate,
        endDate: absForm.endDate,
        destinationObjectId: byRef ? Number(absForm.destinationObjectId) || 0 : 0,
        destination: byRef ? "" : absForm.destination.trim(),
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
    setAbsForm({
      employeeId: "", kind: "vacation", startDate: todayIso(), endDate: todayIso(),
      destinationObjectId: NO_OBJECT, destination: "", note: "",
    });
    setAbsDialog({ open: true, id: null });
  };
  const openEditAbsence = (ev: any) => {
    setAbsError("");
    setAbsForm({
      employeeId: String(ev.employeeId), kind: ev.kind, startDate: ev.startDate, endDate: ev.endDate,
      destinationObjectId: ev.destinationObjectId ? String(ev.destinationObjectId) : (ev.destination ? OTHER_PLACE : NO_OBJECT),
      destination: ev.destination ?? "", note: ev.note ?? "",
    });
    setAbsDialog({ open: true, id: ev.id });
  };

  const openEditShiftDates = (r: any) => {
    setShiftEditError("");
    setShiftEditForm({ startDate: r.startDate, endDate: r.endDate });
    setShiftEditDialog({ open: true, id: r.shiftId ?? r.id, fio: r.fio });
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return emps
      .map((e) => ({ ...e, status: statusOf(e.id, e.manualStatus) as Status }))
      .filter((e: any) =>
        (!needle || String(e.fio).toLowerCase().includes(needle)) &&
        (objectFilter === "all" || (objectFilter === NO_OBJECT ? !e.objectId : e.objectId === Number(objectFilter))) &&
        (positionFilter === "all" || e.position === positionFilter) &&
        (statusFilter === "all" || e.status === statusFilter) &&
        (medFilter === "all" || (() => {
          const m = medExamInfo(e.medicalExamEndDate ?? "", today);
          return medFilter === "problem" ? m.level === "bad" : m.level !== "ok";
        })()));
  }, [emps, allShifts, empAllEvents, q, objectFilter, positionFilter, statusFilter, medFilter, today]);

  const counters = useMemo(() => {
    const all = emps.map((e) => statusOf(e.id, e.manualStatus));
    return {
      total: emps.length,
      onshift: all.filter((s) => s === "onshift").length,
      between: all.filter((s) => s === "between").length,
      none: all.filter((s) => s === "none").length,
    };
  }, [emps, allShifts, empAllEvents, today]);

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

  const updateWorkStatus = useMutation({
    mutationFn: async ({ id, workStatus }: { id: number; workStatus: string }) =>
      (await apiRequest("PATCH", `/api/employees/${id}`, { workStatus })).json(),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (e: any) => toast({ title: "Не удалось изменить метод работы", description: String(e.message) }),
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
        medicalExamEndDate: empForm.medicalExamEndDate, workStatus: empForm.workStatus,
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
      return (await apiRequest("POST", "/api/employees/bulk-shift", {
        ids: shiftDialog.ids,
        startDate: shiftForm.startDate,
        endDate: shiftForm.endDate,
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

  /** Фактические даты вахты: реальные заезд и выезд часто отличаются от графика */
  const saveShiftDates = useMutation({
    mutationFn: async () =>
      (await apiRequest("PATCH", `/api/shifts/${shiftEditDialog.id}`, {
        startDate: shiftEditForm.startDate, endDate: shiftEditForm.endDate,
      })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setShiftEditDialog({ open: false, id: null, fio: "" });
      toast({ title: "Фактические даты вахты обновлены" });
    },
    onError: (e: any) => setShiftEditError(String(e.message)),
  });

  // месячная и годовая аналитика по выбранному сотруднику
  const timesheet = useQuery<any>({
    queryKey: ["/api/hr/timesheet", String(tsDialog.id ?? 0), tsYear],
    enabled: tsDialog.open && !!tsDialog.id,
  });

  // годовые итоги по всем сотрудникам
  const summary = useQuery<any>({
    queryKey: ["/api/hr/timesheet-all", summaryYear],
    enabled: showSummary,
  });

  // ---- Архив вахт: полная история заездов и выездов ----
  const thisYear = new Date().getFullYear();
  const [archFrom, setArchFrom] = useState(`${thisYear}-01-01`);
  const [archTo, setArchTo] = useState(`${thisYear}-12-31`);
  const [archObject, setArchObject] = useState("all");
  const [archQ, setArchQ] = useState("");
  const [archAll, setArchAll] = useState(false);
  const archive = useQuery<any>({
    queryKey: [`/api/hr/shift-archive?from=${archFrom}&to=${archTo}`],
    enabled: tab === "arch",
  });
  const [sliceDate, setSliceDate] = useState(todayIso());
  const slice = useQuery<any>({
    queryKey: [`/api/hr/on-date/${sliceDate}`],
    enabled: tab === "arch" && /^\d{4}-\d{2}-\d{2}$/.test(sliceDate),
  });

  const archRows = useMemo(() => {
    const rows: any[] = archive.data?.rows ?? [];
    const needle = archQ.trim().toLowerCase();
    return rows.filter((r) =>
      (archObject === "all" || String(r.objectId) === archObject)
      && (!needle || String(r.fio).toLowerCase().includes(needle)));
  }, [archive.data, archObject, archQ]);

  // ---- Производственный календарь ----
  const [calYear, setCalYear] = useState(String(thisYear));
  const calendar = useQuery<any>({
    queryKey: [`/api/work-calendar/${calYear}`],
    enabled: tab === "cal",
  });
  const setDayKind = useMutation({
    mutationFn: (v: { id: number; kind: string }) =>
      apiRequest("PATCH", `/api/work-calendar/day/${v.id}`, { kind: v.kind }),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (e: any) => toast({ title: "Не удалось изменить день", description: String(e.message), variant: "destructive" }),
  });
  const regenYear = useMutation({
    mutationFn: () => apiRequest("POST", `/api/work-calendar/${calYear}/generate`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: `Календарь ${calYear} года создан по ТК РФ`, description: "Ручные правки этого года сброшены." });
    },
  });

  // ---- СМС-вызов на вахту ----
  const smsSettings = useQuery<any>({ queryKey: ["/api/sms/settings"], enabled: notifyTab });
  const smsPending = useQuery<any>({ queryKey: ["/api/sms/pending"], enabled: notifyTab });
  const smsLog = useQuery<any>({ queryKey: ["/api/sms/log"], enabled: notifyTab });
  const [smsForm, setSmsForm] = useState<any>(null);
  const [smsSecret, setSmsSecret] = useState({ password: "", apikey: "" });
  const [testPhone, setTestPhone] = useState("");
  const [smsBalance, setSmsBalance] = useState("");

  // подставляем сохранённые настройки в форму один раз после загрузки
  const smsData = smsSettings.data;
  const form = smsForm ?? (smsData ? { ...smsData } : null);

  const saveSms = useMutation({
    mutationFn: (v: any) => apiRequest("PUT", "/api/sms/settings", v),
    onSuccess: () => {
      setSmsSecret({ password: "", apikey: "" });
      setSmsForm(null);
      queryClient.invalidateQueries();
      toast({ title: "Настройки СМС сохранены" });
    },
    onError: (e: any) => toast({ title: "Не удалось сохранить", description: String(e.message), variant: "destructive" }),
  });
  const smsRecipients = useQuery<any>({ queryKey: ["/api/sms/recipients"], enabled: notifyTab });
  const [smsChannel, setSmsChannel] = useState("auto");

  // ---- бот MAX ----
  const maxSettings = useQuery<any>({ queryKey: ["/api/max/settings"], enabled: notifyTab });
  const maxInvites = useQuery<any>({ queryKey: ["/api/max/invites"], enabled: notifyTab });
  const [maxForm, setMaxForm] = useState<any>(null);
  const [maxToken, setMaxToken] = useState("");
  const [maxBot, setMaxBot] = useState("");
  const maxF = maxForm ?? (maxSettings.data ? { ...maxSettings.data } : null);

  const saveMax = useMutation({
    mutationFn: (v: any) => apiRequest("PUT", "/api/max/settings", v),
    onSuccess: () => {
      setMaxToken(""); setMaxForm(null);
      queryClient.invalidateQueries();
      toast({ title: "Настройки бота MAX сохранены" });
    },
    onError: (e: any) => toast({ title: "Не удалось сохранить", description: String(e.message), variant: "destructive" }),
  });
  const checkMax = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("GET", "/api/max/check");
      return await r.json();
    },
    onSuccess: (d: any) => setMaxBot(`${d.name || "бот"}${d.username ? ` (@${d.username})` : ""}`),
    onError: (e: any) => toast({ title: "Бот не отвечает", description: String(e.message), variant: "destructive" }),
  });
  const pollMax = useMutation({
    mutationFn: () => apiRequest("POST", "/api/max/poll", {}),
    onSuccess: async (r: any) => {
      const out = await r.json();
      queryClient.invalidateQueries();
      toast({
        title: out.linked ? `Привязано новых: ${out.linked}` : "Новых привязок нет",
        description: "Привязка появляется после того, как человек открыл бота по своей ссылке",
      });
    },
    onError: (e: any) => toast({ title: "Проверка не прошла", description: String(e.message), variant: "destructive" }),
  });
  const [webhookUrl, setWebhookUrl] = useState("");
  const enableHook = useMutation({
    mutationFn: () => apiRequest("POST", "/api/max/webhook/enable", { url: webhookUrl }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "MAX будет присылать события сам", description: "Опрос больше не используется" });
    },
    onError: (e: any) => toast({ title: "Подписка не включилась", description: String(e.message), variant: "destructive" }),
  });
  const disableHook = useMutation({
    mutationFn: () => apiRequest("POST", "/api/max/webhook/disable", {}),
    onSuccess: () => { queryClient.invalidateQueries(); toast({ title: "Вернулись к опросу раз в минуту" }); },
    onError: (e: any) => toast({ title: "Не удалось снять подписку", description: String(e.message), variant: "destructive" }),
  });
  const sendDigest = useMutation({
    mutationFn: () => apiRequest("POST", "/api/max/digest/send", {}),
    onSuccess: (d: any) => toast({ title: `Сводка отправлена: получателей ${d?.sent ?? 0}` }),
    onError: (e: any) => toast({ title: "Сводка не ушла", description: String(e.message), variant: "destructive" }),
  });
  const digest = useQuery<any>({ queryKey: ["/api/max/digest"], enabled: notifyTab });

  const [chatWith, setChatWith] = useState<number | null>(null);
  const maxChats = useQuery<any>({
    queryKey: ["/api/max/chats"],
    enabled: true,
    refetchInterval: 30000,
  });
  const unreadTotal = (maxChats.data?.rows ?? []).reduce((acc: number, r: any) => acc + (r.unread ?? 0), 0);
  const maxChat = useQuery<any>({
    queryKey: [`/api/max/chat/${chatWith ?? 0}`],
    enabled: tab === "chat" && !!chatWith,
    refetchInterval: tab === "chat" && chatWith ? 15000 : false,
  });
  const markSeen = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/max/chat/${id}/seen`, {}),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const maxInbox = useQuery<any>({
    queryKey: ["/api/max/inbox"],
    enabled: notifyTab,
    refetchInterval: notifyTab ? 30000 : false,
  });
  const [replyTo, setReplyTo] = useState<{ id: number; fio: string } | null>(null);
  const [replyText, setReplyText] = useState("");
  const sendReply = useMutation({
    // получателя передаём аргументом: состояние формы обновляется позже вызова
    mutationFn: (v: { employeeId: number; text: string }) =>
      apiRequest("POST", "/api/max/reply", v),
    onSuccess: () => {
      setReplyText(""); setReplyTo(null);
      queryClient.invalidateQueries();
      toast({ title: "Ответ отправлен в MAX" });
    },
    onError: (e: any) => toast({ title: "Ответ не ушёл", description: String(e.message), variant: "destructive" }),
  });

  const unlinkMax = useMutation({
    mutationFn: (employeeId: number) => apiRequest("DELETE", `/api/max/links/${employeeId}`),
    onSuccess: () => { queryClient.invalidateQueries(); toast({ title: "Привязка снята" }); },
  });

  const copyText = async (text: string, title: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title });
    } catch {
      toast({ title: "Скопировать не удалось", description: text, variant: "destructive" });
    }
  };
  const [smsPicked, setSmsPicked] = useState<number[]>([]);
  const [smsQ, setSmsQ] = useState("");
  const [smsObject, setSmsObject] = useState("all");
  const [smsOwnText, setSmsOwnText] = useState("");
  // номера, введённые вручную: id сотрудника → номер
  const [smsPhones, setSmsPhones] = useState<Record<number, string>>({});
  const [smsExtra, setSmsExtra] = useState("");
  const [smsSavePhones, setSmsSavePhones] = useState(true);

  /** Номер годен, если это 10 цифр с 9 или 11 цифр с 7/8 */
  const phoneOk = (v: string) => {
    const d = String(v ?? "").replace(/\D/g, "");
    return (d.length === 11 && /^[78]/.test(d)) || (d.length === 10 && d.startsWith("9"));
  };
  const rowPhoneOk = (r: any) => r.phoneOk || phoneOk(smsPhones[r.employeeId] ?? "");

  const smsRows = useMemo(() => {
    const rows: any[] = smsRecipients.data?.rows ?? [];
    const needle = smsQ.trim().toLowerCase();
    return rows.filter((r) =>
      (smsObject === "all" || String(r.objectId) === smsObject)
      && (!needle || String(r.fio).toLowerCase().includes(needle)));
  }, [smsRecipients.data, smsQ, smsObject]);

  const togglePicked = (id: number) =>
    setSmsPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const sendToPicked = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sms/send-to", {
      employeeIds: smsPicked,
      channel: smsChannel,
      phones: Object.fromEntries(
        Object.entries(smsPhones).filter(([id, v]) => smsPicked.includes(Number(id)) && phoneOk(String(v)))),
      savePhones: smsSavePhones,
      extraPhones: smsExtra,
      ...(smsOwnText.trim() ? { text: smsOwnText } : {}),
    }),
    onSuccess: async (r: any) => {
      const out = await r.json();
      setSmsPicked([]);
      setSmsExtra("");
      queryClient.invalidateQueries();
      const bad = (out.results ?? []).filter((x: any) => !x.ok);
      toast({
        title: `Отправлено ${out.sent} из ${out.sent + out.failed}`,
        description: bad.length ? `Не ушло: ${bad.map((x: any) => x.fio).join(", ")}` : "Все сообщения приняты шлюзом",
        variant: out.failed && !out.sent ? "destructive" : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Отправка не прошла", description: String(e.message), variant: "destructive" }),
  });

  const runSms = useMutation({
    mutationFn: (shiftIds?: number[]) => apiRequest("POST", "/api/sms/run", shiftIds ? { shiftIds } : {}),
    onSuccess: async (r: any) => {
      const out = await r.json();
      queryClient.invalidateQueries();
      toast({
        title: `Отправлено ${out.sent}`,
        description: `С ошибкой ${out.failed}, без номера ${out.skipped}`,
      });
    },
    onError: (e: any) => toast({ title: "Отправка не прошла", description: String(e.message), variant: "destructive" }),
  });
  const testSms = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sms/test", { phone: testPhone }),
    onSuccess: () => { queryClient.invalidateQueries(); toast({ title: "Проверочное сообщение отправлено" }); },
    onError: (e: any) => toast({ title: "Сообщение не ушло", description: String(e.message), variant: "destructive" }),
  });
  const checkBalance = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("GET", "/api/sms/balance");
      return await r.json();
    },
    onSuccess: (d: any) => setSmsBalance(`${d.balance} ${d.currency}`),
    onError: (e: any) => toast({ title: "Баланс не получен", description: String(e.message), variant: "destructive" }),
  });

  const yearOptions = (() => {
    const y = new Date().getFullYear();
    return [String(y), String(y - 1), String(y - 2)];
  })();

  if (isLoading) return <Loading rows={4} />;
  if (error || !data) return <ErrorBox text="Не удалось загрузить данные по сотрудникам. Обновите страницу." />;

  const th = data.thresholds;
  /**
   * Все вахты, а не только текущие: даты заезда и выезда должны быть доступны
   * для правки в любой момент — и до заезда, и после возвращения.
   */
  const shiftRows = allShifts
    .map((s: any) => {
      const e = emps.find((x: any) => x.id === s.employeeId);
      const days = (from: string, to: string) =>
        Math.round((new Date(to + "T00:00:00").getTime() - new Date(from + "T00:00:00").getTime()) / 86400000);
      const cycleDays = Number(String(s.cycleType).split("/")[0]) || 0;
      const period = s.startDate > today ? "planned" : s.endDate < today ? "done" : "current";
      return {
        shiftId: s.id, employeeId: s.employeeId,
        fio: e?.fio ?? "—", position: e?.position ?? "—",
        object: objName(s.objectId) || "не указан", objectId: s.objectId,
        startDate: s.startDate, endDate: s.endDate, cycleType: s.cycleType,
        daysWorked: period === "planned" ? 0 : days(s.startDate, period === "done" ? s.endDate : today) + 1,
        daysLeft: days(today, s.endDate),
        overtime: period !== "planned" && cycleDays > 0 && days(s.startDate, s.endDate) + 1 > cycleDays,
        replacementAssigned: s.replacementAssigned === 1,
        period,
      };
    })
    .filter((r) =>
      (shiftObjectFilter === "all" || r.objectId === Number(shiftObjectFilter)) &&
      (shiftPeriod === "all" || r.period === shiftPeriod) &&
      (shiftFocus === "all" ||
        (r.period === "current" && r.daysLeft <= th.rotationEndDays &&
          (shiftFocus === "soon" || !r.replacementAssigned))))
    .sort((a, b) => (a.period === b.period ? a.endDate.localeCompare(b.endDate) : a.startDate < b.startDate ? 1 : -1));

  const rotation = shiftRows;

  /** Наборы для дашборда: срочное сверху, каждая строка ведёт в карточку */
  const dashSoonOut = shiftRows
    .filter((r) => r.period === "current" && r.daysLeft <= th.rotationEndDays)
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const dashMed = rows
    .map((e: any) => ({ ...e, med: medExamInfo(e.medicalExamEndDate ?? "", today) }))
    .filter((e: any) => e.med.level !== "ok")
    .sort((a: any, b: any) => (a.med.level === b.med.level ? 0 : a.med.level === "bad" ? -1 : 1));
  const dashAbsent = absenceAll
    .filter((ev: any) => ev.state === "active")
    .sort((a: any, b: any) => a.daysLeft - b.daysLeft);
  const dashIncomplete = rows.filter((e: any) => !e.position || !e.objectId || !e.phone);
  // календарь показывает текущие и запланированные вахты независимо от фильтра периода
  const calendarRows = shiftRows.filter((r) => r.period !== "done");
  const soon = data.rotation.filter((r: any) => r.daysLeft <= th.rotationEndDays);

  const nowDate = new Date(data.nowIso);
  const span = 60;
  const bar = (r: any) => {
    const start = Math.max(0, Math.round((new Date(r.startDate).getTime() - nowDate.getTime()) / 86400000));
    const end = Math.min(span, Math.round((new Date(r.endDate).getTime() - nowDate.getTime()) / 86400000) + 1);
    return { left: (start / span) * 100, width: Math.max(2, ((end - start) / span) * 100) };
  };

  /** Открыть карточку сотрудника по идентификатору — из любой строки дашборда */
  const openEmployeeCard = (id: number) => {
    const e = emps.find((x: any) => x.id === id);
    if (e) openEdit(e);
  };
  /** Открыть годовую аналитику сотрудника */
  const openAnalytics = (id: number) => {
    setTsYear(String(new Date().getFullYear()));
    setTsDialog({ open: true, id });
  };

  const openAdd = () => {
    setEmpError("");
    setEmpForm({ fio: "", position: positionOptions[0] ?? "", ownPosition: "", objectId: NO_OBJECT, phone: "", medicalExamEndDate: "", workStatus: "office" });
    setEmpDialog({ open: true, id: null });
  };
  const openEdit = (e: any) => {
    setEmpError("");
    setEmpForm({
      fio: e.fio,
      position: positionOptions.includes(e.position) ? e.position : OWN_POSITION,
      ownPosition: positionOptions.includes(e.position) ? "" : e.position,
      objectId: String(e.objectId || 0),
      phone: e.phone ?? "", medicalExamEndDate: e.medicalExamEndDate ?? "", workStatus: e.workStatus ?? "office",
    });
    setEmpDialog({ open: true, id: e.id });
  };
  /**
   * Переход от показателя к списку: карточка задаёт вкладку и фильтры,
   * страница прокручивается к таблице, чтобы сразу было видно, кто и как.
   */
  const scrollToList = (testId: string) => {
    window.setTimeout(
      () => document.querySelector(`[data-testid='${testId}']`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
      80,
    );
  };
  const showPeople = (status: string) => {
    setTab("people");
    setQ("");
    setObjectFilter("all");
    setPositionFilter("all");
    setMedFilter("all");
    setStatusFilter(status);
    scrollToList("table-employees");
  };
  const showShifts = (period: "current" | "planned" | "done" | "all", focus: "all" | "soon" | "noReplacement") => {
    setTab("shifts");
    setShiftPeriod(period);
    setShiftFocus(focus);
    scrollToList("table-rotation");
  };
  const showAbsence = (kind: string, state: "active" | "endingSoon" = "active") => {
    setTab("absence");
    setAbsKindFilter(kind);
    setAbsStateFilter(state);
    scrollToList("table-absence");
  };

  /** Даты заезда и выезда задаёт пользователь, цикл считается по ним */
  const openAssign = (ids: number[]) => {
    setShiftError("");
    setShiftForm({ startDate: todayIso(), endDate: "", objectId: "keep" });
    setShiftDialog({ open: true, ids });
  };

  /** Число дней и цикл по выбранным датам: 30 дней на вахте → «30/30» */
  const shiftDays = (from: string, to: string) =>
    from && to && to >= from
      ? Math.round((new Date(to + "T00:00:00").getTime() - new Date(from + "T00:00:00").getTime()) / 86400000) + 1
      : 0;
  const assignDays = shiftDays(shiftForm.startDate, shiftForm.endDate);

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
      <div className="mb-4 flex flex-wrap gap-1 rounded-md border p-1" role="tablist">
        <Button
          size="sm"
          variant={tab === "dash" ? "default" : "ghost"}
          onClick={() => setTab("dash")}
          data-testid="tab-dash"
        >
          <BarChart3 className="mr-2 h-4 w-4" />
          Дашборд
        </Button>
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
        <Button
          size="sm"
          variant={tab === "arch" ? "default" : "ghost"}
          onClick={() => setTab("arch")}
          data-testid="tab-arch"
        >
          <History className="mr-2 h-4 w-4" />
          Архив вахт
        </Button>
        <Button
          size="sm"
          variant={tab === "cal" ? "default" : "ghost"}
          onClick={() => setTab("cal")}
          data-testid="tab-cal"
        >
          <CalendarDays className="mr-2 h-4 w-4" />
          Календарь
        </Button>
        <Button
          size="sm"
          variant={tab === "sms" ? "default" : "ghost"}
          onClick={() => setTab("sms")}
          data-testid="tab-sms"
        >
          <MessageSquare className="mr-2 h-4 w-4" />
          Вызов на вахту
        </Button>
        <Button
          size="sm"
          variant={tab === "chat" ? "default" : "ghost"}
          onClick={() => setTab("chat")}
          data-testid="tab-chat"
        >
          <MessageSquare className="mr-2 h-4 w-4" />
          Переписка
          {unreadTotal > 0 && (
            <Badge variant="destructive" className="ml-2 px-1.5 text-[10px]" data-testid="badge-unread">
              {unreadTotal}
            </Badge>
          )}
        </Button>
        <Button
          size="sm"
          variant={tab === "setup" ? "default" : "ghost"}
          onClick={() => setTab("setup")}
          data-testid="tab-setup"
        >
          <Settings className="mr-2 h-4 w-4" />
          Настройка уведомлений
        </Button>
      </div>

      {tab === "dash" && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <Kpi
              testId="dash-kpi-total" label="Всего сотрудников" value={nf(counters.total)}
              onClick={() => showPeople("all")}
            />
            <Kpi
              testId="dash-kpi-onshift" label="На вахте" value={nf(counters.onshift)}
              level={counters.onshift > 0 ? "ok" : "warn"}
              onClick={() => showPeople("onshift")}
            />
            <Kpi
              testId="dash-kpi-between" label="На межвахте" value={nf(counters.between)}
              onClick={() => showPeople("between")}
            />
            <Kpi
              testId="dash-kpi-absent" label="Отсутствуют сейчас" value={nf(dashAbsent.length)}
              level={dashAbsent.length === 0 ? "ok" : "warn"}
              onClick={() => showAbsence("all", "active")}
            />
            <Kpi
              testId="dash-kpi-med" label="Медосмотр под вопросом" value={nf(dashMed.length)}
              level={dashMed.length === 0 ? "ok" : "bad"}
              onClick={() => { setTab("people"); setQ(""); setObjectFilter("all"); setPositionFilter("all"); setStatusFilter("all"); setMedFilter("soon"); scrollToList("table-employees"); }}
            />
            <Kpi
              testId="dash-kpi-soon" label="Скоро выезд с вахты" value={nf(dashSoonOut.length)}
              level={dashSoonOut.length === 0 ? "ok" : "warn"}
              hint={`Порог ${nf(th.rotationEndDays)} дн.`}
              onClick={() => showShifts("current", "soon")}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section
              title="Скоро выезд с вахты"
              description="Нажмите строку — откроется карточка сотрудника"
              actions={dashSoonOut.length > 12 ? (
                <Button variant="outline" size="sm" onClick={() => showShifts("current", "soon")} data-testid="dash-all-soon">
                  Показать все ({nf(dashSoonOut.length)})
                </Button>
              ) : undefined}
            >
              {dashSoonOut.length === 0 ? (
                <Empty text="В ближайшие дни выездов нет." />
              ) : (
                <div className="space-y-1" data-testid="dash-list-soon">
                  {dashSoonOut.slice(0, 12).map((r: any) => (
                    <DashRow
                      key={r.shiftId}
                      testId={`dash-row-soon-${r.shiftId}`}
                      fio={r.fio}
                      sub={`${r.position} · ${r.object}`}
                      badge={r.daysLeft <= 0 ? "выезд сегодня" : `осталось ${nf(r.daysLeft)} дн.`}
                      level={r.daysLeft <= 1 ? "bad" : "warn"}
                      onOpen={() => openEmployeeCard(r.employeeId)}
                      onAnalytics={() => openAnalytics(r.employeeId)}
                    />
                  ))}
                </div>
              )}
            </Section>

            <Section
              title="Медосмотр: просрочен или скоро истекает"
              description="Порог — 30 дней до окончания"
              actions={dashMed.length > 12 ? (
                <Button
                  variant="outline" size="sm" data-testid="dash-all-med"
                  onClick={() => { setTab("people"); setQ(""); setObjectFilter("all"); setPositionFilter("all"); setStatusFilter("all"); setMedFilter("soon"); scrollToList("table-employees"); }}
                >
                  Показать всех ({nf(dashMed.length)})
                </Button>
              ) : undefined}
            >
              {dashMed.length === 0 ? (
                <Empty text="У всех сотрудников медосмотр в порядке." />
              ) : (
                <div className="space-y-1" data-testid="dash-list-med">
                  {dashMed.slice(0, 12).map((e: any) => (
                    <DashRow
                      key={e.id}
                      testId={`dash-row-med-${e.id}`}
                      fio={e.fio}
                      sub={`${e.position || "должность не указана"} · ${objName(e.objectId) || "объект не указан"}`}
                      badge={e.med.text}
                      level={e.med.level}
                      onOpen={() => openEmployeeCard(e.id)}
                      onAnalytics={() => openAnalytics(e.id)}
                    />
                  ))}
                </div>
              )}
            </Section>

            <Section
              title="Отсутствуют сейчас"
              description="Отпуск, больничный, командировка, обучение"
              actions={dashAbsent.length > 12 ? (
                <Button variant="outline" size="sm" onClick={() => showAbsence("all", "active")} data-testid="dash-all-absent">
                  Показать всех ({nf(dashAbsent.length)})
                </Button>
              ) : undefined}
            >
              {dashAbsent.length === 0 ? (
                <Empty text="Все на месте." />
              ) : (
                <div className="space-y-1" data-testid="dash-list-absent">
                  {dashAbsent.slice(0, 12).map((ev: any) => (
                    <DashRow
                      key={ev.id}
                      testId={`dash-row-absent-${ev.id}`}
                      fio={ev.fio}
                      sub={`${ABSENCE_KIND_TEXT[ev.kind] ?? ev.kind} · по ${ruDate(ev.endDate)}`}
                      badge={ev.daysLeft <= 0 ? "заканчивается сегодня" : `осталось ${nf(ev.daysLeft)} дн.`}
                      level={ev.daysLeft <= 2 ? "warn" : "ok"}
                      onOpen={() => openEmployeeCard(ev.employeeId)}
                      onAnalytics={() => openAnalytics(ev.employeeId)}
                    />
                  ))}
                </div>
              )}
            </Section>

            <Section
              title="Не хватает данных в карточках"
              description="Нет должности, объекта или телефона"
              actions={dashIncomplete.length > 12 ? (
                <Button variant="outline" size="sm" onClick={() => showPeople("all")} data-testid="dash-all-incomplete">
                  Показать всех ({nf(dashIncomplete.length)})
                </Button>
              ) : undefined}
            >
              {dashIncomplete.length === 0 ? (
                <Empty text="Карточки сотрудников заполнены." />
              ) : (
                <div className="space-y-1" data-testid="dash-list-incomplete">
                  {dashIncomplete.slice(0, 12).map((e: any) => (
                    <DashRow
                      key={e.id}
                      testId={`dash-row-incomplete-${e.id}`}
                      fio={e.fio}
                      sub={[!e.position && "нет должности", !e.objectId && "нет объекта", !e.phone && "нет телефона"]
                        .filter(Boolean).join(" · ")}
                      badge="заполнить"
                      level="warn"
                      onOpen={() => openEmployeeCard(e.id)}
                      onAnalytics={() => openAnalytics(e.id)}
                    />
                  ))}
                </div>
              )}
            </Section>
          </div>

          <Section
            className="mt-4"
            title="Люди по участкам"
            description="Нажмите участок — откроется список его сотрудников"
          >
            {objectStaffing.length === 0 ? (
              <Empty text="Участки не заполнены. Добавьте их в справочнике объектов." />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {objectStaffing.map((o: any) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => { setTab("people"); setQ(""); setPositionFilter("all"); setStatusFilter("all"); setMedFilter("all"); setObjectFilter(String(o.id)); scrollToList("table-employees"); }}
                    className="flex items-center justify-between rounded-md border p-3 text-left transition hover:border-primary/60 hover:bg-accent/40"
                    data-testid={`dash-object-${o.id}`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{o.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {o.plan > 0 ? `Факт ${nf(o.fact)} из ${nf(o.plan)} по штату` : `Людей: ${nf(o.fact)}`}
                      </div>
                    </div>
                    <Badge variant="outline" className={cn("border text-[11px]", levelBadge[o.complete ? "ok" : "warn"])}>
                      {o.complete ? "укомплектован" : `не хватает ${nf(Math.max(0, o.plan - o.fact))}`}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </Section>
        </>
      )}

      {tab === "people" && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              testId="kpi-total" label="Всего сотрудников" value={nf(counters.total)}
              hint="Весь справочник"
              onClick={() => showPeople("all")} active={statusFilter === "all"}
            />
            <Kpi
              testId="kpi-onshift" label="На вахте" value={nf(counters.onshift)}
              level={counters.onshift > 0 ? "ok" : "warn"}
              onClick={() => showPeople("onshift")} active={statusFilter === "onshift"}
            />
            <Kpi
              testId="kpi-between" label="На межвахте" value={nf(counters.between)}
              onClick={() => showPeople("between")} active={statusFilter === "between"}
            />
            <Kpi
              testId="kpi-noshift"
              label="Вахта не назначена"
              value={nf(counters.none)}
              level={counters.none === 0 ? "ok" : "warn"}
              hint="Отметьте людей и назначьте вахту"
              onClick={() => showPeople("none")} active={statusFilter === "none"}
            />
          </div>

          <Card className="mb-4 p-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Медосмотр</label>
                <Select value={medFilter} onValueChange={(v) => setMedFilter(v as any)}>
                  <SelectTrigger data-testid="filter-crew-med"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Любой</SelectItem>
                    <SelectItem value="problem">Просрочен или не указан</SelectItem>
                    <SelectItem value="soon">Требует внимания (30 дн.)</SelectItem>
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
                      <th className="py-2 pr-3 font-medium">Метод работы</th><th className="py-2 pr-3 font-medium">Медосмотр</th><th className="py-2 pr-3 font-medium">Статус</th>
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
                            value={e.workStatus || "office"}
                            onValueChange={(v) => updateWorkStatus.mutate({ id: e.id, workStatus: v })}
                          >
                            <SelectTrigger
                              className="h-6 w-auto gap-1 border px-2 text-[11px] font-medium [&>svg]:h-3 [&>svg]:w-3"
                              data-testid={`select-workstatus-${e.id}`}
                            >
                              <SelectValue>{workStatusText(e.workStatus)}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {WORK_STATUSES.map((w) => (
                                <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {(() => {
                            const m = medExamInfo(e.medicalExamEndDate ?? "", today);
                            return (
                              <Badge variant="outline" className={cn("border text-[11px]", levelBadge[m.level])} data-testid={`badge-medexam-${e.id}`}>
                                <Stethoscope className="mr-1 h-3 w-3" />
                                {m.text}
                              </Badge>
                            );
                          })()}
                        </td>
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
                              <SelectItem value="between">На межвахте</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-2">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openAssign([e.id])}
                              data-testid={`button-assign-shift-${e.id}`}
                            >
                              <CalendarPlus className="mr-1 h-3.5 w-3.5" />
                              Назначить вахту
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Аналитика по сотруднику"
                              title="Месяцы и год: работа, вахта, межвахта, командировки, отпуск, больничный, обучение"
                              onClick={() => { setTsYear(String(new Date().getFullYear())); setTsDialog({ open: true, id: e.id }); }}
                              data-testid={`button-employee-analytics-${e.id}`}
                            >
                              <BarChart3 className="h-4 w-4" />
                            </Button>
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

          <Section
            className="mb-4"
            title="Годовые итоги по сотрудникам"
            description="Один календарный день учитывается только в одном состоянии, поэтому суммы не дублируются"
          >
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <div className="w-32">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Год</label>
                <Select value={summaryYear} onValueChange={setSummaryYear}>
                  <SelectTrigger data-testid="select-summary-year"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                variant={showSummary ? "outline" : "default"}
                onClick={() => setShowSummary(!showSummary)}
                data-testid="button-toggle-summary"
              >
                <BarChart3 className="mr-2 h-4 w-4" />
                {showSummary ? "Скрыть таблицу" : "Показать итоги"}
              </Button>
            </div>
            {!showSummary ? (
              <Empty text="Нажмите «Показать итоги»: для каждого сотрудника будет посчитано число дней по работе, вахте, межвахте, командировкам, отпуску, больничному и обучению." />
            ) : summary.isLoading ? (
              <Loading rows={3} />
            ) : summary.error ? (
              <ErrorBox text="Не удалось посчитать итоги по сотрудникам." />
            ) : !(summary.data?.rows ?? []).length ? (
              <Empty text="Сотрудники не внесены." />
            ) : (
              <div className="sticky-head max-h-[60vh] overflow-auto">
                <table className="w-full min-w-[860px] text-sm" data-testid="table-hr-summary">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">ФИО</th>
                      {HR_STATE_ORDER.map((s) => (
                        <th key={s} className="py-2 pr-3 text-right font-medium">{HR_STATE_LABELS[s]}</th>
                      ))}
                      <th className="py-2 text-right font-medium">Всего дней</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(summary.data?.rows ?? []).map((r: any) => (
                      <tr key={r.employeeId} className="border-b last:border-0" data-testid={`row-hr-summary-${r.employeeId}`}>
                        <td className="py-2 pr-3 font-medium whitespace-nowrap">{r.fio}</td>
                        {HR_STATE_ORDER.map((s) => (
                          <td key={s} className="num py-2 pr-3 text-right">{nf(r[s] ?? 0)}</td>
                        ))}
                        <td className="num py-2 text-right font-medium">{nf(r.days ?? 0)}</td>
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
              onClick={() => showShifts("current", "all")}
              active={shiftPeriod === "current" && shiftFocus === "all"}
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
              onClick={() => showShifts("current", "soon")}
              active={shiftFocus === "soon"}
            />
            <Kpi
              testId="kpi-no-replacement"
              label="Без назначенной замены"
              value={nf(soon.filter((r: any) => !r.replacementAssigned).length)}
              level={soon.filter((r: any) => !r.replacementAssigned).length === 0 ? "ok" : "bad"}
              onClick={() => showShifts("current", "noReplacement")}
              active={shiftFocus === "noReplacement"}
            />
            <Kpi
              testId="kpi-noshift-total" label="Вахта не назначена" value={nf(counters.none)}
              hint="Откроется список сотрудников"
              onClick={() => showPeople("none")}
            />
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
            <div className="min-w-[200px]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Период</label>
              <Select value={shiftPeriod} onValueChange={(v) => setShiftPeriod(v as any)}>
                <SelectTrigger data-testid="filter-shift-period"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">Сейчас на вахте</SelectItem>
                  <SelectItem value="planned">Запланированные</SelectItem>
                  <SelectItem value="done">Завершённые</SelectItem>
                  <SelectItem value="all">Все вахты</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[200px]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Показывать</label>
              <Select value={shiftFocus} onValueChange={(v) => setShiftFocus(v as any)}>
                <SelectTrigger data-testid="filter-shift-focus"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все вахты периода</SelectItem>
                  <SelectItem value="soon">Выезд в ближайшие дни</SelectItem>
                  <SelectItem value="noReplacement">Без назначенной замены</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={() => { setTab("people"); }} data-testid="button-go-people">
              <CalendarPlus className="mr-2 h-4 w-4" />
              Назначить вахту
            </Button>
          </Card>

          <Section className="mb-4" title="Вахты" description="Даты заезда и выезда можно изменить в любой момент — кнопка с карандашом">
            {allShifts.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center" data-testid="empty-shifts">
                <div className="text-sm font-medium">Вахты ещё не назначены</div>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Перейдите на вкладку «Сотрудники», выберите людей галочками и нажмите «Назначить вахту».
                  Даты заезда и выезда указываете вы, цикл программа посчитает сама.
                </p>
                <Button className="mt-3" size="sm" onClick={() => setTab("people")} data-testid="button-empty-go-people">
                  <Users className="mr-2 h-4 w-4" />
                  Перейти к сотрудникам
                </Button>
              </div>
            ) : rotation.length === 0 ? (
              <Empty text="По выбранному объекту и периоду вахт нет. Измените фильтры." />
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
                          <td className={cn("num py-2 pr-3 text-right font-medium", r.period === "current" ? levelText[lvl] : "")}>
                            {r.period === "current" ? nf(r.daysLeft) : r.period === "planned" ? "до заезда" : "завершена"}
                            {r.overtime && r.period === "current" && <span className="ml-1 text-xs">переработка</span>}
                          </td>
                          <td className="py-2">
                            {r.period !== "current" ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : r.replacementAssigned ? (
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
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Изменить фактические даты вахты"
                                title="Изменить фактические даты заезда и выезда"
                                onClick={() => openEditShiftDates(r)}
                                data-testid={`button-edit-shift-${r.shiftId}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Снять вахту"
                                onClick={() => deleteShift.mutate(r.shiftId)}
                                data-testid={`button-delete-shift-${r.shiftId}`}
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

          <Section title="Календарь вахт" description="Ближайшие 60 дней, полоса — период работы на объекте">
            {calendarRows.length === 0 ? (
              <Empty text="Нет активных вахт для отображения." />
            ) : (
              <div className="space-y-1.5" data-testid="calendar-shifts">
                {calendarRows.slice(0, 24).map((r: any) => {
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


      {tab === "arch" && (
        <>
          <Section
            title="Архив вахт"
            description="Все заезды и выезды за выбранный период. Нажмите строку — откроется карточка сотрудника."
            actions={
              <ExportButton
                onClick={() => downloadFile(`/api/export/shift-archive/xlsx?from=${archFrom}&to=${archTo}`, `Архив вахт ${archFrom} — ${archTo}.xlsx`)}
                label="Выгрузить в Excel"
              />
            }
          >
            <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Период с</label>
                <Input
                  type="date" value={archFrom} onChange={(e) => setArchFrom(e.target.value)}
                  data-testid="input-arch-from"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">по</label>
                <Input
                  type="date" value={archTo} onChange={(e) => setArchTo(e.target.value)}
                  data-testid="input-arch-to"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Участок</label>
                <Select value={archObject} onValueChange={setArchObject}>
                  <SelectTrigger data-testid="filter-arch-object"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все участки</SelectItem>
                    {objects.map((o: any) => (
                      <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Сотрудник</label>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8" placeholder="Фамилия" value={archQ}
                    onChange={(e) => setArchQ(e.target.value)} data-testid="input-arch-search"
                  />
                </div>
              </div>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi testId="arch-kpi-shifts" label="Вахт в периоде" value={nf(archRows.length)} />
              <Kpi
                testId="arch-kpi-people" label="Человек"
                value={nf(new Set(archRows.map((r: any) => r.employeeId)).size)}
              />
              <Kpi
                testId="arch-kpi-mandays" label="Человеко-дней"
                value={nf(archRows.reduce((sum: number, r: any) => sum + r.days, 0))}
              />
              <Kpi
                testId="arch-kpi-avg" label="Средняя вахта, дн."
                value={archRows.length
                  ? nf(Math.round(archRows.reduce((sum: number, r: any) => sum + r.days, 0) / archRows.length))
                  : "0"}
              />
            </div>

            {archive.isLoading ? <Loading rows={3} /> : archRows.length === 0 ? (
              <Empty text="За этот период вахт нет. Измените даты или участок." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-arch">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Сотрудник</th>
                      <th className="py-2 pr-3 font-medium">Участок</th>
                      <th className="py-2 pr-3 font-medium">Заезд</th>
                      <th className="py-2 pr-3 font-medium">Выезд</th>
                      <th className="py-2 pr-3 text-right font-medium">Дней</th>
                      <th className="py-2 pr-3 font-medium">Цикл</th>
                      <th className="py-2 pr-3 font-medium">Состояние</th>
                      <th className="py-2 pr-0" />
                    </tr>
                  </thead>
                  <tbody>
                    {(archAll ? archRows : archRows.slice(0, 100)).map((r: any) => {
                      const today = todayIso();
                      const stateText = r.endDate < today ? "завершена" : r.startDate > today ? "запланирована" : "идёт";
                      return (
                        <tr
                          key={r.shiftId} className="cursor-pointer border-b hover:bg-muted/50"
                          data-testid={`arch-row-${r.shiftId}`}
                          onClick={() => openEmployeeCard(r.employeeId)}
                        >
                          <td className="py-2 pr-3">
                            <div className="font-medium">{r.fio}</div>
                            <div className="text-xs text-muted-foreground">{r.position}</div>
                          </td>
                          <td className="py-2 pr-3">{r.object}</td>
                          <td className="num py-2 pr-3">{ruDate(r.startDate)}</td>
                          <td className="num py-2 pr-3">{ruDate(r.endDate)}</td>
                          <td className="num py-2 pr-3 text-right">{nf(r.days)}</td>
                          <td className="py-2 pr-3 text-muted-foreground">{r.cycleType}</td>
                          <td className="py-2 pr-3">
                            <Badge variant="outline" className="text-[11px]">{stateText}</Badge>
                          </td>
                          <td className="py-2 pr-0 text-right">
                            <Button
                              size="icon" variant="ghost" className="h-7 w-7"
                              aria-label={`Аналитика по ${r.fio}`}
                              data-testid={`arch-analytics-${r.shiftId}`}
                              onClick={(e) => { e.stopPropagation(); openAnalytics(r.employeeId); }}
                            >
                              <BarChart3 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {archRows.length > 100 && (
                  <div className="mt-3 text-center">
                    <Button
                      size="sm" variant="outline" onClick={() => setArchAll(!archAll)}
                      data-testid="arch-toggle-all"
                    >
                      {archAll ? "Свернуть список" : `Показать все (${nf(archRows.length)})`}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Section>

          <Section title="Итоги по участкам" description="Сколько вахт, людей и человеко-дней прошло через каждый участок за период">
            {(archive.data?.byObject ?? []).length === 0 ? (
              <Empty text="Нет данных за период." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(archive.data?.byObject ?? []).map((o: any) => (
                  <button
                    key={o.objectId} type="button"
                    className="rounded-md border p-3 text-left hover:bg-muted/50"
                    data-testid={`arch-object-${o.objectId}`}
                    onClick={() => setArchObject(String(o.objectId))}
                  >
                    <div className="font-medium">{o.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Вахт {nf(o.shifts)} · человек {nf(o.people)} · человеко-дней {nf(o.manDays)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="Срез на дату"
            description="Выберите любой день — программа покажет, кто был на вахте, а кто не выезжал и по какой причине"
          >
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Дата</label>
                <Input
                  type="date" value={sliceDate} onChange={(e) => setSliceDate(e.target.value)}
                  className="w-44" data-testid="input-slice-date"
                />
              </div>
              <Button size="sm" variant="outline" onClick={() => setSliceDate(todayIso())} data-testid="slice-today">
                Сегодня
              </Button>
              {slice.data && (
                <Badge variant="outline" className="mb-1">
                  {DAY_KIND_TEXT[slice.data.dayKind] ?? slice.data.dayKind} день по календарю
                </Badge>
              )}
            </div>

            {slice.isLoading ? <Loading rows={3} /> : !slice.data ? (
              <Empty text="Выберите дату." />
            ) : (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
                  <Kpi testId="slice-kpi-total" label="Всего сотрудников" value={nf(slice.data.counters.total)} />
                  <Kpi testId="slice-kpi-onshift" label="Были на вахте" value={nf(slice.data.counters.onshift)} />
                  <Kpi testId="slice-kpi-between" label="На межвахте" value={nf(slice.data.counters.between)} />
                  <Kpi testId="slice-kpi-absent" label="Отсутствовали" value={nf(slice.data.counters.absent)} />
                  <Kpi testId="slice-kpi-work" label="Работали в офисе или на ПП" value={nf(slice.data.counters.work)} />
                  <Kpi testId="slice-kpi-dayoff" label="Выходной у офиса" value={nf(slice.data.counters.dayoff)} />
                </div>

                {slice.data.byObject.length > 0 && (
                  <div className="mb-4 flex flex-wrap gap-2">
                    {slice.data.byObject.map((o: any) => (
                      <Badge key={o.objectId} variant="secondary" className="text-xs">
                        {o.name}: {nf(o.people)} чел.
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="mb-2 text-sm font-medium">Были на вахте</div>
                    <div className="space-y-2" data-testid="slice-list-onshift">
                      {slice.data.rows.filter((r: any) => r.state === "onshift").length === 0 ? (
                        <Empty text="В этот день на вахте никого не было." />
                      ) : slice.data.rows.filter((r: any) => r.state === "onshift").map((r: any) => (
                        <DashRow
                          key={r.employeeId} testId={`slice-row-on-${r.employeeId}`}
                          fio={r.fio}
                          sub={`${r.object} · ${ruDate(r.shiftStart)} — ${ruDate(r.shiftEnd)}`}
                          badge="на вахте" level="ok"
                          onOpen={() => openEmployeeCard(r.employeeId)}
                          onAnalytics={() => openAnalytics(r.employeeId)}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-sm font-medium">Не были на вахте</div>
                    <div className="space-y-2" data-testid="slice-list-off">
                      {slice.data.rows.filter((r: any) => r.state !== "onshift").length === 0 ? (
                        <Empty text="В этот день на вахте были все." />
                      ) : slice.data.rows.filter((r: any) => r.state !== "onshift").map((r: any) => (
                        <DashRow
                          key={r.employeeId} testId={`slice-row-off-${r.employeeId}`}
                          fio={r.fio}
                          sub={r.eventKind
                            ? `${ABSENCE_KIND_TEXT[r.eventKind] ?? r.eventKind} · по ${ruDate(r.eventEnd)}`
                            : r.lastShiftEnd
                              ? `Последний выезд ${ruDate(r.lastShiftEnd)}`
                              : r.position}
                          badge={HR_STATE_LABELS[r.state] ?? r.state}
                          level={["sick", "unassigned"].includes(r.state) ? "warn" : "ok"}
                          onOpen={() => openEmployeeCard(r.employeeId)}
                          onAnalytics={() => openAnalytics(r.employeeId)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </Section>
        </>
      )}

      {tab === "cal" && (
        <>
          <Section
            title={`Производственный календарь ${calYear} года`}
            description="Календарь действует для офиса и пробоподготовки. Вахтовики работают по графику заездов, на них он не влияет."
            actions={
              <div className="flex items-center gap-2">
                <Select value={calYear} onValueChange={setCalYear}>
                  <SelectTrigger className="w-28" data-testid="filter-cal-year"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["2026", "2027", "2028", "2029", "2030"].map((y) => (
                      <SelectItem key={y} value={y}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm" variant="outline" data-testid="button-cal-regen"
                  disabled={regenYear.isPending}
                  onClick={() => {
                    if (window.confirm(`Пересобрать календарь ${calYear} года по ТК РФ? Ручные правки этого года будут сброшены.`)) {
                      regenYear.mutate();
                    }
                  }}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Пересобрать по ТК РФ
                </Button>
              </div>
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Нажмите день, чтобы сменить тип:</span>
              {["work", "weekend", "holiday", "short"].map((k) => (
                <span key={k} className={cn("rounded border px-2 py-1", DAY_KIND_CLASS[k])}>{DAY_KIND_TEXT[k]}</span>
              ))}
              <span>· Работа в выходной по необходимости отмечается записью «Работа в офисе» на вкладке «Отсутствия»</span>
            </div>

            {calendar.isLoading ? <Loading rows={6} /> : !calendar.data ? (
              <Empty text="Календарь не загрузился. Обновите страницу." />
            ) : (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Kpi testId="cal-kpi-work" label="Рабочих дней в году" value={nf(calendar.data.total.work)} />
                  <Kpi testId="cal-kpi-weekend" label="Выходных" value={nf(calendar.data.total.weekend)} />
                  <Kpi testId="cal-kpi-holiday" label="Праздничных" value={nf(calendar.data.total.holiday)} />
                  <Kpi testId="cal-kpi-days" label="Дней в году" value={nf(calendar.data.total.days)} />
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {calendar.data.months.map((m: any, i: number) => {
                    const days = (calendar.data.days ?? []).filter((d: any) => d.date.startsWith(m.month));
                    const first = days[0] ? new Date(days[0].date + "T00:00:00Z").getUTCDay() : 1;
                    const pad = (first + 6) % 7; // неделя начинается с понедельника
                    return (
                      <div key={m.month} className="rounded-md border p-3" data-testid={`cal-month-${m.month}`}>
                        <div className="mb-2 flex items-baseline justify-between">
                          <div className="text-sm font-medium">{MONTH_NAMES[i]}</div>
                          <div className="text-xs text-muted-foreground">рабочих {nf(m.work)}</div>
                        </div>
                        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
                          {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((w) => <div key={w}>{w}</div>)}
                        </div>
                        <div className="mt-1 grid grid-cols-7 gap-1">
                          {Array.from({ length: pad }, (_, k) => <div key={`pad-${k}`} />)}
                          {days.map((d: any) => (
                            <button
                              key={d.date} type="button"
                              className={cn(
                                "num rounded border py-1 text-center text-xs transition-colors",
                                DAY_KIND_CLASS[d.kind] ?? DAY_KIND_CLASS.work,
                              )}
                              title={`${ruDate(d.date)} — ${DAY_KIND_TEXT[d.kind] ?? d.kind}${d.note ? ` · ${d.note}` : ""}`}
                              data-testid={`cal-day-${d.date}`}
                              onClick={() => setDayKind.mutate({ id: d.id, kind: DAY_KIND_NEXT[d.kind] ?? "weekend" })}
                            >
                              {Number(d.date.slice(8, 10))}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                  Праздники расставлены по статье 112 ТК РФ, выходные с праздников перенесены на следующий рабочий день.
                  Переносы на 2027 год и далее правительство утверждает отдельными постановлениями — проверьте их
                  и поправьте дни вручную, когда постановление выйдет.
                </div>
              </>
            )}
          </Section>
        </>
      )}


      {tab === "setup" && (
        <>
          <Section
            title="Вызов на вахту по СМС"
            description="Программа сама отправляет напоминание о заезде через шлюз SMSC.ru за выбранное число дней"
            actions={
              <div className="flex items-center gap-2">
                <Button
                  size="sm" variant="outline" data-testid="button-sms-balance"
                  disabled={checkBalance.isPending} onClick={() => checkBalance.mutate()}
                >
                  <Wallet className="mr-2 h-4 w-4" />
                  Баланс
                </Button>
                {smsBalance && <Badge variant="secondary" data-testid="text-sms-balance">{smsBalance}</Badge>}
              </div>
            }
          >
            {!form ? <Loading rows={3} /> : (
              <>
                <div className="mb-4 flex items-center gap-3 rounded-md border p-3">
                  <Switch
                    checked={!!form.enabled}
                    onCheckedChange={(v: boolean) => setSmsForm({ ...form, enabled: v })}
                    data-testid="switch-sms-enabled"
                  />
                  <div>
                    <div className="text-sm font-medium">Автоматическая отправка</div>
                    <div className="text-xs text-muted-foreground">
                      Раз в день программа проверяет ближайшие заезды и отправляет вызов каждому один раз
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Логин SMSC</label>
                    <Input
                      value={form.login ?? ""} onChange={(e) => setSmsForm({ ...form, login: e.target.value })}
                      data-testid="input-sms-login"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Пароль SMSC</label>
                    <Input
                      type="password" value={smsSecret.password}
                      placeholder={form.hasPassword ? "сохранён, можно не вводить" : "введите пароль"}
                      onChange={(e) => setSmsSecret({ ...smsSecret, password: e.target.value })}
                      data-testid="input-sms-password"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      API-ключ (вместо пароля)
                    </label>
                    <Input
                      type="password" value={smsSecret.apikey}
                      placeholder={form.hasApikey ? "сохранён, можно не вводить" : "не обязательно"}
                      onChange={(e) => setSmsSecret({ ...smsSecret, apikey: e.target.value })}
                      data-testid="input-sms-apikey"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Имя отправителя
                    </label>
                    <Input
                      value={form.sender ?? ""} onChange={(e) => setSmsForm({ ...form, sender: e.target.value })}
                      placeholder="например PBK"
                      data-testid="input-sms-sender"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      За сколько дней до заезда
                    </label>
                    <Input
                      type="number" min={0} max={30} value={form.daysBefore ?? 3}
                      onChange={(e) => setSmsForm({ ...form, daysBefore: Number(e.target.value) })}
                      data-testid="input-sms-days"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Во сколько отправлять, час
                    </label>
                    <Input
                      type="number" min={0} max={23} value={form.sendHour ?? 9}
                      onChange={(e) => setSmsForm({ ...form, sendHour: Number(e.target.value) })}
                      data-testid="input-sms-hour"
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Телефон для вопросов (подставляется в текст)
                    </label>
                    <Input
                      value={form.contact ?? ""} onChange={(e) => setSmsForm({ ...form, contact: e.target.value })}
                      data-testid="input-sms-contact"
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Текст сообщения</label>
                  <Textarea
                    rows={3} value={form.template ?? ""}
                    onChange={(e) => setSmsForm({ ...form, template: e.target.value })}
                    data-testid="input-sms-template"
                  />
                  <div className="mt-1 text-xs text-muted-foreground">
                    Подстановки: {"{фио}"}, {"{дата}"} — заезд, {"{выезд}"}, {"{участок}"}, {"{должность}"},
                    {" "}{"{дней}"} — сколько дней осталось, {"{контакт}"}. Русский текст: 70 символов в одной части
                    сообщения, дальше каждая часть тарифицируется отдельно.
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <Button
                    onClick={() => saveSms.mutate({
                      ...form,
                      ...(smsSecret.password ? { password: smsSecret.password } : {}),
                      ...(smsSecret.apikey ? { apikey: smsSecret.apikey } : {}),
                    })}
                    disabled={saveSms.isPending}
                    data-testid="button-sms-save"
                  >
                    <Check className="mr-2 h-4 w-4" />
                    Сохранить настройки
                  </Button>
                  <div className="flex items-end gap-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">Проверка на номер</label>
                      <Input
                        value={testPhone} onChange={(e) => setTestPhone(e.target.value)}
                        placeholder="+7 913 000-00-00" className="w-48"
                        data-testid="input-sms-test-phone"
                      />
                    </div>
                    <Button
                      variant="outline" onClick={() => testSms.mutate()}
                      disabled={!testPhone || testSms.isPending}
                      data-testid="button-sms-test"
                    >
                      <Send className="mr-2 h-4 w-4" />
                      Отправить проверку
                    </Button>
                  </div>
                </div>
              </>
            )}
          </Section>

          <Section
            title="Уведомления через бота MAX"
            description="Сообщения в MAX бесплатные. Сотрудник один раз открывает бота по своей ссылке — дальше вызовы уходят сами."
            actions={
              <div className="flex items-center gap-2">
                <Button
                  size="sm" variant="outline" onClick={() => checkMax.mutate()}
                  disabled={checkMax.isPending} data-testid="button-max-check"
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Проверить бота
                </Button>
                {maxBot && <Badge variant="secondary" data-testid="text-max-bot">{maxBot}</Badge>}
              </div>
            }
          >
            {!maxF ? <Loading rows={2} /> : (
              <>
                <div className="mb-4 flex items-center gap-3 rounded-md border p-3">
                  <Switch
                    checked={!!maxF.enabled}
                    onCheckedChange={(v: boolean) => setMaxForm({ ...maxF, enabled: v })}
                    data-testid="switch-max-enabled"
                  />
                  <div>
                    <div className="text-sm font-medium">Отправлять через MAX, когда человек привязан</div>
                    <div className="text-xs text-muted-foreground">
                      Кто не привязан — получит СМС, если номер указан
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Имя бота в MAX</label>
                    <Input
                      value={maxF.botName ?? ""} onChange={(e) => setMaxForm({ ...maxF, botName: e.target.value })}
                      placeholder="например pbk_vahta_bot"
                      data-testid="input-max-botname"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Токен бота</label>
                    <Input
                      type="password" value={maxToken}
                      placeholder={maxF.hasToken ? "сохранён, можно не вводить" : "вставьте токен из раздела «Чат-боты»"}
                      onChange={(e) => setMaxToken(e.target.value)}
                      data-testid="input-max-token"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      onClick={() => saveMax.mutate({ ...maxF, ...(maxToken ? { token: maxToken } : {}) })}
                      disabled={saveMax.isPending} data-testid="button-max-save"
                    >
                      <Check className="mr-2 h-4 w-4" />
                      Сохранить
                    </Button>
                  </div>
                </div>

                <div className="mt-4 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-medium">Как программа узнаёт о событиях</div>
                    <Badge
                      variant="outline"
                      className={cn("text-[11px]", maxF.mode === "webhook"
                        ? "border-emerald-500 text-emerald-600" : "border-amber-500 text-amber-600")}
                      data-testid="badge-max-mode"
                    >
                      {maxF.mode === "webhook" ? "MAX присылает сам (webhook)" : "опрос раз в минуту"}
                    </Badge>
                    {maxF.lastEventAt && (
                      <span className="text-xs text-muted-foreground">
                        последнее событие {String(maxF.lastEventAt).slice(8, 10)}.
                        {String(maxF.lastEventAt).slice(5, 7)} {String(maxF.lastEventAt).slice(11, 16)}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Webhook — способ, при котором MAX сам отправляет события на наш адрес: ответы приходят сразу,
                    ничего не теряется. Адрес должен работать по https на порту 443 с обычным сертификатом домена.
                  </div>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <div className="min-w-[280px] flex-1">
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        Адрес для событий
                      </label>
                      <Input
                        value={webhookUrl || maxF.webhookUrl || "https://24pbk.ru/api/max/webhook"}
                        onChange={(e) => setWebhookUrl(e.target.value)}
                        data-testid="input-max-webhook"
                      />
                    </div>
                    <Button
                      onClick={() => enableHook.mutate()} disabled={enableHook.isPending}
                      data-testid="button-max-webhook-on"
                    >
                      <Check className="mr-2 h-4 w-4" />
                      Включить webhook
                    </Button>
                    <Button
                      variant="outline" onClick={() => disableHook.mutate()} disabled={disableHook.isPending}
                      data-testid="button-max-webhook-off"
                    >
                      Вернуть опрос
                    </Button>
                  </div>
                </div>

                <div className="mt-4 rounded-md border p-3">
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={!!maxF.reportEnabled}
                      onCheckedChange={(v: boolean) => setMaxForm({ ...maxF, reportEnabled: v })}
                      data-testid="switch-max-report"
                    />
                    <div>
                      <div className="text-sm font-medium">Присылать мне сводку в MAX: кто подтвердил, кто нет</div>
                      <div className="text-xs text-muted-foreground">
                        Раз в день в указанный час. В любой момент можно написать боту «статус» и получить сводку сразу.
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        Кому присылать сводки и оповещения — отметьте ответственных
                      </label>
                      <div className="flex flex-wrap gap-2" data-testid="list-max-report-targets">
                        {(maxInvites.data?.rows ?? []).filter((r: any) => r.linked).length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            Сначала привяжите свой профиль по ссылке ниже
                          </span>
                        ) : (maxInvites.data?.rows ?? []).filter((r: any) => r.linked).map((r: any) => {
                          const ids = String(maxF.reportChatIds ?? "").split(",").map((x: string) => x.trim()).filter(Boolean);
                          const on = ids.includes(String(r.chatId));
                          return (
                            <label
                              key={r.employeeId}
                              className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-sm",
                                on && "border-emerald-500 bg-emerald-50 dark:bg-emerald-950")}
                              data-testid={`report-target-${r.employeeId}`}
                            >
                              <Checkbox
                                checked={on}
                                onCheckedChange={(v: boolean) => {
                                  const next = v
                                    ? [...ids, String(r.chatId)]
                                    : ids.filter((x: string) => x !== String(r.chatId));
                                  setMaxForm({ ...maxF, reportChatIds: next.join(",") });
                                }}
                              />
                              {r.fio}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">Час отправки</label>
                      <Input
                        type="number" min={0} max={23} value={maxF.reportHour ?? 18}
                        onChange={(e) => setMaxForm({ ...maxF, reportHour: Number(e.target.value) })}
                        data-testid="input-max-report-hour"
                      />
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={!!maxF.notifyDecline}
                        onCheckedChange={(v: boolean) => setMaxForm({ ...maxF, notifyDecline: v })}
                        data-testid="check-notify-decline"
                      />
                      Сообщать сразу об отказах, причинах и сообщениях сотрудников
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={!!maxF.duplicateSms}
                        onCheckedChange={(v: boolean) => setMaxForm({ ...maxF, duplicateSms: v })}
                        data-testid="check-duplicate-sms"
                      />
                      Дублировать такие оповещения СМС на телефоны ответственных
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm" onClick={() => sendDigest.mutate()} disabled={sendDigest.isPending}
                      data-testid="button-max-digest-send"
                    >
                      <Send className="mr-2 h-4 w-4" />
                      Прислать сводку сейчас
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      onClick={() => saveMax.mutate({ ...maxF, ...(maxToken ? { token: maxToken } : {}) })}
                      data-testid="button-max-report-save"
                    >
                      <Check className="mr-2 h-4 w-4" />
                      Сохранить настройки сводки
                    </Button>
                  </div>
                  {digest.data?.text && (
                    <pre
                      className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs"
                      data-testid="text-max-digest-preview"
                    >{digest.data.text}</pre>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">Персональные ссылки для сотрудников</div>
                  <Button
                    size="sm" variant="outline" onClick={() => pollMax.mutate()}
                    disabled={pollMax.isPending} data-testid="button-max-poll"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Проверить новые привязки
                  </Button>
                </div>

                {maxInvites.isLoading ? <Loading rows={3} /> : (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-sm" data-testid="table-max-invites">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="py-2 pr-3 font-medium">Сотрудник</th>
                          <th className="py-2 pr-3 font-medium">Состояние</th>
                          <th className="py-2 pr-3 font-medium">Ссылка-приглашение</th>
                          <th className="py-2 pr-0" />
                        </tr>
                      </thead>
                      <tbody>
                        {(maxInvites.data?.rows ?? []).map((r: any) => (
                          <tr key={r.employeeId} className="border-b" data-testid={`max-row-${r.employeeId}`}>
                            <td className="py-2 pr-3">
                              <div className="font-medium">{r.fio}</div>
                              <div className="text-xs text-muted-foreground">{r.position}</div>
                            </td>
                            <td className="py-2 pr-3">
                              {r.linked ? (
                                <Badge variant="outline" className="border-emerald-500 text-[11px] text-emerald-600">
                                  привязан
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[11px]">не привязан</Badge>
                              )}
                            </td>
                            <td className="py-2 pr-3 text-xs text-muted-foreground">
                              {r.link || "укажите имя бота выше"}
                            </td>
                            <td className="py-2 pr-0 text-right">
                              {r.link && (
                                <Button
                                  size="sm" variant="ghost"
                                  onClick={() => copyText(r.link, `Ссылка для ${r.fio} скопирована`)}
                                  data-testid={`max-copy-${r.employeeId}`}
                                >
                                  <Copy className="mr-2 h-4 w-4" />
                                  Копировать
                                </Button>
                              )}
                              {r.linked && (
                                <Button
                                  size="sm" variant="ghost"
                                  onClick={() => unlinkMax.mutate(r.employeeId)}
                                  data-testid={`max-unlink-${r.employeeId}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="mt-3 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                  Бот создаётся на верифицированном профиле организации, ИП или самозанятого на платформе MAX
                  для партнёров, токен берётся в разделе «Чат-боты». Написать первым по номеру телефона MAX
                  не позволяет: отправьте человеку его ссылку любым способом, он перейдёт — и привязка появится сама.
                  Если проверка бота сообщает, что нет сертификата Минцифры, выполните на сервере один раз:
                  sudo bash deploy/install-russian-certs.sh
                </div>
              </>
            )}
          </Section>

        </>
      )}

      {tab === "sms" && (
        <>
          <Section
            title="Кого вызывать"
            description="Заезды в ближайшие дни. Программа отправляет каждому один раз — повторно кнопкой не задублируется."
            actions={
              <Button
                size="sm" onClick={() => runSms.mutate(undefined)}
                disabled={runSms.isPending || !(smsPending.data?.rows ?? []).some((r: any) => !r.sentAt && r.phoneOk)}
                data-testid="button-sms-run-all"
              >
                <Send className="mr-2 h-4 w-4" />
                Отправить всем
              </Button>
            }
          >
            {smsPending.isLoading ? <Loading rows={3} /> : (smsPending.data?.rows ?? []).length === 0 ? (
              <Empty text="В ближайшие дни заездов нет. Измените число дней в настройках выше." />
            ) : (
              <div className="space-y-2">
                {(smsPending.data?.rows ?? []).map((r: any) => (
                  <div
                    key={r.shiftId} className="flex flex-wrap items-center gap-3 rounded-md border p-3"
                    data-testid={`sms-row-${r.shiftId}`}
                  >
                    <div className="min-w-[180px] flex-1">
                      <button
                        type="button" className="text-left font-medium hover:underline"
                        onClick={() => openEmployeeCard(r.employeeId)}
                        data-testid={`sms-open-${r.employeeId}`}
                      >
                        {r.fio}
                      </button>
                      <div className="text-xs text-muted-foreground">
                        {r.object} · заезд {ruDate(r.startDate)} · через {nf(r.daysLeft)} дн.
                      </div>
                    </div>
                    <div className="min-w-[160px] text-xs text-muted-foreground">
                      {r.phoneOk ? r.phone : <span className="text-amber-600">номер не указан или неверный</span>}
                    </div>
                    <div className="min-w-[220px] flex-1 text-xs">{r.text}</div>
                    <Badge variant="outline" className="text-[11px]">частей {nf(r.parts)}</Badge>
                    {r.maxLinked && (
                      <Badge variant="outline" className="border-emerald-500 text-[11px] text-emerald-600">MAX</Badge>
                    )}
                    {r.answer && (
                      <Badge
                        variant="outline"
                        className={cn("text-[11px]", r.answer === "confirm"
                          ? "border-emerald-500 text-emerald-600" : "border-rose-500 text-rose-600")}
                      >
                        {r.answer === "confirm" ? "подтвердил" : "отказался"}
                      </Badge>
                    )}
                    {r.sentAt ? (
                      <Badge variant="secondary" className="text-[11px]">отправлено</Badge>
                    ) : (
                      <Button
                        size="sm" variant="outline" disabled={!r.phoneOk || runSms.isPending}
                        onClick={() => runSms.mutate([r.shiftId])}
                        data-testid={`sms-send-${r.shiftId}`}
                      >
                        <Send className="mr-2 h-4 w-4" />
                        Отправить
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="Отправить выбранным"
            description="Отметьте людей в списке и отправьте сообщение — независимо от того, есть ли у них заезд в ближайшие дни"
            actions={
              <div className="flex items-center gap-2">
                <Badge variant="secondary" data-testid="text-sms-picked">выбрано {nf(smsPicked.length)}</Badge>
                <Button
                  size="sm" disabled={(!smsPicked.length && !smsExtra.trim()) || sendToPicked.isPending}
                  onClick={() => sendToPicked.mutate()}
                  data-testid="button-sms-send-picked"
                >
                  <Send className="mr-2 h-4 w-4" />
                  Отправить выбранным
                </Button>
              </div>
            }
          >
            <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Поиск по фамилии</label>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8" value={smsQ} onChange={(e) => setSmsQ(e.target.value)}
                    placeholder="Фамилия" data-testid="input-sms-search"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Участок</label>
                <Select value={smsObject} onValueChange={setSmsObject}>
                  <SelectTrigger data-testid="filter-sms-object"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все участки</SelectItem>
                    {objects.map((o: any) => (
                      <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Канал отправки</label>
                <Select value={smsChannel} onValueChange={setSmsChannel}>
                  <SelectTrigger data-testid="filter-sms-channel"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Сначала MAX, иначе СМС</SelectItem>
                    <SelectItem value="max">Только MAX</SelectItem>
                    <SelectItem value="sms">Только СМС</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <Button
                  size="sm" variant="outline"
                  onClick={() => setSmsPicked(smsRows
                    .filter((r: any) => rowPhoneOk(r) || r.maxLinked)
                    .map((r: any) => r.employeeId))}
                  data-testid="button-sms-pick-all"
                >
                  Отметить всех в списке
                </Button>
                <Button
                  size="sm" variant="ghost" onClick={() => setSmsPicked([])}
                  disabled={!smsPicked.length} data-testid="button-sms-pick-none"
                >
                  Снять отметки
                </Button>
              </div>
            </div>

            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Свой текст для этой отправки (если пусто — берётся шаблон выше)
              </label>
              <Textarea
                rows={2} value={smsOwnText} onChange={(e) => setSmsOwnText(e.target.value)}
                placeholder="Например: ПБК: заезд перенесён на {дата}, {участок}. Явка по графику"
                data-testid="input-sms-own-text"
              />
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Дополнительные номера через запятую (без привязки к сотруднику)
                  </label>
                  <Input
                    value={smsExtra} onChange={(e) => setSmsExtra(e.target.value)}
                    placeholder="+7 913 000-00-00, +7 923 111-22-33"
                    data-testid="input-sms-extra"
                  />
                </div>
                <div className="flex items-end gap-2 pb-1">
                  <Checkbox
                    checked={smsSavePhones}
                    onCheckedChange={(v: any) => setSmsSavePhones(!!v)}
                    data-testid="check-sms-save-phones"
                  />
                  <span className="text-xs text-muted-foreground">
                    Сохранять введённые вручную номера в карточки сотрудников
                  </span>
                </div>
              </div>
              {smsOwnText.trim() && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Символов {nf([...smsOwnText].length)} · частей в сообщении примерно{" "}
                  {nf([...smsOwnText].length <= 70 ? 1 : Math.ceil([...smsOwnText].length / 67))}
                </div>
              )}
            </div>

            {smsRecipients.isLoading ? <Loading rows={4} /> : smsRows.length === 0 ? (
              <Empty text="Никого не нашли. Измените поиск или участок." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-sms-recipients">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="w-8 py-2 pr-2" />
                      <th className="py-2 pr-3 font-medium">Сотрудник</th>
                      <th className="py-2 pr-3 font-medium">Участок</th>
                      <th className="py-2 pr-3 font-medium">Телефон</th>
                      <th className="py-2 pr-3 font-medium">Ближайшая вахта</th>
                      <th className="py-2 pr-3 font-medium">Последняя отправка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {smsRows.map((r: any) => (
                      <tr
                        key={r.employeeId}
                        className="border-b hover:bg-muted/50"
                        data-testid={`sms-pick-row-${r.employeeId}`}
                      >
                        <td className="py-2 pr-2">
                          <Checkbox
                            checked={smsPicked.includes(r.employeeId)}
                            disabled={!rowPhoneOk(r) && !r.maxLinked}
                            onCheckedChange={() => togglePicked(r.employeeId)}
                            data-testid={`sms-check-${r.employeeId}`}
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <div className="font-medium">{r.fio}</div>
                          <div className="text-xs text-muted-foreground">{r.position}</div>
                        </td>
                        <td className="py-2 pr-3">{r.object || "—"}</td>
                        <td className="py-2 pr-3">
                          {r.maxLinked && (
                            <Badge variant="outline" className="mr-2 border-emerald-500 text-[11px] text-emerald-600">
                              <Link2 className="mr-1 h-3 w-3" />
                              MAX
                            </Badge>
                          )}
                          {r.phoneOk ? (
                            <span className="num">{r.phone}</span>
                          ) : (
                            <Input
                              value={smsPhones[r.employeeId] ?? ""}
                              onChange={(e) => setSmsPhones({ ...smsPhones, [r.employeeId]: e.target.value })}
                              placeholder="введите номер"
                              className={cn("h-8 w-40", smsPhones[r.employeeId] && !phoneOk(smsPhones[r.employeeId]) && "border-amber-500")}
                              data-testid={`input-sms-phone-${r.employeeId}`}
                            />
                          )}
                        </td>
                        <td className="num py-2 pr-3 whitespace-nowrap">
                          {r.shiftStart
                            ? `${ruDate(r.shiftStart)} — ${ruDate(r.shiftEnd)}`
                            : <span className="text-xs text-muted-foreground">не назначена</span>}
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">
                          {r.lastSentAt
                            ? `${String(r.lastSentAt).slice(8, 10)}.${String(r.lastSentAt).slice(5, 7)} ${String(r.lastSentAt).slice(11, 16)}`
                            : "не отправляли"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

        </>
      )}

      {tab === "chat" && (
        <>
          <Section
            title="Переписка через бота MAX"
            description="Слева — люди, справа — история сообщений. Пишите прямо здесь, человек получит сообщение в MAX."
            actions={
              <Button
                size="sm" variant="outline" onClick={() => pollMax.mutate()}
                disabled={pollMax.isPending} data-testid="button-chat-refresh"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Обновить
              </Button>
            }
          >
            <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
              <div className="max-h-[60vh] overflow-auto rounded-md border" data-testid="list-chats">
                {(maxChats.data?.rows ?? []).length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">
                    Переписки пока нет. Она появится, как только сотрудник ответит боту.
                  </div>
                ) : (maxChats.data?.rows ?? []).map((c: any) => (
                  <button
                    key={c.employeeId}
                    onClick={() => {
                      setChatWith(c.employeeId);
                      if (c.unread > 0) markSeen.mutate(c.employeeId);
                    }}
                    className={cn("w-full border-b p-3 text-left last:border-0 hover:bg-muted/60",
                      chatWith === c.employeeId && "bg-muted")}
                    data-testid={`chat-item-${c.employeeId}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{c.fio}</span>
                      {c.unread > 0 && (
                        <Badge variant="destructive" className="px-1.5 text-[10px]">{c.unread}</Badge>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {c.lastKind === "outgoing" ? "вы: " : ""}{c.lastText}
                    </div>
                  </button>
                ))}
              </div>

              <div className="rounded-md border">
                {!chatWith ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    Выберите человека слева, чтобы открыть переписку.
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
                      <div>
                        <div className="font-medium" data-testid="text-chat-fio">{maxChat.data?.fio ?? ""}</div>
                        <div className="text-xs text-muted-foreground">
                          {maxChat.data?.position ?? ""}{maxChat.data?.phone ? ` · ${maxChat.data.phone}` : ""}
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn("text-[11px]", maxChat.data?.linked
                          ? "border-emerald-500 text-emerald-600" : "border-amber-500 text-amber-600")}
                      >
                        {maxChat.data?.linked ? "бот привязан" : "бот не привязан"}
                      </Badge>
                    </div>

                    <div className="max-h-[48vh] space-y-2 overflow-auto p-3" data-testid="list-chat-messages">
                      {(maxChat.data?.messages ?? []).length === 0 ? (
                        <div className="text-sm text-muted-foreground">Сообщений пока нет.</div>
                      ) : (maxChat.data?.messages ?? []).map((msg: any) => {
                        const mine = msg.kind === "outgoing";
                        const label =
                          msg.kind === "confirm" ? "подтвердил заезд" :
                          msg.kind === "decline" ? "отказался от заезда" :
                          msg.kind === "reason" ? "причина отказа" : "";
                        return (
                          <div
                            key={msg.id}
                            className={cn("flex", mine ? "justify-end" : "justify-start")}
                            data-testid={`chat-msg-${msg.id}`}
                          >
                            <div
                              className={cn("max-w-[80%] rounded-lg px-3 py-2 text-sm",
                                mine ? "bg-primary text-primary-foreground" : "bg-muted",
                                msg.kind === "decline" && "border border-rose-400",
                                msg.kind === "confirm" && "border border-emerald-400")}
                            >
                              {label && (
                                <div className={cn("mb-1 text-[11px] font-medium",
                                  mine ? "text-primary-foreground/80" : "text-muted-foreground")}>
                                  {label}
                                </div>
                              )}
                              <div className="whitespace-pre-wrap">{msg.text}</div>
                              <div className={cn("mt-1 text-[10px]",
                                mine ? "text-primary-foreground/70" : "text-muted-foreground")}>
                                {String(msg.createdAt).slice(8, 10)}.{String(msg.createdAt).slice(5, 7)}
                                {" "}{String(msg.createdAt).slice(11, 16)}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="border-t p-3">
                      <Textarea
                        rows={2} value={replyText} onChange={(e) => setReplyText(e.target.value)}
                        placeholder={maxChat.data?.linked
                          ? "Сообщение уйдёт в MAX этому человеку"
                          : "Человек не привязал бота — сообщение отправить нельзя"}
                        disabled={!maxChat.data?.linked}
                        data-testid="input-chat-text"
                      />
                      <div className="mt-2 flex justify-end">
                        <Button
                          size="sm"
                          onClick={() => sendReply.mutate({ employeeId: chatWith, text: replyText })}
                          disabled={!replyText.trim() || !maxChat.data?.linked || sendReply.isPending}
                          data-testid="button-chat-send"
                        >
                          <Send className="mr-2 h-4 w-4" />
                          Отправить
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </Section>

          <Section
            title="Ответы сотрудников из MAX"
            description="Нажатия кнопок «Подтверждаю» и «Не смогу», а также обычные сообщения в чате с ботом. Обновляется само."
            actions={
              <Button
                size="sm" variant="outline" onClick={() => pollMax.mutate()}
                disabled={pollMax.isPending} data-testid="button-max-refresh-inbox"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Проверить сейчас
              </Button>
            }
          >
            {maxInbox.isLoading ? <Loading rows={3} /> : (maxInbox.data?.rows ?? []).length === 0 ? (
              <Empty text="Ответов пока нет. Они появятся, как только сотрудники начнут отвечать боту." />
            ) : (
              <div className="space-y-2" data-testid="list-max-inbox">
                {(maxInbox.data?.rows ?? []).map((r: any) => (
                  <div
                    key={r.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3"
                    data-testid={`max-inbox-${r.id}`}
                  >
                    <div className="num w-24 shrink-0 text-xs text-muted-foreground">
                      {String(r.createdAt).slice(8, 10)}.{String(r.createdAt).slice(5, 7)}
                      {" "}{String(r.createdAt).slice(11, 16)}
                    </div>
                    <div className="min-w-[160px] flex-1">
                      <div className="font-medium">{r.fio}</div>
                      <div className="text-xs text-muted-foreground">{r.position}</div>
                    </div>
                    <div className="min-w-[200px] flex-[2] text-sm">{r.text}</div>
                    <Badge
                      variant="outline"
                      className={cn("text-[11px]",
                        r.kind === "confirm" && "border-emerald-500 text-emerald-600",
                        r.kind === "decline" && "border-rose-500 text-rose-600")}
                    >
                      {r.kind === "confirm" ? "подтвердил" : r.kind === "decline" ? "отказался"
                        : r.kind === "outgoing" ? "наш ответ" : "сообщение"}
                    </Badge>
                    {r.employeeId > 0 && r.kind !== "outgoing" && (
                      <Button
                        size="sm" variant="outline"
                        onClick={() => { setReplyTo({ id: r.employeeId, fio: r.fio }); setReplyText(""); }}
                        data-testid={`max-reply-${r.id}`}
                      >
                        Ответить
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {replyTo && (
              <div className="mt-3 rounded-md border p-3" data-testid="box-max-reply">
                <div className="mb-2 text-sm font-medium">Ответ для {replyTo.fio}</div>
                <Textarea
                  rows={2} value={replyText} onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Текст ответа в MAX"
                  data-testid="input-max-reply"
                />
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm" onClick={() => sendReply.mutate({ employeeId: replyTo!.id, text: replyText })}
                    disabled={!replyText.trim() || sendReply.isPending}
                    data-testid="button-max-reply-send"
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Отправить
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setReplyTo(null)} data-testid="button-max-reply-cancel">
                    Отмена
                  </Button>
                </div>
              </div>
            )}
          </Section>

        </>
      )}

      {tab === "sms" && (
        <>
          <Section title="Журнал отправок" description="Последние сообщения и ответ шлюза">
            {smsLog.isLoading ? <Loading rows={3} /> : (smsLog.data?.rows ?? []).length === 0 ? (
              <Empty text="Сообщений ещё не было." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-sms-log">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Когда</th>
                      <th className="py-2 pr-3 font-medium">Кому</th>
                      <th className="py-2 pr-3 font-medium">Номер</th>
                      <th className="py-2 pr-3 font-medium">Текст</th>
                      <th className="py-2 pr-3 font-medium">Результат</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(smsLog.data?.rows ?? []).map((l: any) => (
                      <tr key={l.id} className="border-b" data-testid={`sms-log-${l.id}`}>
                        <td className="num py-2 pr-3 whitespace-nowrap">
                          {String(l.createdAt).slice(8, 10)}.{String(l.createdAt).slice(5, 7)}
                          {" "}{String(l.createdAt).slice(11, 16)}
                        </td>
                        <td className="py-2 pr-3">{l.fio || (l.kind === "test" ? "проверка" : "—")}</td>
                        <td className="num py-2 pr-3">{l.phone}</td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">{l.text}</td>
                        <td className="py-2 pr-3">
                          <Badge
                            variant="outline"
                            className={cn("text-[11px]", l.status === "sent"
                              ? "border-emerald-500 text-emerald-600"
                              : "border-rose-500 text-rose-600")}
                          >
                            {l.status === "sent" ? "отправлено" : "ошибка"}
                          </Badge>
                          <div className="mt-1 text-xs text-muted-foreground">{l.response}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}

      {tab === "absence" && (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Kpi
                testId="kpi-abs-vacation" label="В отпуске" value={nf(absCounters.vacation)}
                onClick={() => showAbsence("vacation")}
                active={absKindFilter === "vacation" && absStateFilter === "active"}
              />
              <Kpi
                testId="kpi-abs-sick" label="На больничном" value={nf(absCounters.sick)}
                onClick={() => showAbsence("sick")}
                active={absKindFilter === "sick" && absStateFilter === "active"}
              />
              <Kpi
                testId="kpi-abs-trip" label="В командировке" value={nf(absCounters.trip)}
                onClick={() => showAbsence("trip")}
                active={absKindFilter === "trip" && absStateFilter === "active"}
              />
              <Kpi
                testId="kpi-abs-study" label="На обучении" value={nf(absCounters.study)}
                onClick={() => showAbsence("study")}
                active={absKindFilter === "study" && absStateFilter === "active"}
              />
              <Kpi
                testId="kpi-abs-ending"
                label="Заканчивается в течение 2 дн."
                value={nf(absCounters.endingSoon)}
                level={absCounters.endingSoon > 0 ? "warn" : "ok"}
                onClick={() => showAbsence("all", "endingSoon")}
                active={absStateFilter === "endingSoon"}
              />
            </div>
            <Button size="sm" onClick={openAddAbsence} data-testid="button-add-absence">
              <Plus className="mr-2 h-4 w-4" />
              Добавить запись
            </Button>
          </div>

          <Card className="mb-4 p-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Тип события</label>
              <Select value={absKindFilter} onValueChange={setAbsKindFilter}>
                <SelectTrigger data-testid="filter-absence-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все типы</SelectItem>
                  <SelectItem value="vacation">Отпуск</SelectItem>
                  <SelectItem value="sick">Больничный</SelectItem>
                  <SelectItem value="trip">Командировка</SelectItem>
                  <SelectItem value="study">Обучение</SelectItem>
                  <SelectItem value="between">На межвахте</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Состояние</label>
              <Select value={absStateFilter} onValueChange={(v) => setAbsStateFilter(v as any)}>
                <SelectTrigger data-testid="filter-absence-state"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все записи</SelectItem>
                  <SelectItem value="active">Идут сейчас</SelectItem>
                  <SelectItem value="endingSoon">Заканчиваются в течение 2 дн.</SelectItem>
                  <SelectItem value="upcoming">Запланированные</SelectItem>
                  <SelectItem value="past">Завершённые</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
                      <th className="py-2 pr-3 font-medium">Участок / примечание</th>
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
                          <td
                            className="py-2 pr-3 text-muted-foreground max-w-[220px] truncate"
                            title={objName(ev.destinationObjectId) || ev.destination || ev.note}
                          >
                            {objName(ev.destinationObjectId) || ev.destination || ev.note || "—"}
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
              <div className="grid gap-3 sm:grid-cols-2">
                <Input type="date" value={empForm.medicalExamEndDate} onChange={(e) => setEmpForm({ ...empForm, medicalExamEndDate: e.target.value })} />
                <Select value={empForm.workStatus} onValueChange={(v) => setEmpForm({ ...empForm, workStatus: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{WORK_STATUSES.map((w) => (<SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>))}</SelectContent></Select>
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
              Сотрудников выбрано: {nf(shiftDialog.ids.length)}. Укажите даты заезда и выезда — цикл посчитается сам.
              Открытые отпуск, больничный или межвахта закроются днём до заезда.
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
              <label className="mb-1 block text-xs font-medium">Дата выезда *</label>
              <Input
                type="date"
                value={shiftForm.endDate}
                min={shiftForm.startDate}
                onChange={(e) => setShiftForm({ ...shiftForm, endDate: e.target.value })}
                data-testid="input-end"
              />
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
              <label className="mb-1 block text-xs font-medium">Цикл (расчёт)</label>
              <Input
                value={assignDays ? `${assignDays}/${assignDays} — дней на вахте: ${nf(assignDays)}` : "—"}
                readOnly
                data-testid="text-cycle"
              />
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
                if (!shiftForm.startDate || !shiftForm.endDate) return setShiftError("Укажите даты заезда и выезда.");
                if (shiftForm.endDate < shiftForm.startDate) return setShiftError("Дата выезда раньше даты заезда.");
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

      {/* ---------- Диалог фактических дат вахты ---------- */}
      <Dialog
        open={shiftEditDialog.open}
        onOpenChange={(v) => setShiftEditDialog({ open: v, id: v ? shiftEditDialog.id : null, fio: v ? shiftEditDialog.fio : "" })}
      >
        <DialogContent className="max-w-md" data-testid="dialog-edit-shift">
          <DialogHeader>
            <DialogTitle>Фактические даты вахты</DialogTitle>
            <DialogDescription>
              {shiftEditDialog.fio} — укажите реальные даты заезда и выезда — они участвуют в расчёте дней и календаре вахт.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Дата заезда *</label>
              <Input
                type="date"
                value={shiftEditForm.startDate}
                onChange={(e) => setShiftEditForm({ ...shiftEditForm, startDate: e.target.value })}
                data-testid="input-edit-shift-start"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Дата выезда *</label>
              <Input
                type="date"
                value={shiftEditForm.endDate}
                onChange={(e) => setShiftEditForm({ ...shiftEditForm, endDate: e.target.value })}
                data-testid="input-edit-shift-end"
              />
            </div>
          </div>
          {shiftEditError && <div className="mt-2"><ErrorBox text={shiftEditError} /></div>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShiftEditDialog({ open: false, id: null, fio: "" })} data-testid="button-cancel-edit-shift">
              Отмена
            </Button>
            <Button
              onClick={() => {
                setShiftEditError("");
                if (!shiftEditForm.startDate || !shiftEditForm.endDate) return setShiftEditError("Укажите обе даты.");
                if (shiftEditForm.endDate < shiftEditForm.startDate) return setShiftEditError("Дата выезда раньше даты заезда.");
                saveShiftDates.mutate();
              }}
              disabled={saveShiftDates.isPending}
              data-testid="button-save-edit-shift"
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Диалог аналитики по сотруднику ---------- */}
      <Dialog open={tsDialog.open} onOpenChange={(v) => setTsDialog({ open: v, id: v ? tsDialog.id : null })}>
        <DialogContent className="max-w-4xl" data-testid="dialog-employee-analytics">
          <DialogHeader>
            <DialogTitle>
              Аналитика по сотруднику{timesheet.data?.fio ? `: ${timesheet.data.fio}` : ""}
            </DialogTitle>
            <DialogDescription>
              Дни по месяцам и за год. Один день относится только к одному состоянию, будущие дни не считаются.
            </DialogDescription>
          </DialogHeader>
          <div className="mb-2 w-32">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Год</label>
            <Select value={tsYear} onValueChange={setTsYear}>
              <SelectTrigger data-testid="select-timesheet-year"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {timesheet.isLoading ? (
            <Loading rows={4} />
          ) : timesheet.error ? (
            <ErrorBox text="Не удалось посчитать аналитику по сотруднику." />
          ) : timesheet.data ? (
            <div className="sticky-head max-h-[55vh] overflow-auto">
              <table className="w-full text-sm" data-testid="table-timesheet">
                <thead>
                  <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-2 font-medium">Месяц</th>
                    {HR_STATE_ORDER.map((s) => (
                      <th key={s} className="py-2 pr-2 text-right font-medium">{HR_STATE_LABELS[s]}</th>
                    ))}
                    <th className="py-2 text-right font-medium">Всего</th>
                  </tr>
                </thead>
                <tbody>
                  {(timesheet.data.months ?? []).map((m: any) => (
                    <tr key={m.month} className="border-b last:border-0" data-testid={`row-timesheet-${m.month}`}>
                      <td className="py-2 pr-2 whitespace-nowrap">{m.label}</td>
                      {HR_STATE_ORDER.map((s) => (
                        <td key={s} className={cn("num py-2 pr-2 text-right", !m[s] && "text-muted-foreground")}>{nf(m[s] ?? 0)}</td>
                      ))}
                      <td className="num py-2 text-right">{nf(m.days ?? 0)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 font-medium" data-testid="row-timesheet-total">
                    <td className="py-2 pr-2 whitespace-nowrap">Итого за {timesheet.data.year}</td>
                    {HR_STATE_ORDER.map((s) => (
                      <td key={s} className="num py-2 pr-2 text-right">{nf(timesheet.data.total?.[s] ?? 0)}</td>
                    ))}
                    <td className="num py-2 text-right">{nf(timesheet.data.total?.days ?? 0)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTsDialog({ open: false, id: null })} data-testid="button-close-analytics">
              Закрыть
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
                  <SelectItem value="between">На межвахте</SelectItem>
                  <SelectItem value="office">Работа в офисе (в выходной)</SelectItem>
                  <SelectItem value="pp">Работа на ПП (в выходной)</SelectItem>
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
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Участок командировки *</label>
                <Select
                  value={absForm.destinationObjectId}
                  onValueChange={(v) => setAbsForm({ ...absForm, destinationObjectId: v })}
                >
                  <SelectTrigger data-testid="select-absence-destination-object">
                    <SelectValue placeholder="Выберите участок" />
                  </SelectTrigger>
                  <SelectContent>
                    {objects.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                    <SelectItem value={OTHER_PLACE}>Другое место…</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Участок берётся из справочника объектов — при переименовании участка запись останется верной.
                </p>
                {absForm.destinationObjectId === OTHER_PLACE && (
                  <Input
                    className="mt-2"
                    value={absForm.destination}
                    onChange={(e) => setAbsForm({ ...absForm, destination: e.target.value })}
                    placeholder="Например: Красноярск, база снабжения"
                    data-testid="input-absence-destination"
                  />
                )}
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
                if (absForm.kind === "trip") {
                  if (absForm.destinationObjectId === NO_OBJECT)
                    return setAbsError("Выберите участок командировки из справочника.");
                  if (absForm.destinationObjectId === OTHER_PLACE && !absForm.destination.trim())
                    return setAbsError("Укажите, куда направлен сотрудник.");
                }
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
