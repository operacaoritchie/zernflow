"use client";

import { useEffect } from "react";

// Old recovery links open the Site URL with the tokens in the hash
// (#access_token=...&type=recovery). Send them to the new-password page,
// keeping the hash so the page can read the session from it.
export function RecoveryRedirect() {
  useEffect(() => {
    const { hash, pathname } = window.location;
    if (pathname !== "/reset-password" && hash.includes("type=recovery")) {
      window.location.replace(`/reset-password${hash}`);
    }
  }, []);
  return null;
}
