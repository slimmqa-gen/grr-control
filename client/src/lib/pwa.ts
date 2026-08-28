/** Установка приложения на телефон и компьютер: регистрация service worker и кнопка «Установить». */

export type InstallPlatform = "android" | "ios" | "desktop" | "unknown";

export type PwaState = {
  supported: boolean;      // браузер умеет service worker
  registered: boolean;     // service worker зарегистрирован
  canPrompt: boolean;      // браузер предложил встроенное окно установки
  installed: boolean;      // уже открыто как приложение
  inIframe: boolean;       // превью внутри iframe — установка недоступна, это нормально
  secure: boolean;         // https или localhost
  reason: string;          // пояснение на русском, если установка недоступна
};

let deferredPrompt: any = null;
const listeners = new Set<(s: PwaState) => void>();

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    window.matchMedia?.("(display-mode: minimal-ui)").matches === true ||
    (window.navigator as any).standalone === true
  );
}

export function inIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function detectPlatform(): InstallPlatform {
  const ua = navigator.userAgent || "";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document)) return "ios";
  if (/windows|macintosh|linux|cros/i.test(ua)) return "desktop";
  return "unknown";
}

let state: PwaState = {
  supported: false,
  registered: false,
  canPrompt: false,
  installed: false,
  inIframe: false,
  secure: false,
  reason: "",
};

function emit(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

export function getPwaState(): PwaState {
  return state;
}

export function subscribePwa(fn: (s: PwaState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

/** Показать встроенное окно установки браузера. Возвращает true, если пользователь согласился. */
export type PromptResult = "accepted" | "dismissed" | "unavailable";

/** Показ встроенного окна установки браузера, если оно доступно */
export async function promptInstall(): Promise<PromptResult> {
  if (!deferredPrompt) return "unavailable";
  const p = deferredPrompt;
  deferredPrompt = null;
  emit({ canPrompt: false });
  try {
    await p.prompt();
    const choice = await p.userChoice;
    if (choice?.outcome === "accepted") {
      emit({ installed: true });
      return "accepted";
    }
    return "dismissed";
  } catch {
    return "unavailable";
  }
}

/**
 * Регистрация service worker. Вызывается один раз при запуске.
 * В превью внутри iframe и по http регистрация не выполняется — это ожидаемо
 * и не должно приводить к ошибкам в консоли.
 */
export function setupPwa() {
  if (typeof window === "undefined") return;

  const frame = inIframe();
  const secure = window.isSecureContext === true;
  const supported = "serviceWorker" in navigator;

  emit({
    supported,
    secure,
    inIframe: frame,
    installed: isStandalone(),
    reason: !supported
      ? "Браузер не поддерживает установку веб-приложений. Откройте программу в Chrome, Edge или Safari."
      : frame
        ? "Программа открыта в окне предпросмотра. Чтобы установить её на устройство, откройте ссылку в отдельной вкладке браузера."
        : !secure
          ? "Установка возможна только по защищённому адресу https."
          : "",
  });

  window.addEventListener("beforeinstallprompt", (e: any) => {
    e.preventDefault();
    deferredPrompt = e;
    emit({ canPrompt: true });
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    emit({ canPrompt: false, installed: true });
  });

  if (!supported || !secure || frame) return;

  window.addEventListener("load", () => {
    const url = new URL("sw.js", document.baseURI);
    const scope = new URL("./", document.baseURI);
    navigator.serviceWorker
      .register(url.href, { scope: scope.href })
      .then(() => emit({ registered: true }))
      .catch(() => {
        // Тихо: в песочнице и по http регистрация недоступна, работа программы не страдает
        emit({ registered: false });
      });
  });
}
