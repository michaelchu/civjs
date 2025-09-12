/**
 * Tests for CalendarService - freeciv-compliant calendar system
 */

import { CalendarService } from '../CalendarService';

describe('CalendarService', () => {
  describe('Default Configuration', () => {
    let calendarService: CalendarService;

    beforeEach(() => {
      calendarService = new CalendarService(CalendarService.createDefaultConfig());
    });

    test('should initialize with correct starting year', () => {
      const state = calendarService.getState();
      expect(state.year).toBe(-4000);
      expect(state.fragmentCount).toBe(0);
      expect(state.year0Hack).toBe(false);
    });

    test('should advance years correctly', () => {
      calendarService.advanceYear({ turnYears: 40, turnFragments: 0, slowDownTimeline: 0 });
      expect(calendarService.getState().year).toBe(-3960);

      calendarService.advanceYear({ turnYears: 40, turnFragments: 0, slowDownTimeline: 0 });
      expect(calendarService.getState().year).toBe(-3920);
    });

    test('should format years correctly', () => {
      expect(calendarService.formatYear(-4000)).toBe('4000 BC');
      expect(calendarService.formatYear(-1)).toBe('1 BC');
      expect(calendarService.formatYear(1)).toBe('1 AD');
      expect(calendarService.formatYear(2024)).toBe('2024 AD');
    });

    test('should handle year 0 skip correctly', () => {
      const calendarService = new CalendarService(CalendarService.createDefaultConfig(), {
        year: -1,
        fragmentCount: 0,
        year0Hack: false,
      });

      calendarService.advanceYear({ turnYears: 1, turnFragments: 0, slowDownTimeline: 0 });
      const state = calendarService.getState();

      expect(state.year).toBe(1); // Should skip year 0
      expect(state.year0Hack).toBe(true);
    });

    test('should apply slowdown effects correctly', () => {
      // Slowdown level 3: max 1 year per turn
      calendarService.advanceYear({ turnYears: 50, turnFragments: 0, slowDownTimeline: 3 });
      expect(calendarService.getState().year).toBe(-3999);

      // Slowdown level 2: max 2 years per turn
      calendarService.advanceYear({ turnYears: 50, turnFragments: 0, slowDownTimeline: 2 });
      expect(calendarService.getState().year).toBe(-3997);

      // Slowdown level 1: max 5 years per turn
      calendarService.advanceYear({ turnYears: 50, turnFragments: 0, slowDownTimeline: 1 });
      expect(calendarService.getState().year).toBe(-3992);
    });
  });

  describe('Monthly Configuration', () => {
    let calendarService: CalendarService;

    beforeEach(() => {
      calendarService = new CalendarService(CalendarService.createMonthlyConfig());
    });

    test('should handle fragments correctly', () => {
      calendarService.advanceYear({ turnYears: 0, turnFragments: 6, slowDownTimeline: 0 });
      const state = calendarService.getState();
      expect(state.fragmentCount).toBe(6);
      expect(state.year).toBe(-4000); // No year change yet

      // Add enough fragments to advance a year
      calendarService.advanceYear({ turnYears: 0, turnFragments: 6, slowDownTimeline: 0 });
      const newState = calendarService.getState();
      expect(newState.year).toBe(-3999); // One year advanced
      expect(newState.fragmentCount).toBe(0); // Fragments reset
    });

    test('should format fragments correctly', () => {
      expect(calendarService.formatFragment(0)).toBe('January');
      expect(calendarService.formatFragment(5)).toBe('June');
      expect(calendarService.formatFragment(11)).toBe('December');
      expect(calendarService.formatFragment(15)).toBe('16'); // Beyond named months
    });

    test('should format calendar with fragments', () => {
      const calendarService = new CalendarService(CalendarService.createMonthlyConfig(), {
        year: 1500,
        fragmentCount: 5,
        year0Hack: false,
      });

      expect(calendarService.formatCalendar()).toBe('1500 AD/June');
    });
  });

  describe('Seasonal Configuration', () => {
    let calendarService: CalendarService;

    beforeEach(() => {
      calendarService = new CalendarService(CalendarService.createSeasonalConfig());
    });

    test('should format seasonal fragments correctly', () => {
      expect(calendarService.formatFragment(0)).toBe('Spring');
      expect(calendarService.formatFragment(1)).toBe('Summer');
      expect(calendarService.formatFragment(2)).toBe('Autumn');
      expect(calendarService.formatFragment(3)).toBe('Winter');
    });

    test('should handle seasonal progression', () => {
      // Start in Spring of -4000 BC
      calendarService.advanceYear({ turnYears: 0, turnFragments: 2, slowDownTimeline: 0 });
      expect(calendarService.getState().fragmentCount).toBe(2);
      expect(calendarService.formatFragment()).toBe('Autumn');

      // Add 2 more fragments to complete the year
      calendarService.advanceYear({ turnYears: 0, turnFragments: 2, slowDownTimeline: 0 });
      expect(calendarService.getState().year).toBe(-3999);
      expect(calendarService.getState().fragmentCount).toBe(0);
      expect(calendarService.formatFragment()).toBe('Spring');
    });
  });

  describe('State Persistence', () => {
    test('should save and restore state correctly', () => {
      const calendarService = new CalendarService(CalendarService.createMonthlyConfig());

      calendarService.advanceYear({ turnYears: 100, turnFragments: 7, slowDownTimeline: 0 });
      const originalState = calendarService.getState();

      const newCalendarService = new CalendarService(
        CalendarService.createMonthlyConfig(),
        originalState
      );

      expect(newCalendarService.getState()).toEqual(originalState);
      expect(newCalendarService.formatCalendar()).toBe(calendarService.formatCalendar());
    });
  });
});
