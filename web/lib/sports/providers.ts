import { fetchEspnScores } from "./espn";
import { fetchOdds } from "./odds";
import { fetchSportsNews } from "./news";
import type { League, NormalizedGame, NormalizedNews, NormalizedOdds, ProviderResult } from "./types";

export type SportsProviders = {
  fetchScores: (league: League) => Promise<ProviderResult<NormalizedGame>>;
  fetchOdds: (league: League) => Promise<ProviderResult<NormalizedOdds>>;
  fetchNews: (league: League) => Promise<ProviderResult<NormalizedNews>>;
};

// Single factory for sports providers used by refresh pipelines.
export function getSportsProviders(): SportsProviders {
  return {
    fetchScores: fetchEspnScores,
    fetchOdds,
    fetchNews: fetchSportsNews,
  };
}

