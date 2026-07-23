export type UsEquityMarketDaySchedule = {
  afterCloseMinute: number;
  earlyClose: boolean;
  reason?: string;
  regularCloseMinute: number;
  regularOpenMinute: number;
  tradingDay: boolean;
};

export type UsEquityMarketSession = "Pre" | "Regular" | "After";

const regularOpenMinute = 9 * 60 + 30;
const regularCloseMinute = 16 * 60;
const regularAfterCloseMinute = 20 * 60;
const earlyRegularCloseMinute = 13 * 60;
const earlyAfterCloseMinute = 17 * 60;

export function getUsEquityMarketDaySchedule(date: string): UsEquityMarketDaySchedule {
  const parsed = parseDate(date);
  if (!parsed) return closedSchedule("Invalid date");

  const weekday = parsed.getUTCDay();
  if (weekday === 0 || weekday === 6) return closedSchedule("Weekend");

  const holidays = holidaysForYear(parsed.getUTCFullYear());
  const holiday = holidays.get(date);
  if (holiday) return closedSchedule(holiday);

  const earlyClose = earlyCloseDatesForYear(parsed.getUTCFullYear()).has(date);
  return {
    afterCloseMinute: earlyClose ? earlyAfterCloseMinute : regularAfterCloseMinute,
    earlyClose,
    reason: earlyClose ? "Scheduled early close" : undefined,
    regularCloseMinute: earlyClose ? earlyRegularCloseMinute : regularCloseMinute,
    regularOpenMinute,
    tradingDay: true,
  };
}

export function classifyUsEquityMarketMinute(
  date: string,
  minute: number,
): UsEquityMarketSession | null {
  const schedule = getUsEquityMarketDaySchedule(date);
  if (!schedule.tradingDay || !Number.isFinite(minute)) return null;
  if (minute >= 4 * 60 && minute < schedule.regularOpenMinute) return "Pre";
  if (minute >= schedule.regularOpenMinute && minute < schedule.regularCloseMinute) {
    return "Regular";
  }
  if (minute >= schedule.regularCloseMinute && minute < schedule.afterCloseMinute) return "After";
  return null;
}

function holidaysForYear(year: number) {
  const holidays = new Map<string, string>();
  addFixedHoliday(holidays, year, 1, 1, "New Year's Day", false);
  addHoliday(holidays, nthWeekdayOfMonth(year, 1, 1, 3), "Martin Luther King Jr. Day");
  addHoliday(holidays, nthWeekdayOfMonth(year, 2, 1, 3), "Washington's Birthday");
  addHoliday(holidays, addUtcDays(easterSunday(year), -2), "Good Friday");
  addHoliday(holidays, lastWeekdayOfMonth(year, 5, 1), "Memorial Day");
  addFixedHoliday(holidays, year, 6, 19, "Juneteenth National Independence Day");
  addFixedHoliday(holidays, year, 7, 4, "Independence Day");
  addHoliday(holidays, nthWeekdayOfMonth(year, 9, 1, 1), "Labor Day");
  addHoliday(holidays, nthWeekdayOfMonth(year, 11, 4, 4), "Thanksgiving Day");
  addFixedHoliday(holidays, year, 12, 25, "Christmas Day");
  return holidays;
}

function earlyCloseDatesForYear(year: number) {
  const dates = new Set<string>();
  const thanksgiving = nthWeekdayOfMonth(year, 11, 4, 4);
  addEarlyCloseIfTradingDay(dates, addUtcDays(thanksgiving, 1), year);

  const christmasEve = utcDate(year, 12, 24);
  addEarlyCloseIfTradingDay(dates, christmasEve, year);

  const julyFourth = utcDate(year, 7, 4);
  const julyFourthWeekday = julyFourth.getUTCDay();
  if (julyFourthWeekday >= 2 && julyFourthWeekday <= 5) {
    addEarlyCloseIfTradingDay(dates, utcDate(year, 7, 3), year);
  }

  return dates;
}

function addEarlyCloseIfTradingDay(dates: Set<string>, date: Date, year: number) {
  const dateKey = formatDate(date);
  if (date.getUTCFullYear() !== year) return;
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return;
  if (holidaysForYear(year).has(dateKey)) return;
  dates.add(dateKey);
}

function addFixedHoliday(
  holidays: Map<string, string>,
  year: number,
  month: number,
  day: number,
  label: string,
  observeSaturday = true,
) {
  const holiday = utcDate(year, month, day);
  const weekday = holiday.getUTCDay();
  const observed =
    weekday === 0
      ? addUtcDays(holiday, 1)
      : weekday === 6 && observeSaturday
        ? addUtcDays(holiday, -1)
        : holiday;
  addHoliday(holidays, observed, label);
}

function addHoliday(holidays: Map<string, string>, date: Date, label: string) {
  holidays.set(formatDate(date), label);
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number) {
  const first = utcDate(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return utcDate(year, month, 1 + offset + (nth - 1) * 7);
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number) {
  const last = utcDate(year, month + 1, 0);
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return addUtcDays(last, -offset);
}

function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, month, day);
}

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = utcDate(year, month, day);
  return formatDate(parsed) === value ? parsed : null;
}

function utcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

function addUtcDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function formatDate(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function closedSchedule(reason: string): UsEquityMarketDaySchedule {
  return {
    afterCloseMinute: 0,
    earlyClose: false,
    reason,
    regularCloseMinute: 0,
    regularOpenMinute,
    tradingDay: false,
  };
}
