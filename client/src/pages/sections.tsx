import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDown, ArrowUp, Eraser, Lock, Plus, RotateCcw, Trash2, Wand2, X, Download,
  ChevronDown, ChevronRight, EyeOff, Info,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Section, Loading, ErrorBox, Empty } from "@/components/shell";
import { downloadFile } from "@/lib/app";
import { useAuth } from "@/lib/auth";

type Cfg = {
  groups: { key: string; title: string; order: number; collapsed: boolean }[];
  items: Record<string, { title: string; visible: boolean; order: number; group: string; roles: string[] }>;
  preset: string;
};
type Catalog = {
  key: string; defaultTitle: string; href: string; icon: string;
  locked: boolean; noMenu: boolean; clearable: boolean; clearHint: string; exportKey: string;
};
type CustomSec = {
  id: number; key: string; title: string; descr: string; group: string;
  visible: boolean; order: number; roles: string[];
  columns: { key: string; label: string; type: string; options?: string[]; required?: boolean }[];
};
type Payload = {
  config: Cfg; catalog: Catalog[]; custom: CustomSec[]; counts: Record<string, number>;
  presets: { key: string; title: string; hint: string }[];
  roles: { key: string; label: string }[];
  lockedKeys: string[];
  colTypes: Record<string, string>;
};

const COL_TYPES = [
  { key: "text", label: "Текст" },
  { key: "number", label: "Число" },
  { key: "date", label: "Дата" },
  { key: "list", label: "Список значений" },
  { key: "bool", label: "Да / нет" },
];

