"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n/TranslationProvider";
import { useTheme } from "@/components/ThemeProvider";
import SyncStatusIndicator from "@/components/SyncStatusIndicator";
import NfcStatus from "@/components/NfcStatus";
import Icon from "@/components/ui/Icon";

const WORKSPACE_LINKS = [
  { href: "/dashboard", labelKey: "common.dashboard", icon: "grid" },
  { href: "/", labelKey: "common.filaments", icon: "spool", exact: true },
  { href: "/inventory", labelKey: "common.inventory", icon: "box" },
  { href: "/compare", labelKey: "common.compare", icon: "compare" },
  { href: "/analytics", labelKey: "common.analytics", icon: "chart" },
  { href: "/share", labelKey: "common.share", icon: "share" },
];
const LIBRARY_LINKS = [
  { href: "/printers", labelKey: "settings.printers", icon: "printer" },
  { href: "/nozzles", labelKey: "settings.nozzles", icon: "nozzle" },
  { href: "/bed-types", labelKey: "settings.bedTypes", icon: "layers" },
  { href: "/locations", labelKey: "settings.locations", icon: "location" },
  { href: "/openprinttag", labelKey: "openprinttag.title", icon: "tag" },
];
const TOOL_LINKS = [
  { href: "/import-export", labelKey: "settings.importExport", icon: "transfer" },
  { href: "/api-docs", labelKey: "settings.apiDocs", icon: "code" },
  { href: "/settings", labelKey: "common.settings", icon: "settings" },
];
const ALL_LINKS = [...WORKSPACE_LINKS, ...LIBRARY_LINKS, ...TOOL_LINKS];

export default function AppHeader() {
  const pathname = usePathname();
  const { t } = useTranslation();
  const { resolved, setPreference } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebarRef = useRef(null);
  const menuRef = useRef(null);
  const active = (link) => link.exact
    ? pathname === "/" || pathname.startsWith("/filaments/")
    : pathname === link.href || pathname.startsWith(`${link.href}/`);
  const current = ALL_LINKS.find(active);

  useEffect(() => {
    setMobileOpen(false); // eslint-disable-line react-hooks/set-state-in-effect -- close drawer after navigation
  }, [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebarRef.current?.querySelector("a")?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") { setMobileOpen(false); menuRef.current?.focus(); }
      if (event.key === "Tab") {
        const items = Array.from(sidebarRef.current?.querySelectorAll("a, button") || []);
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onResize = () => { if (desktop.matches) setMobileOpen(false); };
    document.addEventListener("keydown", onKeyDown);
    desktop.addEventListener("change", onResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      desktop.removeEventListener("change", onResize);
    };
  }, [mobileOpen]);
  const renderLinks = (links) => links.map((link) => <Link key={link.href} href={link.href}
    onClick={() => setMobileOpen(false)} aria-current={active(link) ? "page" : undefined}
    className={`sidebar-link${active(link) ? " is-active" : ""}`}>
    <Icon name={link.icon}/><span>{t(link.labelKey)}</span>
    {active(link) && <span className="sidebar-active-dot"/>}
  </Link>);
  return <>
    {mobileOpen && <button type="button" className="sidebar-backdrop" aria-label={t("nav.closeMenu")} onClick={() => { setMobileOpen(false); menuRef.current?.focus(); }}/>} 
    <aside id="app-sidebar" role={mobileOpen ? "dialog" : undefined} aria-modal={mobileOpen ? true : undefined} aria-label={t("nav.aria.primary")} ref={sidebarRef} className={`app-sidebar${mobileOpen ? " is-open" : ""}`}>
      <div className="sidebar-brand-row">
        <Link href="/" className="sidebar-brand" onClick={() => setMobileOpen(false)}>
          <span className="brand-mark"><Icon name="spool"/></span>
          <span>spilofila<small>{t("ui.workspaceTagline")}</small></span>
        </Link>
        <button type="button" className="ui-icon-button sidebar-close" onClick={() => { setMobileOpen(false); menuRef.current?.focus(); }} aria-label={t("nav.closeMenu")}><Icon name="close"/></button>
      </div>
      <nav className="sidebar-navigation" aria-label={t("nav.aria.primary")}>
        <p className="sidebar-group-label">{t("ui.workspace")}</p>{renderLinks(WORKSPACE_LINKS)}
        <p className="sidebar-group-label">{t("ui.library")}</p>{renderLinks(LIBRARY_LINKS)}
        <p className="sidebar-group-label">{t("ui.tools")}</p>{renderLinks(TOOL_LINKS)}
      </nav>
      <div className="sidebar-footer">
        <span className="workspace-avatar"><Icon name="layers"/></span>
        <div><a href={process.env.APP_AUTHOR_URL} target="_blank" rel="noopener noreferrer" className="hover:underline">{process.env.APP_AUTHOR}</a><small>spilofila · v{process.env.APP_VERSION}</small></div>
        <Link href="/settings/ui" className="ui-icon-button" aria-label={t("settings.group.ui")}><Icon name="settings"/></Link>
      </div>
    </aside>
    <header className="app-topbar">
      <div className="topbar-location">
        <button ref={menuRef} type="button" className="ui-icon-button sidebar-menu" onClick={() => setMobileOpen(!mobileOpen)} aria-label={mobileOpen ? t("nav.closeMenu") : t("nav.openMenu")} aria-expanded={mobileOpen} aria-controls="app-sidebar"><Icon name="menu"/></button>
        <span className="topbar-workspace">{t("ui.workspace")}</span><Icon name="chevron" className="breadcrumb-chevron"/>
        <span className="topbar-page">{current ? t(current.labelKey) : t("ui.workspace")}</span>
      </div>
      <div className="topbar-actions">
        <SyncStatusIndicator/><NfcStatus/>
        <button type="button" className="ui-icon-button theme-toggle" onClick={() => setPreference(resolved === "dark" ? "light" : "dark")} aria-label={t(resolved === "dark" ? "ui.lightMode" : "ui.darkMode")} title={t(resolved === "dark" ? "ui.lightMode" : "ui.darkMode")}>
          <Icon name="sun" className="theme-sun"/><Icon name="moon" className="theme-moon"/>
        </button><span className="topbar-divider"/>
        <Link href="/filaments/new" className="ui-button ui-button-primary topbar-add"><Icon name="plus"/><span>{t("filaments.addNew")}</span></Link>
      </div>
    </header>
  </>;
}
