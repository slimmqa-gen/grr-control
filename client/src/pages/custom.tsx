import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Download, Plus, Trash2, Upload, FileDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getAuthToken } from "@/lib/queryClient";
import { PageHeader, Section, Loading, ErrorBox, Empty, TableWrap } from "@/components/shell";
import { API_BASE, downloadFile, ruDate } from "@/lib/app";
import { useAuth } from "@/lib/auth";

type Col = { key: string; label: string; type: string; options?: string[]; required?: boolean };
type Sec = { id: number; key: string; title: string; descr: string; columns: Col[] };
type Rec = { id: number; data: Record<string, any>; author: string; createdAt: string };

/** Пользовательский раздел-журнал: таблица, форма ввода, фильтры, Excel */
export default function CustomSectionPage() {
  const params = useParams<{ key: string }>();
  const key = params.key ?? "";
  const url = `/api/custom/${key}`;
  const { data, isLoading, error } = useQuery<{ section: Sec; records: Rec[] }>({ queryKey: [url] });
  const { toast } = useToast();
  const { write } = useAuth();
  const [form, setForm] = useState<Record<string, any>>({});
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const add = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${url}/records`, form)).json(),
    onSuccess: () => {
      setForm({});
      queryClient.invalidateQueries({ queryKey: [url] });
      toast({ title: "Запись добавлена" });
    },
    onError: (e: any) => toast({ title: "Не удалось добавить запись", description: e.message, variant: "destructive" }),
  });

  const drop = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `${url}/records/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [url] });
      toast({ title: "Запись удалена" });
    },
    onError: (e: any) => toast({ title: "Не удалось удалить", description: e.message, variant: "destructive" }),
  });

  const rows = useMemo(() => {
    const list = data?.records ?? [];
    const needle = q.trim().toLowerCase();
    return list.filter((r) => {
      for (const [k, v] of Object.entries(filters)) {
        if (!v || v === "__all__") continue;
        const cell = r.data[k];
        const text = typeof cell === "boolean" ? (cell ? "да" : "нет") : String(cell ?? "");
        if (text !== v) return false;
      }
      if (!needle) return true;
      return JSON.stringify(r.data).toLowerCase().includes(needle);
    });
  }, [data, q, filters]);

  if (isLoading) return <Loading rows={4} />;
  if (error) return <ErrorBox text={(error as any).message} />;
  if (!data) return <Empty text="Раздел не найден" />;

  const sec = data.section;

  const upload = async (file: File) => {
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`${API_BASE}${url}/import`, {
        method: "POST", body: fd,
        headers: getAuthToken() ? { "x-auth-token": getAuthToken() } : {},
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось прочитать файл");
      queryClient.invalidateQueries({ queryKey: [url] });
      toast({ title: "Загрузка из Excel", description: json.message });
    } catch (e: any) {
      toast({ title: "Загрузка не выполнена", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const cell = (r: Rec, c: Col) => {
    const v = r.data[c.key];
    if (c.type === "bool") return v ? "да" : "нет";
    if (v === null || v === undefined || v === "") return "—";
    if (c.type === "number") return Number(v).toLocaleString("ru-RU");
    if (c.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) return ruDate(String(v));
    return String(v);
  };

  const field = (c: Col) => {
    const v = form[c.key] ?? "";
    if (c.type === "list") {
      return (
        <Select value={String(v)} onValueChange={(val) => setForm({ ...form, [c.key]: val })}>
          <SelectTrigger data-testid={`select-field-${c.key}`}><SelectValue placeholder="Выберите" /></SelectTrigger>
          <SelectContent>
            {(c.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    if (c.type === "bool") {
      return (
        <Select value={v === true ? "да" : v === false ? "нет" : ""}
          onValueChange={(val) => setForm({ ...form, [c.key]: val === "да" })}>
          <SelectTrigger data-testid={`select-field-${c.key}`}><SelectValue placeholder="Выберите" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="да">да</SelectItem>
            <SelectItem value="нет">нет</SelectItem>
          </SelectContent>
        </Select>
      );
    }
    return (
      <Input
        type={c.type === "date" ? "date" : c.type === "number" ? "number" : "text"}
        value={String(v)}
        onChange={(e) => setForm({ ...form, [c.key]: e.target.value })}
        data-testid={`input-field-${c.key}`}
      />
    );
  };

  const listCols = sec.columns.filter((c) => c.type === "list" || c.type === "bool");

  return (
    <div>
      <PageHeader
        title={sec.title}
        subtitle={sec.descr || "Пользовательский раздел: колонки задал директор в настройках состава программы."}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => downloadFile(`${url}/export`, `${sec.title}.xlsx`)}
              data-testid="button-custom-export">
              <Download className="mr-2 h-4 w-4" /> Скачать Excel
            </Button>
            <Button size="sm" variant="outline" onClick={() => downloadFile(`${url}/template`, `Шаблон — ${sec.title}.xlsx`)}
              data-testid="button-custom-template">
              <FileDown className="mr-2 h-4 w-4" /> Шаблон для заполнения
            </Button>
            {write && (
              <>
                <input
                  ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
                  data-testid="input-custom-file"
                />
                <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}
                  data-testid="button-custom-import">
                  <Upload className="mr-2 h-4 w-4" /> {busy ? "Загрузка…" : "Загрузить из Excel"}
                </Button>
              </>
            )}
          </>
        }
      />

      {write && (
        <Section title="Новая запись" description="Заполните поля и нажмите «Добавить».">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sec.columns.map((c) => (
              <div key={c.key}>
                <label className="text-xs text-muted-foreground">
                  {c.label}{c.required ? " *" : ""}
                </label>
                {field(c)}
              </div>
            ))}
          </div>
          <div className="mt-3">
            <Button size="sm" onClick={() => add.mutate()} disabled={add.isPending} data-testid="button-custom-add">
              <Plus className="mr-2 h-4 w-4" /> {add.isPending ? "Сохранение…" : "Добавить"}
            </Button>
          </div>
        </Section>
      )}

      <Section
        className="mt-4"
        title="Записи журнала"
        description={`Всего записей: ${data.records.length}. Показано: ${rows.length}.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по записям"
                className="h-9 w-44 pl-7" data-testid="input-custom-search" />
            </div>
            {listCols.map((c) => (
              <Select key={c.key} value={filters[c.key] ?? "__all__"}
                onValueChange={(v) => setFilters({ ...filters, [c.key]: v })}>
                <SelectTrigger className="h-9 w-40" data-testid={`select-filter-${c.key}`}>
                  <SelectValue placeholder={c.label} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{c.label}: все</SelectItem>
                  {(c.type === "bool" ? ["да", "нет"] : c.options ?? []).map((o) => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ))}
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty text="Записей пока нет. Добавьте первую запись или загрузите файл Excel по шаблону." />
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  {sec.columns.map((c) => <th key={c.key} className="whitespace-nowrap px-2 py-2">{c.label}</th>)}
                  <th className="px-2 py-2">Кто внёс</th>
                  {write && <th className="px-2 py-2" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0" data-testid={`row-record-${r.id}`}>
                    {sec.columns.map((c) => (
                      <td key={c.key} className="whitespace-nowrap px-2 py-2">{cell(r, c)}</td>
                    ))}
                    <td className="px-2 py-2 text-xs text-muted-foreground">{r.author || "—"}</td>
                    {write && (
                      <td className="px-2 py-2 text-right">
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive"
                          onClick={() => drop.mutate(r.id)} data-testid={`button-record-drop-${r.id}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}
