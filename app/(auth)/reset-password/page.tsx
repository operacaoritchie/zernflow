"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/provider";

type Status = "checking" | "ready" | "invalid";

export default function ResetPasswordPage() {
  const t = useT("auth");
  const router = useRouter();
  const supabase = createClient();
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // The recovery link arrives either with a session already set by
  // /auth/confirm (cookie), with ?code= (PKCE), or with the tokens in the
  // URL hash (older links). Handle all three, then show the form.
  useEffect(() => {
    let cancelled = false;

    async function prepare() {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const code = new URLSearchParams(window.location.search).get("code");

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        // Remove the tokens from the address bar.
        window.history.replaceState(null, "", window.location.pathname);
        if (error) return cancelled ? undefined : setStatus("invalid");
      } else if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        window.history.replaceState(null, "", window.location.pathname);
        if (error) return cancelled ? undefined : setStatus("invalid");
      }

      const { data } = await supabase.auth.getUser();
      if (!cancelled) setStatus(data.user ? "ready" : "invalid");
    }

    prepare();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError(t("tooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t("mismatch"));
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Make the person sign in with the new password.
    await supabase.auth.signOut();
    router.push("/login?reset=ok");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <Image src="/logo.png" alt="ZernFlow" width={48} height={48} className="mx-auto mb-3" />
          <h1 className="text-2xl font-bold">{t("resetTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {status === "checking"
              ? t("checking")
              : status === "invalid"
                ? t("invalidLink")
                : t("resetSubtitle")}
          </p>
        </div>

        {status === "ready" && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1.5">
                {t("newPassword")}
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder={t("passwordMin")}
              />
            </div>

            <div>
              <label htmlFor="confirm" className="block text-sm font-medium mb-1.5">
                {t("confirmPassword")}
              </label>
              <input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {loading ? t("saving") : t("save")}
            </button>
          </form>
        )}

        {status === "invalid" && (
          <div className="space-y-3 text-center text-sm">
            <Link
              href="/forgot-password"
              className="block w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground hover:opacity-90"
            >
              {t("sendLink")}
            </Link>
          </div>
        )}

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="font-medium text-foreground hover:underline">
            {t("backToLogin")}
          </Link>
        </p>
      </div>
    </div>
  );
}
