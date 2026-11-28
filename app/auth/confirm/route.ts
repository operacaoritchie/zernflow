import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Landing point of the links in the Supabase e-mails (confirm sign-up,
// password recovery, magic link, e-mail change). The e-mail template builds:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<type>&next=<path>
const TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const rawNext = searchParams.get("next") ?? "/login";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/login";

  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

    if (!error) {
      if (type === "recovery") {
        // Session is now set by cookie: go straight to the new-password form.
        return NextResponse.redirect(`${origin}/reset-password`);
      }
      // E-mail confirmed: send the person to the login (no auto sign-in).
      await supabase.auth.signOut();
      const url = new URL(next, origin);
      if (next === "/login") url.searchParams.set("confirmed", "1");
      return NextResponse.redirect(url);
    }
  }

  const failure = type === "recovery" ? "/reset-password" : "/login?error=confirm";
  return NextResponse.redirect(`${origin}${failure}`);
}
