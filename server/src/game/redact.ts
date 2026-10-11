// Public board serialisation. Never expose game randomness to client.
import type { Board } from "../db/queries/boards";
import type { Cell, CellType } from "./grid";

export interface PublicCell {
  type: CellType | null;
  hits: number;
  threshold: number | null;
  completed: boolean;
}

export function redactCell(cell: Cell, revealType: boolean): PublicCell {
  if (cell.completed || revealType) {
    return { type: cell.type, hits: cell.hits, threshold: cell.threshold, completed: cell.completed };
  }
  return {
    type: null,
    hits: cell.hits,
    threshold: cell.hits > 0 ? cell.threshold : null,
    completed: false,
  };
}

export function redactGrid(grid: Cell[][], revealTypes: boolean): PublicCell[][] {
  return grid.map((row) => row.map((cell) => redactCell(cell, revealTypes)));
}

export function redactBoard(board: Board): Omit<Board, "grid"> & { grid: PublicCell[][] } {
  return { ...board, grid: redactGrid(board.grid, board.xray_remaining > 0) };
}
