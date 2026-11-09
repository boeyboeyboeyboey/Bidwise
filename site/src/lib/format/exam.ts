/** Final exam of a section (Section.exam), as text: "Thu 29 Apr, 13:00". Never a numeric date. */
export interface ExamSlot {
  /** ISO date, yyyy-mm-dd. */
  date: string;
  start: string;
  end: string | null;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Thu 29 Apr, 13:00"; '' when there is no exam or its date is unreadable. */
export function formatExam(exam: ExamSlot | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(exam?.date ?? '');
  if (!exam || !m) return '';
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  const t = /^(\d{1,2}):(\d{2})/.exec(exam.start ?? '');
  return `${DAYS[dt.getUTCDay()]} ${d} ${MONTHS[mo - 1]}${t ? `, ${t[1].padStart(2, '0')}:${t[2]}` : ''}`;
}
