"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  GitBranch,
  LayoutDashboard,
  MessageSquare,
  Users,
  Radio,
  ListOrdered,
  BarChart3,
  Sprout,
  Plug,
  FileText,
  Settings,
  LogOut,
  Moon,
  Sun,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { useT } from "@/lib/i18n/provider";
/** Only what the menu shows. Never the full row: it carries API keys. */
interface Workspace {
  id: string;
  name: string;
}

interface WorkspaceItem {
  id: string;
  name: string;
  slug: string;
  role: string;
}

const navigation = [
  { key: "home", href: "/dashboard", icon: LayoutDashboard },
  { key: "flows", href: "/dashboard/flows", icon: GitBranch },
  { key: "inbox", href: "/dashboard/inbox", icon: MessageSquare },
  { key: "contacts", href: "/dashboard/contacts", icon: Users },
  { key: "broadcasts", href: "/dashboard/broadcasts", icon: Radio },
  { key: "sequences", href: "/dashboard/sequences", icon: ListOrdered },
  { key: "analytics", href: "/dashboard/analytics", icon: BarChart3 },
  { key: "growth", href: "/dashboard/growth", icon: Sprout },
  { key: "channels", href: "/dashboard/channels", icon: Plug },
  { key: "waTemplates", href: "/dashboard/whatsapp-templates", icon: FileText },
  { key: "settings", href: "/dashboard/settings", icon: Settings },
];

function subscribeToThemeClass(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/**
 * App menu as a top bar (Instagram-style, like the Central de Automação):
 * brand, workspace and account actions on the first row, sections as tabs
 * with an Instagram-gradient underline on the second. On phones the tabs
 * show only their icons, except the open one, and scroll sideways.
 */
export function TopNav({
  workspace,
  workspaces,
}: {
  workspace: Workspace;
  user: { id: string; email?: string };
  workspaces: WorkspaceItem[];
}) {
  const pathname = usePathname();
  const t = useT("nav");
  const router = useRouter();
  const supabase = createClient();
  const navRef = useRef<HTMLElement>(null);
  const dark = useSyncExternalStore(
    subscribeToThemeClass,
    () => document.documentElement.classList.contains("dark"),
    () => true
  );

  function toggleTheme() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const isItemActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);

  // Keep the open section's tab in view when the tabs scroll sideways.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && active && nav.scrollWidth > nav.clientWidth) {
      active.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [pathname]);

  const iconButton =
    "flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

  return (
    <header className="safe-top z-40 shrink-0 border-b border-border bg-background/90 backdrop-blur-lg">
      <div className="flex h-14 items-center gap-2 px-3 md:gap-4 md:px-5">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2" aria-label="ZernFlow">
          <span className="rounded-[10px] bg-ig-gradient p-[2px]">
            <Image
              src="/logo.png"
              alt=""
              width={26}
              height={26}
              className="rounded-lg border-2 border-background"
            />
          </span>
          <span className="hidden text-base font-bold tracking-tight text-ig-gradient sm:inline">
            ZernFlow
          </span>
        </Link>

        <div className="w-40 min-w-0 sm:w-56">
          <WorkspaceSwitcher current={workspace} workspaces={workspaces} />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <LocaleSwitcher className="hidden w-auto px-2 text-muted-foreground hover:bg-accent hover:text-foreground sm:flex" />
          <button
            onClick={toggleTheme}
            className={iconButton}
            aria-label={dark ? t("lightMode") : t("darkMode")}
            title={dark ? t("lightMode") : t("darkMode")}
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            onClick={handleSignOut}
            className={iconButton}
            aria-label={t("signOut")}
            title={t("signOut")}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      <nav
        ref={navRef}
        className="scrollbar-none flex gap-1 overflow-x-auto px-2 md:px-4 [mask-image:linear-gradient(90deg,transparent,#000_12px,#000_calc(100%-12px),transparent)]"
      >
        {navigation.map((item) => {
          const isActive = isItemActive(item.href);
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              title={t(item.key)}
              className={cn(
                "relative flex shrink-0 items-center gap-2 rounded-t-lg px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors",
                isActive
                  ? "text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-[2.5px] after:rounded-full after:bg-ig-gradient"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className={cn(!isActive && "hidden md:inline")}>{t(item.key)}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
