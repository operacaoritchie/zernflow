import { Fragment } from "react";

/**
 * Render a translated string whose {placeholders} are React nodes, e.g.
 *   rich(t("loggedInAs"), { email: <strong>{email}</strong> })
 * Works in Server and Client Components. Placeholders without a node are
 * left as text.
 */
export function rich(template: string, nodes: Record<string, React.ReactNode>) {
  const parts = template.split(/(\{\w+\})/g);
  return parts.map((part, i) => {
    const match = /^\{(\w+)\}$/.exec(part);
    if (match && match[1] in nodes) return <Fragment key={i}>{nodes[match[1]]}</Fragment>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
