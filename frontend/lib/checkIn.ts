import type {
  CheckInProgress,
  FinancialReportResponse,
} from "./api";
import { calendarMonth, money } from "./format";

export type ProgressMilestone = CheckInProgress["milestones_reached"][number];
export type ProgressComparison = CheckInProgress["since_previous"];

export type CommitmentKind =
  | "planned_extra"
  | "protect_minimums"
  | "review_shortfall"
  | "contact_creditor"
  | "review_balances";

export type CheckInCommitment = {
  kind: CommitmentKind;
  createdMonth: string;
  targetMonth: string;
  amount: string | null;
};

export type CommitmentSuggestion = CheckInCommitment & { sentence: string };

export type ProgressCopy = {
  title: string;
  detail: string;
  tone: "positive" | "neutral" | "recovery";
};

export function isPositiveMoney(value: string): boolean {
  return !/^0+(?:\.0+)?$/.test(value);
}

export function nextCalendarMonth(month: string): string {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const value = Number(monthText);
  return value === 12
    ? `${year + 1}-01`
    : `${year}-${String(value + 1).padStart(2, "0")}`;
}

export function progressCopy(
  comparison: ProgressComparison,
  previousMonth: string,
): ProgressCopy {
  const prior = calendarMonth(previousMonth);
  if (comparison.status === "decreased" && comparison.amount !== null) {
    return {
      title: `Your tracked debt is down ${money(comparison.amount)}.`,
      detail: `That is the change since ${prior}. Your updated plan still protects the limits in your budget.`,
      tone: "positive",
    };
  }
  if (comparison.status === "increased" && comparison.amount !== null) {
    return {
      title: `Your tracked debt is up ${money(comparison.amount)}.`,
      detail: "This is information, not failure. Use the updated numbers to choose what is sustainable now.",
      tone: "recovery",
    };
  }
  if (comparison.status === "portfolio_changed") {
    return {
      title: "Your tracked debts changed.",
      detail: "Debts were added or removed, so a simple progress comparison would be misleading.",
      tone: "neutral",
    };
  }
  return {
    title: "Your balance is unchanged.",
    detail: "Keeping the picture current still matters. You can adjust the plan without judging the month.",
    tone: "neutral",
  };
}

export const MILESTONE_LABELS: Record<ProgressMilestone, string> = {
  "10_percent": "10% of your starting debt reduced",
  "25_percent": "One quarter of your starting debt reduced",
  "50_percent": "Half of your starting debt reduced",
  "75_percent": "Three quarters of your starting debt reduced",
  debt_free: "Your tracked debt reached zero",
};

export function commitmentSentence(commitment: CheckInCommitment): string {
  switch (commitment.kind) {
    case "planned_extra":
      return `When my next payday arrives, I’ll reserve ${money(commitment.amount ?? "0.00")} for my debt plan.`;
    case "protect_minimums":
      return "Before extra spending, I’ll set aside every debt minimum.";
    case "review_shortfall":
      return `Before my next due date, I’ll review the ${money(commitment.amount ?? "0.00")} monthly gap and one adjustable expense.`;
    case "contact_creditor":
      return "If I may miss a minimum, I’ll contact that creditor before the due date.";
    case "review_balances":
      return `When ${calendarMonth(commitment.targetMonth)} begins, I’ll check my balances again.`;
  }
}

function suggestion(
  kind: CommitmentKind,
  month: string,
  amount: string | null = null,
): CommitmentSuggestion {
  const commitment = {
    kind,
    createdMonth: month,
    targetMonth: nextCalendarMonth(month),
    amount,
  };
  return { ...commitment, sentence: commitmentSentence(commitment) };
}

export function commitmentSuggestions(
  report: FinancialReportResponse,
  month: string,
  hasActiveDebt: boolean,
): CommitmentSuggestion[] {
  if (!hasActiveDebt) return [suggestion("review_balances", month)];
  if (report.cash_flow.status === "deficit") {
    return [
      suggestion("review_shortfall", month, report.cash_flow.shortfall),
      suggestion("contact_creditor", month),
      suggestion("review_balances", month),
    ];
  }

  const choices: CommitmentSuggestion[] = [];
  if (isPositiveMoney(report.debt_payment_budget.planned_extra_monthly_payment)) {
    choices.push(
      suggestion(
        "planned_extra",
        month,
        report.debt_payment_budget.planned_extra_monthly_payment,
      ),
    );
  }
  choices.push(suggestion("protect_minimums", month));
  choices.push(suggestion("review_balances", month));
  return choices;
}
