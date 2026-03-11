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
      className="whitespace-pre-wrap break-words font-sans text-[15px] leading-[1.9] tracking-[0.005em]"
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
                padding: "1px 3px",
                borderRadius: "3px",
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
                fontWeight: 600,
                padding: "1px 3px",
                borderRadius: "3px",
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
