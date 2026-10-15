export default function PageHeading({ title, description, children, eyebrow }) {
  return <div className="page-heading"><div>
    {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
    <h1>{title}</h1>
    {description && <p className="page-description">{description}</p>}
  </div>{children && <div className="page-heading-actions">{children}</div>}</div>;
}
