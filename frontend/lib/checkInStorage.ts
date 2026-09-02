import type {
  CheckInContext,
  CheckInProgress,
  FinancialReportResponse,
} from "./api";
import type {
  CheckInCommitment,
  CommitmentKind,
  ProgressMilestone,
} from "./checkIn";
import type { PreferredStrategy } from "./profileStorage";

export type CheckInStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type CheckInDebtSnapshot = { id: string; balance: string };
export type CheckInPortfolioSnapshot = {
  month: string;
  debts: CheckInDebtSnapshot[];
};

export type CheckInSnapshot = CheckInPortfolioSnapshot & {
  totalDebt: string;
  cashFlowStatus: FinancialReportResponse["cash_flow"]["status"];
  plannedExtra: string;
  selectedStrategy: PreferredStrategy | null;
  payoffMonth: string | null;
  progress: CheckInProgress | null;
  newMilestones: ProgressMilestone[];
  newlyCelebratedDebtIds: string[];
};

export type CheckInState = {
  baseline: CheckInPortfolioSnapshot | null;
  snapshots: CheckInSnapshot[];
  activeCommitment: CheckInCommitment | null;
  dismissedPromptMonth: string | null;
  celebratedMilestones: ProgressMilestone[];
  celebratedPaidOffDebtIds: string[];
};

export const CHECK_IN_KEY = "debtpilot.check-ins.v1";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONEY = /^\d+(?:\.\d{1,2})?$/;
const PROGRESS_STATUSES = new Set([
  "decreased",
  "unchanged",
  "increased",
  "portfolio_changed",
]);
const MILESTONES = new Set<ProgressMilestone>([
  "10_percent",
  "25_percent",
  "50_percent",
  "75_percent",
  "debt_free",
]);
const COMMITMENTS = new Set<CommitmentKind>([
  "planned_extra",
  "protect_minimums",
  "review_shortfall",
  "contact_creditor",
  "review_balances",
]);

export function emptyCheckInState(): CheckInState {
  return {
    baseline: null,
    snapshots: [],
    activeCommitment: null,
    dismissedPromptMonth: null,
    celebratedMilestones: [],
    celebratedPaidOffDebtIds: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMoney(value: unknown): value is string {
  return typeof value === "string" && MONEY.test(value);
}

function isMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH.test(value);
}

function isDebt(value: unknown): value is CheckInDebtSnapshot {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= 64 &&
    isMoney(value.balance)
  );
}

function isPortfolio(value: unknown): value is CheckInPortfolioSnapshot {
  if (!isRecord(value) || !isMonth(value.month) || !Array.isArray(value.debts)) {
    return false;
  }
  if (value.debts.length > 20 || !value.debts.every(isDebt)) {
    return false;
  }
  const ids = value.debts.map((debt) => debt.id);
  return new Set(ids).size === ids.length;
}

function isComparison(value: unknown): boolean {
  if (!isRecord(value) || !PROGRESS_STATUSES.has(String(value.status))) return false;
  return value.amount === null || isMoney(value.amount);
}

function isProgress(value: unknown): value is CheckInProgress {
  return (
    isRecord(value) &&
    isMonth(value.previous_month) &&
    isComparison(value.since_previous) &&
    isComparison(value.since_baseline) &&
    Array.isArray(value.newly_paid_off_debt_ids) &&
    value.newly_paid_off_debt_ids.every((id) => typeof id === "string") &&
    Array.isArray(value.milestones_reached) &&
    value.milestones_reached.every((milestone) => MILESTONES.has(milestone))
  );
}

function isSnapshot(value: unknown): value is CheckInSnapshot {
  if (!isPortfolio(value)) return false;
  const record = value as CheckInPortfolioSnapshot & Record<string, unknown>;
  return (
    isMoney(record.totalDebt) &&
    (record.cashFlowStatus === "deficit" ||
      record.cashFlowStatus === "break_even" ||
      record.cashFlowStatus === "surplus") &&
    isMoney(record.plannedExtra) &&
    (record.selectedStrategy === null ||
      record.selectedStrategy === "snowball" ||
      record.selectedStrategy === "avalanche") &&
    (record.payoffMonth === null || isMonth(record.payoffMonth)) &&
    (record.progress === null || isProgress(record.progress)) &&
    Array.isArray(record.newMilestones) &&
    record.newMilestones.every((milestone) => MILESTONES.has(milestone)) &&
    Array.isArray(record.newlyCelebratedDebtIds) &&
    record.newlyCelebratedDebtIds.every((id) => typeof id === "string")
  );
}

function isCommitment(value: unknown): value is CheckInCommitment {
  return (
    isRecord(value) &&
    COMMITMENTS.has(value.kind as CommitmentKind) &&
    isMonth(value.createdMonth) &&
    isMonth(value.targetMonth) &&
    (value.amount === null || isMoney(value.amount))
  );
}

