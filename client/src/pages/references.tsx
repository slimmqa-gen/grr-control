import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Plus, Pencil, Trash2, Wand2, Building2, Drill, Users, Truck, Wallet, Package, FlaskConical, TestTubes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useRefBook } from "@/lib/hooks";
import { PageHeader, Section, Empty, Loading, ErrorBox, TableWrap } from "@/components/shell";
import { nf, ruDate, levelBadge } from "@/lib/app";
import { cn } from "@/lib/utils";

type Field = {
  key: string;
  label: string;
  kind?: "text" | "number" | "date" | "select";
  options?: { value: string; label: string }[];
  hint?: string;
  wide?: boolean;
};

type TabKey =
  | "objects" | "rigs" | "positions" | "equipment" | "costItems" | "inventoryItems"
  | "labs" | "analysisTypes";

const TABS: { key: TabKey; label: string; icon: any }[] = [
  { key: "objects", label: "Объекты", icon: Building2 },
  { key: "rigs", label: "Буровые станки", icon: Drill },
  { key: "positions", label: "Должности", icon: Users },
  { key: "equipment", label: "Техника для ГСМ", icon: Truck },
  { key: "costItems", label: "Статьи затрат", icon: Wallet },
  { key: "inventoryItems", label: "Позиции ТМЦ", icon: Package },
  { key: "labs", label: "Лаборатории", icon: FlaskConical },
  { key: "analysisTypes", label: "Виды анализов", icon: TestTubes },
];

const ENDPOINT: Record<TabKey, string> = {
  objects: "/api/ref/objects",
  rigs: "/api/ref/rigs",
  positions: "/api/ref/positions",
  equipment: "/api/ref/equipment",
  costItems: "/api/ref/cost-items",
  inventoryItems: "/api/ref/inventory-items",
  labs: "/api/ref/labs",
  analysisTypes: "/api/ref/analysis-types",
};

const TITLE_ONE: Record<TabKey, string> = {
  objects: "объект",
  rigs: "станок",
  positions: "должность",
  equipment: "технику",
  costItems: "статью затрат",
  inventoryItems: "позицию ТМЦ",
  labs: "лабораторию",
  analysisTypes: "вид анализа",
};

const DESCRIPTION: Record<TabKey, string> = {
  objects:
    "Объект (участок) — основа всех расчётов: план по метрам, выручка по договору и себестоимость считаются по нему.",
  rigs: "Станки нужны, чтобы считать метры на смену и видеть, кто из техники простаивает.",
  positions: "Должности подставляются в карточке сотрудника и при загрузке штата из Excel.",
  equipment: "Техника с нормой расхода топлива — по ней считается перерасход ГСМ.",
  costItems: "Статьи затрат используются при загрузке фактических затрат по объектам.",
  inventoryItems: "Позиции ТМЦ с минимальным запасом — по ним программа предупреждает о нехватке на складе.",
  labs:
    "Лаборатории со сроком исполнения и ценой анализа — по ним считаются сроки выдачи результатов и затраты на анализы.",
  analysisTypes:
    "Виды анализов задают, какие элементы определяются и в каких единицах приходят результаты.",
};

