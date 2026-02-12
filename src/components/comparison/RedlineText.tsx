import type { DiffToken } from "@/types/comparison";

export const RedlineText = ({
  tokens,
  side,
}: {
  tokens: DiffToken[];
  side: "base" | "compared";
}) => {
  return (
    <pre 
      className="whitespace-pre-wrap break-words font-sans text-sm leading-7"
      style={{ color: "var(--color-text-secondary)" }}
    >
      {tokens.map((token, index) => {
        // In base panel, don't show added text
        if (side === "base" && token.kind === "added") {
          return null;
        }

        // Removed text styling
        if (token.kind === "removed") {
          return (
            <span
              key={`token-${index}`}
              style={{
                background: "var(--color-removed-bg)",
                color: "var(--color-removed-text)",
                textDecoration: "line-through",
                textDecorationThickness: "2px",
                padding: "1px 2px",
                borderRadius: "2px",
              }}
            >
              {token.value}
            </span>
          );
        }

        // Added text styling
        if (token.kind === "added") {
          return (
            <span
              key={`token-${index}`}
              style={{
                background: "var(--color-added-bg)",
                color: "var(--color-added-text)",
                fontWeight: 500,
                padding: "1px 2px",
                borderRadius: "2px",
              }}
            >
              {token.value}
            </span>
          );
        }

        // Equal text (no special styling)
        return <span key={`token-${index}`}>{token.value}</span>;
      })}
    </pre>
  );
};
