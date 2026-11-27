import { defineRule } from "../../../services/lint/rule-base";
import { getString } from "../../../utils/locale";

export const RequireCreators = defineRule({
  id: "require-creators",
  scope: "field",
  targetItemField: "creators",
  apply({ item, report }) {
    const creators = item.getCreators();
    if (!creators.length) {
      report({
        level: "error",
        message: getString("rule-require-creators-missing"),
      });
    }
  },
});
