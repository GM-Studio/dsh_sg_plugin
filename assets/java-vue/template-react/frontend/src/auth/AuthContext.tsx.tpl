import { createContext, useContext, type ReactNode } from 'react';
import type { User } from '../api/types';

/** Authenticated account shared with every routed page. */
export interface AuthValue {
  user: User | null;
}

export const AuthContext = createContext<AuthValue>({ user: null });

export function AuthProvider({
  user,
  children,
}: {
  user: User | null;
  children?: ReactNode;
}) {
  return (
    <AuthContext.Provider value={{ user }}>{children}</AuthContext.Provider>
  );
}

/** Reads the authenticated account; pages render inside the provider. */
export function useAuth(): AuthValue {
  return useContext(AuthContext);
}
