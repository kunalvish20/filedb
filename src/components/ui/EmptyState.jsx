import Icon from "./Icon";
export default function EmptyState({ icon = "box", title, description, children, compact = false }) {
  return <div className={`empty-state${compact ? " empty-state-compact" : ""}`}>
    <div className="empty-state-icon"><Icon name={icon}/></div><h3>{title}</h3>
    {description && <p>{description}</p>}
    {children && <div className="empty-state-actions">{children}</div>}
  </div>;
}
