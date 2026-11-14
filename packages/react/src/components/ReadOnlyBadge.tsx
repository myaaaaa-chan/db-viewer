import { useT } from "../i18n/useT";
import { Icon } from "./Icon";

export function ReadOnlyBadge() {
  const { t } = useT();
  return (
    <span className="dbv-badge-readonly">
      <Icon name="lock" size={12} />
      {t("viewer.readOnly")}
    </span>
  );
}