function isState(value: unknown): value is CheckInState {
  if (!isRecord(value)) return false;
  let baseline: CheckInPortfolioSnapshot | null = null;
  if (value.baseline !== null) {
    if (!isPortfolio(value.baseline) || value.baseline.debts.length === 0) return false;
    baseline = value.baseline;
  }
  if (
    !Array.isArray(value.snapshots) ||
    value.snapshots.length > 24 ||
    !value.snapshots.every(isSnapshot)
  ) {
    return false;
  }
  const months = value.snapshots.map((snapshot) => snapshot.month);
  if (
    new Set(months).size !== months.length ||
    months.some((month, index) => index > 0 && months[index - 1] >= month) ||
    (baseline !== null && months.some((month) => month < baseline.month))
  ) {
    return false;
  }
  return (
    (value.activeCommitment === null || isCommitment(value.activeCommitment)) &&
    (value.dismissedPromptMonth === null || isMonth(value.dismissedPromptMonth)) &&
    Array.isArray(value.celebratedMilestones) &&
    value.celebratedMilestones.every((milestone) => MILESTONES.has(milestone)) &&
    Array.isArray(value.celebratedPaidOffDebtIds) &&
    value.celebratedPaidOffDebtIds.every((id) => typeof id === "string")
  );
}

export function loadCheckInState(storage: CheckInStorageLike | null): CheckInState {
  if (storage === null) return emptyCheckInState();
  try {
    const raw = storage.getItem(CHECK_IN_KEY);
    if (raw === null) return emptyCheckInState();
    const parsed: unknown = JSON.parse(raw);
    return isState(parsed) ? parsed : emptyCheckInState();
  } catch {
    return emptyCheckInState();
  }
}

export function saveCheckInState(
  storage: CheckInStorageLike | null,
  state: CheckInState,
): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(CHECK_IN_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearCheckInState(storage: CheckInStorageLike | null): boolean {
  if (storage === null) return false;
  try {
    storage.removeItem(CHECK_IN_KEY);
    return true;
  } catch {
    return false;
  }
}

export function browserCheckInStorage(): CheckInStorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function latestCheckIn(state: CheckInState): CheckInSnapshot | null {
  return state.snapshots.at(-1) ?? null;
}

export function checkInDue(state: CheckInState, currentMonth: string): boolean {
  const latest = latestCheckIn(state);
  return (
    state.baseline !== null &&
    latest !== null &&
    latest.month < currentMonth &&
    state.dismissedPromptMonth !== currentMonth
  );
}

export function dismissCheckInPrompt(
  state: CheckInState,
  currentMonth: string,
): CheckInState {
  return { ...state, dismissedPromptMonth: currentMonth };
}

export function progressContextFor(
  state: CheckInState,
  currentMonth: string,
): CheckInContext | undefined {
  if (state.baseline === null || state.baseline.month > currentMonth) return undefined;
  const previous = [...state.snapshots]
    .filter((snapshot) => snapshot.month < currentMonth)
    .sort((a, b) => a.month.localeCompare(b.month))
    .at(-1);
  const fallback = state.baseline.month < currentMonth ? state.baseline : undefined;
  const selected = previous ?? fallback;
  if (selected === undefined) return undefined;
  return {
    baseline: state.baseline,
    previous: { month: selected.month, debts: selected.debts },
  };
}

export function recordCheckIn(
  state: CheckInState,
  snapshot: Omit<CheckInSnapshot, "newMilestones" | "newlyCelebratedDebtIds">,
  commitment: CheckInCommitment | null,
): CheckInState {
  const newMilestones = (snapshot.progress?.milestones_reached ?? []).filter(
    (milestone) => !state.celebratedMilestones.includes(milestone),
  );
  const newlyCelebratedDebtIds = (
    snapshot.progress?.newly_paid_off_debt_ids ?? []
  ).filter((id) => !state.celebratedPaidOffDebtIds.includes(id));
  const savedSnapshot: CheckInSnapshot = {
    ...snapshot,
    newMilestones,
    newlyCelebratedDebtIds,
  };
  const snapshots = [
    ...state.snapshots.filter((item) => item.month !== snapshot.month),
    savedSnapshot,
  ]
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-24);
  const onlyBaselineMonth = snapshots.every((item) => item.month === snapshot.month);
  const baseline =
    state.baseline === null ||
    (state.baseline.month === snapshot.month && onlyBaselineMonth)
      ? { month: snapshot.month, debts: snapshot.debts }
      : state.baseline;

  return {
    baseline,
    snapshots,
    activeCommitment: commitment,
    dismissedPromptMonth: snapshot.month,
    celebratedMilestones: Array.from(
      new Set([...state.celebratedMilestones, ...newMilestones]),
    ),
    celebratedPaidOffDebtIds: Array.from(
      new Set([...state.celebratedPaidOffDebtIds, ...newlyCelebratedDebtIds]),
    ),
  };
}
