export type BoardStatus = "active" | "completed" | "abandoned";

export interface BoardTransition {
  from: BoardStatus | null; // null = no board exists
  to: BoardStatus;
}

const VALID_TRANSITIONS: BoardTransition[] = [
  { from: null, to: "active" },
  { from: "active", to: "completed" },
  { from: "active", to: "abandoned" },
];

export function canTransition(from: BoardStatus | null, to: BoardStatus): boolean {
  return VALID_TRANSITIONS.some((t) => t.from === from && t.to === to);
}

export function validateNewBoard(currentStatus: BoardStatus | null): void {
  if (!canTransition(currentStatus, "active")) {
    throw new Error(
      currentStatus === "active"
        ? "You already have an active board. Complete or abandon it first."
        : `Cannot create board from state: ${currentStatus}`
    );
  }
}

export function validateRoll(boardStatus: BoardStatus | null): void {
  if (boardStatus !== "active") {
    throw new Error("No active board. Create a new board first.");
  }
}
