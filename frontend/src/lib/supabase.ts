/**
 * Compatibility shim for the local desktop build.
 *
 * The original web app called `supabase.auth.getSession()` directly from many
 * components and hooks. In the local desktop build, the JWT comes from the
 * Electron main process (the lock screen issues it after the user enters their
 * password). This shim exposes the same `supabase.auth.*` surface the rest of
 * the app already calls, but backs it with `window.mike.*` IPC.
 *
 * `supabase.from(...)` is intentionally not implemented — direct DB access from
 * the browser is replaced by routed backend calls in PHASE-04. Any caller still
 * reaching for it will throw, which is a useful signal during the migration.
 */

interface MikeBridge {
    getToken: () => Promise<string | null>;
    getUser: () => Promise<{ id: string; email: string } | null>;
}

declare global {
    interface Window {
        mike?: MikeBridge & Record<string, unknown>;
    }
}

interface Session {
    access_token: string;
    user: { id: string; email: string };
}

interface AuthChangeListener {
    (event: string, session: Session | null): void | Promise<void>;
}

async function readBridge(): Promise<{ token: string; user: { id: string; email: string } } | null> {
    if (typeof window === "undefined") return null;
    const bridge = window.mike;
    if (!bridge?.getToken || !bridge?.getUser) return null;
    const [token, user] = await Promise.all([bridge.getToken(), bridge.getUser()]);
    if (!token || !user) return null;
    return { token, user };
}

export const supabase = {
    auth: {
        async getSession(): Promise<{ data: { session: Session | null }; error: null }> {
            const bridge = await readBridge();
            if (!bridge) return { data: { session: null }, error: null };
            return {
                data: {
                    session: {
                        access_token: bridge.token,
                        user: bridge.user,
                    },
                },
                error: null,
            };
        },
        async getUser(_token?: string): Promise<{ data: { user: { id: string; email: string } | null }; error: null }> {
            const bridge = await readBridge();
            return { data: { user: bridge?.user ?? null }, error: null };
        },
        async signOut(): Promise<{ error: null }> {
            // The Electron main process owns the session lifecycle; the only way
            // to "sign out" in the local app is to quit and re-open. We don't
            // surface logout in the desktop UI yet, so this is a no-op.
            return { error: null };
        },
        onAuthStateChange(_cb: AuthChangeListener): {
            data: { subscription: { unsubscribe: () => void } };
        } {
            // Auth state in the desktop app is set once at unlock and doesn't
            // change while the window is open. Returning a no-op subscription
            // keeps existing callers happy.
            return {
                data: { subscription: { unsubscribe: () => {} } },
            };
        },
    },
    from(_table: string): never {
        throw new Error(
            "Direct database access via supabase.from() is not supported in the local desktop build. Route the call through the backend API.",
        );
    },
};
