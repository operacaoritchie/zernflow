import Link from "next/link";
import {
  AlertTriangle, ArrowDown, ArrowUp, Hourglass, Minus, MessageSquare, Percent, Phone, Plug, Radio, Target, Timer,
  UserPlus, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getFormatter, getT } from "@/lib/i18n/server";
import type { Formatter, Translator } from "@/lib/i18n/translator";
import { DASH_PERIODS, type Delta, type FeedKind } from "@/lib/dashboard/metrics";
import type { DashboardData, FlowFunnel } from "@/lib/dashboard/load";

const PERIOD_KEY = { today: "today", "7d": "d7", "30d": "d30" } as const;
const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram", whatsapp: "WhatsApp", facebook: "Messenger", telegram: "Telegram",
};

const card = "rounded-xl border border-border bg-card";

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-base font-semibold">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function DeltaLine({ d, previous, t }: { d: Delta; previous: number; t: Translator }) {
  const Icon = d.direction === "up" ? ArrowUp : d.direction === "down" ? ArrowDown : Minus;
  const text =
    d.direction === "flat"
      ? t("delta.flat", { previous })
      : d.pct === null
        ? t("delta.new", { previous })
        : t(d.direction === "up" ? "delta.up" : "delta.down", { pct: Math.abs(d.pct), previous });
  return (
    <p className={cn("mt-2 flex items-center gap-1 text-xs", d.direction === "up" ? "text-green-600" : d.direction === "down" ? "text-red-600" : "text-muted-foreground")}>
      <Icon className="h-3 w-3" aria-hidden />
      {text}
    </p>
  );
}

