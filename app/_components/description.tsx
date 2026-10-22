// Renders scraped job text (lib/markdown-lite.ts) as React text nodes only.

import { parseDescription, type Segment } from "../../lib/markdown-lite.ts";

export function RichText({ segments }: { segments: Segment[] }) {
  return <>{segments.map((segment, index) => (segment.bold ? <strong key={index}>{segment.text}</strong> : <span key={index}>{segment.text}</span>))}</>;
}

export function Description({ raw }: { raw: string }) {
  const blocks = parseDescription(raw);
  const out: React.ReactNode[] = [];
  let bullets: React.ReactNode[] = [];
  const flush = () => {
    if (bullets.length) out.push(<ul key={`ul-${out.length}`}>{bullets}</ul>);
    bullets = [];
  };
  blocks.forEach((block, index) => {
    if (block.kind === "bullet") {
      bullets.push(<li key={index}><RichText segments={block.segments} /></li>);
      return;
    }
    flush();
    out.push(block.kind === "heading" ? <h5 key={index}><RichText segments={block.segments} /></h5> : <p key={index}><RichText segments={block.segments} /></p>);
  });
  flush();
  return <div className="description">{out}</div>;
}
