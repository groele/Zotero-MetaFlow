import type { JournalCardData } from "./journal-card-share";
import { getString } from "./locale";

export async function renderCardCanvas(doc: Document, data: JournalCardData): Promise<HTMLCanvasElement | null> {
  try {
    const canvas = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas") as HTMLCanvasElement;
    const rawCtx = canvas.getContext("2d");
    if (!rawCtx)
      return null;
    const logo = doc.createElementNS("http://www.w3.org/1999/xhtml", "img") as HTMLImageElement;
    await new Promise<void>((resolve, reject) => {
      const timer = doc.defaultView!.setTimeout(() => {
        logo.onload = logo.onerror = null;
        reject(new Error("Plugin icon load timed out"));
      }, 5000);
      logo.onload = () => {
        doc.defaultView!.clearTimeout(timer);
        resolve();
      };
      logo.onerror = () => {
        doc.defaultView!.clearTimeout(timer);
        reject(new Error("Plugin icon unavailable"));
      };
      logo.src = `${rootURI}content/icons/metaref-96.png`;
    });
    const ctx = rawCtx as unknown as CanvasRenderingContext2D;
    const width = 420;
    const padding = 22;
    const font = `system-ui, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif`;
    const contentWidth = width - padding * 2;
    ctx.font = `600 18px ${font}`;
    const title = wrapText(ctx, data.publication, contentWidth);
    const groups = [
      { title: getString("journal-rankings-heading" as any), rows: data.displayedRankings.map(row => ({ label: getString(row.labelID as any), value: row.value })) },
      { title: getString("journal-indexing-heading" as any), rows: [
        ...data.sciRanking ? [{ label: getString(data.sciRanking.labelID as any), value: data.sciRanking.value }] : [],
        ...data.rows,
        ...data.matchBases.map(value => ({ label: getString("journal-share-basis" as any), value })),
      ] },
    ].filter(group => group.rows.length);
    ctx.font = `14px ${font}`;
    const columns = groups.map(group => ({ ...group, rows: group.rows.map(row => ({
      label: wrapText(ctx, row.label, 144),
      value: wrapText(ctx, row.value, contentWidth - 160),
    })) }));
    const height = 118 + title.length * 26 + columns.reduce((sum, group) => sum + 46 + group.rows.reduce((rows, row) => rows + Math.max(row.label.length, row.value.length) * 21 + 10, 0), 0);
    canvas.width = width * 2;
    canvas.height = height * 2;
    ctx.scale(2, 2);
    ctx.fillStyle = "#f8fafc";
    drawRoundedRect(ctx, 0, 0, width, height, 16);
    ctx.fill();
    ctx.strokeStyle = "#e2e8f0";
    ctx.stroke();
    ctx.drawImage(logo, padding, padding - 1, 18, 18);
    ctx.font = `600 12px ${font}`;
    ctx.fillStyle = "#2563eb";
    ctx.fillText(getString("journal-share-brand" as any), padding + 24, padding + 12);
    ctx.font = `11px ${font}`;
    ctx.fillStyle = "#64748b";
    ctx.textAlign = "right";
    ctx.fillText(new Date().toLocaleDateString("sv-SE"), width - padding, padding + 12);
    const line = (y: number) => {
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.strokeStyle = "#e2e8f0";
      ctx.stroke();
    };
    line(54);
    let y = 82;
    ctx.textAlign = "left";
    ctx.fillStyle = "#0f172a";
    ctx.font = `600 18px ${font}`;
    for (const text of title) {
      ctx.fillText(text, padding, y);
      y += 26;
    }
    for (const group of columns) {
      y += 12;
      ctx.textAlign = "left";
      ctx.fillStyle = "#0f172a";
      ctx.font = `600 14px ${font}`;
      ctx.fillText(group.title, padding, y);
      y += 28;
      for (const row of group.rows) {
        ctx.font = `14px ${font}`;
        ctx.textAlign = "left";
        ctx.fillStyle = "#64748b";
        row.label.forEach((text, index) => ctx.fillText(text, padding, y + index * 21));
        ctx.textAlign = "right";
        ctx.fillStyle = "#0f172a";
        row.value.forEach((text, index) => ctx.fillText(text, width - padding, y + index * 21));
        y += Math.max(row.label.length, row.value.length) * 21 + 10;
      }
      line(y);
      y += 6;
    }
    ctx.font = `11px ${font}`;
    ctx.fillStyle = "#64748b";
    ctx.textAlign = "center";
    ctx.fillText(getString("journal-share-footer" as any), width / 2, y + 24);
    return canvas;
  }
  catch {
    return null;
  }
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of String(text).split(/\r?\n/)) {
    let line = "";
    for (const token of paragraph.match(/\S+\s*|\s+/g) || []) {
      if (ctx.measureText(token).width <= maxWidth) {
        if (line && ctx.measureText(line + token).width > maxWidth) {
          lines.push(line.trimEnd());
          line = "";
        }
        line += token;
        continue;
      }
      for (const char of token) {
        if (line && ctx.measureText(line + char).width > maxWidth) {
          lines.push(line.trimEnd());
          line = "";
        }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}
