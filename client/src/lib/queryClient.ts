import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

/**
 * Токен входа хранится в localStorage браузера, поэтому вход не теряется
 * при обновлении страницы (F5) и при возврате в программу позже.
 * В памяти держим копию — чтение из localStorage на каждый запрос не нужно.
 */
const TOKEN_KEY = "grr-control.token";

function readStoredToken(): string {
  try { return window.localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
}

let authToken = readStoredToken();

export function setAuthToken(token: string) {
  authToken = token;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch { /* приватный режим браузера — вход проживёт до закрытия вкладки */ }
}

export function getAuthToken() { return authToken; }
const authHeaders = (): Record<string, string> => (authToken ? { "x-auth-token": authToken } : {});

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let message = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) message = String(parsed.error);
    } catch {
      /* не JSON — показываем как есть */
    }
    throw new Error(message);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: data
      ? { "Content-Type": "application/json", ...authHeaders() }
      : { ...authHeaders() },
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, { headers: authHeaders() });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
