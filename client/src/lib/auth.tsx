import { createContext, useContext, useState, type ReactNode } from "react";
import { apiRequest, setAuthToken, queryClient } from "@/lib/queryClient";

export type Perm = {
  label: string; hint: string; sections: string[];
  write: boolean; finance: boolean; manageUsers: boolean;
  allObjects: boolean; personal: boolean;
};

export type SessionUser = {
  id: number; login: string; fio: string; role: string;
  roleLabel: string; roleHint: string; objects: number[]; perm: Perm;
};

type Ctx = {
  user: SessionUser | null;
  login: (login: string, password: string) => Promise<void>;
  logout: () => void;
  can: (section: string) => boolean;
  /** Перечитать права после изменения состава программы */
  refresh: () => Promise<void>;
  finance: boolean;
  write: boolean;
};

const AuthContext = createContext<Ctx>({
  user: null, login: async () => {}, logout: () => {},
  can: () => false, refresh: async () => {}, finance: false, write: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);

  const login = async (loginName: string, password: string) => {
    const res = await apiRequest("POST", "/api/auth/login", { login: loginName, password });
    const data = await res.json();
    setAuthToken(data.token);
    queryClient.clear();
    setUser(data.user as SessionUser);
  };

  const logout = () => {
    apiRequest("POST", "/api/auth/logout").catch(() => { /* сессия уже закрыта */ });
    setAuthToken("");
    queryClient.clear();
    setUser(null);
    window.location.hash = "#/";
  };

  const can = (section: string) => !!user?.perm?.sections?.includes(section);

  /** После изменения состава программы права меняются без перезахода */
  const refresh = async () => {
    try {
      const res = await apiRequest("GET", "/api/auth/me");
      setUser((await res.json()) as SessionUser);
    } catch { /* сессия закрыта — оставляем как есть */ }
  };

  return (
    <AuthContext.Provider
      value={{ user, login, logout, can, refresh, finance: !!user?.perm?.finance, write: !!user?.perm?.write }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
