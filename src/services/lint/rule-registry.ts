import type { Rule, RuleForRegularItemScopeItem, RuleForRegularScopeField } from "./rule-base";
import { getPref } from "../../utils/prefs";

type StandardRuleID = Exclude<ID, `tool-${string}`>;

let catalog: readonly Rule<any>[] = [];

export function registerRuleCatalog(rules: readonly Rule<any>[]): void {
  catalog = Object.freeze([...rules]);
}

export class Rules {
  static getAll(): Rule<any>[] {
    return [...catalog];
  }

  static getStandard(): Rule<any>[] {
    return this.getAll().filter(rule => rule.category !== "tool");
  }

  static getEnabledStandard(): Rule<any>[] {
    return this.getStandard().filter(rule => this.isRuleEnabled(rule.id));
  }

  private static isRuleEnabled(id: ID) {
    if (id.startsWith("tool-"))
      return false;
    return getPref(`rule.${id as StandardRuleID}`);
  }

  static getTool(): Rule<any>[] {
    return this.getAll().filter(rule => rule.category === "tool");
  }

  static getByType(scope: "item"): RuleForRegularItemScopeItem[];
  static getByType(scope: "field"): RuleForRegularScopeField[];
  static getByType(type: Rule["scope"]) {
    return this.getStandard().filter(rule => rule.scope === type);
  }

  static getByID(id: ID): Rule<any> | undefined {
    return this.getAll().find(rule => rule.id === id);
  }
}
