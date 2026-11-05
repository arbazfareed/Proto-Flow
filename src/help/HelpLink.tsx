import { CircleHelp } from "lucide-react";
import { requestHelp } from "./navigation";

export function HelpLink({
  article,
  label,
  className = "help-link",
}: {
  article: string;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      aria-label={`Help: ${label}`}
      title={`Help: ${label}`}
      onClick={() => requestHelp(article)}
    >
      <CircleHelp size={14} aria-hidden="true" />
    </button>
  );
}
