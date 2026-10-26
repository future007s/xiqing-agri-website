import {isDay} from './record-days';

export function availableRecordDate(dates: string[], requested: string | null) {
  const valid = requested != null && isDay(requested) && dates.includes(requested);
  return {date: valid ? requested : dates.at(-1) ?? null, unavailable: requested != null && !valid};
}
export function shiftMonth(month: string, amount: number): string {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + amount, 1)).toISOString().slice(0, 7);
}
export function monthDays(month: string, dates: string[]) {
  const [year, number] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const allowed = new Set(dates);
  return Array.from({length: Math.ceil((offset + count) / 7) * 7}, (_, index) => {
    const date = new Date(Date.UTC(year, number - 1, 1 - offset + index)).toISOString().slice(0, 10);
    const inMonth = date.slice(0, 7) === month;
    return {date, day: Number(date.slice(-2)), enabled: inMonth && allowed.has(date), inMonth};
  });
}
export function calendarArrowDate(dates: string[], focused: string, key: string): string | null {
  if (!dates.includes(focused)) return null;
  if (key === 'ArrowLeft') return dates.filter(date => date < focused).at(-1) ?? null;
  if (key === 'ArrowRight') return dates.find(date => date > focused) ?? null;
  const date = new Date(focused + 'T00:00:00Z');
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    date.setUTCDate(date.getUTCDate() + (key === 'ArrowUp' ? -7 : 7));
    const target = date.toISOString().slice(0, 10);
    return key === 'ArrowUp' ? dates.filter(day => day <= target).at(-1) ?? null : dates.find(day => day >= target) ?? null;
  }
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  const start = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 6);
  const end = date.toISOString().slice(0, 10);
  const week = dates.filter(day => day >= start && day <= end);
  return key === 'Home' ? week[0] ?? null : key === 'End' ? week.at(-1) ?? null : null;
}
