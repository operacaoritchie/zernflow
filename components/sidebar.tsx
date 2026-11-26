"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
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
  Menu,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import type { Database } from "@/lib/types/database";
import { useT } from "@/lib/i18n/provider";
import { LocaleSwitcher } from "@/components/locale-switcher";

type Workspace = Database["public"]["Tables"]["workspaces"]["Row"];

interface WorkspaceItem {
  id: string;
  name: string;
  slug: string;
  role: string;
}

function subscribeToThemeClass(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  return () => observer.disconnect();
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

export function Sidebar({
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
  const dark = useSyncExternalStore(
    subscribeToThemeClass,
    () => document.documentElement.classList.contains("dark"),
    () => false
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

  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the drawer whenever the route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll while the drawer is open
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const isItemActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
  const activeItem = navigation.find((item) => isItemActive(item.href));

  const panel = (
    <>
      <div className="border-b border-sidebar-border px-3 py-3">
        <WorkspaceSwitcher current={workspace} workspaces={workspaces} />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {navigation.map((item) => {
          const isActive = isItemActive(item.href);
          return (
            <Link
              key={item.key}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors md:py-2",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {t(item.key)}
            </Link>
          );
        })}
      </nav>

      <div className="safe-bottom space-y-1 border-t border-sidebar-border p-3">
        <LocaleSwitcher />
        <button
          onClick={toggleTheme}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:py-2"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {dark ? t("lightMode") : t("darkMode")}
        </button>
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:py-2"
        >
          <LogOut className="h-4 w-4" />
          {t("signOut")}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile top bar */}
      <header className="safe-top flex h-12 shrink-0 items-center gap-2 border-b border-border bg-sidebar px-2 md:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-sidebar-foreground hover:bg-sidebar-accent"
          aria-label={t("openMenu")}
          aria-expanded={mobileOpen}
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {activeItem && (
            <activeItem.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate text-sm font-semibold">
            {activeItem ? t(activeItem.key) : workspace.name}
          </span>
        </div>
        <span className="max-w-[40%] truncate text-xs text-muted-foreground">
          {workspace.name}
        </span>
      </header>

      {/* Mobile drawer */}
      <div
        className={cn(
          "fixed inset-0 z-50 md:hidden",
          mobileOpen ? "pointer-events-auto" : "pointer-events-none"
        )}
        aria-hidden={!mobileOpen}
      >
        <div
          className={cn(
            "absolute inset-0 bg-black/50 transition-opacity duration-200",
            mobileOpen ? "opacity-100" : "opacity-0"
          )}
          onClick={() => setMobileOpen(false)}
        />
        <aside
          className={cn(
            "safe-top absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-sidebar shadow-xl transition-transform duration-200",
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <button
            onClick={() => setMobileOpen(false)}
            className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent"
            aria-label={t("closeMenu")}
          >
            <X className="h-4 w-4" />
          </button>
          {panel}
        </aside>
      </div>

      {/* Desktop sidebar */}
      <div className="hidden h-full w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        {panel}
      </div>
    </>
  );
}
