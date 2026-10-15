"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "@/i18n/TranslationProvider";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useNumberFormat } from "@/hooks/useNumberFormat";
import { Skeleton, SkeletonRegion } from "@/components/Skeleton";
import Icon from "@/components/ui/Icon";
import PageHeading from "@/components/ui/PageHeading";
import EmptyState from "@/components/ui/EmptyState";

export default function DashboardPage() {
  const { t } = useTranslation();
  const { formatDate, formatDateTime } = useDateFormat();
  const { formatGrams, formatNumber } = useNumberFormat();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/dashboard", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(response.statusText || `HTTP ${response.status}`)))
      .then(setData).catch((err) => {
        if (err.name === "AbortError") return;
        console.error("Failed to load dashboard:", err);
        setError(t("dashboard.loadError"));
      });
    return () => controller.abort();
  }, [reloadKey, t]);
  const retry = () => { setError(null); setReloadKey((key) => key + 1); };
  const prettifySpoolLabel = (label) => label.replace(/\((\d{4}-\d{2}-\d{2}T[\d:+\-Z.]+)\)/g, (_, iso) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? `(${iso})` : `(${formatDate(date)})`;
  });
  const heading = <PageHeading title={t("dashboard.title")} description={t("ui.dashboardDescription")}>
    <Link href="/inventory" className="ui-button"><Icon name="box"/>{t("ui.viewInventory")}</Link>
  </PageHeading>;
  if (error) return <main id="main-content">{heading}<div role="alert" className="border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 rounded-xl p-6"><p className="text-sm text-red-700 dark:text-red-300 mb-4">{error}</p><button type="button" onClick={retry} className="ui-button">{t("common.retry")}</button></div></main>;
  if (!data) return <main id="main-content">{heading}<SkeletonRegion label={t("common.loading")}>
    <div className="dashboard-metrics">{Array.from({ length: 6 }, (_, i) => <div key={i} className="metric-card"><Skeleton className="h-4 w-24 rounded"/><Skeleton className="h-8 w-16 rounded mt-5"/></div>)}</div>
    <div className="dashboard-panels">{Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-64 rounded-xl"/>)}</div>
  </SkeletonRegion></main>;
  const kg = formatNumber(data.totalGrams / 1000, { minDecimals: 2, maxDecimals: 2, trimTrailingZeros: false });
  return <main id="main-content">
    {heading}
    <div className="dashboard-metrics">
      <Metric label={t("dashboard.filaments")} value={formatNumber(data.counts.filaments)} icon="spool" href="/"/>
      <Metric label={t("dashboard.spools")} value={formatNumber(data.counts.spools)} icon="box" href="/inventory" hint={data.counts.retiredSpools > 0 ? t("dashboard.spools.retiredHint", { count: data.counts.retiredSpools }) : undefined}/>
      <Metric label={t("dashboard.totalWeight")} value={`${kg} kg`} icon="layers"/>
      <Metric label={t("dashboard.printers")} value={formatNumber(data.counts.printers)} icon="printer" href="/printers"/>
      <Metric label={t("dashboard.nozzles")} value={formatNumber(data.counts.nozzles)} icon="nozzle" href="/nozzles"/>
      <Metric label={t("dashboard.bedTypes")} value={formatNumber(data.counts.bedTypes)} icon="grid" href="/bed-types"/>
    </div>
    <div className="dashboard-panels">
      <section className="dashboard-panel">
        <div className="dashboard-panel-heading"><Icon name="box"/><h2>{t("dashboard.lowStock.title", { count: data.lowStock.length })}</h2></div>
        {data.lowStock.length === 0 ? <EmptyState compact icon="check" title={t("dashboard.lowStock.empty")}/> : <div className="divide-y divide-border">
          {data.lowStock.map((filament) => <Link href={`/filaments/${filament._id}`} key={filament._id} className="flex items-center gap-3 px-5 py-4 hover:bg-muted">
            <span className="w-7 h-7 rounded-full border border-border shrink-0" style={{ backgroundColor: filament.color }} aria-hidden="true"/>
            <div className="flex-1 min-w-0"><p className="font-medium truncate text-sm">{filament.name}</p><p className="text-xs text-muted-foreground">{filament.vendor}</p></div>
            <div className="w-16 bg-muted rounded-full h-1.5 shrink-0"><div className="h-1.5 rounded-full bg-amber-500" style={{ width: `${Math.max(0, Math.min(100, filament.remainingGrams / filament.threshold * 100))}%` }}/></div>
            <span className="text-xs text-muted-foreground text-right">{t("dashboard.lowStock.remaining", { remaining: Math.round(filament.remainingGrams), threshold: Math.round(filament.threshold) })}</span>
          </Link>)}
        </div>}
      </section>
      <section className="dashboard-panel">
        <div className="dashboard-panel-heading"><Icon name="sun"/><h2>{t("dashboard.dryDue.title", { count: data.dryDue.length })}</h2></div>
        {data.dryDue.length === 0 ? <EmptyState compact icon="check" title={t("dashboard.dryDue.empty")}/> : <ul className="divide-y divide-border">
          {data.dryDue.map((spool) => <li key={`${spool.filamentId}-${spool.spoolId}`} className="px-5 py-4">
            <Link href={`/filaments/${spool.filamentId}`} className="text-sm font-medium hover:underline">{spool.filamentName}{spool.spoolLabel && <span className="text-muted-foreground"> · {prettifySpoolLabel(spool.spoolLabel)}</span>}</Link>
            <p className="text-xs text-muted-foreground mt-1">{spool.lastDried ? t("dashboard.dryDue.lastDried", { date: formatDate(spool.lastDried) }) : t("dashboard.dryDue.never")}</p>
          </li>)}
        </ul>}
      </section>
      <section className="dashboard-panel dashboard-panel-wide">
        <div className="dashboard-panel-heading"><Icon name="printer"/><h2>{t("dashboard.recentPrints")}</h2><Link href="/analytics" className="ui-button ui-button-ghost">{t("common.analytics")}<Icon name="arrow"/></Link></div>
        {data.recentPrintHistory.length === 0 ? <EmptyState compact icon="printer" title={t("dashboard.recentPrints.empty")}/> : <ul className="divide-y divide-border">
          {data.recentPrintHistory.map((print) => <li key={print._id} className="px-5 py-4 flex justify-between items-center gap-4">
            <div className="min-w-0 flex-1"><p className="font-medium truncate text-sm">{print.jobLabel}</p><p className="text-xs text-muted-foreground mt-1">{print.printerName ? `${print.printerName} · ` : ""}{formatDateTime(print.startedAt)}{print.source !== "manual" && ` · ${print.source}`}</p></div>
            <span className="text-xs text-muted-foreground shrink-0">{formatGrams(print.totalGrams)} g</span>
          </li>)}
        </ul>}
      </section>
    </div>
  </main>;
}
function Metric({ label, value, href, hint, icon }) {
  const content = <><div className="metric-card-top"><span>{label}</span><Icon name={icon}/></div><p className="metric-card-value">{value}</p>{hint && <p className="metric-card-hint">{hint}</p>}</>;
  return href ? <Link className="metric-card hover:border-ring" href={href}>{content}</Link> : <div className="metric-card">{content}</div>;
}
