import { redirect } from "next/navigation";

/** The Analytics tab was merged into Início; old links and bookmarks land there. */
export default function AnalyticsPage() {
  redirect("/dashboard?period=30d");
}
