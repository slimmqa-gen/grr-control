import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Download, FileSpreadsheet, Pencil, Plus, Trash2, ArrowUp, ArrowDown, Save,
  RotateCcw, Upload, Building2, ImageIcon, X, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getAuthToken } from "@/lib/queryClient";
import { PageHeader, Section, Loading, ErrorBox, TableWrap, Empty } from "@/components/shell";
import { API_BASE, downloadFile } from "@/lib/app";
import { cn } from "@/lib/utils";

type Column = { key: string; label: string; hint?: string; required?: boolean; custom?: boolean };
type Def = {
  code: string; kind: "data" | "refs" | "custom"; baseType: string; title: string;
  sheetName: string; columns: Column[]; notes: string[]; edited: boolean; builtin: boolean;
};

const KIND_LABEL: Record<string, string> = {
  data: "Сводка",
  refs: "Справочник",
  custom: "Свой шаблон",
};

function slug(label: string) {
  return `own_${label.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "_").slice(0, 20)}_${Math.random().toString(36).slice(2, 5)}`;
}

export default function TemplatesPage() {
  const { toast } = useToast();
  const list = useQuery<any>({ queryKey: ["/api/templates"] });
  const [code, setCode] = useState<string>("");
  const [draft, setDraft] = useState<Def | null>(null);
  const [notesText, setNotesText] = useState("");
  const [proposal, setProposal] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const templates: Def[] = list.data?.templates ?? [];
  const current = useQuery<any>({ queryKey: ["/api/templates", code], enabled: !!code });

  useEffect(() => {
    if (current.data?.def) {
      setDraft(current.data.def as Def);
      setNotesText(((current.data.def.notes ?? []) as string[]).join("\n"));
    }
  }, [current.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("Шаблон не выбран");
      const body = {
        title: draft.title, sheetName: draft.sheetName, columns: draft.columns,
        notes: notesText.split("\n").map((s) => s.trim()).filter(Boolean),
        baseType: draft.baseType,
      };
      return (await apiRequest("PUT", `/api/templates/${draft.code}`, body)).json();
    },
    onSuccess: (d: any) => {
      queryClient.invalidateQueries();
      setDraft(d.def);
      toast({
        title: "Шаблон сохранён",
        description: "Он применяется и при скачивании, и при распознавании загружаемых файлов.",
      });
    },
    onError: (e: any) => toast({ title: "Не удалось сохранить", description: e.message, variant: "destructive" }),
  });

  const reset = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/templates/${code}/reset`)).json(),
    onSuccess: (d: any) => {
      queryClient.invalidateQueries();
      setDraft(d.def);
      setNotesText((d.def.notes ?? []).join("\n"));
      toast({ title: "Возвращён заводской вид шаблона" });
    },
    onError: (e: any) => toast({ title: "Не получилось", description: e.message, variant: "destructive" }),
  });

  const removeTemplate = useMutation({
    mutationFn: async (c: string) => (await apiRequest("DELETE", `/api/templates/${c}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setCode("");
      setDraft(null);
      toast({ title: "Шаблон удалён" });
    },
    onError: (e: any) => toast({ title: "Не получилось удалить", description: e.message, variant: "destructive" }),
  });

  const createFromProposal = useMutation({
    mutationFn: async () => {
      const body = {
        title: proposal.title, sheetName: proposal.sheetName, columns: proposal.columns,
        notes: proposal.notes ?? [], baseType: proposal.baseType ?? "",
      };
      return (await apiRequest("POST", "/api/templates", body)).json();
    },
    onSuccess: (d: any) => {
      queryClient.invalidateQueries();
      setProposal(null);
      setCode(d.def.code);
      toast({
        title: "Шаблон создан по вашему файлу",
        description: "Он сохранён как профиль импорта — программа будет узнавать такие файлы.",
      });
    },
    onError: (e: any) => toast({ title: "Не удалось сохранить шаблон", description: e.message, variant: "destructive" }),
  });

  const analyze = async (file: File) => {
    setBusy(true);
    setProposal(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/api/templates/from-file`, {
        method: "POST", body: fd,
        headers: getAuthToken() ? { "x-auth-token": getAuthToken() } : {},
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось прочитать файл");
      setProposal(json);
    } catch (e: any) {
      toast({ title: "Файл не разобран", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const download = async (c: string, title: string) => {
    try {
      await downloadFile(`/api/templates/${c}/xlsx`, `${title}.xlsx`);
    } catch (e: any) {
      toast({ title: "Не удалось скачать", description: e.message, variant: "destructive" });
    }
  };

  const move = (i: number, dir: -1 | 1) => {
    if (!draft) return;
    const cols = [...draft.columns];
    const j = i + dir;
    if (j < 0 || j >= cols.length) return;
    [cols[i], cols[j]] = [cols[j], cols[i]];
    setDraft({ ...draft, columns: cols });
  };

  const patchCol = (i: number, patch: Partial<Column>) => {
    if (!draft) return;
    const cols = draft.columns.map((c, k) => (k === i ? { ...c, ...patch } : c));
    setDraft({ ...draft, columns: cols });
  };

  const addCol = () => {
    if (!draft) return;
    const label = `Своя колонка ${draft.columns.filter((c) => c.custom).length + 1}`;
    setDraft({ ...draft, columns: [...draft.columns, { key: slug(label), label, hint: "", required: false, custom: true }] });
  };

  const delCol = (i: number) => {
    if (!draft) return;
    if (draft.columns.length <= 1) {
      toast({ title: "Нужна хотя бы одна колонка", variant: "destructive" });
      return;
    }
    setDraft({ ...draft, columns: draft.columns.filter((_c, k) => k !== i) });
  };

  const previewRows: any[][] = current.data?.preview ?? [];

  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorBox text={(list.error as any).message} />;

  return (
    <div data-testid="page-templates">
      <PageHeader
        title="Шаблоны Excel"
        subtitle="Все формы, которые программа отдаёт и принимает. Переименуйте колонки под свои формы — импорт продолжит работать."
      />

      <BrandingBlock />

      <Section
        className="mb-4"
        title="Создать шаблон на основе моего файла"
        description="Загрузите свою рабочую форму — программа предложит шаблон, повторяющий её структуру, и сохранит как профиль импорта."
      >
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xlsm,.xls,.csv"
          className="hidden"
          data-testid="input-template-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) analyze(f);
            e.target.value = "";
          }}
        />
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy} data-testid="button-template-from-file">
          <Upload className="mr-2 h-4 w-4" />
          {busy ? "Читаю файл…" : "Выбрать файл"}
        </Button>

        {proposal && (
          <div className="mt-4 rounded-md border p-3" data-testid="block-proposal">
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Предложен шаблон по файлу «{proposal.fileName}»
              <Badge variant="outline" data-testid="badge-proposal-recognized">
                узнано колонок: {proposal.recognized} из {proposal.columns.length}
              </Badge>
              {proposal.baseTypeLabel && (
                <Badge variant="outline">похоже на: {proposal.baseTypeLabel}</Badge>
              )}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-muted-foreground">
                Название шаблона
                <Input
                  className="mt-1"
                  value={proposal.title}
                  onChange={(e) => setProposal({ ...proposal, title: e.target.value })}
                  data-testid="input-proposal-title"
                />
              </label>
              <label className="text-xs text-muted-foreground">
                Название листа
                <Input
                  className="mt-1"
                  value={proposal.sheetName}
                  onChange={(e) => setProposal({ ...proposal, sheetName: e.target.value })}
                  data-testid="input-proposal-sheet"
                />
              </label>
            </div>
            <TableWrap>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {proposal.columns.map((c: Column, i: number) => (
                      <th key={i} className="whitespace-nowrap px-2 py-1.5 text-left font-medium">
                        {c.label}
                        {c.custom && <span className="ml-1 text-muted-foreground">(своя)</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(proposal.sampleRows ?? []).map((r: any[], i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      {r.map((v, j) => (
                        <td key={j} className="whitespace-nowrap px-2 py-1 text-muted-foreground">{String(v ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => createFromProposal.mutate()} disabled={createFromProposal.isPending} data-testid="button-save-proposal">
                <Save className="mr-2 h-4 w-4" /> Сохранить как шаблон и профиль
              </Button>
              <Button size="sm" variant="outline" onClick={() => setProposal(null)} data-testid="button-cancel-proposal">
                <X className="mr-2 h-4 w-4" /> Отменить
              </Button>
            </div>
          </div>
        )}
      </Section>

      <Section
        className="mb-4"
        title={`Список шаблонов (${templates.length})`}
        description="Скачайте пустую форму или откройте редактор, чтобы изменить колонки под себя."
      >
        <div className="grid gap-2 lg:grid-cols-2">
          {templates.map((t) => (
            <div
              key={t.code}
              className={cn(
                "rounded-md border p-3",
                code === t.code && "border-primary bg-accent/40",
              )}
              data-testid={`card-template-${t.code}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm font-medium" data-testid={`text-template-title-${t.code}`}>{t.title}</span>
                    <Badge variant="outline" className="text-[10px]">{KIND_LABEL[t.kind]}</Badge>
                    {t.edited && <Badge className="text-[10px]" data-testid={`badge-edited-${t.code}`}>изменён</Badge>}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Лист «{t.sheetName}» · колонок: {t.columns.length}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => download(t.code, t.title)} data-testid={`button-download-${t.code}`}>
                  <Download className="mr-2 h-3.5 w-3.5" /> Скачать
                </Button>
                <Button
                  size="sm"
                  variant={code === t.code ? "default" : "outline"}
                  onClick={() => setCode(code === t.code ? "" : t.code)}
                  data-testid={`button-edit-${t.code}`}
                >
                  <Pencil className="mr-2 h-3.5 w-3.5" /> {code === t.code ? "Закрыть" : "Изменить"}
                </Button>
                {!t.builtin && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => removeTemplate.mutate(t.code)}
                    data-testid={`button-delete-${t.code}`}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> Удалить
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {code && (
        <Section
          className="mb-4"
          title="Редактор шаблона"
          description="Переименуйте колонки, поменяйте порядок, добавьте свои и задайте название листа. Новые названия попадают в словарь синонимов профиля — импорт продолжит узнавать файлы."
        >
          {current.isLoading && <Loading />}
          {draft && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-muted-foreground">
                  Название шаблона
                  <Input
                    className="mt-1"
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    data-testid="input-template-title"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Название листа Excel
                  <Input
                    className="mt-1"
                    value={draft.sheetName}
                    onChange={(e) => setDraft({ ...draft, sheetName: e.target.value })}
                    data-testid="input-template-sheet"
                  />
                </label>
              </div>

              <div className="mt-4 space-y-2">
                {draft.columns.map((c, i) => (
                  <div key={`${c.key}-${i}`} className="rounded-md border p-2" data-testid={`row-column-${i}`}>
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <label className="text-[11px] text-muted-foreground">
                        Название колонки в файле
                        <Input
                          className="mt-1 h-9"
                          value={c.label}
                          onChange={(e) => patchCol(i, { label: e.target.value })}
                          data-testid={`input-col-label-${i}`}
                        />
                      </label>
                      <label className="text-[11px] text-muted-foreground">
                        Строка-подсказка под шапкой
                        <Input
                          className="mt-1 h-9"
                          value={c.hint ?? ""}
                          onChange={(e) => patchCol(i, { hint: e.target.value })}
                          data-testid={`input-col-hint-${i}`}
                        />
                      </label>
                      <div className="flex items-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => move(i, -1)} aria-label="Выше" data-testid={`button-col-up-${i}`}>
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => move(i, 1)} aria-label="Ниже" data-testid={`button-col-down-${i}`}>
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="text-destructive" onClick={() => delCol(i)} aria-label="Удалить колонку" data-testid={`button-col-del-${i}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <label className="flex items-center gap-2">
                        <Checkbox
                          checked={!!c.required}
                          onCheckedChange={(v) => patchCol(i, { required: !!v })}
                          data-testid={`check-col-required-${i}`}
                        />
                        Обязательная
                      </label>
                      <span>Поле программы: {c.custom ? "своя колонка (в импорте не разбирается)" : c.key}</span>
                    </div>
                  </div>
                ))}
              </div>

              <Button size="sm" variant="outline" className="mt-3" onClick={addCol} data-testid="button-add-column">
                <Plus className="mr-2 h-4 w-4" /> Добавить свою колонку
              </Button>

              <label className="mt-4 block text-xs text-muted-foreground">
                Строки-подсказки в шаблоне (по одной в строке)
                <Textarea
                  className="mt-1"
                  rows={3}
                  value={notesText}
                  onChange={(e) => setNotesText(e.target.value)}
                  data-testid="input-template-notes"
                />
              </label>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-template">
                  <Save className="mr-2 h-4 w-4" /> Сохранить шаблон
                </Button>
                <Button size="sm" variant="outline" onClick={() => download(draft.code, draft.title)} data-testid="button-download-current">
                  <Download className="mr-2 h-4 w-4" /> Скачать этот шаблон
                </Button>
                {draft.builtin && (
                  <Button size="sm" variant="ghost" onClick={() => reset.mutate()} disabled={reset.isPending} data-testid="button-reset-template">
                    <RotateCcw className="mr-2 h-4 w-4" /> Вернуть заводской вид
                  </Button>
                )}
              </div>

              <div className="mt-5">
                <div className="mb-2 text-sm font-medium">Предпросмотр шаблона</div>
                <TableWrap>
                  <table className="w-full text-xs" data-testid="table-template-preview">
                    <thead>
                      <tr className="border-b bg-primary text-primary-foreground">
                        {draft.columns.map((c, i) => (
                          <th key={i} className="whitespace-nowrap px-2 py-2 text-left font-medium">
                            {c.label}{c.required ? " *" : ""}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {draft.columns.some((c) => (c.hint ?? "").trim()) && (
                        <tr className="border-b bg-muted/40">
                          {draft.columns.map((c, i) => (
                            <td key={i} className="px-2 py-1 text-[11px] italic text-muted-foreground">{c.hint}</td>
                          ))}
                        </tr>
                      )}
                      {previewRows.map((r, i) => (
                        <tr key={i} className="border-b last:border-0">
                          {draft.columns.map((_c, j) => (
                            <td key={j} className="whitespace-nowrap px-2 py-1 italic text-muted-foreground">
                              {String(r[j] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
                <p className="mt-2 text-xs text-muted-foreground">
                  Строки с примерами в скачанном файле выделены серым — их нужно удалить перед отправкой.
                  Шапка таблицы в файле стоит в 4-й строке: выше выводится название организации и шаблона.
                </p>
              </div>
            </>
          )}
        </Section>
      )}

      {!templates.length && <Empty text="Шаблоны не найдены" />}
    </div>
  );
}

/* ==================== Брендирование ==================== */

function BrandingBlock() {
  const { toast } = useToast();
  const q = useQuery<any>({ queryKey: ["/api/branding"] });
  const [form, setForm] = useState<any>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (q.data && !form) setForm(q.data);
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/branding", form)).json(),
    onSuccess: (d: any) => {
      queryClient.invalidateQueries();
      setForm(d);
      toast({
        title: "Брендирование сохранено",
        description: "Название и логотип выводятся в шапке программы и в выгрузках Excel.",
      });
    },
    onError: (e: any) => toast({ title: "Не удалось сохранить", description: e.message, variant: "destructive" }),
  });

  const pickLogo = (file: File) => {
    if (file.size > 1_000_000) {
      toast({ title: "Файл слишком большой", description: "Логотип до 1 МБ, PNG или JPG.", variant: "destructive" });
      return;
    }
    const fr = new FileReader();
    fr.onload = () => setForm({ ...form, logo: String(fr.result) });
    fr.readAsDataURL(file);
  };

  const fields = useMemo(
    () => [
      { key: "orgName", label: "Название организации", placeholder: "ООО «Производственно-Буровая Компания»" },
      { key: "orgShort", label: "Короткое название (для шапки и телефона)", placeholder: "ПБК" },
      { key: "orgInn", label: "ИНН / КПП (по желанию)", placeholder: "2460000000 / 246001001" },
      { key: "signerName", label: "Отчёты подготовил (ФИО)", placeholder: "Петрова А. С." },
      { key: "signerPosition", label: "Должность подписанта", placeholder: "Аналитик" },
    ],
    [],
  );

  if (q.isLoading) return <Loading />;
  if (!form) return null;

  return (
    <Section
      className="mb-4"
      title="Брендирование: название, реквизиты, логотип и подпись отчётов"
      description="Применяется сразу, без пересборки: шапка программы, шапка листов Excel и подпись выгрузок."
    >
      <div className="grid gap-3 lg:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className="text-xs text-muted-foreground">
            {f.label}
            <Input
              className="mt-1"
              value={form[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              data-testid={`input-branding-${f.key}`}
            />
          </label>
        ))}
        <label className="text-xs text-muted-foreground lg:col-span-2">
          Реквизиты для шапки выгрузок (адрес, телефон, договор)
          <Textarea
            className="mt-1"
            rows={2}
            value={form.orgDetails ?? ""}
            placeholder="660000, г. Красноярск, ул. Ленина, 1 · тел. +7 391 000-00-00"
            onChange={(e) => setForm({ ...form, orgDetails: e.target.value })}
            data-testid="input-branding-orgDetails"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-md border bg-card">
          {form.logo ? (
            <img src={form.logo} alt="Логотип организации" className="h-full w-full object-contain" data-testid="img-branding-logo" />
          ) : (
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <input
          ref={logoRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          data-testid="input-branding-logo-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pickLogo(f);
            e.target.value = "";
          }}
        />
        <Button size="sm" variant="outline" onClick={() => logoRef.current?.click()} data-testid="button-branding-logo">
          <Building2 className="mr-2 h-4 w-4" /> Загрузить логотип (PNG/JPG)
        </Button>
        {form.logo && (
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setForm({ ...form, logo: "" })} data-testid="button-branding-logo-clear">
            <X className="mr-2 h-4 w-4" /> Убрать логотип
          </Button>
        )}
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-branding">
          <Save className="mr-2 h-4 w-4" /> Сохранить брендирование
        </Button>
      </div>
    </Section>
  );
}
