// The types every part of the statistics core shares (module map, section 2.2). The
// core imports nothing and receives plain values: these aliases name what a number or
// a string stands for, which sonarjs/redundant-type-aliases cannot know, so the lint
// configuration allows such aliases in this file.

/**
 * An absolute instant (TRV-68): whole milliseconds since 1970-01-01T00:00:00Z. The
 * time module's branded `EpochMs`, received as the plain number it is at run time.
 */
export type EpochMs = number;

/**
 * A calendar date written `YYYY-MM-DD`, in the calendar its producer names (TRV-72):
 * a game's US Eastern date, the owner's day or a date as written. The time module's
 * branded `IsoDate`, received as the plain string it is at run time.
 */
export type IsoDate = string;

/** A followed player's identifier, a random UUID (CL-JOU-09). */
export type PlayerId = string;

/** An event type's identifier, its kebab-case slug, which never changes (TAX-02). */
export type EventTypeId = string;

/** An event's identifier, whatever its origin. */
export type PlayerEventId = number;

/** A case's identifier. */
export type CaseId = number;

/** A game's identifier. */
export type GameId = number;

/** A team's identifier, the application's own, kept across a relocation. */
export type TeamId = number;

/** A play-in or playoff series' identifier. */
export type SeriesId = number;

/** A backtest request's identifier. */
export type BacktestRequestId = number;

/**
 * The games a baseline is drawn from: the regular season, or the play-in and playoff
 * games together (STA-16, STA-18).
 */
export type BaselinePhase = 'postseason' | 'regular_season';

/**
 * The calculation parameters (TRV-35): every parameter of files 07, 08 and 10, which
 * the registry marks as influencing calculations, grouped and named by registry key,
 * in the registry's units. The caller builds it from the parameter registry. The one
 * other marked entry, `taxonomy.switchedOffCriterion`, holds no value of its own: the
 * switch lives on each type sheet and reaches the core with that type (ADR 0016).
 */
export type EngineParams = Readonly<{
  games: Readonly<{
    /** Minutes, the floor of the playing-time threshold, which is the larger of both values (STA-14). */
    minutesFloor: number;
    /** Percent of the player's average minutes per regular-season game, the other value (STA-14). */
    minutesAverageShare: number;
    /** Usable games, the measured game excluded, that a baseline needs (STA-19). */
    minBaselineGames: number;
    /** The games a play-in or playoff game is compared with (STA-18). */
    postseasonBaseline: BaselinePhase;
    /** Percent of played games without an index above which a baseline is partial (STA-24). */
    partialBaselineShare: number;
    /** Hours after the last scheduled tip-off of the past competition day before the update (STA-32). */
    dailyUpdateDelayHours: number;
    /** Days after a game during which its box scores are fetched again for corrections (STA-33). */
    correctionWindowDays: number;
    /** Days after a game, outage days aside, after which a missing box score is unavailable (STA-35). */
    boxScoreUnavailableAfterDays: number;
    /** Hours before the first retry of the statistics source after a failure (STA-36). */
    retryFirstDelayHours: number;
    /** Hours between the later retries (STA-36). */
    retryIntervalHours: number;
    /** Hours of continuous failure before the statistics-source incident opens (STA-37). */
    incidentAfterHours: number;
    /** Percent of each quota limit kept for the requests of levels 1 and 2 of STA-40 (STA-39). */
    quotaReserveShare: number;
  }>;
  sensitivity: Readonly<{
    /** Days after the reference instant within which the player must play, or the case is not measurable (SEN-04). */
    maxAttachmentDays: number;
    /** Whether co-occurring cases are doubtful (SEN-06). */
    coOccurringCasesDoubtful: boolean;
    /** Consecutive team games missed that make the next games a return from injury (SEN-13). */
    injuryReturnMinGamesMissed: number;
    /** Games played after such an absence that count as the return (SEN-13). */
    injuryReturnFirstGames: number;
    /** Whether every playoff game has unusual stakes (SEN-14). */
    allPlayoffGamesUnusualStakes: boolean;
    /** Percent of regular-season wins strictly below which the opponent's level is unusual (SEN-15). */
    opponentWinShareLow: number;
    /** Percent of regular-season wins strictly above which the opponent's level is unusual (SEN-15). */
    opponentWinShareHigh: number;
    /** Games the opponent must have played, the measured game excluded, for its own share to count (SEN-15). */
    opponentMinGames: number;
    /** Valid cases below which a verdict is inconclusive (SEN-23). */
    minValidCases: number;
    /** Signal-to-noise ratio, in absolute value, from which an effect is possible (SEN-23). */
    possibleSignalToNoise: number;
    /** Normalized mean gap, in absolute value, from which an effect is possible (SEN-23). */
    possibleMeanGap: number;
    /** Signal-to-noise ratio, in absolute value, from which an effect is probable (SEN-23). */
    probableSignalToNoise: number;
    /** Normalized mean gap, in absolute value, from which an effect is probable (SEN-23). */
    probableMeanGap: number;
    /** Valid cases from which a profile's confidence starts medium (SEN-25). */
    confidenceMediumFromCases: number;
    /** Valid cases from which a profile's confidence starts high (SEN-25). */
    confidenceHighFromCases: number;
    /** Dispersion of the gaps above which the profile confidence drops a level (SEN-25). */
    confidenceDispersionDrop: number;
    /** Percent of doubtful cases, excluded over valid and excluded, above which it drops a level (SEN-25). */
    confidenceDoubtfulShareDrop: number;
    /** Distinct players whose valid cases a general trend's verdict needs (SEN-29). */
    trendMinPlayers: number;
    /** Percent of a trend's valid cases from one player above which its confidence drops a level (SEN-29). */
    trendMaxTopShare: number;
    /** Cases below which proportions are shown as counts, never as percentages (SEN-39). */
    countsBelowCases: number;
  }>;
  tracking: Readonly<{
    /** Gap in the forecast's direction from which a tracked case is confirmed, its opposite refuted (SUI-22). */
    categoryThreshold: number;
    /** Tracked cases with a forecast that a validation-table row needs for its assessment (SUI-26). */
    minTrackedCasesForAssessment: number;
  }>;
}>;
