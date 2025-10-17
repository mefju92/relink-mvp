export type MatchStatus = "ok" | "warn";
export type TrackRow = {
  id: string;
  status: MatchStatus;           // ok | warn
  title: string;
  artist?: string;
  album?: string;
  time?: string;                 // "4:32"
  spotifyUrl?: string | null;
  added: boolean;                // do playlisty
};
export type FilterKey = "all" | "matched" | "unmatched";
export type SortKey = "title" | "artist" | "album" | "time";
