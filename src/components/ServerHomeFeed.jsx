export default function ServerHomeFeed({ recent, resume, related, activity, onOpen, renderCard, showRecent = true, showResume = true, showRelated = true, showActivity = true }) {
  const ribbon = (title, items, empty) => <section className="panel dashboard-panel home-feed-section" aria-label={title}>
    <div className="panel-header"><h3>{title}</h3></div>
    {items.length ? <div className="mini-poster-row" role="list" aria-label={title}>{items.map((item) => <div role="listitem" key={item.feedKey}>{renderCard(item, () => onOpen(item))}</div>)}</div> : <p className="small-muted">{empty}</p>}
  </section>;
  return <div className="home-content-feed">
    {showActivity && <nav className="home-activity-ribbon" aria-label="Recent activity">{activity.map((item) => <button type="button" className="secondary-button" key={item.label} onClick={item.onClick}><strong>{item.label}</strong><span>{item.value}</span></button>)}</nav>}
    {showResume && resume.length > 0 && ribbon('Continue Watching', resume)}
    {showRecent && ribbon('Recently Added', recent, 'No media added yet. Add a media folder and scan it to get started.')}
    {showRelated && related.items.length > 0 && ribbon(`Related to ${related.title}`, related.items)}
  </div>;
}
