/**
 * Суточная производственная сводка и сбор сводок с почты.
 * Показываются вкладками внутри раздела «Реальные данные ПБК».
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Send, RefreshCw, Save, Mail, History, Plug, Download, Upload, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getAuthToken } from "@/lib/queryClient";
import { Section, Empty, Loading } from "@/components/shell";
import { nf, downloadFile, API_BASE } from "@/lib/app";

const ru = (iso: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "");
const dt = (iso: string) => (iso ? new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const lagCell = (lag: number, plan: number) => {
  if (!plan) return <span className="text-muted-foreground">—</span>;
  if (lag > 0) return <span className="font-medium text-red-600 dark:text-red-400">−{nf(lag)}</span>;
  return <span className="font-medium text-emerald-600 dark:text-emerald-400">+{nf(-lag)}</span>;
};

/* ============================ Суточная сводка ============================ */

export function DailyTab() {
  const { toast } = useToast();
  const [date, setDate] = useState("");
  const [viewId, setViewId] = useState(0);

  const q = useQuery<any>({ queryKey: [`/api/pbk/daily${date ? `?date=${date}` : ""}`] });
  const archive = useQuery<any>({ queryKey: ["/api/pbk/daily/archive"] });
  const snap = useQuery<any>({ queryKey: [`/api/pbk/daily/archive/${viewId}`], enabled: viewId > 0 });
  const settings = useQuery<any>({ queryKey: ["/api/pbk/daily/settings"] });
  const invites = useQuery<any>({ queryKey: ["/api/max/invites"] });

  const [form, setForm] = useState<any>(null);
  useEffect(() => { if (settings.data && !form) setForm(settings.data); }, [settings.data, form]);

  const s = viewId > 0 ? snap.data?.data : q.data?.summary;
  const shownDate = s?.date ?? "";

  const saveSettings = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/pbk/daily/settings", form)).json(),
    onSuccess: (d: any) => {
      setForm(d);
      queryClient.invalidateQueries({ queryKey: ["/api/pbk/daily/settings"] });
      toast({ title: "Настройки рассылки сохранены" });
    },
    onError: (e: any) => toast({ title: "Не сохранено", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const sendNow = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/pbk/daily/send", { date: shownDate })).json(),
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pbk/daily/archive"] });
      toast({
        title: `Сводка отправлена: ${d.sent} из ${d.recipients}`,
        description: d.errors?.length ? d.errors.slice(0, 2).join("; ") : undefined,
        variant: d.errors?.length ? "destructive" : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Не отправлено", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const snapshot = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/pbk/daily/snapshot", { date: shownDate })).json(),
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pbk/daily/archive"] });
      toast({ title: d.isNew ? `Сохранена редакция ${d.version}` : "Такая редакция уже есть в архиве" });
    },
  });

  const runNow = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/pbk/daily/run", {})).json(),
    onSuccess: (d: any) => {
      queryClient.invalidateQueries();
      const mail = d.mail?.error ? `почта: ${d.mail.error}` : d.mail ? `с почты принято файлов: ${d.mail.accepted}` : "почта не подключена";
      toast({ title: d.isNew ? "Данные изменились, сохранена новая редакция" : "Изменений нет", description: mail });
    },
    onError: (e: any) => toast({ title: "Не получилось", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const linked = (invites.data?.rows ?? []).filter((r: any) => r.linked && r.chatId);
  const picked: string[] = String(form?.chatIds ?? "").split(",").map((x: string) => x.trim()).filter(Boolean);
  const toggle = (id: string, on: boolean) =>
    setForm({ ...form, chatIds: (on ? [...picked, id] : picked.filter((x) => x !== id)).join(",") });

  return (
    <div className="space-y-4">
      <Section
        title={viewId > 0 ? `Архив: сводка за ${ru(shownDate)}, редакция ${snap.data?.version ?? ""}` : `Суточная сводка за ${ru(shownDate)}`}
        description={viewId > 0
          ? `Сохранена ${dt(snap.data?.created_at)} · ${snap.data?.reason ?? ""}`
          : "Считается по загруженным сводкам участков и ЦПП. План — из справочника участков"}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {viewId > 0 ? (
              <Button size="sm" variant="outline" onClick={() => setViewId(0)} data-testid="button-daily-back">
                К текущей сводке
              </Button>
            ) : (
              <Input
                type="date" className="h-8 w-40" value={date || shownDate}
                onChange={(e) => setDate(e.target.value)} data-testid="input-daily-date"
              />
            )}
            <Button
              size="sm" variant="outline"
              onClick={() => downloadFile(
                viewId > 0 ? `/api/pbk/daily/excel?id=${viewId}` : `/api/pbk/daily/excel?date=${shownDate}`,
                `Svodka_PBK_${shownDate}.xlsx`,
              )}
              data-testid="button-daily-excel"
            >
              <Download className="mr-2 h-4 w-4" />Excel
            </Button>
            {viewId === 0 && (
              <>
                <Button size="sm" variant="outline" onClick={() => snapshot.mutate()} data-testid="button-daily-save">
                  <Save className="mr-2 h-4 w-4" />В архив
                </Button>
                <Button size="sm" onClick={() => sendNow.mutate()} disabled={sendNow.isPending} data-testid="button-daily-send">
                  <Send className="mr-2 h-4 w-4" />Отправить в MAX
                </Button>
              </>
            )}
          </div>
        )}
      >
        {(q.isLoading || (viewId > 0 && snap.isLoading)) ? <Loading /> : !s ? <Empty text="Нет данных." /> : (
          <>
            {s.missing?.length > 0 && (
              <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200" data-testid="box-daily-missing">
                Нет сводки за сутки: {s.missing.join(", ")}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm" data-testid="table-daily">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2">Участок / бурильщик</th>
                    <th className="py-2 pr-2">Станок</th>
                    <th className="py-2 pr-2 text-right">За смену</th>
                    <th className="py-2 pr-2 text-right">За сутки</th>
                    <th className="py-2 pr-2 text-right">С начала месяца</th>
                    <th className="py-2 pr-2 text-right">С начала года</th>
                    <th className="py-2 pr-2 text-right">План месяца</th>
                    <th className="py-2 pr-2 text-right">До плана</th>
                    <th className="py-2 pr-2 text-right">Отставание (−) / опережение (+)</th>
                    <th className="py-2 text-right">Выполнено</th>
                  </tr>
                </thead>
                <tbody>
                  {s.objects.map((o: any) => (
                    <FragmentRows key={o.object} o={o} />
                  ))}
                  <tr className="border-t-2 font-semibold" data-testid="row-daily-total">
                    <td className="py-2 pr-2">Итого бурение</td>
                    <td />
                    <td />
                    <td className="py-2 pr-2 text-right">{nf(s.totals.day)}</td>
                    <td className="py-2 pr-2 text-right">{nf(s.totals.month)}</td>
                    <td className="py-2 pr-2 text-right">{nf(s.totals.year)}</td>
                    <td className="py-2 pr-2 text-right">{nf(s.totals.planMonth)}</td>
                    <td className="py-2 pr-2 text-right">{nf(Math.max(0, s.totals.remaining))}</td>
                    <td className="py-2 pr-2 text-right">{lagCell(s.totals.lag, s.totals.planMonth)}</td>
                    <td className="py-2 text-right">
                      {s.totals.planMonth ? `${Math.round((s.totals.month / s.totals.planMonth) * 100)}%` : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-4 rounded-md border p-3" data-testid="box-daily-prep">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">Пробоподготовка</span>
                {!s.prep.reported && (
                  <Badge variant="outline" className="text-[11px]">
                    {s.prep.lastDate ? `нет данных за сутки, последние ${ru(s.prep.lastDate)}` : "сводки нет"}
                  </Badge>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["Дроблено за сутки", s.prep.day, `истёрто ${nf(s.prep.milledDay)}`],
                  ["Дроблено с начала месяца", s.prep.month, `истёрто ${nf(s.prep.milledMonth)}`],
                  ["Дроблено с начала года", s.prep.year, `истёрто ${nf(s.prep.milledYear)}`],
                ].map(([label, v, sub]) => (
                  <div key={String(label)} className="rounded-md bg-muted/50 p-3">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="text-xl font-semibold tabular-nums">{nf(Number(v))} <span className="text-sm font-normal">проб</span></div>
                    <div className="text-xs text-muted-foreground">{sub}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Рассылка в MAX"
          description="Кому и когда приходит сводка"
          actions={(
            <Button size="sm" onClick={() => saveSettings.mutate()} disabled={!form || saveSettings.isPending} data-testid="button-daily-settings-save">
              <Save className="mr-2 h-4 w-4" />Сохранить
            </Button>
          )}
        >
          {!form ? <Loading /> : (
            <div className="space-y-3 text-sm">
              <label className="flex items-center gap-3">
                <Switch checked={!!form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} data-testid="switch-daily-enabled" />
                Присылать сводку каждое утро
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <span>с</span>
                <Input type="number" min={0} max={23} className="h-8 w-20" value={form.sendFrom}
                  onChange={(e) => setForm({ ...form, sendFrom: Number(e.target.value) })} data-testid="input-daily-from" />
                <span>до</span>
                <Input type="number" min={1} max={24} className="h-8 w-20" value={form.sendTo}
                  onChange={(e) => setForm({ ...form, sendTo: Number(e.target.value) })} data-testid="input-daily-to" />
                <span className="text-muted-foreground">часов по Красноярску</span>
              </div>
              <label className="flex items-center gap-2">
                <Checkbox checked={!!form.notifyChanges} onCheckedChange={(v) => setForm({ ...form, notifyChanges: !!v })} data-testid="check-daily-changes" />
                После утренней сводки проверять каждый час и сообщать об изменениях
              </label>
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  Кому присылать сводку — отметьте только нужных. Остальные её не получат
                  <Badge variant="secondary" className="text-[11px]" data-testid="badge-daily-count">выбрано {picked.length}</Badge>
                </div>
                {linked.length === 0 ? (
                  <Empty text="Никто не привязан к боту. Раздайте ссылки в «Сотрудники и вахты» → «Настройка уведомлений»." />
                ) : (
                  <div className="flex flex-wrap gap-2" data-testid="list-daily-recipients">
                    {linked.map((r: any) => {
                      const id = String(r.chatId);
                      const on = picked.includes(id);
                      return (
                        <label key={id} className={`flex items-center gap-2 rounded-md border px-2 py-1 ${on ? "border-primary bg-muted" : ""}`}
                          data-testid={`daily-recipient-${r.employeeId}`}>
                          <Checkbox checked={on} onCheckedChange={(v) => toggle(id, !!v)} />
                          {r.fio}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
                Каждый час программа забирает почту и пересчитывает сводку за вчерашние сутки. В указанное
                окно сводка уходит получателям один раз. Если потом участок дошлёт или поправит данные —
                придёт короткое сообщение, что именно изменилось. Сводку получают только отмеченные здесь
                люди — остальным бот её не покажет, даже по команде «сводка».
              </div>
              <Button size="sm" variant="outline" onClick={() => runNow.mutate()} disabled={runNow.isPending} data-testid="button-daily-run">
                <RefreshCw className={`mr-2 h-4 w-4 ${runNow.isPending ? "animate-spin" : ""}`} />
                Проверить почту и пересчитать сейчас
              </Button>
            </div>
          )}
        </Section>

        <Section title="Архив сводок" description="Каждая редакция сохраняется, когда меняются цифры">
          {(archive.data?.rows ?? []).length === 0 ? <Empty text="Архив пока пуст." /> : (
            <div className="max-h-[360px] space-y-1 overflow-y-auto" data-testid="list-daily-archive">
              {(archive.data?.rows ?? []).map((r: any) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => { setViewId(r.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/50 ${viewId === r.id ? "border-primary" : ""}`}
                  data-testid={`archive-item-${r.id}`}
                >
                  <span className="flex items-center gap-2">
                    <History className="h-4 w-4 text-muted-foreground" />
                    <b>{ru(r.report_date)}</b>
                    <span className="text-muted-foreground">ред. {r.version}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {r.reason}
                    {r.sent ? <Badge variant="secondary" className="text-[10px]">отправлена</Badge> : null}
                    <span>{dt(r.created_at)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function FragmentRows({ o }: { o: any }) {
  const note = !o.reported
    ? (o.lastDate ? `нет сводки за сутки · последние данные ${ru(o.lastDate)}${o.lastFile ? ` (файл ${o.lastFile})` : ""}` : "сводка не поступает")
    : "";
  return (
    <>
      <tr className="border-b bg-muted/40 font-semibold" data-testid={`row-daily-object-${o.object}`}>
        <td className="py-2 pr-2">
          {o.object}
          {o.refName && o.refName !== o.object && <span className="ml-1 text-xs font-normal text-muted-foreground">(в справочнике «{o.refName}»)</span>}
          {note && <div className="text-xs font-normal text-amber-700 dark:text-amber-400">{note}</div>}
          {!o.planMonth && <div className="text-xs font-normal text-muted-foreground">план не задан в справочнике</div>}
        </td>
        <td />
        <td />
        <td className="py-2 pr-2 text-right">{nf(o.day)}</td>
        <td className="py-2 pr-2 text-right">{nf(o.month)}</td>
        <td className="py-2 pr-2 text-right">{nf(o.year)}</td>
        <td className="py-2 pr-2 text-right">{o.planMonth ? nf(o.planMonth) : "—"}</td>
        <td className="py-2 pr-2 text-right">{o.planMonth ? (o.remaining > 0 ? nf(o.remaining) : "выполнен") : "—"}</td>
        <td className="py-2 pr-2 text-right">{lagCell(o.lag, o.planMonth)}</td>
        <td className="py-2 text-right">{o.planMonth ? `${o.pct}%` : "—"}</td>
      </tr>
      {o.workers.map((w: any) => (
        <tr key={w.name} className={`border-b ${w.onDay ? "" : "text-muted-foreground"}`} data-testid={`row-daily-worker-${w.name}`}>
          <td className="py-1.5 pl-4 pr-2">
            {w.name}
            {w.day === 0 && w.comment && <div className="text-xs text-muted-foreground">{w.comment}</div>}
          </td>
          <td className="py-1.5 pr-2 text-xs">{w.rig}</td>
          <td className="py-1.5 pr-2 text-right">{w.onDay ? nf(w.day) : "—"}</td>
          <td />
          <td className="py-1.5 pr-2 text-right">{nf(w.month)}</td>
          <td className="py-1.5 pr-2 text-right">{nf(w.year)}</td>
          <td colSpan={4} />
        </tr>
      ))}
    </>
  );
}

/* ============================ Почта ============================ */

export function MailTab() {
  const { toast } = useToast();
  const settings = useQuery<any>({ queryKey: ["/api/pbk/mail/settings"] });
  const log = useQuery<any>({ queryKey: ["/api/pbk/mail/log"] });
  const [form, setForm] = useState<any>(null);
  const [password, setPassword] = useState("");
  useEffect(() => {
    if (settings.data && !form) setForm({ ...settings.data, senders: String(settings.data.senders ?? "").split(", ").filter(Boolean).join("\n") });
  }, [settings.data, form]);

  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/pbk/mail/settings", { ...form, password })).json(),
    onSuccess: (d: any) => {
      setPassword("");
      setForm({ ...d, senders: String(d.senders ?? "").split(", ").filter(Boolean).join("\n") });
      queryClient.invalidateQueries({ queryKey: ["/api/pbk/mail/settings"] });
      toast({ title: "Настройки почты сохранены", description: `Адресов отправителей: ${d.senderCount}` });
    },
    onError: (e: any) => toast({ title: "Не сохранено", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const test = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/pbk/mail/test", {})).json(),
    onSuccess: (d: any) => toast({ title: "Подключение работает", description: `Писем в папке: ${d.messages}, непрочитанных: ${d.unseen}` }),
    onError: (e: any) => toast({ title: "Нет подключения", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const check = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/pbk/mail/check", {})).json(),
    onSuccess: (d: any) => {
      queryClient.invalidateQueries();
      toast({
        title: d.accepted ? `Принято файлов: ${d.accepted}` : "Новых сводок нет",
        description: `Писем за период ${d.scanned}, от ваших адресов новых ${d.fromAllowed}, не принято ${d.rejected}`,
      });
    },
    onError: (e: any) => toast({ title: "Не получилось", description: String(e?.message ?? e), variant: "destructive" }),
  });

  if (!form) return <Loading />;
  const senderCount = String(form.senders ?? "").split(/[\s,;]+/).filter((x: string) => x.includes("@")).length;

  return (
    <div className="space-y-4">
      <Section
        title="Почтовый ящик для сводок"
        description="Программа раз в час забирает Excel-вложения только от адресов из списка"
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => test.mutate()} disabled={test.isPending} data-testid="button-mail-test">
              <Plug className="mr-2 h-4 w-4" />Проверить подключение
            </Button>
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-mail-save">
              <Save className="mr-2 h-4 w-4" />Сохранить
            </Button>
          </div>
        )}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 text-sm">
            <label className="flex items-center gap-3">
              <Switch checked={!!form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} data-testid="switch-mail-enabled" />
              Забирать сводки с почты каждый час
            </label>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Адрес ящика</label>
              <Input value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })}
                placeholder="svodki@mail.ru" data-testid="input-mail-user" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Пароль для внешнего приложения {form.hasPassword && <span className="text-emerald-600">— задан, оставьте пустым, чтобы не менять</span>}
              </label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder={form.hasPassword ? "••••••••" : "пароль приложения из настроек Mail.ru"} autoComplete="new-password"
                data-testid="input-mail-password" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Сервер IMAP</label>
                <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} data-testid="input-mail-host" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Порт</label>
                <Input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} data-testid="input-mail-port" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Папка</label>
                <Input value={form.folder} onChange={(e) => setForm({ ...form, folder: e.target.value })} data-testid="input-mail-folder" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Смотреть письма за, дней</label>
                <Input type="number" min={1} max={30} value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })} data-testid="input-mail-days" />
              </div>
            </div>
            <div className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
              Для Mail.ru обычный пароль не подойдёт. Откройте почту → Настройки → Безопасность →
              «Пароли для внешних приложений», создайте пароль с доступом к IMAP и вставьте его сюда.
              Письма в ящике не удаляются и не помечаются прочитанными.
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <label className="block text-xs font-medium text-muted-foreground">
              С каких адресов брать сводки — по одному в строке
            </label>
            <Textarea
              rows={9} value={form.senders} onChange={(e) => setForm({ ...form, senders: e.target.value })}
              placeholder={"master.veduga@mail.ru\nergozhu@bk.ru\n@pbk-geo.ru"}
              className="font-mono text-sm" data-testid="input-mail-senders"
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary" data-testid="badge-mail-senders">адресов: {senderCount}</Badge>
              Чтобы принимать письма со всего домена, впишите его с собачкой: <code>@pbk-geo.ru</code>
            </div>
            <div className="rounded-md border p-2 text-xs text-muted-foreground">
              Письма от других адресов программа не открывает. Файл принимается, только если в нём
              распознана сводка бурения или ЦПП, — иначе он попадает в журнал как «не принят». Новый
              файл с тем же именем заменяет прежний, оригиналы всех вложений сохраняются в архиве почты.
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Журнал почты"
        description={form.lastCheck ? `Последняя проверка ${dt(form.lastCheck)}: ${form.lastResult}` : "Проверок ещё не было"}
        actions={(
          <Button size="sm" variant="outline" onClick={() => check.mutate()} disabled={check.isPending} data-testid="button-mail-check">
            <Mail className={`mr-2 h-4 w-4 ${check.isPending ? "animate-pulse" : ""}`} />Забрать почту сейчас
          </Button>
        )}
      >
        {(log.data?.rows ?? []).length === 0 ? <Empty text="Писем от ваших адресов ещё не было." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm" data-testid="table-mail-log">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-2">Когда</th>
                  <th className="py-2 pr-2">От кого</th>
                  <th className="py-2 pr-2">Файл</th>
                  <th className="py-2 pr-2">Итог</th>
                  <th className="py-2">Пояснение</th>
                </tr>
              </thead>
              <tbody>
                {(log.data?.rows ?? []).map((r: any) => (
                  <tr key={r.id} className="border-b" data-testid={`mail-log-${r.id}`}>
                    <td className="py-1.5 pr-2 text-xs text-muted-foreground">{dt(r.received_at || r.checked_at)}</td>
                    <td className="py-1.5 pr-2">{r.from_addr}<div className="text-xs text-muted-foreground">{r.subject}</div></td>
                    <td className="py-1.5 pr-2 text-xs">{r.file || "—"}</td>
                    <td className="py-1.5 pr-2">
                      <Badge variant={r.status === "принят" ? "default" : r.status === "не принят" ? "destructive" : "secondary"}>{r.status}</Badge>
                    </td>
                    <td className="py-1.5 text-xs text-muted-foreground">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

/* ============================ Загруженные сводки ============================ */

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;

export function FilesTab() {
  const { toast } = useToast();
  const files = useQuery<any>({ queryKey: ["/api/pbk/files"] });
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<any>(null);
  const [confirmDel, setConfirmDel] = useState("");

  const upload = async (list: FileList | null) => {
    if (!list || !list.length) return;
    setBusy(true);
    try {
      const fd = new FormData();
      Array.from(list).forEach((f) => fd.append("files", f, f.name));
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/pbk/upload`, {
        method: "POST", body: fd, headers: token ? { "x-auth-token": token } : {},
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out?.error ?? "Не удалось загрузить");
      setLast(out);
      queryClient.invalidateQueries();
      toast({
        title: out.accepted?.length ? `Добавлено сводок: ${out.accepted.length}` : "Ни одна сводка не принята",
        description: out.rejected?.length ? `Не принято: ${out.rejected.map((r: any) => r.file).join(", ")}` : "Сводка и аналитика пересчитаны",
        variant: out.accepted?.length ? undefined : "destructive",
      });
    } catch (e: any) {
      toast({ title: "Ошибка загрузки", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const del = useMutation({
    mutationFn: async (name: string) => (await apiRequest("DELETE", `/api/pbk/files/${encodeURIComponent(name)}`)).json(),
    onSuccess: () => {
      setConfirmDel("");
      queryClient.invalidateQueries();
      toast({ title: "Сводка убрана, данные пересчитаны", description: "Файл перенесён в корзину на сервере, его можно вернуть." });
    },
    onError: (e: any) => toast({ title: "Не удалено", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const rows: any[] = files.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <Section
        title="Добавить сводки вручную"
        description="Буровые сводки участков и сводки ЦПП в Excel (.xls, .xlsx), можно сразу несколько"
        actions={(
          <label className={`inline-flex cursor-pointer items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground ${busy ? "opacity-60" : ""}`}
            data-testid="button-files-upload">
            <Upload className="mr-2 h-4 w-4" />
            {busy ? "Загружаю…" : "Выбрать файлы"}
            <input type="file" accept=".xls,.xlsx" multiple className="hidden" disabled={busy}
              onChange={(e) => { upload(e.target.files); e.currentTarget.value = ""; }} data-testid="input-files-upload" />
          </label>
        )}
      >
        <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-3">
          <div className="rounded-md bg-muted p-3">
            <b className="text-foreground">Старые периоды.</b> Можно добавить сводку за прошлые месяцы, например Ергожу за
            март–июль, — она дополнит текущую, и итоги за год станут полными.
          </div>
          <div className="rounded-md bg-muted p-3">
            <b className="text-foreground">Без двойного счёта.</b> Если один месяц участка есть в двух файлах, берётся тот,
            где месяц заполнен полнее. Какой файл выбран — видно в списке ниже.
          </div>
          <div className="rounded-md bg-muted p-3">
            <b className="text-foreground">То же имя — замена.</b> Файл с тем же именем заменяет прежний. Чужие файлы
            (не сводки) программа не примет. Сотрудники, вахты и планы при загрузке не меняются.
          </div>
        </div>
        {last && (last.rejected?.length > 0 || last.replaced?.length > 0) && (
          <div className="mt-3 space-y-1 text-sm" data-testid="box-files-last">
            {last.replaced?.length > 0 && <div>Заменены прежние версии: {last.replaced.join(", ")}</div>}
            {last.rejected?.map((r: any) => (
              <div key={r.file} className="text-red-600 dark:text-red-400">Не принят {r.file}: {r.reason}</div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Загруженные сводки" description={`Файлов: ${rows.length}. Периоды — по заполненным дням`}>
        {files.isLoading ? <Loading /> : rows.length === 0 ? <Empty text="Сводок пока нет." /> : (
          <div className="space-y-2" data-testid="list-files">
            {rows.map((r) => (
              <div key={r.file} className="rounded-md border p-3" data-testid={`file-${r.file}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.file}</span>
                    <Badge variant="secondary" className="text-[11px]">{r.source}</Badge>
                    <span className="text-xs text-muted-foreground">загружен {dt(r.uploadedAt)}</span>
                  </div>
                  {confirmDel === r.file ? (
                    <div className="flex items-center gap-2 text-xs">
                      Убрать сводку и пересчитать?
                      <Button size="sm" variant="destructive" onClick={() => del.mutate(r.file)} disabled={del.isPending}
                        data-testid={`button-file-delete-yes-${r.file}`}>Да, убрать</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDel("")}>Отмена</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDel(r.file)} data-testid={`button-file-delete-${r.file}`}>
                      <Trash2 className="mr-1 h-4 w-4" />Убрать
                    </Button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {r.drill.map((d: any) => (
                    <span key={d.object} className="rounded bg-muted px-2 py-1">
                      <b>{d.object}</b>: {ru(d.d1)} — {ru(d.d2)} · {nf(Math.round(d.m))} м
                    </span>
                  ))}
                  {r.prep.map((p: any, i: number) => (
                    <span key={`p${i}`} className="rounded bg-muted px-2 py-1">
                      <b>ЦПП</b>: {ru(p.d1)} — {ru(p.d2)} · дроблено {nf(p.c)}
                    </span>
                  ))}
                  {!r.drill.length && !r.prep.length && <span className="text-muted-foreground">бурения и ЦПП в файле нет или все месяцы взяты из других файлов</span>}
                </div>
                {r.droppedMonths.length > 0 && (
                  <div className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                    Не учтены, потому что полнее в другом файле:{" "}
                    {r.droppedMonths.map((m: any) => `${m.object}, ${monthName(m.month)} (взят из ${m.kept})`).join("; ")}
                  </div>
                )}
                {r.keptMonths.length > 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Этот файл выбран для: {r.keptMonths.map((m: any) => `${m.object}, ${monthName(m.month)}`).join("; ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
