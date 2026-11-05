import { apiRequest } from "@/services/api/client";

/** The viewer's shoots dated from `from` to `to` (both `YYYY-MM-DD`, included), and how many have no date. */
export function getShootBoard(from, to) {
  return apiRequest(`/api/project-management/shoot-board/shoots?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}
