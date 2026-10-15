import Link from "next/link";
import Icon from "@/components/ui/Icon";
const ICONS = {
  "/nozzles": "nozzle", "/printers": "printer", "/bed-types": "layers", "/locations": "location",
  "/trash": "trash", "/import-export": "transfer", "/api-docs": "code", "/settings/ui": "palette",
  "/settings/network": "share", "/settings/backup": "database", "/settings/ai": "sparkle",
  "/settings/devices": "device", "/settings/danger": "shield",
};
export default function SettingsTile({ href, title, description, danger = false }) {
  return <Link href={href} className={"settings-tile" + (danger ? " settings-tile-danger" : "")}>
    <div className="settings-tile-top"><span className="settings-tile-icon"><Icon name={ICONS[href] || "settings"}/></span><Icon name="arrow" className="settings-tile-arrow"/></div>
    <h2>{title}</h2><p>{description}</p>
  </Link>;
}