export default function SectionsManager() {
  const { data, isLoading, error } = useQuery<Payload>({ queryKey: ["/api/sections/config"] });
  const { toast } = useToast();
  const { refresh } = useAuth();
  const [clearKey, setClearKey] = useState("");
  const [clearWord, setClearWord] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [foldGroups, setFoldGroups] = useState<Record<string, boolean>>({});

  const after = async (title: string, description?: string) => {
    await refresh();
    queryClient.invalidateQueries();
    toast({ title, description });
  };

  const patch = useMutation({
    mutationFn: async (body: any) => (await apiRequest("PUT", "/api/sections/config", body)).json(),
    onSuccess: () => after("Состав программы обновлён", "Изменения применились сразу, без пересборки."),
    onError: (e: any) => toast({ title: "Не удалось сохранить", description: e.message, variant: "destructive" }),
  });

  const preset = useMutation({
    mutationFn: async (key: string) => (await apiRequest("POST", "/api/sections/preset", { preset: key })).json(),
    onSuccess: () => after("Набор разделов применён", "Меню и доступы пересчитаны."),
    onError: (e: any) => toast({ title: "Не удалось применить набор", description: e.message, variant: "destructive" }),
  });

  const reset = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/sections/reset")).json(),
    onSuccess: () => after("Возвращены настройки по умолчанию", "Видны все разделы, названия и группы исходные."),
    onError: (e: any) => toast({ title: "Не удалось сбросить", description: e.message, variant: "destructive" }),
  });

  const clear = useMutation({
    mutationFn: async (v: { key: string; confirm: string }) =>
      (await apiRequest("POST", "/api/sections/clear", v)).json(),
    onSuccess: (r: any) => {
      setClearKey(""); setClearWord("");
      after("Данные раздела удалены", `${r.section}: удалено записей ${r.total}. Справочники не тронуты.`);
    },
    onError: (e: any) => toast({ title: "Очистка не выполнена", description: e.message, variant: "destructive" }),
  });

  const patchCustom = useMutation({
    mutationFn: async (v: { key: string; body: any }) =>
      (await apiRequest("PATCH", `/api/sections/custom/${v.key}`, v.body)).json(),
    onSuccess: () => after("Пользовательский раздел обновлён"),
    onError: (e: any) => toast({ title: "Не удалось сохранить", description: e.message, variant: "destructive" }),
  });

  const dropCustom = useMutation({
    mutationFn: async (key: string) => (await apiRequest("DELETE", `/api/sections/custom/${key}`)).json(),
    onSuccess: () => after("Раздел удалён", "Вместе с его записями."),
    onError: (e: any) => toast({ title: "Не удалось удалить", description: e.message, variant: "destructive" }),
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const list = data.catalog.map((c) => ({
      kind: "std" as const, key: c.key, catalog: c,
      it: data.config.items[c.key],
      count: data.counts[c.key] ?? 0,
    }));
    const cust = data.custom.map((c) => ({
      kind: "custom" as const, key: `custom:${c.key}`, custom: c,
      count: data.counts[`custom:${c.key}`] ?? 0,
    }));
    return [...list, ...cust];
  }, [data]);

  if (isLoading) return <Loading rows={6} />;
  if (error) return <ErrorBox text={(error as any).message} />;
  if (!data) return <Empty text="Нет данных о составе программы" />;

  const groups = [...data.config.groups].sort((a, b) => a.order - b.order);
  const groupTitle = (k: string) => groups.find((g) => g.key === k)?.title ?? k;

  /** Порядок внутри группы: меняем местами соседние разделы */
  const move = (key: string, dir: -1 | 1) => {
    const row = rows.find((r) => r.key === key)!;
    const gkey = row.kind === "std" ? row.it.group : row.custom.group;
    const inGroup = rows
      .filter((r) => (r.kind === "std" ? r.it.group : r.custom.group) === gkey)
      .sort((a, b) => (a.kind === "std" ? a.it.order : a.custom.order) - (b.kind === "std" ? b.it.order : b.custom.order));
    const i = inGroup.findIndex((r) => r.key === key);
    const j = i + dir;
    if (j < 0 || j >= inGroup.length) return;
    const a = inGroup[i]; const b = inGroup[j];
    const ao = a.kind === "std" ? a.it.order : a.custom.order;
    const bo = b.kind === "std" ? b.it.order : b.custom.order;
    const items: any = {};
    if (a.kind === "std") items[a.key] = { order: bo }; else patchCustom.mutate({ key: a.custom.key, body: { order: bo } });
    if (b.kind === "std") items[b.key] = { order: ao }; else patchCustom.mutate({ key: b.custom.key, body: { order: ao } });
    if (Object.keys(items).length) patch.mutate({ items });
  };

  const moveGroup = (key: string, dir: -1 | 1) => {
    const i = groups.findIndex((g) => g.key === key);
    const j = i + dir;
    if (j < 0 || j >= groups.length) return;
    patch.mutate({
      groups: [{ key: groups[i].key, order: groups[j].order }, { key: groups[j].key, order: groups[i].order }],
    });
  };

  const clearRow = rows.find((r) => r.key === clearKey);
  const clearTitle = clearRow
    ? clearRow.kind === "std" ? clearRow.it.title : clearRow.custom.title
    : "";
  const clearHint = clearRow
    ? clearRow.kind === "std" ? clearRow.catalog.clearHint : "Все записи журнала этого раздела."
    : "";
  const exportKey = clearRow && clearRow.kind === "std" ? clearRow.catalog.exportKey : "";

  return (
    <div className="space-y-4">
      {/* Пояснение и наборы */}
      <Section
        title="Готовые наборы разделов"
        description="Одна кнопка меняет состав программы. Данные скрытых разделов сохраняются и возвращаются вместе с разделом."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {data.presets.map((p) => (
            <Card key={p.key} className="flex flex-col gap-2 p-3">
              <div className="text-sm font-semibold">{p.title}</div>
              <div className="flex-1 text-xs text-muted-foreground">{p.hint}</div>
              <Button
                size="sm"
                variant={data.config.preset === p.key ? "default" : "outline"}
                onClick={() => preset.mutate(p.key)}
                disabled={preset.isPending}
                data-testid={`button-preset-${p.key}`}
              >
                <Wand2 className="mr-2 h-3.5 w-3.5" />
                {data.config.preset === p.key ? "Применён" : "Применить"}
              </Button>
            </Card>
          ))}
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-xs text-muted-foreground" data-testid="text-hide-note">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Скрытые данные не удаляются: раздел исчезает из меню и закрывается по API, но все записи
            остаются в базе и появятся снова, когда раздел включат.
          </p>
          <Button
            size="sm" variant="outline" onClick={() => reset.mutate()} disabled={reset.isPending}
            data-testid="button-sections-reset"
          >
            <RotateCcw className="mr-2 h-3.5 w-3.5" /> Вернуть настройки по умолчанию
          </Button>
        </div>
      </Section>

      {/* Группы меню */}
      <Section title="Группы меню" description="Переименуйте, сверните или поменяйте порядок групп — меню станет компактнее.">
        <div className="space-y-2">
          {groups.map((g, i) => (
            <div key={g.key} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
              <Input
                defaultValue={g.title}
                className="h-8 w-44"
                data-testid={`input-group-title-${g.key}`}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== g.title) patch.mutate({ groups: [{ key: g.key, title: v }] });
                }}
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={g.collapsed}
                  onCheckedChange={(v) => patch.mutate({ groups: [{ key: g.key, collapsed: v }] })}
                  data-testid={`switch-group-collapsed-${g.key}`}
                />
                свёрнута по умолчанию
              </label>
              <div className="ml-auto flex gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === 0}
                  onClick={() => moveGroup(g.key, -1)} data-testid={`button-group-up-${g.key}`}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === groups.length - 1}
                  onClick={() => moveGroup(g.key, 1)} data-testid={`button-group-down-${g.key}`}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Разделы */}
      <Section
        title="Все разделы программы"
        description="Показ и скрытие, название в меню, группа, порядок, роли и очистка данных раздела."
        actions={
          <Button size="sm" onClick={() => setNewOpen(true)} data-testid="button-custom-new">
            <Plus className="mr-2 h-3.5 w-3.5" /> Свой раздел
          </Button>
        }
      >
        <div className="space-y-3">
          {groups.map((g) => {
            const inGroup = rows
              .filter((r) => (r.kind === "std" ? r.it.group : r.custom.group) === g.key)
              .sort((a, b) => (a.kind === "std" ? a.it.order : a.custom.order) - (b.kind === "std" ? b.it.order : b.custom.order));
            if (!inGroup.length) return null;
            const folded = !!foldGroups[g.key];
            return (
              <div key={g.key} className="rounded-md border">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  onClick={() => setFoldGroups((p) => ({ ...p, [g.key]: !folded }))}
                  data-testid={`button-fold-${g.key}`}
                >
                  {folded ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {g.title}
                  <span className="ml-auto font-normal normal-case">{inGroup.length} разд.</span>
                </button>
                {!folded && (
                  <div className="divide-y">
                    {inGroup.map((r, i) => {
                      const std = r.kind === "std";
                      const title = std ? r.it.title : r.custom.title;
                      const visible = std ? r.it.visible : r.custom.visible;
                      const roles = std ? r.it.roles : r.custom.roles;
                      const locked = std && r.catalog.locked;
                      const gkey = std ? r.it.group : r.custom.group;
                      const save = (body: any) =>
                        std ? patch.mutate({ items: { [r.key]: body } })
                          : patchCustom.mutate({ key: r.custom.key, body });
                      return (
                        <div key={r.key} className="space-y-2 p-3" data-testid={`row-section-${r.key.replace("custom:", "c-")}`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <Switch
                              checked={visible}
                              disabled={locked}
                              onCheckedChange={(v) => save({ visible: v })}
                              data-testid={`switch-visible-${r.key.replace("custom:", "c-")}`}
                            />
                            <Input
                              defaultValue={title}
                              key={`t-${r.key}-${title}`}
                              className="h-8 w-full sm:w-56"
                              data-testid={`input-title-${r.key.replace("custom:", "c-")}`}
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                if (v && v !== title) save({ title: v });
                              }}
                            />
                            {locked && (
                              <span className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                                data-testid={`badge-locked-${r.key}`}>
                                <Lock className="h-3 w-3" /> нельзя скрыть от директора
                              </span>
                            )}
                            {!visible && !locked && (
                              <span className="flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                                data-testid={`badge-hidden-${r.key.replace("custom:", "c-")}`}>
                                <EyeOff className="h-3 w-3" /> скрыт
                              </span>
                            )}
                            {r.kind === "custom" && (
                              <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] text-primary">свой раздел</span>
                            )}
                            <div className="ml-auto flex items-center gap-1">
                              <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === 0}
                                onClick={() => move(r.key, -1)} data-testid={`button-up-${r.key.replace("custom:", "c-")}`}>
                                <ArrowUp className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === inGroup.length - 1}
                                onClick={() => move(r.key, 1)} data-testid={`button-down-${r.key.replace("custom:", "c-")}`}>
                                <ArrowDown className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <Select value={gkey} onValueChange={(v) => save({ group: v })}>
                              <SelectTrigger className="h-8 w-40" data-testid={`select-group-${r.key.replace("custom:", "c-")}`}>
                                <SelectValue placeholder="Группа меню" />
                              </SelectTrigger>
                              <SelectContent>
                                {groups.map((gg) => (
                                  <SelectItem key={gg.key} value={gg.key}>{gg.title}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="text-muted-foreground">Видят роли:</span>
                              {data.roles.map((role) => {
                                const on = roles.includes(role.key);
                                const forced = locked && role.key === "director";
                                return (
                                  <button
                                    key={role.key}
                                    type="button"
                                    disabled={forced}
                                    onClick={() => save({
                                      roles: on ? roles.filter((x) => x !== role.key) : [...roles, role.key],
                                    })}
                                    data-testid={`chip-role-${r.key.replace("custom:", "c-")}-${role.key}`}
                                    className={
                                      "rounded-full border px-2 py-0.5 " +
                                      (on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground") +
                                      (forced ? " opacity-70" : "")
                                    }
                                  >
                                    {role.label}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="ml-auto flex items-center gap-2">
                              <span className="text-muted-foreground" data-testid={`text-count-${r.key.replace("custom:", "c-")}`}>
                                записей: {r.count}
                              </span>
                              {(r.kind === "custom" || r.catalog.clearable) && (
                                <Button
                                  size="sm" variant="outline" className="h-8"
                                  onClick={() => { setClearKey(r.key); setClearWord(""); }}
                                  data-testid={`button-clear-${r.key.replace("custom:", "c-")}`}
                                >
                                  <Eraser className="mr-1.5 h-3.5 w-3.5" /> Очистить данные раздела
                                </Button>
                              )}
                              {r.kind === "custom" && (
                                <Button
                                  size="sm" variant="ghost" className="h-8 text-destructive"
                                  onClick={() => {
                                    if (confirm(`Удалить раздел «${r.custom.title}» вместе с записями?`))
                                      dropCustom.mutate(r.custom.key);
                                  }}
                                  data-testid={`button-drop-${r.custom.key}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* Очистка данных раздела */}
      <Dialog open={!!clearKey} onOpenChange={(v) => { if (!v) { setClearKey(""); setClearWord(""); } }}>
        <DialogContent data-testid="dialog-clear-section">
          <DialogHeader>
            <DialogTitle>Очистить данные раздела «{clearTitle}»</DialogTitle>
            <DialogDescription>
              Действие необратимо: восстановить записи после очистки нельзя. Справочники (объекты,
              станки, должности, лаборатории) не затрагиваются.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Что будет удалено: {clearHint}
            </div>
            {exportKey && (
              <Button
                size="sm" variant="outline"
                onClick={() => downloadFile(`/api/export/${exportKey}`, `${clearTitle}.xlsx`)}
                data-testid="button-export-before-clear"
              >
                <Download className="mr-2 h-3.5 w-3.5" /> Сначала выгрузить раздел в Excel
              </Button>
            )}
            {clearRow?.kind === "custom" && (
              <Button
                size="sm" variant="outline"
                onClick={() => downloadFile(`/api/custom/${clearRow.custom.key}/export`, `${clearTitle}.xlsx`)}
                data-testid="button-export-before-clear-custom"
              >
                <Download className="mr-2 h-3.5 w-3.5" /> Сначала выгрузить журнал в Excel
              </Button>
            )}
            <div>
              <label className="text-xs text-muted-foreground">Для подтверждения введите слово ОЧИСТИТЬ</label>
              <Input
                value={clearWord}
                onChange={(e) => setClearWord(e.target.value)}
                placeholder="ОЧИСТИТЬ"
                data-testid="input-clear-confirm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setClearKey(""); setClearWord(""); }} data-testid="button-clear-cancel">
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={clearWord.trim().toUpperCase() !== "ОЧИСТИТЬ" || clear.isPending}
              onClick={() => clear.mutate({ key: clearKey, confirm: clearWord.trim().toUpperCase() })}
              data-testid="button-clear-confirm"
            >
              Очистить данные
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewSectionDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        groups={groups}
        roles={data.roles}
        onDone={() => { setNewOpen(false); after("Раздел создан", "Он уже появился в меню — можно вводить записи."); }}
      />
    </div>
  );
}

/* ==================== Создание своего раздела ==================== */

type Col = { label: string; type: string; options: string; required: boolean };

function NewSectionDialog({
  open, onClose, groups, roles, onDone,
}: {
  open: boolean; onClose: () => void;
  groups: { key: string; title: string }[];
  roles: { key: string; label: string }[];
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [descr, setDescr] = useState("");
  const [group, setGroup] = useState("prod");
  const [sel, setSel] = useState<string[]>(["director"]);
  const [cols, setCols] = useState<Col[]>([{ label: "Дата", type: "date", options: "", required: true }]);

  const create = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/sections/custom", {
        title, descr, group, roles: sel,
        columns: cols.map((c) => ({ ...c, options: c.options })),
      })).json(),
    onSuccess: () => {
      setTitle(""); setDescr(""); setCols([{ label: "Дата", type: "date", options: "", required: true }]);
      onDone();
    },
    onError: (e: any) => toast({ title: "Не удалось создать раздел", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" data-testid="dialog-custom-new">
        <DialogHeader>
          <DialogTitle>Свой раздел-журнал</DialogTitle>
          <DialogDescription>
            Задайте название и колонки — программа сама сделает таблицу с формой ввода, фильтрами,
            выгрузкой в Excel и загрузкой из Excel по шаблону.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-xs text-muted-foreground">Название раздела</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="Например: Журнал заявок на материалы" data-testid="input-custom-title" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Группа меню</label>
              <Select value={group} onValueChange={setGroup}>
                <SelectTrigger data-testid="select-custom-group"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {groups.map((g) => <SelectItem key={g.key} value={g.key}>{g.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Пояснение (необязательно)</label>
            <Input value={descr} onChange={(e) => setDescr(e.target.value)}
              placeholder="Кто и что вносит в этот журнал" data-testid="input-custom-descr" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Кому виден раздел</label>
            <div className="mt-1 flex flex-wrap gap-1 text-xs">
              {roles.map((r) => {
                const on = sel.includes(r.key);
                return (
                  <button
                    key={r.key} type="button"
                    onClick={() => setSel(on ? sel.filter((x) => x !== r.key) : [...sel, r.key])}
                    data-testid={`chip-custom-role-${r.key}`}
                    className={"rounded-full border px-2 py-0.5 " + (on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Колонки журнала</span>
              <Button size="sm" variant="outline"
                onClick={() => setCols([...cols, { label: "", type: "text", options: "", required: false }])}
                data-testid="button-custom-add-col">
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Колонка
              </Button>
            </div>
            {cols.map((c, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border p-2">
                <div className="min-w-[9rem] flex-1">
                  <label className="text-[11px] text-muted-foreground">Название колонки</label>
                  <Input value={c.label} className="h-8"
                    onChange={(e) => setCols(cols.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                    data-testid={`input-col-label-${i}`} />
                </div>
                <div className="w-40">
                  <label className="text-[11px] text-muted-foreground">Тип</label>
                  <Select value={c.type}
                    onValueChange={(v) => setCols(cols.map((x, j) => j === i ? { ...x, type: v } : x))}>
                    <SelectTrigger className="h-8" data-testid={`select-col-type-${i}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COL_TYPES.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {c.type === "list" && (
                  <div className="min-w-[10rem] flex-1">
                    <label className="text-[11px] text-muted-foreground">Значения через точку с запятой</label>
                    <Input value={c.options} className="h-8" placeholder="согласовано; отклонено"
                      onChange={(e) => setCols(cols.map((x, j) => j === i ? { ...x, options: e.target.value } : x))}
                      data-testid={`input-col-options-${i}`} />
                  </div>
                )}
                <label className="flex items-center gap-1.5 pb-1.5 text-xs text-muted-foreground">
                  <Switch checked={c.required}
                    onCheckedChange={(v) => setCols(cols.map((x, j) => j === i ? { ...x, required: v } : x))}
                    data-testid={`switch-col-required-${i}`} />
                  обязательно
                </label>
                <Button size="icon" variant="ghost" className="h-8 w-8"
                  onClick={() => setCols(cols.filter((_, j) => j !== i))} data-testid={`button-col-drop-${i}`}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-custom-cancel">Отмена</Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!title.trim() || !cols.some((c) => c.label.trim()) || create.isPending}
            data-testid="button-custom-create"
          >
            Создать раздел
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
