/* eslint-disable ts/no-use-before-define */
import pinyin from "tiny-pinyin";
import { Surnames } from "./pinyin-surnames";
import { capitalizeFirstLetter } from "./str";

// To better support unit testing and improved performance,
// we do not use Zotero's built-in toSentenceCase API
function _startCase(text: string) {
  return text.split(" ").map(capitalizeFirstLetter).join(" ");
}

function _getPinyin(text: string): string {
  return pinyin.convertToPinyin(text, " ", true);
}

export function getPinyin(text: string): string {
  return _startCase(_getPinyin(text));
}

export function getSurnamePinyin(text: string): string {
  return _startCase(getPinyinWithoutTone(Surnames[text] || _getPinyin(text)));
}

export function splitChineseName(fullName: string): [string, string] {
  // 先尝试匹配复姓（两个字及以上）
  for (const surname of Object.keys(Surnames)) {
    if (fullName.startsWith(surname)) {
      const givenName = fullName.slice(surname.length);
      return [surname, givenName];
    }
  }

  // 若无复姓匹配，则姓为第一个字
  const surname = fullName.charAt(0);
  const givenName = fullName.slice(1);
  return [surname, givenName];
}

/* Following code is from https://github.com/zh-lx/pinyin-pro MIT License */

/**
 * @description: 将带音调符号拼音转换为不带音调拼音
 * @param {string} pinyin
 * @return {string}
 *
 * Modify from https://github.com/zh-lx/pinyin-pro
 * @link https://github.com/zh-lx/pinyin-pro/blob/57a4a1104dcc7e22ed46bb8aef36ec816665a34d/lib/core/pinyin/handle.ts#L90-L107
 */
type GetPinyinWithoutTone = (pinyin: string) => string;
const getPinyinWithoutTone: GetPinyinWithoutTone = (pinyin) => {
  return pinyin
    .replace(/([āáǎà])/g, "a")
    .replace(/([ōóǒò])/g, "o")
    .replace(/([ēéěè])/g, "e")
    .replace(/([īíǐì])/g, "i")
    .replace(/([ūúǔù])/g, "u")
    .replace(/([ǖǘǚǜ])/g, "ü")
    .replace(/(n̄|[ńňǹ])/g, "n")
    .replace(/(m̄|ḿ|m̌|m̀)/g, "m")
    .replace(/(ê̄|ế|ê̌|ề)/g, "ê");
};
