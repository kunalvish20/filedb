"use client";
import { useEffect, useRef, useState } from "react";
import "swagger-ui-react/swagger-ui.css";
import { useTranslation } from "@/i18n/TranslationProvider";
import PageHeading from "@/components/ui/PageHeading";
import Icon from "@/components/ui/Icon";
import { Skeleton, SkeletonRegion } from "@/components/Skeleton";

export default function ApiDocsPage() {
  const { t } = useTranslation();
  const hostRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const mount = document.createElement("div");
    host.appendChild(mount);
    let root = null;
    let cancelled = false;
    // An independent root keeps Swagger's legacy component lifecycles outside
    // Next's StrictMode, without weakening StrictMode for the rest of the app.
    Promise.all([import("react-dom/client"), import("swagger-ui-react")])
      .then(([{ createRoot }, { default: SwaggerUI }]) => {
        if (cancelled) return;
        root = createRoot(mount);
        root.render(<SwaggerUI url="/api/openapi"/>);
        setStatus("ready");
      }).catch((error) => {
        if (cancelled) return;
        console.error("Failed to load API reference:", error);
        setStatus("error");
      });
    return () => {
      cancelled = true;
      const previousRoot = root;
      root = null;
      // Avoid unmounting another React root during Next's render cycle.
      Promise.resolve().then(() => { previousRoot?.unmount(); mount.remove(); });
    };
  }, [reloadKey]);
  return <main id="main-content" className="api-docs-page max-w-7xl mx-auto">
    <PageHeading eyebrow={t("ui.apiBadge")} title={t("ui.apiTitle")} description={t("ui.apiDescription")}>
      <a href="/api/openapi" target="_blank" rel="noreferrer" className="ui-button"><Icon name="code"/>{t("ui.apiSchema")}<Icon name="arrow"/></a>
    </PageHeading>
    {status === "loading" && <SkeletonRegion label={t("common.loading")} className="rounded-xl border border-border bg-card p-6 space-y-5"><Skeleton className="h-8 w-60 rounded"/><Skeleton className="h-4 w-3/4 rounded"/>{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-16 rounded-lg"/>)}</SkeletonRegion>}
    {status === "error" && <div role="alert" className="border border-border rounded-xl bg-card p-6"><p className="text-sm text-muted-foreground mb-4">{t("ui.apiLoadError")}</p><button type="button" className="ui-button" onClick={() => { setStatus("loading"); setReloadKey((key) => key + 1); }}>{t("common.retry")}</button></div>}
    <div className="swagger-wrapper" ref={hostRef} hidden={status !== "ready"}/>
    <style jsx global>{`
      .swagger-wrapper { background: var(--card); border: 1px solid var(--border); border-radius: .75rem; overflow: hidden; padding-bottom: 1.5rem; }
      .swagger-wrapper .swagger-ui, .swagger-wrapper .swagger-ui .info p, .swagger-wrapper .swagger-ui .info li { font-family: var(--font-geist-sans), system-ui, sans-serif; color: var(--foreground); }
      .swagger-wrapper .swagger-ui .wrapper { max-width: none; padding: 0 1.5rem; }
      .swagger-wrapper .swagger-ui .info { margin: 1.5rem 0; }
      .swagger-wrapper .swagger-ui .info .title { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; font-size: 1.2rem; font-weight: 600; letter-spacing: -.025em; color: var(--foreground); }
      .swagger-wrapper .swagger-ui .info .title small { margin: 0; padding: .15rem .45rem; font-size: .65rem; border-radius: .35rem; background: var(--muted); color: var(--muted-foreground); }
      .swagger-wrapper .swagger-ui .info .title small pre { margin: 0; color: inherit; font-family: inherit; }
      .swagger-wrapper .swagger-ui .info p, .swagger-wrapper .swagger-ui .info li { font-size: .8rem; line-height: 1.8; color: var(--muted-foreground); }
      .swagger-wrapper .swagger-ui .info a { color: var(--foreground); font-size: .75rem; text-underline-offset: 3px; }
      .swagger-wrapper .swagger-ui .scheme-container { padding: 1.2rem 0; margin-bottom: 1rem; background: var(--background); box-shadow: none; border-block: 1px solid var(--border); }
      .swagger-wrapper .swagger-ui .servers-title, .swagger-wrapper .swagger-ui label { color: var(--muted-foreground); font-size: .75rem; }
      .swagger-wrapper .swagger-ui select, .swagger-wrapper .swagger-ui input, .swagger-wrapper .swagger-ui textarea { background: var(--card); color: var(--foreground); border: 1px solid var(--border); border-radius: .5rem; box-shadow: 0 1px 2px #00000005; font-size: .8rem; }
      .swagger-wrapper .swagger-ui .opblock-tag { padding: 1.1rem .4rem; margin: 0; font-size: .9rem; color: var(--foreground); border-bottom: 1px solid var(--border); }
      .swagger-wrapper .swagger-ui .opblock-tag:hover { background: var(--muted); }
      .swagger-wrapper .swagger-ui .opblock-tag small { margin-left: 1rem; font-size: .75rem; color: var(--muted-foreground); }
      .swagger-wrapper .swagger-ui .opblock { border-radius: .6rem; box-shadow: none; margin-top: .8rem; }
      .swagger-wrapper .swagger-ui .opblock .opblock-summary { padding: .65rem; }
      .swagger-wrapper .swagger-ui .opblock-summary-path { font-size: .8rem; }
      .swagger-wrapper .swagger-ui .opblock-summary-description { font-size: .75rem; }
      .swagger-wrapper .swagger-ui .btn { border-radius: .5rem; border-width: 1px; box-shadow: none; font-size: .75rem; }
      .swagger-wrapper .swagger-ui table thead tr th, .swagger-wrapper .swagger-ui table thead tr td { color: var(--muted-foreground); border-color: var(--border); font-size: .75rem; }
      .swagger-wrapper .swagger-ui .opblock .opblock-section-header, .swagger-wrapper .swagger-ui section.models .model-container { background: var(--muted); box-shadow: none; }
      .swagger-wrapper .swagger-ui section.models { border-color: var(--border); border-radius: .6rem; }
      .dark .swagger-wrapper .swagger-ui, .dark .swagger-wrapper .swagger-ui .opblock-description-wrapper p,
      .dark .swagger-wrapper .swagger-ui .opblock-summary-path, .dark .swagger-wrapper .swagger-ui .opblock-summary-description,
      .dark .swagger-wrapper .swagger-ui .parameter__name, .dark .swagger-wrapper .swagger-ui .parameter__type,
      .dark .swagger-wrapper .swagger-ui .parameter__in, .dark .swagger-wrapper .swagger-ui .response-col_status,
      .dark .swagger-wrapper .swagger-ui .response-col_description, .dark .swagger-wrapper .swagger-ui .response-col_links,
      .dark .swagger-wrapper .swagger-ui .tab li, .dark .swagger-wrapper .swagger-ui .opblock-section-header h4,
      .dark .swagger-wrapper .swagger-ui .btn, .dark .swagger-wrapper .swagger-ui .model-title,
      .dark .swagger-wrapper .swagger-ui .model, .dark .swagger-wrapper .swagger-ui .model span,
      .dark .swagger-wrapper .swagger-ui section.models h4, .dark .swagger-wrapper .swagger-ui .renderedMarkdown p { color: var(--foreground); }
      .dark .swagger-wrapper .swagger-ui svg { fill: var(--foreground); }
      .dark .swagger-wrapper .swagger-ui .highlight-code, .dark .swagger-wrapper .swagger-ui .microlight { background: #09090b !important; color: #e4e4e7 !important; }
      @media (max-width: 640px) {
        .swagger-wrapper .swagger-ui .wrapper { padding-inline: .85rem; }
        .swagger-wrapper .swagger-ui .opblock-tag { flex-wrap: wrap; gap: .5rem; }
        .swagger-wrapper .swagger-ui .opblock-tag small { margin-left: 0; flex-basis: 100%; }
        .swagger-wrapper .swagger-ui .opblock-summary { flex-wrap: wrap; gap: .5rem; }
      }
    `}</style>
  </main>;
}
