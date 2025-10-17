export type MatchStatus = "ok" | "warn";
export type TrackRow = {
  id: string;
  status: MatchStatus;
  title: string;
  artist?: string;
  album?: string;
  time?: string;
  spotifyUrl?: string | null;
  added: boolean;
};
export type FilterKey = "all" | "matched" | "unmatched";
export type SortKey   = "title" | "artist" | "album" | "time";

// export {}; // (opcjonalnie)
