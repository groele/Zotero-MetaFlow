import { setHtmlTag } from "../modules/rich-text";

export function onShortcuts(type: string, win?: Window) {
  switch (type) {
    case "subscript":
      setHtmlTag("sub", undefined, undefined, win);
      break;
    case "supscript":
      setHtmlTag("sup", undefined, undefined, win);
      break;
    case "bold":
      setHtmlTag("b", undefined, undefined, win);
      break;
    case "italic":
      setHtmlTag("i", undefined, undefined, win);
      break;
    case "nocase":
      setHtmlTag("span", "class", "nocase", win);
      break;
    case "small-caps":
      setHtmlTag("span", "style", "font-variant:small-caps;", win);
      break;
    case "confliction":
      break;
    default:
      break;
  }
}
