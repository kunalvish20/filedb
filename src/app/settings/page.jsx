"use client";
import { useTranslation } from "@/i18n/TranslationProvider";
import { useIsElectron } from "@/hooks/useIsElectron";
import SettingsTile from "@/components/SettingsTile";
import PageHeading from "@/components/ui/PageHeading";
const MANAGE = [
  ["/nozzles", "settings.nozzles", "settings.nozzlesDesc"],
  ["/printers", "settings.printers", "settings.printersDesc"],
  ["/bed-types", "settings.bedTypes", "settings.bedTypesDesc"],
  ["/locations", "settings.locations", "settings.locationsDesc"],
  ["/trash", "settings.trash", "settings.trashDesc"],
  ["/import-export", "settings.importExport", "settings.importExportDesc"],
  ["/api-docs", "settings.apiDocs", "settings.apiDocsDesc"],
];
const CONFIGURE = [
  ["/settings/ui", "settings.group.ui", "settings.group.ui.desc"],
  ["/settings/network", "settings.group.network", "settings.group.network.desc"],
  ["/settings/backup", "settings.group.data", "settings.group.data.desc"],
  ["/settings/ai", "settings.group.ai", "settings.group.ai.desc"],
  ["/settings/devices", "settings.group.devices", "settings.group.devices.desc"],
];
export default function SettingsPage() {
  const { t } = useTranslation();
  const isElectron = useIsElectron();
  const tile = ([href, title, description]) => <SettingsTile key={href} href={href} title={t(title)} description={t(description)}/>;
  return <main id="main-content" className="max-w-6xl mx-auto">
    <PageHeading title={t("settings.title")} description={t("settings.subtitle")}/>
    <h2 className="settings-section-heading">{t("settings.group.manage")}</h2>
    <div className="settings-grid">{MANAGE.map(tile)}</div>
    <h2 className="settings-section-heading">{t("settings.group.configure")}</h2>
    <div className="settings-grid">{CONFIGURE.filter(([href]) => href !== "/settings/network" || isElectron).map(tile)}</div>
    <h2 className="settings-section-heading">{t("settings.group.danger")}</h2>
    <div className="settings-grid"><SettingsTile href="/settings/danger" title={t("settings.group.danger")} description={t("settings.group.danger.desc")} danger/></div>
    <p className="mt-8 text-sm text-muted-foreground">
      {t("app.maintainedBy", { name: process.env.APP_AUTHOR })}{" · "}
      <a href={process.env.APP_AUTHOR_URL} target="_blank" rel="noopener noreferrer" className="hover:underline">GitHub</a>
    </p>
  </main>;
}
