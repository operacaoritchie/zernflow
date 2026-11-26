"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { LOCALE_COOKIE, isLocale } from "./config";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Save the interface language: in a cookie for this browser and, when signed
 * in, in the user's metadata so it follows them to other devices.
 */
export async function setLocale(locale: string) {
  if (!isLocale(locale)) return { error: "invalid_locale" };

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: ONE_YEAR,
    sameSite: "lax",
  });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user && user.user_metadata?.locale !== locale) {
    await supabase.auth.updateUser({ data: { locale } });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
