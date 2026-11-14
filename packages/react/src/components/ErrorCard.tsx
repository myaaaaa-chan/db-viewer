import type { ReactNode } from "react";
import { Icon } from "./Icon";

export type ErrorCardProps = {
  readonly title: string;
  // DB が返したメッセージは翻訳せず、そのまま渡す
  readonly message: string;
  readonly badge?: string | null;
  readonly children?: ReactNode;
};

export function ErrorCard(props: ErrorCardProps) {
  return (
    <section className="dbv-error-card" role="alert">
      <div className="dbv-error-head">
        <Icon name="alert" size={18} className="dbv-error-icon" />
        <span className="dbv-error-title">{props.title}</span>
        {props.badge ? <span className="dbv-error-badge">{props.badge}</span> : null}
      </div>
      <p className="dbv-error-message">{props.message}</p>
      {props.children}
    </section>
  );
}