export default function ReferencesPage() {
  const { data, isLoading, error } = useRefBook();
  const { toast } = useToast();
  const [tab, setTab] = useState<TabKey>("objects");
  const [editRow, setEditRow] = useState<any>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [del, setDel] = useState<{ row: any; usage: any } | null>(null);

  const objectOptions = useMemo(
    () => (data?.objects ?? []).map((o: any) => ({ value: String(o.id), label: o.name })),
    [data],
  );

  const FIELDS: Record<TabKey, Field[]> = {
    objects: [
      { key: "name", label: "Название объекта (участка)", wide: true },
      { key: "customer", label: "Заказчик", wide: true },
      { key: "region", label: "Регион" },
      { key: "planMetersMonth", label: "План метров в месяц", kind: "number", hint: "Сравнивается с фактом по рапортам" },
      { key: "pricePerMeter", label: "Цена за метр по договору, ₽", kind: "number" },
      { key: "plannedCostPerMeter", label: "Плановая себестоимость метра, ₽", kind: "number" },
      { key: "contractVolume", label: "Объём по договору, м", kind: "number" },
      { key: "contractEnd", label: "Дата окончания договора", kind: "date" },
      { key: "staffRequired", label: "Штатная численность, чел.", kind: "number" },
    ],
    rigs: [
      { key: "name", label: "Название / номер станка", wide: true },
      { key: "model", label: "Тип (модель)", wide: true },
      { key: "objectId", label: "Объект, где работает", kind: "select", options: objectOptions },
      {
        key: "status", label: "Статус", kind: "select",
        options: (data?.rigStatuses ?? ["в работе", "ремонт", "резерв"]).map((s: string) => ({ value: s, label: s })),
      },
    ],
    positions: [{ key: "name", label: "Название должности", wide: true }],
    equipment: [
      { key: "name", label: "Название техники", wide: true },
      {
        key: "kind", label: "Тип", kind: "select",
        options: (data?.equipmentKinds ?? ["станок", "ДЭС", "автотранспорт"]).map((s: string) => ({ value: s, label: s })),
      },
      { key: "objectId", label: "Объект", kind: "select", options: objectOptions },
      { key: "normLiters", label: "Норма расхода топлива, л/сутки", kind: "number" },
    ],
    costItems: [{ key: "name", label: "Название статьи затрат", wide: true }],
    inventoryItems: [
      { key: "name", label: "Название позиции", wide: true },
      { key: "unit", label: "Единица измерения", hint: "л, шт, компл, кг" },
      { key: "minQty", label: "Минимальный запас", kind: "number" },
    ],
    labs: [
      { key: "name", label: "Название лаборатории", wide: true },
      { key: "city", label: "Город" },
      { key: "leadDays", label: "Срок исполнения по договору, дней", kind: "number", hint: "От этого срока считается ожидаемая дата результата" },
      { key: "pricePerSample", label: "Цена анализа за пробу, ₽", kind: "number" },
      { key: "analyses", label: "Виды анализов", wide: true, hint: "Через запятую" },
    ],
    analysisTypes: [
      { key: "name", label: "Название вида анализа", wide: true },
      { key: "elements", label: "Элементы", wide: true, hint: "Через запятую: Au, Ag, Cu" },
      {
        key: "unit", label: "Единица измерения", kind: "select",
        options: (data?.assayUnits ?? ["г/т", "%", "ppm"]).map((s: string) => ({ value: s, label: s })),
      },
    ],
  };

  const objName = (id: number) => data?.objects?.find((o: any) => o.id === id)?.name ?? "—";

  const rows: any[] = data?.[tab] ?? [];
  const fields = FIELDS[tab];

  const openCreate = () => {
    const init: Record<string, string> = {};
    fields.forEach((f) => {
      if (f.kind === "select") init[f.key] = f.options?.[0]?.value ?? "";
      else if (f.kind === "number") init[f.key] = "0";
      else init[f.key] = "";
    });
    if (tab === "inventoryItems") init.unit = "шт";
    setForm(init);
    setFormError("");
    setEditRow({ __new: true });
  };

  const openEdit = (row: any) => {
    const init: Record<string, string> = {};
    fields.forEach((f) => (init[f.key] = row[f.key] === null || row[f.key] === undefined ? "" : String(row[f.key])));
    setForm(init);
    setFormError("");
    setEditRow(row);
  };

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, any> = {};
      fields.forEach((f) => {
        body[f.key] = f.kind === "number" || f.key === "objectId" ? Number(form[f.key] || 0) : form[f.key] ?? "";
      });
      const isNew = editRow?.__new;
      const url = isNew ? ENDPOINT[tab] : `${ENDPOINT[tab]}/${editRow.id}`;
      const res = await apiRequest(isNew ? "POST" : "PATCH", url, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setEditRow(null);
      toast({ title: "Сохранено", description: "Справочник обновлён, расчёты пересчитаны." });
    },
    onError: (e: any) => setFormError(e.message || "Не удалось сохранить"),
  });

  const askDelete = async (row: any) => {
    if (["objects", "rigs", "positions", "labs", "analysisTypes"].includes(tab)) {
      const res = await apiRequest("GET", `${ENDPOINT[tab]}/${row.id}/usage`);
      setDel({ row, usage: await res.json() });
    } else {
      setDel({ row, usage: null });
    }
  };

  const doDelete = useMutation({
    mutationFn: async (cascade: boolean) => {
      const res = await apiRequest(
        "DELETE",
        `${ENDPOINT[tab]}/${del!.row.id}${cascade ? "?cascade=1" : ""}`,
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setDel(null);
      toast({ title: "Удалено", description: "Запись удалена из справочника." });
    },
    onError: (e: any) => {
      setDel(null);
      toast({ title: "Не удалось удалить", description: e.message, variant: "destructive" });
    },
  });

  if (isLoading) return <Loading rows={4} />;
  if (error || !data) return <ErrorBox text="Не удалось загрузить справочники. Обновите страницу." />;

  const usageTotal = del?.usage
    ? Object.values(del.usage).reduce((s: number, v: any) => s + Number(v || 0), 0)
    : 0;

  const usageText = () => {
    if (!del?.usage) return "";
    const u = del.usage;
    const parts: string[] = [];
    if (u.reports) parts.push(`${nf(u.reports)} рапортов`);
    if (u.costs) parts.push(`${nf(u.costs)} записей затрат`);
    if (u.fuel) parts.push(`${nf(u.fuel)} записей ГСМ`);
    if (u.inventory) parts.push(`${nf(u.inventory)} позиций ТМЦ`);
    if (u.employees) parts.push(`${nf(u.employees)} сотрудников`);
    if (u.shifts) parts.push(`${nf(u.shifts)} вахт`);
    if (u.rigs) parts.push(`${nf(u.rigs)} станков`);

    if (u.batches) parts.push(`${nf(u.batches)} партий в лабораторию`);
    return parts.join(", ");
  };

  return (
    <>
      <PageHeader
        title="Справочники"
        subtitle="Заполните структуру своей организации: объекты, станки, должности, техника, статьи затрат и ТМЦ. Всё остальное в программе считается по этим данным."
        actions={
          <Link href="/setup">
            <Button variant="outline" size="sm" data-testid="button-goto-setup">
              <Wand2 className="mr-2 h-4 w-4" />
              Мастер настройки
            </Button>
          </Link>
        }
      />

      {/* Вкладки справочников */}
      <div className="mb-4 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const count = (data?.[t.key] ?? []).length;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              data-testid={`tab-${t.key}`}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors sm:text-sm",
                tab === t.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-accent",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="whitespace-nowrap">{t.label}</span>
              <span className={cn("num rounded px-1.5 text-[11px]", tab === t.key ? "bg-white/20" : "bg-muted")}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <Section
        title={TABS.find((t) => t.key === tab)!.label}
        description={DESCRIPTION[tab]}
        actions={
          <Button size="sm" onClick={openCreate} data-testid={`button-add-${tab}`}>
            <Plus className="mr-2 h-4 w-4" />
            Добавить
          </Button>
        }
      >
        {rows.length === 0 ? (
          <Empty text={`Пока пусто. Нажмите «Добавить», чтобы завести ${TITLE_ONE[tab]}.`} />
        ) : (
          <TableWrap maxH="70vh">
            <table className="w-full min-w-[560px] text-sm" data-testid={`table-${tab}`}>
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  {fields.map((f) => (
                    <th key={f.key} className="py-2 pr-3 font-medium">{f.label}</th>
                  ))}
                  <th className="py-2 text-right font-medium">Действия</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0" data-testid={`row-${tab}-${row.id}`}>
                    {fields.map((f) => (
                      <td key={f.key} className="py-2 pr-3 align-top">
                        {f.key === "objectId" ? (
                          objName(row.objectId)
                        ) : f.key === "status" ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              "border text-[11px]",
                              row.status === "в работе" ? levelBadge.ok : row.status === "ремонт" ? levelBadge.bad : levelBadge.warn,
                            )}
                          >
                            {row.status}
                          </Badge>
                        ) : f.kind === "number" ? (
                          <span className="num">{nf(Number(row[f.key] ?? 0), Number(row[f.key]) % 1 ? 1 : 0)}</span>
                        ) : f.kind === "date" ? (
                          row[f.key] ? ruDate(row[f.key]) : "—"
                        ) : (
                          row[f.key] || "—"
                        )}
                      </td>
                    ))}
                    <td className="py-2 text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(row)}
                        data-testid={`button-edit-${tab}-${row.id}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span className="sr-only">Изменить</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => askDelete(row)}
                        data-testid={`button-delete-${tab}-${row.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                        <span className="sr-only">Удалить</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      {/* Диалог добавления / изменения */}
      <Dialog open={!!editRow} onOpenChange={(v) => !v && setEditRow(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="dialog-ref-form">
          <DialogHeader>
            <DialogTitle>
              {editRow?.__new ? `Добавить ${TITLE_ONE[tab]}` : `Изменить: ${editRow?.name ?? ""}`}
            </DialogTitle>
            <DialogDescription>{DESCRIPTION[tab]}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.key} className={f.wide ? "sm:col-span-2" : ""}>
                <label className="mb-1 block text-xs font-medium">{f.label}</label>
                {f.kind === "select" ? (
                  <Select
                    value={form[f.key] ?? ""}
                    onValueChange={(v) => setForm({ ...form, [f.key]: v })}
                  >
                    <SelectTrigger data-testid={`select-${tab}-${f.key}`}>
                      <SelectValue placeholder="Выберите" />
                    </SelectTrigger>
                    <SelectContent>
                      {(f.options ?? []).length === 0 ? (
                        <SelectItem value="0" disabled>Сначала заведите объект</SelectItem>
                      ) : (
                        f.options!.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type={f.kind === "date" ? "date" : "text"}
                    inputMode={f.kind === "number" ? "decimal" : undefined}
                    value={form[f.key] ?? ""}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    data-testid={`input-${tab}-${f.key}`}
                  />
                )}
                {f.hint && <p className="mt-1 text-xs text-muted-foreground">{f.hint}</p>}
              </div>
            ))}
          </div>
          {formError && <ErrorBox text={formError} />}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEditRow(null)} data-testid="button-cancel-ref">
              Отмена
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-ref">
              {save.isPending ? "Сохраняем…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог удаления с защитой */}
      <Dialog open={!!del} onOpenChange={(v) => !v && setDel(null)}>
        <DialogContent className="max-w-md" data-testid="dialog-ref-delete">
          <DialogHeader>
            <DialogTitle>Удалить «{del?.row?.name}»?</DialogTitle>
            <DialogDescription>
              {usageTotal > 0
                ? `По этому элементу есть ${usageText()}. Удалить вместе с ними? Данные пропадут из всех отчётов и графиков.`
                : "Связанных данных нет — запись можно удалить безопасно."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDel(null)} data-testid="button-cancel-delete">
              Отмена
            </Button>
            {usageTotal > 0 ? (
              <Button
                variant="destructive"
                onClick={() => doDelete.mutate(true)}
                disabled={doDelete.isPending}
                data-testid="button-confirm-delete-cascade"
              >
                Удалить вместе с данными
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={() => doDelete.mutate(false)}
                disabled={doDelete.isPending}
                data-testid="button-confirm-delete"
              >
                Удалить
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
