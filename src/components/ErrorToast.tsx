import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./Primitives";
import s from "./Shell.module.css";

export function ErrorToast({
  message,
  onRetry,
}: { message: string; onRetry: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    void message;
    setDismissed(false);
  }, [message]);
  if (!message || dismissed) return null;
  return (
    <div role="alert" className={s.errorToast}>
      <span>{message}</span>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        Retry
      </Button>
      <button
        type="button"
        className={s.iconButton}
        aria-label="Dismiss error"
        onClick={() => setDismissed(true)}
      >
        <X size={18} />
      </button>
    </div>
  );
}
