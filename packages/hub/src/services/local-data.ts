import type {
  LocalDataStore,
  LocalDataView,
  LocalRetention,
  LocalRetentionInput,
} from "@amoshydra/oktoso-contracts";
import type { StateStore } from "@amoshydra/oktoso-storage";
import type { ReplyFeedbackStore } from "./reply-feedback-store";
import type { TranscriptCacheService } from "./transcript-cache";

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface LocalDataServiceOptions {
  store: StateStore;
  feedback: ReplyFeedbackStore;
  transcripts?: TranscriptCacheService;
  now?: () => number;
}

/**
 * Owns everything the hub keeps on its own disk that is not the hub state
 * itself: drafts, read markers, reply feedback, and the transcript cache.
 *
 * Clearing here never touches a provider. Retention is per store because the
 * stores differ: a draft is unsent work, a read marker is a convenience, and
 * the cache is derived data that can always be rebuilt.
 */
export class LocalDataService {
  private readonly now: () => number;

  constructor(private readonly options: LocalDataServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  async view(): Promise<LocalDataView> {
    const state = this.options.store.getState();
    const feedback = await this.options.feedback.stats();
    return {
      drafts: Object.keys(state.drafts).length,
      markers: Object.keys(state.readMarkers).length,
      feedback: feedback.entries,
      feedbackBytes: feedback.bytes,
      retention: { ...state.localRetention },
    };
  }

  async updateRetention(input: LocalRetentionInput): Promise<LocalDataView> {
    const next: LocalRetention = {
      ...this.options.store.getState().localRetention,
      ...input,
    };
    await this.options.store.update((state) => {
      state.localRetention = next;
    });
    await this.prune();
    return this.view();
  }

  async clear(store: LocalDataStore): Promise<LocalDataView> {
    if (store === "feedback") {
      await this.options.feedback.clear();
      return this.view();
    }
    await this.options.store.update((state) => {
      if (store === "drafts") state.drafts = {};
      else state.readMarkers = {};
    });
    return this.view();
  }

  /** Clears every local store, including the cache and its search index. */
  async clearAll(): Promise<LocalDataView> {
    await this.options.store.update((state) => {
      state.drafts = {};
      state.readMarkers = {};
    });
    await this.options.feedback.clear();
    await this.options.transcripts?.clear();
    return this.view();
  }

  /** Drops entries past each store's retention window. `0` means never. */
  async prune(): Promise<void> {
    const { draftsDays, markersDays, feedbackDays } =
      this.options.store.getState().localRetention;
    const now = this.now();

    if (draftsDays > 0 || markersDays > 0) {
      await this.options.store.update((state) => {
        if (draftsDays > 0) {
          for (const [ref, draft] of Object.entries(state.drafts)) {
            if (draft.updatedAt < now - draftsDays * DAY_MS) delete state.drafts[ref];
          }
        }
        if (markersDays > 0) {
          for (const [ref, marker] of Object.entries(state.readMarkers)) {
            if (marker.readAt < now - markersDays * DAY_MS) {
              delete state.readMarkers[ref];
            }
          }
        }
      });
    }

    if (feedbackDays > 0) {
      await this.options.feedback.pruneBefore(now - feedbackDays * DAY_MS);
    }
  }
}