function Metric({ icon: Icon, label, value, hint, children }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string; hint?: string; children?: React.ReactNode;
}) {
  return (
    <div className={cn(card, "p-5")}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <p className="mt-2 text-3xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

function relative(iso: string, t: Translator, format: Formatter): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t("justNow");
  if (s < 3600) return format.relative(-Math.floor(s / 60), "minute");
  if (s < 86400) return format.relative(-Math.floor(s / 3600), "hour");
  return format.relative(-Math.floor(s / 86400), "day");
}

function FunnelCard({ f, t, format }: { f: FlowFunnel; t: Translator; format: Formatter }) {
  return (
    <div className={cn(card, "p-5")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{f.name}</h3>
        <span className="text-xs text-muted-foreground">{t("funnel.people", { count: f.entrants })}</span>
      </div>
      <ol className="mt-4 space-y-4">
        {f.stages.map((s, i) => (
          <li key={`${s.label}-${i}`}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{s.label}</span>
              <span className="tabular-nums">
                <strong>{format.number(s.reached)}</strong>
                {s.pctOfEntrants !== null && <span className="ml-1 text-xs text-muted-foreground">{s.pctOfEntrants}%</span>}
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" role="presentation">
              <div className="h-full rounded-full bg-primary" style={{ width: `${s.pctOfEntrants ?? 0}%` }} />
            </div>
            {(s.waiting > 0 || s.dropped > 0 || s.invalidAttempts > 0) && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {[
                  s.waiting > 0 ? t("funnel.waiting", { count: s.waiting }) : null,
                  s.dropped > 0 ? t("funnel.dropped", { count: s.dropped }) : null,
                  s.invalidAttempts > 0 ? t("funnel.invalid", { attempts: s.invalidAttempts, people: s.invalidPeople }) : null,
                ].filter(Boolean).join(" · ")}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

const FEED_ICON: Record<FeedKind, { icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  lead: { icon: Phone, tone: "bg-green-100 text-green-600 dark:bg-green-900/30" },
  new_person: { icon: UserPlus, tone: "bg-purple-100 text-purple-600 dark:bg-purple-900/30" },
  message_failed: { icon: AlertTriangle, tone: "bg-red-100 text-red-600 dark:bg-red-900/30" },
  field_invalid: { icon: AlertTriangle, tone: "bg-amber-100 text-amber-600 dark:bg-amber-900/30" },
  broadcast_failed: { icon: Radio, tone: "bg-red-100 text-red-600 dark:bg-red-900/30" },
};
const FEED_TEXT: Record<FeedKind, string> = {
  lead: "feed.lead", new_person: "feed.newPerson", message_failed: "feed.messageFailed",
  field_invalid: "feed.fieldInvalid", broadcast_failed: "feed.broadcastFailed",
};

export async function DashboardHome({ data }: { data: DashboardData }) {
  const t = await getT("home");
  const format = await getFormatter();
  const { results: r, act, health: h } = data;
  const maxBar = Math.max(1, ...data.trend.map((p) => Math.max(p.leads, p.people)));
  const healthy = h.messagesFailed === 0 && h.invalidAttempts === 0 && h.broadcastFailed === 0 && h.inactiveChannels === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-4 sm:px-8 sm:py-6">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <nav aria-label={t("period.label")} className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {DASH_PERIODS.map((p) => (
            <Link
              key={p}
              href={`/dashboard?period=${p}`}
              aria-current={data.period === p ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                data.period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t(`period.${PERIOD_KEY[p]}`)}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex-1 space-y-10 overflow-auto p-4 sm:p-8">
        {data.loadErrors.length > 0 && (
          <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            {t("loadWarning")}
          </p>
        )}

        <Section id="sec-result" title={t("sections.result")}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric icon={Target} label={t("results.leads")} value={format.number(r.leads.value)} hint={t("results.leadsHint")}>
              <DeltaLine d={r.leads.delta} previous={r.leads.previous} t={t} />
            </Metric>
            <Metric
              icon={Percent}
              label={t("results.conversion")}
              value={r.conversion.rate === null ? "—" : `${r.conversion.rate}%`}
              hint={r.conversion.entrants > 0 ? t("results.conversionHint", { leads: r.conversion.leads, entrants: r.conversion.entrants }) : t("results.conversionEmpty")}
            >
              {r.conversion.previousRate !== null && (
                <p className="mt-2 text-xs text-muted-foreground">{t("results.conversionPrev", { rate: r.conversion.previousRate })}</p>
              )}
            </Metric>
            <Metric icon={Users} label={t("results.people")} value={format.number(r.people.value)} hint={t("results.peopleHint")}>
              <DeltaLine d={r.people.delta} previous={r.people.previous} t={t} />
              {r.people.importedIgnored > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">{t("results.imported", { count: r.people.importedIgnored })}</p>
              )}
            </Metric>
          </div>
        </Section>

        <Section id="sec-act" title={t("sections.act")}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={cn(card, "p-5")}>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Hourglass className="h-4 w-4" />
                {t("act.waiting")}
              </div>
              <p className="mt-2 text-3xl font-bold tabular-nums">{format.number(act.waitingTotal)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("act.waitingHint")}</p>
              {act.waiting.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">{t("act.waitingNone")}</p>
              ) : (
                <ul className="mt-4 divide-y divide-border">
                  {act.waiting.map((w) => (
                    <li key={w.contactId} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{w.name ?? t("feed.someone")}</p>
                        <p className="truncate text-xs text-muted-foreground">{[w.flow, w.stage].filter(Boolean).join(" · ")}</p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{relative(w.since, t, format)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {act.waitingTotal > act.waiting.length && (
                <p className="mt-2 text-xs text-muted-foreground">{t("act.waitingMore", { count: act.waitingTotal - act.waiting.length })}</p>
              )}
            </div>

            <div className={cn(card, "p-5")}>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Timer className="h-4 w-4" />
                {t("act.windows")}
              </div>
              <p className="mt-2 text-3xl font-bold tabular-nums">{format.number(act.windows.open)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("act.windowsHint")}</p>
              {act.windows.open === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">{t("act.windowsNone")}</p>
              ) : (
                <>
                  <p className={cn("mt-4 text-sm font-medium", act.windows.closingSoon > 0 && "text-amber-600")}>
                    {t("act.windowsClosing", { count: act.windows.closingSoon })}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {Object.entries(act.windows.byPlatform).map(([p, n]) => `${PLATFORM_LABEL[p] ?? p}: ${n}`).join(" · ")}
                  </p>
                </>
              )}
              <Link href="/dashboard/inbox" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                <MessageSquare className="h-4 w-4" />
                {t("act.openInbox")}
              </Link>
            </div>
          </div>
        </Section>

        <Section id="sec-funnel" title={t("sections.funnel")}>
          {data.funnels.length === 0 ? (
            <p className={cn(card, "p-5 text-sm text-muted-foreground")}>{t("funnel.empty")}</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {data.funnels.map((f) => <FunnelCard key={f.flowId} f={f} t={t} format={format} />)}
            </div>
          )}
        </Section>

        <Section id="sec-origin" title={t("sections.origin")} hint={t("origin.hint")}>
          {data.origins.length === 0 ? (
            <p className={cn(card, "p-5 text-sm text-muted-foreground")}>{t("origin.empty")}</p>
          ) : (
            <div className={cn(card, "overflow-x-auto")}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">{t("origin.colSource")}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{t("origin.colComments")}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{t("origin.colDms")}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{t("origin.colLeads")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border tabular-nums">
                  {data.origins.map((o) => (
                    <tr key={o.postId}>
                      <td className="px-4 py-2.5">
                        <span className="font-medium">{o.isLive ? t("origin.live") : t("origin.post")}</span>
                        <span className="ml-2 font-mono text-xs text-muted-foreground">…{o.postId.slice(-6)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">{o.comments}</td>
                      <td className="px-4 py-2.5 text-right">{o.dms}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">{o.leads}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section id="sec-health" title={t("sections.health")} hint={healthy ? t("health.ok") : undefined}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric icon={AlertTriangle} label={t("health.messagesFailed")} value={format.number(h.messagesFailed)}
              hint={t("health.messagesFailedHint", { previous: h.previousMessagesFailed })} />
            <Metric icon={Phone} label={t("health.invalid")} value={format.number(h.invalidAttempts)}
              hint={t("health.invalidHint", { people: h.invalidPeople })} />
            <Metric icon={Radio} label={t("health.broadcasts")} value={format.number(h.broadcastBlocked + h.broadcastFailed)}
              hint={t("health.broadcastsHint", { blocked: h.broadcastBlocked, failed: h.broadcastFailed })}>
              {h.blockedReasons.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {h.blockedReasons.map((x) => `${t(`reasons.${x.reason}`)}: ${x.count}`).join(" · ")}
                </p>
              )}
            </Metric>
            <Metric icon={Plug} label={t("health.channels")} value={format.number(h.inactiveChannels)} hint={t("health.channelsHint")}>
              {h.optOuts > 0 && <p className="mt-1 text-xs text-muted-foreground">{t("health.optOuts", { count: h.optOuts })}</p>}
            </Metric>
          </div>
        </Section>

        <div className="grid gap-10 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <Section id="sec-trend" title={t("sections.trend")} hint={t("trend.hint")}>
              <div className={cn(card, "p-5")}>
                <div className="mb-3 flex gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-primary" />{t("trend.leads")}</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/40" />{t("trend.people")}</span>
                </div>
                <div className="flex h-40 items-end gap-1" role="img" aria-label={t("trend.aria", {
                  leads: data.trend.reduce((n, p) => n + p.leads, 0), people: data.trend.reduce((n, p) => n + p.people, 0), days: data.trend.length,
                })}>
                  {data.trend.map((p) => (
                    <div key={p.day} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${p.day.slice(8)}/${p.day.slice(5, 7)} · ${t("trend.leads")}: ${p.leads} · ${t("trend.people")}: ${p.people}`}>
                      <div className="flex h-full items-end justify-center gap-px">
                        <div className="w-1/2 rounded-t-sm bg-primary" style={{ height: `${(p.leads / maxBar) * 100}%`, minHeight: p.leads ? 2 : 0 }} />
                        <div className="w-1/2 rounded-t-sm bg-muted-foreground/40" style={{ height: `${(p.people / maxBar) * 100}%`, minHeight: p.people ? 2 : 0 }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
                  <span>{data.trend[0] ? `${data.trend[0].day.slice(8)}/${data.trend[0].day.slice(5, 7)}` : ""}</span>
                  <span>{data.trend.length ? `${data.trend[data.trend.length - 1].day.slice(8)}/${data.trend[data.trend.length - 1].day.slice(5, 7)}` : ""}</span>
                </div>
              </div>
            </Section>
          </div>

          <div className="lg:col-span-2">
            <Section id="sec-feed" title={t("sections.feed")}>
              {data.feed.length === 0 ? (
                <p className={cn(card, "p-5 text-sm text-muted-foreground")}>{t("feed.empty")}</p>
              ) : (
                <ul className={cn(card, "divide-y divide-border")}>
                  {data.feed.map((item, i) => {
                    const { icon: Icon, tone } = FEED_ICON[item.kind];
                    return (
                      <li key={`${item.kind}-${item.at}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", tone)}><Icon className="h-3.5 w-3.5" /></span>
                        <span className="min-w-0 flex-1 truncate text-sm">{t(FEED_TEXT[item.kind], { name: item.contactName ?? t("feed.someone") })}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{relative(item.at, t, format)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
