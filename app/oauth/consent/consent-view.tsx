"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Loader2, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/provider";

interface Details {
  clientName: string;
  scopes: string[];
}

// The OAuth server API of supabase-js, typed locally so a version difference in
// the shipped types cannot break the build. Shapes follow the Supabase docs.
interface OAuthApi {
  getAuthorizationDetails(id: string): Promise<{
    data: {
      authorization_id?: string;
      redirect_url?: string;
      client?: { name?: string };
      scope?: string;
    } | null;
    error: { message: string } | null;
  }>;
  approveAuthorization(id: string): Promise<{ data: { redirect_url?: string } | null; error: { message: string } | null }>;
  denyAuthorization(id: string): Promise<{ data: { redirect_url?: string } | null; error: { message: string } | null }>;
}

/** Consent screen: "Claude wants to access your workspace". */
export function ConsentView({ authorizationId }: { authorizationId: string | null }) {
  const t = useT("oauth");
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const oauth = () => (createClient().auth as unknown as { oauth: OAuthApi }).oauth;

  useEffect(() => {
    if (!authorizationId) {
      setError(t("missingRequest"));
      return;
    }
    (async () => {
      const { data, error: err } = await oauth().getAuthorizationDetails(authorizationId);
      if (err || !data) {
        setError(t("loadFailed"));
        return;
      }
      // Already approved before: Supabase hands back where to send the user.
      if (!data.authorization_id && data.redirect_url) {
        window.location.href = data.redirect_url;
        return;
      }
      setDetails({
        clientName: data.client?.name || t("unknownClient"),
        scopes: (data.scope ?? "").split(" ").filter(Boolean),
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorizationId]);

  async function decide(approve: boolean) {
    if (!authorizationId) return;
    setBusy(true);
    setError(null);
    const api = oauth();
    const { data, error: err } = approve
      ? await api.approveAuthorization(authorizationId)
      : await api.denyAuthorization(authorizationId);
    if (err || !data?.redirect_url) {
      setError(t("decideFailed"));
      setBusy(false);
      return;
    }
    window.location.href = data.redirect_url;
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <Image src="/logo.png" alt="ZernFlow" width={48} height={48} className="mx-auto mb-3" />
          <h1 className="text-xl font-bold">
            {details ? t("title", { client: details.clientName }) : t("titleLoading")}
          </h1>
        </div>

        {error && <p className="rounded-lg border border-red-600/30 bg-red-600/10 p-3 text-sm text-red-600">{error}</p>}

        {!details && !error && <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />}

        {details && (
          <>
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                {t("willBeAbleTo")}
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>{t("canRead")}</li>
                <li>{t("canWrite")}</li>
                <li>{t("limits")}</li>
              </ul>
            </div>
            <p className="text-xs text-muted-foreground">{t("revokeHint")}</p>
            <div className="flex gap-3">
              <button
                onClick={() => decide(false)}
                disabled={busy}
                className="flex-1 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                {t("deny")}
              </button>
              <button
                onClick={() => decide(true)}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("allow")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
