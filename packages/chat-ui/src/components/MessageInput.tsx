import { useState, type FormEvent } from "react";

interface Props {
  disabled: boolean;
  onSend: (content: string) => void;
}

export function MessageInput({ disabled, onSend }: Props) {
  const [value, setValue] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <input
        className="composer__input"
        type="text"
        value={value}
        placeholder="Ask about a product or a store policy…"
        onChange={(event) => setValue(event.target.value)}
        autoFocus
      />
      <button
        className="composer__send"
        type="submit"
        disabled={disabled || value.trim().length === 0}
      >
        Send
      </button>
    </form>
  );
}
