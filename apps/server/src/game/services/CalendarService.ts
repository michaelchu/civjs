/**
 * Calendar service implementing freeciv-compliant calendar system with fragments support
 *
 * @reference freeciv/common/calendar.c game_next_year() and calendar_text()
 * @reference freeciv-web/javascript/packhand.js handle_new_year()
 */

export interface CalendarServiceConfig {
  startYear: number;
  calendarFragments: number;
  fragmentNames: string[];
  positiveYearLabel: string;
  negativeYearLabel: string;
  calendarSkip0: boolean;
}

export interface CalendarState {
  year: number;
  fragmentCount: number;
  year0Hack: boolean;
}

export class CalendarService {
  private config: CalendarServiceConfig;
  private state: CalendarState;

  constructor(config: CalendarServiceConfig, initialState?: CalendarState) {
    this.config = config;
    this.state = initialState || {
      year: config.startYear,
      fragmentCount: 0,
      year0Hack: false,
    };
  }

  getState(): CalendarState {
    return { ...this.state };
  }

  setState(state: CalendarState): void {
    this.state = { ...state };
  }

  advanceYear(
    worldBonuses: { turnYears: number; turnFragments: number; slowDownTimeline: number } = {
      turnYears: 1,
      turnFragments: 0,
      slowDownTimeline: 0,
    }
  ): void {
    let increase = worldBonuses.turnYears;
    const slowdown = worldBonuses.slowDownTimeline;

    if (this.state.year0Hack) {
      this.state.year = 0;
      this.state.year0Hack = false;
    }

    increase = this.applySlowdown(increase, slowdown);

    if (this.config.calendarFragments > 0) {
      this.state.fragmentCount += worldBonuses.turnFragments;
      const fragmentYears = Math.floor(this.state.fragmentCount / this.config.calendarFragments);

      increase += fragmentYears;
      this.state.fragmentCount -= fragmentYears * this.config.calendarFragments;
    }

    this.state.year += increase;

    if (this.state.year === 0 && this.config.calendarSkip0) {
      this.state.year = 1;
      this.state.year0Hack = true;
    }
  }

  private applySlowdown(increase: number, slowdown: number): number {
    if (slowdown >= 3) return Math.min(increase, 1);
    if (slowdown >= 2) return Math.min(increase, 2);
    if (slowdown >= 1) return Math.min(increase, 5);
    return increase;
  }

  formatYear(year?: number): string {
    const targetYear = year ?? this.state.year;

    if (targetYear < 0) {
      return `${-targetYear} ${this.config.negativeYearLabel}`;
    } else {
      return `${targetYear} ${this.config.positiveYearLabel}`;
    }
  }

  formatFragment(fragmentIndex?: number): string {
    const targetFragment = fragmentIndex ?? this.state.fragmentCount;

    if (this.config.calendarFragments === 0) {
      return '';
    }

    if (
      targetFragment < this.config.fragmentNames.length &&
      this.config.fragmentNames[targetFragment]
    ) {
      return this.config.fragmentNames[targetFragment];
    } else {
      return `${targetFragment + 1}`;
    }
  }

  formatCalendar(): string {
    if (this.config.calendarFragments > 0) {
      return `${this.formatYear()}/${this.formatFragment()}`;
    } else {
      return this.formatYear();
    }
  }

  static createDefaultConfig(): CalendarServiceConfig {
    return {
      startYear: -4000,
      calendarFragments: 0,
      positiveYearLabel: 'AD',
      negativeYearLabel: 'BC',
      fragmentNames: [],
      calendarSkip0: true,
    };
  }

  static createMonthlyConfig(): CalendarServiceConfig {
    return {
      startYear: -4000,
      calendarFragments: 12,
      positiveYearLabel: 'AD',
      negativeYearLabel: 'BC',
      fragmentNames: [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ],
      calendarSkip0: true,
    };
  }

  static createSeasonalConfig(): CalendarServiceConfig {
    return {
      startYear: -4000,
      calendarFragments: 4,
      positiveYearLabel: 'AD',
      negativeYearLabel: 'BC',
      fragmentNames: ['Spring', 'Summer', 'Autumn', 'Winter'],
      calendarSkip0: true,
    };
  }

  static createRulesetConfig(calendar: {
    start_year: number;
    fragments: number;
    fragment_names: string[];
    positive_label: string;
    negative_label: string;
    skip_year_0: boolean;
  }): CalendarServiceConfig {
    return {
      startYear: calendar.start_year,
      calendarFragments: calendar.fragments,
      fragmentNames: [...calendar.fragment_names],
      positiveYearLabel: calendar.positive_label,
      negativeYearLabel: calendar.negative_label,
      calendarSkip0: calendar.skip_year_0,
    };
  }
}
