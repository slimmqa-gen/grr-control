import { useEffect, useState } from "react";
import { Smartphone, Monitor, Apple, Download, CheckCircle2, Info, WifiOff, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Section } from "@/components/shell";
import { useToast } from "@/hooks/use-toast";
import { getPwaState, promptInstall, subscribePwa, detectPlatform, type PwaState } from "@/lib/pwa";

const STEPS: Record<string, { icon: any; title: string; steps: string[] }> = {
  android: {
    icon: Smartphone,
    title: "Android — Chrome",
    steps: [
      "Откройте программу в Chrome по её адресу.",
      "Нажмите ⋮ (три точки) справа сверху.",
      "Выберите «Установить приложение» (или «Добавить на главный экран»).",
      "Подтвердите — на рабочем столе появится значок «ГРР».",
    ],
  },
  ios: {
    icon: Apple,
    title: "iPhone и iPad — Safari",
    steps: [
      "Откройте программу именно в Safari (в Chrome на iPhone установка недоступна).",
      "Нажмите кнопку «Поделиться» — квадрат со стрелкой вверх, снизу экрана.",
      "Пролистайте список и выберите «На экран „Домой“».",
      "Нажмите «Добавить» — значок «ГРР» появится на экране Домой.",
    ],
  },
  desktop: {
    icon: Monitor,
    title: "Windows и macOS — Chrome или Edge",
    steps: [
      "Откройте программу в Chrome или Edge.",
      "В адресной строке справа нажмите значок установки (монитор со стрелкой) либо меню ⋮ → «Установить ГРР-Контроль».",
      "Подтвердите установку — программа откроется в отдельном окне, без адресной строки.",
      "Ярлык останется в меню «Пуск» / в Launchpad, его можно закрепить на панели задач.",
    ],
  },
};

export default function InstallPage() {
  const { toast } = useToast();
  const [state, setState] = useState<PwaState>(getPwaState());
  const platform = detectPlatform();

  useEffect(() => subscribePwa(setState), []);

  const install = async () => {
    const r = await promptInstall();
    if (r === "accepted") toast({ title: "Готово", description: "Программа установлена — запускайте с рабочего стола." });
    else if (r === "dismissed") toast({ title: "Установка отменена", description: "Можно вернуться к ней позже." });
    else
      toast({
        title: "Кнопка недоступна в этом браузере",
        description: "Установите вручную по инструкции ниже — она занимает 15 секунд.",
      });
  };

  const order = platform === "ios" ? ["ios", "android", "desktop"] : platform === "android" ? ["android", "ios", "desktop"] : ["desktop", "android", "ios"];

  return (
    <div data-testid="page-install">
      <PageHeader
        title="Установка на телефон и компьютер"
        subtitle="ГРР-Контроль ставится как обычное приложение: свой значок, отдельное окно, запуск без браузера."
      />

      <Section
        className="mb-4"
        title="Установить сейчас"
        description="Если браузер поддерживает установку в один клик — кнопка активна. Иначе используйте инструкцию для вашего устройства."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={install} disabled={state.installed} data-testid="button-install-app">
            <Download className="mr-2 h-4 w-4" />
            {state.installed ? "Уже установлено" : "Установить"}
          </Button>
          {state.installed && (
            <Badge variant="outline" className="gap-1" data-testid="badge-installed">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Запущено как приложение
            </Badge>
          )}
          {!state.installed && !state.canPrompt && (
            <span className="text-xs text-muted-foreground" data-testid="text-install-hint">
              {state.inIframe
                ? "Вы смотрите предпросмотр внутри страницы. Откройте адрес программы в отдельной вкладке — тогда установка станет доступна."
                : !state.secure
                  ? "Установка возможна только по https."
                  : "Этот браузер не показывает кнопку установки — сделайте это через меню браузера, шаги ниже."}
            </span>
          )}
        </div>
        <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <div className="flex items-start gap-2 rounded-md border p-2" data-testid="text-state-sw">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            Автономный режим: {state.registered ? "включён" : state.inIframe ? "недоступен в предпросмотре" : "включится после открытия по https"}
          </div>
          <div className="flex items-start gap-2 rounded-md border p-2">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
            Без сети программа откроется и покажет страницу «Нет подключения»; данные подтянутся, когда связь вернётся.
          </div>
          <div className="flex items-start gap-2 rounded-md border p-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            База и файлы остаются на сервере — установка не занимает место под данные.
          </div>
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-3">
        {order.map((key) => {
          const s = STEPS[key];
          const Icon = s.icon;
          const mine = key === platform;
          return (
            <Section
              key={key}
              title={s.title}
              description={mine ? "Похоже, это ваше устройство" : undefined}
              className={mine ? "border-primary" : undefined}
            >
              <div data-testid={`block-install-${key}`}>
                <Icon className="mb-3 h-5 w-5 text-primary" />
                <ol className="space-y-2 text-sm">
                  {s.steps.map((t, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-medium text-primary">
                        {i + 1}
                      </span>
                      <span className="text-muted-foreground">{t}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </Section>
          );
        })}
      </div>

      <Section className="mt-4" title="Частые вопросы">
        <dl className="space-y-3 text-sm">
          {[
            ["Нужен ли интернет?", "Да, для данных: смены, пробы и отчёты хранятся на сервере. Само приложение открывается и без сети — с понятным сообщением о подключении."],
            ["Обновления", "Устанавливать заново не нужно: программа обновляется сама при следующем запуске с сетью."],
            ["Сколько занимает места", "Меньше 5 МБ — только оболочка приложения и значки."],
            ["Как удалить", "Android: долгое нажатие на значок → «Удалить». iPhone: долгое нажатие → «Удалить закладку». Windows/macOS: меню ⋮ в окне программы → «Удалить ГРР-Контроль»."],
          ].map(([q, a]) => (
            <div key={q} className="rounded-md border p-3">
              <dt className="font-medium">{q}</dt>
              <dd className="mt-1 text-muted-foreground">{a}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}
