type PlaceholderPageProps = {
  title: string
  description: string
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Module</p>
          <h1>{title}</h1>
          <p className="muted">{description}</p>
        </div>
      </div>
      <div className="panel">
        <p className="muted">This module will be implemented after the security and data foundation is complete.</p>
      </div>
    </section>
  )
}
