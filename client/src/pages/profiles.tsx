import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Upload, Wand2, Save, Trash2, Copy, CheckCircle2, AlertTriangle, FileSpreadsheet, Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getAuthToken } from "@/lib/queryClient";
import { PageHeader, Section, Empty, Loading, ErrorBox } from "@/components/shell";
import { API_BASE, nf, ruDate } from "@/lib/app";
import { cn } from "@/lib/utils";

type Meta = { types: Record<string, string>; entities: any; synonymKinds: Record<string, string> };

const KIND_LABEL: Record<string, string> = { drill: "Буровая сводка", geo: "Геологическая сводка" };

export default function ProfilesPage() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: meta } = useQuery<Meta>({ queryKey: ["/api/smart/meta"] });
  const profiles = useQuery<any[]>({ queryKey: ["/api/profiles"] });
  const synonyms = useQuery<any[]>({ queryKey: ["/api/synonyms"] });

  const [upl, setUpl] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [mapping, setMapping] = useState<any>({});
  const [headerRow, setHeaderRow] = useState("0");
  const [type, setType] = useState<"drill" | "geo">("drill");
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [profileName, setProfileName] = useState("");
  const [syn, setSyn] = useState({ kind: "rig", alias: "", canonical: "" });

  const entities: any[] = meta?.entities?.[type] ?? [];
  const headers: string[] = upl?.sheets?.flatMap((s: any) => s.blocks)?.sort((a: any, b: any) => b.dataRows - a.dataRows)?.[0]?.headers ?? [];

  const onFile = async (file: File) => {
    setBusy(true); setUploadError(""); setPreview(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_BASE}/api/smart/upload`, {
        method: "POST", body: fd,
        headers: getAuthToken() ? { "x-auth-token": getAuthToken() } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Не удалось разобрать файл");
      setUpl(data);
      setType(data.type);
      setMapping(data.mapping);
      setHeaderRow("0");
      setProfileName(data.profile?.name ?? "");
      if (data.profile) toast({ title: "Профиль применён автоматически", description: data.message });
    } catch (e: any) {
      setUploadError(e?.message ?? "Ошибка разбора файла");
    } finally {
      setBusy(false);
    }
  };

  const body = () => ({
    uploadId: upl?.uploadId, type, mapping,
    headerRow: Number(headerRow || 0),
    defaults: upl?.defaults ?? {},
    profileId: upl?.profile?.id,
  });

  const doPreview = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/smart/preview", body())).json(),
    onSuccess: (d) => setPreview(d),
    onError: (e: any) => toast({ title: "Ошибка предпросмотра", description: e.message, variant: "destructive" }),
  });

  const doCommit = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/smart/commit", body())).json(),
    onSuccess: (d) => {
      setResult(d);
      queryClient.invalidateQueries();
      toast({ title: "Данные загружены", description: d.summary });
    },
    onError: (e: any) => toast({ title: "Не удалось загрузить", description: e.message, variant: "destructive" }),
  });

  const saveProfile = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/profiles", {
      name: profileName || `Сводка ${KIND_LABEL[type]} ${new Date().toLocaleDateString("ru-RU")}`,
      kind: type, mapping, defaults: {}, headers,
      headerRow: Number(headerRow || 0), sheetRule: "все",
    })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      toast({ title: "Профиль сохранён", description: "В следующий раз файл такой же структуры распознается сам." });
    },
    onError: (e: any) => toast({ title: "Не удалось сохранить профиль", description: e.message, variant: "destructive" }),
  });

  const delProfile = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/profiles/${id}`)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/profiles"] }),
  });
  const dupProfile = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/profiles/${id}/duplicate`, {})).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/profiles"] }),
  });

  const addSyn = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/synonyms", syn)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/synonyms"] });
      setSyn({ ...syn, alias: "", canonical: "" });
      toast({ title: "Синоним добавлен" });
    },
    onError: (e: any) => toast({ title: "Не удалось добавить", description: e.message, variant: "destructive" }),
  });
  const delSyn = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/synonyms/${id}`)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/synonyms"] }),
  });

  return (
    <>
      <PageHeader
        title="Профили импорта"
        subtitle="Загружайте «живые» сводки с участков в их обычном виде — программа сама найдёт шапку и разложит данные"
      />

      <Tabs defaultValue="smart" className="w-full">
        <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start gap-1 sm:w-auto">
          <TabsTrigger value="smart" data-testid="tab-smart">Умный импорт сводок</TabsTrigger>
          <TabsTrigger value="profiles" data-testid="tab-profiles">Профили</TabsTrigger>
          <TabsTrigger value="synonyms" data-testid="tab-synonyms">Словарь синонимов</TabsTrigger>
        </TabsList>

        {/* ---------- Умный импорт ---------- */}
        <TabsContent value="smart" className="mt-0 space-y-4">
          <Section
            title="Шаг 1. Загрузите файл сводки"
            description="Excel или CSV. Шапка может быть не в первой строке, ячейки могут быть объединены, строки «Итого» отбрасываются."
          >
            <input
              ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              data-testid="input-smart-file"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button onClick={() => fileRef.current?.click()} disabled={busy} data-testid="button-choose-smart-file">
                <Upload className="mr-2 h-4 w-4" />
                {busy ? "Разбираем файл…" : "Выбрать файл сводки"}
              </Button>
              {upl && (
                <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                  <FileSpreadsheet className="h-4 w-4 shrink-0" />
                  <span className="truncate" data-testid="text-smart-filename">{upl.fileName}</span>
                </div>
              )}
            </div>
            {uploadError && <div className="mt-3"><ErrorBox text={uploadError} /></div>}
            {upl && (
              <div
                className={cn(
                  "mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
                  upl.profile ? "border-primary/40 bg-primary/5" : "bg-muted/40",
                )}
                data-testid="text-smart-message"
              >
                {upl.profile ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  : <Wand2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                <span>{upl.message}</span>
              </div>
            )}
          </Section>

          {upl && (
            <Section title="Шаг 2. Что нашла программа" description="Листы, блоки таблиц и найденные строки заголовков">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {upl.sheets.map((sh: any) => (
                  <Card key={sh.index} className="p-3 text-sm" data-testid={`card-sheet-${sh.index}`}>
                    <div className="font-medium">Лист «{sh.name}»</div>
                    <div className="mt-1 text-xs text-muted-foreground">строк в листе: {nf(sh.rows)}</div>
                    <div className="mt-2 space-y-1.5">
                      {sh.blocks.map((b: any) => (
                        <div key={b.index} className="rounded border px-2 py-1.5 text-xs">
                          <div>
                            Блок {b.index + 1}: шапка в строке <b>{b.headerRow + 1}</b>
                            {b.twoLevel && " (двухуровневая)"}
                            {b.transposed && " (перевёрнутая таблица)"}
                          </div>
                          <div className="text-muted-foreground">строк данных: {nf(b.dataRows)}</div>
                          <div className="mt-1 truncate text-muted-foreground">{b.headers.slice(0, 6).join(" | ")}</div>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium">Тип сводки</label>
                  <Select value={type} onValueChange={(v: any) => setType(v)}>
                    <SelectTrigger data-testid="select-smart-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="drill">Буровая сводка</SelectItem>
                      <SelectItem value="geo">Геологическая сводка</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Строка заголовков (0 — определить самой)</label>
                  <Input
                    inputMode="numeric" value={headerRow}
                    onChange={(e) => setHeaderRow(e.target.value)} data-testid="input-header-row"
                  />
                </div>
                <div className="flex items-end">
                  <Button variant="outline" className="w-full" onClick={() => doPreview.mutate()}
                    disabled={doPreview.isPending} data-testid="button-preview-smart">
                    <Wand2 className="mr-2 h-4 w-4" /> Проверить разбор
                  </Button>
                </div>
              </div>
            </Section>
          )}

          {upl && (
            <Section
              title="Шаг 3. Сопоставление колонок"
              description="Один файл наполняет сразу несколько таблиц. Пустое значение — поле не заполняется."
            >
              <div className="space-y-5">
                {entities.map((ent: any) => (
                  <div key={ent.key} data-testid={`block-entity-${ent.key}`}>
                    <div className="mb-2 text-sm font-semibold">{ent.label}</div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {ent.fields.map((f: any) => (
                        <div key={f.key}>
                          <label className="mb-1 block text-xs font-medium">
                            {f.label}{f.required && <span className="text-destructive"> *</span>}
                          </label>
                          <Select
                            value={mapping?.[ent.key]?.[f.key] ?? "—"}
                            onValueChange={(v) => setMapping({
                              ...mapping,
                              [ent.key]: { ...(mapping[ent.key] ?? {}), [f.key]: v === "—" ? "" : v },
                            })}
                          >
                            <SelectTrigger data-testid={`select-map-${ent.key}-${f.key}`}>
                              <SelectValue placeholder="не заполнять" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="—">не заполнять</SelectItem>
                              {headers.map((h, i) => (
                                <SelectItem key={i} value={String(i)}>{h}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium">Название профиля</label>
                  <Input
                    value={profileName} onChange={(e) => setProfileName(e.target.value)}
                    placeholder="например, Сводка Северного участка" data-testid="input-profile-name"
                  />
                </div>
                <Button variant="outline" onClick={() => saveProfile.mutate()}
                  disabled={saveProfile.isPending} data-testid="button-save-profile">
                  <Save className="mr-2 h-4 w-4" /> Сохранить профиль
                </Button>
                <Button onClick={() => doCommit.mutate()} disabled={doCommit.isPending} data-testid="button-commit-smart">
                  Загрузить в программу
                </Button>
              </div>
            </Section>
          )}

          {preview && (
            <Section title="Предпросмотр загрузки" description="Проверьте количество записей до загрузки">
              <div className="mb-3 text-sm font-medium" data-testid="text-preview-summary">{preview.summary}</div>
              <div className="grid gap-3 sm:grid-cols-3">
                {preview.entities.map((e: any) => (
                  <Card key={e.key} className="p-3" data-testid={`card-count-${e.key}`}>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">{e.label}</div>
                    <div className="num mt-1 text-xl font-semibold">{nf(e.count)}</div>
                  </Card>
                ))}
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                Строк данных обработано: {nf(preview.totalRows)}, отброшено итоговых строк: {nf(preview.skippedTotals)}
              </div>
              {preview.issues.length > 0 && (
                <div className="mt-3 max-h-56 overflow-auto rounded-md border p-3 text-xs" data-testid="list-issues">
                  {preview.issues.map((i: any, n: number) => (
                    <div key={n} className="flex items-start gap-2 border-b py-1 last:border-0">
                      <AlertTriangle className={cn("mt-0.5 h-3.5 w-3.5 shrink-0",
                        i.level === "ошибка" ? "text-destructive" : "text-muted-foreground")} />
                      <span>Лист «{i.sheet}», строка {i.row}: {i.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          {result && (
            <Section title="Итог загрузки">
              <div className="flex items-start gap-2 text-sm" data-testid="text-commit-summary">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{result.summary}. Загрузку можно откатить в разделе «Импорт данных».</span>
              </div>
            </Section>
          )}
        </TabsContent>

        {/* ---------- Профили ---------- */}
        <TabsContent value="profiles" className="mt-0">
          <Section
            title="Сохранённые профили импорта"
            description="Профиль запоминает структуру шапки и сопоставление колонок. Файл похожей структуры распознаётся автоматически."
          >
            {profiles.isLoading ? <Loading rows={2} />
              : (profiles.data ?? []).length === 0
                ? <Empty text="Профилей пока нет. Сопоставьте колонки на вкладке «Умный импорт сводок» и сохраните профиль." />
                : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm" data-testid="table-profiles">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="py-2 pr-3 font-medium">Название</th>
                          <th className="py-2 pr-3 font-medium">Тип сводки</th>
                          <th className="py-2 pr-3 font-medium">Листы</th>
                          <th className="py-2 pr-3 text-right font-medium">Применён раз</th>
                          <th className="py-2 pr-3 font-medium">Автор</th>
                          <th className="py-2 text-right font-medium"> </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(profiles.data ?? []).map((p: any) => (
                          <tr key={p.id} className="border-b last:border-0" data-testid={`row-profile-${p.id}`}>
                            <td className="py-2 pr-3 font-medium">{p.name}</td>
                            <td className="py-2 pr-3"><Badge variant="secondary">{KIND_LABEL[p.kind]}</Badge></td>
                            <td className="py-2 pr-3 text-muted-foreground">{p.sheetRule}{p.sheetMatch ? `: ${p.sheetMatch}` : ""}</td>
                            <td className="num py-2 pr-3 text-right">{p.usedCount}</td>
                            <td className="py-2 pr-3 text-muted-foreground">{p.author}</td>
                            <td className="py-2 text-right whitespace-nowrap">
                              <Button variant="ghost" size="icon" aria-label="Дублировать"
                                onClick={() => dupProfile.mutate(p.id)} data-testid={`button-duplicate-profile-${p.id}`}>
                                <Copy className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" aria-label="Удалить"
                                onClick={() => delProfile.mutate(p.id)} data-testid={`button-delete-profile-${p.id}`}>
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
        </TabsContent>

        {/* ---------- Синонимы ---------- */}
        <TabsContent value="synonyms" className="mt-0">
          <Section
            title="Словарь синонимов"
            description="Как пишут на участке — как называется в справочнике. Например, «БУ-1» → «УБ-01», «Северка» → «Участок «Северный»»."
          >
            <div className="mb-4 grid gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-medium">Что сопоставляем</label>
                <Select value={syn.kind} onValueChange={(v) => setSyn({ ...syn, kind: v })}>
                  <SelectTrigger data-testid="select-syn-kind"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(meta?.synonymKinds ?? { rig: "Станок" }).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v as string}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Как в файле</label>
                <Input value={syn.alias} onChange={(e) => setSyn({ ...syn, alias: e.target.value })}
                  placeholder="БУ-1" data-testid="input-syn-alias" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Как в справочнике</label>
                <Input value={syn.canonical} onChange={(e) => setSyn({ ...syn, canonical: e.target.value })}
                  placeholder="УБ-01" data-testid="input-syn-canonical" />
              </div>
              <div className="flex items-end">
                <Button className="w-full" onClick={() => addSyn.mutate()} disabled={addSyn.isPending}
                  data-testid="button-add-synonym">
                  <Plus className="mr-2 h-4 w-4" /> Добавить
                </Button>
              </div>
            </div>

            {(synonyms.data ?? []).length === 0 ? <Empty text="Словарь пуст." /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm" data-testid="table-synonyms">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Тип</th>
                      <th className="py-2 pr-3 font-medium">Как в файле</th>
                      <th className="py-2 pr-3 font-medium">Как в справочнике</th>
                      <th className="py-2 text-right font-medium"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(synonyms.data ?? []).map((s: any) => (
                      <tr key={s.id} className="border-b last:border-0" data-testid={`row-synonym-${s.id}`}>
                        <td className="py-2 pr-3 text-muted-foreground">{meta?.synonymKinds?.[s.kind] ?? s.kind}</td>
                        <td className="py-2 pr-3 font-medium">{s.alias}</td>
                        <td className="py-2 pr-3">{s.canonical}</td>
                        <td className="py-2 text-right">
                          <Button variant="ghost" size="icon" aria-label="Удалить"
                            onClick={() => delSyn.mutate(s.id)} data-testid={`button-delete-synonym-${s.id}`}>
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
        </TabsContent>
      </Tabs>
    </>
  );
}
