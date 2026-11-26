import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n/config";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Keep the language cookie in sync with the language saved on the user, so
  // the choice follows them to every device they sign in from.
  const savedLocale = user?.user_metadata?.locale;
  if (isLocale(savedLocale) && request.cookies.get(LOCALE_COOKIE)?.value !== savedLocale) {
    request.cookies.set(LOCALE_COOKIE, savedLocale);
    const refreshed = NextResponse.next({ request });
    supabaseResponse.cookies.getAll().forEach((cookie) => refreshed.cookies.set(cookie));
    supabaseResponse = refreshed;
    supabaseResponse.cookies.set(LOCALE_COOKIE, savedLocale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }

  const pathname = request.nextUrl.pathname;

  const isAuthPage = pathname === "/login" || pathname === "/register";
  const isAuthCallback = pathname === "/auth/callback";
  const isDashboard = pathname.startsWith("/dashboard");
  const isApiRoute = pathname.startsWith("/api/");

  // Auth callback and API routes (including webhooks) always pass through
  if (isAuthCallback || isApiRoute) {
    return supabaseResponse;
  }

  // Redirect logged-in users away from auth pages to dashboard
  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    const redirectResponse = NextResponse.redirect(url);
    // Forward any refreshed session cookies
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    return redirectResponse;
  }

  // Redirect unauthenticated users trying to access dashboard to login
  if (!user && isDashboard) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirectResponse = NextResponse.redirect(url);
    // Forward any refreshed session cookies
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    return redirectResponse;
  }

  return supabaseResponse;
}
