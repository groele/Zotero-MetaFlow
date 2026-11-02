export function createCheckSvgIcon(doc: Document): SVGElement {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(svgNS, "svg") as unknown as SVGElement;
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("style", "width:15px;height:15px;display:block;pointer-events:none;color:inherit;stroke:currentColor;");

  const polyline = doc.createElementNS(svgNS, "polyline");
  polyline.setAttribute("points", "20 6 9 17 4 12");

  svg.append(polyline);
  return svg;
}

export function createShareSvgIcon(doc: Document): SVGElement {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(svgNS, "svg") as unknown as SVGElement;
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("style", "width:15px;height:15px;display:block;pointer-events:none;color:inherit;stroke:currentColor;");

  const path = doc.createElementNS(svgNS, "path");
  path.setAttribute("d", "M12 15V3m-4 4 4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6");
  svg.setAttribute("aria-hidden", "true");
  svg.append(path);
  return svg;
}
