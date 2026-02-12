import type { DiffToken } from "@/types/comparison";

export const RedlineText = ({
  tokens,
  side,
}: {
  tokens: DiffToken[];
  side: "base" | "compared";
}) => {
  return (
    <pre className="text-[15px] leading-7 whitespace-pre-wrap break-words font-serif text-slate-800">
      {tokens.map((token, index) => {
        if (side === "base" && token.kind === "added") {
          return null;
        }

        if (token.kind === "removed") {
          return (
            <span
              key={`token-${index}`}
              className="bg-rose-50 text-rose-800 line-through decoration-2 decoration-rose-700"
            >
              {token.value}
            </span>
          );
        }

        if (token.kind === "added") {
          return (
            <span
              key={`token-${index}`}
              className="bg-emerald-50 text-emerald-800 font-semibold"
            >
              {token.value}
            </span>
          );
        }

        return <span key={`token-${index}`}>{token.value}</span>;
      })}
    </pre>
  );
};
