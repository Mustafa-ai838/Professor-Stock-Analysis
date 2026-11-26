import { useEffect, useState } from "react";
import { Newspaper } from "lucide-react";
import { DataFreshness, ErrorState, LoadingState, PageHeading, Panel } from "../components/ui";
import { api } from "../services/api";

type NewsItem = { id: number; headline: string; summary: string; published_at: string; source: string };

export function News() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [dataSource, setDataSource] = useState("PSX_LENS");
  const [freshnessStatus, setFreshnessStatus] = useState("DATA UNAVAILABLE");
  const [lastUpdated, setLastUpdated] = useState("");
  useEffect(() => { api.news().then((result) => { setItems(result.items); setDataSource(result.data_source ?? "PSX_LENS"); setFreshnessStatus(result.freshness_status ?? "DELAYED"); setLastUpdated(result.last_updated ?? ""); }).catch((cause: Error) => setError(cause.message)).finally(() => setLoading(false)); }, []);

  return (
    <>
      <PageHeading title="Market News" description="PSX Lens market-wrap and corporate-announcement data." />
      <DataFreshness source={dataSource} status={error && items.length ? "STALE" : error ? "DATA UNAVAILABLE" : freshnessStatus} lastUpdated={lastUpdated} />
      <Panel title="Latest market updates">{error ? <ErrorState message={error} /> : loading ? <LoadingState label="Loading PSX updates…" /> : items.length ? <div className="news-list">{items.map((item) => <article className="news-card" key={item.id}><div className="news-icon"><Newspaper size={20} /></div><div className="news-body"><div className="news-meta"><span className="muted">{item.source}</span><time>{new Date(item.published_at).toLocaleString()}</time></div><h2>{item.headline}</h2><p>{item.summary}</p></div></article>)}</div> : <div className="empty-panel">DATA UNAVAILABLE · No PSX announcements are available from the provider.</div>}</Panel>
    </>
  );
}
