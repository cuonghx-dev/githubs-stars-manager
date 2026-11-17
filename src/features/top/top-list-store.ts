import { create } from "zustand";
import {
  DEFAULT_TOP_PAGE_SIZE,
  DEFAULT_TOP_SORT,
  type TopSort,
} from "@/features/top/rank";

// Top view list state (sort, page, page size). Kept outside the component so
// it survives the view unmounting: clicking a repo jumps to the graph, and
// coming back should land on the same page, not page 1.

interface TopListState {
  sort: TopSort;
  /** 0-based page index; the view clamps it to the current row count. */
  page: number;
  pageSize: number;
  setSort: (sort: TopSort) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
}

export const useTopListStore = create<TopListState>()((set) => ({
  sort: DEFAULT_TOP_SORT,
  page: 0,
  pageSize: DEFAULT_TOP_PAGE_SIZE,
  // A new order or page size starts from the top of the list.
  setSort: (sort) => set({ sort, page: 0 }),
  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize, page: 0 }),
}));
