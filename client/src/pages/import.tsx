import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Upload, FileSpreadsheet, Download, RotateCcw, CheckCircle2, AlertTriangle, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getAuthToken } from "@/lib/queryClient";
import { useReference } from "@/lib/hooks";
import { PageHeader, Section, Empty, Loading, ErrorBox } from "@/components/shell";
import { API_BASE, downloadFile, nf, ruDate, levelBadge } from "@/lib/app";
import { cn } from "@/lib/utils";

type Step = "upload" | "mapping" | "done";

const STRATEGIES = [
  { key: "skip", label: "Пропустить дубли" },
  { key: "replace", label: "Заменить существующие" },
  { key: "new", label: "Загрузить как новые" },
];

export default function ImportPage() {
  const { data: ref, isLoading } = useReference();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [parsed, setParsed] = useState<any>(null);
  const [type, setType] = useState<string>("reports");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<any>(null);
  const [strategy, setStrategy] = useState("skip");
  const [result, setResult] = useState<any>(null);
  const [uploadError, setUploadError] = useState("");
  const refsFileRef = useRef<HTMLInputElement>(null);
  const [refsResult, setRefsResult] = useState<any>(null);
  const [refsError, setRefsError] = useState("");
  const [refsBusy, setRefsBusy] = useState(false);

  const uploadRefs = async (file: File) => {
    setRefsError("");
    setRefsResult(null);
    setRefsBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/api/import/refs`, { method: "POST", body: fd, headers: getAuthToken() ? { "x-auth-token": getAuthToken() } : {} });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось прочитать файл справочников");
      setRefsResult(json);
      queryClient.invalidateQueries();
      toast({
        title: "Справочники загружены",
        description: `Объекты: +${nf(json.objects.created)}, станки: +${nf(json.rigs.created)}.`,
      });
    } catch (e: any) {
      setRefsError(e.message || "Не удалось загрузить справочники");
    } finally {
      setRefsBusy(false);
    }
  };

  const logs = useQuery<any[]>({ queryKey: ["/api/import/logs"] });

  const dataTypes: Record<string, string> = ref?.dataTypes ?? {};
  const fields: any[] = ref?.importFields?.[type] ?? [];

  const runPreview = async (uploadId: string, t: string, map: Record<string, string>) => {
    const res = await apiRequest("POST", "/api/import/preview", { uploadId, type: t, mapping: map });
    setPreview(await res.json());
  };

  const upload = async (file: File) => {
    setUploadError("");
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/api/import/upload`, { method: "POST", body: fd, headers: getAuthToken() ? { "x-auth-token": getAuthToken() } : {} });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось прочитать файл");
      setParsed(json);
      setType(json.suggestedType);
      setMapping(json.suggestedMapping);
      setStep("mapping");
      await runPreview(json.uploadId, json.suggestedType, json.suggestedMapping);
      toast({
        title: "Файл прочитан",
        description: `${json.fileName}: строк с данными — ${nf(json.totalRows)}. Проверьте сопоставление колонок.`,
      });
    } catch (e: any) {
      setUploadError(e.message || "Не удалось прочитать файл");
    }
  };

  const changeType = async (t: string) => {
    setType(t);
    const res = await apiRequest("POST", "/api/import/mapping", { headers: parsed.headers, type: t });
    const { mapping: m } = await res.json();
    setMapping(m);
    await runPreview(parsed.uploadId, t, m);
  };

  const changeField = async (key: string, col: string) => {
    const m = { ...mapping };
    if (col === "__none__") delete m[key];
    else m[key] = col;
    setMapping(m);
    await runPreview(parsed.uploadId, type, m);
  };

  const commit = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/import/commit", {
        uploadId: parsed.uploadId, type, mapping, duplicateStrategy: strategy,
      });
      return res.json();
    },
    onSuccess: (r: any) => {
      setResult(r);
      setStep("done");
      queryClient.invalidateQueries();
      toast({
        title: "Импорт завершён",
        description: `Загружено ${nf(r.loaded)} строк, пропущено ${nf(r.skipped)}, ошибок ${nf(r.errors)}.`,
      });
    },
    onError: (e: any) => toast({ title: "Импорт не выполнен", description: e.message, variant: "destructive" }),
  });

  const rollback = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/import/logs/${id}/rollback`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({ title: "Импорт отменён", description: "Загруженные этим файлом строки удалены из базы." });
    },
    onError: (e: any) => toast({ title: "Не удалось отменить импорт", description: e.message, variant: "destructive" }),
  });

  const reset = () => {
    setStep("upload");
    setParsed(null);
    setPreview(null);
    setResult(null);
    setUploadError("");
  };

  if (isLoading) return <Loading rows={3} />;

  const missingRequired = fields.filter((f) => f.required && !mapping[f.key]);

  return (
    <>
      <PageHeader
        title="Импорт данных"
        subtitle="Загрузите файл, который прислали с объекта: .xlsx, .xls или .csv. Программа сама подставит колонки и проверит строки."
      />

      {/* Шаблоны */}
      <Section
        className="mb-4"
        title="Шаблоны файлов"
        description="Отправьте шаблон на объект — тогда данные подтянутся без ручной правки колонок"
      >
        <div className="flex flex-wrap gap-2">
          {Object.entries(dataTypes).map(([k, label]) => (
            <Button
              key={k}
              variant="outline"
              size="sm"
              data-testid={`button-template-${k}`}
              onClick={() => downloadFile(`/api/import/template/${k}`, `Шаблон ${label}.xlsx`)}
            >
              <Download className="mr-2 h-4 w-4" />
              {label as string}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            data-testid="button-template-refs"
            onClick={() => downloadFile("/api/import/template/refs", "Шаблон Справочники.xlsx")}
          >
            <Download className="mr-2 h-4 w-4" />
            Справочники
          </Button>
        </div>
      </Section>

      {/* Шестой тип импорта — справочники одним файлом */}
      <Section
        className="mb-4"
        title="Справочники одним файлом"
        description="Объекты и станки на листах одной книги Excel. Записи с такими же названиями обновляются, новые — добавляются."
        actions={
          <Button
            size="sm"
            disabled={refsBusy}
            onClick={() => refsFileRef.current?.click()}
            data-testid="button-upload-refs"
          >
            <Upload className="mr-2 h-4 w-4" />
            {refsBusy ? "Загружаем…" : "Загрузить справочники"}
          </Button>
        }
      >
        <input
          ref={refsFileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          data-testid="input-file-refs"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadRefs(f);
            e.target.value = "";
          }}
        />
        <p className="text-sm text-muted-foreground">
          Удобно при первоначальном заполнении: скачайте шаблон «Справочники», внесите свои объекты,
          станки и загрузите файл обратно — вся структура появится за один раз.
        </p>
        {refsError && <div className="mt-3"><ErrorBox text={refsError} /></div>}
        {refsResult && (
          <div className="mt-3 rounded-md border p-3 text-sm" data-testid="result-refs-import">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Загружено из файла
            </div>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              <li>Объекты: добавлено {nf(refsResult.objects.created)}, обновлено {nf(refsResult.objects.updated)}</li>
              <li>Станки: добавлено {nf(refsResult.rigs.created)}, обновлено {nf(refsResult.rigs.updated)}</li>
            </ul>
            {refsResult.issues?.length > 0 && (
              <div className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                <div className="font-medium">Замечания по файлу:</div>
                <ul className="mt-1 list-inside list-disc">
                  {refsResult.issues.slice(0, 8).map((i: string, n: number) => <li key={n}>{i}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </Section>

      {step === "upload" && (
        <Card
          className={cn(
            "mb-4 flex flex-col items-center justify-center gap-3 border-2 border-dashed p-8 text-center transition-colors",
            drag && "border-primary bg-accent",
          )}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) upload(f);
          }}
          data-testid="dropzone"
        >
          <Upload className="h-8 w-8 text-muted-foreground" />
          <div className="text-sm font-medium">Перетащите файл сюда</div>
          <div className="text-xs text-muted-foreground">Поддерживаются .xlsx, .xls и .csv, до 20 МБ</div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            data-testid="input-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
          <Button size="sm" onClick={() => fileRef.current?.click()} data-testid="button-choose-file">
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Выбрать файл
          </Button>
          {uploadError && <ErrorBox text={uploadError} />}
        </Card>
      )}

      {step === "mapping" && parsed && (
        <>
          <Section
            className="mb-4"
            title={`Файл: ${parsed.fileName}`}
            description={`Строк с данными — ${nf(parsed.totalRows)}. Проверьте тип данных и сопоставление колонок.`}
            actions={
              <Button variant="ghost" size="sm" onClick={reset} data-testid="button-cancel-upload">
                <X className="mr-2 h-4 w-4" />
                Отменить
              </Button>
            }
          >
            <div className="mb-4 max-w-md">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Тип данных</label>
              <Select value={type} onValueChange={changeType}>
                <SelectTrigger data-testid="select-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(dataTypes).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label as string}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map((f) => (
                <div key={f.key}>
                  <label className="mb-1 block text-xs font-medium">
                    {f.label}
                    {f.required && <span className="ml-1 text-red-600">*</span>}
                  </label>
                  <Select
                    value={mapping[f.key] ?? "__none__"}
                    onValueChange={(v) => changeField(f.key, v)}
                  >
                    <SelectTrigger data-testid={`select-map-${f.key}`}>
                      <SelectValue placeholder="Не сопоставлено" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— не использовать —</SelectItem>
                      {parsed.headers.map((h: string, i: number) => (
                        <SelectItem key={i} value={String(i)}>{h || `Колонка ${i + 1}`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {missingRequired.length > 0 && (
              <div className="mt-4">
                <ErrorBox
                  text={`Не сопоставлены обязательные поля: ${missingRequired.map((f) => f.label).join(", ")}`}
                />
              </div>
            )}
          </Section>

          {preview && (
            <>
              <Section
                className="mb-4"
                title="Предпросмотр: первые 20 строк"
                description={`Всего строк ${nf(preview.totals.total)} · корректных ${nf(preview.totals.valid)} · с ошибками ${nf(preview.totals.errors)} · дублей ${nf(preview.totals.duplicates)}`}
              >
                {preview.preview.length === 0 ? (
                  <Empty text="В файле нет строк с данными." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-xs" data-testid="table-preview">
                      <thead>
                        <tr className="border-b text-left uppercase tracking-wide text-muted-foreground">
                          <th className="py-2 pr-3 font-medium">Строка</th>
                          {fields.map((f) => (
                            <th key={f.key} className="py-2 pr-3 font-medium">{f.label}</th>
                          ))}
                          <th className="py-2 font-medium">Замечания</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.preview.map((row: any) => {
                          const bad = row.issues.some((i: any) => i.level === "ошибка");
                          const warn = !bad && (row.issues.length > 0 || row.duplicate);
                          return (
                            <tr
                              key={row.row}
                              className={cn(
                                "border-b last:border-0",
                                bad && "bg-red-50 dark:bg-red-950/40",
                                warn && "bg-amber-50 dark:bg-amber-950/30",
                              )}
                              data-testid={`row-preview-${row.row}`}
                            >
                              <td className="num py-1.5 pr-3">{row.row}</td>
                              {fields.map((f) => (
                                <td key={f.key} className="py-1.5 pr-3 whitespace-nowrap">
                                  {row.values[f.key] === null || row.values[f.key] === undefined || row.values[f.key] === ""
                                    ? "—"
                                    : String(row.values[f.key])}
                                </td>
                              ))}
                              <td className="py-1.5 text-muted-foreground">
                                {row.duplicate && (
                                  <Badge variant="outline" className={cn("mr-1 border text-[10px]", levelBadge.warn)}>
                                    дубль
                                  </Badge>
                                )}
                                {row.issues.map((i: any, n: number) => (
                                  <div key={n} className={i.level === "ошибка" ? "text-red-700 dark:text-red-400" : ""}>
                                    {i.message}
                                  </div>
                                ))}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>

              {preview.unknownRefs?.length > 0 && (
                <Card className="mb-4 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    Не найдены в справочниках
                  </div>
                  <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground">
                    {preview.unknownRefs.map((u: any, i: number) => (
                      <li key={i}>{u.type}: {u.value}</li>
                    ))}
                  </ul>
                </Card>
              )}

              <Card className="mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="max-w-xs flex-1">
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Что делать с дублями
                  </label>
                  <Select value={strategy} onValueChange={setStrategy}>
                    <SelectTrigger data-testid="select-strategy"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STRATEGIES.map((s) => (
                        <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => commit.mutate()}
                  disabled={missingRequired.length > 0 || commit.isPending}
                  data-testid="button-commit"
                >
                  {commit.isPending ? "Загружаем…" : "Загрузить в базу"}
                </Button>
              </Card>
            </>
          )}
        </>
      )}

      {step === "done" && result && (
        <Card className="mb-4 p-4" data-testid="card-import-result">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            Загружено {nf(result.loaded)} строк, пропущено {nf(result.skipped)}, ошибок {nf(result.errors)}
          </div>
          {result.issues?.length > 0 && (
            <ul className="mt-3 max-h-48 space-y-1 overflow-auto text-xs text-muted-foreground">
              {result.issues.map((m: string, i: number) => <li key={i}>{m}</li>)}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={reset} data-testid="button-import-more">Загрузить ещё файл</Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => rollback.mutate(result.importId)}
              data-testid="button-rollback-last"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Отменить этот импорт
            </Button>
          </div>
        </Card>
      )}

      <Section title="Журнал импортов" description="Каждую загрузку можно отменить одной кнопкой">
        {logs.isLoading ? (
          <Loading rows={2} />
        ) : !logs.data || logs.data.length === 0 ? (
          <Empty text="Импортов пока не было. Загрузите первый файл с объекта." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm" data-testid="table-import-logs">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Дата</th>
                  <th className="py-2 pr-3 font-medium">Файл</th>
                  <th className="py-2 pr-3 font-medium">Тип</th>
                  <th className="py-2 pr-3 text-right font-medium">Загружено</th>
                  <th className="py-2 pr-3 text-right font-medium">Пропущено</th>
                  <th className="py-2 pr-3 text-right font-medium">Ошибок</th>
                  <th className="py-2 font-medium">Действие</th>
                </tr>
              </thead>
              <tbody>
                {logs.data.map((l: any) => (
                  <tr key={l.id} className="border-b last:border-0" data-testid={`row-log-${l.id}`}>
                    <td className="num py-2 pr-3 whitespace-nowrap">{ruDate(String(l.createdAt).slice(0, 10))}</td>
                    <td className="py-2 pr-3">{l.fileName}</td>
                    <td className="py-2 pr-3">{dataTypes[l.dataType] ?? l.dataType}</td>
                    <td className="num py-2 pr-3 text-right">{nf(l.rowsLoaded)}</td>
                    <td className="num py-2 pr-3 text-right">{nf(l.rowsSkipped)}</td>
                    <td className="num py-2 pr-3 text-right">{nf(l.rowsError)}</td>
                    <td className="py-2">
                      {l.rolledBack ? (
                        <Badge variant="outline" className="text-[11px]">отменён</Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => rollback.mutate(l.id)}
                          data-testid={`button-rollback-${l.id}`}
                        >
                          <RotateCcw className="mr-2 h-3.5 w-3.5" />
                          Отменить импорт
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
