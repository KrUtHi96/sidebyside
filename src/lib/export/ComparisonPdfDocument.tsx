import React from "react";
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type {
  ComparisonResult,
  DiffGranularity,
  DiffToken,
  SectionComparison,
} from "@/types/comparison";

const styles = StyleSheet.create({
  page: {
    padding: 24,
    fontSize: 10,
    fontFamily: "Helvetica",
    lineHeight: 1.45,
  },
  title: {
    fontSize: 17,
    marginBottom: 10,
    fontFamily: "Helvetica-Bold",
  },
  subtitle: {
    fontSize: 11,
    marginBottom: 6,
    color: "#334155",
  },
  summaryBox: {
    border: "1 solid #cbd5e1",
    borderRadius: 6,
    padding: 8,
    marginBottom: 12,
  },
  sectionHeader: {
    marginTop: 12,
    marginBottom: 6,
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    color: "#0f172a",
  },
  status: {
    color: "#475569",
    textTransform: "uppercase",
    fontSize: 8,
  },
  columns: {
    flexDirection: "row",
    gap: 8,
  },
  col: {
    width: "50%",
    border: "1 solid #e2e8f0",
    borderRadius: 4,
    padding: 6,
  },
  colTitle: {
    marginBottom: 4,
    color: "#1e293b",
    fontFamily: "Helvetica-Bold",
  },
  emptyText: {
    color: "#94a3b8",
    fontStyle: "italic",
  },
  sectionTitle: {
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
    marginTop: 10,
    fontSize: 12,
  },
  redRemoved: {
    color: "#b91c1c",
    textDecoration: "line-through",
  },
  greenAdded: {
    color: "#15803d",
  },
  appendixRow: {
    borderBottom: "1 solid #e2e8f0",
    paddingVertical: 4,
  },
});

const getTokensByGranularity = (
  section: SectionComparison,
  granularity: DiffGranularity,
): DiffToken[] => {
  if (granularity === "sentence") {
    return section.sectionDiffSentence;
  }

  if (granularity === "paragraph") {
    return section.sectionDiffParagraph;
  }

  return section.sectionDiffWord;
};

const renderTokenForCompared = (token: DiffToken, index: number) => {
  const style =
    token.kind === "removed"
      ? styles.redRemoved
      : token.kind === "added"
        ? styles.greenAdded
        : undefined;
  return (
    <Text key={`comp-token-${index}`} style={style}>
      {token.value}
    </Text>
  );
};

const presenceText = (inBase: boolean, inCompared: boolean): string => {
  if (inBase && inCompared) {
    return "both";
  }

  if (inBase) {
    return "base only";
  }

  return "compared only";
};

export const ComparisonPdfDocument = ({
  comparison,
  granularity,
}: {
  comparison: ComparisonResult;
  granularity: DiffGranularity;
}) => {
  const counts = comparison.rows.reduce(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    {
      unchanged: 0,
      changed: 0,
      added: 0,
      removed: 0,
      ambiguous: 0,
    },
  );

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Framework Comparison Report</Text>
        <Text style={styles.subtitle}>Base: {comparison.baseFileName}</Text>
        <Text style={styles.subtitle}>Compared: {comparison.comparedFileName}</Text>
        <Text style={styles.subtitle}>Generated: {new Date(comparison.generatedAt).toLocaleString()}</Text>

        <View style={styles.summaryBox}>
          <Text>
            Sections: {comparison.sections.length} | Changed: {counts.changed} | Added: {counts.added} | Removed: {counts.removed} | Ambiguous: {counts.ambiguous} |
            Unchanged: {counts.unchanged}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Full Framework Comparison</Text>

        {comparison.sections.map((section) => {
          const tokens = getTokensByGranularity(section, granularity);

          return (
            <View key={`section-${section.header}`}>
              <Text style={styles.sectionHeader}>{section.header}</Text>
              <Text style={styles.status}>{section.status}</Text>

              <View style={styles.columns}>
                <View style={styles.col}>
                  <Text style={styles.colTitle}>Base</Text>
                  {section.baseSectionTextPreserved ? (
                    <Text>{section.baseSectionTextPreserved}</Text>
                  ) : (
                    <Text style={styles.emptyText}>Section missing in base document.</Text>
                  )}
                </View>

                <View style={styles.col}>
                  <Text style={styles.colTitle}>Compared</Text>
                  {section.baseSectionTextPreserved || section.comparedSectionTextPreserved ? (
                    <Text>{tokens.map((token, index) => renderTokenForCompared(token, index))}</Text>
                  ) : (
                    <Text style={styles.emptyText}>Section missing in compared document.</Text>
                  )}
                </View>
              </View>
            </View>
          );
        })}
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>Appendix: Clause Navigation Labels</Text>
        {comparison.sections.map((section) => (
          <View key={`appendix-section-${section.header}`}>
            <Text style={styles.sectionHeader}>{section.header}</Text>
            {section.rows.length === 0 ? (
              <Text style={styles.emptyText}>No clauses extracted for this section.</Text>
            ) : (
              section.rows.map((row) => (
                <View key={`appendix-row-${section.header}-${row.key}`} style={styles.appendixRow}>
                  <Text>
                    {row.displayLabel} [{presenceText(row.inBase, row.inCompared)}]
                  </Text>
                </View>
              ))
            )}
          </View>
        ))}

        <Text style={styles.sectionTitle}>Appendix: Unmatched / Unextractable</Text>
        <Text style={styles.subtitle}>Base extraction issues</Text>
        {comparison.extractionIssues.base.length === 0 ? (
          <Text style={styles.emptyText}>None.</Text>
        ) : (
          comparison.extractionIssues.base.map((issue) => (
            <View key={`base-issue-${issue.key}`} style={styles.appendixRow}>
              <Text>
                [{issue.pageStart}] {issue.key}: {issue.text.slice(0, 240)}
              </Text>
            </View>
          ))
        )}

        <Text style={styles.subtitle}>Compared extraction issues</Text>
        {comparison.extractionIssues.compared.length === 0 ? (
          <Text style={styles.emptyText}>None.</Text>
        ) : (
          comparison.extractionIssues.compared.map((issue) => (
            <View key={`comp-issue-${issue.key}`} style={styles.appendixRow}>
              <Text>
                [{issue.pageStart}] {issue.key}: {issue.text.slice(0, 240)}
              </Text>
            </View>
          ))
        )}
      </Page>
    </Document>
  );
};
